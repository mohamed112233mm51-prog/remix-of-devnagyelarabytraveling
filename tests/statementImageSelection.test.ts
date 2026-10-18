import assert from "node:assert/strict";
import test from "node:test";
import { cropRectToPixels, selectStatementRows } from "../src/lib/statementImageSelection.ts";

const fixture = {
  title: "كشف حساب",
  subtitle: "أكتوبر 2026",
  fileName: "كشف حساب الوكيل",
  summary: [
    { label: "رصيد سابق (EGP)", value: "100 EGP" },
    { label: "إجمالي مدين الشهر (EGP)", value: "350 EGP" },
    { label: "إجمالي دائن الشهر (EGP)", value: "7 EGP" },
    { label: "الرصيد الختامي (EGP)", value: "443 EGP" },
    { label: "حالة الحساب", value: "مستحق على الوكيل (EGP)" },
  ],
  columns: [
    { header: "مدين", key: "debit" }, { header: "دائن", key: "credit" },
    { header: "رصيد", key: "balance" }, { header: "السعر", key: "price" },
  ],
  // Account exports carry formatted values/raw Excel values, without a currency column.
  rows: [
    { debit: "100 EGP", debit__excel: 100, credit: "5 EGP", credit__excel: 5, balance: 195, price: 20 },
    { debit: "200 EGP", debit__excel: 200, credit: "2 EGP", credit__excel: 2, balance: 393, price: 10 },
    { debit: "50 EGP", debit__excel: 50, credit: "—", credit__excel: 0, balance: 443, price: 15 },
  ],
};

test("nonconsecutive selected rows retain all original account cards and running balances", () => {
  const before = structuredClone(fixture);
  const selected = selectStatementRows(fixture, [2, 0, 2, -1, 999, 0.5, NaN]);
  assert.deepEqual(selected.rows, [fixture.rows[0], fixture.rows[2]]);
  assert.deepEqual(selected.summary, before.summary);
  assert.deepEqual(selected.columns, before.columns);
  assert.deepEqual(fixture, before);
  assert.ok(selected.subtitle?.includes("أكتوبر 2026"));
  assert.ok(selected.subtitle?.includes("الإجماليات تخص الكشف الأصلي بالكامل"));
  assert.equal(selected.fileName, "كشف حساب الوكيل - صفوف محددة");
});

test("keep original currency-separated totals even when the selected rows use one currency", () => {
  const mixed = {
    ...fixture,
    summary: [...fixture.summary, { label: "الرصيد الختامي (USD)", value: "-50 USD" }],
    rows: fixture.rows.map((r, i) => ({ ...r, currency: i === 0 ? "USD" : "EGP" })),
  };
  for (const indices of [[0], [1, 2], [0, 1], [0, 1, 2], []]) {
    const selected = selectStatementRows(mixed, indices);
    assert.equal(selected.rows.length, indices.length);
    assert.deepEqual(selected.summary, mixed.summary);
  }
});

test("changing the selection never recalculates the source statement summary", () => {
  for (const indices of [[0], [2], [0, 1, 2], []]) {
    const selected = selectStatementRows(fixture, indices);
    assert.equal(selected.rows.length, indices.length);
    assert.deepEqual(selected.summary, fixture.summary);
  }
});

test("reports without summary cards do not invent totals for selected rows", () => {
  const data = {
    title: "تقرير",
    columns: [{ header: "مدين", key: "debit" }],
    rows: [{ debit: "2.5" }, { debit: "1.25" }],
  };
  assert.equal(selectStatementRows(data, [0, 1]).summary, undefined);
  assert.deepEqual(selectStatementRows({ ...data, summary: [] }, [0]).summary, []);
});

test("crop maps displayed drag rectangle to native pixels", () => {
  assert.deepEqual(cropRectToPixels({ x: 20, y: 10, w: 30, h: 40 }, 1000, 2000, 100, 200), { x: 200, y: 100, w: 300, h: 400 });
  assert.deepEqual(cropRectToPixels({ x: 80, y: 180, w: 100, h: 100 }, 1000, 2000, 100, 200), { x: 800, y: 1800, w: 200, h: 200 });
  assert.equal(cropRectToPixels({ x: 0, y: 0, w: 0, h: 10 }, 100, 100, 100, 100), null);
});
