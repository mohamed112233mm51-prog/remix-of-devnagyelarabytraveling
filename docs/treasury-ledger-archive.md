# Treasury ledger archive and server pagination

The treasury report uses the same canonical sources: payment_splits for cash
movements and cash_boxes.balance maintained by the existing posting trigger.
There are no archive flags, extra ledgers, new financial tables or new writers.

## Read path

get_treasury_ledger_page is a STABLE SECURITY INVOKER RPC. It checks the existing
reports/view permission, retains the caller's table RLS and returns at most
50 rows, totals and compact archive-month metadata. An index supports cash-box
history ordering. Database numeric arithmetic preserves the existing algorithm:

balance after a row = current stored cash-box balance - later active movements.

The reverse running balance is calculated before month, search, direction,
cash-box and pagination filters. Ordering is deterministic by created_at then
id. Canceled movements are excluded. Month boundaries use Africa/Cairo.
Transfers remain two ledger legs; the operations view represents the transfer
once and can filter by either endpoint.

Names and search are resolved in SQL across the selected period before slicing.
The client does not fetch every parent or counterparty record. Both the existing
transfer/settlement history and the incoming/outgoing ledger use this read path,
so a hidden full payment_splits subscription cannot defeat pagination.

The current month is the default. Prior months appear in the organizational
archive, with an all-archive option. Future and undated rows remain accessible.
All modes have a fixed 50-row page size and server-side filters.

The complete data provider for other reports mounts only for those reports.
The last selected report tab is restored before mounting its data provider,
avoiding an eager complete-history read on returning to the treasury report.
Other financial reports and treasury summary formulas are unchanged.

## Cache, updates and failures

React Query keys include identity, period, all filters, mode and page. Old-page
rows are never used as a placeholder for another filter. Requests use cancellation;
search is debounced. Cash-box and payment-split realtime events coalesce into a
refresh of active pages, and reconnect/focus/manual refresh reconcile snapshots.
The existing authentication/permission cache resets also reset these queries.
Failures are explicit with a retry action; missing RPCs do not fall back to
downloading complete history.

This reduces rows transferred for the two treasury histories. It does not claim
that every other report or treasury exchange-rate summary is now paginated.

## Deployment and verification

Apply the treasury_ledger_page SQL migration to each target database before
deploying this UI. It adds only a read RPC and an index; it does not update data.
Do not copy financial migrations from another customer.

Verification uses the actual SQL in PGlite with 1205 movements, page boundaries,
stable balances across archive/direction/currency filters, source-name search,
transfer deduplication, Cairo boundaries, permissions, RLS and read-only
transactions. Client tests exercise the actual component, query keys, bounded
RPC contract, page resets, failure rendering and lazy treasury report mounting.
The GitHub verification workflow also runs existing financial regressions,
TypeScript and the production build.
