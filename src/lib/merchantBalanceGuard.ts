/**
 * DB-backed merchant (تاجر كاش) balance guard.
 *
 * The UI guard in `balanceGuard.ts` is fast but reads client caches. This
 * module is the FINAL authority: right before writing any outflow it asks the
 * database (full history, no pagination limits) whether the merchant actually
 * has enough balance, using the exact same formula as the UI guard
 * (transactions + company_transactions + merchant_cash_collections +
 * usd_treasury_transactions, cancelled rows excluded, no double-counting of
 * `merchant_cash_out_to_company`).
 *
 * It NEVER mutates balances or historical data — it only reads.
 */

import { supabase } from "@/integrations/supabase/client";
import { normalizeCurrency, currencyName } from "@/lib/db";

export type MerchantOutflowSplitLike = {
  source?: string | null;
  merchant_id?: string | null;
  amount?: string | number | null;
  currency?: string | null;
};

const fmt = (n: number) =>
  new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(Number(n) || 0);

/** Aggregate requested outflow per merchant + currency. */
export function aggregateMerchantOutflows(
  splits: MerchantOutflowSplitLike[],
): Array<{ merchantId: string; currency: string; amount: number }> {
  const map = new Map<string, { merchantId: string; currency: string; amount: number }>();
  for (const s of splits) {
    if (s.source !== "merchant" || !s.merchant_id) continue;
    const amount = Number(s.amount || 0);
    if (!(amount > 0)) continue;
    const currency = normalizeCurrency(String(s.currency || "EGP"));
    const key = `${s.merchant_id}|${currency}`;
    const prev = map.get(key);
    map.set(key, {
      merchantId: s.merchant_id,
      currency,
      amount: (prev?.amount || 0) + amount,
    });
  }
  return [...map.values()];
}

/**
 * Verify a single merchant + currency outflow against the live DB balance.
 * Returns an Arabic error string when blocked, otherwise null.
 */
export async function checkMerchantBalance(
  merchantId: string,
  currency: string,
  amount: number,
): Promise<string | null> {
  if (!merchantId || !(Number(amount) > 0)) return null;
  const { data, error } = await supabase.rpc("assert_merchant_balance" as never, {
    p_merchant_id: merchantId,
    p_currency: normalizeCurrency(String(currency || "EGP")),
    p_amount: Number(amount),
  } as never);

  if (error) {
    return `تعذر التحقق من رصيد تاجر الكاش من قاعدة البيانات: ${error.message}`;
  }
  const res = (data || {}) as {
    ok?: boolean;
    merchant_name?: string;
    currency?: string;
    available?: number;
    requested?: number;
    shortfall?: number;
  };
  if (res.ok) return null;

  const code = normalizeCurrency(String(res.currency || currency || "EGP"));
  return (
    `رصيد تاجر الكاش (${res.merchant_name || "تاجر"}) غير كافٍ بعملة ${currencyName(code)}. ` +
    `الرصيد الحالي: ${fmt(Number(res.available || 0))} ${code}، ` +
    `المبلغ المطلوب: ${fmt(Number(res.requested || amount))} ${code}، ` +
    `العجز: ${fmt(Number(res.shortfall || 0))} ${code}`
  );
}

/**
 * Central guard for any form that spends from merchant sources.
 * Aggregates per merchant + currency first, then validates each against the DB.
 * Returns the first Arabic error message, or null when everything is covered.
 */
export async function assertMerchantOutflowsAllowed(
  splits: MerchantOutflowSplitLike[],
): Promise<string | null> {
  const requests = aggregateMerchantOutflows(splits);
  for (const req of requests) {
    const err = await checkMerchantBalance(req.merchantId, req.currency, req.amount);
    if (err) return err;
  }
  return null;
}
