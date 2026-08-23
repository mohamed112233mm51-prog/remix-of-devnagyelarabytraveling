import type {
  CompanyTransaction,
  MerchantCashCollection,
  Transaction,
  UsdTreasuryTransaction,
} from "@/lib/db";
import { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";

export type MerchantPaymentSplitRow = {
  id: string;
  source_table: string | null;
  source_id: string | null;
  currency: string | null;
  cancelled_at: string | null;
  created_at?: string | null;
  [key: string]: unknown;
};

/**
 * Complete, paginated financial history used by merchant accounting.
 * Each table is loaded through the shared complete-table loader so merchant
 * accounting does not keep a second pagination/realtime implementation.
 */
export function useCompleteMerchantFinancialData() {
  const transactions = useCompleteFinancialTable<Transaction>("transactions");
  const companyTransactions = useCompleteFinancialTable<CompanyTransaction>("company_transactions");
  const collections = useCompleteFinancialTable<MerchantCashCollection>("merchant_cash_collections");
  const conversions = useCompleteFinancialTable<UsdTreasuryTransaction>("usd_treasury_transactions");
  const paymentSplits = useCompleteFinancialTable<MerchantPaymentSplitRow>("payment_splits");

  return {
    transactions: transactions.rows,
    companyTransactions: companyTransactions.rows,
    collections: collections.rows,
    conversions: conversions.rows,
    paymentSplits: paymentSplits.rows,
    loading:
      transactions.loading
      || companyTransactions.loading
      || collections.loading
      || conversions.loading
      || paymentSplits.loading,
    error:
      transactions.error
      || companyTransactions.error
      || collections.error
      || conversions.error
      || paymentSplits.error,
  };
}
