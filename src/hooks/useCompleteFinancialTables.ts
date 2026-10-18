import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import type { LiveTable } from "@/lib/db";
import { readAllRows } from "@/lib/readAllRows";

const SUBSCRIBE_FALLBACK_MS = 2000;
const IDLE_RELEASE_MS = 30_000;

type CompleteStore = {
  rows: any[];
  loading: boolean;
  error: string | null;
  subscribers: Set<() => void>;
  refCount: number;
  channel: any;
  loaded: boolean;
  fetchPromise: Promise<void> | null;
  pendingEvents: any[];
  everSubscribed: boolean;
  needsReconcileOnSubscribe: boolean;
  fallbackTimer: ReturnType<typeof setTimeout> | null;
  startedWithoutRealtime: boolean;
  generation: number;
  releaseTimer: ReturnType<typeof setTimeout> | null;
  refreshPromise: Promise<void> | null;
  refreshVersion: number;
};

const stores = new Map<LiveTable, CompleteStore>();

function getStore(table: LiveTable): CompleteStore {
  let store = stores.get(table);
  if (!store) {
    store = {
      rows: [],
      loading: true,
      error: null,
      subscribers: new Set(),
      refCount: 0,
      channel: null,
      loaded: false,
      fetchPromise: null,
      pendingEvents: [],
      everSubscribed: false,
      needsReconcileOnSubscribe: false,
      fallbackTimer: null,
      startedWithoutRealtime: false,
      generation: 0,
      releaseTimer: null,
      refreshPromise: null,
      refreshVersion: 0,
    };
    stores.set(table, store);
  }
  return store;
}

function notify(store: CompleteStore) {
  store.subscribers.forEach((fn) => fn());
}

function rowCreatedAt(row: any): string {
  return String(row?.created_at || "");
}

function sortRows(rows: any[]): any[] {
  return rows.sort((a, b) => {
    const byCreatedAt = rowCreatedAt(b).localeCompare(rowCreatedAt(a));
    return byCreatedAt || String(b?.id || "").localeCompare(String(a?.id || ""));
  });
}

async function fetchAllRows<T>(table: LiveTable): Promise<T[]> {
  return readAllRows<T>(supabase, table);
}

function applyEvent(store: CompleteStore, payload: any, shouldNotify = true) {
  const eventType = payload?.eventType;
  const newRow = payload?.new;
  const oldRow = payload?.old;
  const current = Array.isArray(store.rows) ? store.rows : [];

  if (eventType === "INSERT" && newRow?.id) {
    const index = current.findIndex((row) => row?.id === newRow.id);
    if (index >= 0) {
      const next = current.slice();
      next[index] = { ...next[index], ...newRow };
      store.rows = sortRows(next);
    } else {
      store.rows = sortRows([newRow, ...current]);
    }
  } else if (eventType === "UPDATE" && newRow?.id) {
    const index = current.findIndex((row) => row?.id === newRow.id);
    if (index >= 0) {
      const next = current.slice();
      next[index] = { ...next[index], ...newRow };
      store.rows = sortRows(next);
    } else {
      // If the row was created while this client was disconnected, an UPDATE
      // can be the first event we see for it. Add it rather than silently losing it.
      store.rows = sortRows([newRow, ...current]);
    }
  } else if (eventType === "DELETE" && oldRow?.id) {
    store.rows = current.filter((row) => row?.id !== oldRow.id);
  }

  if (shouldNotify) notify(store);
}

function queueOrApplyEvent(store: CompleteStore, payload: any) {
  if (store.fetchPromise || !store.loaded) {
    store.pendingEvents.push(payload);
    return;
  }
  applyEvent(store, payload);
}

async function reconcileStore(table: LiveTable, store: CompleteStore): Promise<void> {
  if (store.fetchPromise) return store.fetchPromise;

  const generation = store.generation;
  store.loading = true;
  store.error = null;
  notify(store);

  const run = (async () => {
    try {
      const rows = await fetchAllRows<any>(table);
      if (generation !== store.generation) return;

      store.rows = sortRows(Array.isArray(rows) ? rows : []);
      store.loaded = true;
      store.error = null;

      const queued = store.pendingEvents;
      store.pendingEvents = [];
      for (const payload of queued) {
        applyEvent(store, payload, false);
      }
    } catch (err: any) {
      if (generation !== store.generation) return;
      // Keep the last complete snapshot on a temporary refresh failure.
      // loading/error still tell consumers that reconciliation did not finish.
      if (store.loaded) {
        const queued = store.pendingEvents;
        store.pendingEvents = [];
        for (const payload of queued) applyEvent(store, payload, false);
      }
      store.error = err?.message || "تعذر تحميل البيانات كاملة";
      // Preserve the ordinary screens' existing failure notification, once per
      // shared read rather than once per mounted consumer.
      toast.error(store.error);
    } finally {
      if (generation === store.generation) {
        store.fetchPromise = null;
        store.loading = false;
        notify(store);
      }
    }
  })();

  store.fetchPromise = run;
  return run;
}

function reconcileAfterCurrent(table: LiveTable, store: CompleteStore) {
  const current = store.fetchPromise;
  if (!current) {
    void reconcileStore(table, store);
    return;
  }

  const generation = store.generation;
  void current.finally(() => {
    if (
      generation === store.generation &&
      store.channel
    ) {
      void reconcileStore(table, store);
    }
  });
}

function startStore(table: LiveTable, store: CompleteStore) {
  if (store.channel) return;

  store.generation += 1;
  const generation = store.generation;
  store.fetchPromise = null;
  store.loading = true;
  store.error = null;
  store.loaded = false;
  store.pendingEvents = [];
  store.everSubscribed = false;
  store.needsReconcileOnSubscribe = false;
  store.startedWithoutRealtime = false;
  notify(store);

  const channel = supabase
    .channel(`complete-shared-${table}-${generation}`)
    .on(
      "postgres_changes" as any,
      { event: "*", schema: "public", table },
      (payload: any) => {
        if (generation === store.generation) queueOrApplyEvent(store, payload);
      },
    );

  store.channel = channel;

  channel.subscribe((status: string) => {
    if (generation !== store.generation) return;
    if (status === "SUBSCRIBED") {
      if (store.fallbackTimer) {
        clearTimeout(store.fallbackTimer);
        store.fallbackTimer = null;
      }

      if (!store.everSubscribed) {
        store.everSubscribed = true;
        if (store.startedWithoutRealtime) {
          // A fallback read may have started before Realtime became active.
          // Finish it, then reconcile once more to close that possible gap.
          store.startedWithoutRealtime = false;
          reconcileAfterCurrent(table, store);
        } else {
          void reconcileStore(table, store);
        }
        return;
      }

      if (store.needsReconcileOnSubscribe) {
        store.needsReconcileOnSubscribe = false;
        reconcileAfterCurrent(table, store);
      }
      return;
    }

    if (
      store.everSubscribed &&
      (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED")
    ) {
      store.needsReconcileOnSubscribe = true;
    }
  });

  // If Realtime cannot subscribe promptly, still show database data. When the
  // channel later connects, the SUBSCRIBED callback performs one reconciliation
  // so no event from the gap can remain missing.
  store.fallbackTimer = setTimeout(() => {
    store.fallbackTimer = null;
    if (!store.everSubscribed) {
      store.startedWithoutRealtime = true;
      void reconcileStore(table, store);
    }
  }, SUBSCRIBE_FALLBACK_MS);
}

function stopStore(store: CompleteStore) {
  store.generation += 1;
  if (store.releaseTimer) clearTimeout(store.releaseTimer);
  store.releaseTimer = null;
  if (store.fallbackTimer) {
    clearTimeout(store.fallbackTimer);
    store.fallbackTimer = null;
  }
  if (store.channel) {
    void supabase.removeChannel(store.channel);
    store.channel = null;
  }

  // Do not serve an old snapshot after the channel has been stopped. A later
  // subscriber gets a fresh full read (still paginated beyond 1000 rows).
  store.rows = [];
  store.loading = true;
  store.error = null;
  store.loaded = false;
  store.pendingEvents = [];
  store.everSubscribed = false;
  store.needsReconcileOnSubscribe = false;
  store.startedWithoutRealtime = false;
  store.fetchPromise = null;
  store.refreshPromise = null;
}

function subscribe(table: LiveTable, callback: () => void): () => void {
  const store = getStore(table);
  store.subscribers.add(callback);
  store.refCount += 1;
  if (store.releaseTimer) clearTimeout(store.releaseTimer);
  store.releaseTimer = null;

  if (!store.channel) {
    startStore(table, store);
  } else if (store.error && !store.fetchPromise) {
    void reconcileStore(table, store);
  }
  // Close the render-to-effect gap when reusing a warm subscription: an event
  // may have arrived after this component rendered but before it subscribed.
  callback();

  return () => {
    store.subscribers.delete(callback);
    store.refCount = Math.max(0, store.refCount - 1);
    if (store.refCount === 0) {
      // Retain the LIVE subscription during navigation, not a disconnected TTL
      // snapshot. Once released, the next screen must do a fresh complete read.
      store.releaseTimer = setTimeout(() => {
        store.releaseTimer = null;
        if (store.refCount === 0) stopStore(store);
      }, IDLE_RELEASE_MS);
    }
  };
}

export async function refetchCompleteFinancialTables(
  tables?: readonly LiveTable[],
): Promise<void> {
  const targets = tables?.length
    ? Array.from(new Set(tables))
    : Array.from(stores.keys());

  await Promise.all(
    targets.map(async (table) => {
      const store = stores.get(table);
      // An unobserved table will be read when opened. Reading it only to throw
      // the result away wastes egress after every financial write.
      if (!store?.channel) return;
      if (store.refCount === 0) {
        stopStore(store);
        return;
      }
      store.refreshVersion += 1;
      if (store.refreshPromise) return store.refreshPromise;
      const generation = store.generation;
      const current = store.fetchPromise;
      const refresh = (async () => {
        if (current) await current;
        // A write may finish during the previous read. One trailing read is
        // required so an older in-flight snapshot cannot count as its refresh.
        while (generation === store.generation) {
          const version = store.refreshVersion;
          await reconcileStore(table, store);
          if (version === store.refreshVersion) break;
        }
      })();
      store.refreshPromise = refresh;
      try { await refresh; }
      finally { if (store.refreshPromise === refresh) store.refreshPromise = null; }
    }),
  );
}

/** Forget data immediately at an identity/permission boundary, including late reads. */
export function invalidateCompleteFinancialTables(restartActive = true) {
  for (const [table, store] of stores) {
    stopStore(store);
    notify(store);
    if (restartActive && store.refCount > 0) startStore(table, store);
  }
}

/** Existing destructive reset semantics, now shared by both table consumers. */
export function resetCompleteFinancialTables(tables?: readonly LiveTable[]) {
  const targets = tables?.length ? tables : Array.from(stores.keys());
  for (const table of targets) {
    const store = getStore(table);
    const active = store.refCount > 0;
    stopStore(store);
    if (active) startStore(table, store);
    else {
      store.loading = false;
      store.loaded = true;
    }
    notify(store);
  }
}

/** Keep the existing optimistic UI/rollback helpers on the same shared store. */
export function patchCompleteFinancialTable(
  table: LiveTable,
  change: { type: "insert" | "update" | "delete"; row: any },
) {
  const store = stores.get(table);
  if (!store?.channel) return;
  const payload = change.type === "delete"
    ? { eventType: "DELETE", old: change.row }
    : { eventType: change.type === "insert" ? "INSERT" : "UPDATE", new: change.row };
  if (store.fetchPromise) store.pendingEvents.push(payload);
  applyEvent(store, payload);
}

export function getCompleteFinancialRow(table: LiveTable, id: string): any | undefined {
  return stores.get(table)?.rows.find((row) => row?.id === id);
}

export function useCompleteFinancialTable<T>(table: LiveTable) {
  const [, force] = useState(0);

  useEffect(
    () => subscribe(table, () => force((value) => value + 1)),
    [table],
  );

  const store = getStore(table);
  return {
    rows: (Array.isArray(store.rows) ? store.rows : []) as T[],
    loading: store.loading,
    error: store.error,
  };
}
