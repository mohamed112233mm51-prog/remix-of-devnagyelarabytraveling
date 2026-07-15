/**
 * =============================================================================
 * DASHBOARD COLLECTIONS — الدوال المشتركة لحساب التحصيلات على الداشبورد
 * =============================================================================
 *
 * مصدر أصل واحد لكل كارت تحصيلات في الداشبورد:
 *   - تحصيلات الوكلاء     → public.transactions (عبر txnCollectedAmount)
 *   - تحصيلات تجار الكاش  → public.merchant_cash_collections.amount
 *
 * قواعد صارمة:
 *   ⛔ الحركات الملغاة (cancelled_at != null) مستبعدة تماماً.
 *   ⛔ لا نمس company_transactions هنا — ليست مصدر تحصيلات.
 *   ⛔ payment_splits لا تُجمَع مباشرة — قد تُنتج ازدواج للتحصيل الواحد.
 *   ✅ كل سجل يُحسَب مرة واحدة فقط (dedupe بالـ id).
 *
 * التاريخ المعتمد لفلترة الفترة:
 *   - transactions              → date  ثم created_at كـ fallback.
 *   - merchant_cash_collections → date  ثم created_at كـ fallback.
 * =============================================================================
 */

import { normalizeCurrency, txnCollectedAmount, tripValue } from "@/lib/db";
import { CurrencyMap } from "@/lib/financialSummary";
import { aggregateExecutionByCurrency, type ExecutionRow } from "@/lib/executionProfit";
import type { CompanyTransaction, Expense, MerchantCashCollection, Transaction } from "@/lib/db";

type MaybeCancelled = { cancelled_at?: string | null };

/** true عندما يوجد `cancelled_at` غير فارغ على الصف. */
export function isCancelled(row: MaybeCancelled | null | undefined): boolean {
  return !!(row && row.cancelled_at);
}

/** التاريخ المحاسبي للحركة/التحصيل: `date` ثم `created_at` كـ fallback. */
export function rowAccountingDate(
  row: { date?: string | null; created_at?: string | null } | null | undefined,
): string | null {
  if (!row) return null;
  return row.date || row.created_at || null;
}

export type DatePredicate = (dateISO: string | null) => boolean;

/**
 * سياسة العملة (fallback موحّد للنظام):
 *  - transactions.currency               → EGP إذا فارغة (`normalizeCurrency` يفعل ذلك).
 *  - merchant_cash_collections.opening_currency → EGP إذا فارغة (نفس السياسة).
 * هذا هو السلوك المعتمد في كل النظام (`normalizeCurrency` سطر 648 من db.ts).
 */
function txnCurrency(t: Partial<Transaction>): string {
  return normalizeCurrency((t as any).currency);
}
function collectionCurrency(c: Partial<MerchantCashCollection>): string {
  return normalizeCurrency((c as any).opening_currency ?? (c as any).currency);
}

// ---------------------------------------------------------------------------
// إجماليات مجمّعة كرقم واحد (للاستخدام في حسابات مدى الحياة الحالية).
// ---------------------------------------------------------------------------

/** إجمالي تحصيلات الوكلاء (رقم واحد). يستبعد الملغاة. */
export function computeAgentCollections(
  transactions: Transaction[],
  predicate?: DatePredicate,
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const t of transactions) {
    if (!t || !t.id) continue;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (isCancelled(t as unknown as MaybeCancelled)) continue;
    if (predicate && !predicate(rowAccountingDate(t as any))) continue;
    total += txnCollectedAmount(t);
  }
  return total;
}

/** إجمالي تحصيلات تجار الكاش (رقم واحد). يستبعد الملغاة. */
export function computeMerchantCashCollections(
  collections: MerchantCashCollection[],
  predicate?: DatePredicate,
): number {
  const seen = new Set<string>();
  let total = 0;
  for (const c of collections) {
    if (!c || !c.id) continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (isCancelled(c as unknown as MaybeCancelled)) continue;
    if (predicate && !predicate(rowAccountingDate(c as any))) continue;
    total += Number((c as any).amount || 0);
  }
  return total;
}

// ---------------------------------------------------------------------------
// إجماليات مفصولة حسب العملة (CurrencyMap) — لا خلط بين العملات أبداً.
// ---------------------------------------------------------------------------

/**
 * إجمالي تحصيلات الوكلاء مفصّلاً حسب العملة.
 * كل حركة تُنسَب لعملة `transactions.currency` (fallback EGP).
 * قيمة التحصيل = `txnCollectedAmount(t)` (كل مكونات الدفع تنتمي لنفس عملة الحركة).
 */
export function computeAgentCollectionsByCurrency(
  transactions: Transaction[],
  predicate?: DatePredicate,
): CurrencyMap {
  const seen = new Set<string>();
  const map = new CurrencyMap();
  for (const t of transactions) {
    if (!t || !t.id) continue;
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    if (isCancelled(t as unknown as MaybeCancelled)) continue;
    if (predicate && !predicate(rowAccountingDate(t as any))) continue;
    const amount = txnCollectedAmount(t);
    if (!amount) continue;
    map.add(txnCurrency(t), amount);
  }
  return map;
}

/**
 * صف split نستخدمه لاستخراج عملة التحصيل الحقيقية.
 * `merchant_cash_collections` لا يحفظ عملة التحصيل — العملة تُحفظ في
 * `payment_splits.currency` عبر خزنة الشركة المختارة (Financial Engine).
 */
export type CollectionSplitRow = {
  source_table?: string | null;
  source_id?: string | null;
  currency?: string | null;
  cancelled_at?: string | null;
};

/**
 * يبني خريطة `collectionId → currency` من `payment_splits`:
 *  - يتجاهل الـ splits الملغاة.
 *  - يعتمد العملة فقط إذا كانت كل splits التحصيل بعملة واحدة (وإلا يترك التحصيل بدون عملة محسومة).
 */
export function buildCollectionCurrencyMap(
  splits: readonly CollectionSplitRow[] | null | undefined,
): Map<string, string> {
  const buckets = new Map<string, Set<string>>();
  for (const s of splits || []) {
    if (!s || s.source_table !== "merchant_cash_collections") continue;
    if (s.cancelled_at) continue;
    const id = s.source_id || "";
    const cur = (s.currency || "").trim();
    if (!id || !cur) continue;
    const set = buckets.get(id) || new Set<string>();
    set.add(cur);
    buckets.set(id, set);
  }
  const result = new Map<string, string>();
  buckets.forEach((set, id) => {
    if (set.size === 1) result.set(id, Array.from(set)[0]);
  });
  return result;
}

/**
 * إجمالي تحصيلات تجار الكاش مفصّلاً حسب العملة.
 *
 * ترتيب حسم العملة لكل صف (fallback موثّق):
 *  1. عملة `payment_splits.currency` المرتبطة بالتحصيل (المصدر الحقيقي — الخزنة المختارة).
 *  2. `opening_currency` (سجلات الرصيد الافتتاحي فقط).
 *  3. EGP (سلوك تاريخي: لا يوجد حقل عملة على الصف).
 *
 * القيمة = `merchant_cash_collections.amount` (مرة واحدة لكل id — لا نجمع splits).
 */
export function computeMerchantCashCollectionsByCurrency(
  collections: MerchantCashCollection[],
  predicate?: DatePredicate,
  splits?: readonly CollectionSplitRow[] | null,
): CurrencyMap {
  const currencyById = buildCollectionCurrencyMap(splits);
  const seen = new Set<string>();
  const map = new CurrencyMap();
  for (const c of collections) {
    if (!c || !c.id) continue;
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    if (isCancelled(c as unknown as MaybeCancelled)) continue;
    if (predicate && !predicate(rowAccountingDate(c as any))) continue;
    const amount = Number((c as any).amount || 0);
    if (!amount) continue;
    const fromSplit = currencyById.get(c.id);
    const currency = fromSplit
      ? normalizeCurrency(fromSplit)
      : collectionCurrency(c);
    map.add(currency, amount);
  }
  return map;
}

/** دمج عدة خرائط عملة في خريطة واحدة (لا يجمع عملات مختلفة في رقم واحد). */
export function mergeCurrencyTotals(...maps: CurrencyMap[]): CurrencyMap {
  const out = new CurrencyMap();
  for (const m of maps) out.merge(m);
  return out;
}

/**
 * طرح خريطة عملات من أخرى — لكل عملة على حدة، بدون خلط.
 * `a[cur] - b[cur]` لكل عملة تظهر في أي من الطرفين.
 */
export function subtractCurrencyMaps(a: CurrencyMap, b: CurrencyMap): CurrencyMap {
  const out = new CurrencyMap();
  for (const { currency, amount } of a.entries({ includeZero: true })) out.add(currency, amount);
  for (const { currency, amount } of b.entries({ includeZero: true })) out.add(currency, -amount);
  return out;
}

/** Helper: يبني DatePredicate من نطاق [start, end). */
export function inRangePredicate(range: { start: Date; end: Date }): DatePredicate {
  const s = range.start.getTime();
  const e = range.end.getTime();
  return (d) => {
    if (!d) return false;
    const t = new Date(d).getTime();
    return t >= s && t < e;
  };
}

// ---------------------------------------------------------------------------
// إجماليات تفاصيل الأقسام في الداشبورد — مفصولة حسب العملة.
// كل دالة تُرجع CurrencyMap لكل حقل مالي؛ لا يتم خلط العملات ولا تحويلها.
// ---------------------------------------------------------------------------

/**
 * قيمة خدمات الوكلاء لكل عملة — من `executions.services` (kind=agent).
 * يُطابق مصدر مبيعات الوكلاء لكنه يعرض القيم بعملتها الأصلية بدل تحويلها إلى EGP.
 * يستبعد التنفيذات غير "منفذ" و`cancelled_at`.
 */
export function computeExecutionAgentSalesByCurrency(
  rows: ReadonlyArray<ExecutionRow & { cancelled_at?: string | null }>,
): CurrencyMap {
  const map = new CurrencyMap();
  for (const ex of rows) {
    if ((ex as any).cancelled_at) continue;
    if ((ex.operation_status || "") !== "منفذ") continue;
    const { salesByCur } = aggregateExecutionByCurrency(ex);
    for (const [cur, amt] of Object.entries(salesByCur)) map.add(cur, amt);
  }
  return map;
}

/**
 * إجماليات الشركات الصادرة مفصولة حسب العملة (مصدر أصل موحّد مع كارت الشركات).
 * services: من `trip_value || count*price`
 * paid: من `txnCollectedAmount`
 * due: services - paid لكل عملة على حدة (بدون خلط عملات)
 * مصدر العملة: `payment_currency || currency || EGP`.
 */
export function computeCompanyStatsByCurrency(
  cTxns: ReadonlyArray<CompanyTransaction & { cancelled_at?: string | null }>,
): { services: CurrencyMap; paid: CurrencyMap; due: CurrencyMap } {
  const services = new CurrencyMap();
  const paid = new CurrencyMap();
  for (const t of cTxns) {
    if ((t as any).cancelled_at) continue;
    const cur = normalizeCurrency((t as any).payment_currency ?? (t as any).currency);
    const sv =
      Number((t as any).trip_value || 0) ||
      Number((t as any).count || 0) * Number((t as any).price || 0);
    if (sv) services.add(cur, sv);
    const pd = txnCollectedAmount(t);
    if (pd) paid.add(cur, pd);
  }
  return { services, paid, due: subtractCurrencyMaps(services, paid) };
}

/**
 * إجماليات المصروفات مفصولة حسب العملة (`expenses.currency` fallback EGP).
 * المبلغ من `expenses.amount` فقط — لا نضيف `expense_deductions` أبداً
 * لأنها شرائح سداد لنفس المصروف (يؤدي إلى تضاعف الحساب).
 */
export function computeExpensesByCurrency(
  expenses: ReadonlyArray<Expense & { cancelled_at?: string | null }>,
): { total: CurrencyMap; fixed: CurrencyMap; variable: CurrencyMap } {
  const total = new CurrencyMap();
  const fixed = new CurrencyMap();
  const variable = new CurrencyMap();
  for (const e of expenses) {
    if ((e as any).cancelled_at) continue;
    const amt = Number((e as any).amount || 0);
    if (!amt) continue;
    const cur = normalizeCurrency((e as any).currency);
    total.add(cur, amt);
    const kind = (e as any).expense_type;
    if (kind === "ثابت") fixed.add(cur, amt);
    else if (kind === "متغير") variable.add(cur, amt);
  }
  return { total, fixed, variable };
}

type CurrencyTxnLike = {
  supplier_id?: string | null;
  tx_type?: string | null;
  bought_currency?: string | null;
  bought_amount?: number | string | null;
  sold_currency?: string | null;
  sold_amount?: number | string | null;
  payment_splits?: any;
  cancelled_at?: string | null;
};

/**
 * إجماليات موردي العملة مفصولة حسب العملة (لا تحويل ولا خلط).
 * - `purchases[sold_currency] += sold_amount` (المبلغ المستحق للمورد بعملة السداد)
 * - `payments[split.currency ?? sold_currency] += split.amount`
 * - `due = purchases - payments` لكل عملة
 * (يبقى كل مورد بعملته الأصلية بدون تحويل.)
 */
export function computeCurrencySupplierStatsByCurrency(
  txns: ReadonlyArray<CurrencyTxnLike>,
  activeSupplierIds: ReadonlySet<string>,
): { purchases: CurrencyMap; payments: CurrencyMap; due: CurrencyMap } {
  const purchases = new CurrencyMap();
  const payments = new CurrencyMap();
  for (const t of txns) {
    if (t.cancelled_at) continue;
    if (!t.supplier_id || !activeSupplierIds.has(t.supplier_id)) continue;
    if ((t.tx_type || "") !== "شراء عملة") continue;
    const owedCur = normalizeCurrency(t.sold_currency);
    const owedAmt = Number(t.sold_amount || 0);
    if (owedAmt) purchases.add(owedCur, owedAmt);
    const splits = Array.isArray(t.payment_splits) ? t.payment_splits : [];
    for (const s of splits) {
      const amt = Number((s && s.amount) || 0);
      if (!amt) continue;
      const cur = normalizeCurrency((s && s.currency) ?? owedCur);
      payments.add(cur, amt);
    }
  }
  return { purchases, payments, due: subtractCurrencyMaps(purchases, payments) };
}

// used only in currency supplier helper — silences "tripValue unused" if branch removed
void tripValue;


