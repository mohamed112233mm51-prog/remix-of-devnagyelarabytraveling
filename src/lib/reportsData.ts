// Centralized data layer for the Reports page.
import { useMemo } from "react";
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
  /** Executions (post-approval trips). Live-subscribed. */
  executions: Execution[];
  /** Security approvals — now sourced from `submissions` table (live). */
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
  const a = useLive<Agent>("agents");
  const t = useLive<Transaction>("transactions");
  const c = useLive<IssuingCompany>("issuing_companies");
  const ct = useLive<CompanyTransaction>("company_transactions");
  const m = useLive<Merchant>("merchants");
  const mc = useLive<MerchantCashCollection>("merchant_cash_collections");
  const inv = useLive<Investor>("investors");
  const it = useLive<InvestorTransaction>("investor_transactions");
  const e = useLive<Expense>("expenses");
  const ed = useLive<ExpenseDeduction>("expense_deductions");
  const u = useLive<UsdTreasuryTransaction>("usd_treasury_transactions");
  const sub = useLive<Submission>("submissions");
  const ex = useLive<Execution>("executions");

  const loading =
    a.loading || t.loading || c.loading || ct.loading ||
    m.loading || mc.loading || inv.loading || it.loading ||
    e.loading || ed.loading || u.loading || sub.loading || ex.loading;

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
    agentName: (id) => (id ? agentMap.get(id) || "—" : "—"),
    companyName: (id) => (id ? companyMap.get(id) || "—" : "—"),
    merchantName: (id) => (id ? merchantMap.get(id) || "—" : "—"),
    investorName: (id) => (id ? investorMap.get(id) || "—" : "—"),
  };
}
