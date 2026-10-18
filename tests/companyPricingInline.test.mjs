import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule, flush, deferred } from "./helpers/loadTsModule.mjs";

const options = { service_type: ["استقبال", "تذكرة"], agent_tier: ["A", "B"], departure_from: ["القاهرة"], destination: ["بنغازي"], airline: ["الأفريقية"], execution_status: ["سريع"], passenger_type: ["بالغ", "سيدات"] };
const base = { id: "r1", company_id: "c1", service_type: "استقبال", agent_tier: "A", departure_from: null, destination: null, airline: null, approval_company_id: null, status: null, passenger_type: "بالغ", company_price: 100, commission_type: "fixed", commission_value: 10, agent_price: 110, currency: "EGP" };
function setup(seed = [base]) {
  let cells = [], effects = [], cursor = 0, dirty = false, tree, companyId = "c1", admin = true, failure = false, hold = null, confirm = false;
  let rows = structuredClone(seed);
  const calls = [], messages = [], confirmations = [], storage = new Map();
  const depsChanged = (a, b) => !a || b.some((v, i) => !Object.is(v, a[i]));
  const react = {
    useState(initial) {
      const i = cursor++;
      if (!cells[i]) cells[i] = { value: typeof initial === "function" ? initial() : initial };
      return [cells[i].value, value => { const next = typeof value === "function" ? value(cells[i].value) : value; if (!Object.is(next, cells[i].value)) { cells[i].value = next; dirty = true; } }];
    },
    useRef(value) { return cells[cursor++] ??= { current: value }; },
    useMemo(fn, deps) { const i = cursor++; if (!cells[i] || depsChanged(cells[i].deps, deps)) cells[i] = { deps, value: fn() }; return cells[i].value; },
    useCallback(fn, deps) { return react.useMemo(() => fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!cells[i] || depsChanged(cells[i].deps, deps)) effects.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; }); },
  };
  const window = { sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  const persistent = loadTsModule("src/hooks/usePersistentState.ts", { react }, { window });
  const supabase = { from(table) {
    let method = "select", payload, filters = [];
    const q = { select() { return q; }, order() { return q; }, eq(key, value) { filters.push([key, value]); return q; },
      insert(value) { method = "insert"; payload = value; return q; }, update(value) { method = "update"; payload = value; return q; },
      async then(resolve) {
        if (method === "select") return resolve({ data: rows.filter(r => filters.every(([k, v]) => r[k] === v)), error: null });
        calls.push({ method, table, payload, filters });
        if (hold) { const wait = hold; hold = null; await wait.promise; }
        if (failure) return resolve({ error: { message: "save failed" } });
        const price = r => ({ ...r, agent_price: r.commission_type === "fixed" ? r.company_price + r.commission_value : r.company_price * (1 + r.commission_value / 100) });
        if (method === "insert") rows.push(price({ ...payload, id: "new-id" }));
        else rows = rows.map(r => filters.every(([k, v]) => r[k] === v) ? price({ ...r, ...payload }) : r);
        return resolve({ error: null });
      } };
    return q;
  } };
  const jsx = (type, props, key) => typeof type === "function" ? type(props) : ({ type, props: props ?? {}, key });
  const icons = Object.fromEntries(["Wallet", "Search", "Download", "Plus", "Pencil", "CopyPlus", "Trash2", "Check", "X"].map(k => [k, "icon"]));
  const { CompanyPricingTab } = loadTsModule("src/components/CompanyPricingTab.tsx", {
    react, "react/jsx-runtime": { jsx, jsxs: jsx }, "@/integrations/supabase/client": { supabase },
    "@/lib/db": { useDropdownOptions: key => options[key] ?? [], useLive: () => ({ rows: [{ id: "c1", company_name: "الأولى" }, { id: "c2", company_name: "الثانية" }] }) },
    "@/components/inputs/NumberInput": { NumberInput: "number-input" }, "@/components/inputs/SearchableSelect": { SearchableSelect: "searchable-select" },
    sonner: { toast: { error: value => messages.push(value), success: value => messages.push(value) } },
    "@/lib/confirm": { confirmDialog: async message => { confirmations.push(message); return confirm; } },
    "@/hooks/usePerm": { checkPerm: (_p, a, key) => a || key === "service_price_search" },
    "@/hooks/useAuth": { useAuth: () => ({ permissions: {}, isAdmin: admin }) },
    "@/lib/pricingMatch": { PRICING_CURRENCIES: ["EGP", "USD", "LYD"], currencyShortLabel: code => code === "USD" ? "$" : code === "LYD" ? "د.ل" : "ج.م" },
    "@/components/PriceLookup": { PriceLookup: "price-lookup" }, "lucide-react": icons,
    "@/hooks/usePersistentState": persistent,
  });
  function render() { cursor = 0; dirty = false; tree = CompanyPricingTab({ companyId }); while (effects.length) effects.shift()(); }
  async function settle() { for (let i = 0; i < 8; i++) { await flush(); if (dirty) render(); } }
  function nodes(node = tree) { if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== "object") return []; return [node, ...nodes(node.props.children ?? null)]; }
  const find = (type, label) => nodes().find(n => n.type === type && (label === undefined || n.props["aria-label"] === label));
  const newRow = () => find("tr", "إضافة سعر الخدمة");
  const add = () => nodes().find(n => n.type === "button" && n.props.title === "إضافة سعر جديد");
  const action = async node => { assert.ok(node); node.props.onClick(); await settle(); };
  const change = async (label, value) => { const field = nodes().find(n => n.props.ariaLabel === label || n.props["aria-label"] === label); assert.ok(field); field.props.onChange(field.type === "select" ? { target: { value } } : value); await settle(); };
  render();
  return { settle, nodes, find, newRow, add, action, change, calls, messages, confirmations, storage,
    fail(value = true) { failure = value; }, allowDuplicate(value = true) { confirm = value; },
    pause() { hold = deferred(); return hold; },
    async permission(value) { admin = value; render(); await settle(); },
    async company(value) { cells.forEach(c => c?.cleanup?.()); cells = []; effects = []; companyId = value; render(); await settle(); },
  };
}

test("Add creates one editable row inside tbody, with all existing dropdown options and no modal", async () => {
  const h = setup(); await h.settle(); await h.action(h.add());
  assert.ok(h.newRow()); assert.equal(h.find("tbody").props.children[0], h.newRow());
  assert.equal(h.find("fieldset"), undefined);
  const selects = h.nodes().filter(n => n.type === "searchable-select");
  assert.equal(selects.length, 7); assert.deepEqual(selects[0].props.options, options.service_type);
  assert.equal(h.add().props.disabled, true); assert.deepEqual(h.calls, []);
});

test("an empty pricing file shows the new row instead of the empty-state message", async () => {
  const h = setup([]); await h.settle(); await h.action(h.add());
  assert.ok(h.newRow()); assert.equal(h.find("tbody").props.children[1], null);
});

test("a new row stays visible under a filter with no matching results", async () => {
  const h = setup(); await h.settle();
  await h.action(h.nodes().find(n => n.type === "button" && n.props.title === "بحث داخل ملف التسعير"));
  const lookup = h.find("price-lookup"); lookup.props.onFilteredChange([]); lookup.props.onActiveChange(true); await h.settle();
  await h.action(h.add()); assert.ok(h.newRow()); assert.equal(h.find("tbody").props.children[1], null);
});

test("new inline save uses the existing insert and omits the generated agent price", async () => {
  const h = setup(); await h.settle(); await h.action(h.add());
  await h.change("سعر الشركة", 200); await h.change("نوع العمولة", "percentage"); await h.change("قيمة الربح", 10); await h.change("العملة", "USD");
  assert.deepEqual(h.find("output").props.children, ["220.00", " ", "$"]);
  await h.action(h.find("button", "حفظ السعر الجديد"));
  assert.equal(h.newRow(), undefined); assert.equal(h.calls.length, 1);
  const call = h.calls[0]; assert.equal(call.method, "insert"); assert.equal(call.table, "company_pricing_rules");
  assert.equal(call.payload.company_id, "c1"); assert.equal(call.payload.company_price, 200); assert.equal(call.payload.currency, "USD");
  assert.equal(call.payload.agent_price, undefined); assert.equal(call.payload.id, undefined);
  await h.action(h.add()); assert.equal(h.find("number-input").props.value, 0);
});

test("cancel performs no insert and keeps the existing resumable draft behavior", async () => {
  const h = setup(); await h.settle(); await h.action(h.add()); await h.change("سعر الشركة", 325);
  await h.action(h.find("button", "إلغاء إضافة السعر")); assert.equal(h.newRow(), undefined); assert.deepEqual(h.calls, []);
  await h.action(h.add()); assert.equal(h.find("number-input").props.value, 325);
});

test("failure retains the inline draft for a successful retry", async () => {
  const h = setup(); await h.settle(); await h.action(h.add()); await h.change("سعر الشركة", 450); h.fail();
  await h.action(h.find("button", "حفظ السعر الجديد")); assert.ok(h.newRow()); assert.equal(h.find("number-input").props.value, 450);
  assert.ok(h.messages.includes("save failed")); h.fail(false);
  await h.action(h.find("button", "حفظ السعر الجديد")); assert.equal(h.newRow(), undefined); assert.equal(h.calls.length, 2);
});

test("required factors prevent an invalid insert", async () => {
  const h = setup(); await h.settle(); await h.action(h.add());
  h.find("searchable-select").props.onChange(""); await h.settle();
  await h.action(h.find("button", "حفظ السعر الجديد")); assert.deepEqual(h.calls, []); assert.ok(h.messages.includes("اختر الخدمة"));
});

test("duplicate factors still require confirmation before any insert", async () => {
  const h = setup(); await h.settle(); await h.action(h.add());
  h.nodes().filter(n => n.type === "searchable-select")[5].props.onChange("بالغ"); await h.settle();
  await h.action(h.find("button", "حفظ السعر الجديد"));
  assert.equal(h.confirmations.length, 1); assert.deepEqual(h.calls, []); assert.ok(h.newRow());
  h.allowDuplicate(); await h.action(h.find("button", "حفظ السعر الجديد")); assert.equal(h.calls.length, 1);
});

test("pending save disables fields/cancel/add and repeated clicks insert only once", async () => {
  const h = setup(); await h.settle(); await h.action(h.add()); const wait = h.pause();
  const save = h.find("button", "حفظ السعر الجديد"); save.props.onClick(); save.props.onClick(); await h.settle();
  assert.equal(h.find("button", "إلغاء إضافة السعر").props.disabled, true);
  assert.ok(h.nodes().filter(n => n.type === "searchable-select").every(n => n.props.disabled));
  assert.equal(h.add().props.disabled, true); assert.equal(h.calls.length, 1);
  wait.resolve(); await h.settle(); assert.equal(h.newRow(), undefined);
});

test("search-only permission cannot add or save a new inline draft", async () => {
  const h = setup(); await h.settle(); await h.action(h.add()); await h.permission(false);
  assert.equal(h.add(), undefined); await h.action(h.find("button", "حفظ السعر الجديد"));
  assert.deepEqual(h.calls, []); assert.ok(h.messages.includes("لا تملك صلاحية الحفظ"));
});

test("switching company isolates the new draft and sends the correct company id", async () => {
  const h = setup(); await h.settle(); await h.action(h.add()); await h.change("سعر الشركة", 999);
  await h.company("c2"); assert.equal(h.newRow(), undefined); await h.action(h.add());
  assert.equal(h.find("number-input").props.value, 0); await h.action(h.find("button", "حفظ السعر الجديد"));
  assert.equal(h.calls[0].payload.company_id, "c2");
});

test("editing an existing row still uses update for its original id", async () => {
  const h = setup(); await h.settle(); await h.action(h.find("button", "تعديل"));
  assert.ok(h.find("tr", "تعديل سعر الخدمة")); await h.change("سعر الشركة", 275);
  await h.action(h.find("button", "حفظ تعديل السعر"));
  assert.equal(h.calls[0].method, "update"); assert.deepEqual(h.calls[0].filters, [["id", "r1"]]);
});
