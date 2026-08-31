import type { ImportSpec, FieldSpec } from "./specs";

export type RowError = { row: number; field: string; label: string; message: string };
export type ValidationResult = {
  validRows: Record<string, any>[];
  errors: RowError[];
  duplicates: number;
  totalRows: number;
};

export type Lookups = {
  agent: Map<string, string>;     // normalised name -> id
  company: Map<string, string>;
  merchant: Map<string, string>;
  investor: Map<string, string>;
};

const norm = (s: any) =>
  String(s ?? "")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآا]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه")
    .replace(/\s+/g, " ").trim().toLowerCase();

function parseDate(v: any): string | null {
  if (!v && v !== 0) return null;
  if (v instanceof Date && !isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  const s = String(v).trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}/.test(s)) return s.slice(0, 10);
  const m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/);
  if (m) {
    let [, d, mo, y] = m;
    if (y.length === 2) y = "20" + y;
    const dt = new Date(`${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`);
    if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }
  const dt = new Date(s);
  if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  return null;
}

function parseNum(v: any): number | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).replace(/[, _]/g, "").replace(/[^\d.\-]/g, "");
  const n = Number(s);
  return isNaN(n) ? null : n;
}

function coerceField(
  f: FieldSpec,
  raw: any,
  lookups: Lookups,
): { ok: true; value: any; column: string } | { ok: false; message: string } {
  const column = f.dbColumn || f.key;
  const isEmpty = raw === null || raw === undefined || String(raw).trim() === "";

  if (isEmpty) {
    if (f.required && f.default === undefined) {
      return { ok: false, message: `الحقل "${f.label}" مطلوب` };
    }
    return { ok: true, value: f.default ?? null, column };
  }

  switch (f.type) {
    case "lookup": {
      const map = f.lookup ? lookups[f.lookup] : null;
      if (!map) return { ok: false, message: `بحث غير معروف` };
      const id = map.get(norm(raw));
      if (!id) {
        if (f.required) return { ok: false, message: `"${String(raw).trim()}" غير موجود في ${f.label}` };
        return { ok: true, value: null, column };
      }
      return { ok: true, value: id, column };
    }
    case "number": {
      const n = parseNum(raw);
      if (n === null) return { ok: false, message: `قيمة "${f.label}" ليست رقمًا صحيحًا` };
      return { ok: true, value: n, column };
    }
    case "integer": {
      const n = parseNum(raw);
      if (n === null) return { ok: false, message: `قيمة "${f.label}" ليست رقمًا صحيحًا` };
      return { ok: true, value: Math.round(n), column };
    }
    case "date": {
      const d = parseDate(raw);
      if (!d) return { ok: false, message: `تاريخ "${f.label}" غير صالح` };
      return { ok: true, value: d, column };
    }
    case "boolean": {
      const s = norm(raw);
      return { ok: true, value: ["true", "1", "نعم", "yes", "y", "مفعل", "مفعله"].includes(s), column };
    }
    default: {
      const value = String(raw).trim().slice(0, 1000);
      if (Array.isArray(f.enum) && f.enum.length > 0) {
        const allowed = f.enum.find((candidate) => norm(candidate) === norm(value));
        if (!allowed) {
          return { ok: false, message: `قيمة "${f.label}" يجب أن تكون واحدة من: ${f.enum.join("، ")}` };
        }
        return { ok: true, value: allowed, column };
      }
      return { ok: true, value, column };
    }
  }
}

export function validateRows(
  spec: ImportSpec,
  rows: Record<string, any>[],
  mapping: Record<string, string | null>,
  lookups: Lookups,
  existingKeys: Set<string>,
): ValidationResult {
  const validRows: Record<string, any>[] = [];
  const errors: RowError[] = [];
  const seenInBatch = new Set<string>();
  let duplicates = 0;

  rows.forEach((srcRow, idx) => {
    const rowNum = idx + 2; // +1 header +1 1-based
    let out: Record<string, any> = {};
    let rowOk = true;

    for (const f of spec.fields) {
      const header = mapping[f.key];
      const raw = header ? srcRow[header] : undefined;
      const r = coerceField(f, raw, lookups);
      if (!r.ok) {
        errors.push({ row: rowNum, field: f.key, label: f.label, message: r.message });
        rowOk = false;
        continue;
      }
      if (r.value !== null && r.value !== undefined) out[r.column] = r.value;
    }

    if (!rowOk) return;

    try {
      if (spec.transformRow) out = spec.transformRow(out);
    } catch (e: any) {
      errors.push({
        row: rowNum,
        field: "_row",
        label: "الصف",
        message: e?.message || "تعذر تجهيز الصف للاستيراد",
      });
      return;
    }

    if (spec.dedupeKey) {
      const key = spec.dedupeKey(out);
      if (key) {
        if (existingKeys.has(key) || seenInBatch.has(key)) {
          duplicates++;
          return;
        }
        seenInBatch.add(key);
      }
    }

    validRows.push(out);
  });

  return { validRows, errors, duplicates, totalRows: rows.length };
}
