/**
 * Image-only layout rules applied on top of the *same* markup/CSS as the PDF.
 * This keeps the official PDF header, summary, gold divider and table design.
 * The wider export viewport only prevents Arabic headings being squeezed.
 */
export function statementImageWidth(columnCount: number): number {
  if (!Number.isFinite(columnCount) || columnCount < 1) return 1000;
  const columns = Math.ceil(columnCount);
  const pdfWidth = columns > 6 ? 1414 : 1000;
  return Math.max(pdfWidth, columns * 150);
}

export function statementImagePrintHtml(pdfHtml: string): string {
  if (!pdfHtml.includes("</head>") || !pdfHtml.includes('class="page"')) {
    throw new Error("تعذر تحضير قالب PDF الخاص بالصورة");
  }

  const imageOnlyStyle = [
    '<style id="statement-image-pdf-layout">',
    'html, body { margin:0; padding:0; width:100%; background:#fff; }',
    '.page { width:100%; padding:12mm; background:#fff; }',
    '.page .table-wrap { width:100%; overflow:visible; }',
    '.page table { width:100%; table-layout:fixed; border-collapse:collapse; }',
    '.page th, .page td { padding:9px 8px; font-size:14px; line-height:1.65;',
    'white-space:normal; word-break:normal; overflow-wrap:break-word; vertical-align:middle; }',
    '.page thead th { font-size:14px; font-weight:800;',
    'white-space:normal; word-break:normal; overflow-wrap:normal; }',
    '.page .header .report-title { font-size:18px; line-height:1.65; }',
    '.page .header .meta-line { font-size:13px; line-height:1.6; }',
    '.page .summary .sum-box .label { font-size:13px; }',
    '.page .summary .sum-box .val { font-size:15px; }',
    '</style>',
  ].join("\n");
  return pdfHtml.replace("</head>", imageOnlyStyle + "</head>");
}
