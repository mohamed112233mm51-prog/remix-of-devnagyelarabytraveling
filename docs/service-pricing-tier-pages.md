# Service pricing: separate tier pages

## Architecture and source of truth

The existing `company_pricing_rules` table owns company/service/tier prices.
`system_dropdown_options` through `useDropdownOptions('agent_tier')` owns the configured
tier names. Include tiers found in existing prices as well, so archived/custom
tiers remain reachable. The database's existing `calc_company_pricing_agent_price`
trigger still calculates `agent_price`; the inline calculation remains a preview.
`src/lib/pricingMatch.ts` still resolves execution prices by company, service, tier
and the existing matching factors. Execution posting and financial ledgers are untouched.

`/service-pricing` retains its existing permission boundary and company selector.
The optional `company` and `tier` URL search values select the company/tier page;
refresh, direct links and browser history therefore restore the selection. Changing
company clears the selected tier. A missing tier opens the tier directory, and an
unknown tier shows a return action instead of a pricing editor.

The route opts into `CompanyPricingTab.tierPages`. Other callers retain the existing
full-company presentation. Both presentations use the same loader and shared
save, duplicate, delete and import handlers. Only the displayed/searchable rule
subset changes. A tier page fixes new/edit draft tier selection and namespaces
resumable drafts by company and tier. Remounting the editor on selection changes
also isolates filters and pending edits. Existing permission checks remain in place.

Company-wide import is available from the tier directory, where its existing
merge/replace scope remains clear; it is not presented as a tier-only import.
No tables, migrations, database functions, pricing formulas, financial writers,
dependencies or lockfiles are added or changed.

## Verification

- `npm ci --no-audit --no-fund`: clean lockfile installation.
- `npm run test:pricing-inline`: original inline editor behavior plus tier directory,
  legacy/empty/unknown tiers, tier-only display and search, original writer payloads,
  company/tier draft isolation, editing, permissions and URL navigation.
- `node --experimental-strip-types --test tests/*.test.mjs tests/*.test.ts`: 242 tests
  pass, including the existing execution and financial consistency suites.
- `npx tsc --noEmit`: passes.
- `npm run build`: passes (client and server production bundles).
- `python3 scripts/_audit_financial_atomic.py`: no hard-guard violations; the existing
  direct-write review inventory remains unchanged.

Browser visual verification could not run: this environment had no installed browser,
and both Chromium and headless-shell downloads returned truncated archives. UI and
route behavior were exercised through the component/route test harnesses. These
checks do not claim live sign-in or deployed visual verification.
