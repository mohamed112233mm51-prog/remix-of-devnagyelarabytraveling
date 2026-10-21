import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule, flush, deferred } from "./helpers/loadTsModule.mjs";

const initialForm = { agent_id: "a1", approval_company_id: "c1", departure_from: "القاهرة", destination: "بنغازي", airline: "الأفريقية", status: "سريع", passenger_type: "بالغ" };
const company = { kind: "company", service_type: "تذكرة", company_id: "c1", count: 2, company_price: 0, company_value: 0 };
const sale = { kind: "agent", service_type: "تذكرة", count: 3, agent_price: 0 };
const result = (price = 100, currency = "USD") => ({ rule: { company_price: price, currency }, agentPrice: price + 20 });

function setup({ rows = [company, sale], form = initialForm, editing = false, agents = [{ id: "a1", tier: "A" }, { id: "a2", tier: "B" }], resolve = () => result() } = {}) {
  let services = structuredClone(rows), inputs = { ...form }, agentRows = structuredClone(agents);
  let cells = [], cursor = 0, effects = [], dirty = false, output, unmounted = false;
  const calls = [];
  const changed = (a, b) => !a || b.some((v, i) => !Object.is(v, a[i]));
  const react = {
    useRef(value) { return cells[cursor++] ??= { current: value }; },
    useState(initial) {
      const i = cursor++;
      if (!cells[i]) {
        cells[i] = { value: initial };
        cells[i].set = value => { const next = typeof value === "function" ? value(cells[i].value) : value; if (!Object.is(next, cells[i].value)) { cells[i].value = next; dirty = true; } };
      }
      return [cells[i].value, cells[i].set];
    },
    useEffect(fn, deps) { const i = cursor++; if (!cells[i] || changed(cells[i].deps, deps)) effects.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; }); },
  };
  const pricing = { resolveAgentPrice: async context => { calls.push(context); return resolve(context, calls.length); } };
  const { useExecutionServicePricing } = loadTsModule("src/hooks/useExecutionServicePricing.ts", { react, "@/lib/pricingMatch": pricing });
  const setServices = update => { assert.equal(unmounted, false, "late requests must not set state after unmount"); services = typeof update === "function" ? update(services) : update; dirty = true; };
  function render(runEffects = true) { cursor = 0; dirty = false; output = useExecutionServicePricing(inputs, services, agentRows, setServices, editing); if (runEffects) while (effects.length) effects.shift()(); }
  async function settle() { for (let i = 0; i < 15; i++) { await flush(); if (dirty) render(); } assert.equal(dirty, false); }
  render();
  return {
    calls, settle, get rows() { return services; }, get status() { return output; },
    async form(patch) { inputs = { ...inputs, ...patch }; render(); await settle(); },
    async update(index, patch) { services = services.map((row, i) => i === index ? { ...row, ...patch } : row); render(); await settle(); },
    async remove(index) { services = services.filter((_, i) => i !== index); render(); await settle(); },
    async add(row) { services = [...services, { ...row }]; render(); await settle(); },
    async agents(value) { agentRows = value; render(); await settle(); },
    beforeEffects(patch) { inputs = { ...inputs, ...patch }; render(false); },
    beforeServiceEffects(change) { services = change(services); render(false); },
    unmount() { for (const cell of cells) cell?.cleanup?.(); unmounted = true; },
    strictReplay() { for (const cell of cells) cell?.cleanup?.(); for (const cell of cells) if (cell?.deps) cell.deps = undefined; render(); },
  };
}

test("initial buy/sell prices load automatically through one shared read, retaining quantities and currency", async () => {
  const h = setup(); assert.equal(h.status.pending, true); await h.settle();
  assert.equal(h.calls.length, 1); assert.equal(h.rows[0].company_price, 100); assert.equal(h.rows[1].agent_price, 120);
  assert.equal(h.rows[0].count, 2); assert.equal(h.rows[1].count, 3);
  assert.equal(h.rows[0].currency, "USD"); assert.equal(h.rows[1].currency, "USD");
  assert.equal(h.status.pending, false); assert.ok(h.status.statuses.every(s => s.state === "matched"));
});

test("every form pricing factor, selected agent and agent tier triggers a fresh exact context", async () => {
  const h = setup({ resolve: (_ctx, n) => result(100 + n) }); await h.settle();
  for (const [field, value] of Object.entries({ departure_from: "طرابلس", destination: "القاهرة", airline: "برنيق", approval_company_id: "c2", status: "عادي", passenger_type: "طفل", agent_id: "a2" })) {
    const before = h.calls.length; await h.form({ [field]: value }); assert.ok(h.calls.length > before, field);
    if (field !== "agent_id") assert.equal(h.calls.at(-1)[field], value, field);
    else assert.equal(h.calls.at(-1).agent_tier, "B");
  }
  const before = h.calls.length; await h.agents([{ id: "a2", tier: "C" }]);
  assert.ok(h.calls.length > before); assert.equal(h.calls.at(-1).agent_tier, "C");
});

test("row company and service changes refresh only that row and preserve buy-company versus sale-company selection", async () => {
  const h = setup(); await h.settle();
  await h.update(0, { company_id: "c3" }); assert.equal(h.calls.length, 2); assert.equal(h.calls.at(-1).company_id, "c3");
  assert.equal(h.rows[1].agent_price, 120);
  await h.update(1, { service_type: "موافقة" }); assert.equal(h.calls.length, 3);
  assert.equal(h.calls.at(-1).company_id, "c1"); assert.equal(h.calls.at(-1).service_type, "موافقة");
});

test("quantity, note and manual price edits do not fetch or overwrite a settled manual override", async () => {
  const h = setup(); await h.settle();
  await h.update(0, { company_price: 777, count: 4, note: "ملاحظة" }); await h.update(1, { agent_price: 888 });
  await h.form({ notes: "ملاحظة تنفيذ", operation_status: "منفذ", travel_date: "2026-10-21" });
  assert.equal(h.calls.length, 1); assert.equal(h.rows[0].company_price, 777); assert.equal(h.rows[1].agent_price, 888);
  await h.form({ destination: "مصراتة" }); assert.equal(h.rows[0].company_price, 100); assert.equal(h.rows[0].count, 4);
});

test("new agent with the same tier still triggers the requested context refresh", async () => {
  const h = setup({ agents: [{ id: "a1", tier: "A" }, { id: "other", tier: "A" }] }); await h.settle();
  await h.form({ agent_id: "other" }); assert.equal(h.calls.length, 2);
});

test("missing source or agent clears the stale amount and legacy total and performs no invalid read", async () => {
  const h = setup({ rows: [{ ...company, company_id: null }, sale] }); await h.settle();
  await h.form({ approval_company_id: "" }); assert.equal(h.calls.length, 1);
  assert.equal(h.rows[0].company_price, 0); assert.equal(h.rows[0].company_value, 0); assert.equal(h.rows[1].agent_price, 0);
  assert.ok(h.status.statuses.every(s => s.state === "missing"));
  const other = setup(); await other.settle(); await other.form({ agent_id: "" });
  assert.equal(other.rows[1].agent_price, 0); assert.match(other.status.statuses[1].message, /الوكيل/);
  assert.equal(other.calls.at(-1).agent_tier, "A"); // existing purchase fallback
});

test("no matching rule and network failure expose a warning, clear stale price/currency and allow manual entry", async () => {
  let fail = false;
  const h = setup({ resolve: () => fail ? { rule: null, agentPrice: null, reason: "لا يوجد سعر مطابق" } : result() }); await h.settle();
  fail = true; await h.form({ destination: "خارج القائمة" });
  assert.equal(h.rows[0].company_price, 0); assert.equal(h.rows[1].agent_price, 0); assert.equal(h.rows[1].currency, "EGP");
  assert.equal(h.status.pending, false); assert.match(h.status.statuses[1].message, /لا يوجد سعر مطابق/);
  await h.update(1, { agent_price: 45 }); assert.equal(h.rows[1].agent_price, 45);
  const network = setup({ resolve: () => { throw Error("offline"); } }); await network.settle();
  assert.equal(network.status.pending, false); assert.match(network.status.statuses[0].message, /تعذر جلب/);
});

test("out-of-order responses cannot replace newer prices or currencies", async () => {
  const old = deferred(), fresh = deferred();
  const h = setup({ resolve: (_ctx, n) => n === 1 ? old.promise : fresh.promise }); await h.settle();
  await h.form({ destination: "طرابلس" }); assert.equal(h.status.pending, true);
  fresh.resolve(result(400, "LYD")); await h.settle();
  old.resolve(result(100, "USD")); await h.settle();
  assert.equal(h.rows[0].company_price, 400); assert.equal(h.rows[1].agent_price, 420); assert.equal(h.rows[1].currency, "LYD");
});

test("a response arriving after render but before the changed context's effect cannot apply its stale price", async () => {
  const old = deferred(), fresh = deferred();
  const h = setup({ resolve: (_ctx, n) => n === 1 ? old.promise : fresh.promise }); await h.settle();
  h.beforeEffects({ passenger_type: "طفل" }); assert.equal(h.status.pending, true);
  old.resolve(result(900)); await h.settle();
  assert.equal(h.rows[1].agent_price, 0); assert.equal(h.status.pending, true);
  fresh.resolve(result(25)); await h.settle(); assert.equal(h.rows[1].agent_price, 45);
});

test("deleting a pending row does not apply its response to the shifted next row", async () => {
  const first = deferred(), second = deferred();
  const h = setup({ rows: [company, { ...sale, service_type: "موافقة" }], resolve: ctx => ctx.service_type === "تذكرة" ? first.promise : second.promise }); await h.settle();
  await h.remove(0); first.resolve(result(999)); await h.settle(); assert.equal(h.rows[0].agent_price, 0);
  second.resolve(result(50)); await h.settle(); assert.equal(h.rows.length, 1); assert.equal(h.rows[0].agent_price, 70);
});

test("count and note changes during lookup retain the request and use the latest row values", async () => {
  const pending = deferred(); const h = setup({ resolve: () => pending.promise }); await h.settle();
  await h.update(0, { count: 7, note: "latest" }); assert.equal(h.calls.length, 1);
  pending.resolve(result()); await h.settle();
  assert.equal(h.rows[0].company_price, 100); assert.equal(h.rows[0].count, 7); assert.equal(h.rows[0].note, "latest");
});

test("a response arriving between removal render and effect follows its row rather than its previous index", async () => {
  const first = deferred(), second = deferred();
  const h = setup({ rows: [company, { ...sale, service_type: "موافقة" }], resolve: ctx => ctx.service_type === "تذكرة" ? first.promise : second.promise }); await h.settle();
  h.beforeServiceEffects(rows => rows.slice(1));
  first.resolve(result(999)); second.resolve(result(50)); await h.settle();
  assert.equal(h.rows.length, 1); assert.equal(h.rows[0].agent_price, 70); assert.equal(h.status.pending, false);
});

test("unchanged historical prices and explicit totals survive open, unrelated edits, row additions and removals", async () => {
  const h = setup({ editing: true, rows: [{ ...company, company_price: 13, company_value: 26, currency: "LYD" }, { ...sale, agent_price: 17 }] }); await h.settle();
  assert.equal(h.calls.length, 0); await h.update(0, { note: "unchanged price" }); await h.add({ ...sale, service_type: "جديد" });
  assert.equal(h.calls.length, 1); assert.equal(h.rows[0].company_price, 13); assert.equal(h.rows[0].company_value, 26);
  await h.remove(0); assert.equal(h.rows[0].agent_price, 17); assert.equal(h.calls.length, 1); assert.equal(h.status.pending, false);
  await h.form({ passenger_type: "طفل" }); assert.equal(h.rows[0].agent_price, 120);
});

test("historical agent-list hydration preserves saved prices, then real tier changes reprice normally", async () => {
  const h = setup({ editing: true, agents: [], rows: [{ ...sale, agent_price: 55 }] }); await h.settle();
  await h.agents([{ id: "a1", tier: "B" }]); assert.equal(h.calls.length, 0); assert.equal(h.rows[0].agent_price, 55);
  await h.agents([{ id: "a1", tier: "C" }]); assert.equal(h.calls.length, 1); assert.equal(h.rows[0].agent_price, 120);
});

test("strict effect replay restarts pending reads without repricing saved historical rows", async () => {
  const wait = deferred(); const h = setup({ resolve: () => wait.promise }); await h.settle(); h.strictReplay(); await h.settle();
  wait.resolve(result()); await h.settle(); assert.equal(h.rows[1].agent_price, 120); assert.equal(h.status.pending, false);
  const history = setup({ editing: true }); await history.settle(); history.strictReplay(); await history.settle(); assert.equal(history.calls.length, 0);
});

test("unmounted forms ignore late lookup results", async () => {
  const wait = deferred(); const h = setup({ resolve: () => wait.promise }); await h.settle(); h.unmount();
  wait.resolve(result()); await flush(); assert.equal(h.rows[0].company_price, 0);
});

test("automatic prices reuse the real most-specific pricing resolver and its existing read-only table", async () => {
  const reads = [];
  const rules = [
    { company_id: "c1", service_type: "تذكرة", agent_tier: "A", company_price: 100, agent_price: 120, currency: "EGP" },
    { company_id: "c1", service_type: "تذكرة", agent_tier: "A", passenger_type: "طفل", destination: "بنغازي", company_price: 70, agent_price: 85, currency: "LYD" },
  ];
  const { resolveAgentPrice } = loadTsModule("src/lib/pricingMatch.ts", { "@/integrations/supabase/client": { supabase: { from(table) {
    assert.equal(table, "company_pricing_rules"); const filters = [];
    const q = { select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, then(resolve) { reads.push(filters); return Promise.resolve({ data: rules.filter(r => filters.every(([k, v]) => r[k] === v)) }).then(resolve); } }; return q;
  } } } });
  const h = setup({ resolve: resolveAgentPrice }); await h.settle(); assert.equal(h.rows[1].agent_price, 120);
  await h.form({ passenger_type: "طفل" }); assert.equal(h.rows[0].company_price, 70); assert.equal(h.rows[1].agent_price, 85); assert.equal(h.rows[0].currency, "LYD");
  assert.equal(reads.length, 2);
});
