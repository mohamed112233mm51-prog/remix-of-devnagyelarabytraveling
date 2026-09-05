from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise SystemExit(f"Missing target: {label}")
    return text.replace(old, new, 1)

# Shared national-ID identity helper so manual and passport-created executions
# use the exact same DOB derivation behavior.
helper = Path("src/lib/executionPassengerIdentity.ts")
helper.write_text('''export function deriveDobIsoFromEgyptianNationalId(value: unknown): string | null {\n  const digits = String(value || "")\n    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))\n    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))\n    .replace(/\\D/g, "");\n  if (digits.length !== 14) return null;\n\n  const centuryCode = digits[0];\n  if (centuryCode !== "2" && centuryCode !== "3") return null;\n\n  const yy = Number(digits.slice(1, 3));\n  const month = Number(digits.slice(3, 5));\n  const day = Number(digits.slice(5, 7));\n  const year = (centuryCode === "2" ? 1900 : 2000) + yy;\n\n  const date = new Date(Date.UTC(year, month - 1, day));\n  if (\n    month < 1 || month > 12 || day < 1 || day > 31\n    || date.getUTCFullYear() !== year\n    || date.getUTCMonth() !== month - 1\n    || date.getUTCDate() !== day\n  ) return null;\n\n  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;\n}\n''', encoding="utf-8")

# Manual execution form: keep existing behavior, but source it from the shared helper.
p = Path("src/features/executions/LegacyExecutionsRoute.tsx")
text = p.read_text(encoding="utf-8")
text = replace_once(
    text,
    'import { toDisplayDate, parseDisplayDate, isValidDisplayDate } from "@/lib/dateFormat";\n',
    'import { toDisplayDate, parseDisplayDate, isValidDisplayDate } from "@/lib/dateFormat";\nimport { deriveDobIsoFromEgyptianNationalId } from "@/lib/executionPassengerIdentity";\n',
    "manual helper import",
)
old_helper = '''function deriveDobFromEgyptianNationalId(value: string): string | null {\n  const digits = String(value || "")\n    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))\n    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))\n    .replace(/\\D/g, "");\n  if (digits.length !== 14) return null;\n\n  const centuryCode = digits[0];\n  if (centuryCode !== "2" && centuryCode !== "3") return null;\n\n  const yy = Number(digits.slice(1, 3));\n  const month = Number(digits.slice(3, 5));\n  const day = Number(digits.slice(5, 7));\n  const year = (centuryCode === "2" ? 1900 : 2000) + yy;\n\n  const date = new Date(Date.UTC(year, month - 1, day));\n  if (\n    month < 1 || month > 12 || day < 1 || day > 31\n    || date.getUTCFullYear() !== year\n    || date.getUTCMonth() !== month - 1\n    || date.getUTCDate() !== day\n  ) return null;\n\n  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;\n}\n\n'''
text = replace_once(text, old_helper, "", "remove local manual DOB helper")
text = replace_once(
    text,
    '''          const nationalId = e.target.value;\n          const derivedDob = deriveDobFromEgyptianNationalId(nationalId);\n          setForm({ ...form, national_id: nationalId, ...(derivedDob ? { dob: derivedDob } : {}) });''',
    '''          const nationalId = e.target.value;\n          const derivedDobIso = deriveDobIsoFromEgyptianNationalId(nationalId);\n          setForm({ ...form, national_id: nationalId, ...(derivedDobIso ? { dob: toDisplayDate(derivedDobIso) || form.dob } : {}) });''',
    "manual national ID change",
)
p.write_text(text, encoding="utf-8")

# Bulk passport upload: make OCR-created/manual-edited rows derive DOB from the
# same Egyptian national-ID rule before they are saved. The execution list color
# logic remains unchanged and therefore applies identically once DOB/status are
# stored in the same shape as manual executions.
p = Path("src/components/PassportBulkUploadWorkspaceV4.tsx")
text = p.read_text(encoding="utf-8")
text = replace_once(
    text,
    'import { importExecutionRows } from "@/lib/dataImport/executionImport";\n',
    'import { importExecutionRows } from "@/lib/dataImport/executionImport";\nimport { deriveDobIsoFromEgyptianNationalId } from "@/lib/executionPassengerIdentity";\n',
    "bulk helper import",
)
old_scan = '''function scanPatch(data: PassportScanData): Partial<BatchRow> {\n  return {\n    selected: true,\n    state: data.needs_review ? "review" : "ready",\n    error: "",\n    warnings: Array.isArray(data.warnings) ? data.warnings : [],\n    mrzVerified: !!data.mrz_verified,\n    passenger_name: data.full_name_ar || data.full_name_en || "",\n    national_id: data.national_id || "",\n    dob: data.date_of_birth || "",\n    passenger_type: data.passenger_type || "",\n    passport: data.passport_number || "",\n    birth_place: data.place_of_birth || "",\n  };\n}\n'''
new_scan = '''function scanPatch(data: PassportScanData): Partial<BatchRow> {\n  const nationalId = data.national_id || "";\n  const derivedDobIso = deriveDobIsoFromEgyptianNationalId(nationalId);\n  return {\n    selected: true,\n    state: data.needs_review ? "review" : "ready",\n    error: "",\n    warnings: Array.isArray(data.warnings) ? data.warnings : [],\n    mrzVerified: !!data.mrz_verified,\n    passenger_name: data.full_name_ar || data.full_name_en || "",\n    national_id: nationalId,\n    dob: derivedDobIso || data.date_of_birth || "",\n    passenger_type: data.passenger_type || "",\n    passport: data.passport_number || "",\n    birth_place: data.place_of_birth || "",\n  };\n}\n'''
text = replace_once(text, old_scan, new_scan, "bulk OCR scan patch")
old_input = '''          <label style={{ fontSize: 11, fontWeight: 800 }}>الرقم القومي<input style={inputStyle} disabled={!editable} value={r.national_id} onChange={(e) => updateRow(r.id, { national_id: e.target.value })} /></label>'''
new_input = '''          <label style={{ fontSize: 11, fontWeight: 800 }}>الرقم القومي<input style={inputStyle} disabled={!editable} value={r.national_id} onChange={(e) => {\n            const nationalId = e.target.value;\n            const derivedDobIso = deriveDobIsoFromEgyptianNationalId(nationalId);\n            updateRow(r.id, { national_id: nationalId, ...(derivedDobIso ? { dob: derivedDobIso } : {}) });\n          }} /></label>'''
text = replace_once(text, old_input, new_input, "bulk national ID change")
p.write_text(text, encoding="utf-8")

# Focused assertions.
manual = Path("src/features/executions/LegacyExecutionsRoute.tsx").read_text(encoding="utf-8")
bulk = Path("src/components/PassportBulkUploadWorkspaceV4.tsx").read_text(encoding="utf-8")
shared = helper.read_text(encoding="utf-8")
for needle in ["deriveDobIsoFromEgyptianNationalId", "return `${year}-${String(month).padStart(2, \"0\")}-${String(day).padStart(2, \"0\")}`"]:
    if needle not in shared:
        raise SystemExit(f"Missing shared helper assertion: {needle}")
if 'deriveDobFromEgyptianNationalId' in manual:
    raise SystemExit("Old local manual helper still present")
if 'derivedDobIso || data.date_of_birth || ""' not in bulk:
    raise SystemExit("Bulk OCR DOB fallback missing")
if 'updateRow(r.id, { national_id: nationalId, ...(derivedDobIso ? { dob: derivedDobIso } : {}) })' not in bulk:
    raise SystemExit("Bulk manual national ID sync missing")
