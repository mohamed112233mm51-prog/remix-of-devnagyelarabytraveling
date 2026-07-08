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
import { useLive } from "@/lib/db";
import type {
  Agent,
  CompanyTransaction,
  IssuingCompany,
  Merchant,
  Transaction,
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
 * تحويل صف transactions إلى (بيع، مدفوع) بنفس الحساب المستخدم في
 * الشاشات الحالية (السعر × العدد للبيع، total_paid|paid للمدفوع).
 */
function txnSaleAndPaid(t: Partial<Transaction>): { sale: number; paid: number } {
  const count = Number(t.count || 0);
  const price = Number(t.price || 0);
  const paid = Number(t.total_paid ?? t.paid ?? 0);
  // إشارة paid في transactions قد تكون سالبة (صرف) أو موجبة (قبض) —
  // نعتمد على القيمة المطلقة عند التعبير عن "المدفوع".
  return {
    sale: count * price,
    paid: Math.abs(paid),
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
    const anyT = t as any;
    // نستخدم نفس الحقول التي تعرضها شاشة الشركة حالياً:
    // - amount = تكلفة الشركة (debit)
    // - paid_amount / total_paid = المدفوع للشركة (credit)
    const debit = Math.abs(Number(anyT.amount ?? 0));
    const credit = Math.abs(
      Number(anyT.paid_amount ?? anyT.total_paid ?? anyT.paid ?? 0),
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
 *  CURRENCY SUPPLIERS — موردو العملات
 * ============================================================ */

type CurrencySupplierTxn = {
  id: string;
  supplier_id: string | null;
  amount: number | string | null;
  currency: string | null;
  direction?: string | null;
  transaction_type?: string | null;
  created_at?: string | null;
};

export function summarizeCurrencySupplier(rows: CurrencySupplierTxn[]): EntitySummary {
  const s = empty();
  s.count = rows.length;
  for (const t of rows) {
    const cur = (t.currency || "EGP").toString().toUpperCase();
    const amt = Math.abs(Number(t.amount) || 0);
    const dir = (t.direction || t.transaction_type || "").toString();
    const isOut = /out|شراء|صرف|purchase/i.test(dir);
    if (isOut) {
      s.totalDebit.add(cur, amt);
      s.balance.add(cur, amt);
    } else {
      s.totalCredit.add(cur, amt);
      s.balance.add(cur, -amt);
    }
  }
  return s;
}

export function useCurrencySupplierSummary(
  supplierId: string | null | undefined,
): EntitySummary {
  const { rows } = useLive<CurrencySupplierTxn>("currency_supplier_transactions");
  return useMemo(() => {
    if (!supplierId) return empty();
    return summarizeCurrencySupplier(rows.filter((r) => r.supplier_id === supplierId));
  }, [rows, supplierId]);
}

export function useCurrencySuppliersSummary(): Map<string, EntitySummary> {
  const { rows } = useLive<CurrencySupplierTxn>("currency_supplier_transactions");
  return useMemo(() => {
    const grouped = new Map<string, CurrencySupplierTxn[]>();
    for (const t of rows) {
      if (!t.supplier_id) continue;
      let arr = grouped.get(t.supplier_id);
      if (!arr) grouped.set(t.supplier_id, (arr = []));
      arr.push(t);
    }
    const out = new Map<string, EntitySummary>();
    for (const [id, list] of grouped) out.set(id, summarizeCurrencySupplier(list));
    return out;
  }, [rows]);
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
