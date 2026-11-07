# Complete dashboard profit reads

## Existing sources of truth

- `DashboardOperationalPeriodEnhancer` calls the existing authenticated
  `getDashboardPeriodProfitSummaryData` server function for its profit cards.
- `summaryPeriodStart` and `summaryPeriodEndExclusive` define the calendar window.
  Executions continue to use `created_at`, not the posting or travel date.
  Expenses use the accounting `date`, falling back to `created_at` only when
  `date` is absent, as defined by the existing `expenseAccountingDay` helper
  shared with the expense archive and dashboard expense cards. Cairo determines
  the current calendar period; UTC midnight bounds preserve the existing
  ISO-date comparison for creation timestamps.
- `computeExecutionProfitEGP` and `computeExpenseEGP` remain the only profit/FX
  calculations. Stored `fx_locks`/`fx_rate` and pending-FX exclusions are unchanged.

## Read correction

The old server function requested each entire table once, then filtered the
returned rows in memory. An API response cap could discard matching rows before
the period filter ran.

The server function now uses the existing `readAllRows` reader. Its optional date
filter is applied to every page before deterministic `created_at DESC, id DESC`
ordering and the inclusive 1000-row range. Dated periods send `created_at >= start`
and `created_at < endExclusive` for executions. Expenses send a single OR filter:
`date >= start AND date < endExclusive`, or `date IS NULL` with the equivalent
creation-timestamp bounds. This selects accounting-dated and legacy rows before
paging, without overlapping result sets or downloading other months. `all` sends
no date bounds and still reads every page. Existing consumers without a filter
keep their behavior.

Authorization still happens before either financial read, and all requests use
the authenticated user's Supabase client/RLS scope. A failed page rejects the
summary rather than publishing partial totals. There are no financial writes,
new accounting paths, tables, RPCs or migrations.

## Verification

Run `npm run test:dashboard-profit` and `npm run test:data-cache`.

The regression suite runs the real Supabase client against a deterministic HTTP
test endpoint with a 1000-row API cap. It covers a synthetic 1548-execution history
with 63 executed November records, multiple pages for both sources, exact page
boundaries, timestamp ties, all supported periods, year rollover, unchanged
historical USD/LYD conversions, missing-FX exclusions, permissions, RLS scope,
empty results and failures after the first page. The expense-date regression
anonymizes the reported October expenses (7000 + 4700 + 3500) created in November:
November expense totals must be 31300, October 15200 and all-time 46500. Further
cases cover both directions of date/creation-month disagreement, null-date
fallback, every dated period and multiple mixed pages. This does not substitute for
checking actual production totals after the change is released there.
