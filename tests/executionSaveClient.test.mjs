import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync(new URL("../" + p, import.meta.url), "utf8");
function load(source, deps = {}) {
  const code = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name) => {
      if (!(name in deps)) throw Error("Unexpected import: " + name);
      return deps[name];
    },
    module,
    module.exports,
  );
  return module.exports;
}
const builder = load(read("src/lib/executionPostingRows.ts"));
function client(
  response = {
    data: { ok: true, result: { execution: { id: "execution" } }, reused: false },
    error: null,
  },
) {
  const calls = [],
    confirmed = [],
    refreshed = [];
  const api = load(read("src/lib/executionPosting.ts"), {
    "@/integrations/supabase/client": {
      supabase: {
        from: () => {
          throw Error("No separate execution/ledger write or fallback is allowed");
        },
        rpc: async (name, args) => {
          calls.push({ name, args });
          return response;
        },
      },
    },
    "@/lib/executionPostingRows": builder,
    "@/lib/financialIdempotency": {
      financialOperationFingerprint: JSON.stringify,
      getOrCreateFinancialOperationId: () => "operation",
      deriveFinancialOperationUuid: (_op, key) => key,
      confirmFinancialOperation: (id) => confirmed.push(id),
    },
    "@/hooks/useCompleteFinancialTables": {
      refetchCompleteFinancialTables: async (tables) => refreshed.push(tables),
    },
    "@/lib/db": { refetchLiveTables: async (tables) => refreshed.push(tables) },
  });
  return { api, calls, confirmed, refreshed };
}
const patch = {
  passenger_name: "مسافر",
  agent_id: "agent",
  operation_status: "منفذ",
  travel_date: "2099-12-31",
  services: [{ kind: "agent", service_type: "تذكرة", agent_price: 100, count: 1, currency: "EGP" }],
};
test("create sends the execution and generated debts in exactly one existing RPC call", async () => {
  const c = client();
  await c.api.postExecutionFinancials({ executionPatch: patch });
  assert.equal(c.calls.length, 1);
  const { name, args } = c.calls[0];
  assert.equal(name, "replace_execution_financials_atomic");
  assert.equal(args.p_financial_posting_date, null);
  assert.equal(args.p_rows.action, "create");
  assert.deepEqual(args.p_rows.execution_patch, patch);
  assert.equal(args.p_rows.rows.length, 1);
  assert.equal(args.p_rows.rows[0].row.price, 100);
  assert.equal(args.p_rows.rows[0].row.date, null);
  assert.equal(c.confirmed.length, 1);
});
test("edit keeps the original financial snapshot while excluding independent FX lock fields", async () => {
  const c = client();
  const before = {
    ...patch,
    id: "execution",
    financial_posting_date: "2026-10-17",
    updated_at: "later",
    fx_locks: { USD: 50 },
    fx_locked_at: "later",
  };
  await c.api.postExecutionFinancials({
    executionId: "execution",
    executionPatch: { operation_status: "قيد التنفيذ" },
    expectedExecution: before,
  });
  const body = c.calls[0].args.p_rows;
  assert.equal(body.action, "update");
  assert.equal(body.expected.financial_posting_date, "2026-10-17");
  assert.equal(body.expected.fx_locks, undefined);
  assert.deepEqual(body.rows, []);
});
test("a rejected atomic save never falls back to separate writes or reports success", async () => {
  const c = client({ data: null, error: { message: "company insert failed" } });
  await assert.rejects(
    c.api.postExecutionFinancials({ executionPatch: patch }),
    /company insert failed/,
  );
  assert.equal(c.calls.length, 1);
  assert.equal(c.confirmed.length, 0);
  assert.equal(c.refreshed.length, 0);
});
test("delete uses the same RPC with one delete action and the expected execution snapshot", async () => {
  const c = client();
  await c.api.deleteExecutionWithFinancials("execution", { ...patch, id: "execution" });
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].name, "replace_execution_financials_atomic");
  assert.equal(c.calls[0].args.p_rows.action, "delete");
  assert.deepEqual(c.calls[0].args.p_rows.rows, []);
  assert.equal(c.calls[0].args.p_rows.expected.id, "execution");
});
