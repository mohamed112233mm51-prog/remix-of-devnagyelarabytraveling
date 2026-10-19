import { deriveEgyptianNationalIdData, passengerCategoryFor, normalizeEgyptianNationalIdDigits } from "../executionPassengerIdentity.ts";

export const EXECUTION_PASSENGER_TYPES = [
  "ذكر بالغ",
  "سيدات بالغ",
  "طفل تحت ٢",
  "طفل تحت ٨",
  "طفل تحت12",
  "طفل تحت18",
] as const;

export type ExecutionPassengerType = typeof EXECUTION_PASSENGER_TYPES[number];

export function normalizeEgyptianNationalId(value: unknown): string {
  return normalizeEgyptianNationalIdDigits(value);
}

export function deriveEgyptianPassengerData(value: unknown, referenceDate?: string | null): {
  dob: string;
  passengerType: ExecutionPassengerType;
} | null {
  const identity = deriveEgyptianNationalIdData(value, referenceDate);
  if (!identity) return null;
  const labels = { infant: "طفل تحت ٢", child: "طفل تحت ٨", child_under_12: "طفل تحت12", young: "طفل تحت18", male: "ذكر بالغ", female: "سيدات بالغ" } as const;
  return { dob: identity.dob, passengerType: labels[passengerCategoryFor(identity.age, identity.gender)] };
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
