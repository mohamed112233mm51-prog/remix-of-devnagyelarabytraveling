from pathlib import Path

p = Path("src/features/executions/LegacyExecutionsRoute.tsx")
text = p.read_text(encoding="utf-8")

marker = 'const SERVICE_KINDS = ["موافقة أمنية", "تذكرة طيران", "استثمار ليبي"] as const;\n'
helper = '''const SERVICE_KINDS = ["موافقة أمنية", "تذكرة طيران", "استثمار ليبي"] as const;\n\nfunction deriveDobFromEgyptianNationalId(value: string): string | null {\n  const digits = String(value || "")\n    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))\n    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))\n    .replace(/\\D/g, "");\n  if (digits.length !== 14) return null;\n\n  const centuryCode = digits[0];\n  if (centuryCode !== "2" && centuryCode !== "3") return null;\n\n  const yy = Number(digits.slice(1, 3));\n  const month = Number(digits.slice(3, 5));\n  const day = Number(digits.slice(5, 7));\n  const year = (centuryCode === "2" ? 1900 : 2000) + yy;\n\n  const date = new Date(Date.UTC(year, month - 1, day));\n  if (\n    month < 1 || month > 12 || day < 1 || day > 31\n    || date.getUTCFullYear() !== year\n    || date.getUTCMonth() !== month - 1\n    || date.getUTCDate() !== day\n  ) return null;\n\n  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;\n}\n'''
if marker not in text:
    raise SystemExit("SERVICE_KINDS marker not found")
text = text.replace(marker, helper, 1)

old = '<Field label="الرقم القومي"><input value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value })} style={inputStyle} /></Field>'
new = '''<Field label="الرقم القومي"><input value={form.national_id} onChange={(e) => {\n          const nationalId = e.target.value;\n          const derivedDob = deriveDobFromEgyptianNationalId(nationalId);\n          setForm({ ...form, national_id: nationalId, ...(derivedDob ? { dob: derivedDob } : {}) });\n        }} style={inputStyle} /></Field>'''
if old not in text:
    raise SystemExit("national id input target not found")
text = text.replace(old, new, 1)

p.write_text(text, encoding="utf-8")

patched = p.read_text(encoding="utf-8")
for needle in [
    "function deriveDobFromEgyptianNationalId",
    'centuryCode !== "2" && centuryCode !== "3"',
    "const derivedDob = deriveDobFromEgyptianNationalId(nationalId);",
]:
    if needle not in patched:
        raise SystemExit(f"missing expected patch: {needle}")
