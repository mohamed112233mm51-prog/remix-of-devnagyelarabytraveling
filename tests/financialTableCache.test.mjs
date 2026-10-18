import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule, flush, deferred } from "./helpers/loadTsModule.mjs";
const readers = loadTsModule("src/lib/readAllRows.ts");
const row = (id, value = id) => ({ id: String(id).padStart(6, "0"), value, created_at: "2026-10-18" });
function harness(seed = []) {
  const tables = { transactions: seed, agents: [] }, calls = [], channels = [], timers = new Map();
  let effect, timerId = 0, now = 0, pause = null, failure = null, failureFrom = 0;
  const clock = {
    setTimeout(fn, ms) { const id = ++timerId; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    async advance(ms) {
      now += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); }
      await flush();
    },
  };
  const supabase = {
    from(table) { return { select(columns) {
      const orders = [];
      const query = { order(field, direction) { orders.push([field, direction]); return query; },
        async range(from, to) {
          calls.push({ table, columns, from, to, orders });
          const snapshot = (tables[table] ?? []).slice(from, to + 1).map(r => ({ ...r }));
          const waiting = pause; pause = null;
          if (waiting) await waiting.promise;
          return failure && from >= failureFrom ? { data: null, error: { message: failure } } : { data: snapshot, error: null };
        } };
      return query;
    } }; },
    channel(name) {
      const channel = { name, removed: false,
        on(_kind, config, cb) { channel.table = config.table; channel.event = cb; return channel; },
        subscribe(cb) { channel.status = cb; return channel; },
      };
      channels.push(channel); return channel;
    },
    removeChannel(channel) { channel.removed = true; return Promise.resolve(); },
  };
  const api = loadTsModule("src/hooks/useCompleteFinancialTables.ts", {
    react: { useState: () => [0, () => {}], useEffect: (fn) => { effect = fn; } },
    sonner: { toast: { error() {} } },
    "@/integrations/supabase/client": { supabase },
    "@/lib/readAllRows": readers,
  }, clock);
  const db = loadTsModule("src/lib/db.ts", {
    react: {}, sonner: { toast: { error() {} } }, "@/integrations/supabase/client": { supabase },
    "@/hooks/useCompleteFinancialTables": api,
  });
  function mount(table = "transactions", hook = api.useCompleteFinancialTable) {
    hook(table); const release = effect();
    return { read: () => hook(table), release };
  }
  return { api, db, supabase, mount, calls, channels, tables, clock,
    pause() { pause = deferred(); return pause; },
    fail(message, from = 0) { failure = message; failureFrom = from; },
    async connect(channel = channels.at(-1)) { channel.status("SUBSCRIBED"); await flush(); },
  };
}

test("ordinary screens and summaries share one complete read/channel with 2505 rows", async () => {
  const h = harness(Array.from({ length: 2505 }, (_, i) => row(i)));
  const screen = h.mount("transactions", h.db.useLive), summary = h.mount();
  await h.connect();
  assert.equal(h.channels.length, 1);
  assert.equal(h.calls.length, 3);
  assert.equal(screen.read().rows.length, 2505);
  assert.equal(summary.read().rows, screen.read().rows);
  assert.deepEqual(h.calls.map(c => [c.from, c.to]), [[0, 999], [1000, 1999], [2000, 2999]]);
  assert.deepEqual(h.calls[0].orders.map(o => o[0]), ["created_at", "id"]);
});

test("exact page boundary reads the final page instead of truncating rows", async () => {
  const h = harness(Array.from({ length: 2000 }, (_, i) => row(i)));
  const view = h.mount(); await h.connect();
  assert.equal(view.read().rows.length, 2000);
  assert.equal(h.calls.length, 3);
});

test("navigation reuses a live snapshot and continues INSERT/UPDATE/DELETE while idle", async () => {
  const h = harness([row(1)]), first = h.mount(); await h.connect();
  first.release(); await h.clock.advance(10_000);
  const channel = h.channels[0];
  channel.event({ eventType: "INSERT", new: row(2) });
  channel.event({ eventType: "UPDATE", new: row(1, "edited") });
  channel.event({ eventType: "DELETE", old: row(2) });
  const second = h.mount();
  assert.equal(second.read().rows[0].value, "edited");
  assert.equal(second.read().rows.length, 1);
  assert.equal(second.read().loading, false);
  assert.equal(h.channels.length, 1);
  assert.equal(h.calls.length, 1);
  await h.clock.advance(30_000);
  assert.equal(channel.removed, false);
});

test("idle expiry discards the disconnected snapshot and next screen reads fresh", async () => {
  const h = harness([row(1)]), first = h.mount(); await h.connect(); first.release();
  await h.clock.advance(30_000);
  assert.equal(h.channels[0].removed, true);
  h.tables.transactions = [row(2)];
  const next = h.mount(); assert.deepEqual(next.read().rows, []);
  await h.connect();
  assert.equal(next.read().rows[0].id, row(2).id);
  assert.equal(h.calls.length, 2);
});

test("a real reconnect reconciles missed deletions and updates, including while idle", async () => {
  const h = harness([row(1), row(2)]), first = h.mount(); await h.connect(); first.release();
  h.channels[0].status("CHANNEL_ERROR");
  h.tables.transactions = [row(2, "reconnected")]; await h.connect();
  const next = h.mount();
  assert.deepEqual(next.read().rows, [row(2, "reconnected")]);
  assert.equal(h.calls.length, 2);
});

test("events during a full read are replayed before exposing its result", async () => {
  const h = harness([row(1)]), wait = h.pause(), view = h.mount();
  h.channels[0].status("SUBSCRIBED");
  h.channels[0].event({ eventType: "UPDATE", new: row(1, "new") });
  h.channels[0].event({ eventType: "INSERT", new: row(2) });
  wait.resolve(); await flush();
  assert.deepEqual(view.read().rows.map(r => r.value), [2, "new"]);
});

test("a delayed subscription performs a catch-up read after fallback", async () => {
  const h = harness([row(1)]), view = h.mount(); await h.clock.advance(2000);
  assert.equal(view.read().rows.length, 1);
  h.tables.transactions.push(row(2)); await h.connect();
  assert.equal(view.read().rows.length, 2);
  assert.equal(h.calls.length, 2);
});

test("writes refresh observed data but never download unopened tables", async () => {
  const h = harness([row(1)]), view = h.mount(); await h.connect();
  h.tables.transactions = [row(1, "saved")];
  await h.db.refetchLiveTables(["transactions", "agents", "transactions"]);
  assert.equal(h.calls.length, 2);
  assert.equal(view.read().rows[0].value, "saved");
  view.release();
  await h.api.refetchCompleteFinancialTables(["transactions"]);
  assert.equal(h.calls.length, 2);
  assert.equal(h.channels[0].removed, true);
});

test("a write during an older in-flight read gets a trailing fresh read", async () => {
  const h = harness([row(1)]), wait = h.pause(), view = h.mount();
  h.channels[0].status("SUBSCRIBED");
  h.tables.transactions = [row(1, "committed")];
  const refresh = h.api.refetchCompleteFinancialTables(["transactions"]);
  wait.resolve(); await refresh;
  assert.equal(view.read().rows[0].value, "committed");
  assert.equal(h.calls.length, 2);
});

test("a second write during refresh cannot be swallowed by deduplication", async () => {
  const h = harness([row(1)]), view = h.mount(); await h.connect();
  const wait = h.pause();
  const first = h.api.refetchCompleteFinancialTables(["transactions"]);
  h.tables.transactions = [row(1, "second write")];
  const second = h.api.refetchCompleteFinancialTables(["transactions"]);
  wait.resolve(); await Promise.all([first, second]);
  assert.equal(view.read().rows[0].value, "second write");
  assert.equal(h.calls.length, 3);
});

test("identity invalidation rejects old reads and late events from the previous channel", async () => {
  const h = harness([row(1, "old user")]), wait = h.pause(), view = h.mount();
  const oldChannel = h.channels[0]; oldChannel.status("SUBSCRIBED");
  h.api.invalidateCompleteFinancialTables();
  assert.deepEqual(view.read().rows, []);
  h.tables.transactions = [row(2, "new user")]; await h.connect();
  oldChannel.event({ eventType: "INSERT", new: row(3, "private") });
  oldChannel.status("SUBSCRIBED"); wait.resolve(); await flush();
  assert.deepEqual(view.read().rows, [row(2, "new user")]);
});

test("refresh failure keeps the last complete snapshot, exposes error and retries", async () => {
  const h = harness([row(1)]), view = h.mount(); await h.connect();
  h.fail("network unavailable"); await h.api.refetchCompleteFinancialTables(["transactions"]);
  assert.equal(view.read().rows.length, 1);
  assert.equal(view.read().error, "network unavailable");
  h.fail(null); h.tables.transactions = [row(2)];
  await h.api.refetchCompleteFinancialTables(["transactions"]);
  assert.deepEqual(view.read().rows, [row(2)]);
  assert.equal(view.read().error, null);
});

test("destructive reset cannot be overwritten by an older in-flight response", async () => {
  const h = harness([row(1)]), wait = h.pause(), view = h.mount();
  h.channels[0].status("SUBSCRIBED"); h.tables.transactions = [];
  h.db.resetLiveTables(); await h.connect(); wait.resolve(); await flush();
  assert.deepEqual(view.read().rows, []);
});

test("optimistic updates and rollback propagate to the ordinary screen and financial summary", async () => {
  const h = harness([row(1)]), screen = h.mount("transactions", h.db.useLive), summary = h.mount();
  await h.connect();
  const pending = deferred();
  const result = h.db.applyOptimistic({ table: "transactions", type: "update", id: row(1).id,
    patch: { value: "optimistic" }, run: () => pending.promise });
  assert.equal(summary.read().rows[0].value, "optimistic");
  assert.equal(screen.read().rows, summary.read().rows);
  pending.resolve({ error: { message: "rejected" } });
  assert.equal((await result).ok, false);
  assert.equal(h.db.getLiveRow("transactions", row(1).id).value, 1);
});

test("failed refresh still applies queued live events and retains the reconciliation error", async () => {
  const h = harness([row(1)]), view = h.mount(); await h.connect();
  const wait = h.pause(); h.fail("offline");
  const refresh = h.api.refetchCompleteFinancialTables(["transactions"]);
  h.channels[0].event({ eventType: "UPDATE", new: row(1, "live update") });
  wait.resolve(); await refresh;
  assert.equal(view.read().rows[0].value, "live update");
  h.channels[0].event({ eventType: "INSERT", new: row(2) });
  assert.equal(view.read().error, "offline");
  assert.equal(view.read().rows.length, 2);
});

test("a failure on a later page never publishes an incomplete replacement", async () => {
  const h = harness([row(1)]), view = h.mount(); await h.connect();
  h.tables.transactions = Array.from({ length: 1200 }, (_, i) => row(i));
  h.fail("second page failed", 1000);
  await h.api.refetchCompleteFinancialTables(["transactions"]);
  assert.equal(h.calls.length, 3);
  assert.deepEqual(view.read().rows, [row(1)]);
  assert.equal(view.read().error, "second page failed");
});

test("logout closes channels without starting anonymous background downloads", async () => {
  const h = harness([row(1)]), view = h.mount(); await h.connect();
  h.api.invalidateCompleteFinancialTables(false);
  await h.clock.advance(2000);
  assert.deepEqual(view.read().rows, []);
  assert.equal(h.channels.length, 1);
  assert.equal(h.channels[0].removed, true);
  assert.equal(h.calls.length, 1);
  view.release();
  const next = h.mount(); await h.connect();
  assert.equal(next.read().rows.length, 1);
});
