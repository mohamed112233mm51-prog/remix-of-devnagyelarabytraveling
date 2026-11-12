import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadTsModule } from "./helpers/loadTsModule.mjs";

const { readReportData, REPORT_TABLES } = loadTsModule("src/lib/reportsData.ts", {
  "./readAllRows": loadTsModule("src/lib/readAllRows.ts"),
});

const schema = readFileSync(new URL("../src/integrations/supabase/types.ts", import.meta.url), "utf8");
const rowColumns = new Map([...schema.matchAll(/^      (\w+): \{\n        Row: \{\n([\s\S]*?)^        \}/gm)]
  .map(([, table, fields]) => [table, new Set([...fields.matchAll(/^          (\w+):/gm)].map(([, column]) => column))]));

function splitFilters(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "(") depth++;
    if (text[i] === ")") depth--;
    if (text[i] === "," && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  return [...parts, text.slice(start)];
}

function matches(row, filter) {
  if (filter.startsWith("or(")) return splitFilters(filter.slice(3, -1)).some(f => matches(row, f));
  if (filter.startsWith("and(")) return splitFilters(filter.slice(4, -1)).every(f => matches(row, f));
  const [, column, operator, value] = /^(\w+)\.(not\.is|is|eq|gte|lt|in)\.(.+)$/.exec(filter) || [];
  assert.ok(operator, filter);
  const field = row[column];
  if (operator === "is") return field == null;
  if (operator === "not.is") return field != null;
  if (operator === "in") return value.slice(1, -1).split(",").includes(field);
  if (operator === "eq") return field === value;
  if (field == null) return false;
  return operator === "gte" ? Date.parse(field) >= Date.parse(value) : Date.parse(field) < Date.parse(value);
}

function harness(tables, fail = () => false) {
  const calls = [];
  const client = createClient("https://reports.test", "test-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { Authorization: "Bearer report-user-session" },
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").at(-1);
        assert.equal(init?.method, "GET");
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer report-user-session");
        assert.ok(table in tables, `unexpected read: ${table}`);
        const params = url.searchParams;
        const offset = Number(params.get("offset") || 0);
        const call = { table, params, offset, rows: 0 };
        calls.push(call);
        const respond = (data, status = 200) => new Response(JSON.stringify(data), {
          status, headers: { "content-type": "application/json" },
        });
        if (fail(call)) return respond({ message: "page unavailable" }, 400);
        const columns = params.get("select").split(",");
        for (const column of columns) {
          assert.ok(column === "*" || rowColumns.get(table)?.has(column), `unknown column: ${table}.${column}`);
        }
        let rows = tables[table].filter(row => row.rls_visible !== false);
        for (const [key, value] of params) {
          if (!["select", "order", "offset", "limit"].includes(key)) {
            rows = rows.filter(row => matches(row, key === "or" ? `or${value}` : `${key}.${value}`));
          }
        }
        rows = rows.slice(offset, offset + Math.min(Number(params.get("limit") || 1000), 1000));
        call.rows = rows.length;
        return respond(columns[0] === "*" ? rows : rows.map(row =>
          Object.fromEntries(columns.map(key => [key, row[key] ?? null])),
        ));
      },
    },
  });
  return { client, calls };
}

const dates = { from: "2026-11-01", to: "2026-11-30" };
const current = { date: "2026-11-15", created_at: "2026-11-15T10:00:00Z" };
const old = { date: "2026-10-15", created_at: "2026-10-15T10:00:00Z" };
const ids = rows => rows.map(row => row.id);

test("agent report reads only selected dates and its own dependencies, including legacy currency references", async () => {
  const h = harness({
    agents: [{ id: "a", name: "Agent" }],
    transactions: [
      ...Array.from({ length: 1500 }, (_, i) => ({ ...old, id: `history-${i}` })),
      { ...current, id: "active", agent_id: "a" },
      { ...current, id: "fallback", date: null, agent_id: "a" },
      { ...current, id: "cancelled", cancelled_at: current.created_at },
      { ...current, id: "not-visible", rls_visible: false },
    ],
    executions: [
      { ...old, id: "posted-in-period", financial_posting_date: "2026-11-01", operation_status: "منفذ" },
      { ...current, id: "legacy", operation_status: "منفذ" },
      { ...current, id: "posted-outside-period", financial_posting_date: "2026-10-31", operation_status: "منفذ" },
      { ...current, id: "unexecuted", operation_status: "مسودة" },
    ],
    submissions: [
      { ...old, id: "issued-in-period", issue_date: "2026-11-30" },
      { ...current, id: "submitted-outside-period", submit_date: "2026-10-31", issue_date: "2026-11-30" },
    ],
    payment_splits: [
      { id: "current-split", source_table: "transactions", source_id: "active", currency: "USD", ...old },
      { id: "legacy-split", source_table: "transactions", transaction_id: "fallback", currency: "LYD", ...old },
      { id: "outside", source_table: "transactions", source_id: "history-0", ...old },
      { id: "other-table", source_table: "company_transactions", source_id: "active", ...current },
    ],
  });
  const data = await readReportData(h.client, "agents", dates);
  assert.deepEqual(new Set(h.calls.map(call => call.table)), new Set(REPORT_TABLES.agents));
  assert.deepEqual(ids(data.transactions), ["active", "fallback"]);
  assert.deepEqual(ids(data.executions), ["posted-in-period", "legacy"]);
  assert.deepEqual(ids(data.approvals), ["issued-in-period"]);
  assert.deepEqual(data.paymentSplits.map(row => [row.id, row.currency]), [["current-split", "USD"], ["legacy-split", "LYD"]]);
  assert.equal(h.calls.reduce((total, call) => total + call.rows, 0), 8);
});

test("company report uses the company ledger and travel-date precedence for the service chart", async () => {
  const h = harness({
    issuing_companies: [{ id: "company", company_name: "Company" }],
    company_transactions: [{ ...old, id: "older" }, { ...current, id: "current" }],
    executions: [
      { ...old, id: "travel-in-period", travel_date: "2026-11-30", operation_status: "منفذ" },
      { ...current, id: "travel-outside-period", travel_date: "2026-12-01", operation_status: "منفذ" },
    ],
    submissions: [],
    payment_splits: [{ ...old, id: "split", source_table: "company_transactions", source_id: "current", currency: "LYD" }],
  });
  const data = await readReportData(h.client, "companies", dates);
  assert.deepEqual(ids(data.companyTransactions), ["current"]);
  assert.deepEqual(ids(data.executions), ["travel-in-period"]);
  assert.deepEqual(ids(data.paymentSplits), ["split"]);
});

test("merchant report keeps linked split amounts and loads only the reference for an out-of-period mirror", async () => {
  const h = harness({
    merchants: [{ id: "merchant", merchant_name: "Merchant" }],
    transactions: [
      { ...current, id: "incoming", merchant_id: "merchant" },
      { ...current, id: "agent-only", merchant_id: null },
      { ...old, id: "old-mirror", merchant_id: "merchant", paid: 50,
        source_service_type: "merchant_cash_out_to_company", source_service_id: "company" },
    ],
    company_transactions: [{ ...current, id: "company", merchant_id: "merchant" }],
    merchant_cash_collections: [{ ...current, id: "collection", merchant_id: "merchant" }],
    usd_treasury_transactions: [{ ...current, id: "conversion", merchant_id: "merchant", type: "conversion" }],
    payment_splits: [
      { ...old, id: "merchant-insta", transaction_id: "incoming", net_amount: 12 },
      { ...old, id: "collection-currency", source_table: "merchant_cash_collections", source_id: "collection", currency: "USD" },
    ],
  });
  const data = await readReportData(h.client, "merchants", dates);
  assert.deepEqual(ids(data.transactions), ["incoming", "old-mirror"]);
  assert.deepEqual(data.transactions.at(-1), {
    id: "old-mirror", merchant_id: "merchant", source_service_id: "company",
    source_service_type: "merchant_cash_out_to_company",
  });
  assert.equal(data.paymentSplits.find(row => row.id === "merchant-insta").net_amount, 12);
  assert.equal(data.paymentSplits.find(row => row.id === "collection-currency").currency, "USD");
});

test("expense periods use the accounting date, page past the API cap, and surface an incomplete read", async () => {
  const expenses = [
    ...Array.from({ length: 1001 }, (_, i) => ({ ...current, id: `expense-${i}` })),
    { ...old, id: "old-expense", created_at: current.created_at },
    { ...current, id: "no-date", date: null },
  ];
  const h = harness({ expenses });
  const data = await readReportData(h.client, "expenses", dates);
  assert.equal(data.expenses.length, 1001);
  assert.deepEqual(h.calls.map(call => [call.offset, call.rows]), [[0, 1000], [1000, 1]]);
  const failed = harness({ expenses }, call => call.offset > 0);
  await assert.rejects(readReportData(failed.client, "expenses", dates), { message: "page unavailable" });
  const all = await readReportData(h.client, "expenses", { from: "", to: "" });
  assert.equal(all.expenses.length, expenses.length);
});

test("currency supplier report loads its own transactions and uses the trade date", async () => {
  const h = harness({
    currency_suppliers: [{ id: "supplier", name: "Supplier" }],
    currency_supplier_transactions: [
      { ...old, id: "current-trade", tx_date: "2026-11-30" },
      { ...current, id: "old-trade", tx_date: "2026-10-31" },
    ],
  });
  const data = await readReportData(h.client, "currency_suppliers", dates);
  assert.deepEqual(ids(data.supplierTransactions), ["current-trade"]);
  assert.deepEqual(ids(data.currencySuppliers), ["supplier"]);
});
