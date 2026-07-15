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

