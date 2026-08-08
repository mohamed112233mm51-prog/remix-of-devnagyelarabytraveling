from pathlib import Path

p = Path('src/lib/exportStatement.ts')
s = p.read_text(encoding='utf-8')

# Restore Excel-only branding variables used for workbook metadata/colors.
old = '''async function _buildExcel(data: StatementExportData): Promise<{ blob: Blob; fileName: string }> {
  debugStatementExportValues(data);


  const wb = new ExcelJS.Workbook();'''
new = '''async function _buildExcel(data: StatementExportData): Promise<{ blob: Blob; fileName: string }> {
  debugStatementExportValues(data);

  const branding = await loadBranding();
  const companyName = branding.companyName || COMPANY_NAME;

  const wb = new ExcelJS.Workbook();'''
if old not in s:
    raise SystemExit('Excel builder anchor not found')
s = s.replace(old, new, 1)

old_colors = '  const SECONDARY_ARGB = hexToArgb(branding.secondaryColor);'
new_colors = '  const PRIMARY_ARGB = hexToArgb(branding.primaryColor);\n  const SECONDARY_ARGB = hexToArgb(branding.secondaryColor);'
if old_colors not in s:
    raise SystemExit('Excel color anchor not found')
s = s.replace(old_colors, new_colors, 1)

# PDF no longer displays or needs company branding.
pdf_marker = '// ---------- PDF ----------'
pdf_start = s.index(pdf_marker)
prefix, pdf = s[:pdf_start], s[pdf_start:]
pdf_defs = '  const branding = await loadBranding();\n  const companyName = branding.companyName || COMPANY_NAME;\n'
if pdf_defs not in pdf:
    raise SystemExit('PDF branding definitions not found')
pdf = pdf.replace(pdf_defs, '', 1)
pdf = pdf.replace('  opts?: { arabicAsEntities?: boolean },', '  _opts?: { arabicAsEntities?: boolean },', 1)
s = prefix + pdf

p.write_text(s, encoding='utf-8')
