import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
const source = readFileSync(
  new URL("../src/lib/financialEngine.update.ts", import.meta.url),
  "utf8",
);
const code = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function client(before, response = { data: { ok: true }, error: null }) {
  const calls = [],
    refresh = [];
  const supabase = {
    auth: { getUser: async () => ({ data: { user: { id: "user" } } }) },
    from: (table) => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: before, error: null }) }) }),
      insert: () => {
        throw Error("Client must not write audit or ledger rows separately: " + table);
      },
    }),
    rpc: async (name, args) => {
      calls.push({ name, args });
      return response;
    },
  };
  const deps = {
    "@/integrations/supabase/client": { supabase },
    "@/lib/financialEngine": {
      checkOutflowAllowed: () => {
        throw Error("Coupled edit must be validated in the database transaction");
      },
    },
    "@/hooks/useCompleteFinancialTables": {
      refetchCompleteFinancialTables: async (tables) => refresh.push(tables),
    },
    "@/lib/db": { refetchLiveTables: async (tables) => refresh.push(tables) },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (name) => {
      if (!(name in deps)) throw Error("Unexpected import " + name);
      return deps[name];
    },
    module,
    module.exports,
  );
  return { update: module.exports.updateFinancialTransaction, calls, refresh };
}
test("expense edit sends original snapshot and all changes to the existing single RPC", async () => {
  const before = { id: "expense", amount: 1000, date: "2026-10-18", currency: "EGP" };
  const c = client(before);
  await c.update({
    table: "expenses",
    id: before.id,
    expectedRow: before,
    reason: "تصحيح",
    patch: { amount: 1500, expense_name: "إيجار", date: "2026-10-17", notes: "ملاحظة" },
  });
  assert.equal(c.calls.length, 1);
  assert.deepEqual(c.calls[0], {
    name: "update_financial_transaction_atomic",
    args: {
      p_table: "expenses",
      p_id: "expense",
      p_parent_patch: {
        date: "2026-10-17",
        _expected: before,
        _reason: "تصحيح",
        _amount: 1500,
        expense_name: "إيجار",
        notes: "ملاحظة",
      },
      p_split_patches: [],
    },
  });
  assert.equal(c.refresh.length, 2);
});
test("currency sale edit sends foreign quantity to SQL without scaling client splits or changing the recorded rate", async () => {
  const before = {
    id: "trade",
    tx_type: "بيع عملة",
    tx_date: "2026-10-18",
    bought_amount: 5000,
    sold_amount: 100,
    exchange_rate: 50,
  };
  const c = client(before);
  await c.update({
    table: "currency_supplier_transactions",
    id: before.id,
    expectedRow: before,
    reason: "تصحيح",
    patch: { amount: 200 },
  });
  assert.equal(c.calls.length, 1);
  assert.equal(c.calls[0].args.p_parent_patch._amount, 200);
  assert.deepEqual(c.calls[0].args.p_split_patches, []);
  assert.equal(c.calls[0].args.p_parent_patch.exchange_rate, undefined);
});
test("database rejection is propagated without a direct-write fallback or refresh-as-success", async () => {
  const c = client(
    { id: "expense", amount: 1000, date: "2026-10-18", currency: "EGP" },
    { data: null, error: { message: "stale snapshot" } },
  );
  await assert.rejects(
    c.update({ table: "expenses", id: "expense", reason: "تصحيح", patch: { amount: 1500 } }),
    /stale snapshot/,
  );
  assert.equal(c.calls.length, 1);
  assert.equal(c.refresh.length, 0);
});
test("invalid amount or missing reason never reaches the financial write RPC", async () => {
  const c = client({ id: "expense", amount: 1000, date: "2026-10-18", currency: "EGP" });
  await assert.rejects(
    c.update({ table: "expenses", id: "expense", reason: "", patch: { amount: 1500 } }),
    /سبب التعديل/,
  );
  await assert.rejects(
    c.update({ table: "expenses", id: "expense", reason: "تصحيح", patch: { amount: Infinity } }),
    /رقمًا صالحًا/,
  );
  assert.equal(c.calls.length, 0);
});
