# Atomic execution lifecycle

## Source of truth and architecture

`executions` owns the passenger, operation status, agent and ordered `services`.
`executionPostingRows.ts` contains the debt-building rules moved from the existing
`executionPosting.ts`; every caller uses this one builder. It creates only the
existing `transactions` / `company_transactions` rows linked by
`source_service_type='execution'` and `source_service_id='<execution UUID>::<service index>'`.
Unpriced agent placeholders create no debt, matching compact-import behavior.
Legacy combined services retain their existing payment buckets and company value.

`postExecutionFinancials` is still the save adapter. The existing
`replace_execution_financials_atomic(uuid,text,uuid,date,jsonb)` is still the only
execution posting RPC, with the same signature and SECURITY INVOKER boundary.
The JSON `p_rows` argument now carries `{ action, execution_patch, expected, rows }`.
It saves the execution, replaces generated debts, links/releases its submission,
and writes audit and idempotency records in one database transaction. There is no
second ledger, posting engine, or direct-write fallback. Existing cash-box balance
writers are untouched. Rows with attached treasury splits fail closed so replacing
an execution cannot orphan a payment.

The main form, bulk reconciliation, both execution import adapters and import undo
all use this path. Import processing remains atomic per execution, not per file.
Bulk/import callers retain realtime reconciliation without fetching every complete
financial table after each imported row. FX locks remain an independent best-effort
follow-up under the existing profit policy; missing FX leaves profit pending.

## Dates, retries and concurrent edits

Creation and travel dates remain operational. The database sets the first financial
posting date on first approval using Africa/Cairo, then preserves it through edits,
unposting and reposting. The legacy date RPC argument remains for signature
compatibility; callers cannot use it to move the accounting date.

A stable operation ID and deterministic execution/child IDs use the existing
financial idempotency helpers. Retrying a lost response reuses the committed result.
The server also checks a request hash, so a reused client fingerprint cannot conceal
a different mutation. Execution advisory locks serialize canonical writers; edits
and deletes compare the original snapshot exactly, including service order and
multiplicity. Independent FX-lock fields and `updated_at` are excluded from that
comparison. RLS and row-count checks detect silent zero-row updates/deletes. No
SECURITY DEFINER bypass is added. Narrow policies permit creation/deletion of linked
execution debts with the matching execution permission; underlying submission RLS
continues to apply. A narrow read policy lets execution-only operators detect
attached treasury splits without exposing unrelated treasury movements.

## Rollout and verification

Apply `20261018020243_execution_save_financial_atomic.sql` with the client changes.
Reload open execution screens after rollout. A new client against the old RPC fails
before any execution is written. Old financial-only array RPC payloads are rejected.

Run:

- `npm run test:execution-save` for the real migration and shared JS builder against
  PostgreSQL 17 (PGlite), with RLS enabled and injected failures; client tests
  verify a single RPC and no direct-write fallback.
- `npm run test:trip-reconciliation`, the existing Node regression suite and
  `npm run test:financial-edit`.
- `python3 scripts/_audit_financial_atomic.py`, TypeScript checking and production build.

The execution suite covers create/edit/approve/unpost/delete, rollback after partial
work, permission denial, silent zero-row deletion, stale snapshots, changed service
ordering, lost-response retries, submission links, legacy payments, currencies,
unpriced imports, FX isolation and immutable posting dates. Its competing-snapshot
case checks queued requests on one PGlite connection, not a multi-session load test.
Fixtures mirror the relevant live column definitions and permission boundaries;
no test financial movements are inserted into the company's database.


## Old-client development port

Target: `remix-of-devnagyelarabytraveling` / `devo`, Lovable development project
`06f19bd2-7769-4303-8f01-6ff32735a0af`. The deployed RPC signature, table columns,
trigger wiring and existing execution/ledger permissions were reviewed before this
port. Only execution lifecycle changes are included; existing pricing and passenger
identity behavior, import-center workflows and customer settings are preserved.
The existing paid-expense/currency edit migration is unaffected.
