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
  type Transaction,
  type CompanyTransaction,
  type InvestorTransaction,
  type ExpenseDeduction,
  type UsdTreasuryTransaction,
  type MerchantCashCollection,
  type Merchant,
} from "@/lib/db";
import type { PaymentSplitRow } from "@/components/PaymentSplits";

export type SourceBalances = {
  insta_company: number;
  cash_company: number;
  usd_treasury: number;
  merchantBalance: Map<string, number>;
};

/**
 * Live per-source balances, recomputed from raw movements (never trust a
 * stored aggregate). Mirrors the existing logic in expenses.tsx so all
 * forms see the same numbers.
 */
export function useSourceBalances(): SourceBalances {
  const { rows: agentTxns } = useLive<Transaction>("transactions");
  const { rows: cTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: investorTxns } = useLive<InvestorTransaction>("investor_transactions");
  const { rows: deductions } = useLive<ExpenseDeduction>("expense_deductions");
  const { rows: usdRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");

  return useMemo(() => {
    let instaIn = 0, cashIn = 0;
    for (const t of agentTxns) {
      instaIn += Number(t.instapay_amount || 0);
      cashIn += Number(t.cash_amount || 0);
    }
    let instaOut = 0, cashOut = 0;
    for (const t of cTxns) {
      instaOut += Number(t.instapay_amount || 0);
      cashOut += Number(t.cash_amount || 0);
    }
    let investorIn = 0, investorOut = 0;
    for (const t of investorTxns) {
      if (t.transaction_type === "توريد نقدية") investorIn += Number(t.amount || 0);
      else if (t.transaction_type === "صرف نقدية") investorOut += Number(t.amount || 0);
    }
    let usdConvEgp = 0, usdBalance = 0;
    for (const r of usdRows) {
      if (r.type === "conversion") {
        usdConvEgp += Number(r.egp_amount || 0);
      }
      const amt = Number(r.usd_amount || 0);
      usdBalance += r.type === "company_payment" ? -amt : amt;
    }
    let instaExp = 0, cashExp = 0;
    for (const d of deductions) {
      const a = Number(d.amount || 0);
      if (d.funding_source === "insta_company") instaExp += a;
      else if (d.funding_source === "cash_company") cashExp += a;
      else if (!d.funding_source) cashExp += a;
    }
    // USD treasury conversions can come from either insta_company or
    // cash_company; subtract from the right pool.
    let instaConv = 0, cashConv = 0;
    for (const r of usdRows) {
      if (r.type !== "conversion") continue;
      const a = Number(r.egp_amount || 0);
      if (r.source_type === "insta_company") instaConv += a;
      else if (r.source_type === "cash_company") cashConv += a;
    }
    // (cashConv falls under usdConvEgp already; track separately for insta)
    void cashConv; void usdConvEgp;

    const merchantBalance = new Map<string, number>();
    for (const t of agentTxns) {
      if (!t.merchant_id) continue;
      const net = merchantCashNet(t) + Number(t.merchant_cash_physical_amount || 0);
      merchantBalance.set(t.merchant_id, (merchantBalance.get(t.merchant_id) || 0) + net);
    }
    for (const t of cTxns) {
      if (!t.merchant_id) continue;
      const net = merchantCashNet(t) + Number(t.merchant_cash_physical_amount || 0);
      merchantBalance.set(t.merchant_id, (merchantBalance.get(t.merchant_id) || 0) - net);
    }
    for (const c of collections) {
      merchantBalance.set(
        c.merchant_id,
        (merchantBalance.get(c.merchant_id) || 0) - Number(c.amount || 0),
      );
    }
    // USD conversions sourced from a merchant wallet/physical also reduce
    // the merchant's balance.
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
      insta_company: Math.round(instaIn - instaOut - instaExp - instaConv),
      cash_company: Math.round(cashIn + investorIn - investorOut - cashOut - cashExp - (usdConvEgp - instaConv)),
      usd_treasury: Math.round(usdBalance * 100) / 100,
      merchantBalance,
    };
  }, [agentTxns, cTxns, investorTxns, deductions, usdRows, collections]);
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
