import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import { readFileSync } from "node:fs";
import { loadTsModule, flush } from "./helpers/loadTsModule.mjs";

const identity = loadTsModule("src/lib/executionPassengerIdentity.ts");
const core = loadTsModule("src/lib/passengerClassification.ts", { "./executionPassengerIdentity.ts": identity });
const context = () => ({ configured: true, options: core.PASSENGER_CATEGORIES.map(c => ({ id: c.key, category: "passenger_type", value: "معتمد " + c.key, is_active: true })), mapping: Object.fromEntries(core.PASSENGER_CATEGORIES.map(c => [c.key, c.key])) });

function setup(kind, editing, pricingOptions = {}) {
  let cells = [], cursor = 0, effects = [], dirty = false, tree, config = context(), allowed = true, failed = false;
  const calls = [], messages = [], storage = new Map(), priceCalls = [];
  for (const [key, value] of Object.entries(pricingOptions.storage || {})) storage.set(key, JSON.stringify(value));
  const changed = (a, b) => !a || b.some((v, i) => !Object.is(v, a[i]));
  const react = {
    useState(initial) { const i = cursor++; cells[i] ??= { value: typeof initial === "function" ? initial() : initial }; return [cells[i].value, v => { const next = typeof v === "function" ? v(cells[i].value) : v; if (!Object.is(next, cells[i].value)) { cells[i].value = next; dirty = true; } }]; },
    useRef(value) { return cells[cursor++] ??= { current: value }; },
    useMemo(fn, deps) { const i = cursor++; if (!cells[i] || changed(cells[i].deps, deps)) cells[i] = { deps, value: fn() }; return cells[i].value; },
    useCallback(fn, deps) { return react.useMemo(fn ? () => fn : fn, deps); },
    useEffect(fn, deps) { const i = cursor++; if (!cells[i] || changed(cells[i].deps, deps)) effects.push(() => { cells[i]?.cleanup?.(); cells[i] = { deps, cleanup: fn() }; }); },
  };
  const jsx = (type, props, key) => typeof type === "function" && type.name !== "Field" ? type(props) : ({ type: typeof type === "function" ? "field" : type, props: props || {}, key });
  const window = { sessionStorage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) } };
  const persistent = loadTsModule("src/hooks/usePersistentState.ts", { react }, { window });
  const supabase = { from(table) {
    let payload, method = "select";
    const q = { select() { return q; }, or() { return q; }, eq() { return q; },
      upsert(value) { method = "upsert"; payload = value; return q; },
      async then(resolve) {
        if (method === "select") return resolve({ data: [], error: null });
        calls.push({ table, method, payload });
        if (failed) return resolve({ error: { message: "فشل الحفظ التجريبي" } });
        config = { ...config, configured: true, mapping: payload.value.v.mapping };
        return resolve({ error: null });
      },
    }; return q;
  } };
  const deps = {
    react, "react/jsx-runtime": { jsx, jsxs: jsx }, "@/lib/passengerClassification": core,
    "@/lib/executionPassengerIdentity": identity, "@/hooks/usePersistentState": persistent,
    "@/hooks/usePassengerClassification": { PASSENGER_QUERY_KEY: ["passenger-classification"], usePassengerClassification: () => ({ data: config, isPending: false, isError: false, getCurrent: async () => config }) },
    "@/hooks/useAuth": { useAuth: () => ({ permissions: { settings: { company_manage: allowed } }, isSuperAdmin: false, profileLoaded: true, roles: [] }) },
    "@/hooks/usePerm": { checkSettingsPerm: (p, owner, key) => owner || p.settings[key] },
    "@tanstack/react-query": { useQueryClient: () => ({ invalidateQueries: async () => { dirty = true; } }) },
    "@tanstack/react-router": { createFileRoute: () => options => ({ options }) },
    "@/integrations/supabase/client": { supabase },
    sonner: { toast: { error: m => messages.push(m), success: m => messages.push(m) } },
    "@/lib/db": { withSelected: (options, value) => [...new Set([...options, ...(value ? [value] : [])])] },
    "@/components/inputs/SearchableSelect": { SearchableSelect: "searchable" },
    "@/components/inputs/NumberInput": { NumberInput: "number" },
    "@/components/inputs/DateInput": { DateInput: "date" },
    "@/components/Modal": { Modal: "modal" },
    "@/lib/activeFilter": { activeOptions: rows => rows },
    "@/lib/permissionKeys": { canViewProfitPermission: () => false },
    "@/lib/executionProfit": { loadCurrencyBuyRows: async () => [], aggregateExecutionByCurrency: () => ({ salesByCur: {}, costByCur: {}, profitByCur: {} }), computeExecutionProfitEGP: () => ({ status: "ready", profitEGP: 0, missingCurrencies: [] }) },
    "@/lib/pricingMatch": { currencyShortLabel: () => "ج.م", resolveAgentPrice: async ctx => { priceCalls.push(ctx); return pricingOptions.resolve ? pricingOptions.resolve(ctx) : { rule: null, agentPrice: null }; } },
    "@/lib/executionCompanyPricing": { buildExecutionCompanyPricingContext: () => ({ context: null }), buildExecutionCompanyPurchasePricingContext: () => ({ context: null }) },
    "@/lib/executionPosting": { postExecutionFinancials: async args => { calls.push({ method: "postExecutionFinancials", args }); return { executionId: "saved" }; } },
    "@/lib/dateFormat": loadTsModule("src/lib/dateFormat.ts"),
  };
  deps["@/hooks/useExecutionServicePricing"] = loadTsModule("src/hooks/useExecutionServicePricing.ts", { react, "@/lib/pricingMatch": deps["@/lib/pricingMatch"] });
  const path = kind === "settings" ? "src/components/PassengerClassificationSettings.tsx" : "src/features/executions/LegacyExecutionsRoute.tsx";
  let source = readFileSync(new URL("../" + path, import.meta.url), "utf8");
  const sf = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  for (const n of sf.statements) if (ts.isImportDeclaration(n) && !(n.moduleSpecifier.text in deps)) {
    const exports = {};
    for (const item of n.importClause?.namedBindings?.elements || []) exports[item.propertyName?.text || item.name.text] = () => null;
    deps[n.moduleSpecifier.text] = exports;
  }
  if (kind !== "settings") source += "\nexport { ExecutionForm };";
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  const module = { exports: {} };
  new Function("require", "module", "exports", "window", compiled)(name => deps[name] ?? {}, module, module.exports, window);
  const component = module.exports[kind === "settings" ? "PassengerClassificationSettings" : "ExecutionForm"];
  const props = { editing, agents: pricingOptions.agents || [], companies: [], activeCompanies: [], merchants: [], approvalStatuses: [], operationStatuses: [], departures: [], destinations: [], airlines: [], serviceKinds: [], passengerTypes: config.options.map(o => o.value), onDone: () => calls.push({ method: "done" }) };
  function render() { cursor = 0; dirty = false; tree = component(props); while (effects.length) effects.shift()(); }
  async function settle() { for (let i = 0; i < 12; i++) { await flush(); if (dirty) render(); } }
  function nodes(node = null) { if (arguments.length === 0) node = tree; if (Array.isArray(node)) return node.flatMap(nodes); if (!node || typeof node !== "object") return []; return [node, ...nodes(node.props.children ?? null)]; }
  const field = label => nodes().find(n => n.type === "field" && n.props.label === label);
  const control = label => nodes(field(label)).find(n => ["input", "searchable", "date"].includes(n.type));
  const change = async (label, value) => { const c = control(label); assert.ok(c, label); c.props.onChange(c.type === "input" ? { target: { value } } : value); await settle(); };
  const save = async () => { const b = nodes().find(n => n.type === "button" && (n.props["data-confirm-save"] || n.props.children === "حفظ ربط نوع المسافر")); assert.ok(b); await b.props.onClick(); await settle(); };
  render();
  return { settle, nodes, control, change, save, calls, messages, priceCalls, storage, get config() { return config; }, set config(value) { config = value; dirty = true; }, deny() { allowed = false; dirty = true; }, fail() { failed = true; }, refresh() { dirty = true; } };
}

test("settings saves IDs under the existing app_settings key, not labels or financial rows", async () => {
  const h = setup("settings"); await h.settle();
  const select = h.nodes().find(n => n.type === "select" && n.props["aria-label"] === core.PASSENGER_CATEGORIES[0].label);
  select.props.onChange({ target: { value: "female" } }); await h.settle(); await h.save();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].table, "app_settings");
  assert.equal(h.calls[0].payload.key, core.PASSENGER_MAPPING_KEY); assert.equal(h.calls[0].payload.value.v.mapping.infant, "female");
});
test("settings refuses an option disabled after editing and preserves draft on failed save", async () => {
  const h = setup("settings"); await h.settle(); h.config.options[0].is_active = false;
  await h.save(); assert.equal(h.calls.length, 0); assert.ok(h.messages.some(m => m.includes("محذوف أو معطل")));
  const other = setup("settings"); await other.settle(); other.fail(); await other.save();
  assert.ok(other.messages.includes("فشل الحفظ التجريبي"));
});
test("settings permission loss blocks both controls and the save handler", async () => {
  const h = setup("settings"); await h.settle(); h.deny(); await h.settle();
  assert.ok(h.nodes().filter(n => n.type === "select").every(n => n.props.disabled)); await h.save(); assert.equal(h.calls.length, 0);
});
test("settings adds a sixth selector, preserving all five saved IDs until explicitly linking and saving the new category", async () => {
  const h = setup("settings"); const old = structuredClone(h.config); delete old.mapping.child_under_12;
  h.config = old; await h.settle();
  assert.equal(h.nodes().filter(n => n.type === "select").length, 6);
  const label = core.PASSENGER_CATEGORIES.find(c => c.key === "child_under_12").label;
  const selector = h.nodes().find(n => n.type === "select" && n.props["aria-label"] === label);
  assert.equal(selector.props.value, ""); assert.equal(h.calls.length, 0);
  selector.props.onChange({ target: { value: "child_under_12" } }); await h.settle(); await h.save();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].table, "app_settings");
  assert.equal(h.calls[0].payload.value.v.version, 1);
  assert.deepEqual(h.calls[0].payload.value.v.mapping, { ...old.mapping, child_under_12: "child_under_12" });
});
test("actual execution form crosses 8 and 12 using the same saved labels and financial gateway", async () => {
  const h = setup("execution"); await h.settle();
  await h.change("الاسم", "مسافر اختبار"); await h.change("تاريخ المغادرة", "2026-10-18");
  await h.change("الرقم القومي", "31810190100010"); assert.equal(h.control("نوع المسافر").props.value, "معتمد child");
  await h.change("تاريخ المغادرة", "2026-10-19"); assert.equal(h.control("نوع المسافر").props.value, "معتمد child_under_12");
  await h.change("الرقم القومي", "31410190100010"); await h.change("تاريخ المغادرة", "2026-10-18");
  assert.equal(h.control("نوع المسافر").props.value, "معتمد child_under_12");
  await h.change("تاريخ المغادرة", "2026-10-19"); assert.equal(h.control("نوع المسافر").props.value, "معتمد young");
  await h.change("تاريخ المغادرة", "2026-10-18"); await h.save();
  const write = h.calls.find(c => c.method === "postExecutionFinancials"); assert.ok(write);
  assert.equal(write.args.executionPatch.passenger_type, "معتمد child_under_12");
  assert.equal("passenger_type_auto" in write.args.executionPatch, false);
});
test("unchanged historical under-18 label stays intact for an under-12 execution", async () => {
  const h = setup("execution", { id: "history-under12", passenger_name: "مسافر قديم", national_id: "31601010100010", travel_date: "2026-10-19", passenger_type: "طفل تحت18" });
  await h.settle(); assert.equal(h.control("نوع المسافر").props.value, "طفل تحت18"); await h.save();
  assert.equal(h.calls.find(c => c.method === "postExecutionFinancials")?.args.executionPatch.passenger_type, "طفل تحت18");
});
test("actual execution form classifies ID using departure date and posts the selected exact label through the existing gateway", async () => {
  const h = setup("execution"); await h.settle();
  await h.change("الاسم", "مسافر اختبار"); await h.change("تاريخ المغادرة", "2026-10-19"); await h.change("الرقم القومي", "30810200100010");
  assert.equal(h.control("نوع المسافر").props.value, "معتمد young");
  await h.change("تاريخ المغادرة", "2026-10-20"); assert.equal(h.control("نوع المسافر").props.value, "معتمد male");
  await h.change("نوع المسافر", "معتمد female"); await h.save();
  const write = h.calls.find(c => c.method === "postExecutionFinancials"); assert.ok(write);
  assert.equal(write.args.executionPatch.passenger_type, "معتمد female");
  assert.equal("passenger_type_auto" in write.args.executionPatch, false);
});
test("actual execution form clears unresolved automatic category and allows explicit manual selection", async () => {
  const h = setup("execution"); await h.settle(); delete h.config.mapping.young;
  await h.change("الاسم", "مسافر اختبار"); await h.change("تاريخ المغادرة", "2026-10-19"); await h.change("الرقم القومي", "30810200100010");
  assert.equal(h.control("نوع المسافر").props.value, ""); await h.save(); assert.equal(h.calls.length, 0);
  await h.change("نوع المسافر", "معتمد young"); await h.save(); assert.ok(h.calls.some(c => c.method === "postExecutionFinancials"));
});
test("editing a historical execution preserves its original type and never remaps it merely on open/save", async () => {
  const h = setup("execution", { id: "history", passenger_name: "مسافر قديم", national_id: "30810200100010", dob: "2008-10-20", travel_date: "2026-10-19", passenger_type: "قيمة تاريخية", services: [{ kind: "agent", service_type: "تذكرة", count: 1, agent_price: 100 }] });
  await h.settle(); assert.equal(h.control("نوع المسافر").props.value, "قيمة تاريخية");
  h.config.mapping.young = "female"; h.refresh(); await h.settle(); await h.save();
  assert.equal(h.calls.find(c => c.method === "postExecutionFinancials").args.executionPatch.passenger_type, "قيمة تاريخية");
});
test("repeated execution save clicks during async configuration validation post only once", async () => {
  const h = setup("execution"); await h.settle(); await h.change("الاسم", "مسافر");
  await h.change("نوع المسافر", "معتمد male");
  const save = h.nodes().find(n => n.type === "button" && n.props["data-confirm-save"]).props.onClick;
  await Promise.all([save(), save()]); await h.settle();
  assert.equal(h.calls.filter(c => c.method === "postExecutionFinancials").length, 1);
});
test("a mapping changed after automatic entry is checked again before posting", async () => {
  const h = setup("execution"); await h.settle(); await h.change("الاسم", "مسافر");
  await h.change("تاريخ المغادرة", "2026-10-19"); await h.change("الرقم القومي", "30810200100010");
  h.config.mapping.young = "female"; await h.save();
  assert.equal(h.calls.length, 0); assert.ok(h.messages.some(m => m.includes("تغير التصنيف")));
});
test("the old client's established DOB autofill still works while classification settings are loading", async () => {
  const h = setup("execution"); await h.settle(); h.config = undefined; await h.settle();
  await h.change("الرقم القومي", "30810200100010");
  assert.equal(h.control("تاريخ الميلاد").props.value, "2008-10-20");
  assert.equal(h.control("نوع المسافر").props.value, "");
  assert.equal(h.calls.length, 0);
});


const pricingAgents = [{ id: "a1", tier: "A", name: "وكيل" }];
const priceResult = ctx => ({ rule: { company_price: ctx.passenger_type === "معتمد child_under_12" ? 50 : 100, currency: "USD" }, agentPrice: ctx.passenger_type === "معتمد child_under_12" ? 65 : 120 });
function priceNumber(h, prefix) {
  const field = h.nodes().find(n => n.type === "field" && n.props.label.startsWith(prefix));
  return h.nodes(field).find(n => n.type === "number");
}
async function preparePricedForm(h) {
  await h.settle(); await h.change("الاسم", "مسافر اختبار");
  await h.change("الوكيل", "a1"); await h.change("نوع المسافر", "معتمد male");
  await h.change("جهة الموافقة (الشركة الصادرة)", "c1");
}

test("actual execution controls fetch both prices without a button and save through the unchanged financial gateway", async () => {
  const h = setup("execution", null, { agents: pricingAgents, resolve: priceResult }); await preparePricedForm(h);
  assert.equal(priceNumber(h, "سعر الشركة").props.value, 100);
  assert.equal(priceNumber(h, "سعر البيع للوكيل").props.value, 120);
  assert.equal(h.nodes().find(n => n.props.title === "جلب السعر من ملف تسعير الشركة"), undefined);
  assert.ok(h.priceCalls.length > 0); assert.equal(h.calls.length, 0);
  await h.save();
  const saved = h.calls.find(c => c.method === "postExecutionFinancials"); assert.ok(saved);
  assert.equal(saved.args.executionPatch.services[0].company_price, 100);
  assert.equal(saved.args.executionPatch.services[1].agent_price, 120);
  assert.ok(saved.args.executionPatch.services.every(s => s.currency === "USD"));
  assert.ok(saved.args.executionPatch.services.every(s => !Object.keys(s).some(k => /pricing|request|status/i.test(k))));
});

test("national-ID classification and travel-date changes update the actual service price automatically", async () => {
  const h = setup("execution", null, { agents: pricingAgents, resolve: priceResult }); await preparePricedForm(h);
  await h.change("تاريخ المغادرة", "2026-10-18"); await h.change("الرقم القومي", "31410190100010");
  assert.equal(h.control("نوع المسافر").props.value, "معتمد child_under_12");
  assert.equal(priceNumber(h, "سعر الشركة").props.value, 50); assert.equal(priceNumber(h, "سعر البيع للوكيل").props.value, 65);
  await h.change("تاريخ المغادرة", "2026-10-19");
  assert.equal(h.control("نوع المسافر").props.value, "معتمد young");
  assert.equal(priceNumber(h, "سعر البيع للوكيل").props.value, 120);
});

test("actual save button and handler block posting while automatic prices are pending", async () => {
  let release;
  const wait = new Promise(resolve => { release = resolve; });
  const h = setup("execution", null, { agents: pricingAgents, resolve: () => wait }); await preparePricedForm(h);
  const save = h.nodes().find(n => n.type === "button" && n.props["data-confirm-save"]);
  assert.equal(save.props.disabled, true); assert.equal(priceNumber(h, "سعر الشركة").props.disabled, true);
  await h.save(); assert.equal(h.calls.length, 0); assert.ok(h.messages.includes("انتظر اكتمال تحديث أسعار الخدمات"));
  release(priceResult({})); await h.settle();
  assert.equal(h.nodes().find(n => n.props["data-confirm-save"]).props.disabled, false);
  await h.save(); assert.equal(h.calls.filter(c => c.method === "postExecutionFinancials").length, 1);
});

test("actual historical form retains prices on open, then recomputes price and explicit total after a pricing change", async () => {
  const editing = { id: "history-prices", passenger_name: "مسافر", agent_id: "a1", approval_company_id: "c1", passenger_type: "معتمد male", services: [{ kind: "company", service_type: "تذكرة", company_id: "c1", count: 2, company_price: 7, company_value: 15, currency: "LYD" }, { kind: "agent", service_type: "تذكرة", agent_price: 9, count: 2 }] };
  const h = setup("execution", editing, { agents: pricingAgents, resolve: priceResult }); await h.settle();
  assert.equal(h.priceCalls.length, 0); assert.equal(priceNumber(h, "سعر الشركة").props.value, 7);
  await h.change("الوجهة", "طرابلس"); assert.equal(priceNumber(h, "سعر الشركة").props.value, 100);
  const totals = h.nodes().filter(n => n.type === "field" && n.props.label === "الإجمالي");
  assert.ok(h.nodes(totals[0]).find(n => n.type === "input").props.value.includes((200).toLocaleString("ar")));
  await h.save(); const saved = h.calls.find(c => c.method === "postExecutionFinancials");
  assert.equal(saved.args.executionPatch.services[0].company_value, 0);
  assert.equal(saved.args.expectedExecution.id, "history-prices");
});


test("restored historical drafts with changed pricing inputs reprice, while new draft rows do not reprice unchanged saved neighbors", async () => {
  const editing = { id: "restore-pricing", passenger_name: "مسافر", agent_id: "a1", approval_company_id: "c1", passenger_type: "معتمد male", services: [{ kind: "company", service_type: "تذكرة", company_id: "c1", count: 2, company_price: 7, company_value: 14 }] };
  const original = setup("execution", editing, { agents: pricingAgents, resolve: priceResult }); await original.settle();
  const form = JSON.parse(original.storage.get("draft:execution:restore-pricing:form"));
  const changed = setup("execution", editing, { agents: pricingAgents, resolve: priceResult, storage: {
    "draft:execution:restore-pricing:form": { ...form, destination: "طرابلس" },
    "draft:execution:restore-pricing:services": editing.services,
  } }); await changed.settle(); assert.equal(priceNumber(changed, "سعر الشركة").props.value, 100);
  const added = setup("execution", editing, { agents: pricingAgents, resolve: priceResult, storage: {
    "draft:execution:restore-pricing:form": form,
    "draft:execution:restore-pricing:services": [...editing.services, { kind: "agent", service_type: "تذكرة", count: 1, agent_price: 0 }],
  } }); await added.settle();
  assert.equal(priceNumber(added, "سعر الشركة").props.value, 7); assert.equal(priceNumber(added, "سعر البيع للوكيل").props.value, 120);
});
