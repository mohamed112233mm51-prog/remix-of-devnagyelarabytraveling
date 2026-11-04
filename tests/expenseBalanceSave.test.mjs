import test, { before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { PGlite } from "@electric-sql/pglite";
import { loadTsModule } from "./helpers/loadTsModule.mjs";

const database = new PGlite();
const read = path => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const boxId = uuid(1);
before(async () => {
  await database.exec(read("tests/fixtures/financialEditDatabase.sql"));
  await database.exec(`
    ALTER TABLE public.expenses ADD COLUMN payment_method text, ADD COLUMN usd_amount numeric,
      ADD COLUMN exchange_rate numeric, ADD COLUMN fx_rate numeric, ADD COLUMN fx_locked_at timestamptz;
    ALTER TABLE public.payment_splits ADD COLUMN transaction_id uuid, ADD COLUMN merchant_commission_rate numeric;
    GRANT INSERT ON public.expenses, public.expense_deductions, public.payment_splits TO authenticated;
    CREATE POLICY insert_expense ON public.expenses FOR INSERT TO authenticated WITH CHECK(true);
    CREATE POLICY insert_deduction ON public.expense_deductions FOR INSERT TO authenticated WITH CHECK(true);
    CREATE POLICY insert_split ON public.payment_splits FOR INSERT TO authenticated WITH CHECK(true);
  `);
  await database.exec(read("supabase/migrations/20260830004000_financial_atomic_operations.sql"));
  await database.exec(read("supabase/migrations/20260830007200_financial_atomic_validation_hardening.sql"));
  const triggerSource = read("supabase/migrations/20261017234044_financial_edit_consistency.sql");
  const triggerStart = triggerSource.indexOf("CREATE OR REPLACE FUNCTION public.apply_payment_split_to_cash_box()");
  await database.exec(triggerSource.slice(triggerStart, triggerSource.indexOf("$$;", triggerStart) + 3));
  await database.exec(`CREATE TRIGGER split_balance AFTER INSERT OR UPDATE OR DELETE ON public.payment_splits
    FOR EACH ROW EXECUTE FUNCTION public.apply_payment_split_to_cash_box()`);
  const all = read("supabase/all_migrations.sql");
  const start = all.lastIndexOf("CREATE OR REPLACE FUNCTION public.enforce_cash_box_non_negative_balance()");
  await database.exec(all.slice(start, all.indexOf("$$;", start) + 3));
  await database.exec(`CREATE TRIGGER cash_nonnegative BEFORE UPDATE OF balance ON public.cash_boxes
    FOR EACH ROW EXECUTE FUNCTION public.enforce_cash_box_non_negative_balance()`);
});
beforeEach(async () => database.exec("RESET ROLE; TRUNCATE financial_operation_requests, payment_splits, expense_deductions, merchant_cash_collections, expenses, cash_boxes CASCADE"));
after(async () => database.close());

function formHarness(visibleBalance) {
  const boxes = [{ id: boxId, name: "خزينة إنستا الشركة", currency: "EGP", balance: visibleBalance, method_key: "company_instapay" }];
  const calls = [], messages = [];
  const supabase = {
    rpc: async (name, args) => {
      calls.push({ name, args });
      assert.equal(name, "execute_financial_atomic");
      await database.query("SELECT set_config('request.jwt.claim.sub',$1,false)", [uuid(999)]);
      await database.exec("SET ROLE authenticated");
      try {
        const result = await database.query("SELECT public.execute_financial_atomic($1,$2,$3::jsonb,$4::jsonb) AS result",
          [args.p_operation_id, args.p_fingerprint, JSON.stringify(args.p_rows), JSON.stringify(args.p_result)]);
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
      finally { await database.exec("RESET ROLE"); }
    },
    from: () => { throw Error("Expense must use the existing atomic RPC for financial writes"); },
  };
  let cells = [], cursor = 0, tree;
  const react = { useMemo: fn => fn(), useState: initial => {
    const index = cursor++;
    if (!(index in cells)) cells[index] = initial;
    return [cells[index], value => { cells[index] = typeof value === "function" ? value(cells[index]) : value; }];
  } };
  const jsx = (type, props) => ({ type, props: props || {} });
  const data = loadTsModule("src/lib/db.ts", { "@/integrations/supabase/client": { supabase }, react, sonner: {}, "@/hooks/useCompleteFinancialTables": {} });
  const db = { ...data, useLive: table => ({ rows: table === "cash_boxes" ? boxes : [], loading: false }) };
  const guard = loadTsModule("src/lib/balanceGuard.ts", { react, "@/lib/db": db,
    "@/hooks/useCompleteFinancialTables": { useCompleteFinancialTable: () => ({ rows: [], loading: false }) },
    "@/hooks/useCompleteMerchantFinancialData": { useCompleteMerchantFinancialData: () => ({ transactions: [], companyTransactions: [], collections: [], conversions: [] }) },
  });
  const idempotency = loadTsModule("src/lib/financialIdempotency.ts", { "@/integrations/supabase/client": { supabase } });
  const atomic = loadTsModule("src/lib/financialAtomic.ts", { "@/integrations/supabase/client": { supabase }, "@/lib/financialIdempotency": idempotency });
  const splits = loadTsModule("src/components/PaymentSplits.tsx", { react, "react/jsx-runtime": { jsx, jsxs: jsx }, "@/lib/directTransferPaymentMethod": {} });
  const source = read("src/features/expenses/LegacyExpensesRoute.tsx");
  const ast = ts.createSourceFile("form.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const deps = Object.fromEntries(ast.statements.filter(ts.isImportDeclaration).map(n => [n.moduleSpecifier.text, {}]));
  Object.assign(deps, { react, "react/jsx-runtime": { jsx, jsxs: jsx }, "@/lib/db": db,
    "@tanstack/react-router": { createFileRoute: () => options => ({ options }) },
    "@/components/PaymentSplits": splits, "@/lib/balanceGuard": guard,
    "@/lib/financialIdempotency": idempotency, "@/lib/financialAtomic": atomic,
    "@/lib/merchantBalanceGuard": { assertMerchantOutflowsAllowed: async () => null },
    "@/lib/financialAudit": { logCreate: async () => {} },
    sonner: { toast: { loading() {}, error: value => messages.push(value), success: value => messages.push(value) } },
  });
  const code = ts.transpileModule(source + "\nexport { ExpenseForm };", { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => deps[name], module, module.exports);
  const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
  const render = () => { cursor = 0; tree = module.exports.ExpenseForm(); };
  render();
  return { calls, messages, async save(amount, amounts = [amount]) {
    cells[0] = { ...cells[0], expense_name: "مصروف اختبار", amount: String(amount) };
    cells[1] = amounts.map(a => ({ ...splits.newPaymentSplitRow(), method: "company_instapay", amount: String(a) }));
    render();
    await nodes(tree).find(n => n.type === "button" && n.props.onClick && n.props.disabled !== undefined).props.onClick();
  } };
}
const seed = balance => database.query("INSERT INTO cash_boxes(id,name,currency,balance) VALUES($1,'خزينة إنستا الشركة','EGP',$2)", [boxId, balance]);
const balance = async () => (await database.query("SELECT balance::text AS balance FROM cash_boxes WHERE id=$1", [boxId])).rows[0].balance;
const count = async table => Number((await database.query(`SELECT count(*) AS count FROM ${table}`)).rows[0].count);

test("actual expense form saves 348 once through the existing atomic RPC and exhausts the box", async () => {
  await seed("348"); const h = formHarness("348"); await h.save(348);
  assert.equal(h.calls.length, 1); assert.equal(await balance(), "0");
  assert.equal(await count("expenses"), 1); assert.equal(await count("expense_deductions"), 1); assert.equal(await count("payment_splits"), 1);
  const { name, args } = h.calls[0];
  const retried = await database.query("SELECT public.execute_financial_atomic($1,$2,$3::jsonb,$4::jsonb) AS result", [args.p_operation_id, args.p_fingerprint, JSON.stringify(args.p_rows), JSON.stringify(args.p_result)]);
  assert.equal(name, "execute_financial_atomic"); assert.equal(retried.rows[0].result.reused, true);
  assert.equal(await balance(), "0"); assert.equal(await count("payment_splits"), 1);
});
test("actual form blocks a real fractional shortfall before any financial write", async () => {
  await seed("347.8"); const h = formHarness("347.8"); await h.save(348);
  assert.equal(h.calls.length, 0); assert.match(h.messages.at(-1), /347\.8/);
  assert.equal(await count("expenses"), 0); assert.equal(await balance(), "347.8");
});
test("decimal payment rows pass the form and SQL numeric leaves exactly zero", async () => {
  await seed("0.3"); const h = formHarness("0.3"); await h.save(0.3, [0.1, 0.2]);
  assert.equal(h.calls.length, 1); assert.equal(await balance(), "0.0");
  assert.equal(await count("expense_deductions"), 2); assert.equal(await count("payment_splits"), 2);
});
test("a stale visible balance cannot bypass the locked DB guard and all expense rows roll back", async () => {
  await seed("347.99"); const h = formHarness("348"); await h.save(348);
  assert.equal(h.calls.length, 1); assert.match(h.messages.at(-1), /غير كاف/);
  for (const table of ["expenses", "expense_deductions", "payment_splits", "financial_operation_requests"]) assert.equal(await count(table), 0);
  assert.equal(await balance(), "347.99");
});
