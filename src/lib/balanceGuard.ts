/**
 * Centralized balance guard.
 *
 * Single source of truth for "هل وسيلة الدفع تملك رصيداً كافياً؟".
 * Used by every outflow form (company payments, expenses, currency-supplier
 * buy/sell, USD treasury conversions, etc.) to prevent saving operations
 * that would over-draw a cash box / merchant balance.
 *
 * Rule 7 from the spec: incoming-only movements (agent collections, deposits,
 * opening balances, supplier deliveries) are NEVER blocked — callers simply
 * don't invoke this guard for incoming flows.
 */

import { useMemo } from "react";
import {
  useLive,
  merchantCashNet,
  merchantCompanyOutflowAmount,
  type Transaction,
  type CompanyTransaction,
  type ExpenseDeduction,
  type UsdTreasuryTransaction,
  type MerchantCashCollection,
  type Merchant,
} from "@/lib/db";
import type { PaymentSplitRow } from "@/components/PaymentSplits";

type CashBoxRow = {
  id: string;
  name: string;
  currency: string;
  balance: number | string | null;
};

export type SourceBalances = {
  insta_company: number;
  cash_company: number;
  usd_treasury: number;
  merchantBalance: Map<string, number>;
};

/**
 * Canonical per-source balances.
 *
 * EGP company pools and USD treasury are read DIRECTLY from `cash_boxes.balance`,
 * which is maintained by the `payment_splits` trigger. This makes the balance
 * a single source of truth across dashboard / reports / validation.
 *
 * Merchant balances have no cash_box row, so we still aggregate them from
 * transactions + collections + USD conversions.
 */
export function useSourceBalances(): SourceBalances {
  const { rows: cashBoxes } = useLive<CashBoxRow>("cash_boxes");
  const { rows: agentTxns } = useLive<Transaction>("transactions");
  const { rows: cTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: deductions } = useLive<ExpenseDeduction>("expense_deductions");
  const { rows: usdRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");
  // Kept for consumers that expect the hook to also react to these deps.
  void deductions;

  return useMemo(() => {
    const boxByKey = (name: string, currency: string) =>
      cashBoxes.find((b) => b.name === name && b.currency === currency);

    const insta = boxByKey("خزينة إنستا الشركة", "EGP");
    const cash = boxByKey("خزينة نقدي الشركة", "EGP");
    const usd = boxByKey("الخزينة الرئيسية - دولار", "USD");

    const num = (v: unknown) => Math.round(Number(v || 0));
    const num2 = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;

    // Merchant balances (no cash_box mapping — aggregate raw movements)
    const merchantBalance = new Map<string, number>();
    for (const t of agentTxns) {
      if (!t.merchant_id) continue;
      const net = merchantCashNet(t) + Number(t.merchant_cash_physical_amount || 0);
      merchantBalance.set(t.merchant_id, (merchantBalance.get(t.merchant_id) || 0) + net);
    }
    for (const t of cTxns) {
      if (!t.merchant_id) continue;
      const net = merchantCompanyOutflowAmount(t);
      merchantBalance.set(t.merchant_id, (merchantBalance.get(t.merchant_id) || 0) - net);
    }
    for (const c of collections) {
      merchantBalance.set(
        c.merchant_id,
        (merchantBalance.get(c.merchant_id) || 0) - Number(c.amount || 0),
      );
    }
    for (const r of usdRows) {
      if (r.type !== "conversion" || !r.merchant_id) continue;
      if (r.source_type === "merchant_wallet" || r.source_type === "merchant_physical") {
        merchantBalance.set(
          r.merchant_id,
          (merchantBalance.get(r.merchant_id) || 0) - Number(r.egp_amount || 0),
        );
      }
    }

    return {
      insta_company: num(insta?.balance),
      cash_company: num(cash?.balance),
      usd_treasury: num2(usd?.balance),
      merchantBalance,
    };
  }, [cashBoxes, agentTxns, cTxns, usdRows, collections]);
}


function methodSourceLabel(method: string, merchantName?: string): string {
  switch (method) {
    case "company_instapay": return "إنستا الشركة";
    case "company_cash":     return "نقدي الشركة";
    case "merchant_instapay":return `إنستا ${merchantName || "تاجر"}`;
    case "merchant_wallet":  return `تاجر الكاش ${merchantName || ""}`.trim();
    case "merchant_physical":return `نقدي ${merchantName || "تاجر"}`;
    default: return method;
  }
}

const fmt = (n: number) => new Intl.NumberFormat("en-US").format(Math.round(n));

/**
 * Aggregate split rows by funding source, then ensure each source has enough
 * balance to cover the total requested from it.
 *
 * Returns null if all good, otherwise the first Arabic error message:
 *   "رصيد وسيلة الدفع (اسم الوسيلة) غير كافٍ. الرصيد الحالي: X، المبلغ المطلوب: Y"
 *
 * Only EGP outflows are checked here (the current splits widget is EGP-only
 * for the company / merchant funding sources). Pass `currency` filter if the
 * caller wants to restrict.
 */
export function validateSplitOutflows(
  splits: PaymentSplitRow[],
  balances: SourceBalances,
  merchants: Merchant[],
): string | null {
  const usedInsta = new Map<string, number>(); // key: "company"
  let usedCompanyInsta = 0;
  let usedCompanyCash = 0;
  const usedMerchant = new Map<string, number>(); // merchant_id → amount

  for (const r of splits) {
    const a = Number(r.amount) || 0;
    if (a <= 0) continue;
    if (r.method === "company_instapay") usedCompanyInsta += a;
    else if (r.method === "company_cash") usedCompanyCash += a;
    else if (r.source === "merchant" && r.merchant_id) {
      usedMerchant.set(r.merchant_id, (usedMerchant.get(r.merchant_id) || 0) + a);
    }
  }
  void usedInsta;

  if (usedCompanyInsta > balances.insta_company) {
    return `رصيد وسيلة الدفع (إنستا الشركة) غير كافٍ. الرصيد الحالي: ${fmt(balances.insta_company)}، المبلغ المطلوب: ${fmt(usedCompanyInsta)}`;
  }
  if (usedCompanyCash > balances.cash_company) {
    return `رصيد وسيلة الدفع (نقدي الشركة) غير كافٍ. الرصيد الحالي: ${fmt(balances.cash_company)}، المبلغ المطلوب: ${fmt(usedCompanyCash)}`;
  }
  for (const [mid, amt] of usedMerchant) {
    const bal = balances.merchantBalance.get(mid) || 0;
    if (amt > bal) {
      const name = merchants.find((m) => m.id === mid)?.merchant_name || "تاجر";
      const row = splits.find((r) => r.merchant_id === mid);
      const label = row ? methodSourceLabel(row.method, name) : `تاجر ${name}`;
      return `رصيد وسيلة الدفع (${label}) غير كافٍ. الرصيد الحالي: ${fmt(bal)}، المبلغ المطلوب: ${fmt(amt)}`;
    }
  }
  return null;
}

/** Generic guard for a single cash-box style outflow (live balance + amount). */
export function validateSingleOutflow(
  label: string,
  available: number,
  requested: number,
): string | null {
  if (requested > available) {
    return `رصيد وسيلة الدفع (${label}) غير كافٍ. الرصيد الحالي: ${fmt(available)}، المبلغ المطلوب: ${fmt(requested)}`;
  }
  return null;
}
