import test from "node:test";
import assert from "node:assert/strict";
import {
  buildReconciliationFileRows,
  detectPassengerColumns,
  filterExecutionsForTrip,
  normalizePassengerName,
  reconcilePassengerRows,
} from "../src/lib/executionTripReconciliation.ts";
import {
  detectTripDateColumn,
  inferSingleTripDate,
  parseManifestTripDate,
} from "../src/lib/executionTripManifestDate.ts";

const execution = (id: string, name: string, overrides: Record<string, unknown> = {}) => ({
  id,
  passenger_name: name,
  passport: null,
  national_id: null,
  operation_status: "قيد التنفيذ",
  travel_date: "2026-09-20",
  departure_from: "القاهرة",
  destination: "طرابلس",
  airline: "البراق",
  approval_company_id: "company-1",
  ...overrides,
});

test("normalizes safe Arabic name variations", () => {
  assert.equal(normalizePassengerName("  مُحَمَّــد   أحمــد  "), "محمد احمد");
  assert.equal(normalizePassengerName("إبراهيم على"), "ابراهيم علي");
});

test("filters candidates to the selected trip and excludes cancelled executions", () => {
  const rows = [
    execution("1", "محمد علي"),
    execution("2", "أحمد علي", { travel_date: "2026-09-21" }),
    execution("3", "سامي علي", { airline: "الليبية" }),
    execution("4", "طارق علي", { operation_status: "ملغي" }),
  ];
  const filtered = filterExecutionsForTrip(rows, {
    travelDate: "20/09/2026",
    airline: "البراق",
    approvalCompanyId: "company-1",
  });
  assert.deepEqual(filtered.map((item) => item.id), ["1"]);
});

test("matches a unique exact normalized name automatically", () => {
  const result = reconcilePassengerRows(
    [{ index: 0, name: "محمد   أحمد علي" }],
    [execution("1", "محمد أحمد علي")],
  );
  assert.equal(result[0].status, "matched");
  assert.equal(result[0].execution?.id, "1");
  assert.equal(result[0].matchReason, "exact_name");
});

test("matches exact passport even when the name spelling differs", () => {
  const result = reconcilePassengerRows(
    [{ index: 0, name: "Mohamed A. Ali", passport: "a 123-45" }],
    [execution("1", "محمد أحمد علي", { passport: "A12345" })],
  );
  assert.equal(result[0].status, "matched");
  assert.equal(result[0].matchReason, "identifier");
});

test("matches exact national id", () => {
  const result = reconcilePassengerRows(
    [{ index: 0, name: "اسم مختلف", nationalId: "٢٩٨٠١٠١١٢٣٤٥٦٧" }],
    [execution("1", "محمد أحمد", { national_id: "29801011234567" })],
  );
  assert.equal(result[0].status, "matched");
  assert.equal(result[0].execution?.id, "1");
});

test("does not auto-pick duplicate exact names in the system", () => {
  const result = reconcilePassengerRows(
    [{ index: 0, name: "أحمد محمد علي" }],
    [execution("1", "احمد محمد علي"), execution("2", "أحمد محمد علي")],
  );
  assert.equal(result[0].status, "review");
  assert.equal(result[0].candidates.length, 2);
});

test("fuzzy typo is review-only and never auto-executed", () => {
  const result = reconcilePassengerRows(
    [{ index: 0, name: "محمد احمد عبدلله" }],
    [execution("1", "محمد احمد عبدالله")],
  );
  assert.equal(result[0].status, "review");
  assert.equal(result[0].matchReason, "fuzzy_name");
  assert.equal(result[0].execution, null);
});

test("marks already executed exact matches separately", () => {
  const result = reconcilePassengerRows(
    [{ index: 0, name: "محمد أحمد" }],
    [execution("1", "محمد أحمد", { operation_status: "منفذ" })],
  );
  assert.equal(result[0].status, "already_executed");
});

test("does not execute the same system execution twice for duplicate file rows", () => {
  const result = reconcilePassengerRows(
    [{ index: 0, name: "محمد أحمد" }, { index: 1, name: "محمد أحمد" }],
    [execution("1", "محمد أحمد")],
  );
  assert.deepEqual(result.map((item) => item.status), ["matched", "duplicate"]);
});

test("keeps non-matching file names unmatched", () => {
  const result = reconcilePassengerRows(
    [{ index: 0, name: "شخص غير موجود تماما" }],
    [execution("1", "محمد أحمد علي")],
  );
  assert.equal(result[0].status, "unmatched");
});

test("detects common Excel headers and builds temporary rows", () => {
  const headers = ["اسم الراكب", "رقم الجواز", "الرقم القومي", "شركة"];
  const columns = detectPassengerColumns(headers);
  assert.deepEqual(columns, {
    name: "اسم الراكب",
    passport: "رقم الجواز",
    nationalId: "الرقم القومي",
  });
  const rows = buildReconciliationFileRows([
    { "اسم الراكب": "محمد علي", "رقم الجواز": "P1", "الرقم القومي": "N1", شركة: "X" },
  ], columns);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].passport, "P1");
  assert.equal(rows[0].raw?.شركة, "X");
});

test("does not auto-match when supplied identifiers contradict each other", () => {
  const result = reconcilePassengerRows(
    [{ index: 0, name: "محمد أحمد علي", passport: "P1", nationalId: "N2" }],
    [execution("1", "محمد أحمد علي", { passport: "P1", national_id: "N1" })],
  );
  assert.equal(result[0].status, "review");
});

test("detects the real manifest travel-date header spelling", () => {
  assert.equal(
    detectTripDateColumn(["اسم المسافر", "الرقم القومى ", "تاريخ المغادره", "الوكيل", "الشركه الصادره"]),
    "تاريخ المغادره",
  );
});

test("parses the uploaded workbook Excel serial as 2026-09-01", () => {
  assert.equal(parseManifestTripDate(46266), "2026-09-01");
});

test("falls back to SheetJS m/d/yy display dates", () => {
  assert.equal(parseManifestTripDate("9/1/26"), "2026-09-01");
});

test("infers one trip date from formatted and raw workbook rows", () => {
  const headers = ["اسم المسافر", "الرقم القومى ", "تاريخ المغادره", "الوكيل", "الشركه الصادره"];
  const rows = [{
    "اسم المسافر": "T",
    "الرقم القومى ": "256643tgf",
    "تاريخ المغادره": "9/1/26",
    "الوكيل": "الصياد",
    "الشركه الصادره": "دروب",
  }];
  const rawRows = [{ ...rows[0], "تاريخ المغادره": 46266 }];
  const inferred = inferSingleTripDate(headers, rows, rawRows);
  assert.equal(inferred.column, "تاريخ المغادره");
  assert.equal(inferred.date, "2026-09-01");
  assert.deepEqual(inferred.dates, ["2026-09-01"]);
});

test("does not guess when the manifest contains multiple travel dates", () => {
  const headers = ["اسم المسافر", "تاريخ المغادرة"];
  const rows = [
    { "اسم المسافر": "A", "تاريخ المغادرة": "" },
    { "اسم المسافر": "B", "تاريخ المغادرة": "" },
  ];
  const rawRows = [
    { "اسم المسافر": "A", "تاريخ المغادرة": 46266 },
    { "اسم المسافر": "B", "تاريخ المغادرة": 46267 },
  ];
  const inferred = inferSingleTripDate(headers, rows, rawRows);
  assert.equal(inferred.date, "");
  assert.deepEqual(inferred.dates, ["2026-09-01", "2026-09-02"]);
});
