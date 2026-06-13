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
const PING_URL = SUPABASE_URL
  ? `${SUPABASE_URL.replace(/\/$/, "")}/auth/v1/health`
  : "/favicon.ico";

const statusListeners = new Set<(s: RealtimeStatus) => void>();
let currentStatus: RealtimeStatus = "connecting";
let pollTimer: ReturnType<typeof setInterval> | null = null;
let started = false;

function setStatus(s: RealtimeStatus) {
  if (currentStatus === s) return;
  currentStatus = s;
  statusListeners.forEach((fn) => fn(s));
}

async function pingOnce(): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    setStatus("disconnected");
    return;
  }
  // Only show "connecting" if we don't already have a known state recently
  if (currentStatus === "connecting") {
    // keep
  }
  const ctrl = new AbortController();
  const timeout = setTimeout(() => ctrl.abort(), 3000);
  try {
    await fetch(PING_URL, {
      method: "GET",
      mode: "no-cors",
      cache: "no-store",
      signal: ctrl.signal,
    });
    setStatus("connected");
  } catch {
    setStatus("disconnected");
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
  }, 10000);
  window.addEventListener("online", () => {
    setStatus("connecting");
    void pingOnce();
  });
  window.addEventListener("offline", () => setStatus("disconnected"));
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
