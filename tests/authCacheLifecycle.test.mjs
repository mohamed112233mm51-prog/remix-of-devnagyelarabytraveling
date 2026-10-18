import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule, flush, deferred } from "./helpers/loadTsModule.mjs";
const permissions = loadTsModule("src/lib/permissionKeys.ts");
const session = (id, token = "token") => ({ user: { id, last_sign_in_at: "2026-10-18" }, access_token: token });
const profile = (perms = {}) => ({ is_active: true, invite_accepted: true, permissions: perms, is_super_admin: false });
function harness() {
  const cells = [], effects = [], timers = new Map(), channels = [], queries = [];
  let cursor = 0, dirty = false, callback, timerId = 0, pendingProfile = null, bootstrap = null;
  let clears = 0, invalidations = 0, resets = 0;
  const profiles = { a: profile(), b: profile({ executions: { view: true } }) };
  const changed = (prev, next) => !prev || next.some((v, i) => !Object.is(v, prev[i]));
  function useState(initial) {
    const i = cursor++;
    if (!cells[i]) cells[i] = { value: initial };
    return [cells[i].value, next => {
      const value = typeof next === "function" ? next(cells[i].value) : next;
      if (!Object.is(value, cells[i].value)) { cells[i].value = value; dirty = true; }
    }];
  }
  function useRef(value) { const i = cursor++; return cells[i] ??= { current: value }; }
  function useCallback(fn, deps) {
    const i = cursor++;
    if (!cells[i] || changed(cells[i].deps, deps)) cells[i] = { deps, fn };
    return cells[i].fn;
  }
  function useEffect(fn, deps) {
    const i = cursor++;
    if (!cells[i] || changed(cells[i].deps, deps)) {
      effects.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; });
    }
  }
  const queryClient = { clear() { clears++; }, async resetQueries() { resets++; } };
  const supabase = {
    auth: {
      onAuthStateChange(cb) { callback = cb; return { data: { subscription: { unsubscribe() {} } } }; },
      getSession() { return bootstrap?.promise ?? Promise.resolve({ data: { session: null } }); },
      async signOut() { callback("SIGNED_OUT", null); },
    },
    from(table) { return { select() { return { eq(field, uid) {
      queries.push({ table, uid });
      if (table === "user_roles") return Promise.resolve({ data: [], error: null });
      return { async maybeSingle() {
        if (pendingProfile) { const waiting = pendingProfile; pendingProfile = null; return waiting.promise; }
        return { data: profiles[uid], error: null };
      } };
    } }; } }; },
    channel() {
      const c = { handlers: [], on(_kind, config, cb) { c.handlers.push({ config, cb }); return c; },
        subscribe(cb) { c.status = cb; return c; } };
      channels.push(c); return c;
    },
    async removeChannel() {},
  };
  const windowMock = { setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout(id) { timers.delete(id); }, addEventListener() {}, removeEventListener() {}, location: { pathname: "/" } };
  const api = loadTsModule("src/hooks/useAuth.tsx", {
    react: { createContext: () => ({ Provider: "provider" }), useContext() {}, useCallback, useEffect, useRef, useState },
    "react/jsx-runtime": { jsx: (type, props) => ({ type, props }) },
    "@/integrations/supabase/client": { supabase }, sonner: { toast: { error() {} } },
    "@tanstack/react-query": { useQueryClient: () => queryClient },
    "@/hooks/useCompleteFinancialTables": { invalidateCompleteFinancialTables() { invalidations++; } },
    "@/lib/permissionKeys": permissions,
  }, { window: windowMock, setTimeout: windowMock.setTimeout, console: { info() {}, warn() {}, debug() {} } });
  let value;
  function render() {
    cursor = 0; dirty = false; value = api.AuthProvider({ children: null }).props.value;
    while (effects.length) effects.shift()();
    return value;
  }
  async function settle() {
    for (let i = 0; i < 8; i++) {
      for (const [id, timer] of [...timers]) if (timer.ms === 0) { timers.delete(id); timer.fn(); }
      await flush(); if (dirty) render();
    }
    return value;
  }
  return { render, settle, profiles, channels, queries,
    event(event, s) { callback(event, s); },
    counters: () => ({ clears, invalidations, resets }),
    pauseProfile() { pendingProfile = deferred(); return pendingProfile; },
    pauseBootstrap() { bootstrap = deferred(); return bootstrap; },
  };
}

test("same-user TOKEN_REFRESHED retains mounted data and makes no profile/data reload", async () => {
  const h = harness(); h.render(); await h.settle();
  h.event("SIGNED_IN", session("a")); let value = await h.settle();
  assert.equal(value.profileLoaded, true);
  const before = h.counters(), count = h.queries.length;
  h.event("TOKEN_REFRESHED", session("a", "fresh")); value = h.render();
  assert.equal(value.profileLoaded, true);
  assert.equal(value.session.access_token, "fresh"); await h.settle();
  assert.equal(h.queries.length, count);
  assert.deepEqual(h.counters(), before);
});

test("same-user SIGNED_IN verifies profile in background without clearing tables", async () => {
  const h = harness(); h.render(); await h.settle();
  h.event("SIGNED_IN", session("a")); await h.settle(); const before = h.counters();
  h.event("SIGNED_IN", session("a"));
  assert.equal(h.render().profileLoaded, true);
  await h.settle(); assert.deepEqual(h.counters(), before);
});

test("switching identity clears table/query data and blocks layout until new profile loads", async () => {
  const h = harness(); h.render(); await h.settle();
  h.event("SIGNED_IN", session("a")); await h.settle(); const before = h.counters();
  const waiting = h.pauseProfile(); h.event("SIGNED_IN", session("b"));
  assert.equal(h.render().profileLoaded, false); await h.settle();
  assert.equal(h.counters().clears, before.clears + 1);
  assert.equal(h.counters().invalidations, before.invalidations + 1);
  waiting.resolve({ data: h.profiles.b, error: null }); const value = await h.settle();
  assert.equal(value.user.id, "b"); assert.equal(value.profileLoaded, true);
});

test("logout clears cache and a late old profile cannot restore its permissions", async () => {
  const h = harness(); h.render(); await h.settle();
  const waiting = h.pauseProfile(); h.event("SIGNED_IN", session("a")); await h.settle();
  h.event("SIGNED_OUT", null); h.render();
  waiting.resolve({ data: profile({ sensitive: true }), error: null }); const value = await h.settle();
  assert.equal(value.session, null); assert.equal(value.profileLoaded, false);
  assert.deepEqual(value.permissions, {});
});

test("permission changes invalidate table data and reset active queries; unchanged permissions reuse cache", async () => {
  const h = harness(); h.render(); await h.settle();
  h.event("SIGNED_IN", session("a")); await h.settle(); const before = h.counters();
  const handler = h.channels.at(-1).handlers.find(h => h.config.table === "profiles").cb;
  handler({ eventType: "UPDATE", new: profile({ executions: { view: true } }) });
  await h.settle();
  assert.equal(h.counters().invalidations, before.invalidations + 1);
  assert.equal(h.counters().resets, before.resets + 1);
  const after = h.counters();
  handler({ eventType: "UPDATE", new: profile({ executions: { view: true } }) });
  await h.settle(); assert.deepEqual(h.counters(), after);
});

test("a stale getSession bootstrap cannot resurrect a session after SIGNED_OUT", async () => {
  const h = harness(), waiting = h.pauseBootstrap(); h.render();
  h.event("SIGNED_IN", session("a")); await h.settle();
  h.event("SIGNED_OUT", null); await h.settle();
  waiting.resolve({ data: { session: session("a") } });
  const value = await h.settle(); assert.equal(value.session, null); assert.equal(value.profileLoaded, false);
});

test("initial profile errors still block layout and explicit retry can recover", async () => {
  const h = harness(); h.render(); await h.settle();
  const waiting = h.pauseProfile(); h.event("SIGNED_IN", session("a")); await h.settle();
  waiting.resolve({ data: null, error: { message: "offline" } }); let value = await h.settle();
  assert.equal(value.profileLoaded, false); assert.equal(value.profileError, "offline");
  await value.refreshProfile(); value = await h.settle();
  assert.equal(value.profileLoaded, true); assert.equal(value.profileError, null);
});
