// DD/MM/YYYY <-> ISO (YYYY-MM-DD) helpers, used by manual-entry date fields
// such as تاريخ الميلاد.

const DDMMYYYY_RE = /^(\d{2})\/(\d{2})\/(\d{4})$/;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})/;

export function isValidDisplayDate(s: string | null | undefined): boolean {
  if (!s) return true; // empty allowed
  const m = DDMMYYYY_RE.exec(s.trim());
  if (!m) return false;
  const d = Number(m[1]), mo = Number(m[2]), y = Number(m[3]);
  if (mo < 1 || mo > 12) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Convert "DD/MM/YYYY" → "YYYY-MM-DD". Returns null for empty/invalid input. */
export function parseDisplayDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const m = DDMMYYYY_RE.exec(s.trim());
  if (!m) return null;
  if (!isValidDisplayDate(s)) return null;
  return `${m[3]}-${m[2]}-${m[1]}`;
}

/** Convert ISO date (or anything `Date` can parse) → "DD/MM/YYYY". Empty → "". */
export function toDisplayDate(s: string | Date | null | undefined): string {
  if (!s) return "";
  if (typeof s === "string") {
    const m = ISO_RE.exec(s);
    if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  }
  const d = s instanceof Date ? s : new Date(s);
  if (Number.isNaN(d.getTime())) return typeof s === "string" ? s : "";
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const yy = d.getUTCFullYear();
  return `${dd}/${mm}/${yy}`;
}
