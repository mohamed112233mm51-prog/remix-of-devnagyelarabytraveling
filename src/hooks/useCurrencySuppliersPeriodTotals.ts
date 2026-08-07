import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import { useLive } from "@/lib/db";
import { computeCurrencySupplierStatsByCurrency } from "@/lib/dashboardCollections";
import { isDateInSummaryPeriod, type SummaryPeriod } from "@/lib/summaryPeriod";

type CurrencySupplier = {
  id: string;
  status?: string | null;
};

type CurrencySupplierTransaction = {
  id: string;
  supplier_id?: string | null;
  tx_type?: string | null;
  bought_currency?: string | null;
  bought_amount?: number | string | null;
  sold_currency?: string | null;
  sold_amount?: number | string | null;
  payment_splits?: unknown;
  tx_date?: string | null;
  created_at?: string | null;
  cancelled_at?: string | null;
};

/** نفس منطق كارت موردي العملة الأصلي بعد فلترة tx_date للفترة المختارة. */
export function useCurrencySuppliersPeriodTotals(period: SummaryPeriod) {
  const { rows: suppliers } = useLive<CurrencySupplier>("currency_suppliers");
  const { rows: transactions } = useLive<CurrencySupplierTransaction>("currency_supplier_transactions");
  const todayISO = cairoToday();

  return useMemo(() => {
    const activeSupplierIds = new Set(
      suppliers
        .filter((supplier) => (supplier.status || "نشط") === "نشط")
        .map((supplier) => supplier.id),
    );
    const periodTransactions = transactions.filter((transaction) =>
      isDateInSummaryPeriod(transaction.tx_date || transaction.created_at, period, todayISO),
    );
    return {
      count: activeSupplierIds.size,
      ...computeCurrencySupplierStatsByCurrency(periodTransactions, activeSupplierIds),
    };
  }, [suppliers, transactions, period, todayISO]);
}
