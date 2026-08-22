import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import type { CompanyTransaction } from "@/lib/db";
import { buildCompanyLedgerRows, CurrencyMap } from "@/lib/financialSummary";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";
import { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";

type PaymentSplitCurrencyRow = {
  id: string;
  source_table: string | null;
  source_id: string | null;
  transaction_id?: string | null;
  currency: string | null;
  cancelled_at?: string | null;
};

export type CompanyPeriodTotals = {
  debit: CurrencyMap;
  credit: CurrencyMap;
  movement: CurrencyMap;
};

function resolveActiveSplitCurrencyByRef(
  splits: readonly PaymentSplitCurrencyRow[],
  sourceTable: string,
): Map<string, string> {
  const buckets = new Map<string, Set<string>>();

  for (const split of splits) {
    if (!split || split.cancelled_at || split.source_table !== sourceTable) continue;
    const referenceId = split.source_id || split.transaction_id;
    const currency = String(split.currency || "").trim().toUpperCase();
    if (!referenceId || !currency) continue;

    const currencies = buckets.get(referenceId) || new Set<string>();
    currencies.add(currency);
    buckets.set(referenceId, currencies);
  }

  const result = new Map<string, string>();
  buckets.forEach((currencies, referenceId) => {
    if (currencies.size === 1) result.set(referenceId, Array.from(currencies)[0]);
  });
  return result;
}

export function useCompanyPeriodTotals(period: SummaryPeriod): CompanyPeriodTotals {
  const { rows: transactions } = useCompleteFinancialTable<CompanyTransaction>("company_transactions");
  const { rows: paymentSplits } = useCompleteFinancialTable<PaymentSplitCurrencyRow>("payment_splits");
  const todayISO = cairoToday();

  return useMemo(() => {
    const splitCurrencyByTxnId = resolveActiveSplitCurrencyByRef(paymentSplits, "company_transactions");
    const ledgerRows = buildCompanyLedgerRows(
      transactions.filter((transaction) => Boolean((transaction as any)?.company_id)),
      splitCurrencyByTxnId,
    );

    const debit = new CurrencyMap();
    const credit = new CurrencyMap();
    const movement = new CurrencyMap();

    for (const row of ledgerRows) {
      const accountingDate = row.date || (row.raw as any)?.created_at || null;
      if (!isDateInSummaryPeriod(accountingDate, period, todayISO)) continue;
      debit.add(row.currency, row.debit);
      credit.add(row.currency, row.credit);
      movement.add(row.currency, row.debit - row.credit);
    }

    return { debit, credit, movement };
  }, [transactions, paymentSplits, period, todayISO]);
}
