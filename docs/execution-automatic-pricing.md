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

- New rows fetch automatically when their required source fields are available;
  the two manual fetch buttons are removed.
- Agent/tier, service, purchase company, approval company, departure, destination,
  airline, approval status and passenger type are the lookup inputs. Identity or
  travel-date edits that change automatic passenger classification therefore
  trigger pricing with the resulting exact configured passenger-type label.
- Unit price, currency and totals update together. Repricing a purchase row clears
  its legacy explicit `company_value`, so the total follows current price/count.
- Count, notes, operation status, unrelated fields and manual price edits do not
  trigger new reads. Manual prices stay editable after the lookup settles, until
  a pricing input changes again.
- Changing pricing inputs clears the previous amount/currency. Missing matches,
  incomplete inputs and network errors show a row-level message and allow manual
  entry. Saving waits while automatic pricing is pending, including the brief
  interval before an invalid context's old price is cleared. Other existing save
  validation policies remain unchanged.
- Opening an unchanged saved execution preserves historical amounts, currencies
  and explicit totals. Hydrating its initially unavailable agent list also
  preserves them. Changing a pricing input reprices the affected rows; adding or
  removing a row does not reprice unchanged historical neighbors.
- Restored editing drafts are compared with the saved execution's pricing
  inputs and normalized service rows. Changed draft contexts and newly added
  rows fetch automatically instead of being treated as unchanged history.
- Row reconciliation, context checks and cancellation prevent late results from
  updating a newer context, deleted row or unmounted form. Identical buy/sell
  requests share one in-flight read per update batch. No persistent row IDs or
  pricing metadata are added to saved services.

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

Validated locally: 264 regression tests pass, including 34 pricing/form checks;
TypeScript and financial atomicity hard guards pass. The canonical save handler
is byte-for-byte unchanged apart from its pending-price guard.
