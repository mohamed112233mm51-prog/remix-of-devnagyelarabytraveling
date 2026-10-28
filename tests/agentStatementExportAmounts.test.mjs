import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as jsxRuntime from "react/jsx-runtime";
import { renderToStaticMarkup } from "react-dom/server";
import { loadTsModule } from "./helpers/loadTsModule.mjs";

// Execute the real component's export closure and existing formatters, without
// mounting database subscriptions or duplicating the export mapping in a test.
function sourceFunction(path, name, scope = {}) {
  const source = ts.createSourceFile(path, readFileSync(new URL("../" + path, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let expression;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) expression = node.initializer.getText(source);
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(source).replace(/^export\s+/, "");
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression, `${path}: ${name}`);
  const code = ts.transpileModule(`const subject = ${expression};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(scope), code + "\nreturn subject;")(...Object.values(scope));
}
const fmtNum = sourceFunction("src/lib/db.ts", "fmtNum");
const normalizeCurrency = sourceFunction("src/lib/db.ts", "normalizeCurrency");
const fmtCurrency = sourceFunction("src/lib/db.ts", "fmtCurrency", { fmtNum, normalizeCurrency, CURRENCY_LABEL: "ج.م" });
const selectStatementRows = loadTsModule("src/lib/statementImageSelection.ts").selectStatementRows;
const buildStatementPdfHtml = loadTsModule("src/lib/exportStatement.ts", {
  exceljs: {}, sonner: {}, "@/integrations/supabase/client": {}, "./branding": {},
}).buildStatementPdfHtml;

function exportData(currency = "EGP") {
  // Same signed ledger values shown in the report: cash out increases the running
  // balance by subtracting a negative credit. The following cash in reverses it.
  const rows = [
    { debit: 86980, credit: 0, balance: 86980, description: "رصيد سابق" },
    { debit: 0, credit: -50000, balance: 136980, description: "صرف نقدية للوكيل" },
    { debit: 0, credit: 50000, balance: 86980, description: "دفعة واردة" },
    { debit: -1250, credit: 0, balance: 85730, description: "تسوية مدين سالبة" },
  ].map((row, i) => ({ ...row, currency, date: `2026-10-${24 + i}`, service: "—", destination: "—", count: 0, price: 0, serviceValue: 0, methodLabel: "نقدي", note: "—", departureDate: "—" }));
  const monthlyView = { openingByCurrency: { [currency]: 86980 }, monthlyDebitByCurrency: { [currency]: -1250 }, monthlyCreditByCurrency: { [currency]: 0 }, closingBalanceByCurrency: { [currency]: 85730 } };
  const build = sourceFunction("src/components/AgentLedger.tsx", "buildExportData", {
    agentTransactionsReady: true, agent: { name: "وكيل اختبار" }, currencyFilter: "", displayRows: rows, monthlyView,
    period: { monthKey: "2026-10", start: "2026-10-01", endInclusive: "2026-10-28" },
    monthLabel: () => "أكتوبر 2026", buildArabicFileName: () => "كشف الوكيل", accountStatus: "مستحق على الوكيل",
    fmtNum, fmtCurrency, isVisible: () => true,
  });
  return { data: build(), rows };
}

function rowSelectorHtml(data) {
  let stateIndex = 0;
  const { StatementImageExportDialog } = loadTsModule("src/components/StatementImageExportDialog.tsx", {
    react: { useState: initial => [stateIndex++ === 0 ? "rows" : initial, () => {}], useMemo: fn => fn(), useRef: value => ({ current: value }), useEffect() {} },
    "react/jsx-runtime": jsxRuntime, "react-dom": { createPortal: node => node }, sonner: {},
    "@/lib/statementImage": {}, "@/lib/statementImageSelection": {}, "@/lib/whatsappShare": {},
    "@/lib/standaloneImageShare": {}, "@/lib/statementCropGeometry": {},
  }, { document: { body: {} } });
  return renderToStaticMarkup(StatementImageExportDialog({ data, onClose() {} }));
}

for (const currency of ["EGP", "USD", "LYD"]) {
  test(`agent export preserves signed debit/credit and currency in row selection (${currency})`, () => {
    const { data, rows } = exportData(currency);
    for (const [i, row] of rows.entries()) {
      assert.equal(data.rows[i].debit, row.debit ? fmtCurrency(row.debit, currency) : "—");
      assert.equal(data.rows[i].credit, row.credit ? fmtCurrency(row.credit, currency) : "—");
      assert.equal(data.rows[i].debit__excel, row.debit);
      assert.equal(data.rows[i].credit__excel, row.credit);
      assert.equal(data.rows[i].balance__excel, row.balance);
    }
    const html = rowSelectorHtml(data);
    assert.ok(html.includes(fmtCurrency(-50000, currency)), "the actual row selector must show cash out, including its minus sign and currency");
    assert.ok(html.includes(fmtCurrency(-1250, currency)), "negative debits must also remain visible");
  });
}

test("nonconsecutive selected-image rows match the full image template without recalculating balances or summary", async () => {
  const { data } = exportData();
  const before = structuredClone(data);
  const selected = selectStatementRows(data, [3, 1, 1]);
  assert.deepEqual(selected.rows, [data.rows[1], data.rows[3]]);
  assert.deepEqual(selected.summary, data.summary);
  assert.equal(selected.rows[0].balance__excel, 136980);
  const fullHtml = (await buildStatementPdfHtml(data)).html;
  const selectedHtml = (await buildStatementPdfHtml(selected)).html;
  const tableBody = html => html.match(/<tbody>([\s\S]*?)<\/tbody>/)[1].match(/<tr>[\s\S]*?<\/tr>/g);
  assert.deepEqual(tableBody(selectedHtml), [tableBody(fullHtml)[1], tableBody(fullHtml)[3]]);
  assert.ok(selectedHtml.includes(fmtCurrency(-50000, "EGP")));
  assert.deepEqual(data, before);
});
