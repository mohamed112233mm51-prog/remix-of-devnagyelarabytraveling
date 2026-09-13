import { atomicRow, executeFinancialAtomic } from "@/lib/financialAtomic";
import { deriveFinancialOperationUuid } from "@/lib/financialIdempotency";

export const AGENT_COMPANY_DIRECT_SOURCE = "agent_direct_to_company";

type DirectTransferArgs = {
  operationId: string;
  fingerprint: string;
  companyId: string;
  agentId: string;
  date: string;
  currency: string;
  amount: number;
  destination?: string | null;
  serviceType?: string | null;
  statement?: string | null;
  note?: string | null;
};

export async function postAgentCompanyDirectTransfer(args: DirectTransferArgs) {
  const amount = Number(args.amount || 0);
  if (!args.operationId || !args.fingerprint || !args.companyId || !args.agentId || !args.date || !args.currency || !(amount > 0)) {
    return { ok: false as const, error: "بيانات التحويل المباشر بين الوكيل والشركة غير مكتملة" };
  }

  const companyTransactionId = args.operationId;
  const agentTransactionId = deriveFinancialOperationUuid(args.operationId, "agent-company-direct:agent");
  const common = {
    date: args.date,
    destination: args.destination || null,
    service_type: args.serviceType || null,
    note: args.note || null,
    statement: args.statement || null,
    source_service_type: AGENT_COMPANY_DIRECT_SOURCE,
  };

  const companyRow = {
    id: companyTransactionId,
    company_id: args.companyId,
    ...common,
    count: 0,
    price: 0,
    trip_value: 0,
    instapay_amount: 0,
    cash_amount: 0,
    mobile_cash_amount: 0,
    mobile_cash_net_amount: 0,
    arabic_tourism_cash_amount: 0,
    arabic_tourism_cash_net_amount: 0,
    merchant_cash_amount: 0,
    merchant_cash_net_amount: 0,
    merchant_cash_physical_amount: 0,
    total_paid: amount,
    usd_amount: 0,
    currency: args.currency,
    payment_currency: args.currency,
    merchant_id: null,
    source_service_id: agentTransactionId,
  };

  const agentRow = {
    id: agentTransactionId,
    agent_id: args.agentId,
    ...common,
    count: 0,
    price: 0,
    paid: amount,
    payment_method: "دفع مباشر للشركة",
    instapay_amount: 0,
    cash_amount: 0,
    mobile_cash_amount: 0,
    mobile_cash_net_amount: 0,
    arabic_tourism_cash_amount: 0,
    arabic_tourism_cash_net_amount: 0,
    merchant_cash_amount: 0,
    merchant_cash_net_amount: 0,
    merchant_cash_physical_amount: 0,
    total_paid: amount,
    currency: args.currency,
    merchant_id: null,
    source_service_id: companyTransactionId,
  };

  const result = await executeFinancialAtomic({
    operationId: args.operationId,
    fingerprint: args.fingerprint,
    rows: [
      atomicRow("company_transactions", companyRow),
      atomicRow("transactions", agentRow),
    ],
    result: { companyTransactionId, agentTransactionId },
  });

  return { ...result, companyTransactionId, agentTransactionId, companyRow, agentRow };
}
