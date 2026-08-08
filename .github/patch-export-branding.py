from pathlib import Path

p = Path('src/lib/exportStatement.ts')
s = p.read_text(encoding='utf-8')

# Remove now-unused Excel logo data-url helper.
helper_start = s.index('function dataUrlToExcelImage(')
helper_end = s.index('const CURRENCY = "ج.م";', helper_start)
s = s[:helper_start] + s[helper_end:]

# Excel no longer needs the primary-color brand band.
s = s.replace('  const PRIMARY_ARGB = hexToArgb(branding.primaryColor);\n', '', 1)

# Clean Excel report header: title + export metadata only.
excel_start = s.index('  // ===== BRAND BAND (logo + company name) =====')
excel_end_marker = '  let nextRow = 4;'
excel_end = s.index(excel_end_marker, excel_start) + len(excel_end_marker)
excel_header = '''  // ===== REPORT HEADER (no logo/company branding) =====
  ws.mergeCells(`A1:${lastColLetter}1`);
  const r1 = ws.getCell("A1");
  r1.value = data.title;
  r1.font = { name: "Cairo", size: 14, bold: true, color: { argb: SECONDARY_ARGB } };
  r1.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl" };
  r1.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF1F5F9" } };
  ws.getRow(1).height = 26;

  // Row 2: subtitle / export date
  const metaRow = 2;
  ws.mergeCells(`A${metaRow}:${lastColLetter}${metaRow}`);
  const r2 = ws.getCell(`A${metaRow}`);
  const subtitleBit = data.subtitle ? `${data.subtitle}  •  ` : "";
  r2.value = `${subtitleBit}تاريخ التصدير: ${todayLabel()}`;
  r2.font = { name: "Cairo", size: 10, color: { argb: "FF475569" } };
  r2.alignment = { horizontal: "center", vertical: "middle", readingOrder: "rtl", wrapText: true };
  r2.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF8FAFC" } };
  ws.getRow(metaRow).height = 22;

  let nextRow = 3;'''
s = s[:excel_start] + excel_header + s[excel_end:]

# Remove visible Excel footer.
footer_start = s.index('  // ===== Footer =====')
footer_end = s.index('  const buf = await wb.xlsx.writeBuffer();', footer_start)
s = s[:footer_start] + s[footer_end:]

# PDF visible branding cleanup.
s = s.replace('// ---------- PDF (branded header) ----------', '// ---------- PDF ----------', 1)
s = s.replace('  const branding = await loadBranding();\n  const companyName = branding.companyName || COMPANY_NAME;\n', '', 1)

# Remove company-name entity conversion block, now unused.
entity_start = s.index('  // Convert Arabic/RTL chars to HTML numeric entities')
entity_end = s.index('  const summaryHtml =', entity_start)
s = s[:entity_start] + s[entity_end:]

old_pdf_header = '''<div class="header">
  ${branding.logoUrl ? `<img class="logo" src="${esc(branding.logoUrl)}" alt="" />` : ""}
  <div class="meta">
    <div class="co-name" style="font-family:'Cairo',Arial,sans-serif;direction:rtl;unicode-bidi:embed;text-align:right;">${companyNameHtml}</div>
    <div class="report-title">${esc(data.title)}</div>
    <div class="meta-line">${data.subtitle ? esc(data.subtitle) + " • " : ""}تاريخ التصدير: ${esc(todayLabel())}</div>
  </div>
</div>'''
new_pdf_header = '''<div class="header">
  <div class="meta">
    <div class="report-title">${esc(data.title)}</div>
    <div class="meta-line">${data.subtitle ? esc(data.subtitle) + " • " : ""}تاريخ التصدير: ${esc(todayLabel())}</div>
  </div>
</div>'''
if old_pdf_header not in s:
    raise SystemExit('PDF header block not found exactly; refusing broad edit')
s = s.replace(old_pdf_header, new_pdf_header, 1)

old_pdf_footer = '<div class="foot">${esc(companyName)} • تم التوليد آليًا</div>\n'
if old_pdf_footer not in s:
    raise SystemExit('PDF footer block not found exactly; refusing broad edit')
s = s.replace(old_pdf_footer, '', 1)

p.write_text(s, encoding='utf-8')
