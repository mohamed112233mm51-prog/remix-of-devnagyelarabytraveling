import test from "node:test";
import assert from "node:assert/strict";
import { loadTsModule, flush, deferred } from "./helpers/loadTsModule.mjs";

const options = { service_type: ["استقبال", "تذكرة"], agent_tier: ["A", "B"], departure_from: ["القاهرة"], destination: ["بنغازي"], airline: ["الأفريقية"], execution_status: ["سريع"], passenger_type: ["بالغ", "سيدات"] };
const base = { id: "r1", company_id: "c1", service_type: "استقبال", agent_tier: "A", departure_from: null, destination: null, airline: null, approval_company_id: null, status: null, passenger_type: "بالغ", company_price: 100, commission_type: "fixed", commission_value: 10, agent_price: 110, currency: "EGP" };
function setup(seed = [base], page = null) {
  let cells = [], effects = [], cursor = 0, dirty = false, tree, companyId = "c1", admin = true, failure = false, hold = null, confirm = false, beforeLayout = null;
  let rows = structuredClone(seed);
  const calls = [], reads = [], renders = [], messages = [], confirmations = [], storage = new Map();
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
  react.useLayoutEffect = react.useEffect;
  const window = { sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) } };
  const persistent = loadTsModule("src/hooks/usePersistentState.ts", { react }, { window });
  const supabase = { from(table) {
    let method = "select", payload, filters = [], orders = [], single = false;
    const q = { select() { return q; }, order(key) { orders.push(key); return q; }, single() { single = true; return q; }, eq(key, value) { filters.push([key, value]); return q; },
      insert(value) { method = "insert"; payload = value; return q; }, update(value) { method = "update"; payload = value; return q; },
      async then(resolve) {
        if (method === "select") {
          reads.push({ table, filters, orders });
          const data = rows.filter(r => filters.every(([k, v]) => r[k] === v)).sort((a, b) => {
            for (const key of orders) { const diff = String(a[key] ?? "").localeCompare(String(b[key] ?? "")); if (diff) return diff; }
            return 0;
          });
          return resolve({ data, error: null });
        }
        calls.push({ method, table, payload, filters });
        if (hold) { const wait = hold; hold = null; await wait.promise; }
        if (failure) return resolve({ error: { message: "save failed" } });
        const price = r => ({ ...r, agent_price: r.commission_type === "fixed" ? r.company_price + r.commission_value : r.company_price * (1 + r.commission_value / 100) });
        let saved;
        if (method === "insert") { saved = price({ ...payload, id: `new-${calls.length}` }); rows.push(saved); }
        else rows = rows.map(r => filters.every(([k, v]) => r[k] === v) ? (saved = price({ ...r, ...payload })) : r);
        return resolve({ data: single ? saved : [saved], error: null });
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
  function resetEditor() { cells.forEach(c => c?.cleanup?.()); cells = []; effects = []; dirty = true; }
  const selectTier = tier => { page = { tier }; resetEditor(); };
  function render() { cursor = 0; dirty = false; tree = CompanyPricingTab({ companyId, tierPages: page ? { ...page, onSelectTier: selectTier } : undefined }); renders.push({ table: !!find("table"), ids: nodes().filter(n => n.props["data-pricing-row-id"]).map(n => n.props["data-pricing-row-id"]) }); if (beforeLayout) { const callback = beforeLayout; beforeLayout = null; callback(); } while (effects.length) effects.shift()(); }
  async function settle() { for (let i = 0; i < 8; i++) { await flush(); if (dirty) render(); } }
  function nodes(node = tree) { if (Array.isArray(node)) return node.flatMap(child => nodes(child ?? null)); if (!node || typeof node !== "object") return []; return [node, ...nodes(node.props.children ?? null)]; }
  const find = (type, label) => nodes().find(n => n.type === type && (label === undefined || n.props["aria-label"] === label));
  const newRow = () => find("tr", "إضافة سعر الخدمة");
  const add = () => nodes().find(n => n.type === "button" && n.props.title === "إضافة سعر جديد");
  const action = async node => { assert.ok(node); node.props.onClick(); await settle(); };
  const change = async (label, value) => { const field = nodes().find(n => n.props.ariaLabel === label || n.props["aria-label"] === label); assert.ok(field); field.props.onChange(field.type === "select" ? { target: { value } } : value); await settle(); };
  render();
  return { settle, nodes, find, newRow, add, action, change, calls, reads, renders, messages, confirmations, storage,
    fail(value = true) { failure = value; }, allowDuplicate(value = true) { confirm = value; },
    pause() { hold = deferred(); return hold; },
    beforeNextLayout(callback) { beforeLayout = callback; },
    async permission(value) { admin = value; render(); await settle(); },
    async company(value) { cells.forEach(c => c?.cleanup?.()); cells = []; effects = []; companyId = value; render(); await settle(); },
    async tier(value) { selectTier(value); await settle(); },
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

const visibleIds = h => h.nodes().filter(n => n.props["data-pricing-row-id"]).map(n => n.props["data-pricing-row-id"]);
const orderedRows = [base, { ...base, id: "r2", passenger_type: "سيدات" }, { ...base, id: "r3", passenger_type: null }];

test("saving a middle row keeps the table mounted, its index and neighbors, without a full read", async () => {
  const h = setup(orderedRows, { tier: "A" }); await h.settle();
  const initialReads = h.reads.length, initialRender = h.renders.length;
  await h.action(h.nodes().filter(n => n.type === "button" && n.props["aria-label"] === "تعديل")[1]);
  await h.change("سعر الشركة", 250); await h.change("قيمة الربح", 35);
  const pending = h.pause(); await h.action(h.find("button", "حفظ تعديل السعر"));
  assert.ok(h.find("table")); assert.ok(h.find("tr", "تعديل سعر الخدمة"));
  pending.resolve(); await h.settle();
  assert.deepEqual(visibleIds(h), ["r1", "r2", "r3"]);
  const row = h.nodes().find(n => n.props["data-pricing-row-id"] === "r2");
  assert.equal(row.props.children[7].props.children[0], "250.00");
  assert.equal(row.props.children[11].props.children[0], "285.00");
  assert.equal(h.reads.length, initialReads);
  assert.ok(h.renders.slice(initialRender).every(r => r.table));
});

test("changing the service itself does not re-sort the edited row on save", async () => {
  const h = setup(orderedRows); await h.settle();
  await h.action(h.nodes().filter(n => n.type === "button" && n.props["aria-label"] === "تعديل")[1]);
  h.find("searchable-select").props.onChange("تذكرة"); await h.settle();
  await h.action(h.find("button", "حفظ تعديل السعر"));
  assert.deepEqual(visibleIds(h), ["r1", "r2", "r3"]);
  assert.equal(h.nodes().find(n => n.props["data-pricing-row-id"] === "r2").props.children[0].props.children, "تذكرة");
});

test("newly saved rows replace the first-row draft without moving existing rows or reloading", async () => {
  const h = setup(orderedRows); await h.settle(); const reads = h.reads.length;
  await h.action(h.add()); await h.change("سعر الشركة", 250); await h.change("قيمة الربح", 10);
  h.find("searchable-select").props.onChange("تذكرة"); await h.settle();
  await h.action(h.find("button", "حفظ السعر الجديد"));
  assert.deepEqual(visibleIds(h), ["new-1", "r1", "r2", "r3"]);
  assert.equal(h.reads.length, reads);
  const saved = h.nodes().find(n => n.props["data-pricing-row-id"] === "new-1");
  assert.equal(saved.props.children[11].props.children[0], "275.00");
});

test("filter changes after saving clear the retained row, while source updates keep its latest server values", async () => {
  const h = setup(); await h.settle();
  await h.action(h.nodes().find(n => n.type === "button" && n.props.title === "بحث داخل ملف التسعير"));
  h.find("price-lookup").props.onFilteredChange([base]); h.find("price-lookup").props.onActiveChange(true); await h.settle();
  await h.action(h.find("button", "تعديل")); await h.change("سعر الشركة", 275);
  await h.action(h.find("button", "حفظ تعديل السعر"));
  assert.equal(h.nodes().find(n => n.props["data-pricing-row-id"] === "r1").props.children[7].props.children[0], "275.00");
  h.find("price-lookup").props.onFilteredChange([]); await h.settle();
  assert.deepEqual(visibleIds(h), ["r1"]);
  h.find("price-lookup").props.onFiltersChange(); await h.settle();
  assert.deepEqual(visibleIds(h), []);
});

test("a new price remains visible in its draft position even under a nonmatching filter", async () => {
  const h = setup(); await h.settle();
  await h.action(h.nodes().find(n => n.type === "button" && n.props.title === "بحث داخل ملف التسعير"));
  h.find("price-lookup").props.onFilteredChange([]); h.find("price-lookup").props.onActiveChange(true); await h.settle();
  await h.action(h.add()); await h.action(h.find("button", "حفظ السعر الجديد"));
  assert.deepEqual(visibleIds(h), ["new-1"]);
});

test("save restores nested vertical positions and RTL horizontal scrolling before paint", async () => {
  const h = setup(orderedRows); await h.settle(); await h.action(h.find("button", "تعديل"));
  const outer = { scrollTop: 720, scrollLeft: 0, parentElement: null };
  const container = { scrollTop: 0, scrollLeft: -600, scrollWidth: 2200, parentElement: outer };
  h.nodes().find(n => n.props.ref && n.type === "div").props.ref.current = container;
  const pending = h.pause(); await h.action(h.find("button", "حفظ تعديل السعر"));
  // The user is allowed to scroll further while the save request is pending.
  outer.scrollTop = 810; container.scrollLeft = -700;
  h.beforeNextLayout(() => { outer.scrollTop = 0; container.scrollLeft = 0; });
  pending.resolve(); await h.settle();
  assert.equal(outer.scrollTop, 810); assert.equal(container.scrollLeft, -700);
  assert.equal(h.find("table").props.style.minWidth, 2200);
});

test("duplicating a row opens the copy next to its source without reloading neighbors", async () => {
  const h = setup(orderedRows); await h.settle(); const reads = h.reads.length;
  await h.action(h.nodes().filter(n => n.type === "button" && n.props["aria-label"] === "تكرار")[1]);
  assert.ok(h.find("tr", "تعديل سعر الخدمة"));
  await h.action(h.find("button", "إلغاء تعديل السعر"));
  assert.deepEqual(visibleIds(h), ["r1", "r2", "new-1", "r3"]);
  assert.equal(h.reads.length, reads);
});

const tierRows = [base, { ...base, id: "r2", agent_tier: "B", service_type: "تذكرة" }, { ...base, id: "r3", agent_tier: "قديمة", service_type: "خدمة قديمة" }];

test("tier landing includes configured empty tiers and tiers from existing prices without displaying the combined table", async () => {
  const h = setup([base, tierRows[2]], {}); await h.settle();
  for (const tier of ["A", "B", "قديمة"]) assert.ok(h.find("button", `فتح أسعار الشريحة ${tier}`));
  assert.equal(h.find("table"), undefined); assert.equal(h.add(), undefined);
  assert.deepEqual(h.calls, []);
  await h.action(h.find("button", "فتح أسعار الشريحة A"));
  assert.ok(h.find("table"));
});

test("a tier page displays and searches only its own prices, and return opens the tier landing", async () => {
  const h = setup(tierRows, { tier: "B" }); await h.settle();
  const text = h.nodes().filter(n => n.type === "td").map(n => n.props.children);
  assert.ok(text.includes("تذكرة")); assert.ok(!text.includes("استقبال")); assert.ok(!text.includes("خدمة قديمة"));
  await h.action(h.nodes().find(n => n.type === "button" && n.props.title === "بحث داخل ملف التسعير"));
  assert.deepEqual(h.find("price-lookup").props.rules.map(r => r.id), ["r2"]);
  assert.equal(h.find("price-lookup").props.agentTier, "B");
  await h.action(h.nodes().find(n => n.type === "button" && n.props.children === "العودة إلى الشرائح"));
  assert.equal(h.find("table"), undefined); assert.ok(h.find("button", "فتح أسعار الشريحة A"));
  assert.deepEqual(h.calls, []);
});

test("tier page new prices lock the selected tier and retain the existing writer and calculation", async () => {
  const h = setup(tierRows, { tier: "B" }); await h.settle(); await h.action(h.add());
  assert.equal(h.find("span", "شريحة الوكيل").props.children, "B");
  assert.equal(h.nodes().filter(n => n.type === "searchable-select").length, 6);
  await h.change("سعر الشركة", 200); await h.change("قيمة الربح", 10);
  assert.deepEqual(h.find("output").props.children, ["220.00", " ", "ج.م"]);
  await h.action(h.find("button", "حفظ السعر الجديد"));
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].table, "company_pricing_rules");
  assert.equal(h.calls[0].payload.agent_tier, "B"); assert.equal(h.calls[0].payload.company_id, "c1");
  assert.equal(h.calls[0].payload.agent_price, undefined);
});

test("tier drafts are isolated across tiers and companies and restored when returning", async () => {
  const h = setup(tierRows, { tier: "A" }); await h.settle(); await h.action(h.add()); await h.change("سعر الشركة", 999);
  await h.tier("B"); assert.equal(h.newRow(), undefined); await h.action(h.add());
  assert.equal(h.find("number-input").props.value, 0); await h.change("سعر الشركة", 222);
  await h.tier("A"); await h.action(h.add()); assert.equal(h.find("number-input").props.value, 999);
  await h.company("c2"); await h.action(h.add()); assert.equal(h.find("number-input").props.value, 0);
  assert.deepEqual(h.calls, []);
});

test("tier-specific editing updates only the original row and keeps its tier", async () => {
  const h = setup(tierRows, { tier: "B" }); await h.settle(); await h.action(h.find("button", "تعديل"));
  await h.change("سعر الشركة", 275); await h.action(h.find("button", "حفظ تعديل السعر"));
  assert.equal(h.calls[0].method, "update"); assert.deepEqual(h.calls[0].filters, [["id", "r2"]]);
  assert.equal(h.calls[0].payload.agent_tier, "B");
});

test("an empty configured tier is writable but an unknown URL tier cannot create prices", async () => {
  const h = setup([base], { tier: "B" }); await h.settle(); await h.action(h.add());
  await h.action(h.find("button", "حفظ السعر الجديد")); assert.equal(h.calls[0].payload.agent_tier, "B");
  await h.tier("missing"); assert.equal(h.add(), undefined); assert.equal(h.find("table"), undefined);
});

test("legacy tier pages remain accessible, and search-only permissions still prevent creation", async () => {
  const h = setup(tierRows, { tier: "قديمة" }); await h.settle();
  assert.ok(h.find("table")); await h.permission(false); assert.equal(h.add(), undefined);
  assert.equal(h.find("button", "تعديل"), undefined); assert.deepEqual(h.calls, []);
});
