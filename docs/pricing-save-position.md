# Preserve service-pricing rows after saving

## Cause and source of truth

`CompanyPricingEditor.save` previously called `load()` after every successful
insert/update. The loader replaced the whole table with a loading message, which
collapsed its height and discarded its horizontal scroll container. Reloading
also ordered only by `service_type`, leaving equal-service rows nondeterministic.

The existing `company_pricing_rules` table and its
`calc_company_pricing_agent_price` trigger remain the source of truth. The same
insert/update now requests `.select('*').single()` and uses the returned row,
including the database-generated `agent_price`. Permissions, validation, duplicate
confirmation and resumable new drafts retain their existing behavior. Failed
saves leave the draft available for retry.

## Behavior

- Successful updates replace the original row by ID at its current array index.
  Changing the service name also preserves its current position.
- New rows replace the first-position draft; existing rows retain their order.
- Duplicate creates an editable copy immediately after its source, without a
  company-wide reload. Saving the copy retains this position.
- The table stays mounted during and after save. Scroll offsets of the table
  container and its ancestors are captured when the response arrives and restored
  in a layout effect. This respects scrolling while the request is pending.
  If horizontally scrolled, the table retains sufficient minimum width to avoid
  clamping when wide editing inputs close, including negative RTL offsets.
- Filter results are rendered from the current canonical rules by ID, rather
  than stale filtered objects. The last saved row stays visible even if its
  changed factors do not match; the next explicit filter change/reset clears
  this retention. Other filter results keep their original relative order.
- Initial loading retains the service grouping and uses `created_at`, then `id`
  as stable tie breakers. In-page save position is preserved until leaving or
  explicitly reloading the pricing file; no persistent custom order is introduced.

Company/tier navigation still remounts the editor and isolates its state. Delete
and company-wide import retain their existing refresh behavior. No database
schema, migrations, financial paths, pricing formulas, dependencies or lockfiles
change.

## Verification

- `npm run test:pricing-inline`: 30 component/route tests, including seven new
  regression cases for in-place updates, changing service names, insertion,
  filters, nested vertical/RTL horizontal scroll restoration and duplicate.
- Full Node regression suite: 271 tests pass using `--test-concurrency=2`.
  `npx tsc --noEmit`, the client/server production build and the financial
  atomicity audit pass (no hard-guard violations).
- Browser visual verification could not run: Chromium is not installed, and the
  Playwright browser download returned truncated archives. Scroll restoration is
  covered by the component harness with simulated nested DOM scroll elements;
  this does not claim live browser layout or authenticated production testing.
