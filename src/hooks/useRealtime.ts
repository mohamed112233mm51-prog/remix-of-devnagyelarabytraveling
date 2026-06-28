// Central Realtime hook for the app.
//
// Built on top of the shared per-table store in `src/lib/db.ts`:
//   - One Supabase channel per table (de-duplicated across components).
//   - Reference counted: opens on first subscriber, closes on last unmount.
//   - INSERT / UPDATE / DELETE applied in-memory — no polling, no refetch.

import { useEffect, useState } from "react";
import { useLive, patchLive, getLiveRow, applyOptimistic } from "@/lib/db";

export { useLive, patchLive, getLiveRow, applyOptimistic };
export const useRealtime = useLive;

export type RealtimeStatus = "connecting" | "connected" | "disconnected";

// Real connectivity check: tries a lightweight HEAD/GET to Supabase with a 3s timeout.
// Falls back to navigator.onLine for an instant offline signal.

const SUPABASE_URL =
  (import.meta.env.VITE_SUPABASE_URL as string | undefined) ?? "";
const SUPABASE_KEY =
  (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) ??
  (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) ??
  "";
const PING_URL = SUPABASE_URL
  ? `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/health`
  : "";

const statusListeners = new Set<(s: RealtimeStatus) => void>();
let currentStatus: RealtimeStatus = "connecting";
let pollTimer: ReturnType<typeof setInterval> | null = null;
let started = false;
let consecutiveFailures = 0;
const FAILURE_THRESHOLD = 2;
const POLL_MS = 30000;

function setStatus(s: RealtimeStatus) {
  if (currentStatus === s) return;
  currentStatus = s;
  statusListeners.forEach((fn) => fn(s));
}

// Allow other parts of the app (successful queries, realtime channels) to
// report that the backend is reachable, suppressing false "disconnected".
export function reportBackendReachable() {
  consecutiveFailures = 0;
  setStatus("connected");
}

async function pingOnce(): Promise<void> {
  if (!PING_URL) {
    setStatus("connected");
    return;
  }
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 5000);
  try {
    const res = await fetch(PING_URL, {
      method: "GET",
      cache: "no-store",
      signal: ctrl.signal,
      headers: SUPABASE_KEY ? { apikey: SUPABASE_KEY } : undefined,
    });
    // Any HTTP response (even 4xx) proves the backend is reachable.
    if (res.status > 0) {
      consecutiveFailures = 0;
      setStatus("connected");
      return;
    }
    throw new Error("no response");
  } catch {
    consecutiveFailures += 1;
    if (consecutiveFailures >= FAILURE_THRESHOLD) {
      setStatus("disconnected");
    } else if (currentStatus !== "connected") {
      setStatus("connecting");
    }
  } finally {
    clearTimeout(timeout);
  }
}

function ensureMonitor() {
  if (started || typeof window === "undefined") return;
  started = true;
  void pingOnce();
  pollTimer = setInterval(() => {
    void pingOnce();
  }, POLL_MS);
  window.addEventListener("online", () => {
    consecutiveFailures = 0;
    setStatus("connecting");
    void pingOnce();
  });
  // navigator.onLine is unreliable — verify with a real ping rather than
  // immediately flipping to "disconnected".
  window.addEventListener("offline", () => void pingOnce());
  window.addEventListener("focus", () => void pingOnce());
}

export function useRealtimeStatus(): RealtimeStatus {
  const [s, setS] = useState<RealtimeStatus>(currentStatus);
  useEffect(() => {
    ensureMonitor();
    statusListeners.add(setS);
    setS(currentStatus);
    return () => {
      statusListeners.delete(setS);
    };
  }, []);
  return s;
}

// Keep pollTimer reference to avoid unused warning under strict configs.
export function __stopRealtimeMonitor() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
    started = false;
  }
}
