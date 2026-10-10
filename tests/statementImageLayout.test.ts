import assert from "node:assert/strict";
import test from "node:test";
import { statementImageWidth, statementImagePrintHtml } from "../src/lib/statementImageLayout.ts";

test("preserves a printable PDF page width for small statements", () => {
  assert.equal(statementImageWidth(4), 1000);
  assert.equal(statementImageWidth(8), 1414);
  assert.equal(statementImageWidth(12), 1800);
  assert.equal(statementImageWidth(17), 2550);
  assert.equal(statementImageWidth(NaN), 1000);
});

test("keeps the PDF document markup and theme, adding only legibility CSS", () => {
  const pdfHtml = '<html lang="ar" dir="rtl"><head><style>.gold-divider{background:#C9A84C}</style></head><body><div class="page"><div class="header">كشف حساب</div><div class="gold-divider"></div><table><thead><tr><th>المدين</th></tr></thead></table></div></body></html>';
  const imageHtml = statementImagePrintHtml(pdfHtml);
  assert.ok(imageHtml.includes('class="header">كشف حساب'));
  assert.ok(imageHtml.includes('.gold-divider{background:#C9A84C}'));
  assert.ok(imageHtml.includes('id="statement-image-pdf-layout"'));
  assert.ok(imageHtml.includes('table-layout:fixed'));
  assert.ok(imageHtml.includes('white-space:normal'));
  assert.ok(imageHtml.includes('overflow-wrap:normal'));
  assert.ok(imageHtml.includes('font-size:14px'));
  assert.ok(imageHtml.includes('dir="rtl"'));
});

test("fails safely rather than rendering an unrelated image design", () => {
  assert.throws(() => statementImagePrintHtml("<html><head></head><body></body></html>"));
});
