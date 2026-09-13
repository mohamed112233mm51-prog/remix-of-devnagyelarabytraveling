import fs from "node:fs";
import assert from "node:assert/strict";

const read = (path) => fs.readFileSync(path, "utf8");
const has = (text, needle, label) => assert.ok(text.includes(needle), label);
const lacks = (text, needle, label) => assert.ok(!text.includes(needle), label);

const direct = read("src/lib/agentCompanyDirectTransfer.ts");
has(direct, 'AGENT_COMPANY_DIRECT_SOURCE = "agent_direct_to_company"', "direct source marker missing");
has(direct, 'atomicRow("company_transactions", companyRow)', "company leg must be atomic");
has(direct, 'atomicRow("transactions", agentRow)', "agent leg must be atomic");
has(direct, 'source_service_id: agentTransactionId', "company leg must link to agent leg");
has(direct, 'source_service_id: companyTransactionId', "agent leg must link to company leg");
lacks(direct, 'atomicRow("payment_splits"', "direct transfer must not create payment_splits");
lacks(direct, 'cash_box_id', "direct transfer must not touch a cash box");

const route = read("src/features/companies/LegacyCompaniesRoute.tsx");
has(route, 'directRows.length !== 1 || validSplits.length !== 1', "direct settlement must be isolated from company/merchant splits");
has(route, 'if (tripValueNum > 0)', "direct settlement must not carry service sale value");
has(route, 'postAgentCompanyDirectTransfer({', "company create flow must use reviewed atomic direct-transfer helper");
has(route, 'agents={agents} allowAgentSource', "company payment UI must expose the agent source only in this flow");

const splits = read("src/components/PaymentSplits.tsx");
has(splits, '<option value="agent">وكيل</option>', "agent payment source option missing");
has(splits, 'agent_direct', "agent direct payment method missing");
has(splits, 'اختر الوكيل للدفع المباشر', "agent selection validation missing");

const update = read("src/lib/financialEngine.update.ts");
has(update, 'source_service_type === "agent_direct_to_company"', "edit guard missing");
has(update, 'لا يمكن تعديل التحويل المباشر بين الوكيل والشركة من طرف واحد', "single-leg edit must be rejected");

const cancel = read("src/lib/financialEngine.cancel.ts");
has(cancel, 'set_agent_company_direct_cancel_state_atomic', "paired cancel RPC routing missing");
has(cancel, 'data.counterpart_before', "counterpart audit handling missing");

const summary = read("src/lib/financialSummary.ts");
has(summary, 'function companySettlementAmount', "company direct-settlement amount fallback missing");
has(summary, 'دفع مباشر للشركة', "agent ledger label missing");
has(summary, 'دفع مباشر من وكيل', "company ledger label missing");
has(summary, 'const payment = Math.round(Number((t as any).total_paid || 0));', "current company ledger total_paid source-of-truth must remain intact");

const dashboardCollections = read("src/lib/dashboardCollections.ts");
has(dashboardCollections, 'function agentCollectionAmount', "agent collection fallback missing");
has(dashboardCollections, 'source_service_type === "agent_direct_to_company"', "agent direct collection source handling missing");

const migration = read("supabase/migrations/20260907183000_agent_company_direct_transfer_cancel.sql");
has(migration, 'set_agent_company_direct_cancel_state_atomic', "paired cancel DB function missing");
has(migration, "source_service_type = 'agent_direct_to_company'", "direct insert policy missing");
has(migration, "v_counterpart_id", "paired cancel counterpart lock/update missing");
lacks(migration, 'INSERT INTO public.payment_splits', "migration must not create treasury/payment split movement");

console.log("agent-company direct transfer regression checks passed");
