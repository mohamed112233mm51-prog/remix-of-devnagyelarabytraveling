import fs from "node:fs";
import assert from "node:assert/strict";

const read = (path) => fs.readFileSync(path, "utf8");
const has = (text, needle, label) => assert.ok(text.includes(needle), label);
const lacks = (text, needle, label) => assert.ok(!text.includes(needle), label);

const direct = read("src/lib/agentCompanyDirectTransfer.ts");
has(direct, 'AGENT_COMPANY_DIRECT_SOURCE = "agent_direct_to_company"', "direct source marker missing");
has(direct, 'paymentMethod: DirectTransferPaymentMethod', "direct method must be an explicit input");
has(direct, 'isDirectTransferPaymentMethod(args.paymentMethod)', "direct method validation missing");
has(direct, 'directTransferPaymentAmounts(args.paymentMethod, amount)', "method amount mapping missing");
has(direct, 'atomicRow("company_transactions", companyRow)', "company leg must be atomic");
has(direct, 'atomicRow("transactions", agentRow)', "agent leg must be atomic");
has(direct, 'source_service_id: agentTransactionId', "company leg must link to agent leg");
has(direct, 'source_service_id: companyTransactionId', "agent leg must link to company leg");
lacks(direct, 'atomicRow("payment_splits"', "direct transfer must not create payment_splits");
lacks(direct, 'cash_box_id', "direct transfer must not touch a cash box");

const methods = read("src/lib/directTransferPaymentMethod.ts");
has(methods, '"direct_instapay"', "Instapay direct method missing");
has(methods, '"direct_vodafone_cash"', "Vodafone Cash direct method missing");
has(methods, '"direct_cash"', "cash direct method missing");
has(methods, 'mobileCashNetAmount', "Vodafone Cash row mapping missing");

const route = read("src/features/companies/LegacyCompaniesRoute.tsx");
has(route, 'directRows.length !== 1 || validSplits.length !== 1', "company-side direct settlement must be isolated");
has(route, 'isDirectTransferPaymentMethod(direct.method)', "company-side method validation missing");
has(route, 'paymentMethod: direct.method', "company-side method must reach the atomic helper");
has(route, 'postAgentCompanyDirectTransfer({', "company create flow must use the shared atomic helper");
has(route, 'agents={agents} allowAgentSource', "company payment UI must expose the agent source only in this flow");

const splits = read("src/components/PaymentSplits.tsx");
has(splits, 'DIRECT_TRANSFER_PAYMENT_METHODS', "company-side direct method choices missing");
has(splits, '<option value="agent">وكيل</option>', "agent source option missing");
has(splits, 'اختر الوكيل للدفع المباشر', "agent selection validation missing");
lacks(splits, 'disabled={String((row as any).source) === "agent"}', "company-side direct method must be selectable");

const agentForm = read("src/components/AgentPaymentForm.tsx");
has(agentForm, 'type Source = "company" | "merchant" | "issuing_company"', "agent-side issuing-company source missing");
has(agentForm, 'companyPerm.create ? [{ value: "issuing_company", label: "شركة صادرة" }]', "agent-side company source must respect company create permission");
has(agentForm, 'directRows.length !== 1 || validSplits.length !== 1', "agent-side direct settlement must be isolated");
has(agentForm, 'isDirectTransferPaymentMethod(direct.method)', "agent-side method validation missing");
has(agentForm, 'paymentMethod: direct.method', "agent-side method must reach the atomic helper");
has(agentForm, 'postAgentCompanyDirectTransfer({', "agent-side flow must reuse the same atomic helper");

const update = read("src/lib/financialEngine.update.ts");
has(update, 'source_service_type === "agent_direct_to_company"', "edit guard missing");
has(update, 'لا يمكن تعديل التحويل المباشر بين الوكيل والشركة من طرف واحد', "single-leg edit must remain rejected");

const cancel = read("src/lib/financialEngine.cancel.ts");
has(cancel, 'set_agent_company_direct_cancel_state_atomic', "paired cancel RPC routing missing");
has(cancel, 'data.counterpart_before', "counterpart audit handling missing");

const summary = read("src/lib/financialSummary.ts");
has(summary, 'directTransferPaymentLabelFromRow', "ledger direct-method resolver missing");
has(summary, 'const payment = Math.round(Number((t as any).total_paid || 0));', "company ledger total_paid source-of-truth must remain intact");

const migration = read("supabase/migrations/20260907183000_agent_company_direct_transfer_cancel.sql");
has(migration, 'set_agent_company_direct_cancel_state_atomic', "paired cancel DB function missing");
has(migration, "source_service_type = 'agent_direct_to_company'", "direct insert policy missing");
lacks(migration, 'INSERT INTO public.payment_splits', "direct transfer migration must not create treasury movement");

console.log("agent-company direct transfer follow-up regression checks passed");
