import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule, flush, deferred } from "./helpers/loadTsModule.mjs";

const initialForm = { agent_id: "a1", approval_company_id: "c1", departure_from: "القاهرة", destination: "بنغازي", airline: "الأفريقية", status: "سريع", passenger_type: "بالغ" };
const company = { kind: "company", service_type: "تذكرة", company_id: "c1", count: 2, company_price: 0, company_value: 0 };
const sale = { kind: "agent", service_type: "تذكرة", count: 3, agent_price: 0 };
const result = (price = 100, currency = "USD") => ({ rule: { company_price: price, currency }, agentPrice: price + 20 });

function setup({ rows = [company, sale], form = initialForm, agents = [{ id: "a1", tier: "A" }, { id: "a2", tier: "B" }], resolve = () => result() } = {}) {
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
  function render(runEffects = true) { cursor = 0; dirty = false; output = useExecutionServicePricing(inputs, services, agentRows, setServices); if (runEffects) while (effects.length) effects.shift()(); }
  async function settle() { for (let i = 0; i < 15; i++) { await flush(); if (dirty) render(); } assert.equal(dirty, false); }
  render();
  return {
    calls, settle, get rows() { return services; }, get status() { return output; },
    async form(patch) { inputs = { ...inputs, ...patch }; render(); await settle(); },
    async update(index, patch) { services = services.map((row, i) => i === index ? { ...row, ...patch } : row); render(); await settle(); },
    async manual(index, price) { output.setManualPrice(index, price); render(); await settle(); },
    async fetch(index) { output.fetchPrice(index); render(); await settle(); },
    async fetchMany(indices) { indices.forEach(index => output.fetchPrice(index)); render(); await settle(); },
    async changeService(index, patch) { output.changeService(index, patch); render(); await settle(); },
    async remove(index) { services = services.filter((_, i) => i !== index); render(); await settle(); },
    async add(row) { services = [...services, { ...row }]; render(); await settle(); },
    async agents(value) { agentRows = value; render(); await settle(); },
    beforeEffects(patch) { inputs = { ...inputs, ...patch }; render(false); },
    beforeServiceEffects(change) { services = change(services); render(false); },
    unmount() { for (const cell of cells) cell?.cleanup?.(); unmounted = true; },
    strictReplay() { for (const cell of cells) cell?.cleanup?.(); for (const cell of cells) if (cell?.deps) cell.deps = undefined; render(); },
  };
}

test("opening a new form and adding rows never reads or clears prices", async () => {
  const h = setup(); assert.equal(h.status.pending, false); await h.settle();
  assert.equal(h.calls.length, 0); assert.equal(h.rows[0].company_price, 0);
  await h.add({ ...sale, agent_price: 777, currency: "LYD", _priceSource: "auto" });
  assert.equal(h.calls.length, 0); assert.equal(h.rows[2].agent_price, 777); assert.equal(h.rows[2].currency, "LYD");
});

test("explicit buy/sell buttons update only their own row using current quantities and currency", async () => {
  const h = setup({ rows: [{ ...company, company_price: 7, company_value: 25 }, { ...sale, agent_price: 9 }] }); await h.settle();
  await h.fetch(0); assert.equal(h.calls.length, 1); assert.equal(h.rows[0].company_price, 100);
  assert.equal(h.rows[0].company_value, 0); assert.equal(h.rows[0].currency, "USD"); assert.equal(h.rows[0].count, 2);
  assert.equal(h.rows[1].agent_price, 9);
  await h.fetch(1); assert.equal(h.calls.length, 2); assert.equal(h.rows[1].agent_price, 120); assert.equal(h.rows[1].count, 3);
  assert.equal(h.status.pending, false);
});

test("all pricing dimensions, agent/tier hydration and unrelated form edits retain fetched prices until another click", async () => {
  const h = setup(); await h.fetchMany([0, 1]); const before = structuredClone(h.rows), reads = h.calls.length;
  for (const [field, value] of Object.entries({ departure_from: "طرابلس", destination: "القاهرة", airline: "برنيق", approval_company_id: "c2", status: "عادي", passenger_type: "طفل", agent_id: "a2", notes: "ملاحظة", travel_date: "2026-10-21", dob: "2018-10-20", operation_status: "منفذ" })) {
    await h.form({ [field]: value }); assert.deepEqual(h.rows, before, field); assert.equal(h.calls.length, reads, field);
    assert.equal(h.status.pending, false);
  }
  await h.agents([{ id: "a2", tier: "C" }]); assert.deepEqual(h.rows, before); assert.equal(h.calls.length, reads);
  await h.fetch(1); assert.equal(h.calls.length, reads + 1);
  assert.equal(h.calls.at(-1).agent_tier, "C"); assert.equal(h.calls.at(-1).company_id, "c2");
  assert.equal(h.calls.at(-1).passenger_type, "طفل"); assert.equal(h.calls.at(-1).destination, "القاهرة");
});

test("changing a row's service and purchase issuer keeps unit price, explicit total and currency", async () => {
  const h = setup({ rows: [{ ...company, company_price: 777, company_value: 1554, currency: "LYD" }, { ...sale, agent_price: 888, currency: "USD" }] }); await h.settle();
  await h.changeService(0, { company_id: "c3", service_type: "موافقة" }); await h.changeService(1, { service_type: "استقبال" });
  assert.equal(h.calls.length, 0); assert.equal(h.rows[0].company_price, 777); assert.equal(h.rows[0].company_value, 1554); assert.equal(h.rows[0].currency, "LYD");
  assert.equal(h.rows[1].agent_price, 888); assert.equal(h.rows[1].currency, "USD");
  await h.fetch(0); assert.equal(h.calls[0].company_id, "c3"); assert.equal(h.calls[0].service_type, "موافقة");
  await h.fetch(1); assert.equal(h.calls[1].company_id, "c1"); assert.equal(h.calls[1].service_type, "استقبال");
});

test("missing company, agent or service only shows feedback on click, without clearing saved prices", async () => {
  for (const [rows, form, expected] of [
    [[{ ...sale, agent_price: 88 }], { ...initialForm, approval_company_id: "" }, /الشركة/],
    [[{ ...sale, agent_price: 88 }], { ...initialForm, agent_id: "" }, /الوكيل/],
    [[{ ...sale, service_type: "", agent_price: 88 }], initialForm, /نوع الخدمة/],
  ]) {
    const h = setup({ rows, form }); await h.settle(); assert.equal(h.status.statuses[0].state, "saved");
    await h.fetch(0); assert.equal(h.calls.length, 0); assert.match(h.status.statuses[0].message, expected);
    assert.equal(h.rows[0].agent_price, 88); assert.equal(h.status.pending, false);
  }
});

test("unmatched and failed explicit reads preserve the existing prices, currency and explicit total", async () => {
  for (const resolve of [() => ({ rule: null, agentPrice: null, reason: "لا يوجد سعر مطابق" }), () => { throw Error("offline"); }]) {
    const h = setup({ rows: [{ ...company, company_price: 777, company_value: 1554, currency: "LYD" }, { ...sale, agent_price: 888, currency: "USD" }], resolve });
    const before = structuredClone(h.rows); await h.fetchMany([0, 1]);
    assert.deepEqual(h.rows, before); assert.equal(h.status.pending, false);
    assert.ok(h.status.statuses.every(status => status.state === "missing" && status.message));
  }
});

test("context changes during a pending lookup cancel its result without starting another read", async () => {
  const old = deferred(); const h = setup({ rows: [{ ...sale, agent_price: 55, currency: "LYD" }], resolve: (_ctx, n) => n === 1 ? old.promise : result(400) });
  await h.fetch(0); assert.equal(h.status.pending, true); assert.equal(h.rows[0].agent_price, 55);
  await h.form({ destination: "طرابلس" }); assert.equal(h.status.pending, false); assert.equal(h.calls.length, 1);
  old.resolve(result(900)); await h.settle(); assert.equal(h.rows[0].agent_price, 55); assert.equal(h.rows[0].currency, "LYD");
  await h.fetch(0); assert.equal(h.rows[0].agent_price, 420); assert.equal(h.calls[1].destination, "طرابلس");
});

test("a stale response arriving after a context render but before its effect cannot apply", async () => {
  const wait = deferred(); const h = setup({ rows: [{ ...sale, agent_price: 55 }], resolve: () => wait.promise });
  await h.fetch(0); h.beforeEffects({ passenger_type: "طفل" }); assert.equal(h.status.pending, false);
  wait.resolve(result(900)); await h.settle(); assert.equal(h.rows[0].agent_price, 55); assert.equal(h.calls.length, 1);
});

test("newer explicit requests win over older responses, including currency", async () => {
  const old = deferred(), fresh = deferred();
  const h = setup({ rows: [sale], resolve: (_ctx, n) => n === 1 ? old.promise : fresh.promise });
  await h.fetch(0); await h.fetch(0); fresh.resolve(result(400, "LYD")); await h.settle();
  old.resolve(result(100, "USD")); await h.settle(); assert.equal(h.rows[0].agent_price, 420); assert.equal(h.rows[0].currency, "LYD");
});

test("deleting a pending row cannot update its shifted neighbor; the neighbor's own request still completes", async () => {
  const first = deferred(), second = deferred();
  const h = setup({ rows: [company, { ...sale, service_type: "موافقة" }], resolve: ctx => ctx.service_type === "تذكرة" ? first.promise : second.promise });
  await h.fetchMany([0, 1]); await h.remove(0); first.resolve(result(999)); await h.settle(); assert.equal(h.rows[0].agent_price, 0);
  second.resolve(result(50)); await h.settle(); assert.equal(h.rows[0].agent_price, 70); assert.equal(h.calls.length, 2);
});

test("count and note changes during a requested lookup use the latest row without extra reads", async () => {
  const wait = deferred(); const h = setup({ rows: [company], resolve: () => wait.promise }); await h.fetch(0);
  h.beforeServiceEffects(rows => rows.map(row => ({ ...row, count: 7, note: "latest" }))); assert.equal(h.status.pending, true);
  wait.resolve(result()); await h.settle(); assert.equal(h.calls.length, 1); assert.equal(h.rows[0].company_price, 100);
  assert.equal(h.rows[0].count, 7); assert.equal(h.rows[0].note, "latest");
});

test("a response between removal render and effect follows its row, never its old index", async () => {
  const first = deferred(), second = deferred();
  const h = setup({ rows: [company, { ...sale, service_type: "موافقة" }], resolve: ctx => ctx.service_type === "تذكرة" ? first.promise : second.promise });
  await h.fetchMany([0, 1]); h.beforeServiceEffects(rows => rows.slice(1)); assert.equal(h.status.pending, true);
  first.resolve(result(999)); second.resolve(result(50)); await h.settle();
  assert.equal(h.rows.length, 1); assert.equal(h.rows[0].agent_price, 70); assert.equal(h.status.pending, false);
});

test("manual input, including zero or the original price, cancels a pending explicit result", async () => {
  for (const price of [0, 55, 777]) {
    const wait = deferred(); const h = setup({ rows: [{ ...sale, agent_price: 55 }], resolve: () => wait.promise });
    await h.fetch(0); await h.manual(0, price); wait.resolve(result(900)); await h.settle();
    assert.equal(h.rows[0].agent_price, price); assert.equal(h.rows[0]._priceSource, "manual"); assert.equal(h.status.pending, false);
  }
});

test("manual currency changes also invalidate a pending explicit lookup", async () => {
  const wait = deferred(); const h = setup({ rows: [sale], resolve: () => wait.promise });
  await h.fetch(0); h.beforeServiceEffects(rows => rows.map(row => ({ ...row, currency: "LYD" })));
  wait.resolve(result(900)); await h.settle(); assert.equal(h.rows[0].agent_price, 0); assert.equal(h.rows[0].currency, "LYD");
});

test("saved and restored manual/automatic/untagged rows all preserve their prices through edits and hydration", async () => {
  for (const source of [undefined, "manual", "auto"]) {
    const h = setup({ agents: [], rows: [{ ...sale, agent_price: 55, currency: "LYD", _priceSource: source }] }); await h.settle();
    await h.agents([{ id: "a1", tier: "B" }]); await h.form({ passenger_type: "طفل" });
    assert.equal(h.calls.length, 0); assert.equal(h.rows[0].agent_price, 55); assert.equal(h.rows[0].currency, "LYD");
    await h.fetch(0); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].agent_tier, "B");
  }
});

test("strict effect replay never initiates a lookup and unmount ignores pending results", async () => {
  const h = setup(); await h.settle(); h.strictReplay(); await h.settle(); assert.equal(h.calls.length, 0);
  const wait = deferred(), pending = setup({ resolve: () => wait.promise }); await pending.fetch(0); pending.unmount();
  wait.resolve(result()); await flush(); assert.equal(pending.rows[0].company_price, 0);
});

test("manual buttons use the existing most-specific resolver and read-only pricing table", async () => {
  const reads = [];
  const rules = [
    { company_id: "c1", service_type: "تذكرة", agent_tier: "A", company_price: 100, agent_price: 120, currency: "EGP" },
    { company_id: "c1", service_type: "تذكرة", agent_tier: "A", passenger_type: "طفل", destination: "بنغازي", company_price: 70, agent_price: 85, currency: "LYD" },
  ];
  const { resolveAgentPrice } = loadTsModule("src/lib/pricingMatch.ts", { "@/integrations/supabase/client": { supabase: { from(table) {
    assert.equal(table, "company_pricing_rules"); const filters = [];
    const q = { select() { return q; }, eq(k, v) { filters.push([k, v]); return q; }, then(resolve) { reads.push(filters); return Promise.resolve({ data: rules.filter(r => filters.every(([k, v]) => r[k] === v)) }).then(resolve); } }; return q;
  } } } });
  const h = setup({ resolve: resolveAgentPrice }); await h.settle(); assert.equal(reads.length, 0);
  await h.fetchMany([0, 1]); assert.equal(h.rows[0].company_price, 100); assert.equal(h.rows[1].agent_price, 120); assert.equal(reads.length, 1);
  await h.form({ passenger_type: "طفل" }); assert.equal(h.rows[1].agent_price, 120); assert.equal(reads.length, 1);
  await h.fetchMany([0, 1]); assert.equal(h.rows[0].company_price, 70); assert.equal(h.rows[1].agent_price, 85); assert.equal(h.rows[0].currency, "LYD"); assert.equal(reads.length, 2);
});

test("reselecting the same service or equivalent empty issuer never clears a price", async () => {
  const h = setup({ rows: [{ ...company, company_id: undefined, company_price: 777, currency: "LYD" }] }); await h.settle();
  await h.changeService(0, { service_type: company.service_type }); await h.changeService(0, { company_id: null });
  assert.equal(h.rows[0].company_price, 777); assert.equal(h.rows[0].currency, "LYD"); assert.equal(h.calls.length, 0);
});
