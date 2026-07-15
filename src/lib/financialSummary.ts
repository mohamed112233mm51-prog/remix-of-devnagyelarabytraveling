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
import { computeExecutionSalesEGP, type ExecutionRow } from "./executionProfit";
import {
  computeAgentCollections,
  computeAgentCollectionsByCurrency,
  computeMerchantCashCollections,
  computeMerchantCashCollectionsByCurrency,
  buildCollectionCurrencyMap,
  type CollectionSplitRow,
} from "./dashboardCollections";
import {
  useLive,
  tripValue,
  txnTotalPaid,
  txnCollectedAmount,
  merchantCashNet,
  merchantCashGross,
  merchantCompanyOutflowAmount,
  normalizeCurrency,
  fmtCurrency,
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

  /**
   * @deprecated ⛔ يخلط العملات في رقم واحد. لا تستخدمه لأي رصيد أو إجمالي قد يحتوي
   * أكثر من عملة. Currency-Safe الآن يمنع دمج العملات — استخدم `entries()` والعرض
   * سطراً لكل عملة عبر `formatCurrencyLines(map)`.
   * يُترك للاستخدام الداخلي فقط عندما نضمن يقيناً أن الحركات كلها بعملة واحدة.
   */
  total(): number {
    let t = 0;
    for (const v of this.data.values()) t += v;
    return t;
  }

  /** عدد العملات غير الصفرية داخل الخريطة. */
  size(): number {
    return this.entries().length;
  }

  /** استنساخ الخريطة (مفيد لبناء تجميعات جديدة دون تعديل الأصل). */
  clone(): CurrencyMap {
    const c = new CurrencyMap();
    for (const [k, v] of this.data) c.data.set(k, v);
    return c;
  }

  /** يُدمج خريطة أخرى داخل هذه (نفس العملة تُجمع، عملة جديدة تُضاف). */
  merge(other: CurrencyMap): void {
    for (const { currency, amount } of other.entries({ includeZero: true })) {
      this.add(currency, amount);
    }
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
 *  المصدر الوحيد للحساب هو نفس صفوف كشف الحساب (`buildAgentLedgerRows`)
 *  التي يستخدمها `AgentLedger`. أي رقم يظهر في كارت "إجمالي الوكلاء"
 *  = مجموع ما يظهر في كشف كل وكيل بالضبط (تعريفياً).
 * ============================================================ */

/** ملخص وكيل واحد بناءً على صفوف transactions الخاصة به. */
export function summarizeAgent(
  transactions: Transaction[],
  splitCurrencyByTxnId?: Map<string, string>,
): EntitySummary {
  const rows = buildAgentLedgerRows(transactions, splitCurrencyByTxnId ?? new Map());
  const s = empty();
  s.count = rows.length;
  for (const r of rows) {
    s.totalDebit.add(r.currency, r.debit);
    s.totalCredit.add(r.currency, r.credit);
    s.balance.add(r.currency, r.debit - r.credit);
  }
  return s;
}

/** Hook حي لملخص وكيل واحد. */
export function useAgentSummary(agentId: string | null | undefined): EntitySummary {
  const { rows } = useLive<Transaction>("transactions");
  const { rows: splits } = useLive<SplitCurrencyRow>("payment_splits");
  return useMemo(() => {
    if (!agentId) return empty();
    const curMap = resolveSplitCurrencyByRef(splits, "transactions");
    return summarizeAgent(rows.filter((r) => r.agent_id === agentId), curMap);
  }, [rows, splits, agentId]);
}

/** Hook حي لملخصات جميع الوكلاء (مفهرسة بالمعرِّف). */
export function useAgentsSummary(): Map<string, EntitySummary> {
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: splits } = useLive<SplitCurrencyRow>("payment_splits");
  return useMemo(() => {
    const grouped = new Map<string, Transaction[]>();
    for (const a of agents) grouped.set(a.id, []);
    for (const t of txns) {
      if (!t.agent_id) continue;
      const arr = grouped.get(t.agent_id);
      if (arr) arr.push(t);
    }
    const curMap = resolveSplitCurrencyByRef(splits, "transactions");
    const out = new Map<string, EntitySummary>();
    for (const [id, list] of grouped) out.set(id, summarizeAgent(list, curMap));
    return out;
  }, [agents, txns, splits]);
}

/* ============================================================
 *  COMPANIES — ملخص الشركات المُصدِرة
 *  المصدر الوحيد للحساب هو نفس صفوف كشف الحساب (`buildCompanyLedgerRows`)
 *  التي يستخدمها `CompanyStatementTab`.
 * ============================================================ */

export function summarizeCompany(
  rows: CompanyTransaction[],
  splitCurrencyByTxnId?: Map<string, string>,
): EntitySummary {
  const built = buildCompanyLedgerRows(rows, splitCurrencyByTxnId ?? new Map());
  const s = empty();
  s.count = built.length;
  for (const r of built) {
    s.totalDebit.add(r.currency, r.debit);
    s.totalCredit.add(r.currency, r.credit);
    s.balance.add(r.currency, r.debit - r.credit);
  }
  return s;
}

export function useCompanySummary(companyId: string | null | undefined): EntitySummary {
  const { rows } = useLive<CompanyTransaction>("company_transactions");
  const { rows: splits } = useLive<SplitCurrencyRow>("payment_splits");
  return useMemo(() => {
    if (!companyId) return empty();
    const curMap = resolveSplitCurrencyByRef(splits, "company_transactions");
    return summarizeCompany(rows.filter((r) => (r as any).company_id === companyId), curMap);
  }, [rows, splits, companyId]);
}

export function useCompaniesSummary(): Map<string, EntitySummary> {
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const { rows: txns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: splits } = useLive<SplitCurrencyRow>("payment_splits");
  return useMemo(() => {
    const grouped = new Map<string, CompanyTransaction[]>();
    for (const c of companies) grouped.set(c.id, []);
    for (const t of txns) {
      const cid = (t as any).company_id as string | null;
      if (!cid) continue;
      const arr = grouped.get(cid);
      if (arr) arr.push(t);
    }
    const curMap = resolveSplitCurrencyByRef(splits, "company_transactions");
    const out = new Map<string, EntitySummary>();
    for (const [id, list] of grouped) out.set(id, summarizeCompany(list, curMap));
    return out;
  }, [companies, txns, splits]);
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
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: companyTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");
  const { rows: usdRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  const { rows: splits } = useLive<CollectionSplitRow>("payment_splits");
  return useMemo(() => {
    if (!merchantId) return empty();
    const input = buildMerchantMovementInputs(txns, companyTxns, collections, usdRows, splits);
    return summarizeMerchantMovementsAsEntity(buildMerchantMovements(merchantId, input));
  }, [txns, companyTxns, collections, usdRows, splits, merchantId]);
}

export function useMerchantsSummary(): Map<string, EntitySummary> {
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: companyTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");
  const { rows: usdRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  const { rows: splits } = useLive<CollectionSplitRow>("payment_splits");
  return useMemo(() => {
    const out = new Map<string, EntitySummary>();
    const input = buildMerchantMovementInputs(txns, companyTxns, collections, usdRows, splits);
    for (const m of merchants) {
      out.set(m.id, summarizeMerchantMovementsAsEntity(buildMerchantMovements(m.id, input)));
    }
    return out;
  }, [merchants, txns, companyTxns, collections, usdRows, splits]);
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
 *    - balance    = صافي كل الدلتا في كشف التاجر نفسه (يشمل الصرف لوكيل)
 *    - converted  = ما حُوّل إلى USD (usd_treasury_transactions conversion)
 *
 *  balance = sum(movement.delta)
 *  (موجب = رصيد لدى النظام لصالح التاجر / سالب = دَين على التاجر).
 * ============================================================ */

export type MerchantAggregate = {
  incoming: CurrencyMap;
  outgoing: CurrencyMap;
  collected: CurrencyMap;
  paidOut: CurrencyMap;
  converted: CurrencyMap;
  balance: CurrencyMap;
};

const emptyMerchantAgg = (): MerchantAggregate => ({
  incoming: new CurrencyMap(),
  outgoing: new CurrencyMap(),
  collected: new CurrencyMap(),
  paidOut: new CurrencyMap(),
  converted: new CurrencyMap(),
  balance: new CurrencyMap(),
});

/** يجمع تجميعة تاجر إلى تجميعة إجمالية (كل عملة على حدة، لا خلط). */
function accumulateMerchantAgg(target: MerchantAggregate, src: MerchantAggregate): void {
  target.incoming.merge(src.incoming);
  target.outgoing.merge(src.outgoing);
  target.collected.merge(src.collected);
  target.paidOut.merge(src.paidOut);
  target.converted.merge(src.converted);
  target.balance.merge(src.balance);
}

/**
 * يبني حركات كشف حساب تاجر واحد بنفس المنطق المستخدم في
 * `MerchantStatementTab`. مصدر واحد لكل الإجماليات والكشف — أي رقم في
 * كارت "إجمالي تجار الكاش" = مجموع نفس القيمة عبر كل التجار تعريفياً.
 */
export type MerchantMovementRow = {
  id: string;
  date: string;
  createdAt: string;
  type:
    | "وارد من وكيل" | "صادر لشركة" | "تحصيل نقدية من التاجر"
    | "صرف نقدية للتاجر" | "صرف نقدية لوكيل" | "تحويل لـ USD" | "رصيد سابق";
  statement: string;
  gross: number;
  commission: number;
  net: number;
  delta: number;
  currency: string;
  sourceTable: string;
  sourceId: string;
};

export function buildMerchantMovements(
  merchantId: string,
  input: {
    incomingTxns: Transaction[];
    outgoingTxns: CompanyTransaction[];
    cashMoveTxns: Transaction[];
    collections: MerchantCashCollection[];
    conversions: UsdTreasuryTransaction[];
    /**
     * payment_splits — يُستخدَم فقط لاستخراج عملة تحصيلات تاجر الكاش العادية
     * (`merchant_cash_collections` لا يحتوي عمود currency لسجلات التحصيل).
     * لا يُجمَع كمبلغ إضافي على الإطلاق.
     */
    splits?: readonly CollectionSplitRow[] | null;
  },
): MerchantMovementRow[] {
  if (!merchantId) return [];
  const { incomingTxns, outgoingTxns, cashMoveTxns, collections, conversions, splits } = input;
  const collectionCurrencyById = buildCollectionCurrencyMap(splits);
  const list: MerchantMovementRow[] = [];
  for (const t of incomingTxns) {
    if (t.merchant_id !== merchantId) continue;
    if ((t as any).cancelled_at) continue;
    const gross = merchantCashGross(t) + Number(t.merchant_cash_physical_amount || 0);
    const net = merchantCashNet(t) + Number(t.merchant_cash_physical_amount || 0);
    const cur = normalizeCurrency((t as any).payment_currency || (t as any).currency || "EGP");
    list.push({
      id: `in-${t.id}`, date: t.date, createdAt: (t as any).created_at || "", type: "وارد من وكيل",
      statement: String((t as any).statement || "").trim(),
      gross, commission: gross - net, net, delta: net, currency: cur,
      sourceTable: "transactions", sourceId: t.id,
    });
  }
  for (const t of outgoingTxns) {
    if ((t as any).merchant_id !== merchantId) continue;
    if ((t as any).cancelled_at) continue;
    const gross = merchantCompanyOutflowAmount(t);
    const net = merchantCompanyOutflowAmount(t);
    const cur = normalizeCurrency((t as any).payment_currency || (t as any).currency || "EGP");
    list.push({
      id: `out-${t.id}`, date: t.date, createdAt: (t as any).created_at || "", type: "صادر لشركة",
      statement: String((t as any).statement || "").trim(),
      gross, commission: gross - net, net, delta: -net, currency: cur,
      sourceTable: "company_transactions", sourceId: t.id,
    });
  }
  for (const c of collections) {
    if (c.merchant_id !== merchantId) continue;
    if ((c as any).cancelled_at) continue;
    const amt = Number(c.amount || 0);
    const isOpening = ((c as any).source_service_type === "opening_debit" || (c as any).source_service_type === "opening_credit");
    // ترتيب حسم عملة الحركة:
    //   1) opening_currency للسجلات الافتتاحية (المصدر الوحيد الصحيح).
    //   2) payment_splits.currency للتحصيلات العادية (المصدر الحقيقي — الخزنة المختارة).
    //   3) fallback EGP للسجلات القديمة السابقة لدعم فصل العملات.
    const fromSplits = !isOpening ? collectionCurrencyById.get(c.id) : undefined;
    const rowCurrency = normalizeCurrency(
      isOpening ? (c as any).opening_currency : (fromSplits ?? (c as any).currency),
    );
    list.push({
      id: `col-${c.id}`, date: c.date, createdAt: (c as any).created_at || "",
      type: isOpening ? "رصيد سابق" : "تحصيل نقدية من التاجر",
      statement: isOpening ? `رصيد سابق (${rowCurrency})` : String((c as any).statement || "").trim(),
      gross: Math.abs(amt), commission: 0, net: Math.abs(amt), delta: -amt, currency: rowCurrency,
      sourceTable: "merchant_cash_collections", sourceId: c.id,
    });
  }
  for (const t of cashMoveTxns) {
    if (t.merchant_id !== merchantId) continue;
    if ((t as any).cancelled_at) continue;
    const amt = Math.abs(Number(t.paid || 0));
    if (amt <= 0) continue;
    const cur = normalizeCurrency((t as any).payment_currency || (t as any).currency || "EGP");
    const toCompany = t.source_service_type === "merchant_cash_out_to_company";
    const toAgent = t.source_service_type === "merchant_cash_out_to_agent";
    const type: MerchantMovementRow["type"] = toCompany ? "صادر لشركة" : toAgent ? "صرف نقدية لوكيل" : "صرف نقدية للتاجر";
    const delta = (toCompany || toAgent) ? -amt : amt;
    list.push({
      id: `cashout-${t.id}`, date: t.date, createdAt: (t as any).created_at || "", type,
      statement: String((t as any).statement || "").trim(),
      gross: amt, commission: 0, net: amt, delta, currency: cur,
      sourceTable: "transactions", sourceId: t.id,
    });
  }
  for (const r of conversions) {
    if (r.type !== "conversion" || (r as any).merchant_id !== merchantId) continue;
    if ((r as any).cancelled_at) continue;
    if (r.source_type !== "merchant_wallet" && r.source_type !== "merchant_physical") continue;
    const amt = Number((r as any).egp_amount || 0);
    list.push({
      id: `conv-${r.id}`, date: r.date, createdAt: (r as any).created_at || "", type: "تحويل لـ USD",
      statement: String((r as any).statement || "").trim(),
      gross: amt, commission: 0, net: amt, delta: -amt, currency: "EGP",
      sourceTable: "usd_treasury_transactions", sourceId: r.id,
    });
  }
  return list.sort((a, b) =>
    (a.date < b.date ? -1 : a.date > b.date ? 1 : 0) ||
    a.createdAt.localeCompare(b.createdAt) ||
    a.id.localeCompare(b.id),
  );
}

function buildMerchantMovementInputs(
  txns: Transaction[],
  companyTxns: CompanyTransaction[],
  collections: MerchantCashCollection[],
  usdRows: UsdTreasuryTransaction[],
  splits?: readonly CollectionSplitRow[] | null,
): Parameters<typeof buildMerchantMovements>[1] {
  const incomingTxns = txns.filter((t) =>
    Number(t.merchant_cash_amount || 0) > 0 || Number(t.merchant_cash_physical_amount || 0) > 0,
  );
  const outgoingAll = companyTxns.filter((t) => merchantCompanyOutflowAmount(t) > 0);
  const mirrorSourceIds = new Set<string>();
  for (const t of txns) {
    if (t.merchant_id && t.source_service_type === "merchant_cash_out_to_company") {
      const src = (t as any).source_service_id;
      if (src) mirrorSourceIds.add(src);
    }
  }
  const outgoingTxns = outgoingAll.filter((t) => !mirrorSourceIds.has(t.id));
  const cashMoveTxns = txns.filter((t) => t.merchant_id && (
    t.source_service_type === "merchant_cash_out" ||
    t.source_service_type === "merchant_cash_out_to_company" ||
    t.source_service_type === "merchant_cash_out_to_agent"
  ));
  return { incomingTxns, outgoingTxns, cashMoveTxns, collections, conversions: usdRows, splits: splits ?? null };
}

function summarizeMerchantMovementsAsEntity(rows: MerchantMovementRow[]): EntitySummary {
  const s = empty();
  s.count = rows.length;
  for (const r of rows) {
    const cur = r.currency || "EGP";
    if (r.delta >= 0) s.totalDebit.add(cur, r.delta);
    else s.totalCredit.add(cur, -r.delta);
    s.balance.add(cur, r.delta);
  }
  return s;
}

export function computeMerchantAggregates(input: {
  txns: Transaction[];
  companyTxns: CompanyTransaction[];
  collections: MerchantCashCollection[];
  usdRows: UsdTreasuryTransaction[];
  splits?: readonly CollectionSplitRow[] | null;
}): Map<string, MerchantAggregate> {
  const { txns, companyTxns, collections, usdRows, splits } = input;
  // Partition inputs EXACTLY like MerchantStatementTab does — نفس المصدر.
  const movementInput = buildMerchantMovementInputs(txns, companyTxns, collections, usdRows, splits);

  const merchantIds = new Set<string>();
  for (const t of txns) if (t.merchant_id) merchantIds.add(t.merchant_id);
  for (const t of companyTxns as any[]) if (t.merchant_id) merchantIds.add(t.merchant_id);
  for (const c of collections) if (c.merchant_id) merchantIds.add(c.merchant_id);
  for (const r of usdRows as any[]) if ((r as any).merchant_id) merchantIds.add((r as any).merchant_id);

  const map = new Map<string, MerchantAggregate>();
  for (const mid of merchantIds) {
    const movs = buildMerchantMovements(mid, movementInput);
    const totals = summarizeMerchantMovementTotals(movs);
    map.set(mid, {
      incoming: totals.totalIncoming,
      outgoing: totals.totalOutgoing,
      collected: totals.totalCollected,
      paidOut: totals.totalPaidOut,
      converted: totals.totalConverted,
      balance: totals.balance,
    });
  }
  return map;
}

/** Hook حي لتجميعات كل التجار (لكل تاجر: CurrencyMap لكل حقل). */
export function useMerchantAggregates(): Map<string, MerchantAggregate> {
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: companyTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");
  const { rows: usdRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  const { rows: splits } = useLive<CollectionSplitRow>("payment_splits");
  return useMemo(
    () => computeMerchantAggregates({ txns, companyTxns, collections, usdRows, splits }),
    [txns, companyTxns, collections, usdRows, splits],
  );
}

/**
 * المجموع الكلي عبر كل التجار — كل حقل CurrencyMap (لا خلط بين العملات).
 * الكروت تعرض سطراً لكل عملة عبر `formatCurrencyLines()`.
 */
export function useMerchantTotals(): MerchantAggregate {
  const per = useMerchantAggregates();
  return useMemo(() => {
    const t = emptyMerchantAgg();
    for (const v of per.values()) accumulateMerchantAgg(t, v);
    return t;
  }, [per]);
}


/* ============================================================
 *  ENTITY-BALANCE AGGREGATES — إجماليات "مجموع الأرصدة الحالية"
 * ============================================================
 *  الكروت في صفحات (الوكلاء / الشركات / التجار) يجب أن تعرض
 *  **مجموع الرصيد النهائي لكل جهة**، مُقسَّماً حسب العملة —
 *  وليس مجموع المبيعات أو المدفوعات أو الحركات.
 *
 *  المعادلة الحسابية: sum(entity.balance[cur]) = sum(entity.debit[cur]) − sum(entity.credit[cur]).
 *  الفارق الحرج: كل عملة تُجمع بشكل مستقل — لا يُخلط EGP + USD + LYD.
 * ============================================================ */

/** شكل بطاقة العملة المُستخدَم في CurrencyTotalsCards. */
export type CurrencyBalanceTotal = {
  currency: string;
  debit: number;
  credit: number;
  net: number;
};

/** يُجمِّع Map<id, EntitySummary> إلى إجمالي واحد لكل عملة (debit/credit/net). */
export function aggregateSummariesByCurrency(
  map: Map<string, EntitySummary>,
): CurrencyBalanceTotal[] {
  const debit = new CurrencyMap();
  const credit = new CurrencyMap();
  const net = new CurrencyMap();
  for (const s of map.values()) {
    for (const { currency, amount } of s.totalDebit.entries({ includeZero: true })) debit.add(currency, amount);
    for (const { currency, amount } of s.totalCredit.entries({ includeZero: true })) credit.add(currency, amount);
    for (const { currency, amount } of s.balance.entries({ includeZero: true })) net.add(currency, amount);
  }
  const currencies = new Set<string>();
  for (const { currency } of debit.entries()) currencies.add(currency);
  for (const { currency } of credit.entries()) currencies.add(currency);
  for (const { currency } of net.entries()) currencies.add(currency);
  const ordered = [
    ...CURRENCY_ORDER.filter((c) => currencies.has(c)),
    ...[...currencies].filter((c) => !CURRENCY_ORDER.includes(c)).sort(),
  ];
  return ordered.map((c) => ({
    currency: c,
    debit: debit.get(c),
    credit: credit.get(c),
    net: net.get(c),
  }));
}

/** Hook حي: إجمالي رصيد جميع الوكلاء بالعملة. */
export function useAgentsBalanceByCurrency(): CurrencyBalanceTotal[] {
  const map = useAgentsSummary();
  return useMemo(() => aggregateSummariesByCurrency(map), [map]);
}

/** Hook حي: إجمالي رصيد جميع الشركات بالعملة. */
export function useCompaniesBalanceByCurrency(): CurrencyBalanceTotal[] {
  const map = useCompaniesSummary();
  return useMemo(() => aggregateSummariesByCurrency(map), [map]);
}

/** Hook حي: إجمالي رصيد جميع التجار بالعملة. */
export function useMerchantsBalanceByCurrency(): CurrencyBalanceTotal[] {
  const map = useMerchantsSummary();
  return useMemo(() => aggregateSummariesByCurrency(map), [map]);
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
  cancelled_at?: string | null;
};

/**
 * Single Source of Truth: يستبعد الحركات الملغاة **مرة واحدة فقط** هنا،
 * ويُرتّبها ترتيباً حتمياً بتاريخ الحركة (`tx_date`) ثم `created_at` ثم `id`.
 * كل مُستهلك (الكشف، الرصيد الجاري، الإجماليات، تقرير شراء/بيع العملات)
 * يجب أن يُمرّر صفوفه عبر هذه الدالة أولاً — بحيث يستحيل معمارياً أن
 * تظهر حركة ملغاة في أي شاشة، أو أن يختلف ترتيب الكشف عن ترتيب الرصيد الجاري.
 */
export function buildCurrencySupplierLedgerRows<T extends CurrencySupplierTx>(rows: ReadonlyArray<T>): T[] {
  const arr: T[] = Array.isArray(rows) ? (rows as T[]) : [];
  return arr
    .filter((t) => !(t as any).cancelled_at)
    .slice()
    .sort((a, b) =>
      ((a as any).tx_date || "").localeCompare((b as any).tx_date || "") ||
      ((a as any).created_at || "").localeCompare((b as any).created_at || "") ||
      ((a as any).id || "").localeCompare((b as any).id || ""),
    );
}

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
  for (const t of buildCurrencySupplierLedgerRows(rows)) {
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
  // نحافظ على تطابق الطول مع المدخل (بعض المُستدعين يعتمدون على ذلك)،
  // لكن نتجاهل تأثير الحركات الملغاة على الرصيد الجاري.
  const bals = new Map<string, number>();
  return rows.map((t) => {
    const { currency, delta } = currencySupplierDelta(t);
    const effective = (t as any).cancelled_at ? 0 : delta;
    const next = (bals.get(currency) || 0) + effective;
    bals.set(currency, next);
    return { ...t, balance: next, balanceCurrency: currency };
  });
}

/** ملخص "صافي بالعملة" — يُستخدم في التصدير. */
export function summarizeCurrencySupplierNetByCurrency(
  rows: CurrencySupplierTx[],
): Array<{ currency: string; net: number }> {
  const map = new Map<string, number>();
  for (const t of buildCurrencySupplierLedgerRows(rows)) {
    map.set(t.bought_currency, (map.get(t.bought_currency) || 0) + Number(t.bought_amount || 0));
    map.set(t.sold_currency, (map.get(t.sold_currency) || 0) - Number(t.sold_amount || 0));
  }
  return Array.from(map.entries()).map(([currency, net]) => ({ currency, net }));
}

/**
 * ملخص حركات شراء/بيع العملات لتقرير `/reports` (تبويب "شراء وبيع العملات").
 *  - buyCount / sellCount = عدد الحركات لكل نوع
 *  - boughtByCurrency     = إجمالي المشترى مُجمَّعاً بالعملة
 *  - soldByCurrency       = إجمالي المباع مُجمَّعاً بالعملة
 * تُغلَّف بـ CurrencyMap للحفاظ على ترتيب EGP → USD → LYD → أبجدي.
 */
export type CurrencySupplierTradesSummary = {
  buyCount: number;
  sellCount: number;
  boughtByCurrency: CurrencyMap;
  soldByCurrency: CurrencyMap;
};

export function summarizeCurrencySupplierTrades(
  rows: ReadonlyArray<{
    tx_type?: string | null;
    bought_currency?: string | null;
    bought_amount?: number | string | null;
    sold_currency?: string | null;
    sold_amount?: number | string | null;
    cancelled_at?: string | null;
  }>,
): CurrencySupplierTradesSummary {
  const s: CurrencySupplierTradesSummary = {
    buyCount: 0,
    sellCount: 0,
    boughtByCurrency: new CurrencyMap(),
    soldByCurrency: new CurrencyMap(),
  };
  for (const t of rows) {
    if ((t as any).cancelled_at) continue; // نفس مصدر buildCurrencySupplierLedgerRows
    if (t.tx_type === "شراء عملة") s.buyCount += 1;
    else if (t.tx_type === "بيع عملة") s.sellCount += 1;
    s.boughtByCurrency.add(t.bought_currency ?? null, Number(t.bought_amount || 0));
    s.soldByCurrency.add(t.sold_currency ?? null, Number(t.sold_amount || 0));
  }
  return s;
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
 *  DASHBOARD LIFETIME — إجماليات مدى الحياة (EGP، pass واحدة لكل جدول)
 * ============================================================
 *  يوحّد الحلقات اليدوية في `src/routes/index.tsx` (memo `lifetime`).
 *  يعتمد على نفس الدوال المشتركة (`tripValue`, `txnTotalPaid`,
 *  `txnCollectedAmount`, `merchantCashNet`, `merchantCashGross`) —
 *  لا يغيّر أي رقم عن السابق.
 * ============================================================ */

export type DashboardLifetimeTotals = {
  agentsFlightsValue: number;
  agentsApprovalsValue: number;
  agentsOtherValue: number;
  agentsTripValue: number;
  agentsPaid: number;
  agentsDue: number;
  agentCollectionsNet: number;
  /** تحصيلات الوكلاء مفصّلة حسب العملة (currency-safe). */
  agentCollectionsNetByCurrency: CurrencyMap;
  merchantIncomingNet: number;
  merchantIncomingGross: number;
  merchantFee: number;
  companyServices: number;
  companyOutgoingNet: number;
  companyPaid: number;
  companyDue: number;
  merchantOutgoing: number;
  merchantCollected: number;
  /** تحصيلات تجار الكاش مفصّلة حسب العملة (currency-safe). */
  merchantCollectedByCurrency: CurrencyMap;
  merchantBalance: number;
};

export function computeDashboardLifetime(input: {
  txns: Transaction[];
  cTxns: CompanyTransaction[];
  collections: MerchantCashCollection[];
  splits?: readonly import("@/lib/dashboardCollections").CollectionSplitRow[] | null;
}): DashboardLifetimeTotals {
  const { txns, cTxns, collections, splits } = input;
  // NOTE: قيم الخدمات (tripValue) والوارد للتاجر (merchantCashNet/Gross)
  // تُحسَب على كل صفوف transactions بلا استبعاد للملغاة — هذا هو السلوك
  // التاريخي لبقية الكروت (مبيعات/رصيد التجار)، ولا يتغير هنا.
  let agentsFlightsValue = 0, agentsApprovalsValue = 0, agentsOtherValue = 0;
  let merchantIncomingNet = 0, merchantIncomingGross = 0;
  for (const t of txns) {
    const v = tripValue(t as any);
    if ((t as any).service_type === "تذاكر طيران") agentsFlightsValue += v;
    else if ((t as any).service_type === "موافقة أمنية") agentsApprovalsValue += v;
    else agentsOtherValue += v;
    merchantIncomingNet += merchantCashNet(t);
    merchantIncomingGross += merchantCashGross(t);
  }
  // ✅ تحصيلات الوكلاء = المدفوعات (كارت واحد مشترك)، من الدالة المشتركة
  //    (تستبعد الحركات الملغاة، مصدر أصل واحد لكلا الكارتين).
  const agentCollectionsNet = computeAgentCollections(txns);
  const agentCollectionsNetByCurrency = computeAgentCollectionsByCurrency(txns);
  const agentsPaid = agentCollectionsNet;
  const agentsTripValue = agentsFlightsValue + agentsApprovalsValue + agentsOtherValue;
  const agentsDue = agentsTripValue - agentsPaid;

  let companyServices = 0, companyOutgoingNet = 0, merchantOutgoing = 0;
  for (const t of cTxns) {
    companyServices +=
      Number((t as any).trip_value || 0) ||
      Number((t as any).count || 0) * Number((t as any).price || 0);
    companyOutgoingNet += txnCollectedAmount(t);
    merchantOutgoing += Number((t as any).merchant_cash_amount || 0);
  }
  const companyPaid = companyOutgoingNet;
  const companyDue = companyServices - companyPaid;

  // ✅ تحصيلات تجار الكاش من الدالة المشتركة (تستبعد الملغاة، dedupe بالـ id).
  const merchantCollected = computeMerchantCashCollections(collections);
  const merchantCollectedByCurrency = computeMerchantCashCollectionsByCurrency(collections, undefined, splits);
  const merchantBalance = merchantIncomingNet - merchantOutgoing - merchantCollected;
  const merchantFee = merchantIncomingGross - merchantIncomingNet;

  return {
    agentsFlightsValue, agentsApprovalsValue, agentsOtherValue, agentsTripValue,
    agentsPaid, agentsDue, agentCollectionsNet, agentCollectionsNetByCurrency,
    merchantIncomingNet, merchantIncomingGross, merchantFee,
    companyServices, companyOutgoingNet, companyPaid, companyDue,
    merchantOutgoing, merchantCollected, merchantCollectedByCurrency, merchantBalance,
  };
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
 *  LEDGER ROW BUILDERS — بناء صفوف كشوف الحساب (وكيل/شركة)
 * ============================================================
 *  يوحّد المنطق المكرَّر بين `AgentLedger` و `CompanyStatementTab`.
 *  المخرج نفس الشكل الذي يستهلكه العرض والتصدير — بدون تغيير أي رقم.
 * ============================================================ */

export type LedgerRowKind = "service" | "payment";

export type LedgerRow<TRaw> = {
  id: string;
  date: string;
  kind: LedgerRowKind;
  description: string;
  destination: string;
  service: string;
  count: number;
  price: number;
  serviceValue: number;
  payment: number;
  debit: number;
  credit: number;
  paymentMethod: string;
  note: string;
  currency: string;
  raw: TRaw;
};

function classifyAgentTxn(t: Transaction): LedgerRowKind {
  if ((t as any).source_service_type === "payment") return "payment";
  return Number(t.count || 0) * Number(t.price || 0) > 0 ? "service" : "payment";
}

/**
 * صفوف كشف حساب الوكيل — تُبنى من `transactions` الخاصة به.
 * تستبعد الحركات الملغاة، وتُرتَّب بالتاريخ ثم `created_at`.
 */
export function buildAgentLedgerRows(
  txns: Transaction[],
  splitCurrencyByTxnId: Map<string, string>,
): LedgerRow<Transaction>[] {
  const safe = Array.isArray(txns) ? txns.filter((t) => Boolean(t) && !(t as any).cancelled_at) : [];
  return [...safe]
    .sort((a, b) =>
      (a.date || "").localeCompare(b.date || "") ||
      (a.created_at || "").localeCompare(b.created_at || "") ||
      (a.id || "").localeCompare(b.id || ""),
    )
    .map((t) => {
      const kind = classifyAgentTxn(t);
      const serviceValue = tripValue(t as any);
      const payment = txnTotalPaid(t);
      const isPayment = kind === "payment";
      const credit = isPayment ? (payment || serviceValue) : payment;
      const description = String((t as any).statement || "").trim();
      return {
        id: t.id || `${t.created_at || "row"}-${t.agent_id || "agent"}`,
        date: t.date || "",
        kind,
        description,
        destination: t.destination || "—",
        service: t.service_type || "—",
        count: Number(t.count || 0),
        price: Number(t.price || 0),
        serviceValue,
        payment: credit,
        debit: isPayment ? 0 : serviceValue,
        credit,
        paymentMethod: credit > 0 ? paymentMethodLabel(t) : "—",
        note: t.note || "—",
        currency: String(splitCurrencyByTxnId.get(t.id) || (t as any).currency || "EGP"),
        raw: t,
      };
    });
}

/**
 * صفوف كشف حساب الشركة الصادرة — تُبنى من `company_transactions`.
 * تُرتَّب داخلياً حسب تاريخ الحركة (date) ثم created_at ثم id — نفس قاعدة
 * الوكيل — لضمان أن العمود المعروض والترتيب يعتمدان على التاريخ الذي
 * أدخله المستخدم في النموذج، لا على وقت إنشاء السجل.
 */
export function buildCompanyLedgerRows(
  txns: CompanyTransaction[],
  splitCurrencyByTxnId: Map<string, string>,
): LedgerRow<CompanyTransaction>[] {
  // Single Source of Truth: يتم استبعاد الحركات الملغاة هنا (وليس في المُستدعي)،
  // فتتطابق تلقائياً الكروت + قائمة الشركات + كشف الحساب + التقارير + الداشبورد،
  // مهما اختلفت العملة أو نوع الحركة. أي مُستدعٍ يحتاج الحركات الملغاة يجب أن
  // يعالجها في مسار منفصل صراحةً، لا هنا.
  const active = (Array.isArray(txns) ? txns : [])
    .filter((t) => !(t as any).cancelled_at)
    .slice()
    .sort((a, b) =>
      ((a as any).date || "").localeCompare((b as any).date || "") ||
      ((a as any).created_at || "").localeCompare((b as any).created_at || "") ||
      ((a as any).id || "").localeCompare((b as any).id || ""),
    );
  return active.map((t) => {
    const serviceValue = Math.round(Number((t as any).trip_value || 0));
    const payment = Math.round(Number((t as any).total_paid || 0));
    const kind: LedgerRowKind = serviceValue > 0 ? "service" : "payment";
    const description = String((t as any).statement || "").trim();
    return {
      id: t.id || `${t.created_at || "row"}-${(t as any).company_id || "company"}`,
      date: t.date || "",
      kind,
      description,
      destination: (t as any).destination || "—",
      service: (t as any).service_type || "—",
      count: Number((t as any).count || 0),
      price: Number((t as any).price || 0),
      serviceValue,
      payment,
      debit: serviceValue,
      credit: payment,
      paymentMethod: payment > 0 ? paymentMethodLabel(t) : "—",
      note: (t as any).note || "—",
      currency: String(splitCurrencyByTxnId.get(t.id) || (t as any).currency || "EGP"),
      raw: t,
    };
  });
}


/* ============================================================
 *  Formatting helper — لعرض قيمة مع عملتها.
 * ============================================================ */

export function formatCurrencyAmount(amount: number, currency: Currency): string {
  // المصدر الموحد لعرض العملات: fmtCurrency من db.ts (ج.م / $ / د.ل).
  // لا نعرض رموز ISO (EGP/USD/LYD) للمستخدم النهائي.
  return fmtCurrency(Number(amount) || 0, currency);
}

/** يُرجع قائمة أسطر جاهزة للعرض داخل كارت (EGP → USD → LYD، بدون العملات الصفرية). */
export function formatCurrencyLines(map: CurrencyMap): string[] {
  return map.entries().map(({ currency, amount }) => formatCurrencyAmount(amount, currency));
}

/**
 * صياغة CurrencyMap كسطر واحد قابل للعرض داخل كارت أو خلية جدول:
 *   "1,000 ج.م · 500 $ · 2,000 د.ل"
 * إذا كانت الخريطة فارغة يُعاد `"0 ج.م"` (سلوك افتراضي متوافق مع الكروت السابقة).
 * لا تُدمج العملات أبداً — كل سطر مستقل بعملته الأصلية.
 */
export function formatCurrencyMap(
  map: CurrencyMap,
  opts: { separator?: string; emptyLabel?: string } = {},
): string {
  const sep = opts.separator ?? " · ";
  const entries = map.entries();
  if (entries.length === 0) return opts.emptyLabel ?? "0 ج.م";
  return entries
    .map(({ currency, amount }) => {
      // نستخدم fmtCurrency من db.ts (يعرف الرموز العربية: ج.م / $ / د.ل)
      // بدل الرمز اللاتيني، لتطابق العرض السابق للكروت.
      const rounded = Math.round((Number(amount) || 0) * 100) / 100;
      const n = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 0 }).format(rounded);
      const sym = currency === "EGP" ? "ج.م" : currency === "USD" ? "$" : currency === "LYD" ? "د.ل" : currency;
      return `${n} ${sym}`;
    })
    .join(sep);
}


/* ============================================================
 *  Treasury (cash_boxes + latest exchange rates)
 *  مصدر واحد للحساب المستخدم في Dashboard و Reports.
 * ============================================================ */

export type CashBoxLike = {
  currency: string;
  balance: number | string | null;
  is_active?: boolean;
};

export type RateTx = {
  id?: string | null;
  tx_type?: string | null;
  bought_currency?: string | null;
  exchange_rate?: number | string | null;
  tx_date?: string | null;
  created_at?: string | null;
  supplier_id?: string | null;
};

/** أسماء العملات كما تُخزَّن في حركات مورد العملة (aliases → code). */
const RATE_CURRENCY_ALIASES: Record<string, string[]> = {
  USD: ["دولار", "دولار أمريكي", "USD", "$"],
  LYD: ["دينار ليبي", "دينار", "LYD"],
};

/**
 * الفلتر الوحيد للخزائن النشطة — أي شاشة تريد قائمة الخزائن
 * (للجدول أو للـ dropdown) يجب أن تمر عبر هذا الـ helper بدلاً
 * من تكرار `is_active !== false` في مكانها.
 */
export function activeCashBoxes<T extends CashBoxLike>(boxes: T[]): T[] {
  return (boxes || []).filter((b) => b.is_active !== false);
}

/** مجموع أرصدة الخزائن النشطة لكل عملة. */
export function sumCashBoxesByCurrency(boxes: CashBoxLike[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const b of activeCashBoxes(boxes)) {
    const cur = (b.currency || "").toString().trim().toUpperCase() || EGP_CODE_;
    out[cur] = (out[cur] || 0) + (Number(b.balance) || 0);
  }
  return out;
}

export type LatestRateInfo = {
  rate: number;
  date: string | null;
  id: string | null;
  txType: string | null;
  supplierId: string | null;
};

/** آخر سعر صرف مسجَّل لعملية شراء عملة معيَّنة (بالكود مثل USD/LYD). */
export function latestPurchaseRate(txns: RateTx[], code: string): LatestRateInfo {
  const aliases = RATE_CURRENCY_ALIASES[code] || [code];
  const rows = (txns || [])
    .filter((t) => {
      const bc = (t.bought_currency || "").toString().trim();
      const isPurchase = (t.tx_type || "").toString().trim() === "شراء عملة";
      return isPurchase && aliases.some((a) => bc === a) && Number(t.exchange_rate || 0) > 0;
    })
    .sort((a, b) =>
      new Date(b.tx_date || b.created_at || "").getTime() -
      new Date(a.tx_date || a.created_at || "").getTime(),
    );
  const row = rows[0];
  return {
    rate: row ? Number(row.exchange_rate || 0) : 0,
    date: row?.tx_date || null,
    id: row?.id || null,
    txType: row?.tx_type || null,
    supplierId: row?.supplier_id || null,
  };
}

export type TreasurySummary = {
  egp: number;
  usd: number;
  lyd: number;
  byCurrency: Record<string, number>;
  usdRate: number;
  lydRate: number;
  totalEgp: number;
  usdInfo: LatestRateInfo;
  lydInfo: LatestRateInfo;
};

/**
 * ملخص الخزائن: أرصدة كل عملة + آخر أسعار شراء + الإجمالي بالجنيه.
 * تُستخدم في Dashboard وتقرير الخزائن — لا يُكرَّر المنطق في أي مكان آخر.
 */
export function computeTreasurySummary(
  boxes: CashBoxLike[],
  currencyTxns: RateTx[],
): TreasurySummary {
  const byCurrency = sumCashBoxesByCurrency(boxes);
  const egp = byCurrency[EGP_CODE_] || 0;
  const usd = byCurrency.USD || 0;
  const lyd = byCurrency.LYD || 0;
  const usdInfo = latestPurchaseRate(currencyTxns, "USD");
  const lydInfo = latestPurchaseRate(currencyTxns, "LYD");
  const usdRate = usdInfo.rate;
  const lydRate = lydInfo.rate;
  const totalEgp = egp + usd * usdRate + lyd * lydRate;
  return { egp, usd, lyd, byCurrency, usdRate, lydRate, totalEgp, usdInfo, lydInfo };
}

/* ============================================================
 *  Ledger helpers — عناصر مشتركة بين كشف الوكيل وكشف الشركة.
 * ============================================================ */

type SplitCurrencyRow = {
  source_table: string | null;
  source_id: string | null;
  transaction_id?: string | null;
  currency: string | null;
};

/**
 * يبني خريطة txn.id → currency من `payment_splits`، فقط عندما تكون كل
 * الـ splits لنفس الحركة بعملة واحدة (وإلا نتجنّب افتراض عملة خاطئة).
 * تُستخدم في كشوف الوكلاء والشركات لتحديد عملة كل صف.
 */
export function resolveSplitCurrencyByRef(
  splits: readonly SplitCurrencyRow[] | null | undefined,
  sourceTable: string,
): Map<string, string> {
  const buckets = new Map<string, Set<string>>();
  for (const s of splits || []) {
    if (s.source_table !== sourceTable) continue;
    const id = s.source_id || s.transaction_id;
    if (!id || !s.currency) continue;
    const set = buckets.get(id) || new Set<string>();
    set.add(s.currency);
    buckets.set(id, set);
  }
  const result = new Map<string, string>();
  buckets.forEach((set, id) => {
    if (set.size === 1) result.set(id, Array.from(set)[0]);
  });
  return result;
}

/**
 * وسم وسيلة الدفع لصف حركة (وكيل أو شركة) بناءً على المبالغ الفعلية.
 * يجمع الوسائل المستخدمة بالفعل بفاصل " + "، أو "—" إن لم توجد أي دفعة.
 */
export function paymentMethodLabel(t: {
  instapay_amount?: number | string | null;
  cash_amount?: number | string | null;
  merchant_cash_amount?: number | string | null;
  merchant_cash_physical_amount?: number | string | null;
  payment_method?: string | null;
}): string {
  const parts: string[] = [];
  if (Number(t.instapay_amount || 0) > 0) parts.push("إنستاباي");
  if (Number(t.cash_amount || 0) > 0) parts.push("نقدي");
  if (Number(t.merchant_cash_amount || 0) > 0) parts.push("تاجر محفظة");
  if (Number(t.merchant_cash_physical_amount || 0) > 0) parts.push("تاجر نقدي");
  return parts.length ? parts.join(" + ") : (t.payment_method || "—");
}

/* ============================================================
 *  MERCHANT MOVEMENTS — الدالة القديمة `summarizeMerchantMovements`
 *  تم حذفها لأنها كانت تجمع القيم عبر العملات (EGP+USD+LYD → رقم واحد).
 *  الاستبدال: `summarizeMerchantReport` / `buildMerchantMovements` +
 *  `summarizeMerchantMovementTotals` — كل حقل CurrencyMap مستقل بالعملة.
 * ============================================================ */


/* ============================================================
 *  TOP AGENTS — ترتيب الوكلاء حسب المحصَّل
 *  (Dashboard — مصدر واحد لحساب أفضل الوكلاء).
 * ============================================================ */

export type TopAgentRow = { id: string; name: string; collected: number; count: number };

export function computeTopAgentsByCollected(
  txns: Transaction[],
  agents: Pick<Agent, "id" | "name">[],
  limit = 5,
): TopAgentRow[] {
  const byAgent = new Map<string, { collected: number; count: number }>();
  for (const t of txns) {
    if (!t.agent_id) continue;
    const cur = byAgent.get(t.agent_id) || { collected: 0, count: 0 };
    cur.collected +=
      Number(t.instapay_amount || 0) +
      Number(t.cash_amount || 0) +
      merchantCashNet(t) +
      Number(t.merchant_cash_physical_amount || 0);
    cur.count += 1;
    byAgent.set(t.agent_id, cur);
  }
  const nameOf = new Map(agents.map((a) => [a.id, a.name]));
  return Array.from(byAgent.entries())
    .map(([id, v]) => ({ id, name: nameOf.get(id) || "—", ...v }))
    .sort((a, b) => b.collected - a.collected)
    .slice(0, limit);
}

/* ============================================================
 *  PERIOD REPORTS — تلخيصات فترة زمنية للتقارير (Reports page)
 *  كل الحسابات المالية للتقارير تُنفَّذ هنا؛ الصفحة تعرض فقط.
 * ============================================================ */

type InRange = (d: string | null | undefined) => boolean;

/** تقرير الوكلاء لفترة. */
export type AgentReportRow = {
  name: string;
  total: number;
  paid: number;
  due: number;
  /** عدد التنفيذات (executions) المميّزة للوكيل بحالة "منفذ" داخل الفترة. */
  flights: number;
  /** عدد التقديمات (submissions) للوكيل داخل الفترة. */
  approvals: number;
};
export type AgentReportSummary = {
  rows: AgentReportRow[];
  totalCollections: number;
  /**
   * إجمالي قيمة خدمات الوكلاء بالجنيه — نفس معادلة كارت
   * "إجمالي مبيعات الوكلاء" في الداشبورد (computeExecutionSalesEGP).
   * يعتمد على executions ذات operation_status === "منفذ" وأسعار fx مثبتة.
   */
  totalValue: number;
  /** عدد التنفيذات المعلّقة بسبب عدم تثبيت fx (مستبعدة من totalValue). */
  pendingExecutions: number;
  flightsCount: number;
  approvalsCount: number;
  filteredTxns: Transaction[];
  filteredFlights: any[];
  filteredApprovals: any[];
};

export function summarizeAgentReport(input: {
  agents: Pick<Agent, "id" | "name">[];
  transactions: Transaction[];
  /** @deprecated الجدول القديم لم يعد يُستخدم — مرَّر executions بدلاً منه. */
  flights: any[];
  /** التنفيذات الحقيقية من جدول public.executions. */
  executions?: any[];
  approvals: any[];
  inRange: InRange;
  approvalDate?: (a: any) => string | null;
}): AgentReportSummary {
  const { agents, transactions, executions = [], approvals, inRange } = input;
  const approvalDate = input.approvalDate || ((a: any) =>
    (a.submit_date && String(a.submit_date)) ||
    (a.issue_date && String(a.issue_date)) ||
    (a.created_at ? String(a.created_at).slice(0, 10) : null));

  // Single-pass grouping by agent — no per-agent .filter().
  const byAgent = new Map<string, { total: number; paid: number; flights: number; approvals: number }>();
  const bump = (id: string | null | undefined) => {
    if (!id) return null;
    let v = byAgent.get(id);
    if (!v) { v = { total: 0, paid: 0, flights: 0, approvals: 0 }; byAgent.set(id, v); }
    return v;
  };
  let totalCollections = 0;
  const filteredTxns: Transaction[] = [];
  for (const t of transactions) {
    if ((t as any).cancelled_at) continue; // نفس مصدر buildAgentLedgerRows
    if (!inRange(t.date)) continue;
    filteredTxns.push(t);
    const v = tripValue(t as any);
    const p = txnTotalPaid(t);
    totalCollections += p;
    const agg = bump(t.agent_id as any);
    if (agg) { agg.total += v; agg.paid += p; }
  }

  // ─── التنفيذات: نفس منطق كارت الداشبورد "إجمالي مبيعات الوكلاء" ───
  // الفلاتر: operation_status === "منفذ" + داخل الفترة (travel_date أو created_at).
  // العدّ لكل وكيل: تنفيذ واحد لكل agent_id فريد (مجموعة موحّدة من
  // agent_id على مستوى التنفيذ + services[].agent_id للسجلات القديمة).
  const filteredExecutions: any[] = [];
  const execRowsForSales: ExecutionRow[] = [];
  for (const ex of executions) {
    if ((ex.operation_status || "") !== "منفذ") continue;
    const d = (ex.travel_date && String(ex.travel_date)) ||
      (ex.created_at ? String(ex.created_at).slice(0, 10) : null);
    if (!inRange(d)) continue;
    filteredExecutions.push(ex);
    execRowsForSales.push(ex as any);
    // اجمع كل الوكلاء المميّزين داخل التنفيذ الواحد لعدّه مرة واحدة لكل وكيل.
    const agentIds = new Set<string>();
    if (ex.agent_id) agentIds.add(String(ex.agent_id));
    const services = Array.isArray(ex.services) ? ex.services : [];
    for (const s of services) {
      const aid = s && (s.agent_id ?? s.agentId);
      if (aid) agentIds.add(String(aid));
    }
    for (const aid of agentIds) {
      const agg = bump(aid);
      if (agg) agg.flights += 1;
    }
  }
  const salesRes = computeExecutionSalesEGP(execRowsForSales);
  const totalValue = salesRes.salesEGP;
  const pendingExecutions = salesRes.pending;

  const filteredApprovals: any[] = [];
  for (const a of approvals) {
    const d = approvalDate(a);
    if (!inRange(d)) continue;
    filteredApprovals.push(a);
    const agg = bump((a as any).agent_id);
    if (agg) agg.approvals += 1;
  }
  const rows: AgentReportRow[] = agents.map((a) => {
    const v = byAgent.get(a.id) || { total: 0, paid: 0, flights: 0, approvals: 0 };
    return { name: a.name, total: v.total, paid: v.paid, due: v.total - v.paid, flights: v.flights, approvals: v.approvals };
  });
  return {
    rows, totalCollections, totalValue, pendingExecutions,
    flightsCount: filteredExecutions.length, approvalsCount: filteredApprovals.length,
    filteredTxns, filteredFlights: filteredExecutions, filteredApprovals,
  };
}

/** تقرير الشركات الصادرة لفترة. */
export type CompanyReportRow = { name: string; total: number; paid: number; due: number; count: number };
export type CompanyReportSummary = {
  rows: CompanyReportRow[];
  totalPaid: number;
  filteredTxns: CompanyTransaction[];
};

export function summarizeCompanyReport(input: {
  companies: IssuingCompany[];
  companyTransactions: CompanyTransaction[];
  approvals: any[];
  inRange: InRange;
}): CompanyReportSummary {
  const { companies, companyTransactions, approvals, inRange } = input;
  const byCo = new Map<string, { total: number; paid: number; count: number }>();
  const bump = (id: string | null | undefined) => {
    if (!id) return null;
    let v = byCo.get(id);
    if (!v) { v = { total: 0, paid: 0, count: 0 }; byCo.set(id, v); }
    return v;
  };
  let totalPaid = 0;
  const filteredTxns: CompanyTransaction[] = [];
  for (const t of companyTransactions) {
    if ((t as any).cancelled_at) continue; // نفس مصدر buildCompanyLedgerRows
    if (!inRange(t.date)) continue;
    filteredTxns.push(t);
    const val = Number((t as any).trip_value || 0) || Number((t as any).count || 0) * Number((t as any).price || 0);
    const paid = txnCollectedAmount(t);
    totalPaid += paid;
    const agg = bump(t.company_id as any);
    if (agg) { agg.total += val; agg.paid += paid; agg.count += 1; }
  }
  for (const a of approvals) {
    if (!inRange((a as any).submit_date)) continue;
    const agg = bump((a as any).approval_company_id);
    if (agg) agg.count += 1;
  }
  const rows: CompanyReportRow[] = companies.map((c) => {
    const v = byCo.get(c.id) || { total: 0, paid: 0, count: 0 };
    return { name: (c as any).company_name, total: v.total, paid: v.paid, due: v.total - v.paid, count: v.count };
  });
  return { rows, totalPaid, filteredTxns };
}

/**
 * تقرير التجار لفترة — Currency-Safe: كل حقل CurrencyMap مستقل بالعملة،
 * لا خلط بين EGP/USD/LYD في أي إجمالي.
 */
export type MerchantReportRow = {
  name: string;
  incoming: CurrencyMap;
  outgoing: CurrencyMap;
  collected: CurrencyMap;
  fee: CurrencyMap;
  balance: CurrencyMap;
};
export type MerchantReportSummary = {
  rows: MerchantReportRow[];
  totalIn: CurrencyMap;
  totalOut: CurrencyMap;
  totalFee: CurrencyMap;
};

export function summarizeMerchantReport(input: {
  merchants: Merchant[];
  transactions: Transaction[];
  companyTransactions: CompanyTransaction[];
  collections: MerchantCashCollection[];
  usdRows?: UsdTreasuryTransaction[];
  splits?: readonly CollectionSplitRow[] | null;
  inRange: InRange;
}): MerchantReportSummary {
  const { merchants, transactions, companyTransactions, collections, usdRows, splits, inRange } = input;
  // نستخدم buildMerchantMovements (نفس Ledger كشف الحساب) ثم نصفّي بـ inRange.
  const movementInput = buildMerchantMovementInputs(
    transactions, companyTransactions, collections, usdRows || [], splits,
  );
  const totalIn = new CurrencyMap();
  const totalOut = new CurrencyMap();
  const totalFee = new CurrencyMap();
  const rows: MerchantReportRow[] = merchants.map((m) => {
    const movs = buildMerchantMovements(m.id, movementInput)
      .filter((mv) => inRange(mv.date));
    const totals = summarizeMerchantMovementTotals(movs);
    totalIn.merge(totals.totalIncoming);
    totalOut.merge(totals.totalOutgoing);
    totalFee.merge(totals.totalCommission);
    return {
      name: (m as any).merchant_name,
      incoming: totals.totalIncoming,
      outgoing: totals.totalOutgoing,
      collected: totals.totalCollected,
      fee: totals.totalCommission,
      balance: totals.balance,
    };
  });
  return { rows, totalIn, totalOut, totalFee };
}


/** تقرير المستثمرين لفترة. */
export type InvestorReportRow = { name: string; deposit: number; withdraw: number; balance: number };
export type InvestorReportSummary = {
  rows: InvestorReportRow[];
  totalDeposit: number;
  totalWithdraw: number;
  totalBalance: number;
  filteredTxns: InvestorTransaction[];
};

export function summarizeInvestorReport(input: {
  investors: Investor[];
  investorTransactions: InvestorTransaction[];
  inRange: InRange;
}): InvestorReportSummary {
  const { investors, investorTransactions, inRange } = input;
  const byInv = new Map<string, { deposit: number; withdraw: number }>();
  const filteredTxns: InvestorTransaction[] = [];
  for (const t of investorTransactions) {
    if (!inRange(t.date)) continue;
    filteredTxns.push(t);
    const id = t.investor_id;
    if (!id) continue;
    let v = byInv.get(id);
    if (!v) { v = { deposit: 0, withdraw: 0 }; byInv.set(id, v); }
    const amt = Number((t as any).amount || 0);
    if ((t as any).transaction_type === "توريد نقدية") v.deposit += amt;
    else if ((t as any).transaction_type === "صرف نقدية") v.withdraw += amt;
  }
  const rows: InvestorReportRow[] = investors.map((inv) => {
    const v = byInv.get(inv.id) || { deposit: 0, withdraw: 0 };
    return { name: (inv as any).investor_name, deposit: v.deposit, withdraw: v.withdraw, balance: v.deposit - v.withdraw };
  });
  let totalDeposit = 0, totalWithdraw = 0, totalBalance = 0;
  for (const r of rows) { totalDeposit += r.deposit; totalWithdraw += r.withdraw; totalBalance += r.balance; }
  return { rows, totalDeposit, totalWithdraw, totalBalance, filteredTxns };
}

/** تقرير الخزينة الدولارية لفترة (رصيد جارٍ + إجماليات الفترة). */
export type UsdTreasuryPeriodSummary = {
  allSorted: UsdTreasuryTransaction[];
  withBalance: Array<{ row: UsdTreasuryTransaction; balance: number }>;
  filtered: Array<{ row: UsdTreasuryTransaction; balance: number }>;
  periodConversions: number;
  periodPayments: number;
  periodEgpUsed: number;
  currentBalance: number;
};

export function summarizeUsdTreasuryPeriod(
  usdTreasury: UsdTreasuryTransaction[],
  inRange: InRange,
): UsdTreasuryPeriodSummary {
  const allSorted = [...usdTreasury]
    .filter((r) => !(r as any).cancelled_at)
    .sort((a, b) => {
      const da = (a.date || "") + " " + ((a as any).created_at || "");
      const db = (b.date || "") + " " + ((b as any).created_at || "");
      return da.localeCompare(db);
    });
  let bal = 0;
  const withBalance = allSorted.map((r) => {
    const amt = Number((r as any).usd_amount || 0);
    bal += r.type === "company_payment" ? -amt : amt;
    return { row: r, balance: bal };
  });
  let periodConversions = 0, periodPayments = 0, periodEgpUsed = 0;
  const filteredFwd: Array<{ row: UsdTreasuryTransaction; balance: number }> = [];
  for (const x of withBalance) {
    if (!inRange(x.row.date)) continue;
    filteredFwd.push(x);
    const usd = Number((x.row as any).usd_amount || 0);
    const egp = Number((x.row as any).egp_amount || 0);
    if (x.row.type === "conversion") { periodConversions += usd; periodEgpUsed += egp; }
    else if (x.row.type === "company_payment") periodPayments += usd;
  }
  const currentBalance = withBalance.length ? withBalance[withBalance.length - 1].balance : 0;
  return {
    allSorted, withBalance,
    filtered: filteredFwd.slice().reverse(),
    periodConversions, periodPayments, periodEgpUsed, currentBalance,
  };
}

/* ============================================================
 *  MERCHANT MOVEMENT TOTALS — إجماليات كشف حركة تاجر (شاشة /merchants)
 *  Single-pass: كل الإجماليات + التجميع بالعملة في مرور واحد.
 * ============================================================ */

export type MerchantMovementItem = {
  type: string;
  currency?: string | null;
  gross: number;
  commission: number;
  net: number;
  delta: number;
};

export type MerchantMovementTotals = {
  /** إجماليات مجمَّعة بالعملة — كل عملة مستقلة تماماً. لا خلط بين EGP/USD/LYD. */
  totalIncoming: CurrencyMap;
  totalOutgoing: CurrencyMap;
  totalCollected: CurrencyMap;
  totalPaidOut: CurrencyMap;
  totalConverted: CurrencyMap;
  totalCommission: CurrencyMap;
  balance: CurrencyMap;
  byCurrency: LedgerCurrencyTotal[];
};

export function summarizeMerchantMovementTotals(
  items: readonly MerchantMovementItem[],
): MerchantMovementTotals {
  const totalIncoming = new CurrencyMap();
  const totalOutgoing = new CurrencyMap();
  const totalCollected = new CurrencyMap();
  const totalPaidOut = new CurrencyMap();
  const totalConverted = new CurrencyMap();
  const totalCommission = new CurrencyMap();
  const balance = new CurrencyMap();
  const map = new Map<string, { debit: number; credit: number; count: number }>();
  for (const m of items) {
    const cur = m.currency || "EGP";
    switch (m.type) {
      case "وارد من وكيل": totalIncoming.add(cur, m.net); break;
      case "صادر لشركة": totalOutgoing.add(cur, m.net); break;
      case "تحصيل نقدية من التاجر": totalCollected.add(cur, m.net); break;
      case "صرف نقدية للتاجر": totalPaidOut.add(cur, m.net); break;
      case "تحويل لـ USD": totalConverted.add(cur, m.net); break;
    }
    totalCommission.add(cur, m.commission);
    balance.add(cur, Number(m.delta) || 0);
    const g = map.get(cur) || { debit: 0, credit: 0, count: 0 };
    if (m.delta >= 0) g.debit += m.delta; else g.credit += -m.delta;
    g.count += 1;
    map.set(cur, g);
  }
  const byCurrency: LedgerCurrencyTotal[] = [];
  const seen = new Set<string>();
  for (const cur of CURRENCY_ORDER) {
    if (map.has(cur)) {
      const g = map.get(cur)!;
      byCurrency.push({ currency: cur, debit: g.debit, credit: g.credit, net: g.debit - g.credit, count: g.count });
      seen.add(cur);
    }
  }
  for (const cur of Array.from(map.keys()).filter((c) => !seen.has(c)).sort()) {
    const g = map.get(cur)!;
    byCurrency.push({ currency: cur, debit: g.debit, credit: g.credit, net: g.debit - g.credit, count: g.count });
  }
  return {
    totalIncoming, totalOutgoing, totalCollected, totalPaidOut, totalConverted,
    totalCommission, balance,
    byCurrency: byCurrency.filter((t) => t.debit !== 0 || t.credit !== 0 || t.net !== 0),
  };
}

/* ============================================================
 *  MERCHANT SUB-PERIOD TOTALS — تصفية + إجمالي بسيط لتبويبات /merchants
 * ============================================================ */

export function summarizeMerchantCollectionsPeriod(
  collections: MerchantCashCollection[], from: string, to: string,
  splits?: readonly CollectionSplitRow[] | null,
): { filtered: MerchantCashCollection[]; total: number; totalByCurrency: CurrencyMap; currencyById: Map<string, string> } {
  const filtered: MerchantCashCollection[] = [];
  const currencyById = buildCollectionCurrencyMap(splits);
  const totalByCurrency = new CurrencyMap();
  let total = 0;
  for (const c of collections) {
    // Cancelled collections are treated as removed everywhere else in the
    // merchant ledger (aggregates/balance/statement). Hide them here too so
    // "سجل التحصيلات" stays in sync with the merchant statement — no orphan
    // rows after cancelFinancialTransaction("merchant_cash_collections", id).
    if ((c as any).cancelled_at) continue;
    if (from && c.date < from) continue;
    if (to && c.date > to) continue;
    filtered.push(c);
    const amt = Number(c.amount || 0);
    total += amt;
    const isOpening = ((c as any).source_service_type === "opening_debit" || (c as any).source_service_type === "opening_credit");
    const cur = normalizeCurrency(isOpening ? (c as any).opening_currency : (currencyById.get(c.id) ?? (c as any).currency));
    totalByCurrency.add(cur, amt);
  }
  return { filtered, total, totalByCurrency, currencyById };
}

export function summarizeMerchantIncomingPeriod(
  txns: Transaction[], agentId: string, from: string, to: string,
): { filtered: Transaction[]; total: number; totalByCurrency: CurrencyMap; totalPaidByCurrency: CurrencyMap } {
  const filtered: Transaction[] = [];
  let total = 0;
  const totalByCurrency = new CurrencyMap();
  const totalPaidByCurrency = new CurrencyMap();
  for (const t of txns) {
    if ((t as any).cancelled_at) continue;
    if (agentId && t.agent_id !== agentId) continue;
    if (from && (t.date || "") < from) continue;
    if (to && (t.date || "") > to) continue;
    filtered.push(t);
    const net = merchantCashNet(t) + Number((t as any).merchant_cash_physical_amount || 0);
    // transactions table has NO payment_currency column — currency is stored in `currency`.
    const cur = normalizeCurrency((t as any).payment_currency || (t as any).currency || "EGP");
    total += net;
    totalByCurrency.add(cur, net);
    totalPaidByCurrency.add(cur, Number(t.total_paid || 0));
  }
  return { filtered, total, totalByCurrency, totalPaidByCurrency };
}

export function summarizeMerchantOutgoingPeriod(
  cTxns: CompanyTransaction[], companyId: string, from: string, to: string,
): { filtered: CompanyTransaction[]; total: number; totalByCurrency: CurrencyMap; totalPaidByCurrency: CurrencyMap } {
  const filtered: CompanyTransaction[] = [];
  let total = 0;
  const totalByCurrency = new CurrencyMap();
  const totalPaidByCurrency = new CurrencyMap();
  for (const t of cTxns) {
    if ((t as any).cancelled_at) continue;
    if (companyId && (t as any).company_id !== companyId) continue;
    if (from && (t.date || "") < from) continue;
    if (to && (t.date || "") > to) continue;
    filtered.push(t);
    const amt = merchantCompanyOutflowAmount(t);
    // company_transactions has BOTH payment_currency and currency — prefer payment_currency, then currency.
    const cur = normalizeCurrency((t as any).payment_currency || (t as any).currency || "EGP");
    total += amt;
    totalByCurrency.add(cur, amt);
    totalPaidByCurrency.add(cur, Number((t as any).total_paid || 0));
  }
  return { filtered, total, totalByCurrency, totalPaidByCurrency };
}

/* ============================================================
 *  USD CONVERSION SOURCE BALANCE — رصيد مصدر التحويل لـ USD
 *  (يُستخدم في مودال "تحويل إلى الخزينة الدولارية" داخل /companies).
 * ============================================================ */

export type ConvertSource =
  | "insta_company" | "cash_company" | "merchant_wallet" | "merchant_physical";

export function computeUsdConversionSourceBalance(input: {
  sourceType: ConvertSource | "";
  merchantId?: string;
  agentTxns: Transaction[];
  companyTxns: CompanyTransaction[];
  collections: MerchantCashCollection[];
  usdRows: UsdTreasuryTransaction[];
}): number {
  const { sourceType, merchantId, agentTxns, companyTxns, collections, usdRows } = input;
  if (!sourceType) return 0;
  let conv = 0;
  for (const r of usdRows) {
    if (r.type !== "conversion") continue;
    if ((r as any).source_type !== sourceType) continue;
    if (merchantId && (r as any).merchant_id !== merchantId) continue;
    conv += Number((r as any).egp_amount || 0);
  }
  if (sourceType === "insta_company") {
    let inn = 0, out = 0;
    for (const t of agentTxns) inn += Number((t as any).instapay_amount || 0);
    for (const t of companyTxns) out += Number((t as any).instapay_amount || 0);
    return Math.round(inn - out - conv);
  }
  if (sourceType === "cash_company") {
    let inn = 0, out = 0;
    for (const t of agentTxns) inn += Number((t as any).cash_amount || 0);
    for (const t of companyTxns) out += Number((t as any).cash_amount || 0);
    return Math.round(inn - out - conv);
  }
  if (!merchantId) return 0;
  if (sourceType === "merchant_wallet") {
    let inn = 0, out = 0, col = 0;
    for (const t of agentTxns) if ((t as any).merchant_id === merchantId) inn += merchantCashNet(t);
    for (const t of companyTxns) if ((t as any).merchant_id === merchantId) out += merchantCashNet(t as any);
    for (const c of collections) if (c.merchant_id === merchantId) col += Number(c.amount || 0);
    return Math.round(inn - out - col - conv);
  }
  // merchant_physical
  let inn = 0, out = 0;
  for (const t of agentTxns) if ((t as any).merchant_id === merchantId) inn += Number((t as any).merchant_cash_physical_amount || 0);
  for (const t of companyTxns) if ((t as any).merchant_id === merchantId) out += Number((t as any).merchant_cash_physical_amount || 0);
  return Math.round(inn - out - conv);
}

