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
  normalizeCurrency,
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
  is_active?: boolean | null;
  method_key?: string | null;
};


type PaymentSplitBalanceRow = {
  id: string;
  cash_box_id: string | null;
  currency: string | null;
  amount: number | string | null;
  direction: "in" | "out" | string | null;
  cancelled_at?: string | null;
};

export type CashBoxBalanceInfo = {
  cashBoxId: string;
  cashBoxName: string;
  currency: string;
  currencyName: string;
  balance: number;
  calculatedBalance: number;
};

export type SourceBalances = {
  insta_company: number;
  cash_company: number;
  usd_treasury: number;
  companyBalanceByMethodCurrency: Map<string, CashBoxBalanceInfo>;
  cashBoxBalanceByIdCurrency: Map<string, CashBoxBalanceInfo>;
  merchantBalance: Map<string, number>;
};

const CURRENCY_NAMES: Record<string, string> = {
  EGP: "الجنيه المصري",
  USD: "الدولار الأمريكي",
  LYD: "الدينار الليبي",
};

const companySourceKey = (method: string, currency: unknown) =>
  `${method}|${normalizeCurrency(String(currency || "EGP"))}`;

const cashBoxKey = (cashBoxId: string, currency: unknown) =>
  `${cashBoxId}|${normalizeCurrency(String(currency || "EGP"))}`;

const num = (v: unknown) => Math.round(Number(v || 0));
const num2 = (v: unknown) => Math.round(Number(v || 0) * 100) / 100;

export function resolveCompanyCashBoxForSplit<T extends { id: string; name: string; currency: string; is_active?: boolean | null }>(
  cashBoxes: T[],
  currency: unknown,
  method: string,
): T | null {
  const code = normalizeCurrency(String(currency || "EGP"));
  const active = cashBoxes.filter((b) => b.currency === code && b.is_active !== false);
  if (code === "EGP") {
    if (method === "company_instapay") {
      return active.find((b) => b.name.includes("إنستا") && b.name.includes("الشركة")) || null;
    }
    if (method === "company_cash") {
      return active.find((b) => b.name.includes("نقدي") && b.name.includes("الشركة")) || null;
    }
  }
  return active.find((b) => b.name.includes("الرئيسية")) || active[0] || null;
}

function debugCashBoxBalance(info: CashBoxBalanceInfo, ready: boolean = true) {
  if (!import.meta.env.DEV) return;
  if (!ready) return;
  console.debug("[cash-box-balance:calculation]", {
    "Cash Box ID": info.cashBoxId,
    "Cash Box Name": info.cashBoxName,
    "Currency ID": info.currency,
    "Currency Name": info.currencyName,
    "Calculated Balance": info.calculatedBalance,
    "Stored Balance": info.balance,
  });
}

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
  const { rows: cashBoxes, loading: cashBoxesLoading } = useLive<CashBoxRow>("cash_boxes");
  const { rows: paymentSplits, loading: paymentSplitsLoading } = useLive<PaymentSplitBalanceRow>("payment_splits");
  const { rows: agentTxns } = useLive<Transaction>("transactions");
  const { rows: cTxns } = useLive<CompanyTransaction>("company_transactions");
  const { rows: deductions } = useLive<ExpenseDeduction>("expense_deductions");
  const { rows: usdRows } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");
  // Kept for consumers that expect the hook to also react to these deps.
  void deductions;

  return useMemo(() => {
    const balancesReady = !cashBoxesLoading && !paymentSplitsLoading;
    const calculatedByBoxCurrency = new Map<string, number>();
    for (const split of paymentSplits) {
      if (!split.cash_box_id || split.cancelled_at) continue;
      const currency = normalizeCurrency(String(split.currency || "EGP"));
      const amount = Number(split.amount || 0);
      const delta = split.direction === "out" ? -amount : amount;
      const key = cashBoxKey(split.cash_box_id, currency);
      calculatedByBoxCurrency.set(key, num2((calculatedByBoxCurrency.get(key) || 0) + delta));
    }

    const cashBoxBalanceByIdCurrency = new Map<string, CashBoxBalanceInfo>();
    for (const box of cashBoxes) {
      const currency = normalizeCurrency(String(box.currency || "EGP"));
      const info: CashBoxBalanceInfo = {
        cashBoxId: box.id,
        cashBoxName: box.name,
        currency,
        currencyName: CURRENCY_NAMES[currency] || currency,
        balance: num2(box.balance),
        calculatedBalance: num2(calculatedByBoxCurrency.get(cashBoxKey(box.id, currency)) || 0),
      };
      cashBoxBalanceByIdCurrency.set(cashBoxKey(box.id, currency), info);
      debugCashBoxBalance(info, balancesReady);
    }

    const balanceInfoFor = (box: CashBoxRow | null): CashBoxBalanceInfo | undefined => {
      if (!box) return undefined;
      return cashBoxBalanceByIdCurrency.get(cashBoxKey(box.id, box.currency));
    };

    const companyBalanceByMethodCurrency = new Map<string, CashBoxBalanceInfo>();
    for (const method of ["company_cash", "company_instapay"]) {
      for (const box of cashBoxes) {
        const resolved = resolveCompanyCashBoxForSplit(cashBoxes, box.currency, method);
        const info = balanceInfoFor(resolved);
        if (info) companyBalanceByMethodCurrency.set(companySourceKey(method, box.currency), info);
      }
    }

    const insta = balanceInfoFor(resolveCompanyCashBoxForSplit(cashBoxes, "EGP", "company_instapay"));
    const cash = balanceInfoFor(resolveCompanyCashBoxForSplit(cashBoxes, "EGP", "company_cash"));
    const usd = balanceInfoFor(resolveCompanyCashBoxForSplit(cashBoxes, "USD", "company_cash"));

    // Merchant balances (no cash_box mapping — aggregate raw movements)
    const merchantBalance = new Map<string, number>();
    const merchantKey = (id: string, currency: unknown) => `${id}|${normalizeCurrency(String(currency || "EGP"))}`;
    const addMerchant = (id: string, currency: unknown, delta: number) => {
      const key = merchantKey(id, currency);
      merchantBalance.set(key, (merchantBalance.get(key) || 0) + delta);
    };
    const merchantCompanyOutSourceIds = new Set(
      agentTxns
        .filter((t) => t.merchant_id && t.source_service_type === "merchant_cash_out_to_company")
        .map((t) => (t as any).source_service_id)
        .filter(Boolean),
    );
    for (const t of agentTxns) {
      if (!t.merchant_id) continue;
      if ((t as any).cancelled_at) continue;
      const cur = (t as any).payment_currency || (t as any).currency || "EGP";
      if (t.source_service_type === "merchant_cash_out") {
        addMerchant(t.merchant_id, cur, Math.abs(Number(t.paid || 0)));
        continue;
      }
      if (t.source_service_type === "merchant_cash_out_to_company") {
        addMerchant(t.merchant_id, cur, -Math.abs(Number(t.paid || 0)));
        continue;
      }
      if (t.source_service_type === "merchant_cash_out_to_agent") {
        addMerchant(t.merchant_id, cur, -Math.abs(Number(t.paid || 0)));
        continue;
      }
      const net = merchantCashNet(t) + Number(t.merchant_cash_physical_amount || 0);
      addMerchant(t.merchant_id, cur, net);
    }
    for (const t of cTxns) {
      if (!t.merchant_id) continue;
      if ((t as any).cancelled_at) continue;
      if (merchantCompanyOutSourceIds.has(t.id)) continue;
      const cur = (t as any).payment_currency || (t as any).currency || "EGP";
      const net = merchantCompanyOutflowAmount(t);
      addMerchant(t.merchant_id, cur, -net);
    }
    for (const c of collections) {
      if ((c as any).cancelled_at) continue;
      const cur = (c as any).opening_currency || (c as any).currency || "EGP";
      addMerchant(c.merchant_id, cur, -Number(c.amount || 0));
    }
    for (const r of usdRows) {
      if (r.type !== "conversion" || !r.merchant_id) continue;
      if ((r as any).cancelled_at) continue;
      if (r.source_type === "merchant_wallet" || r.source_type === "merchant_physical") {
        addMerchant(r.merchant_id, "EGP", -Number(r.egp_amount || 0));
      }
    }

    return {
      insta_company: num(insta?.balance),
      cash_company: num(cash?.balance),
      usd_treasury: num2(usd?.balance),
      companyBalanceByMethodCurrency,
      cashBoxBalanceByIdCurrency,
      merchantBalance,
    };
  }, [cashBoxes, paymentSplits, cashBoxesLoading, paymentSplitsLoading, agentTxns, cTxns, usdRows, collections]);
}


function methodSourceLabel(method: string, _merchantName?: string): string {
  switch (method) {
    case "company_instapay": return "إنستا الشركة";
    case "company_cash":     return "نقدي الشركة";
    case "merchant_instapay":return "انستا";
    case "merchant_wallet":  return "فودافون كاش";
    case "merchant_physical":return "نقدي";
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
  const usedCompany = new Map<string, { method: string; currency: string; amount: number; row: PaymentSplitRow }>();
  const usedMerchant = new Map<string, { merchantId: string; currency: string; amount: number; row: PaymentSplitRow }>();

  for (const r of splits) {
    const a = Number(r.amount) || 0;
    if (a <= 0) continue;
    if (r.method === "company_instapay" || r.method === "company_cash") {
      const currency = normalizeCurrency(r.currency);
      const key = companySourceKey(r.method, currency);
      const current = usedCompany.get(key);
      usedCompany.set(key, {
        method: r.method,
        currency,
        amount: (current?.amount || 0) + a,
        row: current?.row || r,
      });
    }
    else if (r.source === "merchant" && r.merchant_id) {
      const currency = normalizeCurrency(r.currency);
      const key = `${r.merchant_id}|${currency}`;
      const current = usedMerchant.get(key);
      usedMerchant.set(key, {
        merchantId: r.merchant_id,
        currency,
        amount: (current?.amount || 0) + a,
        row: current?.row || r,
      });
    }
  }
  void usedInsta;

  for (const [key, used] of usedCompany) {
    const info = balances.companyBalanceByMethodCurrency.get(key);
    if (!info) {
      const label = methodSourceLabel(used.method);
      return `لا توجد خزنة مطابقة لوسيلة الدفع (${label}) بعملة ${used.currency}`;
    }
    debugCashBoxBalance(info);
    if (used.amount > info.balance) {
      return `رصيد وسيلة الدفع (${info.cashBoxName}) غير كافٍ. الرصيد الحالي: ${fmt(info.balance)}، المبلغ المطلوب: ${fmt(used.amount)}`;
    }
  }
  for (const [key, used] of usedMerchant) {
    const bal = balances.merchantBalance.get(key) || 0;
    const amt = used.amount;
    if (amt > bal) {
      const name = merchants.find((m) => m.id === used.merchantId)?.merchant_name || "تاجر";
      const row = used.row;
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
