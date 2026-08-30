import { supabase } from "@/integrations/supabase/client";
import { logCreate } from "@/lib/financialAudit";

/**
 * Service financial posting helpers.
 *
 * When a service (flight / approval / libyan investment) is submitted from
 * "تقديم خدمة", we automatically post:
 *   - a debt row on the selected AGENT (public.transactions, total_paid = 0)
 *   - a debt row on the selected ISSUING COMPANY (public.company_transactions)
 *
 * Both rows store source_service_id + source_service_type so future edits
 * keep them in sync (UPDATE by source_service_id) and deletes can reverse.
 *
 * IMPORTANT: The agent statement (كشف حساب الوكيل) layout / calculations
 * MUST remain identical. We only INSERT rows shaped exactly like manual
 * transactions, so the existing statement renders them with zero changes.
 */

export type ServiceKind = "flight_ticket" | "security_approval" | "libyan_investment";

const SERVICE_LABEL_AR: Record<ServiceKind, string> = {
  flight_ticket: "تذاكر طيران",
  security_approval: "موافقة أمنية",
  libyan_investment: "استثمار ليبي",
};

export interface ServicePostingInput {
  serviceId: string;
  serviceKind: ServiceKind;
  agentId: string | null;
  companyId: string | null;
  date: string | null;           // travel_date or fallback (yyyy-mm-dd)
  destination: string | null;
  travelStatement: string | null;
  passengerName: string | null;
  count: number;                 // agent: trip count
  price: number;                 // agent: unit price
  companyValue: number;          // company-side debt amount
}

function safeDate(d: string | null | undefined): string {
  if (d && typeof d === "string" && d.length >= 8) return d;
  return new Date().toISOString().slice(0, 10);
}

function agentRow(input: ServicePostingInput & { agentId: string }) {
  const count = Math.max(1, Math.round(Number(input.count) || 1));
  const price = Math.max(0, Number(input.price) || 0);
  return {
    agent_id: input.agentId,
    date: safeDate(input.date),
    destination: input.destination ?? undefined,
    travel_statement: null,
    service_type: SERVICE_LABEL_AR[input.serviceKind],
    count,
    price,
    instapay_amount: 0,
    cash_amount: 0,
    mobile_cash_amount: 0,
    mobile_cash_net_amount: 0,
    arabic_tourism_cash_amount: 0,
    arabic_tourism_cash_net_amount: 0,
    merchant_cash_amount: 0,
    merchant_cash_net_amount: 0,
    merchant_cash_physical_amount: 0,
    merchant_id: undefined,
    total_paid: 0,
    paid: 0,
    note: input.passengerName ?? undefined,
    source_service_id: input.serviceId,
    source_service_type: input.serviceKind,
  };
}

function companyRow(input: ServicePostingInput & { companyId: string }) {
  const value = Math.max(0, Number(input.companyValue) || 0);
  return {
    company_id: input.companyId,
    date: safeDate(input.date),
    destination: input.destination ?? undefined,
    service_type: SERVICE_LABEL_AR[input.serviceKind],
    count: 1,
    price: value,
    trip_value: value,
    instapay_amount: 0,
    cash_amount: 0,
    mobile_cash_amount: 0,
    mobile_cash_net_amount: 0,
    arabic_tourism_cash_amount: 0,
    arabic_tourism_cash_net_amount: 0,
    merchant_cash_amount: 0,
    merchant_cash_net_amount: 0,
    merchant_cash_physical_amount: 0,
    merchant_id: undefined,
    total_paid: 0,
    note: input.passengerName ?? undefined,
    source_service_id: input.serviceId,
    source_service_type: input.serviceKind,
  };
}

/**
 * Synchronize both accounting sides of one service in ONE PostgreSQL
 * transaction. Updates preserve existing payment fields; company debt is
 * removed atomically if companyValue becomes zero.
 */
async function syncService(input: ServicePostingInput, deleting = false): Promise<any> {
  const agent = !deleting && input.agentId
    ? agentRow({ ...input, agentId: input.agentId })
    : null;
  const company = !deleting && input.companyId && Number(input.companyValue) > 0
    ? companyRow({ ...input, companyId: input.companyId })
    : null;

  const { data, error } = await (supabase as any).rpc("sync_service_financials_atomic", {
    p_service_id: input.serviceId,
    p_agent_row: agent,
    p_company_row: company,
    p_delete: deleting,
  });
  if (error || data?.ok !== true) {
    const message = String(error?.message || data?.error || "تعذر مزامنة قيود الخدمة المالية");
    const missingRpc = String((error as any)?.code || "") === "PGRST202" || message.toLowerCase().includes("schema cache");
    throw new Error(missingRpc ? "تم إيقاف العملية بدون تسجيل أي طرف: تحديث قيود الخدمات الذري غير مُطبق على قاعدة البيانات بعد." : message);
  }
  return data;
}

/** Called after INSERT of a new service record. Creates both debt rows atomically. */
export async function postServiceFinancials(input: ServicePostingInput): Promise<void> {
  const data = await syncService(input, false);
  try {
    if (data?.agentTransactionId && input.agentId) {
      await logCreate("transactions", data.agentTransactionId, { ...agentRow({ ...input, agentId: input.agentId }), id: data.agentTransactionId }, "توليد من تقديم خدمة");
    }
    if (data?.companyTransactionId && input.companyId && Number(input.companyValue) > 0) {
      await logCreate("company_transactions", data.companyTransactionId, { ...companyRow({ ...input, companyId: input.companyId }), id: data.companyTransactionId }, "توليد من تقديم خدمة");
    }
  } catch { /* audit is non-financial */ }
}

/** Called when a service is edited. Both accounting sides change atomically. */
export async function updateServiceFinancials(input: ServicePostingInput): Promise<void> {
  await syncService(input, false);
}

/** Reverse / remove both financial rows linked to a deleted service atomically. */
export async function deleteServiceLinkedRows(serviceId: string): Promise<void> {
  await syncService({
    serviceId,
    serviceKind: "flight_ticket",
    agentId: null,
    companyId: null,
    date: null,
    destination: null,
    travelStatement: null,
    passengerName: null,
    count: 1,
    price: 0,
    companyValue: 0,
  }, true);
}
