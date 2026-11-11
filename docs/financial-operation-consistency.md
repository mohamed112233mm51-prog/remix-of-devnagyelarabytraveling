# Linked financial operations

The existing save, edit and cancel RPCs remain the application entry points. Cash
boxes still move only through the payment-split balance trigger. Resolving an
operation uses the following persisted references.

| Operation | Canonical source and counterpart references |
| --- | --- |
| Agent and company payouts funded by merchants | The agent/company transaction and merchant transaction mirrors linked by source type and source ID. Each merchant amount matches its split on the source transaction. |
| Direct agent/company settlement | Both ledger rows have reciprocal source IDs. This flow has no company cash-box effect. |
| Approval fines | Agent and company rows share the same fine source type and source ID. |
| Transfer between cash boxes | The outgoing and incoming splits share a cash transfer source ID. |
| Supplier payments and FX trades | The supplier transaction, its cash-box splits, and exact merchant collection links. An FX edit preserves the recorded rate. |
| USD treasury conversion | The existing conversion row owns both monetary amounts. The EGP amount is calculated from the USD amount and the recorded rate. |
| Investor cash movement | The investor transaction owns the treasury split. |
| Expenses and executions | Edit or delete the original record. Its existing operation owns the generated ledger and funding rows. |

Financial import undo uses the normal cancellation RPC per imported movement.
Ordinary one-sided records retain their existing editing path. A source-linked
child is not edited as an independent movement. Retrying cancellation can
synchronize a previously one-sided cancellation when the linked rows are
identifiable. The migration itself does not modify historical amounts or states.

Run `npm run test:financial-operation`, `npm run test:financial-edit`,
`npm run test:agent-company-direct`, and `npm run build`. Regression tests
execute the SQL in PostgreSQL via PGlite, with explicit fixtures for rights,
rollback, exact split totals, and EGP, USD and LYD.
