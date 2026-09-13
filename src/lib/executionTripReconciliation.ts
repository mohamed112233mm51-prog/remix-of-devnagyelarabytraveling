export type ReconciliationExecution = {
  id: string;
  passenger_name?: string | null;
  passport?: string | null;
  national_id?: string | null;
  operation_status?: string | null;
  travel_date?: string | null;
  departure_from?: string | null;
  destination?: string | null;
  airline?: string | null;
  approval_company_id?: string | null;
  agent_id?: string | null;
};

export type ReconciliationTripFilter = {
  travelDate: string;
  departureFrom?: string | null;
  destination?: string | null;
  airline?: string | null;
  approvalCompanyId?: string | null;
};

export type ReconciliationFileRow = {
  index: number;
  name: string;
  passport?: string | null;
  nationalId?: string | null;
  raw?: Record<string, unknown>;
};

export type ReconciliationCandidate = {
  execution: ReconciliationExecution;
  score: number;
  reason: "identifier" | "exact_name" | "fuzzy_name";
};

export type ReconciliationMatchStatus =
  | "matched"
  | "already_executed"
  | "review"
  | "unmatched"
  | "duplicate";

export type ReconciliationMatch = {
  source: ReconciliationFileRow;
  status: ReconciliationMatchStatus;
  execution: ReconciliationExecution | null;
  candidates: ReconciliationCandidate[];
  matchReason: "identifier" | "exact_name" | "fuzzy_name" | "none";
};

export type PassengerColumnDetection = {
  name: string;
  passport: string;
  nationalId: string;
};

const CANCELLED_STATUSES = new Set(["ملغي", "ملغية", "ملغى", "محذوف"]);

function cleanArabic(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/ـ/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي");
}

export function normalizePassengerName(value: unknown): string {
  return cleanArabic(String(value ?? ""))
    .toLocaleLowerCase("ar")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normalizeIdentifier(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .toUpperCase()
    .replace(/[^A-Z0-9\u0660-\u0669]/g, "")
    .replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

function normalizeTripText(value: unknown): string {
  return normalizePassengerName(value);
}

function normalizeIsoDate(value: unknown): string {
  const raw = String(value ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const m = raw.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);
  if (!m) return "";
  return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
}

export function isCancelledExecution(execution: ReconciliationExecution): boolean {
  return CANCELLED_STATUSES.has(String(execution.operation_status || "").trim());
}

export function filterExecutionsForTrip(
  executions: readonly ReconciliationExecution[],
  filter: ReconciliationTripFilter,
): ReconciliationExecution[] {
  const travelDate = normalizeIsoDate(filter.travelDate);
  if (!travelDate) return [];
  const departure = normalizeTripText(filter.departureFrom);
  const destination = normalizeTripText(filter.destination);
  const airline = normalizeTripText(filter.airline);
  const companyId = String(filter.approvalCompanyId || "").trim();

  return executions.filter((execution) => {
    if (isCancelledExecution(execution)) return false;
    if (normalizeIsoDate(execution.travel_date) !== travelDate) return false;
    if (departure && normalizeTripText(execution.departure_from) !== departure) return false;
    if (destination && normalizeTripText(execution.destination) !== destination) return false;
    if (airline && normalizeTripText(execution.airline) !== airline) return false;
    if (companyId && String(execution.approval_company_id || "").trim() !== companyId) return false;
    return true;
  });
}

function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr = new Array<number>(b.length + 1);
  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }
  return prev[b.length];
}

export function passengerNameSimilarity(a: unknown, b: unknown): number {
  const left = normalizePassengerName(a);
  const right = normalizePassengerName(b);
  if (!left || !right) return 0;
  if (left === right) return 1;
  const distance = levenshtein(left, right);
  return Math.max(0, 1 - distance / Math.max(left.length, right.length));
}

function uniqueByExecution(candidates: ReconciliationCandidate[]): ReconciliationCandidate[] {
  const map = new Map<string, ReconciliationCandidate>();
  for (const candidate of candidates) {
    const previous = map.get(candidate.execution.id);
    if (!previous || candidate.score > previous.score) map.set(candidate.execution.id, candidate);
  }
  return Array.from(map.values()).sort((a, b) => b.score - a.score || a.execution.id.localeCompare(b.execution.id));
}

function identifierState(source: ReconciliationFileRow, execution: ReconciliationExecution) {
  const sourcePassport = normalizeIdentifier(source.passport);
  const sourceNational = normalizeIdentifier(source.nationalId);
  const executionPassport = normalizeIdentifier(execution.passport);
  const executionNational = normalizeIdentifier(execution.national_id);

  const passportMatch = Boolean(sourcePassport && executionPassport && sourcePassport === executionPassport);
  const nationalMatch = Boolean(sourceNational && executionNational && sourceNational === executionNational);
  const passportConflict = Boolean(sourcePassport && executionPassport && sourcePassport !== executionPassport);
  const nationalConflict = Boolean(sourceNational && executionNational && sourceNational !== executionNational);
  return {
    matches: passportMatch || nationalMatch,
    conflicts: passportConflict || nationalConflict,
  };
}

function identifiersMatch(source: ReconciliationFileRow, execution: ReconciliationExecution): boolean {
  const state = identifierState(source, execution);
  // If the sheet supplies two identifiers, a contradictory identifier must
  // never be ignored just because the other one matches. Missing values are
  // tolerated, but explicit conflicts force the row into manual review.
  return state.matches && !state.conflicts;
}

function exactNameMatches(source: ReconciliationFileRow, executions: readonly ReconciliationExecution[]) {
  const normalizedName = normalizePassengerName(source.name);
  if (!normalizedName) return [];
  return executions.filter((execution) => normalizePassengerName(execution.passenger_name) === normalizedName);
}

export function reconcilePassengerRows(
  fileRows: readonly ReconciliationFileRow[],
  candidateExecutions: readonly ReconciliationExecution[],
  fuzzyReviewThreshold = 0.78,
): ReconciliationMatch[] {
  const claimedExecutionIds = new Set<string>();
  const results: ReconciliationMatch[] = [];

  for (const source of fileRows) {
    const identifierCandidates = candidateExecutions
      .filter((execution) => identifiersMatch(source, execution))
      .map((execution) => ({ execution, score: 1, reason: "identifier" as const }));

    let candidates = uniqueByExecution(identifierCandidates);
    let reason: ReconciliationMatch["matchReason"] = "none";

    if (candidates.length > 0) {
      reason = "identifier";
    } else {
      const exact = exactNameMatches(source, candidateExecutions)
        .map((execution) => ({ execution, score: 1, reason: "exact_name" as const }));
      candidates = uniqueByExecution(exact);
      if (candidates.length > 0) {
        reason = "exact_name";
      } else {
        candidates = uniqueByExecution(candidateExecutions
          .map((execution) => ({
            execution,
            score: passengerNameSimilarity(source.name, execution.passenger_name),
            reason: "fuzzy_name" as const,
          }))
          .filter((candidate) => candidate.score >= fuzzyReviewThreshold))
          .slice(0, 5);
        reason = candidates.length ? "fuzzy_name" : "none";
      }
    }

    if (candidates.length === 0) {
      results.push({ source, status: "unmatched", execution: null, candidates: [], matchReason: "none" });
      continue;
    }

    const uniqueCandidateHasIdentifierConflict = candidates.length === 1
      && reason === "exact_name"
      && identifierState(source, candidates[0].execution).conflicts;
    const isSafeUniqueExact = candidates.length === 1
      && reason !== "fuzzy_name"
      && !uniqueCandidateHasIdentifierConflict;
    if (!isSafeUniqueExact) {
      results.push({ source, status: "review", execution: null, candidates, matchReason: reason });
      continue;
    }

    const execution = candidates[0].execution;
    if (claimedExecutionIds.has(execution.id)) {
      results.push({ source, status: "duplicate", execution, candidates, matchReason: reason });
      continue;
    }
    claimedExecutionIds.add(execution.id);

    const alreadyExecuted = String(execution.operation_status || "").trim() === "منفذ";
    results.push({
      source,
      status: alreadyExecuted ? "already_executed" : "matched",
      execution,
      candidates,
      matchReason: reason,
    });
  }

  return results;
}

function normalizedHeader(value: string): string {
  return normalizePassengerName(value).replace(/\s+/g, " ");
}

function pickHeader(headers: readonly string[], aliases: readonly string[]): string {
  const normalizedAliases = aliases.map(normalizedHeader);
  const exact = headers.find((header) => normalizedAliases.includes(normalizedHeader(header)));
  if (exact) return exact;
  return headers.find((header) => {
    const h = normalizedHeader(header);
    return normalizedAliases.some((alias) => alias.length >= 4 && h.includes(alias));
  }) || "";
}

export function detectPassengerColumns(headers: readonly string[]): PassengerColumnDetection {
  return {
    name: pickHeader(headers, [
      "اسم الراكب", "اسم المسافر", "الاسم", "passenger name", "passenger", "full name", "pax name", "name",
    ]),
    passport: pickHeader(headers, [
      "رقم الجواز", "رقم جواز السفر", "جواز السفر", "passport number", "passport no", "passport",
    ]),
    nationalId: pickHeader(headers, [
      "الرقم القومي", "رقم قومي", "national id", "national number", "id number",
    ]),
  };
}

export function buildReconciliationFileRows(
  rows: readonly Record<string, unknown>[],
  columns: PassengerColumnDetection,
): ReconciliationFileRow[] {
  if (!columns.name) return [];
  return rows.map((raw, index) => ({
    index,
    name: String(raw[columns.name] ?? "").trim(),
    passport: columns.passport ? String(raw[columns.passport] ?? "").trim() : "",
    nationalId: columns.nationalId ? String(raw[columns.nationalId] ?? "").trim() : "",
    raw,
  })).filter((row) => row.name || row.passport || row.nationalId);
}
