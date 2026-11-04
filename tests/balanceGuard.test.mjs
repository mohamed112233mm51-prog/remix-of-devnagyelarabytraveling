import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { loadTsModule } from "./helpers/loadTsModule.mjs";

const db = loadTsModule("src/lib/db.ts", {
  "@/integrations/supabase/client": {}, react: {}, sonner: {},
  "@/hooks/useCompleteFinancialTables": {},
});
function guard(balance = 348, currency = "EGP") {
  const boxes = [{ id: "insta", name: "خزينة إنستا الشركة", currency, balance,
    method_key: currency === "EGP" ? "company_instapay" : "company_usd" }];
  return loadTsModule("src/lib/balanceGuard.ts", {
    react: { useMemo: fn => fn() },
    "@/lib/db": { ...db, useLive: () => ({ rows: boxes, loading: false }) },
    "@/hooks/useCompleteFinancialTables": { useCompleteFinancialTable: () => ({ rows: [], loading: false }) },
    "@/hooks/useCompleteMerchantFinancialData": { useCompleteMerchantFinancialData: () => ({
      transactions: [], companyTransactions: [], collections: [], conversions: [],
    }) },
  });
}
const split = (amount, currency = "EGP", method = "company_instapay") => ({
  uid: String(amount), source: "company", merchant_id: "", currency, method, amount: String(amount),
});

test("spending the exact 348 balance is allowed by the real source hook and guard", () => {
  const g = guard("348");
  assert.equal(g.validateSplitOutflows([split(348)], g.useSourceBalances(), []), null);
  assert.equal(g.validateSingleOutflow("إنستا الشركة", 348, 348), null);
});
test("a real fractional shortfall is blocked and shown, rather than saying 348 versus 348", () => {
  const g = guard("347.80");
  const error = g.validateSplitOutflows([split(348)], g.useSourceBalances(), []);
  assert.match(error, /الرصيد الحالي: 347\.8، المبلغ المطلوب: 348/);
  assert.match(g.validateSingleOutflow("إنستا الشركة", 347.8, 348), /347\.8/);
});
test("company source balances retain the stored fraction instead of rounding up or down", () => {
  for (const stored of ["347.999", "348.001", "348.12"]) {
    const g = guard(stored), balances = g.useSourceBalances();
    assert.equal(balances.insta_company, Number(stored));
    assert.equal(balances.companyBalanceByMethodCurrency.get("company_instapay|EGP").balance, Number(stored));
    assert.equal(g.validateSplitOutflows([split(stored)], balances, []), null);
  }
});
test("decimal payment rows exhaust the same source without binary floating-point rejection", () => {
  const g = guard("0.3");
  assert.equal(g.validateSplitOutflows([split("0.1"), split("0.2")], g.useSourceBalances(), []), null);
});
test("one cent excess across repeated rows remains blocked", () => {
  const g = guard("348");
  assert.match(g.validateSplitOutflows([split("347.9"), split("0.11")], g.useSourceBalances(), []), /المبلغ المطلوب: 348\.01/);
});
test("foreign balances keep four decimal places and currencies remain separate", () => {
  const g = guard("0.1234", "USD"), balances = g.useSourceBalances();
  assert.equal(g.validateSplitOutflows([split("0.12", "USD"), split("0.0034", "USD")], balances, []), null);
  assert.match(g.validateSplitOutflows([split("0.1235", "USD")], balances, []), /0\.1234.*0\.1235/);
  assert.match(g.validateSplitOutflows([split("0.01", "EGP")], balances, []), /لا توجد خزنة مطابقة/);
});
test("treasury formatting preserves fractions, Western digits and grouping", () => {
  assert.equal(db.fmtBalance(12347.8), "12,347.8");
  assert.equal(db.fmtBalance(348), "348");
  assert.equal(db.fmtBalance(0.0001), "0.0001");
  assert.equal(db.fmtNum(347.8), "348"); // count/general formatting is unchanged
});

test("the financial engine preflight reports the same unrounded balance", async () => {
  const engine = loadTsModule("src/lib/financialEngine.ts", {
    react: {}, "@/lib/db": db, "@/lib/financialIdempotency": {}, "@/lib/financialAtomic": {},
    "@/integrations/supabase/client": { supabase: { from: () => ({ select: () => ({ eq: () => ({
      single: async () => ({ data: { balance: "347.8" }, error: null }),
    }) }) }) } },
  });
  assert.equal(await engine.checkOutflowAllowed("insta", 347.8), null);
  assert.match(await engine.checkOutflowAllowed("insta", 348), /الرصيد الحالي: 347\.8، المبلغ المطلوب: 348/);
});

test("actual treasury report shows and exports the same fractional balance used by validation", () => {
  const source = readFileSync(new URL("../src/routes/reports.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("reports.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = Object.fromEntries(ast.statements.filter(ts.isImportDeclaration).map(n => [n.moduleSpecifier.text, {}]));
  const box = { id: "insta", name: "خزينة إنستا الشركة", currency: "EGP", balance: 347.8, opening_balance: 347.8, is_active: true };
  const react = { useMemo: fn => fn(), useState: value => [value, () => {}] };
  const jsx = (type, props) => ({ type, props: props || {} });
  const summarySource = readFileSync(new URL("../src/lib/financialSummary.ts", import.meta.url), "utf8");
  const summaryAst = ts.createSourceFile("summary.ts", summarySource, ts.ScriptTarget.Latest, true);
  const summaryDeps = Object.fromEntries(summaryAst.statements.filter(ts.isImportDeclaration).map(n => [n.moduleSpecifier.text, {}]));
  const summary = loadTsModule("src/lib/financialSummary.ts", { ...summaryDeps, react, "@/lib/db": db });
  Object.assign(imports, { react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "@tanstack/react-router": { createFileRoute: () => options => ({ options }) },
    "@/hooks/usePerm": { usePerm: () => ({ view: true, edit: true }) },
    "@/lib/db": { ...db, useLive: table => ({ rows: table === "cash_boxes" ? [box] : [], loading: false }) },
    "@/lib/financialSummary": summary,
  });
  const code = ts.transpileModule(source + "\nexport { TreasuriesReport };", { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(name => imports[name], module, module.exports);
  const tree = module.exports.TreasuriesReport({ inRange: () => true });
  const nodes = node => Array.isArray(node) ? node.flatMap(nodes) : node && typeof node === "object" ? [node, ...nodes(node.props?.children)] : [];
  const rendered = nodes(tree);
  assert.equal(rendered.find(n => n.props["data-label"] === "الرصيد").props.children, "347.8");
  const exported = rendered.find(n => n.props.getData).props.getData();
  assert.equal(exported.rows[0].balance, "347.8");
  assert.equal(exported.rows[0].balance__excel, 347.8);
});
