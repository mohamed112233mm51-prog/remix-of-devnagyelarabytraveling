// Centralized data layer for the Reports page.
import { useMemo } from "react";
import { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";
import {
  useLive,
  type Agent,
  type CompanyTransaction,
  type Execution,
  type Expense,
  type ExpenseDeduction,
  type Investor,
  type InvestorTransaction,
  type IssuingCompany,
  type Merchant,
  type MerchantCashCollection,
  type Submission,
  type Transaction,
  type UsdTreasuryTransaction,
} from "./db";

export type PaymentSplitLite = {
  id: string;
  source_table: string | null;
  source_id: string | null;
  currency: string | null;
  cancelled_at: string | null;
};

export type ReportsData = {
  loading: boolean;
  agents: Agent[];
  /** @deprecated flights table removed — always [] */
  flights: any[];
  executions: Execution[];
  approvals: Submission[];
  submissions: Submission[];
  transactions: Transaction[];
  companies: IssuingCompany[];
  companyTransactions: CompanyTransaction[];
  merchants: Merchant[];
  merchantCollections: MerchantCashCollection[];
  investors: Investor[];
  investorTransactions: InvestorTransaction[];
  expenses: Expense[];
  expenseDeductions: ExpenseDeduction[];
  usdTreasury: UsdTreasuryTransaction[];
  paymentSplits: PaymentSplitLite[];
  agentName: (id: string | null | undefined) => string;
  companyName: (id: string | null | undefined) => string;
  merchantName: (id: string | null | undefined) => string;
  investorName: (id: string | null | undefined) => string;
};

export function useReportsData(): ReportsData {
  // Small master-data tables stay live; they are bounded and benefit from realtime updates.
  const a = useLive<Agent>("agents");
  const c = useLive<IssuingCompany>("issuing_companies");
  const m = useLive<Merchant>("merchants");
  const inv = useLive<Investor>("investors");

  // Growing history tables must never depend on the implicit API row cap.
  const t = useCompleteFinancialTable<Transaction>("transactions");
  const ct = useCompleteFinancialTable<CompanyTransaction>("company_transactions");
  const mc = useCompleteFinancialTable<MerchantCashCollection>("merchant_cash_collections");
  const it = useCompleteFinancialTable<InvestorTransaction>("investor_transactions");
  const e = useCompleteFinancialTable<Expense>("expenses");
  const ed = useCompleteFinancialTable<ExpenseDeduction>("expense_deductions");
  const u = useCompleteFinancialTable<UsdTreasuryTransaction>("usd_treasury_transactions");
  const sub = useCompleteFinancialTable<Submission>("submissions");
  const ex = useCompleteFinancialTable<Execution>("executions");
  const ps = useCompleteFinancialTable<PaymentSplitLite>("payment_splits");

  const loading =
    a.loading || c.loading || m.loading || inv.loading ||
    t.loading || ct.loading || mc.loading || it.loading || e.loading || ed.loading ||
    u.loading || sub.loading || ex.loading || ps.loading;

  const agentMap = useMemo(() => new Map(a.rows.map((x) => [x.id, x.name])), [a.rows]);
  const companyMap = useMemo(() => new Map(c.rows.map((x) => [x.id, x.company_name])), [c.rows]);
  const merchantMap = useMemo(() => new Map(m.rows.map((x) => [x.id, x.merchant_name])), [m.rows]);
  const investorMap = useMemo(() => new Map(inv.rows.map((x) => [x.id, x.investor_name])), [inv.rows]);

  return {
    loading,
    agents: a.rows,
    flights: [] as any[],
    executions: ex.rows,
    approvals: sub.rows,
    submissions: sub.rows,
    transactions: t.rows,
    companies: c.rows,
    companyTransactions: ct.rows,
    merchants: m.rows,
    merchantCollections: mc.rows,
    investors: inv.rows,
    investorTransactions: it.rows,
    expenses: e.rows,
    expenseDeductions: ed.rows,
    usdTreasury: u.rows,
    paymentSplits: ps.rows,
    agentName: (id) => (id ? agentMap.get(id) || "—" : "—"),
    companyName: (id) => (id ? companyMap.get(id) || "—" : "—"),
    merchantName: (id) => (id ? merchantMap.get(id) || "—" : "—"),
    investorName: (id) => (id ? investorMap.get(id) || "—" : "—"),
  };
}
