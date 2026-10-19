import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { loadTsModule, flush } from "./helpers/loadTsModule.mjs";

const path = "src/features/expenses/LegacyExpensesRoute.tsx";
const source = readFileSync(new URL("../" + path, import.meta.url), "utf8");
const archive = loadTsModule("src/lib/expenseArchive.ts");
const sourceImports = text => {
  const deps = {};
  const ast = ts.createSourceFile("module.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const node of ast.statements) if (ts.isImportDeclaration(node)) deps[node.moduleSpecifier.text] = {};
  return deps;
};
const expense = (id, date, amount = 10, expense_type = "متغير") =>
  ({ id, date, amount, expense_type, expense_name: id, created_at: "2026-10-19T00:00:00Z" });
const seed = () => [expense("current", "2026-10-19", 100, "ثابت"), expense("sept", "2026-09-30", 50),
  expense("aug", "2026-08-02", 75), expense("future", "2026-11-01", 200),
  { ...expense("undated", "", 25), created_at: null }];

function harness(initial = seed()) {
  let rows = initial, loading = false, error = null, today = "2026-10-19", cells = [], cursor = 0, effects = [], dirty = false, tree;
  const calls = [], summaryInputs = [], tables = { merchants: [{ id: "m", merchant_name: "تاجر" }],
    expense_deductions: [{ expense_id: "sept", funding_source: "cash_company", amount: 30 }],
    merchant_cash_collections: [{ expense_id: "sept", merchant_id: "m", amount: 20 }] };
  let confirm = true;
  const changed = (a, b) => !a || b.some((v, i) => !Object.is(v, a[i]));
  const react = {
    useState(initial) { const i = cursor++; cells[i] ??= { value: typeof initial === "function" ? initial() : initial }; return [cells[i].value, next => { const value = typeof next === "function" ? next(cells[i].value) : next; if (!Object.is(value, cells[i].value)) { cells[i].value = value; dirty = true; } }]; },
    useMemo(fn, deps) { const i = cursor++; if (!cells[i] || changed(cells[i].deps, deps)) cells[i] = { deps, value: fn() }; return cells[i].value; },
    useEffect(fn, deps) { const i = cursor++; if (!cells[i] || changed(cells[i].deps, deps)) effects.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; }); },
  };
  const jsx = (type, props, key) => type?.name === "Controls" ? type(props) : ({ type: typeof type === "function" ? type.name : type, props: props || {}, key });
  const pagination = loadTsModule("src/hooks/usePagination.tsx", { react, "react/jsx-runtime": { jsx, jsxs: jsx } });
  const summarySource = readFileSync(new URL("../src/lib/financialSummary.ts", import.meta.url), "utf8");
  const summary = loadTsModule("src/lib/financialSummary.ts", { ...sourceImports(summarySource), react });
  const deps = { ...sourceImports(source), react, "react/jsx-runtime": { jsx, jsxs: jsx },
    "@tanstack/react-router": { createFileRoute: () => options => ({ options }) },
    "@/lib/db": { useLive: table => ({ rows: table === "expenses" ? rows : tables[table] || [], loading, error }), fmtDL: n => `EGP ${n}`, fmtUSD: n => `USD ${n}` },
    "@/lib/financialSummary": { ...summary, summarizeExpenses: input => { summaryInputs.push(input); return summary.summarizeExpenses(input); } },
    "@/hooks/usePagination": pagination, "@/lib/expenseArchive": archive,
    "@/lib/approvalFines": { cairoToday: () => today },
    "@/components/MonthPeriodPicker": { monthLabel: key => `شهر ${key}` },
    "@/lib/confirm": { confirmDialog: async () => confirm },
    "@/integrations/supabase/client": { supabase: { from() { throw Error("Archive must not query or write a parallel source"); }, rpc: async (name, args) => { calls.push({ name, args }); return { data: { ok: true } }; } } },
    sonner: { toast: { success() {}, error() {} } },
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(source + "\nexport { ExpensesHistory };", { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  new Function("require", "module", "exports", compiled)(name => deps[name], module, module.exports);
  function render() { cursor = 0; dirty = false; tree = module.exports.ExpensesHistory({ expenses: rows, loading, error }); while (effects.length) effects.shift()(); }
  async function settle() { for (let i = 0; i < 8; i++) { await flush(); if (dirty) render(); } }
  function nodes(node = tree) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== "object") return []; return [node, ...nodes(node.props.children ?? null)]; }
  function text(node) { if (Array.isArray(node)) return node.map(text).join(""); if (node == null || typeof node === "boolean") return ""; return typeof node === "object" ? text(node.props.children) : String(node); }
  const button = label => nodes().find(n => n.type === "button" && text(n).startsWith(label));
  const dataRows = () => nodes().filter(n => n.type === "tr" && n.key != null);
  const click = async label => { const control = button(label); assert.ok(control, label); await control.props.onClick(); await settle(); };
  const month = async value => { nodes().find(n => n.props["aria-label"] === "اختيار شهر أرشيف المصروفات").props.onChange({ target: { value } }); await settle(); };
  render();
  return { nodes, text, dataRows, button, click, month, settle, calls, summaryInputs,
    totals: () => summary.summarizeExpenses(summaryInputs.at(-1)),
    async update(patch) { if (patch.rows) rows = patch.rows; if (patch.today) today = patch.today; if ("loading" in patch) loading = patch.loading; if ("error" in patch) error = patch.error; dirty = true; await settle(); },
    denyConfirmation() { confirm = false; },
  };
}

test("actual history defaults to current month and archive month switching never writes", async () => {
  const h = harness(); await h.settle(); assert.deepEqual(h.dataRows().map(n => n.key), ["current"]);
  await h.click("الأرشيف"); assert.deepEqual(h.dataRows().map(n => n.key), ["sept", "aug"]);
  const select = h.nodes().find(n => n.type === "select" && n.props["aria-label"] === "اختيار شهر أرشيف المصروفات");
  assert.deepEqual(h.nodes(select).filter(n => n.type === "option").map(n => n.props.value), ["", "2026-09", "2026-08"]);
  await h.month("2026-08"); assert.deepEqual(h.dataRows().map(n => n.key), ["aug"]);
  await h.click("الشهر الحالي"); assert.deepEqual(h.dataRows().map(n => n.key), ["current"]);
  assert.deepEqual(h.calls, []);
});
test("future/undated rows remain reachable without entering the current month or previous-month archive", async () => {
  const h = harness(); await h.click("المستقبلية"); assert.deepEqual(h.dataRows().map(n => n.key), ["future"]);
  await h.click("بلا تاريخ صالح"); assert.deepEqual(h.dataRows().map(n => n.key), ["undated"]);
});
test("actual pagination reaches all 1205 rows and totals use the whole scope, not the page", async () => {
  const h = harness(Array.from({ length: 1205 }, (_, i) => expense(`row-${i}`, "2026-09-10", 2)));
  await h.click("الأرشيف"); assert.equal(h.dataRows().length, 50); assert.equal(h.totals().total, 2410);
  for (let i = 0; i < 24; i++) await h.click("التالي");
  assert.deepEqual(h.dataRows().map(n => n.key), ["row-1200", "row-1201", "row-1202", "row-1203", "row-1204"]);
  assert.equal(h.text(h.dataRows()[0].props.children[0]), "1201");
  await h.month("2026-09"); assert.equal(h.dataRows()[0].key, "row-0");
  await h.click("الشهر الحالي"); await h.click("الأرشيف"); assert.equal(h.dataRows()[0].key, "row-0");
});
test("archive totals reuse the financial engine and retain linked company/merchant payment labels", async () => {
  const h = harness(); await h.click("الأرشيف");
  assert.deepEqual(h.totals(), { total: 125, fixed: 0, variable: 125, count: 2 });
  assert.match(h.text(h.dataRows()[0]), /نقدي الشركة: EGP 30.*تاجر: EGP 20/);
  await h.month("2026-09"); assert.equal(h.totals().total, 50);
});
test("archived edit opens the original ExpenseForm with the original financial row and ID", async () => {
  const rows = seed(), h = harness(rows); await h.click("الأرشيف"); await h.click("تعديل");
  assert.equal(h.nodes()[0].type, "ExpenseForm"); assert.equal(h.nodes()[0].props.initial, rows[1]);
  h.nodes()[0].props.onDone(); await h.settle(); assert.equal(h.dataRows()[0].key, "sept");
  assert.deepEqual(h.calls, []);
});
test("archived deletion keeps confirmation and the existing single atomic RPC", async () => {
  const h = harness(); await h.click("الأرشيف"); await h.click("حذف");
  assert.deepEqual(h.calls, [{ name: "delete_expense_atomic", args: { p_expense_id: "sept" } }]);
  const cancelled = harness(); cancelled.denyConfirmation(); await cancelled.click("الأرشيف"); await cancelled.click("حذف"); assert.deepEqual(cancelled.calls, []);
});
test("Realtime date edit, deletion and month turnover regroup the same records", async () => {
  const rows = seed(), h = harness(rows); await h.click("الأرشيف");
  await h.update({ rows: rows.map(r => r.id === "sept" ? { ...r, date: "2026-10-02" } : r) });
  assert.deepEqual(h.dataRows().map(n => n.key), ["aug"]);
  await h.click("الشهر الحالي"); assert.deepEqual(h.dataRows().map(n => n.key), ["current", "sept"]);
  await h.update({ today: "2026-11-01" }); assert.deepEqual(h.dataRows().map(n => n.key), ["future"]);
  await h.update({ rows: rows.filter(r => r.id !== "future") }); assert.equal(h.dataRows().length, 0);
  assert.deepEqual(h.calls, []);
});
test("loading/failure is explicit and an existing complete snapshot remains visible", async () => {
  const h = harness([]); await h.update({ loading: true });
  assert.match(h.text(h.nodes().find(n => n.props.role === "status")), /جارٍ تحميل/);
  await h.update({ loading: false, error: "اتصال غير متاح" });
  assert.match(h.text(h.nodes().find(n => n.props.role === "alert")), /اتصال غير متاح/);
  await h.update({ rows: seed() }); assert.deepEqual(h.dataRows().map(n => n.key), ["current"]);
});
test("archive implementation preserves the existing complete cache, period summary and financial form", () => {
  const db = readFileSync(new URL("../src/lib/db.ts", import.meta.url), "utf8");
  assert.match(db, /export const useLive = useCompleteFinancialTable/);
  const page = readFileSync(new URL("../src/routes/expenses.tsx", import.meta.url), "utf8");
  assert.match(page, /useExpensePeriodTotals\(period\)/);
  assert.match(source, /executeFinancialAtomic\(/); assert.match(source, /updateFinancialTransaction\(/);
  assert.doesNotMatch(source, /expense_archives|archived_at|is_archived/);
});
