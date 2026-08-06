import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import {
  merchantCompanyOutflowAmount,
  useLive,
  type CompanyTransaction,
  type Merchant,
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
 * لا تعدّل الحركات ولا رصيد أي تاجر.
 */
export function useMerchantPeriodTotals(period: SummaryPeriod): MerchantMovementTotals {
  const { rows: merchants } = useLive<Merchant>("merchants");
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

    const movements: MerchantMovementItem[] = [];
    for (const merchant of merchants) {
      movements.push(...buildMerchantMovements(merchant.id, {
        incomingTxns,
        outgoingTxns,
        cashMoveTxns,
        collections,
        conversions,
        splits: paymentSplits as any,
      }));
    }

    const periodMovements = movements.filter((movement) =>
      isDateInSummaryPeriod(movement.date, period, todayISO),
    );
    return summarizeMerchantMovementTotals(periodMovements);
  }, [
    merchants,
    transactions,
    companyTransactions,
    collections,
    conversions,
    paymentSplits,
    period,
    todayISO,
  ]);
}
