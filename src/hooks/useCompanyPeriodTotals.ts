import { useMemo } from "react";
import { cairoToday } from "@/lib/approvalFines";
import { useLive, type CompanyTransaction, type IssuingCompany } from "@/lib/db";
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

/**
 * إجماليات عرض فقط مبنية من نفس دفاتر كشف حساب الشركات الموجودة.
 * الحركات بلا شركة أو التابعة لشركة محذوفة لا تدخل في كروت حسابات الشركات،
 * وهو نفس سلوك useCompaniesSummary المستخدم في الصفحة الأصلية.
 */
export function useCompanyPeriodTotals(period: SummaryPeriod): CompanyPeriodTotals {
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const { rows: transactions } = useLive<CompanyTransaction>("company_transactions");
  const { rows: paymentSplits } = useLive<PaymentSplitCurrencyRow>("payment_splits");
  const todayISO = cairoToday();

  return useMemo(() => {
    const splitCurrencyByTxnId = resolveSplitCurrencyByRef(paymentSplits as any, "company_transactions");
    const transactionsByCompany = new Map<string, CompanyTransaction[]>();

    for (const company of companies) transactionsByCompany.set(company.id, []);
    for (const transaction of transactions) {
      const companyId = (transaction as any).company_id as string | null | undefined;
      if (!companyId) continue;
      const rows = transactionsByCompany.get(companyId);
      if (rows) rows.push(transaction);
    }

    const debit = new CurrencyMap();
    const credit = new CurrencyMap();
    const movement = new CurrencyMap();

    for (const companyTransactions of transactionsByCompany.values()) {
      const ledgerRows = buildCompanyLedgerRows(companyTransactions, splitCurrencyByTxnId);
      for (const row of ledgerRows) {
        if (!isDateInSummaryPeriod(row.date, period, todayISO)) continue;
        debit.add(row.currency, row.debit);
        credit.add(row.currency, row.credit);
        movement.add(row.currency, row.debit - row.credit);
      }
    }

    return { debit, credit, movement };
  }, [companies, transactions, paymentSplits, period, todayISO]);
}
