/**
 * ============================================================================
 * FINANCIAL SUMMARY ENGINE — طبقة الحسابات المالية الموحدة
 * ============================================================================
 *
 *  الهدف:
 *    مصدر واحد لجميع الكروت المالية داخل النظام (Dashboard / Reports /
 *    Agent Statement / Company Statement / Cash Merchant / Currency Supplier).
 *
 *  ملاحظات مهمة (Phase 1 — Refactoring داخلي فقط):
 *    - هذا الملف **يُغلِّف** المنطق الموجود في:
 *        • src/lib/financialEngine.ts  (payment_splits / cash_boxes)
 *        • src/lib/reportsData.ts      (بيانات التقارير Live)
 *        • src/lib/dashboard.functions.ts (أرباح Server-side)
 *    - لم يُغيَّر أي منطق حسابي — فقط تم توحيد نقاط الاستدعاء وشكل النتائج.
 *    - جميع الدوال تُرجع النتائج **مُجمَّعة حسب العملة** بترتيب ثابت:
 *        EGP → USD → LYD ثم أي عملات أخرى بترتيب أبجدي.
 *    - العملات التي ليس لها حركات لا تظهر إطلاقاً في النتيجة.
 *
 *  قاعدة صارمة:
 *    ⛔ ممنوع حساب أي إجمالي مالي داخل صفحة (Dashboard/Reports/Statements).
 *    ✅ استدعِ هذه الدوال فقط.
 * ============================================================================
 */

import { useMemo } from "react";
import {
  useLive,
  tripValue,
  txnTotalPaid,
  merchantCashNet,
  merchantCompanyOutflowAmount,
} from "@/lib/db";
import type {
  Agent,
  CompanyTransaction,
  Expense,
  IssuingCompany,
  Investor,
  InvestorTransaction,
  Merchant,
  MerchantCashCollection,
  Transaction,
  UsdTreasuryTransaction,
} from "@/lib/db";




/* ============================================================
 *  Types
 * ============================================================ */

export type Currency = "EGP" | "USD" | "LYD" | string;

/** ترتيب العرض الثابت للعملات في كل الكروت. */
export const CURRENCY_ORDER: Currency[] = ["EGP", "USD", "LYD"];

/** خريطة عملة → قيمة، مع Iterator يحترم CURRENCY_ORDER. */
export class CurrencyMap {
  private data = new Map<Currency, number>();

  add(currency: Currency | null | undefined, amount: number): void {
    if (!currency) return;
    const cur = String(currency).toUpperCase();
    this.data.set(cur, (this.data.get(cur) || 0) + (Number(amount) || 0));
  }

  get(currency: Currency): number {
    return this.data.get(currency) || 0;
  }

  /** يُرجع المصفوفة بترتيب EGP→USD→LYD ثم أبجدياً؛ يحذف العملات الصفرية. */
  entries(opts: { includeZero?: boolean } = {}): Array<{ currency: Currency; amount: number }> {
    const seen = new Set<Currency>();
    const out: Array<{ currency: Currency; amount: number }> = [];
    for (const cur of CURRENCY_ORDER) {
      if (this.data.has(cur)) {
        const amt = this.data.get(cur) || 0;
        if (opts.includeZero || Math.abs(amt) > 0.0001) {
          out.push({ currency: cur, amount: amt });
        }
        seen.add(cur);
      }
    }
    const rest = Array.from(this.data.keys())
      .filter((c) => !seen.has(c))
      .sort();
    for (const cur of rest) {
      const amt = this.data.get(cur) || 0;
      if (opts.includeZero || Math.abs(amt) > 0.0001) {
        out.push({ currency: cur, amount: amt });
      }
    }
    return out;
  }

  toObject(): Record<string, number> {
    const o: Record<string, number> = {};
    for (const { currency, amount } of this.entries()) o[currency] = amount;
    return o;
  }

  isEmpty(): boolean {
    return this.entries().length === 0;
  }
}

/** ملخص جهة (وكيل / شركة / تاجر / مورد عملة). */
export type EntitySummary = {
  /** إجمالي البيع / التكلفة / الحركات — حسب نوع الجهة، مجمَّع بالعملة. */
  totalDebit: CurrencyMap;
  /** إجمالي المدفوع / التحصيل / التسويات، مجمَّع بالعملة. */
  totalCredit: CurrencyMap;
  /** الرصيد = debit - credit، مجمَّع بالعملة. موجب = مستحق للنظام. */
  balance: CurrencyMap;
  /** عدد العمليات (صفوف الجدول الأم فقط، ليس السطور الفرعية). */
  count: number;
};

const empty = (): EntitySummary => ({
  totalDebit: new CurrencyMap(),
  totalCredit: new CurrencyMap(),
  balance: new CurrencyMap(),
  count: 0,
});

/* ============================================================
 *  Helpers
 * ============================================================ */

function txnCurrency(t: Partial<Transaction>): Currency {
  return (t.currency && String(t.currency).toUpperCase()) || "EGP";
}
function companyTxnCurrency(t: Partial<CompanyTransaction>): Currency {
  const anyT = t as any;
  return (
    (anyT.currency && String(anyT.currency).toUpperCase()) ||
    (anyT.payment_currency && String(anyT.payment_currency).toUpperCase()) ||
    "EGP"
  );
}

/**
 * تحويل صف transactions إلى (بيع، مدفوع) — نستخدم نفس الدوال المشتركة
 * (`tripValue` و `txnTotalPaid` من `@/lib/db`) لضمان تطابق الأرقام مع
 * جميع الشاشات القديمة (accounts / reports / dashboard).
 */
function txnSaleAndPaid(t: Partial<Transaction>): { sale: number; paid: number } {
  return {
    sale: tripValue(t as any),
    paid: txnTotalPaid(t),
  };
}


/* ============================================================
 *  AGENTS — ملخص الوكلاء
 * ============================================================ */

/** ملخص وكيل واحد بناءً على صفوف transactions الخاصة به. */
export function summarizeAgent(transactions: Transaction[]): EntitySummary {
  const s = empty();
  s.count = transactions.length;
  for (const t of transactions) {
    const cur = txnCurrency(t);
    const { sale, paid } = txnSaleAndPaid(t);
    s.totalDebit.add(cur, sale);
    s.totalCredit.add(cur, paid);
    s.balance.add(cur, sale - paid);
  }
  return s;
}

/** Hook حي لملخص وكيل واحد. */
export function useAgentSummary(agentId: string | null | undefined): EntitySummary {
  const { rows } = useLive<Transaction>("transactions");
  return useMemo(() => {
    if (!agentId) return empty();
    return summarizeAgent(rows.filter((r) => r.agent_id === agentId));
  }, [rows, agentId]);
}

/** Hook حي لملخصات جميع الوكلاء (مفهرسة بالمعرِّف). */
export function useAgentsSummary(): Map<string, EntitySummary> {
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: txns } = useLive<Transaction>("transactions");
  return useMemo(() => {
    const grouped = new Map<string, Transaction[]>();
    for (const a of agents) grouped.set(a.id, []);
    for (const t of txns) {
      if (!t.agent_id) continue;
      const arr = grouped.get(t.agent_id);
      if (arr) arr.push(t);
    }
    const out = new Map<string, EntitySummary>();
    for (const [id, list] of grouped) out.set(id, summarizeAgent(list));
    return out;
  }, [agents, txns]);
}

/* ============================================================
 *  COMPANIES — ملخص الشركات المُصدِرة
 * ============================================================ */

export function summarizeCompany(rows: CompanyTransaction[]): EntitySummary {
  const s = empty();
  s.count = rows.length;
  for (const t of rows) {
    const cur = companyTxnCurrency(t);
    // Match legacy /companies screen exactly:
    //   debit  = trip_value (إجمالي الخدمات)
    //   credit = total_paid (المدفوع)
    const debit = Number((t as any).trip_value ?? (t as any).amount ?? 0);
    const credit = Number(
      (t as any).total_paid ?? (t as any).paid_amount ?? (t as any).paid ?? 0,
    );
    s.totalDebit.add(cur, debit);
    s.totalCredit.add(cur, credit);
    s.balance.add(cur, debit - credit);
  }
  return s;
}

export function useCompanySummary(companyId: string | null | undefined): EntitySummary {
  const { rows } = useLive<CompanyTransaction>("company_transactions");
  return useMemo(() => {
    if (!companyId) return empty();
    return summarizeCompany(rows.filter((r) => (r as any).company_id === companyId));
  }, [rows, companyId]);
}

export function useCompaniesSummary(): Map<string, EntitySummary> {
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const { rows: txns } = useLive<CompanyTransaction>("company_transactions");
  return useMemo(() => {
    const grouped = new Map<string, CompanyTransaction[]>();
    for (const c of companies) grouped.set(c.id, []);
    for (const t of txns) {
      const cid = (t as any).company_id as string | null;
      if (!cid) continue;
      const arr = grouped.get(cid);
      if (arr) arr.push(t);
    }
    const out = new Map<string, EntitySummary>();
    for (const [id, list] of grouped) out.set(id, summarizeCompany(list));
    return out;
  }, [companies, txns]);
}

/* ============================================================
 *  CASH MERCHANTS — تجار الكاش
 * ============================================================
 *  المصدر: payment_splits (نفس منطق financialEngine).
 *  الرصيد = مجموع (out - in) — موجب: التاجر يستحق للنظام.
 * ============================================================ */

type SplitRow = {
  id: string;
  method: string | null;
  currency: string | null;
  cash_box_id: string | null;
  amount: number | string;
  direction: "in" | "out";
  source_table: string | null;
  source_id: string | null;
  cancelled_at?: string | null;
};

function isMerchantSplit(s: SplitRow): boolean {
  const m = (s.method || "").toString();
  return m.includes("تاجر") || m.includes("كاش تاجر");
}

export function useMerchantSummary(merchantId: string | null | undefined): EntitySummary {
  const { rows: splits } = useLive<SplitRow>("payment_splits");
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: coll } = useLive<any>("merchant_cash_collections");
  return useMemo(() => {
    if (!merchantId) return empty();
    // معرّفات الصفوف الأم المرتبطة بهذا التاجر (transactions + collections)
    const parentTxnIds = new Set(
      txns.filter((t) => t.merchant_id === merchantId).map((t) => t.id),
    );
    const parentCollIds = new Set(
      coll.filter((c: any) => c.merchant_id === merchantId).map((c: any) => c.id),
    );
    const s = empty();
    let count = 0;
    for (const sp of splits) {
      if (sp.cancelled_at) continue;
      const isTxn =
        sp.source_table === "transactions" &&
        sp.source_id &&
        parentTxnIds.has(sp.source_id) &&
        isMerchantSplit(sp);
      const isColl =
        sp.source_table === "merchant_cash_collections" &&
        sp.source_id &&
        parentCollIds.has(sp.source_id);
      if (!isTxn && !isColl) continue;
      count += 1;
      const cur = (sp.currency || "EGP").toUpperCase();
      const amt = Number(sp.amount) || 0;
      if (sp.direction === "out") {
        s.totalDebit.add(cur, amt);
        s.balance.add(cur, amt);
      } else {
        s.totalCredit.add(cur, amt);
        s.balance.add(cur, -amt);
      }
    }
    s.count = count;
    return s;
  }, [splits, txns, coll, merchantId]);
}

export function useMerchantsSummary(): Map<string, EntitySummary> {
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: splits } = useLive<SplitRow>("payment_splits");
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: coll } = useLive<any>("merchant_cash_collections");
  return useMemo(() => {
    // فهرسة الصفوف الأم لكل تاجر
    const txnByMerchant = new Map<string, Set<string>>();
    for (const t of txns) {
      if (!t.merchant_id) continue;
      let set = txnByMerchant.get(t.merchant_id);
      if (!set) txnByMerchant.set(t.merchant_id, (set = new Set()));
      set.add(t.id);
    }
    const collByMerchant = new Map<string, Set<string>>();
    for (const c of coll as any[]) {
      if (!c.merchant_id) continue;
      let set = collByMerchant.get(c.merchant_id);
      if (!set) collByMerchant.set(c.merchant_id, (set = new Set()));
      set.add(c.id);
    }

    const out = new Map<string, EntitySummary>();
    for (const m of merchants) out.set(m.id, empty());

    for (const sp of splits) {
      if (sp.cancelled_at) continue;
      if (!sp.source_table || !sp.source_id) continue;
      const cur = (sp.currency || "EGP").toUpperCase();
      const amt = Number(sp.amount) || 0;

      let merchantId: string | null = null;
      if (sp.source_table === "transactions" && isMerchantSplit(sp)) {
        for (const [mid, ids] of txnByMerchant) {
          if (ids.has(sp.source_id)) { merchantId = mid; break; }
        }
      } else if (sp.source_table === "merchant_cash_collections") {
        for (const [mid, ids] of collByMerchant) {
          if (ids.has(sp.source_id)) { merchantId = mid; break; }
        }
      }
      if (!merchantId) continue;

      const s = out.get(merchantId) ?? empty();
      s.count += 1;
      if (sp.direction === "out") {
        s.totalDebit.add(cur, amt);
        s.balance.add(cur, amt);
      } else {
        s.totalCredit.add(cur, amt);
        s.balance.add(cur, -amt);
      }
      out.set(merchantId, s);
    }
    return out;
  }, [merchants, splits, txns, coll]);
}

/* ============================================================
 *  MERCHANT AGGREGATES — تجميعات صفحة تجار الكاش (EGP-only)
 * ============================================================
 *  خمس دلاء (buckets) لكل تاجر تُطابق منطق شاشة `/merchants`:
 *    - incoming   = الوارد من الوكلاء (net wallet + physical)
 *    - outgoing   = الصادر للشركات (من company_transactions ومن
 *                    transactions.source_service_type = merchant_cash_out_to_*)
 *    - collected  = ما تم تحصيله نقداً من التاجر (merchant_cash_collections)
 *    - paidOut    = ما صُرف نقداً للتاجر (source_service_type = merchant_cash_out)
 *    - converted  = ما حُوّل إلى USD (usd_treasury_transactions conversion)
 *
 *  balance = incoming + paidOut − collected − outgoing − converted
 *  (موجب = رصيد لدى النظام لصالح التاجر / سالب = دَين على التاجر).
 * ============================================================ */

export type MerchantAggregate = {
  incoming: number;
  outgoing: number;
  collected: number;
  paidOut: number;
  converted: number;
};

const emptyMerchantAgg = (): MerchantAggregate => ({
  incoming: 0, outgoing: 0, collected: 0, paidOut: 0, converted: 0,
});

export function computeMerchantAggregates(input: {
  txns: Transaction[];
  companyTxns: CompanyTransaction[];
  collections: MerchantCashCollection[];
  usdRows: UsdTreasuryTransaction[];
}): Map<string, MerchantAggregate> {
  const { txns, companyTxns, collections, usdRows } = input;
  const map = new Map<string, MerchantAggregate>();
  const get = (id: string) => {
    let v = map.get(id);
    if (!v) { v = emptyMerchantAgg(); map.set(id, v); }
    return v;
  };
  // Company-outflow rows already mirrored into transactions must not be double-counted.
  const merchantCompanyOutSourceIds = new Set<string>();
  for (const t of txns) {
    if (t.merchant_id && t.source_service_type === "merchant_cash_out_to_company") {
      const src = (t as any).source_service_id;
      if (src) merchantCompanyOutSourceIds.add(src);
    }
  }
  for (const t of txns) {
    if (!t.merchant_id) continue;
    if (t.source_service_type === "merchant_cash_out") {
      get(t.merchant_id).paidOut += Math.abs(Number(t.paid || 0));
      continue;
    }
    if (
      t.source_service_type === "merchant_cash_out_to_company" ||
      t.source_service_type === "merchant_cash_out_to_agent"
    ) {
      get(t.merchant_id).outgoing += Math.abs(Number(t.paid || 0));
      continue;
    }
    get(t.merchant_id).incoming +=
      merchantCashNet(t) + Number(t.merchant_cash_physical_amount || 0);
  }
  for (const t of companyTxns) {
    if (!(t as any).merchant_id) continue;
    if (merchantCompanyOutSourceIds.has(t.id)) continue;
    get((t as any).merchant_id).outgoing += merchantCompanyOutflowAmount(t);
  }
  for (const c of collections) {
    get(c.merchant_id).collected += Number(c.amount || 0);
  }
  for (const r of usdRows) {
    if (r.type !== "conversion" || !(r as any).merchant_id) continue;
    const src = (r as any).source_type;
    if (src !== "merchant_wallet" && src !== "merchant_physical") continue;
    get((r as any).merchant_id).converted += Number((r as any).egp_amount || 0);
  }
  return map;
}

/** Hook حي لتجميعات كل التجار (EGP). */
export function useMerchantAggregates(): Map<string, MerchantAggregate> {
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: companyTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");
  const { rows: usdRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  return useMemo(
    () => computeMerchantAggregates({ txns, companyTxns, collections, usdRows }),
    [txns, companyTxns, collections, usdRows],
  );
}

/** المجموع الكلي (كل التجار) + الرصيد الصافي — يُستخدم في كروت KPI. */
export function useMerchantTotals(): MerchantAggregate & { balance: number } {
  const per = useMerchantAggregates();
  return useMemo(() => {
    const t = emptyMerchantAgg();
    for (const v of per.values()) {
      t.incoming += v.incoming;
      t.outgoing += v.outgoing;
      t.collected += v.collected;
      t.paidOut += v.paidOut;
      t.converted += v.converted;
    }
    const balance = t.incoming + t.paidOut - t.collected - t.outgoing - t.converted;
    return { ...t, balance };
  }, [per]);
}


/* ============================================================
 *  CURRENCY SUPPLIERS — موردو العملات
 * ============================================================
 *  نموذج الرصيد (مطابق تماماً لكشف حساب المورد في الشاشة):
 *    - شراء عملة  → EGP residual = splitsTotal - sold_amount   (سالب: نحن مدينون)
 *    - بيع  عملة  → EGP residual = bought_amount - splitsTotal (موجب: المورد مدين)
 *    - دفع نقدية للمورد  → +amount في عملة المدفوع
 *    - استلام نقدية      → -amount في عملة المستلم
 *    - رصيد سابق         → bought - sold  في opening_currency
 *  موجب = المورد يستحق للنظام، سالب = النظام يستحق للمورد.
 * ============================================================ */

const EGP_CODE_ = "EGP";
function _normCur(c: string | null | undefined): string {
  const v = (c || "").toString().trim().toUpperCase();
  return v || EGP_CODE_;
}

export type CurrencySupplierTx = {
  tx_type: "شراء عملة" | "بيع عملة" | "رصيد سابق" | "دفع نقدية" | "استلام نقدية" | string;
  bought_currency: string;
  bought_amount: number | string | null;
  sold_currency: string;
  sold_amount: number | string | null;
  opening_currency?: string | null;
  payment_splits?: Array<{ amount?: number | string | null }> | null;
};

/** الدلتا الفعلية لصف واحد في كشف مورد العملة. */
export function currencySupplierDelta(t: CurrencySupplierTx): { currency: string; delta: number } {
  const splitsTotal = (t.payment_splits || []).reduce(
    (s, x) => s + (Number(x?.amount) || 0), 0,
  );
  if (t.tx_type === "شراء عملة") {
    const egp = Number(t.sold_amount || 0);
    return { currency: EGP_CODE_, delta: splitsTotal - egp };
  }
  if (t.tx_type === "بيع عملة") {
    const egp = Number(t.bought_amount || 0);
    return { currency: EGP_CODE_, delta: egp - splitsTotal };
  }
  if (t.tx_type === "دفع نقدية") {
    return { currency: _normCur(t.sold_currency), delta: Number(t.sold_amount || 0) };
  }
  if (t.tx_type === "استلام نقدية") {
    return { currency: _normCur(t.bought_currency), delta: -Number(t.bought_amount || 0) };
  }
  // رصيد سابق
  return {
    currency: _normCur(t.opening_currency || t.bought_currency),
    delta: Number(t.bought_amount || 0) - Number(t.sold_amount || 0),
  };
}

/** إجماليات كشف مورد العملة مُجمَّعة بالعملة (تُطابق CurrencyTotalsCards). */
export type CurrencySupplierCurrencyTotal = {
  currency: string;
  debit: number;
  credit: number;
  net: number;
  count: number;
};

export function summarizeCurrencySupplierStatement(
  rows: CurrencySupplierTx[],
): CurrencySupplierCurrencyTotal[] {
  const map = new Map<string, { debit: number; credit: number; count: number }>();
  const bump = (cur: string, d: number, c: number) => {
    const k = cur || EGP_CODE_;
    const g = map.get(k) || { debit: 0, credit: 0, count: 0 };
    g.debit += d; g.credit += c; g.count += 1;
    map.set(k, g);
  };
  for (const t of rows) {
    const { currency, delta } = currencySupplierDelta(t);
    if (delta === 0) { bump(currency, 0, 0); continue; }
    if (delta > 0) bump(currency, delta, 0); else bump(currency, 0, -delta);
  }
  return Array.from(map.entries())
    .map(([currency, v]) => ({
      currency,
      debit: v.debit,
      credit: v.credit,
      net: v.debit - v.credit,
      count: v.count,
    }))
    .filter((t) => t.debit !== 0 || t.credit !== 0 || t.net !== 0);
}

/** رصيد جارٍ عبر الصفوف بترتيبها (للعمود "الرصيد" في الكشف). */
export function attachRunningBalances<T extends CurrencySupplierTx>(
  rows: T[],
): Array<T & { balance: number; balanceCurrency: string }> {
  const bals = new Map<string, number>();
  return rows.map((t) => {
    const { currency, delta } = currencySupplierDelta(t);
    const next = (bals.get(currency) || 0) + delta;
    bals.set(currency, next);
    return { ...t, balance: next, balanceCurrency: currency };
  });
}

/** ملخص "صافي بالعملة" — يُستخدم في التصدير. */
export function summarizeCurrencySupplierNetByCurrency(
  rows: CurrencySupplierTx[],
): Array<{ currency: string; net: number }> {
  const map = new Map<string, number>();
  for (const t of rows) {
    map.set(t.bought_currency, (map.get(t.bought_currency) || 0) + Number(t.bought_amount || 0));
    map.set(t.sold_currency, (map.get(t.sold_currency) || 0) - Number(t.sold_amount || 0));
  }
  return Array.from(map.entries()).map(([currency, net]) => ({ currency, net }));
}

/* ============================================================
 *  INVESTORS — ملخص المستثمرين (EGP فقط)
 * ============================================================
 *  توريد نقدية → deposit
 *  صرف نقدية    → withdraw
 *  balance = deposit − withdraw
 * ============================================================ */

export type InvestorSummary = {
  deposit: number;
  withdraw: number;
  balance: number;
  count: number;
};

const emptyInvestorSummary = (): InvestorSummary => ({
  deposit: 0, withdraw: 0, balance: 0, count: 0,
});

export function summarizeInvestor(rows: InvestorTransaction[]): InvestorSummary {
  const s = emptyInvestorSummary();
  for (const t of rows) {
    const amt = Number(t.amount || 0);
    if (t.transaction_type === "توريد نقدية") s.deposit += amt;
    else if (t.transaction_type === "صرف نقدية") s.withdraw += amt;
  }
  s.count = rows.length;
  s.balance = s.deposit - s.withdraw;
  return s;
}

/** Hook حي لملخصات كل المستثمرين (مفهرسة بالمعرِّف). */
export function useInvestorsSummary(): Map<string, InvestorSummary> {
  const { rows: investors } = useLive<Investor>("investors");
  const { rows: txns } = useLive<InvestorTransaction>("investor_transactions");
  return useMemo(() => {
    const grouped = new Map<string, InvestorTransaction[]>();
    for (const i of investors) grouped.set(i.id, []);
    for (const t of txns) {
      const arr = grouped.get(t.investor_id);
      if (arr) arr.push(t);
    }
    const out = new Map<string, InvestorSummary>();
    for (const [id, list] of grouped) out.set(id, summarizeInvestor(list));
    return out;
  }, [investors, txns]);
}

/** إجمالي كل المستثمرين مجمَّعاً — لكروت KPI في أعلى الصفحة. */
export function useInvestorsTotals(): InvestorSummary {
  const { rows: txns } = useLive<InvestorTransaction>("investor_transactions");
  return useMemo(() => summarizeInvestor(txns), [txns]);
}

/* ============================================================
 *  EXPENSES — ملخص المصروفات (EGP فقط)
 * ============================================================
 *  إجماليات مطابقة تماماً لكروت شاشة `/expenses`:
 *    - total = مجموع كل المصروفات
 *    - fixed = expense_type === "ثابت"
 *    - variable = expense_type === "متغير"
 * ============================================================ */

export type ExpensesTotals = {
  total: number;
  fixed: number;
  variable: number;
  count: number;
};

export function summarizeExpenses(rows: Expense[]): ExpensesTotals {
  const t: ExpensesTotals = { total: 0, fixed: 0, variable: 0, count: rows.length };
  for (const e of rows) {
    const amt = Number((e as any).amount || 0);
    t.total += amt;
    if ((e as any).expense_type === "ثابت") t.fixed += amt;
    else if ((e as any).expense_type === "متغير") t.variable += amt;
  }
  return t;
}

/** Hook حي لإجماليات المصروفات. */
export function useExpensesTotals(): ExpensesTotals {
  const { rows } = useLive<Expense>("expenses");
  return useMemo(() => summarizeExpenses(rows), [rows]);
}

/* ============================================================
 *  DASHBOARD — إجماليات النظام (Live، بالعملة)
 * ============================================================ */



export type DashboardTotals = {
  agentsSales: CurrencyMap;
  agentsPaid: CurrencyMap;
  agentsReceivable: CurrencyMap;
  companiesCost: CurrencyMap;
  companiesPaid: CurrencyMap;
  companiesPayable: CurrencyMap;
};

export function useDashboardTotals(): DashboardTotals {
  const agentsSum = useAgentsSummary();
  const companiesSum = useCompaniesSummary();
  return useMemo(() => {
    const t: DashboardTotals = {
      agentsSales: new CurrencyMap(),
      agentsPaid: new CurrencyMap(),
      agentsReceivable: new CurrencyMap(),
      companiesCost: new CurrencyMap(),
      companiesPaid: new CurrencyMap(),
      companiesPayable: new CurrencyMap(),
    };
    for (const s of agentsSum.values()) {
      for (const { currency, amount } of s.totalDebit.entries()) t.agentsSales.add(currency, amount);
      for (const { currency, amount } of s.totalCredit.entries()) t.agentsPaid.add(currency, amount);
      for (const { currency, amount } of s.balance.entries()) t.agentsReceivable.add(currency, amount);
    }
    for (const s of companiesSum.values()) {
      for (const { currency, amount } of s.totalDebit.entries()) t.companiesCost.add(currency, amount);
      for (const { currency, amount } of s.totalCredit.entries()) t.companiesPaid.add(currency, amount);
      for (const { currency, amount } of s.balance.entries()) t.companiesPayable.add(currency, amount);
    }
    return t;
  }, [agentsSum, companiesSum]);
}

/* ============================================================
 *  LEDGER — تجميعات كشوف الحسابات (وكيل / شركة) حسب العملة
 * ============================================================
 *  يُستخدم في:
 *    - AgentLedger (كشف حساب الوكيل)
 *    - CompanyStatementTab (كشف حساب الشركة الصادرة)
 *  المدخلات: صفوف كشف تحتوي {currency, debit, credit}
 *  المخرجات: مصفوفة {currency, debit, credit, net, count} مرتّبة
 *  بترتيب CURRENCY_ORDER (EGP → USD → LYD → أبجدي).
 * ============================================================ */

export type LedgerCurrencyTotal = {
  currency: string;
  debit: number;
  credit: number;
  net: number;
  count: number;
};

export function summarizeLedgerByCurrency(
  rows: ReadonlyArray<{ currency?: string | null; debit: number; credit: number }>,
): LedgerCurrencyTotal[] {
  const map = new Map<string, { debit: number; credit: number; count: number }>();
  for (const e of rows) {
    const cur = (e.currency && String(e.currency)) || "EGP";
    const g = map.get(cur) || { debit: 0, credit: 0, count: 0 };
    g.debit += Number(e.debit) || 0;
    g.credit += Number(e.credit) || 0;
    g.count += 1;
    map.set(cur, g);
  }
  const seen = new Set<string>();
  const out: LedgerCurrencyTotal[] = [];
  for (const cur of CURRENCY_ORDER) {
    if (map.has(cur)) {
      const g = map.get(cur)!;
      out.push({ currency: cur, debit: g.debit, credit: g.credit, net: g.debit - g.credit, count: g.count });
      seen.add(cur);
    }
  }
  for (const cur of Array.from(map.keys()).filter((c) => !seen.has(c)).sort()) {
    const g = map.get(cur)!;
    out.push({ currency: cur, debit: g.debit, credit: g.credit, net: g.debit - g.credit, count: g.count });
  }
  return out;
}

/**
 * يضيف عمود `balance` لكل صف كشف حساب بحساب الرصيد الجاري **لكل عملة**
 * على حدة (EGP/USD/LYD/...) — لا يُخلط بين العملات إطلاقاً.
 * يُستخدم في كشوف حساب الوكيل والشركة.
 */
export function attachLedgerRunningBalance<
  T extends { currency?: string | null; debit: number; credit: number }
>(rows: T[]): Array<T & { balance: number }> {
  const bals = new Map<string, number>();
  return rows.map((e) => {
    const cur = (e.currency && String(e.currency)) || "EGP";
    const next = (bals.get(cur) || 0) + (Number(e.debit) || 0) - (Number(e.credit) || 0);
    bals.set(cur, next);
    return { ...e, balance: next };
  });
}

/* ============================================================
 *  Formatting helper — لعرض قيمة مع عملتها.
 * ============================================================ */

export function formatCurrencyAmount(amount: number, currency: Currency): string {
  const n = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 0,
  }).format(Math.round((Number(amount) || 0) * 100) / 100);
  return `${n} ${currency}`;
}

/** يُرجع قائمة أسطر جاهزة للعرض داخل كارت (EGP → USD → LYD، بدون العملات الصفرية). */
export function formatCurrencyLines(map: CurrencyMap): string[] {
  return map.entries().map(({ currency, amount }) => formatCurrencyAmount(amount, currency));
}
