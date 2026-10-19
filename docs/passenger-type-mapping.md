# Passenger type mapping

The dropdown source remains `system_dropdown_options` with category `passenger_type`.
The new `app_settings` key `passenger_type_mapping_v1` stores
`{ v: { version: 1, mapping: { infant, child, child_under_12, young, male, female } } }`.
Mapping values are option IDs, never display labels. No new tables, migrations,
financial write routes, or data backfill are introduced. Existing authenticated
read access and `company_manage` write policies apply unchanged.

Configure the six selectors in Settings → General → Automatic passenger type
mapping, then save using that section's own save button. Unambiguous legacy names
are suggested, but suggestions are inactive until saved. Under-12 belongs only
to the 8–11 classification, not the 12–17 classification. Empty mappings are allowed and require
manual selection when that category is encountered. Disabled/deleted options
fail closed and must be relinked or cleared.

Age bands are under 2, 2–7, 8–11, 12–17, and adult male/female. The additive
`child_under_12` key represents 8 inclusive to 12 exclusive. Existing version-1
settings keep all saved option IDs; `young` now represents 12–17. An old mapping
without the new key requires explicitly linking the new category or choosing
the passenger type manually. There is no fallback to `young`, automatic setting
write, schema migration, or update of historical passenger/pricing snapshots.

Age is evaluated on departure date, otherwise the current date in Cairo.
National ID supplies DOB and sex; passport DOB/MRZ sex is the fallback when the ID
is unavailable. The resolved value is the exact current active dropdown label,
so the existing string-based company price lookup continues unchanged. Metadata
describing automatic versus manual selection is draft/session state only and is
excluded from financial/database payloads.

The existing `executionPassengerIdentity.ts` utility remains the source of DOB
extraction, sex, age boundaries and the Cairo reference date. The legacy Excel
classification helper delegates to it too. Existing DOB autofill remains available
while mapping settings load. The execution editor recalculates after identity/date
changes, allows an explicit
manual override, and validates new/changed selections immediately before calling
the existing `postExecutionFinancials` gateway. Opening or saving an unchanged
historical execution does not reclassify its saved passenger type. Settings changes
do not rewrite historical records or price rules. Renaming a dropdown keeps its
mapping ID, but does not rename historical text snapshots in existing pricing rows.

All passport image/PDF upload variants use the same resolver after OCR and validate
draft selections before the existing bulk execution importer. Common departure-date
edits also recalculate types. An automatic draft whose mapping changed cannot save
silently; it requests review/manual selection. Excel preview and final validation
use the same mapping, accept recognized legacy labels only through their linked
categories, and reject unknown/inactive values. Downloaded Excel templates embed
active labels in a hidden validation list and use the mapped labels in formulas.
Import validation rechecks current configuration at save time.

Configuration queries share the existing React Query client, use a user-specific
key and a 30-second freshness window, have no polling, and are cleared by the
existing auth lifecycle. Save-time validation refreshes the small configuration
snapshot. Option metadata is paginated without truncation; financial row loading
and cache architecture remain unchanged.

Validation: run `node --experimental-strip-types --test tests/passengerClassification.test.ts tests/passengerClassificationFlows.test.mjs tests/passengerClassificationIO.test.mjs`. This covers boundary birthdays,
ID/DOB/MRZ classification, missing/deleted/disabled mappings, exact label resolution,
manual and historical behavior, actual execution/settings component handlers,
configuration reads/session isolation, and an actual ExcelJS workbook round trip.
The dedicated passenger-classification CI workflow runs this suite and TypeScript
before the production build. Existing financial and image-export CI is retained.
