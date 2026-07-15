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

import { txnCollectedAmount } from "@/lib/db";
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
 * إجمالي تحصيلات الوكلاء من جدول `transactions`.
 * - يستبعد الحركات الملغاة (`cancelled_at != null`).
 * - يستخدم `txnCollectedAmount` (نفس التعريف المعتمد في كل النظام).
 * - يقبل predicate اختياري على التاريخ المحاسبي (date ثم created_at).
 * - يجمع كل حركة مرة واحدة فقط (المصفوفة نفسها لا تحتوي تكرار id).
 */
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

/**
 * إجمالي تحصيلات تجار الكاش من جدول `merchant_cash_collections`.
 * - يستبعد الملغاة.
 * - يستخدم قيمة التحصيل الفعلية `amount` مباشرةً من الجدول.
 * - كل سجل يُحسَب مرة واحدة (dedupe بالـ id) حتى لو كان موزعاً على
 *   أكثر من وسيلة دفع (payment_splits تفاصيل دفع فقط).
 */
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
