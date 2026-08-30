import { supabase } from "@/integrations/supabase/client";
import type { ExecutionServiceItem } from "@/lib/db";
import { logCreate } from "@/lib/financialAudit";
import { cairoToday } from "@/lib/approvalFines";
import { confirmFinancialOperation, deriveFinancialOperationUuid, financialOperationFingerprint, getOrCreateFinancialOperationId } from "@/lib/financialIdempotency";

/**
 * Execution financial posting.
 *
 * An execution may carry multiple services for the same customer. For each
 * service we create:
 *  - one agent debt row in `transactions` (total_paid = 0, payment fields = 0)
 *  - one company debt row in `company_transactions` (if a company is set)
 *
 * Both rows are linked back to the execution via
 *   source_service_id   = `${executionId}::${index}`
 *   source_service_type = `execution`
 * so re-posting / cancellation can wipe & rewrite cleanly without touching
 * unrelated rows.
 *
 * Status policy (uses حالة العملية / operation_status — NOT approval status):
 *  - operationStatus === "منفذ" → rows exist
 *  - any other value             → rows are removed
 *
 * Accounting-date policy:
 *  - `executions.financial_posting_date` is set once, when the execution is
 *    first posted as "منفذ", using Africa/Cairo's current calendar date.
 *  - Re-posting after edits keeps that original date.
 *  - `travel_date` remains operational only (travel/archive/FX history) and
 *    never moves the agent/company debt into a future accounting period.
 */

export interface ExecutionPostingInput {
  executionId: string;
  /** حالة العملية (operation_status). Financial posting only happens when "منفذ". */
  operationStatus: string;
  agentId: string | null;
  /** @deprecated Kept for caller compatibility; financial rows use financial_posting_date. */
  date: string | null;
  destination: string | null;
  airline: string | null;
  passengerName: string | null;
  /** ملاحظات التنفيذ — تُنسخ كما هي إلى حركات الوكيل والشركة. */
  executionNotes?: string | null;
  services: ExecutionServiceItem[];
}

/**
 * Returns the immutable accounting date for an executed operation.
 *
 * The compare-and-set update (`is(..., null)`) prevents two concurrent saves
 * from replacing each other's first posting date. The follow-up read handles
 * the race where another request stored the value first.
 */
async function resolveFinancialPostingDate(executionId: string): Promise<string> {
  const { data: current, error: readError } = await (supabase as any)
    .from("executions")
    .select("financial_posting_date")
    .eq("id", executionId)
    .maybeSingle();
  if (readError) throw new Error(`تعذر قراءة تاريخ الاعتماد المالي: ${readError.message}`);
  if (!current) throw new Error("التنفيذ غير موجود");
  return current.financial_posting_date
    ? String(current.financial_posting_date).slice(0, 10)
    : cairoToday();
}


/**
 * Idempotent: removes any previously-posted rows for this execution, then
 * (if status === "منفذ") inserts fresh rows for every service item.
 */
export async function postExecutionFinancials(input: ExecutionPostingInput): Promise<void> {
  const fingerprint = financialOperationFingerprint({
    executionId: input.executionId,
    operationStatus: input.operationStatus,
    agentId: input.agentId,
    destination: input.destination,
    airline: input.airline,
    passengerName: input.passengerName,
    executionNotes: input.executionNotes || null,
    services: input.services,
  });
  const operationId = getOrCreateFinancialOperationId(`execution-financial:${input.executionId}`, fingerprint);

  // A non-executed status means an atomic delete-only replacement. Do not set a
  // new financial posting date merely because the execution was unposted.
  if (input.operationStatus !== "منفذ") {
    const { data, error } = await (supabase as any).rpc("replace_execution_financials_atomic", {
      p_operation_id: operationId,
      p_fingerprint: fingerprint,
      p_execution_id: input.executionId,
      p_financial_posting_date: null,
      p_rows: [],
    });
    if (error || data?.ok !== true) {
      throw new Error(error?.message || data?.error || "تعذر إلغاء قيود التنفيذ المالية");
    }
    confirmFinancialOperation(operationId);
    return;
  }

  const date = await resolveFinancialPostingDate(input.executionId);
  const passenger = input.passengerName?.trim() || null;
  const execNotes = input.executionNotes?.trim() || null;

  const agentRows: any[] = [];
  const companyRows: any[] = [];

  const safeServices = Array.isArray(input.services) ? input.services.filter((s) => s && typeof s === "object") : [];
  safeServices.forEach((s, i) => {
    const linkId = `${input.executionId}::${i}`;
    const count = Math.max(1, Math.round(Number(s.count) || 1));
    const agentPrice = Math.max(0, Number(s.agent_price) || 0);
    const companyPrice = Math.max(0, Number(s.company_price) || 0);
    const explicitCompanyValue = Math.max(0, Number(s.company_value) || 0);
    // قيمة الشركة الفعلية: company_value إن أُدخل، وإلا count × company_price
    const companyValue = explicitCompanyValue > 0 ? explicitCompanyValue : companyPrice * count;
    const kind = s.kind; // "company" | "agent" | undefined (legacy)
    // العملة تُشتق من الخدمة كما جُلبت من ملف التسعير — لا تُستبدل بأي قيمة افتراضية إلا إذا كانت غير موجودة أصلاً.
    const currency = (s.currency && String(s.currency).trim()) ? String(s.currency).trim().toUpperCase() : "EGP";
    const serviceNote = (s.note && String(s.note).trim()) ? String(s.note).trim() : null;
    // الملاحظات على السطر = ملاحظة الخدمة أو ملاحظات التنفيذ أو اسم المسافر — بدون توليد نص.
    const itemNote = serviceNote || execNotes || passenger;

    // ── سطر شركة صادرة فقط (شراء من شركة) ──
    if (kind === "company") {
      if (s.company_id && companyValue > 0) {
        companyRows.push({
        id: deriveFinancialOperationUuid(operationId, `company:${i}`),
          id: deriveFinancialOperationUuid(operationId, `company:${i}`),
          company_id: s.company_id,
          date,
          destination: input.destination ?? undefined,
          service_type: s.service_type,
          count,
          price: companyPrice || (companyValue / count),
          trip_value: companyValue,
          instapay_amount: 0, cash_amount: 0,
          mobile_cash_amount: 0, mobile_cash_net_amount: 0,
          arabic_tourism_cash_amount: 0, arabic_tourism_cash_net_amount: 0,
          merchant_cash_amount: 0, merchant_cash_net_amount: 0, merchant_cash_physical_amount: 0,
          total_paid: 0,
          currency,
          payment_currency: currency,
          note: itemNote,
          source_service_id: linkId,
          source_service_type: "execution",
        });
      }
      return; // لا يُسجَّل أي شيء على الوكيل
    }

    // ── سطر وكيل فقط (بيع للوكيل) ──
    if (kind === "agent") {
      if (input.agentId) {
        agentRows.push({
        id: deriveFinancialOperationUuid(operationId, `agent:${i}`),
          id: deriveFinancialOperationUuid(operationId, `agent:${i}`),
          agent_id: input.agentId,
          date,
          destination: input.destination ?? undefined,
          travel_statement: null,
          service_type: s.service_type,
          count,
          price: agentPrice,
          instapay_amount: 0, cash_amount: 0,
          mobile_cash_amount: 0, mobile_cash_net_amount: 0,
          arabic_tourism_cash_amount: 0, arabic_tourism_cash_net_amount: 0,
          merchant_cash_amount: 0, merchant_cash_net_amount: 0, merchant_cash_physical_amount: 0,
          merchant_id: null,
          payment_method: "نقدي",
          total_paid: 0,
          paid: 0,
          currency,
          note: itemNote,
          source_service_id: linkId,
          source_service_type: "execution",
        });
      }
      return; // لا يُسجَّل أي شيء على الشركة
    }

    // ── سلوك قديم (legacy): سطر واحد يحتوي على وكيل + شركة معًا ──
    const paid = Math.max(0, Number(s.paid_amount) || 0);
    const pm = s.payment_method || "";
    const buckets = {
      instapay_amount: 0, cash_amount: 0,
      mobile_cash_amount: 0, mobile_cash_net_amount: 0,
      arabic_tourism_cash_amount: 0, arabic_tourism_cash_net_amount: 0,
      merchant_cash_amount: 0, merchant_cash_net_amount: 0, merchant_cash_physical_amount: 0,
    };
    if (paid > 0) {
      if (pm === "إنستاباي") buckets.instapay_amount = paid;
      else if (pm === "نقدي") buckets.cash_amount = paid;
      else if (pm === "محفظة") { buckets.mobile_cash_amount = paid; buckets.mobile_cash_net_amount = Math.round(paid - paid * 0.01); }
      else if (pm === "تاجر إنستاباي") buckets.merchant_cash_amount = paid;
      else if (pm === "تاجر محفظة") { buckets.merchant_cash_amount = paid; buckets.merchant_cash_net_amount = Math.round(paid - paid * 0.01); }
      else if (pm === "تاجر نقدي") buckets.merchant_cash_physical_amount = paid;
      else buckets.cash_amount = paid;
    }
    const totalPaid = buckets.instapay_amount + buckets.cash_amount + buckets.mobile_cash_net_amount + buckets.merchant_cash_net_amount + buckets.merchant_cash_physical_amount + (buckets.merchant_cash_amount && !buckets.merchant_cash_net_amount ? buckets.merchant_cash_amount : 0);

    if (input.agentId) {
      agentRows.push({
        id: deriveFinancialOperationUuid(operationId, `agent:${i}`),
        agent_id: input.agentId, date,
        destination: input.destination ?? undefined,
        travel_statement: null,
        service_type: s.service_type, count, price: agentPrice,
        ...buckets,
        merchant_id: s.merchant_id || null,
        payment_method: pm || "نقدي",
        total_paid: totalPaid, paid: totalPaid,
        currency,
        note: itemNote,
        source_service_id: linkId, source_service_type: "execution",
      });
    }
    if (s.company_id && companyValue > 0) {
      companyRows.push({
        id: deriveFinancialOperationUuid(operationId, `company:${i}`),
        company_id: s.company_id, date,
        destination: input.destination ?? undefined,
        service_type: s.service_type,
        count: 1, price: companyValue, trip_value: companyValue,
        instapay_amount: 0, cash_amount: 0,
        mobile_cash_amount: 0, mobile_cash_net_amount: 0,
        arabic_tourism_cash_amount: 0, arabic_tourism_cash_net_amount: 0,
        merchant_cash_amount: 0, merchant_cash_net_amount: 0, merchant_cash_physical_amount: 0,
        total_paid: 0,
        currency,
        payment_currency: currency,
        note: itemNote,
        source_service_id: linkId, source_service_type: "execution",
      });
    }
  });


  const rows = [
    ...agentRows.map((row) => ({ table: "transactions", row })),
    ...companyRows.map((row) => ({ table: "company_transactions", row })),
  ];

  const { data, error } = await (supabase as any).rpc("replace_execution_financials_atomic", {
    p_operation_id: operationId,
    p_fingerprint: fingerprint,
    p_execution_id: input.executionId,
    p_financial_posting_date: date,
    p_rows: rows,
  });
  if (error || data?.ok !== true) {
    throw new Error(error?.message || data?.error || "تعذر اعتماد قيود التنفيذ المالية");
  }

  if (!data?.reused) {
    for (const row of agentRows) {
      try { await logCreate("transactions", row.id, row, "توليد من التنفيذ"); } catch { /* audit only */ }
    }
    for (const row of companyRows) {
      try { await logCreate("company_transactions", row.id, row, "توليد من التنفيذ"); } catch { /* audit only */ }
    }
  }
  confirmFinancialOperation(operationId);
}

export async function deleteExecutionLinkedRows(executionId: string): Promise<void> {
  const fingerprint = financialOperationFingerprint({ executionId, action: "delete-linked-financials" });
  const operationId = getOrCreateFinancialOperationId(`execution-financial-delete:${executionId}`, fingerprint);
  const { data, error } = await (supabase as any).rpc("replace_execution_financials_atomic", {
    p_operation_id: operationId,
    p_fingerprint: fingerprint,
    p_execution_id: executionId,
    p_financial_posting_date: null,
    p_rows: [],
  });
  if (error || data?.ok !== true) throw new Error(error?.message || data?.error || "تعذر حذف قيود التنفيذ المالية");
  confirmFinancialOperation(operationId);
}
