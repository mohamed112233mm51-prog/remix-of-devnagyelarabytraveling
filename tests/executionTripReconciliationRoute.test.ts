import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { parsePastedManifest } from "../src/lib/executionTripClipboard.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function source(relativePath: string) {
  return readFile(path.join(root, relativePath), "utf8");
}

test("trip reconciliation launcher stays lightweight and navigates away before file picking", async () => {
  const launcher = await source("src/components/ExecutionTripReconciliation.tsx");
  assert.match(launcher, /window\.location\.assign\("\/execution-trip-reconciliation"\)/);
  assert.doesNotMatch(launcher, /useCompleteFinancialTable/);
  assert.doesNotMatch(launcher, /dataImport\/parse/);
  assert.doesNotMatch(launcher, /executionBulkExecution/);
});

test("trip reconciliation follows the passport bulk one-step journey without an interstitial page", async () => {
  const route = await source("src/routes/execution-trip-reconciliation.tsx");
  assert.match(route, /<ExecutionTripReconciliationWorkspace onExit=\{backToExecutions\}/);
  assert.doesNotMatch(route, /window\.self\s*!==\s*window\.top/);
  assert.doesNotMatch(route, /embeddedPreview/);
  assert.doesNotMatch(route, /target="_blank"/);
  assert.doesNotMatch(route, /فتح شاشة المطابقة المستقلة/);
});

test("lightweight trip reconciliation route is protected by executions permissions", async () => {
  const permissions = await source("src/hooks/usePerm.tsx");
  assert.match(permissions, /"\/execution-trip-reconciliation"\s*:\s*"executions"/);
});

test("workspace does not load executions, SheetJS, or financial mutation code before file selection", async () => {
  const workspace = await source("src/components/ExecutionTripReconciliationWorkspace.tsx");
  assert.doesNotMatch(workspace, /useCompleteFinancialTable/);
  assert.doesNotMatch(workspace, /import\s+\{\s*parseFile/);
  assert.doesNotMatch(workspace, /import\s+\{\s*executeExistingExecution/);
  assert.match(workspace, /await import\("@\/lib\/dataImport\/parse"\)/);
  assert.match(workspace, /await import\("@\/lib\/executionBulkExecution"\)/);
  assert.match(workspace, /fileInputRef\.current\?\.click\(\)/);
  assert.match(workspace, /hidden\s+type="file"/);
});

test("workspace queries only the selected travel day after manifest parsing", async () => {
  const workspace = await source("src/components/ExecutionTripReconciliationWorkspace.tsx");
  const adapter = await source("src/lib/executionTripCandidateQuery.ts");

  assert.match(workspace, /if \(!parsed \|\| !travelDate\)/);
  assert.match(workspace, /fetchReconciliationExecutionsForDate\(travelDate\)/);
  assert.match(adapter, /\.from\("executions"\)/);
  assert.match(adapter, /\.gte\("travel_date", range\.from\)/);
  assert.match(adapter, /\.lt\("travel_date", range\.to\)/);
  assert.doesNotMatch(adapter, /\.select\("\*"\)/);
});

test("clipboard fallback parses Excel-style Arabic rows without a native file picker", () => {
  const parsed = parsePastedManifest(
    "اسم المسافر\tالرقم القومى \tتاريخ المغادره\tالوكيل\tالشركه الصادره\n"
      + "T\t256643tgf\t2026-09-01\tالصياد\tدروب",
  );

  assert.deepEqual(parsed.headers, [
    "اسم المسافر",
    "الرقم القومى",
    "تاريخ المغادره",
    "الوكيل",
    "الشركه الصادره",
  ]);
  assert.equal(parsed.rows.length, 1);
  assert.equal(parsed.rows[0]["اسم المسافر"], "T");
  assert.equal(parsed.rows[0]["تاريخ المغادره"], "2026-09-01");
});

test("clipboard fallback supports quoted CSV text", () => {
  const parsed = parsePastedManifest(
    'اسم المسافر,الرقم القومي,تاريخ المغادره\n"محمد, أحمد",123,2026-09-01',
  );
  assert.equal(parsed.rows[0]["اسم المسافر"], "محمد, أحمد");
  assert.equal(parsed.rows[0]["الرقم القومي"], "123");
});
