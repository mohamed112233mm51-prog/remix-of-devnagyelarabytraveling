# Signed amounts in agent statement image exports

## Source of truth and cause

`buildAgentLedgerRows` in `financialSummary.ts` builds the existing transaction
ledger; `buildMonthlyLedgerView` and `attachLedgerRunningBalance` provide its
monthly scope, currency-specific totals and running balances. `AgentLedger`
formats these same rows for both its screen table and the registered statement
capture/export payload. No financial calculations are performed by the exporter.

The screen uses a nonzero check for debit/credit, but `buildExportData` previously
used `> 0`. A cash-out credit such as `-50000` was therefore formatted as a dash,
while `credit__excel` and the running balance still held its actual value.
`StatementImageExportDialog` displays the formatted cells directly in row-selection
mode. The PDF/image template's existing raw-value fallback recovered the negative
number in full and cropped exports, explaining the inconsistent displays.

## Fix

The export mapping now uses exactly the screen's debit/credit conditions and the
existing `fmtCurrency`. All nonzero amounts retain their sign and currency; zero
cells retain the dash. Raw Excel values, row order, running balances and original
summary cards are unchanged. The row selector, selected-image template and full
image template all consume the same corrected statement payload.

Only the display mapping changes. There are no new database tables, migrations,
queries, financial writers, totals, export pipelines or dependencies.

## Verification

`tests/agentStatementExportAmounts.test.mjs` executes the actual component export
closure and existing currency formatters. It renders the real row-selection
component to HTML for EGP, USD and LYD, checking negative cash-out credits, positive
credits, negative debits, zero cells and raw/running-balance values. It compares
nonconsecutive selected rows against the same rows in the full image's PDF template,
retaining original summary cards and leaving the input data unchanged. All four
regressions fail before the fix and pass after it. These tests verify data and
rendered markup; they do not claim live authenticated or PNG pixel verification.

Validation completed: all 289 Node regression tests pass; TypeScript and the
client/server production build pass; the financial atomicity audit reports no
hard-guard violations.
