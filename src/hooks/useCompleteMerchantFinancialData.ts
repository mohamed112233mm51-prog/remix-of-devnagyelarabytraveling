import { useCallback } from "react";
import type {
  CompanyTransaction,
  MerchantCashCollection,
  Transaction,
  UsdTreasuryTransaction,
} from "@/lib/db";
import {
  refetchCompleteFinancialTables,
  useCompleteFinancialTable,
} from "@/hooks/useCompleteFinancialTables";

export type MerchantPaymentSplitRow = {
  id: string;
  source_table: string | null;
  source_id: string | null;
  currency: string | null;
  cancelled_at: string | null;
  [key: string]: unknown;
};

const MERCHANT_FINANCIAL_TABLES = [
  "transactions",
  "company_transactions",
  "merchant_cash_collections",
  "usd_treasury_transactions",
  "payment_splits",
] as const;

export function useCompleteMerchantFinancialData() {
  const transactionsState =
    useCompleteFinancialTable<Transaction>("transactions");
  const companyTransactionsState =
    useCompleteFinancialTable<CompanyTransaction>("company_transactions");
  const collectionsState =
    useCompleteFinancialTable<MerchantCashCollection>("merchant_cash_collections");
  const conversionsState =
    useCompleteFinancialTable<UsdTreasuryTransaction>("usd_treasury_transactions");
  const paymentSplitsState =
    useCompleteFinancialTable<MerchantPaymentSplitRow>("payment_splits");

  const reload = useCallback(
    () => refetchCompleteFinancialTables(MERCHANT_FINANCIAL_TABLES),
    [],
  );

  const errorMessage =
    transactionsState.error ||
    companyTransactionsState.error ||
    collectionsState.error ||
    conversionsState.error ||
    paymentSplitsState.error;

  return {
    transactions: transactionsState.rows,
    companyTransactions: companyTransactionsState.rows,
    collections: collectionsState.rows,
    conversions: conversionsState.rows,
    paymentSplits: paymentSplitsState.rows,
    loading:
      transactionsState.loading ||
      companyTransactionsState.loading ||
      collectionsState.loading ||
      conversionsState.loading ||
      paymentSplitsState.loading,
    error: errorMessage ? new Error(errorMessage) : null,
    reload,
  };
}
