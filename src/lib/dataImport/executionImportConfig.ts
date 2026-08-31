export const EXECUTION_PASSENGER_TYPES = [
  "ذكر بالغ",
  "سيدات بالغ",
  "طفل تحت ٢",
  "طفل تحت ٨",
  "طفل تحت18",
] as const;

export type ExecutionPassengerType = typeof EXECUTION_PASSENGER_TYPES[number];

const ARABIC_DIGITS: Record<string, string> = {
  "٠": "0", "١": "1", "٢": "2", "٣": "3", "٤": "4",
  "٥": "5", "٦": "6", "٧": "7", "٨": "8", "٩": "9",
};

export function normalizeEgyptianNationalId(value: unknown): string {
  return String(value ?? "")
    .trim()
    .replace(/[٠-٩]/g, (digit) => ARABIC_DIGITS[digit] || digit)
    .replace(/[^0-9]/g, "");
}

export function deriveEgyptianPassengerData(value: unknown): {
  dob: string;
  passengerType: ExecutionPassengerType;
} | null {
  const nationalId = normalizeEgyptianNationalId(value);
  if (nationalId.length !== 14 || !["2", "3"].includes(nationalId[0])) return null;

  const year = (nationalId[0] === "2" ? 1900 : 2000) + Number(nationalId.slice(1, 3));
  const month = Number(nationalId.slice(3, 5));
  const day = Number(nationalId.slice(5, 7));
  const birthDate = new Date(year, month - 1, day);
  if (
    !Number.isFinite(year)
    || month < 1 || month > 12
    || day < 1 || day > 31
    || birthDate.getFullYear() !== year
    || birthDate.getMonth() !== month - 1
    || birthDate.getDate() !== day
  ) return null;

  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (birthDate > today) return null;

  let age = today.getFullYear() - year;
  if (
    today.getMonth() < month - 1
    || (today.getMonth() === month - 1 && today.getDate() < day)
  ) age--;

  let passengerType: ExecutionPassengerType;
  if (age < 2) passengerType = "طفل تحت ٢";
  else if (age < 8) passengerType = "طفل تحت ٨";
  else if (age < 18) passengerType = "طفل تحت18";
  else passengerType = Number(nationalId[12]) % 2 === 1 ? "ذكر بالغ" : "سيدات بالغ";

  return {
    dob: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    passengerType,
  };
}

/**
 * One execution row may contain many service names in one Excel cell.
 * The UI already displays services joined with "+", so that is the preferred
 * separator; Arabic/English commas, semicolons, pipes and line breaks are also accepted.
 */
export function splitExecutionServiceNames(value: unknown): string[] {
  const seen = new Set<string>();
  const names = String(value ?? "")
    .split(/\s*(?:\+|,|،|;|؛|\||\r?\n)\s*/g)
    .map((part) => part.trim().replace(/\s+/g, " "))
    .filter(Boolean);

  return names.filter((name) => {
    const key = name.toLocaleLowerCase("ar");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
