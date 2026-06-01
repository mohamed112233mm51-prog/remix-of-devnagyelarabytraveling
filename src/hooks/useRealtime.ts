// Central Realtime hook for the app.
//
// Built on top of the shared per-table store in `src/lib/db.ts`:
//   - One Supabase channel per table (de-duplicated across components).
//   - Reference counted: opens on first subscriber, closes on last unmount.
//   - INSERT / UPDATE / DELETE applied in-memory — no polling, no refetch.
//
// Re-exported here so every feature imports a single, well-known entry point
// (`@/hooks/useRealtime`) instead of reaching into `lib/db`.

import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useLive, patchLive, getLiveRow, applyOptimistic } from "@/lib/db";

export { useLive, patchLive, getLiveRow, applyOptimistic };
export const useRealtime = useLive;

export type RealtimeStatus = "connecting" | "connected" | "disconnected";

/**
 * Subscribes to Supabase Realtime connection state.
 * Uses a single shared heartbeat channel so the indicator does not create
 * per-component subscriptions.
 */
let sharedChannel: ReturnType<typeof supabase.channel> | null = null;
const statusListeners = new Set<(s: RealtimeStatus) => void>();
let currentStatus: RealtimeStatus = "connecting";

function setStatus(s: RealtimeStatus) {
  currentStatus = s;
  statusListeners.forEach((fn) => fn(s));
}

function ensureChannel() {
  if (sharedChannel) return;
  sharedChannel = supabase
    .channel("realtime-heartbeat")
    .subscribe((status) => {
      if (status === "SUBSCRIBED") setStatus("connected");
      else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
        setStatus("disconnected");
      else setStatus("connecting");
    });
}

export function useRealtimeStatus(): RealtimeStatus {
  const [s, setS] = useState<RealtimeStatus>(currentStatus);
  useEffect(() => {
    ensureChannel();
    statusListeners.add(setS);
    setS(currentStatus);
    return () => {
      statusListeners.delete(setS);
    };
  }, []);
  return s;
}
