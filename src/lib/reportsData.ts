import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllRows, type ReadAllRowsFilter } from "./readAllRows";
import {
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
  transaction_id?: string | null;
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

export const REPORT_TABLES = {
  agents: ["agents", "transactions", "executions", "submissions", "payment_splits"],
  companies: ["issuing_companies", "company_transactions", "executions", "submissions", "payment_splits"],
  merchants: ["merchants", "transactions", "company_transactions", "merchant_cash_collections", "usd_treasury_transactions", "payment_splits"],
  expenses: ["expenses"],
  currency_suppliers: ["currency_suppliers", "currency_supplier_transactions"],
} as const;

export type ReportTab = keyof typeof REPORT_TABLES;
export type ScopedReportsData = Pick<ReportsData,
  "agents" | "transactions" | "executions" | "approvals" | "companies" |
  "companyTransactions" | "merchants" | "merchantCollections" |
  "usdTreasury" | "paymentSplits" | "expenses"
> & {
  currencySuppliers: { id: string; name: string }[];
  supplierTransactions: CurrencySupplierTrade[];
};

type ReportDates = { from: string; to: string };

export type CurrencySupplierTrade = {
  id: string;
  supplier_id: string;
  tx_date: string;
  tx_type: "شراء عملة" | "بيع عملة";
  bought_currency: string;
  bought_amount: number;
  sold_currency: string;
  sold_amount: number;
  exchange_rate: number | null;
  description: string | null;
  created_at: string;
  cancelled_at?: string | null;
};

/** Mirror the date precedence already used by each report's accounting helpers. */
function reportDateFilter(dates: ReportDates, ...columns: string[]): ReadAllRowsFilter {
  const { from, to } = dates;
  if (!from && !to) return (query) => query;
  const end = to ? new Date(`${to}T00:00:00.000Z`) : null;
  if (end) end.setUTCDate(end.getUTCDate() + 1);
  const endDay = end?.toISOString().slice(0, 10);
  const branches = columns.map((column, index) => {
    const predicates = columns.slice(0, index).map((previous) => `${previous}.is.null`);
    const time = column === "created_at" ? "T00:00:00.000Z" : "";
    if (from) predicates.push(`${column}.gte.${from}${time}`);
    if (endDay) predicates.push(`${column}.lt.${endDay}${time}`);
    return predicates.length === 1 ? predicates[0] : `and(${predicates.join(",")})`;
  });
  // A missing accounting date passes the existing upper-bound-only filter.
  if (!from) {
    const missing = columns.map((column) => `${column}.is.null`);
    branches.push(missing.length === 1 ? missing[0] : `and(${missing.join(",")})`);
  }
  return (query) => query.or(branches.join(","));
}

const SPLIT_COLUMNS = "id,source_table,source_id,transaction_id,currency,cancelled_at";
const MERCHANT_SPLIT_COLUMNS = SPLIT_COLUMNS + ",cash_box_id,method,amount,gross_amount,net_amount";

async function readByIdBatches<T>(
  ids: readonly string[],
  readBatch: (ids: string[]) => Promise<T[]>,
): Promise<T[]> {
  const uniqueIds = [...new Set(ids)];
  const result: T[] = [];
  // Bound the URL length when both current and legacy reference columns are queried.
  for (let index = 0; index < uniqueIds.length; index += 50) {
    const batch = await readBatch(uniqueIds.slice(index, index + 50));
    for (const row of batch) result.push(row);
  }
  return result;
}

export async function readReportData(
  client: SupabaseClient<any>,
  tab: ReportTab,
  dates: ReportDates,
  signal?: AbortSignal,
): Promise<ScopedReportsData> {
  const result: ScopedReportsData = {
    agents: [], transactions: [], executions: [], approvals: [], companies: [],
    companyTransactions: [], merchants: [], merchantCollections: [], usdTreasury: [],
    paymentSplits: [], expenses: [], currencySuppliers: [], supplierTransactions: [],
  };
  function read<T>(table: string, columns: string, filter?: ReadAllRowsFilter) {
    return readAllRows<T>(client, table, columns, (query) => {
      const filtered = filter ? filter(query) : query;
      return signal ? filtered.abortSignal(signal) : filtered;
    });
  }

  const hasDateBounds = Boolean(dates.from || dates.to);
  function readSplits(table: string, ids: string[], merchantInsta = false) {
    if (!ids.length) return Promise.resolve([]);
    if (!hasDateBounds && !merchantInsta) {
      return read<PaymentSplitLite>("payment_splits", SPLIT_COLUMNS, (query) => query.eq("source_table", table));
    }
    return readByIdBatches(ids, (batch) => read<PaymentSplitLite>("payment_splits",
      merchantInsta ? MERCHANT_SPLIT_COLUMNS : SPLIT_COLUMNS,
      (query) => {
        const scoped = merchantInsta ? query : query.eq("source_table", table);
        const refs = batch.join(",");
        return scoped.or(`source_id.in.(${refs}),and(source_id.is.null,transaction_id.in.(${refs}))`);
      },
    ));
  }
  const date = reportDateFilter(dates, "date");
  const approvalDate = reportDateFilter(dates, "submit_date", "issue_date", "created_at");
  const executionColumns = "id,created_at,operation_status,services,destination,agent_id";

  switch (tab) {
    case "agents": {
      const txnDate = reportDateFilter(dates, "date", "created_at");
      const executionDate = reportDateFilter(dates, "financial_posting_date", "created_at");
      [result.agents, result.transactions, result.executions, result.approvals] = await Promise.all([
        read<Agent>("agents", "id,name"),
        read<Transaction>("transactions", "*", (query) => txnDate(query).is("cancelled_at", null)),
        read<Execution>("executions", executionColumns + ",financial_posting_date",
          (query) => executionDate(query).eq("operation_status", "منفذ")),
        read<Submission>("submissions", "id,submit_date,issue_date,created_at,agent_id,status", approvalDate),
      ]);
      result.paymentSplits = await readSplits("transactions", result.transactions.map(({ id }) => id));
      break;
    }
    case "companies": {
      const executionDate = reportDateFilter(dates, "travel_date", "created_at");
      [result.companies, result.companyTransactions, result.executions, result.approvals] = await Promise.all([
        read<IssuingCompany>("issuing_companies", "id,company_name"),
        read<CompanyTransaction>("company_transactions", "*", (query) => date(query).is("cancelled_at", null)),
        read<Execution>("executions", executionColumns + ",travel_date",
          (query) => executionDate(query).eq("operation_status", "منفذ")),
        read<Submission>("submissions", "id,submit_date,issue_date,created_at,approval_company_id", approvalDate),
      ]);
      result.paymentSplits = await readSplits("company_transactions", result.companyTransactions.map(({ id }) => id));
      break;
    }
    case "merchants": {
      const merchantDate: ReadAllRowsFilter = (query) => date(query).not("merchant_id", "is", null);
      [result.merchants, result.transactions, result.companyTransactions, result.merchantCollections, result.usdTreasury] = await Promise.all([
        read<Merchant>("merchants", "id,merchant_name"),
        read<Transaction>("transactions", "*", merchantDate),
        read<CompanyTransaction>("company_transactions", "*", merchantDate),
        read<MerchantCashCollection>("merchant_cash_collections", "*", merchantDate),
        read<UsdTreasuryTransaction>("usd_treasury_transactions", "*",
          (query) => merchantDate(query).eq("type", "conversion")),
      ]);
      const [txnSplits, collectionSplits, mirrors] = await Promise.all([
        readSplits("transactions", result.transactions.map(({ id }) => id), true),
        readSplits("merchant_cash_collections", result.merchantCollections.map(({ id }) => id)),
        // A mirror outside the report dates still suppresses the linked company
        // row in the shared ledger. Fetch only its reference for that deduplication.
        hasDateBounds ? readByIdBatches(result.companyTransactions.map(({ id }) => id), (ids) =>
          read<Transaction>("transactions", "id,merchant_id,source_service_id,source_service_type",
            (query) => query.eq("source_service_type", "merchant_cash_out_to_company")
              .not("merchant_id", "is", null).in("source_service_id", ids)),
        ) : [],
      ]);
      result.paymentSplits = [...new Map([...txnSplits, ...collectionSplits].map((row) => [row.id, row])).values()];
      const scopedIds = new Set(result.transactions.map(({ id }) => id));
      result.transactions.push(...mirrors.filter(({ id }) => !scopedIds.has(id)));
      break;
    }
    case "expenses":
      result.expenses = await read<Expense>("expenses", "*", date);
      break;
    case "currency_suppliers":
      [result.currencySuppliers, result.supplierTransactions] = await Promise.all([
        read<{ id: string; name: string }>("currency_suppliers", "id,name"),
        read<CurrencySupplierTrade>("currency_supplier_transactions",
          "id,supplier_id,tx_date,tx_type,bought_currency,bought_amount,sold_currency,sold_amount,exchange_rate,description,created_at,cancelled_at",
          reportDateFilter(dates, "tx_date")),
      ]);
      break;
  }
  return result;
}
