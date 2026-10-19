import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { loadTsModule } from "./helpers/loadTsModule.mjs";

const identity = loadTsModule("src/lib/executionPassengerIdentity.ts");
const core = loadTsModule("src/lib/passengerClassification.ts", { "./executionPassengerIdentity.ts": identity });
const options = core.PASSENGER_CATEGORIES.map(c => ({ id: c.key, category: "passenger_type", value: `اسم "${c.key}"`, is_active: true }));
const context = { options, configured: true, mapping: Object.fromEntries(options.map(o => [o.id, o.id])) };

function loader({ rows = options, failure = false, value = { v: { version: 1, mapping: context.mapping } } } = {}) {
  const calls = [], hooks = [];
  const supabase = { from(table) {
    const filters = []; let bounds;
    const q = {
      select(columns) { calls.push({ table, columns }); return q; }, eq(key, v) { filters.push([key, v]); return q; }, order() { return q; }, range(a, b) { bounds = [a, b]; return q; },
      maybeSingle() { return q; },
      then(resolve) {
        if (failure) return Promise.resolve(resolve({ data: null, error: new Error("read failed") }));
        const data = table === "app_settings" ? value === null ? null : { key: core.PASSENGER_MAPPING_KEY, value }
          : rows.filter(r => filters.every(([key, v]) => r[key] === v)).slice(bounds[0], bounds[1] + 1);
        return Promise.resolve(resolve({ data, error: null }));
      },
    }; return q;
  }, auth: { getSession: async () => ({ data: { session: { user: { id: "user-1" } } } }) } };
  let userId = "user-1";
  const module = loadTsModule("src/hooks/usePassengerClassification.ts", {
    "@tanstack/react-query": { useQuery: config => { hooks.push(config); return {}; }, useQueryClient: () => ({ fetchQuery: async config => { hooks.push(config); return context; } }) },
    "./useAuth": { useAuth: () => ({ user: { id: userId }, profileLoaded: true }) },
    "@/integrations/supabase/client": { supabase }, "@/lib/passengerClassification": core,
  });
  return { ...module, calls, hooks, user: id => { userId = id; }, session: id => { supabase.auth.getSession = async () => ({ data: { session: id ? { user: { id } } : null } }); } };
}
test("configuration reads only the mapping key and all passenger option pages, including disabled IDs", async () => {
  const rows = Array.from({ length: 1205 }, (_, i) => ({ id: "option" + i, category: "passenger_type", value: String(i), is_active: i % 2 === 0 }));
  const h = loader({ rows }); const result = await h.loadPassengerContext();
  assert.equal(result.options.length, 1205); assert.equal(result.options[1204].id, "option1204");
  assert.equal(h.calls.filter(c => c.table === "system_dropdown_options").length, 2);
  assert.deepEqual(result.mapping, context.mapping);
  assert.ok(h.calls.every(c => !c.columns.includes("*")));
});
test("transport errors do not become fallback names or an apparently valid mapping", async () => {
  await assert.rejects(loader({ failure: true }).loadPassengerContext(), /read failed/);
  const result = await loader({ value: null }).loadPassengerContext();
  assert.equal(result.configured, false); assert.deepEqual(result.mapping, {});
});
test("query snapshots are scoped by user, have no polling, and reject late responses after session changes", async () => {
  const h = loader(); const first = h.usePassengerClassification();
  assert.equal(h.hooks[0].staleTime, 30_000); assert.equal(h.hooks[0].refetchInterval, undefined);
  assert.equal(h.hooks[0].queryKey.at(-1), "user-1");
  await first.getCurrent(); h.session(null); await assert.rejects(first.getCurrent(), /تغيرت جلسة/);
  h.user("user-2"); h.usePassengerClassification(); assert.equal(h.hooks.at(-1).queryKey.at(-1), "user-2");
});
test("real Excel template uses active exact labels and the shared mapping, with travel-date formulas and escaped names", async () => {
  let finish;
  const downloaded = new Promise(resolve => { finish = resolve; });
  const module = loadTsModule("src/lib/dataImport/templates.ts", {
    xlsx: {}, exceljs: ExcelJS, "../passengerClassification.ts": core,
    "./masterOpeningImport.ts": { MASTER_IMPORTS: {} }, "./masterTemplates.ts": {},
  }, {
    URL: { createObjectURL(blob) { finish(blob); return "blob:test"; }, revokeObjectURL() {} },
    document: { createElement() { return { click() {}, remove() {} }; }, body: { appendChild() {} } },
    window: { alert(message) { throw new Error(message); } }, setTimeout() {},
  });
  const active = { ...context, options: [...options, { id: "old", category: "passenger_type", value: "معطل", is_active: false }] };
  const spec = { id: "executions", fields: ["اسم", "رقم قومي", "ميلاد", "نوع"].map(label => ({ label })) };
  module.downloadTemplate(spec, active);
  const blob = await downloaded;
  const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(await blob.arrayBuffer());
  const sheet = workbook.getWorksheet("التنفيذات"); const list = workbook.getWorksheet("قائمة الأنواع");
  assert.deepEqual(list.getColumn(1).values.slice(1), options.map(o => o.value));
  assert.equal(list.state, "veryHidden");
  assert.deepEqual(sheet.getCell("D2").dataValidation.formulae, ["PassengerTypes"]);
  assert.ok(sheet.getCell("D2").value.formula.includes('IF(M2="",TODAY(),M2)'));
  assert.ok(sheet.getCell("D2").value.formula.includes('اسم ""infant""'));
  assert.ok(!sheet.getCell("D2").value.formula.includes("طفل تحت"));
  const next = structuredClone(context); delete next.mapping.infant;
  assert.ok(module.passengerTypeFormula(2, next).includes('<2,""'));
});

test("actual OCR client replaces the provider label with the shared mapping and warns on unlinked categories", async () => {
  const raw = { full_name_ar: "مسافر", full_name_en: null, national_id: "29001010100010", date_of_birth: "1990-01-01", place_of_birth: "القاهرة", sex: "M", passenger_type: "ذكر بالغ", passport_number: "P123", expiry_date: "2030-01-01", mrz_verified: true, needs_review: false, warnings: [] };
  const scanner = loadTsModule("src/components/PassportScanner.tsx", {
    react: {}, "react/jsx-runtime": {}, "lucide-react": {}, sonner: {},
    "@/integrations/supabase/client": { supabase: { functions: { invoke: async () => ({ data: { ok: true, data: raw }, error: null }) } } },
    "@/lib/passportPreviousExecutionWarning": {}, "@/lib/passengerClassification": core, "@/hooks/usePassengerClassification": {},
  });
  const file = new File(["jpeg fixture"], "passport.jpg", { type: "image/jpeg" });
  const resolved = await scanner.scanPassportFile(file, context);
  assert.equal(resolved.passenger_type, options.find(o => o.id === "male").value);
  assert.equal(resolved.passenger_type_auto, true);
  const missing = structuredClone(context); delete missing.mapping.male;
  const unresolved = await scanner.scanPassportFile(file, missing);
  assert.equal(unresolved.passenger_type, null); assert.equal(unresolved.needs_review, true);
  assert.ok(unresolved.warnings.some(w => w.startsWith("نوع المسافر: ")));
  assert.equal(raw.passenger_type, "ذكر بالغ");
});

test("the mapped exact label selects the existing company price rule without a parallel pricing path", async () => {
  const value = core.resolvePassengerType({ national_id: "29001010100020", travel_date: "2026-10-19" }, context).value;
  const rule = { id: "mapped-price", company_id: "company", service_type: "خدمة", agent_tier: "A", passenger_type: value, company_price: 100, agent_price: 125, currency: "USD" };
  const pricing = loadTsModule("src/lib/pricingMatch.ts", {
    "@/integrations/supabase/client": { supabase: { from(table) {
      assert.equal(table, "company_pricing_rules");
      const q = { select() { return q; }, eq() { return q; }, then(resolve) { return Promise.resolve(resolve({ data: [{ ...rule, id: "generic", passenger_type: null, agent_price: 90 }, rule], error: null })); } };
      return q;
    } } },
  });
  const resolved = await pricing.resolveAgentPrice({ company_id: "company", service_type: "خدمة", agent_tier: "A", passenger_type: value });
  assert.equal(value, options.find(o => o.id === "female").value);
  assert.equal(resolved.rule.id, "mapped-price"); assert.equal(resolved.agentPrice, 125);
  assert.equal(resolved.rule.company_price, 100); assert.equal(resolved.rule.currency, "USD");
});
