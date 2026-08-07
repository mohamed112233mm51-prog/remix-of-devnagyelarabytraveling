import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import {
  merchantCompanyOutflowAmount,
  useLive,
  type CompanyTransaction,
  type MerchantCashCollection,
  type Transaction,
  type UsdTreasuryTransaction,
} from "@/lib/db";
import {
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
  const { rows: transactions } = useLive<Transaction>("transactions");
  const { rows: companyTransactions } = useLive<CompanyTransaction>("company_transactions");
  const { rows: collections } = useLive<MerchantCashCollection>("merchant_cash_collections");
  const { rows: conversions } = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  const { rows: paymentSplits } = useLive<CollectionSplitRow>("payment_splits");
  const todayISO = cairoToday();

  return useMemo(() => {
    // نفس تقسيم MerchantStatementTab حتى تظل الكروت مطابقة لكشف الحساب.
    const merchantCompanyOutSourceIds = new Set(
      transactions
        .filter((row) => row.merchant_id && row.source_service_type === "merchant_cash_out_to_company")
        .map((row) => (row as any).source_service_id)
        .filter(Boolean),
    );

    const incomingTxns = transactions.filter(
      (row) => Number(row.merchant_cash_amount || 0) > 0
        || Number(row.merchant_cash_physical_amount || 0) > 0,
    );
    const outgoingTxns = companyTransactions
      .filter((row) => merchantCompanyOutflowAmount(row) > 0)
      .filter((row) => !merchantCompanyOutSourceIds.has(row.id));
    const cashMoveTxns = transactions.filter(
      (row) => row.merchant_id && [
        "merchant_cash_out",
        "merchant_cash_out_to_company",
        "merchant_cash_out_to_agent",
      ].includes(String(row.source_service_type || "")),
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
      movements.push(...buildMerchantMovements(merchantId, {
        incomingTxns,
        outgoingTxns,
        cashMoveTxns,
        collections,
        conversions,
        splits: paymentSplits as any,
      }) as MerchantMovementItem[]);
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
