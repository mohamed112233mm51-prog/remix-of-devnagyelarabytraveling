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

import { normalizeCurrency, txnCollectedAmount } from "@/lib/db";
import { CurrencyMap } from "@/lib/financialSummary";
import type { MerchantCashCollection, Transaction } from "@/lib/db";

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
 * إجمالي تحصيلات تجار الكاش مفصّلاً حسب العملة.
 * كل سجل يُحسَب مرة واحدة بقيمة `amount` تحت عملة `opening_currency` (fallback EGP).
 * لا نمس `payment_splits` كمصدر للقيمة (تفاصيل دفع فقط).
 */
export function computeMerchantCashCollectionsByCurrency(
  collections: MerchantCashCollection[],
  predicate?: DatePredicate,
): CurrencyMap {
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
    map.add(collectionCurrency(c), amount);
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

