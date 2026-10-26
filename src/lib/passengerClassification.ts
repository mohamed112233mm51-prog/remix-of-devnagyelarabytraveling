import { deriveEgyptianNationalIdData, passengerCategoryFor, passengerToday } from "./executionPassengerIdentity.ts";
export { passengerCategoryFor, passengerToday } from "./executionPassengerIdentity.ts";

export const PASSENGER_MAPPING_KEY = "passenger_type_mapping_v1";
export const PASSENGER_CATEGORIES = [
  { key: "infant", label: "أقل من سنتين" },
  { key: "child", label: "من سنتين إلى أقل من 8 سنوات" },
  { key: "child_under_12", label: "من 8 إلى أقل من 12 سنة" },
  { key: "young", label: "من 12 إلى أقل من 18 سنة" },
  { key: "male", label: "ذكر عمره 18 سنة فأكثر" },
  { key: "female", label: "أنثى عمرها 18 سنة فأكثر" },
] as const;
export type PassengerCategory = typeof PASSENGER_CATEGORIES[number]["key"];
export type PassengerMapping = Partial<Record<PassengerCategory, string>>;
export type PassengerOption = { id: string; value: string; is_active: boolean; category?: string };
export type PassengerContext = { options: PassengerOption[]; mapping: PassengerMapping; configured: boolean };
export type PassengerInput = { national_id?: string | null; dob?: string | null; dob_source?: "manual" | "auto"; sex?: string | null; travel_date?: string | null };

// Match useDropdownOptions / normalizeDropdownValue without importing the database layer.
export function passengerOptionLabel(value: unknown): string {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

export function normalizePassengerLabel(value: unknown): string {
  return String(value ?? "").normalize("NFKC")
    .replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))
    .replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776))
    .replace(/[\u064B-\u065F\u0670\u0640\s]/g, "").replace(/[أإآ]/g, "ا");
}

const aliases: Record<PassengerCategory, string[]> = {
  infant: ["طفل تحت 2", "رضع", "رضيع"], child: ["طفل تحت 8"],
  child_under_12: ["طفل تحت 12", "طفل أقل من 12 سنة", "طفل أقل من 12 سنوات"], young: ["طفل تحت 18"],
  male: ["ذكر بالغ"], female: ["سيدات بالغ", "سيدات"],
};
export function legacyPassengerCategory(value: unknown): PassengerCategory | null {
  const key = normalizePassengerLabel(value);
  return PASSENGER_CATEGORIES.find(c => aliases[c.key].some(a => normalizePassengerLabel(a) === key))?.key ?? null;
}
export function readPassengerMapping(value: unknown): PassengerMapping {
  const data = value as any;
  if (data?.v?.version !== 1 || !data.v.mapping || typeof data.v.mapping !== "object") return {};
  return Object.fromEntries(PASSENGER_CATEGORIES.flatMap(c => typeof data.v.mapping[c.key] === "string" && data.v.mapping[c.key]
    ? [[c.key, data.v.mapping[c.key]]] : []));
}
export function suggestedPassengerMapping(options: PassengerOption[]): PassengerMapping {
  return Object.fromEntries(PASSENGER_CATEGORIES.flatMap(c => {
    const matches = options.filter(o => o.is_active && legacyPassengerCategory(o.value) === c.key);
    return matches.length === 1 ? [[c.key, matches[0].id]] : [];
  }));
}
export function mappedPassengerValue(context: PassengerContext, category: PassengerCategory): string | null {
  if (!context.configured) return null;
  const id = context.mapping[category];
  const option = context.options.find(o => o.id === id && o.is_active && (!o.category || o.category === "passenger_type"));
  return passengerOptionLabel(option?.value) || null;
}
function dateParts(value: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!m) return null;
  const [y, mo, d] = m.slice(1).map(Number);
  const date = new Date(Date.UTC(y, mo - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d ? [y, mo, d] : null;
}
export function classifyPassenger(input: PassengerInput, referenceDate = input.travel_date || passengerToday()) {
  const nid = deriveEgyptianNationalIdData(input.national_id, referenceDate);
  if (nid && input.dob_source !== "manual") return { ...nid, category: passengerCategoryFor(nid.age, nid.gender) };
  const birth = dateParts(input.dob || ""), ref = dateParts(referenceDate);
  const gender = input.sex === "M" || input.sex === "male" ? "male" : input.sex === "F" || input.sex === "female" ? "female" : nid?.gender ?? null;
  if (!birth || !ref || (input.dob || "") > referenceDate) return null;
  const age = ref[0] - birth[0] - (ref[1] < birth[1] || (ref[1] === birth[1] && ref[2] < birth[2]) ? 1 : 0);
  if (age >= 18 && !gender) return null;
  return { dob: input.dob!, age, gender, category: passengerCategoryFor(age, gender || "male") };
}
export function resolvePassengerType(input: PassengerInput, context: PassengerContext) {
  const identity = classifyPassenger(input);
  const value = identity ? mappedPassengerValue(context, identity.category) : null;
  const warning = !identity ? "تعذر تحديد نوع المسافر تلقائيًا؛ اختر النوع من القائمة."
    : !value ? `تصنيف «${PASSENGER_CATEGORIES.find(c => c.key === identity.category)!.label}» غير مرتبط بخيار نشط؛ اختر النوع يدويًا أو راجع الإعدادات.` : "";
  return { identity, value, warning };
}
export function canonicalPassengerValue(value: unknown, context: PassengerContext): string | null {
  const raw = passengerOptionLabel(value);
  const exact = context.options.filter(o => o.is_active && passengerOptionLabel(o.value) === raw);
  if (exact.length) return passengerOptionLabel(exact[0].value);
  const category = legacyPassengerCategory(raw);
  return category ? mappedPassengerValue(context, category) : null;
}
export function preparePassengerImport(row: Record<string, any>, context: PassengerContext) {
  const resolved = resolvePassengerType(row, context);
  const value = row.passenger_type ? canonicalPassengerValue(row.passenger_type, context) : resolved.value;
  if (!value) throw new Error(row.passenger_type ? "نوع المسافر غير موجود ضمن الخيارات النشطة؛ اختر الاسم المعتمد من قائمة نوع المسافر." : resolved.warning);
  return { ...row, dob: row.dob || resolved.identity?.dob, passenger_type: value };
}

export type PassengerDraft = PassengerInput & { passenger_type: string; passenger_type_auto?: boolean; warnings?: string[] };
export function passengerDraftPatch<T extends PassengerDraft>(row: T, patch: Partial<T>, context?: PassengerContext): Partial<T> {
  if ("passenger_type" in patch && !("passenger_type_auto" in patch)) return { ...patch, passenger_type_auto: false };
  if (!["national_id", "dob", "travel_date"].some(k => k in patch && (patch as any)[k] !== (row as any)[k])) return patch;
  // OCR patches already carry the resolved type and its provenance.
  if ("passenger_type_auto" in patch) return patch;
  if (!context) return { ...patch, passenger_type: "", passenger_type_auto: true };
  const result = resolvePassengerType({ ...row, ...patch }, context);
  const warnings = Array.isArray(row.warnings) ? [...row.warnings.filter(w => !w.startsWith("نوع المسافر: ")), ...(result.warning ? ["نوع المسافر: " + result.warning] : [])] : undefined;
  return { ...patch, dob: result.identity?.dob || patch.dob || row.dob, passenger_type: result.value || "", passenger_type_auto: true, ...(warnings ? { warnings } : {}) };
}
export function passengerDraftError(row: PassengerDraft, context: PassengerContext): string | null {
  if (!row.passenger_type || !context.options.some(o => o.is_active && passengerOptionLabel(o.value) === row.passenger_type)) return "اختر نوع المسافر من القائمة النشطة قبل الحفظ.";
  if (row.passenger_type_auto) {
    const result = resolvePassengerType(row, context);
    if (result.value !== row.passenger_type) return "تغير التصنيف أو ربط نوع المسافر؛ راجع النوع واختره من القائمة قبل الحفظ.";
  }
  return null;
}
