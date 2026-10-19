# Organizational expense archive

`public.expenses` remains the only expense source. Payment references remain in
`expense_deductions`, `merchant_cash_collections`, and the existing financial
ledger. No archive table, flag, migration, scheduled transfer, or data deletion
is introduced. `ExpenseForm`, `executeFinancialAtomic`,
`updateFinancialTransaction`, and `delete_expense_atomic` remain unchanged.

The default history view contains the current Cairo calendar month, based on
`expense.date`. A valid `created_at` calendar date is a legacy fallback only.
Earlier months appear under Archive, with all-history and individual-month
selection. Future months and rows without any valid date have separate buttons
when present, keeping every original record accessible while showing only this
month by default. This adapts the new client's presentation-only archive to the
explicit current-month-only requirement.

The existing `useLive` alias already points to `useCompleteFinancialTable`.
All views therefore share its paginated, RLS-filtered snapshot and Realtime
events; switching a scope/month does not fetch or write data. The existing
pagination hook limits rendered rows, not downloaded history. Selected-view
totals use `summarizeExpenses` over all selected records before pagination.
The upper Month/Year/All summary remains independent through the existing
`useExpensePeriodTotals`; dashboard and report accounting remain unchanged.

Verification covers month/year boundaries, date precedence and fallback,
invalid dates, access to future/undated records, complete partitions above
1000 rows, actual history handlers and pagination, selected-view totals,
original edit objects and linked payment labels, atomic delete confirmation,
Realtime regrouping, loading/errors, and the existing shared-cache behavior.
CI runs the archive and cache suites alongside financial edit/save regressions.
