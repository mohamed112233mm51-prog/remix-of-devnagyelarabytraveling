import assert from "node:assert/strict";
import test from "node:test";
import { cropRectToPixels, selectStatementRows } from "../src/lib/statementImageSelection.ts";

const fixture = {
  title: "كشف حساب",
  summary: [{ label: "الإجمالي القديم", value: "999" }],
  columns: [
    { header: "مدين", key: "debit" }, { header: "دائن", key: "credit" },
    { header: "رصيد", key: "balance" }, { header: "السعر", key: "price" },
  ],
  rows: [
    { debit: "100", debit__excel: 100, credit: "5", credit__excel: 5, balance: 100, price: 20, currency: "EGP" },
    { debit: "200", debit__excel: 200, credit: "2", credit__excel: 2, balance: 300, price: 10, currency: "EGP" },
    { debit: "50", debit__excel: 50, credit: "0", credit__excel: 0, balance: 350, price: 15, currency: "EGP" },
  ],
};

test("select nonconsecutive rows without altering source data or order", () => {
  const selected = selectStatementRows(fixture, [2, 0, 2, -1, 999]);
  assert.deepEqual(selected.rows, [fixture.rows[0], fixture.rows[2]]);
  assert.equal(fixture.rows.length, 3);
  assert.deepEqual(fixture.summary, [{ label: "الإجمالي القديم", value: "999" }]);
  assert.equal(selected.summary?.[0].value, "2");
  assert.ok(selected.summary?.some((s) => s.label === "إجمالي مدين" && s.value === "150 EGP"));
  assert.ok(selected.summary?.some((s) => s.label === "إجمالي دائن" && s.value === "5 EGP"));
  assert.ok(!selected.summary?.some((s) => /رصيد|السعر|القديم/.test(s.label)));
});

test("do not sum monetary amounts from different currencies", () => {
  const mixed = { ...fixture, rows: fixture.rows.map((r, i) => ({ ...r, currency: i === 0 ? "USD" : "EGP" })) };
  const selected = selectStatementRows(mixed, [0, 1]);
  assert.equal(selected.summary?.length, 1);
  assert.equal(selected.summary?.[0].value, "2");
});

test("no row selected never includes original totals", () => {
  const selected = selectStatementRows(fixture, []);
  assert.equal(selected.rows.length, 0);
  assert.equal(selected.summary?.length, 1);
  assert.equal(selected.summary?.[0].value, "0");
});

test("crop maps displayed drag rectangle to native pixels", () => {
  assert.deepEqual(cropRectToPixels({ x: 20, y: 10, w: 30, h: 40 }, 1000, 2000, 100, 200), { x: 200, y: 100, w: 300, h: 400 });
  assert.deepEqual(cropRectToPixels({ x: 80, y: 180, w: 100, h: 100 }, 1000, 2000, 100, 200), { x: 800, y: 1800, w: 200, h: 200 });
  assert.equal(cropRectToPixels({ x: 0, y: 0, w: 0, h: 10 }, 100, 100, 100, 100), null);
});
