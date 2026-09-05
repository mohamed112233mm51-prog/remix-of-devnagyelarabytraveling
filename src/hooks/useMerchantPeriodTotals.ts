import { useMemo } from "react";
import { useCompleteMerchantFinancialData } from "@/hooks/useCompleteMerchantFinancialData";
import { cairoToday } from "@/lib/approvalFines";
import type { Transaction } from "@/lib/db";
import {
  buildMerchantMovementInputs,
  buildMerchantMovements,
  summarizeMerchantMovementTotals,
  type MerchantMovementItem,
  type MerchantMovementTotals,
} from "@/lib/financialSummary";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";

type CollectionSplitRow = {
  id: string;
  source_table: string | null;
  source_id: string | null;
  currency: string | null;
  cancelled_at?: string | null;
};

/**
 * إجماليات عرض فقط من نفس حركات كشف حساب تاجر الكاش.
 * تدخل كل حركة مرتبطة بتاجر حتى لو حُذفت بطاقة التاجر لاحقاً،
 * وتستخدم date ثم createdAt كـ fallback للسجلات القديمة.
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
    // Same central source as merchant statement, including merchant InstaPay.
    const movementInput = buildMerchantMovementInputs(
      transactions,
      companyTransactions,
      collections,
      conversions,
      paymentSplits as any,
    );

    // نفس سياسة computeMerchantAggregates: المعرّفات تأتي من الحركات نفسها،
    // وليس فقط من بطاقات التجار الموجودة حالياً.
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
      movements.push(...buildMerchantMovements(merchantId, movementInput) as MerchantMovementItem[]);
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
