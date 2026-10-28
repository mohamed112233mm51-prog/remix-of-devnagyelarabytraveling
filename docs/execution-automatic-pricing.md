# Manual price lookup in the execution form

## Architecture and source of truth

The execution form calls the existing `resolveAgentPrice` in
`src/lib/pricingMatch.ts` only after the user presses its row's **جلب السعر**
button. `company_pricing_rules`, its generated selling price and the existing
most-specific matching algorithm remain the only source of list prices.
Purchase rows retain their own issuing company (with the existing approval-company
fallback). Sale rows use the approval company and require a selected agent. Both
retain the existing tier-A fallback and all existing matching factors.

The same `useExecutionServicePricing` hook owns the button requests, status and
cancellation. It updates only the form's existing service draft; it does not write
prices, executions, debts or financial movements. `postExecutionFinancials` and the
existing atomic execution-save RPC still own persistence. No parallel lookup or
financial path, schema, migration, resolver, dependency or lockfile is introduced.

## Behavior

- Opening new/saved executions, restoring drafts, adding service rows and loading
  the agent list do not fetch, clear or replace any price.
- Changing agent/tier, service, issuing/approval company, departure, destination,
  airline, approval status, passenger type, ID, birth/travel dates, quantity or notes
  does not fetch prices. Current unit prices, currency and legacy purchase totals
  stay intact. Quantity changes still update the form's ordinary derived totals.
- Each buy/sell row displays a **جلب السعر** button. Only that row is refreshed,
  using the current form inputs at the time of the click. A successful purchase
  fetch clears its old explicit `company_value` so the total uses price × count.
  A fetched price remains unchanged until another click or direct manual edit.
- Missing inputs, unmatched rules and request errors show a row-level message,
  retaining the current price/currency/explicit total. Manual entry remains available.
- Saving waits only while an explicit lookup is pending. Other existing save
  validation policies are unchanged.
- Form context changes cancel obsolete pending responses without starting a new
  request. Removed rows, manual price/currency edits, newer button requests and
  unmount likewise prevent late responses overwriting current values. Count/note
  edits retain a pending request for the same price context and the latest quantity.
- Existing draft-only `_priceSource` values remain compatible, including legacy
  `auto` tags; none initiates automatic fetching. `executionServicesForSave` strips
  that metadata before calling the existing canonical financial save gateway.

## Manual birth dates

The existing national-ID parser initially supplies DOB. A manual edit becomes
authoritative for the displayed date, saved date and age classification, using
the same passenger-classification module and ID-derived gender when needed.
An ID mismatch produces a visible Arabic warning rather than overwriting DOB.
The draft-only `dob_source` survives session restoration and is excluded from
the canonical execution patch. Existing saved DOBs remain authoritative on edit.

## Verification

`npm run test:execution-pricing` exercises the actual hook and form controls:
no requests on opening or editing pricing dimensions, selected-row explicit fetch,
current exact resolver contexts, preserved restored/manual prices, currencies,
quantities, missing/error responses, pending-save protection, out-of-order results,
removal races, manual edits, and unmount. The real resolver remains read-only.
National-ID/DOB classification continues independently, and the financial save
payload still uses the canonical adapter without draft-only metadata.

Validated: all 289 Node regression tests pass, including 48 hook/form checks;
TypeScript and the client/server production build pass, and the financial atomicity
audit reports no hard-guard violations. Tests use local fixtures/mocks; no real company
data or financial movements are created. No live authenticated browser check is
claimed.
