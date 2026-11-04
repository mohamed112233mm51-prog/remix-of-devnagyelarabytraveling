# Expense cash-box balance validation

The expense form uses `useSourceBalances` and `validateSplitOutflows` from
`src/lib/balanceGuard.ts`. Company sources resolve to the existing cash box by
`method_key` and currency, with the existing legacy name fallback. The balance
comes from `cash_boxes.balance`; it is not reconstructed from expense totals.

Saving continues through `execute_financial_atomic`: expense, deductions and
`payment_splits` are written in one database transaction. The RPC locks the
cash-box row and checks its current balance; `apply_payment_split_to_cash_box`
updates that balance. No new ledger, balance writer or SQL migration is added.

## Defects reproduced

- A stored balance of 347.80 and a requested 348 produced the misleading error
  “348 versus 348”, because guard messages and the treasury report formatted
  amounts as whole numbers. This is a real shortfall, not permission to overdraft.
- The source hook rounded stored balances to two decimals (and its legacy EGP
  aliases to whole pounds), losing precision before validation.
- Multiple decimal splits could falsely fail an exact-balance check because
  binary addition turns 0.1 + 0.2 into 0.30000000000000004.

The hook now preserves the stored numeric value, messages and the treasury
report use `fmtBalance`, and split preflight sums use decimal addition. This
does not introduce an epsilon or silently top up a cash box. A genuine excess,
including one cent, remains blocked. Count/general formatting is unchanged.

The screenshot alone does not establish the stored production balance at the
time of failure. Exact 348 against 348 already passed the original guard and
is retained as a regression case. The fixes above address reproducible code
defects without claiming to have inspected the production incident's DB state.

## Verification

`npm run test:balance-guard` covers the actual source hook, shared guards,
treasury report and export, and the actual expense form connected to PGlite
using the repository's atomic RPC and cash-box trigger definitions. It checks:

- Exact 348 saves once and leaves zero; retry does not duplicate deductions.
- Fractional shortfalls are shown and blocked before writing.
- Decimal splits exhaust their source exactly.
- A stale client balance cannot bypass SQL validation; all expense rows roll back.
- Currency separation and four-decimal balances are preserved.

Related regressions: `npm run test:financial-edit` and
`node --test tests/expenseArchiveFlows.test.mjs`.
