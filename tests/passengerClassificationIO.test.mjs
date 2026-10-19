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
  assert.ok(sheet.getCell("D2").value.formula.includes('<12,"اسم ""child_under_12"""'));
  assert.ok(sheet.conditionalFormattings[0].rules[0].formulae[0].includes('اسم ""child_under_12""'));
  assert.ok(!sheet.getCell("D2").value.formula.includes("طفل تحت"));
  const next = structuredClone(context); delete next.mapping.infant;
  assert.ok(module.passengerTypeFormula(2, next).includes('<2,""'));
  const unlinked = structuredClone(context); delete unlinked.mapping.child_under_12;
  assert.ok(module.passengerTypeFormula(2, unlinked).includes('<12,""'));
});

// Evaluate the small Excel formula vocabulary emitted by this template; the
// labels, comparisons and nesting come directly from the generated formula.
function evaluateTemplateFormula(formula, dob, reference, nationalId) {
  const tokens = formula.match(/"(?:[^"]|"")*"|[A-Z][A-Z0-9]*|\d+|[(),<=>]/g);
  assert.equal(tokens.join(""), formula);
  const allowed = new Set(["IFERROR", "IF", "DATEDIF", "TODAY", "MOD", "VALUE", "MID", "C2", "M2", "B2"]);
  const expression = tokens.map(token => {
    if (token.startsWith('"')) return JSON.stringify(token.slice(1, -1).replaceAll('""', '"'));
    if (/^[A-Z]/.test(token)) assert.ok(allowed.has(token), token);
    return token === "=" ? "===" : token;
  }).join("");
  const datedif = (birth, departure) => {
    const b = new Date(birth), d = new Date(departure);
    return d.getUTCFullYear() - b.getUTCFullYear() - (d.getUTCMonth() < b.getUTCMonth() || (d.getUTCMonth() === b.getUTCMonth() && d.getUTCDate() < b.getUTCDate()) ? 1 : 0);
  };
  return new Function(...allowed, `return ${expression};`)(
    value => value, (condition, yes, no) => condition ? yes : no, datedif, () => new Date("2026-10-19"),
    (a, b) => a % b, Number, (text, start, length) => text.slice(start - 1, start - 1 + length), new Date(dob), reference ? new Date(reference) : "", nationalId,
  );
}
test("generated Excel formula agrees with the canonical classifier at 2/8/12/18 birthdays, for both sexes", () => {
  const module = loadTsModule("src/lib/dataImport/templates.ts", { xlsx: {}, "../passengerClassification.ts": core });
  for (const age of [2, 8, 12, 18]) for (const female of [false, true]) for (const date of ["2026-10-18", "2026-10-19", "2026-10-20", ""]) {
    const dob = `${2026 - age}-10-19`, national_id = "3" + dob.slice(2).replaceAll("-", "") + "01000" + (female ? "2" : "1") + "0";
    const value = evaluateTemplateFormula(module.passengerTypeFormula(2, context), dob, date, national_id);
    const expected = core.resolvePassengerType({ national_id, travel_date: date || "2026-10-19" }, context).value;
    assert.equal(value, expected, `${age}/${female}/${date}`);
  }
  const old = structuredClone(context); delete old.mapping.child_under_12;
  assert.equal(evaluateTemplateFormula(module.passengerTypeFormula(2, old), "2016-01-01", "2026-10-19", "31601010100010"), "");
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

for (const [category, national_id] of [["female", "29001010100020"], ["child_under_12", "31601010100010"], ["young", "31401010100010"]]) test(`the ${category} exact label selects the existing company price rule without a parallel pricing path`, async () => {
  const value = core.resolvePassengerType({ national_id, travel_date: "2026-10-19" }, context).value;
  const rule = { id: "mapped-price", company_id: "company", service_type: "خدمة", agent_tier: "A", passenger_type: value, company_price: 100, agent_price: 125, currency: "USD" };
  const pricing = loadTsModule("src/lib/pricingMatch.ts", {
    "@/integrations/supabase/client": { supabase: { from(table) {
      assert.equal(table, "company_pricing_rules");
      const q = { select() { return q; }, eq() { return q; }, then(resolve) { return Promise.resolve(resolve({ data: [{ ...rule, id: "generic", passenger_type: null, agent_price: 90 }, rule], error: null })); } };
      return q;
    } } },
  });
  const resolved = await pricing.resolveAgentPrice({ company_id: "company", service_type: "خدمة", agent_tier: "A", passenger_type: value });
  assert.equal(value, options.find(o => o.id === category).value);
  assert.equal(resolved.rule.id, "mapped-price"); assert.equal(resolved.agentPrice, 125);
  assert.equal(resolved.rule.company_price, 100); assert.equal(resolved.rule.currency, "USD");
});

test("actual passport OCR resolves an under-12 child through the shared mapping instead of keeping the provider under-18 label", async () => {
  const raw = { full_name_ar: "طفل", national_id: "31601010100010", date_of_birth: "2016-01-01", sex: "M", passenger_type: "طفل تحت18", passport_number: "P12", needs_review: false, warnings: [] };
  const scanner = loadTsModule("src/components/PassportScanner.tsx", {
    react: {}, "react/jsx-runtime": {}, "lucide-react": {}, sonner: {},
    "@/integrations/supabase/client": { supabase: { functions: { invoke: async () => ({ data: { ok: true, data: raw }, error: null }) } } },
    "@/lib/passportPreviousExecutionWarning": {}, "@/lib/passengerClassification": core, "@/hooks/usePassengerClassification": {},
  });
  const file = new File(["jpeg"], "child.jpg", { type: "image/jpeg" });
  assert.equal((await scanner.scanPassportFile(file, context)).passenger_type, options.find(o => o.id === "child_under_12").value);
  const old = structuredClone(context); delete old.mapping.child_under_12;
  const unresolved = await scanner.scanPassportFile(file, old);
  assert.equal(unresolved.passenger_type, null); assert.equal(unresolved.needs_review, true);
  assert.match(unresolved.warnings.join(" "), /من 8 إلى أقل من 12/);
  assert.equal(raw.passenger_type, "طفل تحت18");
});
