import { buildAgentLedgerRows, summarizeAgent } from "../src/lib/financialSummary";
import { computeAgentReport } from "../src/lib/sectionAccounting/agentsReport";

const agentId = "agent-1";
const base = {
  agent_id: agentId,
  destination: null,
  travel_statement: null,
  statement: null,
  payment_method: null,
  instapay_amount: 0,
  cash_amount: 0,
  mobile_cash_amount: 0,
  mobile_cash_net_amount: 0,
  arabic_tourism_cash_amount: 0,
  arabic_tourism_cash_net_amount: 0,
  merchant_cash_amount: 0,
  merchant_cash_net_amount: 0,
  merchant_cash_physical_amount: 0,
  note: null,
  merchant_id: null,
};

const txns: any[] = [
  {
    ...base,
    id: "svc-egp",
    date: "2026-08-01",
    created_at: "2026-08-01T10:00:00Z",
    count: 2,
    price: 1000,
    paid: 0,
    total_paid: 0,
    service_type: "تذاكر طيران",
    currency: "EGP",
    source_service_type: "execution",
  },
  {
    ...base,
    id: "pay-egp",
    date: "2026-08-02",
    created_at: "2026-08-02T10:00:00Z",
    count: 0,
    price: 0,
    paid: 500,
    total_paid: 500,
    cash_amount: 500,
    service_type: "دفعة من الوكيل",
    currency: "EGP",
    source_service_type: "payment",
  },
  {
    ...base,
    id: "svc-usd",
    date: "2026-08-03",
    created_at: "2026-08-03T10:00:00Z",
    count: 1,
    price: 100,
    paid: 0,
    total_paid: 0,
    service_type: "خدمة دولارية",
    currency: "EGP",
    source_service_type: "execution",
  },
  {
    ...base,
    id: "cancelled-egp",
    date: "2026-08-04",
    created_at: "2026-08-04T10:00:00Z",
    count: 10,
    price: 9999,
    paid: 0,
    total_paid: 0,
    service_type: "ملغاة",
    currency: "EGP",
    source_service_type: "execution",
    cancelled_at: "2026-08-05T00:00:00Z",
  },
];

const splits: any[] = [
  { source_table: "transactions", source_id: "svc-egp", transaction_id: null, currency: "EGP", cancelled_at: null },
  { source_table: "transactions", source_id: "pay-egp", transaction_id: null, currency: "EGP", cancelled_at: null },
  { source_table: "transactions", source_id: "svc-usd", transaction_id: null, currency: "USD", cancelled_at: null },
];

const currencyMap = new Map<string, string>([
  ["svc-egp", "EGP"],
  ["pay-egp", "EGP"],
  ["svc-usd", "USD"],
]);

const ledger = buildAgentLedgerRows(txns as any, currencyMap);
const summary = summarizeAgent(txns as any, currencyMap);
const report = computeAgentReport({
  agents: [{ id: agentId, name: "Test Agent" }],
  transactions: txns as any,
  executions: [],
  approvals: [],
  paymentSplits: splits,
});

function assertEqual(actual: unknown, expected: unknown, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

assertEqual(ledger.length, 3, "cancelled row excluded");
assertEqual(summary.totalDebit.get("EGP"), 2000, "summary EGP debit");
assertEqual(summary.totalCredit.get("EGP"), 500, "summary EGP credit");
assertEqual(summary.balance.get("EGP"), 1500, "summary EGP balance");
assertEqual(summary.totalDebit.get("USD"), 100, "summary USD debit");
assertEqual(summary.totalCredit.get("USD"), 0, "summary USD credit");
assertEqual(summary.balance.get("USD"), 100, "summary USD balance");
assertEqual(report.totals.services.get("EGP"), summary.totalDebit.get("EGP"), "report/ledger EGP debit");
assertEqual(report.totals.payments.get("EGP"), summary.totalCredit.get("EGP"), "report/ledger EGP credit");
assertEqual(report.totals.due.get("EGP"), summary.balance.get("EGP"), "report/ledger EGP balance");
assertEqual(report.totals.services.get("USD"), summary.totalDebit.get("USD"), "report/ledger USD debit");
assertEqual(report.totals.payments.get("USD"), summary.totalCredit.get("USD"), "report/ledger USD credit");
assertEqual(report.totals.due.get("USD"), summary.balance.get("USD"), "report/ledger USD balance");

console.log("AGENT_ACCOUNTING_RECONCILIATION_OK");
console.log(JSON.stringify({
  ledgerRows: ledger.length,
  EGP: { debit: summary.totalDebit.get("EGP"), credit: summary.totalCredit.get("EGP"), balance: summary.balance.get("EGP") },
  USD: { debit: summary.totalDebit.get("USD"), credit: summary.totalCredit.get("USD"), balance: summary.balance.get("USD") },
}, null, 2));
