# Automatic prices in the execution form

## Architecture and source of truth

The execution form now calls the existing `resolveAgentPrice` from
`src/lib/pricingMatch.ts` automatically. The existing `company_pricing_rules` table,
its generated selling prices and the most-specific matching algorithm remain the
only source of list prices. Purchase rows retain their own issuing company (with
the existing approval-company fallback). Sale rows retain the approval company
and require a selected agent. Both retain the existing tier-A fallback.

`useExecutionServicePricing` only updates the form's existing services draft. It
does not write prices, executions or financial movements to the database. The
existing `postExecutionFinancials` adapter and atomic execution-save RPC still own
all execution/ledger persistence. No tables, migrations, financial paths, matching
rules, dependencies or lockfiles change.

## Behavior

- New-execution rows fetch automatically when their required source fields are
  available. Each row also has an explicit fetch button using this same hook,
  resolver and read-only pricing table.
- Agent/tier, service, purchase company, approval company, departure, destination,
  airline, approval status and passenger type are the lookup inputs. Identity or
  travel-date edits that change automatic passenger classification therefore
  trigger pricing with the resulting exact configured passenger-type label.
- Unit price, currency and totals update together. Repricing a purchase row clears
  its legacy explicit `company_value`, so the total follows current price/count.
- Count, notes, operation status and unrelated fields do not trigger new reads.
  Manual price edits mark that service row as manual, including zero or a value
  equal to the list price. Subsequent pricing-input changes cannot replace it.
  Row-local provenance survives the existing session draft, additions/removals,
  failed saves and restoration. Untagged older drafts preserve existing amounts.
- Changing pricing inputs clears the previous automatic amount/currency. Missing matches,
  incomplete inputs and network errors show a row-level message and allow manual
  entry. Saving waits while automatic pricing is pending, including the brief
  interval before an invalid context's old price is cleared. Other existing save
  validation policies remain unchanged.
- Saved executions and their restored drafts retain amounts, currencies and
  explicit totals through context changes and agent-list hydration. The explicit
  fetch button replaces only its selected row. Newly added editing rows also use
  explicit fetch; changing the service or purchase issuer resets only that row.
  A missing or failed explicit fetch preserves the current amount and shows feedback.
- Row reconciliation, context checks and cancellation prevent late results from
  updating a newer context, manual edit, explicit fetch, deleted row or unmounted
  form. Identical buy/sell requests share one in-flight read per update batch.
  Draft-only `_priceSource` is removed by `executionServicesForSave` before the
  existing atomic save gateway. No persistent row IDs, tables or financial
  metadata are added to saved services.

## Manual birth dates

The existing national-ID parser initially supplies DOB. A manual edit becomes
authoritative for the displayed date, saved date and age classification, using
the same passenger-classification module and ID-derived gender when needed.
An ID mismatch produces a visible Arabic warning rather than overwriting DOB.
The draft-only `dob_source` survives session restoration and is excluded from
the canonical execution patch. Existing saved DOBs remain authoritative on edit.

## Verification

Run `npm run test:execution-pricing` for context updates, exact real resolver
matching, currency/quantity handling, manual overrides, missing/error responses,
out-of-order requests, removal races, historical prices, agent hydration, Strict
Mode replay and unmount. It also exercises actual execution controls, automatic
classification, pending-save blocking, totals and canonical financial-save payloads.

Run the full Node regression suite, TypeScript, production build and existing
financial atomicity audit. The existing passenger-classification CI job includes
the new automatic-pricing suite. Tests use local fixtures/mocks; no company data
or real financial movements are created. No live authenticated browser check is
claimed.

The regression suite exercises the actual hook and form controls, draft
restoration, manual/automatic prices, historical records, explicit-fetch errors,
late-response races, manual DOB age boundaries and canonical payload stripping.
TypeScript, production build and financial atomicity checks are required before
publication. The financial adapter, ledger builder and RPC remain unchanged.
