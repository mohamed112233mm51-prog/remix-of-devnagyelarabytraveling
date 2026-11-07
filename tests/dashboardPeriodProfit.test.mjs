import test from "node:test";
import assert from "node:assert/strict";
import { createClient } from "@supabase/supabase-js";
import { loadTsModule } from "./helpers/loadTsModule.mjs";

const periods = loadTsModule("src/lib/summaryPeriod.ts");
const readers = loadTsModule("src/lib/readAllRows.ts");
const profit = loadTsModule("src/lib/executionProfit.ts");
const permissions = loadTsModule("src/lib/permissionKeys.ts");
const executionColumns = "id, created_at, financial_posting_date, operation_status, services, fx_locks, fx_locked_at";

function execution(id, createdAt = "2026-11-07T12:00:00+00:00", extra = {}) {
  return {
    id: String(id).padStart(6, "0"), created_at: createdAt,
    financial_posting_date: "2020-01-01", operation_status: "منفذ", fx_locks: {},
    services: [{ agent_price: 100, company_price: 75, company_id: "company", count: 1 }],
    ...extra,
  };
}

function expense(id, createdAt = "2026-11-07T12:00:00+00:00", extra = {}) {
  return { id: String(id).padStart(6, "0"), created_at: createdAt, date: "2020-01-01", amount: 2, currency: "EGP", ...extra };
}

// Exercise the real Supabase/PostgREST client, including its generated HTTP
// filters and ranges. This endpoint models the API's 1000-row response cap.
function harness({ executions = [], expenses = [], today = "2026-11-07", allowed = true, admin = false, fail } = {}) {
  const calls = [];
  const tables = { executions, expenses };
  const client = createClient("https://profit.test", "test-publishable-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: {
      headers: { Authorization: "Bearer test-user-session" },
      fetch: async (input, init) => {
        const url = new URL(String(input));
        const table = url.pathname.split("/").at(-1);
        const method = init?.method || "GET";
        assert.equal(new Headers(init?.headers).get("authorization"), "Bearer test-user-session");
        assert.equal(method, table === "has_role" ? "POST" : "GET", "summary must remain read-only");
        const call = { table, method, params: url.searchParams, offset: Number(url.searchParams.get("offset") || 0) };
        calls.push(call);
        const respond = (body, status = 200) => new Response(JSON.stringify(body), {
          status, headers: { "Content-Type": "application/json" },
        });
        if (fail?.(call)) return respond({ message: "page unavailable", code: "TEST_FAILURE" }, 400);
        if (table === "profiles") return respond([{ permissions: { profit_summary_view: allowed }, is_super_admin: false }]);
        if (table === "has_role") return respond(admin);
        assert.ok(table in tables, `unexpected table read: ${table}`);
        let rows = tables[table].filter(row => row.rls_visible !== false);
        for (const filter of url.searchParams.getAll("created_at")) {
          const separator = filter.indexOf(".");
          const op = filter.slice(0, separator), boundary = Date.parse(filter.slice(separator + 1));
          assert.ok(op === "gte" || op === "lt");
          rows = rows.filter(row => row.created_at && (op === "gte"
            ? Date.parse(row.created_at) >= boundary : Date.parse(row.created_at) < boundary));
        }
        const order = url.searchParams.get("order");
        if (order) {
          assert.equal(order, "created_at.desc,id.desc");
          rows = [...rows].sort((a, b) => (Date.parse(b.created_at) - Date.parse(a.created_at))
            || b.id.localeCompare(a.id));
        }
        const limit = Math.min(Number(url.searchParams.get("limit") || 1000), 1000);
        const columns = url.searchParams.get("select")?.split(",").map(column => column.trim());
        rows = rows.slice(call.offset, call.offset + limit);
        call.returned = rows.length;
        return respond(rows.map(row => columns?.[0] !== "*"
          ? Object.fromEntries(columns.map(column => [column, row[column] ?? null])) : row));
      },
    },
  });
  const api = loadTsModule("src/lib/dashboardPeriodProfit.functions.ts", {
    "@tanstack/react-start": { createServerFn: () => ({
      middleware() { return this; }, inputValidator() { return this; }, handler(fn) { return fn; },
    }) },
    "@/integrations/supabase/auth-middleware": { requireSupabaseAuth: {} },
    "@/lib/permissionKeys": permissions,
    "@/lib/executionProfit": profit,
    "@/lib/approvalFines": { cairoToday: () => today },
    "@/lib/summaryPeriod": periods,
    "@/lib/readAllRows": readers,
  });
  return {
    client, calls,
    run: (period = "month") => api.getDashboardPeriodProfitSummaryData({
      context: { supabase: client, userId: "test-user" }, data: { period },
    }),
    reads: table => calls.filter(call => call.table === table),
  };
}

test("1548 history rows no longer hide the 63 November executions behind the API cap", async () => {
  const executions = Array.from({ length: 1432 }, (_, i) => execution(i, "2026-10-01T12:00:00+00:00"));
  for (let i = 0; i < 116; i++) executions.push(execution(2000 + i, undefined, {
    operation_status: i < 63 ? "منفذ" : "قيد التنفيذ",
    services: [{ agent_price: i === 62 ? 58800 : 30000,
      company_price: i === 62 ? 57952 : 28500, company_id: "company", count: 1 }],
  }));
  const expenses = Array.from({ length: 1100 }, (_, i) => expense(i, "2026-10-01T12:00:00+00:00"));
  expenses.push(expense(2000, undefined, { amount: 46500 }));
  const h = harness({ executions, expenses });
  const oldRead = await h.client.from("executions").select(executionColumns);
  assert.equal(oldRead.data.length, 1000);
  assert.equal(oldRead.data.filter(row => row.created_at.startsWith("2026-11")).length, 0);
  h.calls.length = 0;
  assert.deepEqual(await h.run(), { canProfitSummary: true, profitSummary: {
    execSales: 1918800, execCompanyCost: 1824952, expenses: 46500,
    netProfit: 47348, pendingExecutions: 0, pendingExpenses: 0,
  } });
  assert.deepEqual(h.reads("executions").map(call => call.returned), [116]);
  assert.deepEqual(h.reads("expenses").map(call => call.returned), [1]);
});

test("both sources fetch every filtered page with deterministic ties, including an exact page boundary", async () => {
  const h = harness({
    executions: [execution("old", "2026-10-31T23:59:59+00:00"),
      ...Array.from({ length: 2505 }, (_, i) => execution(i))],
    expenses: [expense("future", "2026-12-01T00:00:00+00:00"),
      ...Array.from({ length: 2000 }, (_, i) => expense(i))],
  });
  assert.deepEqual((await h.run()).profitSummary, {
    execSales: 250500, execCompanyCost: 187875, expenses: 4000,
    netProfit: 58625, pendingExecutions: 0, pendingExpenses: 0,
  });
  assert.deepEqual(h.reads("executions").map(call => [call.offset, call.returned]), [[0, 1000], [1000, 1000], [2000, 505]]);
  assert.deepEqual(h.reads("expenses").map(call => [call.offset, call.returned]), [[0, 1000], [1000, 1000], [2000, 0]]);
  for (const call of [...h.reads("executions"), ...h.reads("expenses")]) {
    assert.deepEqual(call.params.getAll("created_at"), ["gte.2026-11-01T00:00:00.000Z", "lt.2026-12-01T00:00:00.000Z"]);
    assert.equal(call.params.get("limit"), "1000");
  }
});

for (const [period, today, start, end] of [
  ["today", "2026-11-08", "2026-11-08", "2026-11-09"],
  ["week", "2026-12-01", "2026-11-29", "2026-12-06"],
  ["month", "2026-11-07", "2026-11-01", "2026-12-01"],
  ["month", "2026-12-31", "2026-12-01", "2027-01-01"],
  ["year", "2026-11-07", "2026-01-01", "2027-01-01"],
  ["all", "2026-11-07", "2026-11-01", "2026-12-01"],
]) {
  test(`${period} (${today}) preserves existing calendar boundaries and created_at accounting dates`, async () => {
    const dates = [
      new Date(Date.parse(start) - 1).toISOString(), `${start}T00:00:00.000Z`,
      new Date(Date.parse(end) - 1).toISOString(), `${end}T00:00:00.000Z`, null,
    ];
    const h = harness({ today,
      executions: dates.map((date, i) => execution(i, date)),
      expenses: dates.map((date, i) => expense(i, date)),
    });
    const count = period === "all" ? 5 : 2;
    assert.deepEqual((await h.run(period)).profitSummary, {
      execSales: count * 100, execCompanyCost: count * 75, expenses: count * 2,
      netProfit: count * 23, pendingExecutions: 0, pendingExpenses: 0,
    });
    for (const call of [...h.reads("executions"), ...h.reads("expenses")]) {
      assert.deepEqual(call.params.getAll("created_at"), period === "all" ? [] : [
        `gte.${start}T00:00:00.000Z`, `lt.${end}T00:00:00.000Z`,
      ]);
      assert.equal(call.params.has("date"), false);
      assert.equal(call.params.has("financial_posting_date"), false);
    }
  });
}

test("locked USD/LYD rates, service kinds, legacy values and pending exclusions remain unchanged", async () => {
  const executions = [
    execution(1, undefined, { fx_locks: { USD: 50 }, services: [
      { kind: "agent", currency: "EGP", count: 2, agent_price: 400, company_price: 999 },
      { kind: "company", currency: "USD", count: 9, company_price: 20, company_value: 10, agent_price: 999 },
    ] }),
    execution(2, undefined, { fx_locks: { LYD: 10 }, services: [
      { currency: "LYD", count: 2, agent_price: 20, company_price: 15, company_value: 40, company_id: "company" },
    ] }),
    execution(3, undefined, { services: [
      { kind: "agent", agent_price: 1000 }, { kind: "company", currency: "USD", company_price: 1 },
    ] }),
    execution(4, undefined, { operation_status: "ملغي" }),
  ];
  const expenses = [expense(1, undefined, { amount: 100 }),
    expense(2, undefined, { currency: "USD", amount: 2, fx_rate: 50, exchange_rate: 999 }),
    expense(3, undefined, { currency: "LYD", amount: 2, exchange_rate: 999 }),
    expense(4, undefined, { currency: "LYD", amount: 0 }),
  ];
  const snapshot = structuredClone({ executions, expenses });
  const h = harness({ executions, expenses });
  assert.deepEqual((await h.run()).profitSummary, {
    execSales: 1200, execCompanyCost: 900, expenses: 200,
    netProfit: 100, pendingExecutions: 1, pendingExpenses: 1,
  });
  assert.deepEqual({ executions, expenses }, snapshot, "read must not mutate historical locks or source data");
  assert.ok(h.calls.every(call => ["profiles", "has_role", "executions", "expenses"].includes(call.table)));
});

for (const table of ["executions", "expenses"]) {
  test(`${table}: failure on a later page rejects the summary instead of publishing partial totals`, async () => {
    const h = harness({
      executions: Array.from({ length: 1001 }, (_, i) => execution(i)),
      expenses: Array.from({ length: 1001 }, (_, i) => expense(i)),
      fail: call => call.table === table && call.offset >= 1000,
    });
    await assert.rejects(h.run(), error => error.message === "page unavailable");
    assert.ok(h.reads(table).some(call => call.offset === 1000));
  });
}

test("permission denial prevents all financial reads and allowed reads keep the user's RLS scope", async () => {
  const denied = harness({ allowed: false });
  assert.deepEqual(await denied.run(), { canProfitSummary: false, profitSummary: null });
  assert.equal(denied.reads("executions").length + denied.reads("expenses").length, 0);
  const h = harness({ allowed: false, admin: true,
    executions: [execution(1), execution(2, undefined, { rls_visible: false })],
    expenses: [expense(1), expense(2, undefined, { rls_visible: false })],
  });
  assert.deepEqual((await h.run()).profitSummary, {
    execSales: 100, execCompanyCost: 75, expenses: 2,
    netProfit: 23, pendingExecutions: 0, pendingExpenses: 0,
  });
});

test("an empty period returns zero totals", async () => {
  assert.deepEqual((await harness().run()).profitSummary, {
    execSales: 0, execCompanyCost: 0, expenses: 0,
    netProfit: 0, pendingExecutions: 0, pendingExpenses: 0,
  });
});
