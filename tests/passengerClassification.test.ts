import test from "node:test";
import assert from "node:assert/strict";
import { PASSENGER_CATEGORIES, classifyPassenger, mappedPassengerValue, readPassengerMapping, suggestedPassengerMapping, resolvePassengerType, canonicalPassengerValue, preparePassengerImport, passengerDraftPatch, passengerDraftError, type PassengerContext } from "../src/lib/passengerClassification.ts";
import { deriveDobIsoFromEgyptianNationalId } from "../src/lib/executionPassengerIdentity.ts";
import { withPassengerClassificationSpec } from "../src/lib/dataImport/passengerImportSpec.ts";
import { getSpec } from "../src/lib/dataImport/specs.ts";
import { validateRows } from "../src/lib/dataImport/validate.ts";

const names = ["رضع المعتمد", "صغار معتمد", "شباب معتمد", "رجال معتمد", "سيدات معتمد"];
const context: PassengerContext = {
  configured: true,
  options: PASSENGER_CATEGORIES.map((c, i) => ({ id: c.key + "-id", category: "passenger_type", value: names[i], is_active: true })),
  mapping: Object.fromEntries(PASSENGER_CATEGORIES.map(c => [c.key, c.key + "-id"])),
};
const nid = (dob: string, female = false) => (dob.startsWith("19") ? "2" : "3") + dob.slice(2).replaceAll("-", "") + "01000" + (female ? "2" : "1") + "0";
const input = (dob: string, date: string, female = false) => ({ national_id: nid(dob, female), travel_date: date });

for (const [age, before, at] of [[2, "infant", "child"], [8, "child", "young"], [18, "young", "male"]] as const) {
  test(`classification changes on birthday ${age}, never the day before`, () => {
    const dob = `${2026 - age}-10-19`;
    assert.equal(classifyPassenger(input(dob, "2026-10-18"))?.category, before);
    assert.equal(classifyPassenger(input(dob, "2026-10-19"))?.category, at);
    assert.equal(classifyPassenger(input(dob, "2026-10-20"))?.category, at);
  });
}
test("all five categories resolve to exact configured option labels", () => {
  for (const [dob, female, index] of [["2025-01-01", false, 0], ["2020-01-01", false, 1], ["2010-01-01", true, 2], ["1990-01-01", false, 3], ["1990-01-01", true, 4]] as const) {
    assert.equal(resolvePassengerType(input(dob, "2026-10-19", female), context).value, names[index]);
  }
});
test("DOB and MRZ sex use identical categories; sex is unnecessary for children", () => {
  assert.equal(classifyPassenger({ dob: "1990-01-01", sex: "F", travel_date: "2026-10-19" })?.category, "female");
  assert.equal(classifyPassenger({ dob: "2025-01-01", travel_date: "2026-10-19" })?.category, "infant");
  assert.equal(classifyPassenger({ dob: "1990-01-01", travel_date: "2026-10-19" }), null);
});
test("Arabic digits, leap-day birth, and invalid or future birthdates are handled", () => {
  const value = nid("2008-02-29").replace(/\d/g, d => "٠١٢٣٤٥٦٧٨٩"[Number(d)]);
  assert.equal(classifyPassenger({ national_id: value, travel_date: "2026-03-01" })?.category, "male");
  assert.equal(classifyPassenger({ national_id: nid("2007-02-29"), travel_date: "2026-03-01" }), null);
  assert.equal(classifyPassenger({ national_id: nid("2027-01-01"), travel_date: "2026-03-01" }), null);
  assert.equal(classifyPassenger({ national_id: "123" }), null);
});
test("mapping IDs survive label rename without mutating snapshots or pricing/history", () => {
  const next = structuredClone(context), row = { passenger_type: names[0], company_price: 700, agent_price: 900 };
  next.options[0].value = "الاسم الجديد";
  assert.equal(mappedPassengerValue(next, "infant"), "الاسم الجديد");
  assert.equal(mappedPassengerValue(context, "infant"), names[0]);
  assert.deepEqual(row, { passenger_type: names[0], company_price: 700, agent_price: 900 });
});
test("resolved and imported labels use the same whitespace normalization as dropdowns and pricing", () => {
  const next = structuredClone(context); next.options[0].value = "  اسم   معتمد  ";
  assert.equal(mappedPassengerValue(next, "infant"), "اسم معتمد");
  assert.equal(canonicalPassengerValue("اسم   معتمد", next), "اسم معتمد");
});
for (const kind of ["disabled", "deleted", "wrong-category", "unconfigured", "missing"] as const) {
  test(`a ${kind} mapping never invents a value or silently selects another category`, () => {
    const next = structuredClone(context);
    if (kind === "disabled") next.options[0].is_active = false;
    if (kind === "deleted") next.options.shift();
    if (kind === "wrong-category") next.options[0].category = "destination";
    if (kind === "unconfigured") next.configured = false;
    if (kind === "missing") delete next.mapping.infant;
    const resolved = resolvePassengerType(input("2025-01-01", "2026-10-19"), next);
    assert.equal(resolved.value, null); assert.ok(resolved.warning);
  });
}
test("mapping parsing ignores unknown categories and malformed data", () => {
  assert.deepEqual(readPassengerMapping({ v: { version: 1, mapping: { infant: "abc", child: 9, admin: "other" } } }), { infant: "abc" });
  assert.deepEqual(readPassengerMapping({ v: { version: 2, mapping: { infant: "abc" } } }), {});
});
test("suggestions only match unambiguous equivalent names; under 12 never substitutes under 18", () => {
  const opts = ["رضع", "سيدات", "طفل تحت ٨", "طفل تحت12"].map((value, i) => ({ id: String(i), value, is_active: true }));
  assert.deepEqual(suggestedPassengerMapping(opts), { infant: "0", female: "1", child: "2" });
  assert.equal(suggestedPassengerMapping([...opts, { id: "dup", value: "رضيع", is_active: true }]).infant, undefined);
});
test("legacy Excel labels normalize only through the linked category, while exact manual selections survive", () => {
  assert.equal(canonicalPassengerValue("طفل تحت ٢", context), names[0]);
  assert.equal(canonicalPassengerValue("طفل تحت18", context), names[2]);
  assert.equal(canonicalPassengerValue("طفل تحت 12", context), null);
  const row = preparePassengerImport({ ...input("2025-01-01", "2026-10-19"), passenger_type: names[4] }, context);
  assert.equal(row.passenger_type, names[4]);
  assert.equal(preparePassengerImport(input("2025-01-01", "2026-10-19"), context).passenger_type, names[0]);
});
test("Excel validation uses the same mapping and travel date, and blocks unresolved/unknown types", () => {
  const spec = withPassengerClassificationSpec(getSpec("executions")!, context);
  const lookups = { agent: new Map(), company: new Map(), merchant: new Map(), investor: new Map() };
  const rows = [{ name: "مسافر", nid: nid("2008-10-20"), date: "2026-10-19", type: "" }, { name: "مسافر", nid: nid("2008-10-20"), date: "2026-10-20", type: "" }];
  const mapping = { passenger_name: "name", national_id: "nid", travel_date: "date", passenger_type: "type" };
  const result = validateRows(spec, rows, mapping, lookups, new Set());
  assert.equal(result.errors.length, 0);
  assert.deepEqual(result.validRows.map(r => r.passenger_type), [names[2], names[3]]);
  assert.equal(validateRows(spec, [{ ...rows[0], type: "غير معروف" }], mapping, lookups, new Set()).validRows.length, 0);
  assert.equal(validateRows(withPassengerClassificationSpec(getSpec("executions")!), rows, mapping, lookups, new Set()).validRows.length, 0);
  assert.equal(withPassengerClassificationSpec(getSpec("agents")!, context), getSpec("agents"));
});
test("date/identity edits reclassify drafts, manual choice remains explicit, unrelated edits do not reclassify", () => {
  const row = { ...input("2008-10-20", "2026-10-19"), passenger_type: names[2], passenger_type_auto: true, dob: "2008-10-20" };
  const patch = passengerDraftPatch(row, { travel_date: "2026-10-20" }, context);
  assert.equal(patch.passenger_type, names[3]); assert.equal(patch.passenger_type_auto, true);
  assert.deepEqual(passengerDraftPatch(row, { passenger_type: names[4] }, context), { passenger_type: names[4], passenger_type_auto: false });
  assert.deepEqual(passengerDraftPatch(row, {}, context), {});
  assert.deepEqual(passengerDraftPatch({ ...row, passenger_type_auto: false }, { travel_date: row.travel_date }, context), { travel_date: row.travel_date });
  assert.equal(passengerDraftError({ ...row, ...patch }, context), null);
  const next = structuredClone(context); next.options[2].is_active = false;
  assert.ok(passengerDraftError(row, next));
  assert.equal(row.passenger_type, names[2]);
});
test("an open automatic draft cannot silently save after mapping changes", () => {
  const row = { ...input("2025-01-01", "2026-10-19"), passenger_type: names[0], passenger_type_auto: true };
  const next = structuredClone(context); next.mapping.infant = next.options[1].id;
  assert.ok(passengerDraftError(row, next));
  assert.equal(passengerDraftError({ ...row, passenger_type_auto: false }, next), null);
});
test("classification and existing DOB utility agree without replacing its leap-date behavior", () => {
  assert.equal(deriveDobIsoFromEgyptianNationalId(nid("2008-02-29")), "2008-02-29");
  assert.equal(deriveDobIsoFromEgyptianNationalId(nid("2007-02-29")), null);
  assert.equal(classifyPassenger(input("2008-02-29", "2026-03-01"))?.dob, deriveDobIsoFromEgyptianNationalId(nid("2008-02-29")));
});
