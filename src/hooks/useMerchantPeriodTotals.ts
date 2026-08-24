import { useMemo } from "react";
import { useCompleteMerchantFinancialData } from "@/hooks/useCompleteMerchantFinancialData";
import { cairoToday } from "@/lib/approvalFines";
import {
  buildMerchantMovementInputs,
  buildMerchantMovements,
  summarizeMerchantMovementTotals,
  type MerchantMovementItem,
  type MerchantMovementTotals,
} from "@/lib/financialSummary";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";

/**
 * Period totals from the exact same merchant movements used by statements and
 * lifetime aggregates. No accounting rule is reimplemented here.
 */
export function useMerchantPeriodTotals(period: SummaryPeriod): MerchantMovementTotals {
  const {
    transactions,
    companyTransactions,
    collections,
    conversions,
    paymentSplits,
  } = useCompleteMerchantFinancialData();
  const todayISO = cairoToday();

  return useMemo(() => {
    const input = buildMerchantMovementInputs(
      transactions,
      companyTransactions,
      collections,
      conversions,
      paymentSplits as any,
    );

    // Include historical movements even if the merchant card was later deleted.
    const merchantIds = new Set<string>();
    for (const row of transactions) if (row.merchant_id) merchantIds.add(row.merchant_id);
    for (const row of companyTransactions) {
      const merchantId = (row as any).merchant_id as string | null | undefined;
      if (merchantId) merchantIds.add(merchantId);
    }
    for (const row of collections) if (row.merchant_id) merchantIds.add(row.merchant_id);
    for (const row of conversions) {
      const merchantId = (row as any).merchant_id as string | null | undefined;
      if (merchantId) merchantIds.add(merchantId);
    }

    const movements: MerchantMovementItem[] = [];
    for (const merchantId of merchantIds) {
      movements.push(...buildMerchantMovements(merchantId, input) as MerchantMovementItem[]);
    }

    const periodMovements = movements.filter((movement) => {
      const accountingDate = movement.date || (movement as any).createdAt || null;
      return isDateInSummaryPeriod(accountingDate, period, todayISO);
    });

    return summarizeMerchantMovementTotals(periodMovements);
  }, [
    transactions,
    companyTransactions,
    collections,
    conversions,
    paymentSplits,
    period,
    todayISO,
  ]);
}
