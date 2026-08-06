import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import { useLive, type CompanyTransaction } from "@/lib/db";
import {
  buildCompanyLedgerRows,
  CurrencyMap,
  resolveSplitCurrencyByRef,
} from "@/lib/financialSummary";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";

type PaymentSplitCurrencyRow = {
  id: string;
  source_table: string | null;
  source_id: string | null;
  currency: string | null;
  cancelled_at?: string | null;
};

export type CompanyPeriodTotals = {
  debit: CurrencyMap;
  credit: CurrencyMap;
  movement: CurrencyMap;
};

/** إجماليات عرض فقط من نفس صفوف كشف حساب الشركة. */
export function useCompanyPeriodTotals(period: SummaryPeriod): CompanyPeriodTotals {
  const { rows: transactions } = useLive<CompanyTransaction>("company_transactions");
  const { rows: paymentSplits } = useLive<PaymentSplitCurrencyRow>("payment_splits");
  const todayISO = cairoToday();

  return useMemo(() => {
    const splitCurrencyByTxnId = resolveSplitCurrencyByRef(paymentSplits as any, "company_transactions");
    const ledgerRows = buildCompanyLedgerRows(transactions, splitCurrencyByTxnId);
    const debit = new CurrencyMap();
    const credit = new CurrencyMap();
    const movement = new CurrencyMap();

    for (const row of ledgerRows) {
      if (!isDateInSummaryPeriod(row.date, period, todayISO)) continue;
      debit.add(row.currency, row.debit);
      credit.add(row.currency, row.credit);
      movement.add(row.currency, row.debit - row.credit);
    }

    return { debit, credit, movement };
  }, [transactions, paymentSplits, period, todayISO]);
}
