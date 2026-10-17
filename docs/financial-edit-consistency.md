# Paid expense and currency edits

Both screens call the existing `updateFinancialTransaction` adapter and the
existing `update_financial_transaction_atomic(text, uuid, jsonb, jsonb)` RPC.
There is no second ledger, posting engine, or write fallback.

## Sources of truth

- `expenses` is the expense principal; linked `expense_deductions` and
  `merchant_cash_collections.expense_id` describe its original funding.
- Only `payment_splits` and the existing `payment_splits_balance_sync` trigger
  move company cash-box balances. Deduction rows must not deduct cash again.
- A supplier transaction contains both trade legs, the original exchange rate,
  commission, and its stored EGP payment allocation. Related treasury rows use
  `source_table/source_id`. Merchant counterparts now reuse the existing UUID
  `source_service_id` plus `source_service_type='currency_supplier'`.

## Edit policy

Paid expense amount changes preserve the original funding sources and their
proportions. Cumulative rounding preserves the exact new total in cents.
Amounts, funding rows, treasury splits, and audit entries commit together.
An inconsistent or recurring historical expense cannot have its amount/date
silently redistributed. Descriptive corrections remain available.

Supplier buy/sell amount means FOREIGN quantity on both screens. The edit
retains the recorded exchange rate, scales the buy commission proportionally,
and recomputes the EGP side. The paid fraction and funding allocation are
retained; an unpaid purchase stays unpaid. Historical FX locks on executions
are not rewritten. Cash payments/receipts remain in their original currency.

Existing merchant counterparts are recovered only from an exact persisted
atomic-operation reference with matching creation time, author, date, currency,
merchant and amount. Unlinked history fails closed; it is never matched from
amount/date similarity alone. No historical monetary value is repaired by the
migration.

The RPC requires the form's original snapshot and edit reason. It rejects a
stale snapshot after taking the row lock. Direct edits of a coupled child are
rejected, so a generic editor cannot change just one financial leg. The existing
cash-box trigger applies a single net delta for updates within the same box;
this avoids a transient overdraft while increasing a partly-spent receipt.
Existing cash-box guards and RLS still apply. Merchant-funded edits use the same
linked settlement rows without adding a new merchant credit limit. Audit failure
rolls back the edit.

## Rollout and verification

Apply `20261017234044_financial_edit_consistency.sql` together with the client
change. Older RPC deployments reject the reserved edit keys without partial
writes. Older clients need a reload before coupled edits after migration.

Run `npm run test:financial-edit` (PostgreSQL 17 via PGlite), the existing Node
regression tests, `python3 scripts/_audit_financial_atomic.py`, and `npm run build`.
The financial suite covers both directions, full/partial/unpaid trades, cent
rounding, linked merchant settlement, legacy expense links, exact upgrade links,
stale retries, permission/audit failures, and insufficient funds with rollback.
These tests use fixtures; no test financial movements are inserted into the
company's database. This change does not migrate small master lists, expense
imports, or execution creation/financial-posting date semantics.


## Old-client development scope

This port targets `remix-of-devnagyelarabytraveling`, branch `devo`, and Lovable
project `06f19bd2-7769-4303-8f01-6ff32735a0af`. Its deployed generic edit RPC and
cash-box split trigger were reviewed before porting. The existing generic RPC
branch is preserved except for the same foreign-split ownership validation fix.

Only paid expense/currency edit consistency is ported. Expense archiving,
execution saves, merchant account policy, existing preflight checks and other
customer settings are outside this change. No RPC, ledger or balance column is
added. New supplier merchant rows use the existing source reference columns.
