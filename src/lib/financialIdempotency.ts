const STORAGE_KEY = "financial-pending-operations:v1";
const MAX_PENDING_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type PendingOperation = {
  id: string;
  scope: string;
  fingerprint: string;
  createdAt: number;
};

function stableSerialize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(obj[key])}`).join(",")}}`;
}

function readPending(): PendingOperation[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    const now = Date.now();
    const valid = parsed.filter((row): row is PendingOperation =>
      Boolean(row?.id && row?.scope && row?.fingerprint && Number(row?.createdAt))
      && now - Number(row.createdAt) <= MAX_PENDING_AGE_MS,
    );
    if (valid.length !== parsed.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(valid));
    return valid;
  } catch {
    return [];
  }
}

function writePending(rows: PendingOperation[]) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
  } catch {
    // localStorage may be unavailable in private/restricted contexts.
  }
}

function uuidFromBytes(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export function createFinancialOperationId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  if (typeof globalThis.crypto?.getRandomValues === "function") globalThis.crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return uuidFromBytes(bytes);
}

function hash32(input: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
    h ^= h >>> 13;
  }
  return h >>> 0;
}

/** Deterministic UUID used for child financial rows of one operation. */
export function deriveFinancialOperationUuid(operationId: string, childKey: string): string {
  const source = `${operationId}|${childKey}`;
  const words = [
    hash32(source, 0x811c9dc5),
    hash32(source, 0x9e3779b9),
    hash32(source, 0x85ebca6b),
    hash32(source, 0xc2b2ae35),
  ];
  const bytes = new Uint8Array(16);
  words.forEach((word, wi) => {
    bytes[wi * 4] = (word >>> 24) & 0xff;
    bytes[wi * 4 + 1] = (word >>> 16) & 0xff;
    bytes[wi * 4 + 2] = (word >>> 8) & 0xff;
    bytes[wi * 4 + 3] = word & 0xff;
  });
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return uuidFromBytes(bytes);
}

export function financialOperationFingerprint(value: unknown): string {
  return stableSerialize(value);
}

/**
 * Returns the same operation id while an identical financial operation is still pending.
 * Once confirmFinancialOperation is called, a genuinely new identical operation gets a new id.
 */
export function getOrCreateFinancialOperationId(scope: string, fingerprint: string): string {
  const rows = readPending();
  const existing = rows.find((row) => row.scope === scope && row.fingerprint === fingerprint);
  if (existing) return existing.id;
  const next: PendingOperation = {
    id: createFinancialOperationId(),
    scope,
    fingerprint,
    createdAt: Date.now(),
  };
  writePending([...rows, next]);
  return next.id;
}

export function confirmFinancialOperation(operationId: string) {
  const rows = readPending();
  writePending(rows.filter((row) => row.id !== operationId));
}

export function hasPendingFinancialOperation(scope: string, fingerprint: string): boolean {
  return readPending().some((row) => row.scope === scope && row.fingerprint === fingerprint);
}

export function isLikelyNetworkError(error: unknown): boolean {
  const message = String((error as any)?.message || error || "").toLowerCase();
  return (
    typeof navigator !== "undefined" && navigator.onLine === false
  ) || ["fetch", "network", "timeout", "timed out", "failed to fetch", "load failed"].some((token) => message.includes(token));
}
