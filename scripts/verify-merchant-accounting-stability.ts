import {
  computeMerchantAggregates,
  summarizeMerchantAggregates,
  summarizeMerchantReport,
} from "../src/lib/financialSummary";

const merchantId = "merchant-1";
const baseTxn = {
  agent_id: null,
  destination: null,
  travel_statement: null,
  statement: null,
  count: 0,
  price: 0,
  paid: 0,
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
  service_type: null,
  total_paid: 0,
  note: null,
  merchant_id: merchantId,
  currency: "EGP",
};

const transactions: any[] = [
  {
    ...baseTxn,
    id: "incoming",
    date: "2026-08-01",
    created_at: "2026-08-01T10:00:00Z",
    merchant_cash_amount: 10000,
    merchant_cash_net_amount: 9900,
  },
  {
    ...baseTxn,
    id: "company-mirror",
    date: "2026-08-02",
    created_at: "2026-08-02T10:00:00Z",
    paid: -2000,
    total_paid: -2000,
    source_service_type: "merchant_cash_out_to_company",
    source_service_id: "company-out",
  },
  {
    ...baseTxn,
    id: "merchant-cashout",
    date: "2026-08-03",
    created_at: "2026-08-03T10:00:00Z",
    paid: -500,
    total_paid: -500,
    source_service_type: "merchant_cash_out",
  },
  {
    ...baseTxn,
    id: "agent-cashout",
    date: "2026-08-04",
    created_at: "2026-08-04T10:00:00Z",
    paid: -300,
    total_paid: -300,
    source_service_type: "merchant_cash_out_to_agent",
  },
  {
    ...baseTxn,
    id: "cancelled-incoming",
    date: "2026-08-05",
    created_at: "2026-08-05T10:00:00Z",
    merchant_cash_amount: 50000,
    merchant_cash_net_amount: 49500,
    cancelled_at: "2026-08-06T00:00:00Z",
  },
];

const companyTransactions: any[] = [
  {
    id: "company-out",
    company_id: "company-1",
    date: "2026-08-02",
    created_at: "2026-08-02T09:59:00Z",
    merchant_id: merchantId,
    merchant_cash_amount: 2000,
    merchant_cash_net_amount: 2000,
    merchant_cash_physical_amount: 0,
    currency: "EGP",
    total_paid: 2000,
  },
];

const collections: any[] = [
  {
    id: "collection-egp",
    merchant_id: merchantId,
    date: "2026-08-03",
    created_at: "2026-08-03T11:00:00Z",
    amount: 1000,
  },
  {
    id: "collection-usd",
    merchant_id: merchantId,
    date: "2026-08-03",
    created_at: "2026-08-03T12:00:00Z",
    amount: 50,
  },
];

const usdRows: any[] = [
  {
    id: "conversion",
    merchant_id: merchantId,
    date: "2026-08-04",
    created_at: "2026-08-04T12:00:00Z",
    type: "conversion",
    source_type: "merchant_wallet",
    egp_amount: 200,
    usd_amount: 4,
  },
];

const splits: any[] = [
  {
    id: "split-usd",
    source_table: "merchant_cash_collections",
    source_id: "collection-usd",
    currency: "USD",
    cancelled_at: null,
  },
];

const aggregates = computeMerchantAggregates({
  txns: transactions,
  companyTxns: companyTransactions,
  collections,
  usdRows,
  splits,
});
const merchant = aggregates.get(merchantId);
if (!merchant) throw new Error("merchant aggregate missing");
const totals = summarizeMerchantAggregates(aggregates);
const report = summarizeMerchantReport({
  merchants: [{ id: merchantId, merchant_name: "Test Merchant" } as any],
  transactions,
  companyTransactions,
  collections,
  usdRows,
  splits,
  inRange: () => true,
});
const row = report.rows[0];

function eq(actual: number, expected: number, label: string) {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`);
}

// EGP: +9900 incoming -2000 company -1000 collection +500 cashout -300 agent -200 conversion = 6900.
eq(merchant.incoming.get("EGP"), 9900, "incoming EGP");
eq(merchant.outgoing.get("EGP"), 2000, "outgoing EGP mirror dedupe");
eq(merchant.collected.get("EGP"), 1000, "collected EGP");
eq(merchant.paidOut.get("EGP"), 500, "paid out EGP");
eq(merchant.converted.get("EGP"), 200, "converted EGP");
eq(merchant.balance.get("EGP"), 6900, "balance EGP");
eq(merchant.balance.get("USD"), -50, "balance USD");

// The cancelled incoming row must never appear.
eq(merchant.incoming.get("EGP"), 9900, "cancelled row excluded");

// Page totals are the exact sum of per-merchant aggregates.
eq(totals.balance.get("EGP"), merchant.balance.get("EGP"), "page total EGP");
eq(totals.balance.get("USD"), merchant.balance.get("USD"), "page total USD");

// Reports must consume the same movement rules and currencies.
eq(row.incoming.get("EGP"), merchant.incoming.get("EGP"), "report incoming EGP");
eq(row.outgoing.get("EGP"), merchant.outgoing.get("EGP"), "report outgoing EGP");
eq(row.collected.get("EGP"), merchant.collected.get("EGP"), "report collected EGP");
eq(row.balance.get("EGP"), merchant.balance.get("EGP"), "report balance EGP");
eq(row.balance.get("USD"), merchant.balance.get("USD"), "report balance USD");

console.log("MERCHANT_ACCOUNTING_RECONCILIATION_OK");
