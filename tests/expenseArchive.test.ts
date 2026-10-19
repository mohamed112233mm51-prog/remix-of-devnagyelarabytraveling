import test from "node:test";
import assert from "node:assert/strict";
import { buildExpenseArchiveView, expenseAccountingDay } from "../src/lib/expenseArchive.ts";

const today = "2026-10-19";
const rows = [
  { id: "first", date: "2026-10-01", created_at: "2026-09-30T23:30:00Z", amount: 100 },
  { id: "last", date: "2026-10-31", amount: 200 },
  { id: "sept", date: "2026-09-30", created_at: "2026-10-19T00:00:00Z", amount: 300 },
  { id: "aug", date: "2026-08-01", amount: 400 },
  { id: "year", date: "2025-12-31", amount: 500 },
  { id: "future", date: "2026-11-01", amount: 600 },
  { id: "legacy", date: "", created_at: "2026-07-20T23:30:00+03:00", amount: 700 },
  { id: "unknown", date: null, created_at: null, amount: 800 },
];
const ids = (scope: "current" | "archive" | "upcoming" | "undated", month = "", data = rows, day = today) =>
  buildExpenseArchiveView(data, day, scope, month).visible.map(r => r.id);

test("default current scope includes the whole current month only, including later days", () => {
  assert.deepEqual(ids("current"), ["first", "last"]);
});
test("accounting date takes priority over creation month", () => {
  assert.equal(expenseAccountingDay(rows[0]), "2026-10-01");
  assert.equal(expenseAccountingDay(rows[2]), "2026-09-30");
});
test("archive retains every earlier month and year, newest month first", () => {
  const archive = buildExpenseArchiveView(rows, today, "archive");
  assert.deepEqual(archive.months, ["2026-09", "2026-08", "2026-07", "2025-12"]);
  assert.deepEqual(ids("archive"), ["sept", "aug", "year", "legacy"]);
});
test("selected archive month has exact records and an absent month is empty", () => {
  assert.deepEqual(ids("archive", "2026-09"), ["sept"]);
  assert.deepEqual(ids("archive", "2025-12"), ["year"]);
  assert.deepEqual(ids("archive", "2024-02"), []);
});
test("future and undated records have accessible separate scopes without leaking into current/archive", () => {
  assert.deepEqual(ids("upcoming"), ["future"]);
  assert.deepEqual(ids("undated"), ["unknown"]);
  const view = buildExpenseArchiveView(rows, today, "current");
  assert.deepEqual([view.currentCount, view.archivedCount, view.upcomingCount, view.undatedCount], [2, 4, 1, 1]);
});
test("legacy fallback preserves calendar date without converting accounting timestamps to UTC", () => {
  assert.equal(expenseAccountingDay(rows[6]), "2026-07-20");
  assert.equal(expenseAccountingDay({ id: "x", date: "2026-10-01T00:00:00+03:00" }), "2026-10-01");
});
test("malformed or impossible dates use a valid fallback or stay accessible in undated", () => {
  for (const date of ["2026-02-30", "2026-13-01", "2026-00-10", "2026-10-19oops", "invalid"]) {
    assert.equal(expenseAccountingDay({ id: "x", date, created_at: "2026-09-01T00:00:00Z" }), "2026-09-01");
    assert.equal(expenseAccountingDay({ id: "x", date }), "");
  }
  assert.equal(expenseAccountingDay({ id: "x", date: "2024-02-29" }), "2024-02-29");
});
test("month and year turnover regroup existing records without mutating financial data", () => {
  const before = structuredClone(rows);
  assert.deepEqual(ids("archive", "2026-10", rows, "2026-11-01"), ["first", "last"]);
  assert.deepEqual(ids("current", "", rows, "2026-11-01"), ["future"]);
  assert.deepEqual(ids("archive", "2025-12", rows, "2026-01-01"), ["year"]);
  assert.deepEqual(rows, before);
});
test("editing accounting date reclassifies the same row without altering its ID or amount", () => {
  const edited = rows.map(r => r.id === "sept" ? { ...r, date: "2026-10-02" } : r);
  assert.ok(ids("current", "", edited).includes("sept"));
  assert.deepEqual(ids("archive", "2026-09", edited), []);
  assert.equal(buildExpenseArchiveView(edited, today, "current").visible.find(r => r.id === "sept")?.amount, 300);
});
test("partitioning more than 1000 rows preserves identity, order and all records exactly once", () => {
  const data = Array.from({ length: 2505 }, (_, i) => ({ id: String(i), date: ["2026-10-10", "2026-09-10", "2026-11-10", null][i % 4] }));
  const groups = ["current", "archive", "upcoming", "undated"].map(scope =>
    buildExpenseArchiveView(data, today, scope as "current").visible);
  assert.equal(groups.flat().length, data.length);
  assert.equal(new Set(groups.flat().map(r => r.id)).size, data.length);
  assert.equal(groups[0][0], data[0]);
  assert.equal(buildExpenseArchiveView([], today, "archive").visible.length, 0);
});
