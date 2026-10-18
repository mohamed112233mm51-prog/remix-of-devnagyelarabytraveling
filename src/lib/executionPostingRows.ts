import type { ExecutionServiceItem } from "@/lib/db";

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

/** Existing execution debt rules, shared by every save caller. Dates are assigned by the DB. */
export function buildExecutionFinancialRows(
  input: ExecutionPostingInput,
  childId: (key: string) => string,
) {
  const passenger = input.passengerName?.trim() || null;
  const execNotes = input.executionNotes?.trim() || null;

  const agentRows: any[] = [];
  const companyRows: any[] = [];

  const safeServices = Array.isArray(input.services)
    ? input.services.filter((s) => s && typeof s === "object")
    : [];
  safeServices.forEach((s, i) => {
    const linkId = `${input.executionId}::${i}`;
    const count = Math.max(1, Math.round(Number(s.count) || 1));
    const agentPrice = Math.max(0, Number(s.agent_price) || 0);
    const companyPrice = Math.max(0, Number(s.company_price) || 0);
    const explicitCompanyValue = Math.max(0, Number(s.company_value) || 0);
    // قيمة الشركة الفعلية: company_value إن أُدخل، وإلا count × company_price
    const companyValue =
      explicitCompanyValue > 0 ? explicitCompanyValue : companyPrice * count;
    const kind = s.kind; // "company" | "agent" | undefined (legacy)
    // العملة تُشتق من الخدمة كما جُلبت من ملف التسعير — لا تُستبدل بأي قيمة افتراضية إلا إذا كانت غير موجودة أصلاً.
    const currency =
      s.currency && String(s.currency).trim()
        ? String(s.currency).trim().toUpperCase()
        : "EGP";
    const serviceNote =
      s.note && String(s.note).trim() ? String(s.note).trim() : null;
    // الملاحظات على السطر = ملاحظة الخدمة أو ملاحظات التنفيذ أو اسم المسافر — بدون توليد نص.
    const itemNote = serviceNote || execNotes || passenger;

    // ── سطر شركة صادرة فقط (شراء من شركة) ──
    if (kind === "company") {
      if (s.company_id && companyValue > 0) {
        companyRows.push({
          id: childId(`company:${i}`),
          company_id: s.company_id,
          date: null,
          destination: input.destination ?? undefined,
          service_type: s.service_type,
          count,
          price: companyPrice || companyValue / count,
          trip_value: companyValue,
          instapay_amount: 0,
          cash_amount: 0,
          mobile_cash_amount: 0,
          mobile_cash_net_amount: 0,
          arabic_tourism_cash_amount: 0,
          arabic_tourism_cash_net_amount: 0,
          merchant_cash_amount: 0,
          merchant_cash_net_amount: 0,
          merchant_cash_physical_amount: 0,
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
      if (input.agentId && agentPrice > 0) {
        agentRows.push({
          id: childId(`agent:${i}`),
          agent_id: input.agentId,
          date: null,
          destination: input.destination ?? undefined,
          travel_statement: null,
          service_type: s.service_type,
          count,
          price: agentPrice,
          instapay_amount: 0,
          cash_amount: 0,
          mobile_cash_amount: 0,
          mobile_cash_net_amount: 0,
          arabic_tourism_cash_amount: 0,
          arabic_tourism_cash_net_amount: 0,
          merchant_cash_amount: 0,
          merchant_cash_net_amount: 0,
          merchant_cash_physical_amount: 0,
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
      instapay_amount: 0,
      cash_amount: 0,
      mobile_cash_amount: 0,
      mobile_cash_net_amount: 0,
      arabic_tourism_cash_amount: 0,
      arabic_tourism_cash_net_amount: 0,
      merchant_cash_amount: 0,
      merchant_cash_net_amount: 0,
      merchant_cash_physical_amount: 0,
    };
    if (paid > 0) {
      if (pm === "إنستاباي") buckets.instapay_amount = paid;
      else if (pm === "نقدي") buckets.cash_amount = paid;
      else if (pm === "محفظة") {
        buckets.mobile_cash_amount = paid;
        buckets.mobile_cash_net_amount = Math.round(paid - paid * 0.01);
      } else if (pm === "تاجر إنستاباي") buckets.merchant_cash_amount = paid;
      else if (pm === "تاجر محفظة") {
        buckets.merchant_cash_amount = paid;
        buckets.merchant_cash_net_amount = Math.round(paid - paid * 0.01);
      } else if (pm === "تاجر نقدي")
        buckets.merchant_cash_physical_amount = paid;
      else buckets.cash_amount = paid;
    }
    const totalPaid =
      buckets.instapay_amount +
      buckets.cash_amount +
      buckets.mobile_cash_net_amount +
      buckets.merchant_cash_net_amount +
      buckets.merchant_cash_physical_amount +
      (buckets.merchant_cash_amount && !buckets.merchant_cash_net_amount
        ? buckets.merchant_cash_amount
        : 0);

    if (input.agentId) {
      agentRows.push({
        id: childId(`agent:${i}`),
        agent_id: input.agentId,
        date: null,
        destination: input.destination ?? undefined,
        travel_statement: null,
        service_type: s.service_type,
        count,
        price: agentPrice,
        ...buckets,
        merchant_id: s.merchant_id || null,
        payment_method: pm || "نقدي",
        total_paid: totalPaid,
        paid: totalPaid,
        currency,
        note: itemNote,
        source_service_id: linkId,
        source_service_type: "execution",
      });
    }
    if (s.company_id && companyValue > 0) {
      companyRows.push({
        id: childId(`company:${i}`),
        company_id: s.company_id,
        date: null,
        destination: input.destination ?? undefined,
        service_type: s.service_type,
        count: 1,
        price: companyValue,
        trip_value: companyValue,
        instapay_amount: 0,
        cash_amount: 0,
        mobile_cash_amount: 0,
        mobile_cash_net_amount: 0,
        arabic_tourism_cash_amount: 0,
        arabic_tourism_cash_net_amount: 0,
        merchant_cash_amount: 0,
        merchant_cash_net_amount: 0,
        merchant_cash_physical_amount: 0,
        total_paid: 0,
        currency,
        payment_currency: currency,
        note: itemNote,
        source_service_id: linkId,
        source_service_type: "execution",
      });
    }
  });

  return [
    ...agentRows.map((row) => ({ table: "transactions", row })),
    ...companyRows.map((row) => ({ table: "company_transactions", row })),
  ];
}
