export function normalizeEgyptianNationalIdDigits(value: unknown): string {
  return String(value || "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(d)))
    .replace(/\D/g, "");
}

export function deriveDobIsoFromEgyptianNationalId(value: unknown): string | null {
  const digits = normalizeEgyptianNationalIdDigits(value);
  if (digits.length !== 14) return null;

  const centuryCode = digits[0];
  if (centuryCode !== "2" && centuryCode !== "3") return null;

  const yy = Number(digits.slice(1, 3));
  const month = Number(digits.slice(3, 5));
  const day = Number(digits.slice(5, 7));
  const year = (centuryCode === "2" ? 1900 : 2000) + yy;

  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    month < 1 || month > 12 || day < 1 || day > 31
    || date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return null;

  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function passengerCategoryFor(age: number, gender: "female" | "male"): "infant" | "child" | "young" | "female" | "male" {
  return age < 2 ? "infant" : age < 8 ? "child" : age < 18 ? "young" : gender;
}

export function passengerToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}

/** Classify using the existing validated DOB parser; never create a second ID parser. */
export function deriveEgyptianNationalIdData(value: unknown, referenceDate?: string | Date | null) {
  const dob = deriveDobIsoFromEgyptianNationalId(value);
  if (!dob) return null;
  if (referenceDate instanceof Date && Number.isNaN(referenceDate.getTime())) return null;
  const ref = referenceDate instanceof Date ? referenceDate.toISOString().slice(0, 10) : referenceDate || passengerToday();
  const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ref);
  if (!parts || dob > ref) return null;
  const [year, month, day] = parts.slice(1).map(Number);
  const check = new Date(Date.UTC(year, month - 1, day));
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null;
  const [by, bm, bd] = dob.split("-").map(Number);
  const age = year - by - (month < bm || (month === bm && day < bd) ? 1 : 0);
  const gender: "female" | "male" = Number(normalizeEgyptianNationalIdDigits(value)[12]) % 2 === 0 ? "female" : "male";
  return { dob, gender, age };
}
