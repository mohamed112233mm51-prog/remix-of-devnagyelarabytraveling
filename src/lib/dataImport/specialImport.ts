import { supabase } from "@/integrations/supabase/client";
import { postMovement, type MovementSplit } from "@/lib/financialEngine";
import { postExecutionFinancials, deleteExecutionLinkedRows } from "@/lib/executionPosting";
import { logCreate } from "@/lib/financialAudit";
import { confirmFinancialOperation, deriveFinancialOperationUuid, ensureFinancialParentRow, financialOperationFingerprint, getOrCreateFinancialOperationId, isLikelyNetworkError } from "@/lib/financialIdempotency";

export type ImportResult = { insertedIds: string[]; failed: number };

type CashBoxRow = {
  id: string;
  currency: string;
  method_key: string | null;
  is_active: boolean;
};

function normalizeCurrency(value: unknown): "EGP" | "USD" | "LYD" {
  const cur = String(value || "EGP").trim().toUpperCase();
  return cur === "USD" || cur === "LYD" ? cur : "EGP";
}

function isInstapay(method: unknown): boolean {
  const s = String(method || "").toLowerCase();
  return s.includes("insta") || s.includes("انستا") || s.includes("إنستا");
}

async function loadCashBoxes(): Promise<CashBoxRow[]> {
  const { data, error } = await supabase
    .from("cash_boxes")
    .select("id,currency,method_key,is_active")
    .eq("is_active", true);
  if (error) throw new Error(`تعذر تحميل الخزائن: ${error.message}`);
  return (data || []) as CashBoxRow[];
}

function resolveCashBox(boxes: CashBoxRow[], currency: "EGP" | "USD" | "LYD", method: string): string | null {
  const byKey = (key: string) => boxes.find((b) => b.method_key === key)?.id || null;
  if (currency === "USD") return byKey("company_usd");
  if (currency === "LYD") return byKey("company_lyd");
  return isInstapay(method) ? byKey("company_instapay") : byKey("company_cash");
}

function buildPaymentSplits(
  row: Record<string, any>,
  boxes: CashBoxRow[],
  direction: "in" | "out",
  totalField: "paid" | "total_paid",
): MovementSplit[] {
  const currency = normalizeCurrency(row.payment_currency || row.currency);
  const splits: MovementSplit[] = [];
  const insta = Math.abs(Number(row.instapay_amount || 0));
  const cash = Math.abs(Number(row.cash_amount || 0));

  const push = (method: string, amount: number) => {
    if (!(amount > 0)) return;
    const cashBoxId = resolveCashBox(boxes, currency, method);
    if (!cashBoxId) {
      throw new Error(`لا توجد خزنة نشطة للعملة ${currency} وطريقة الدفع ${method}`);
    }
    splits.push({ method, currency, cashBoxId, amount, direction });
  };

  push("إنستاباي", insta);
  push("نقدي", cash);

  if (!splits.length) {
    const fallback = Math.abs(Number(row[totalField] || 0));
    if (fallback > 0) push(isInstapay(row.payment_method) ? "إنستاباي" : "نقدي", fallback);
  }
  return splits;
}

function transactionParent(row: Record<string, any>) {
  const currency = normalizeCurrency(row.currency);
  const splitTotal = Math.abs(Number(row.instapay_amount || 0)) + Math.abs(Number(row.cash_amount || 0));
  const paid = splitTotal > 0 ? splitTotal : Math.abs(Number(row.paid || 0));
  return {
    agent_id: row.agent_id,
    date: row.date,
    destination: row.destination || null,
    count: Math.max(0, Math.round(Number(row.count || 0))),
    price: Math.max(0, Number(row.price || 0)),
    paid,
    total_paid: paid,
    payment_method: row.payment_method || (Number(row.instapay_amount || 0) > 0 ? "إنستاباي" : "نقدي"),
    instapay_amount: Math.abs(Number(row.instapay_amount || 0)),
    cash_amount: Math.abs(Number(row.cash_amount || 0)),
    mobile_cash_amount: 0,
    mobile_cash_net_amount: 0,
    arabic_tourism_cash_amount: 0,
    arabic_tourism_cash_net_amount: 0,
    merchant_cash_amount: 0,
    merchant_cash_net_amount: 0,
    merchant_cash_physical_amount: 0,
    merchant_id: row.merchant_id || null,
    service_type: row.service_type || null,
    currency,
    statement: row.statement || null,
    note: row.note || null,
  };
}

function companyParent(row: Record<string, any>) {
  const currency = normalizeCurrency(row.currency);
  const count = Math.max(0, Math.round(Number(row.count || 0)));
  const price = Math.max(0, Number(row.price || 0));
  const tripValue = Math.max(0, Number(row.trip_value || 0)) || count * price;
  const splitTotal = Math.abs(Number(row.instapay_amount || 0)) + Math.abs(Number(row.cash_amount || 0));
  const paid = splitTotal > 0 ? splitTotal : Math.abs(Number(row.total_paid || 0));
  return {
    company_id: row.company_id,
    date: row.date,
    destination: row.destination || null,
    service_type: row.service_type || null,
    count,
    price,
    trip_value: tripValue,
    total_paid: paid,
    instapay_amount: Math.abs(Number(row.instapay_amount || 0)),
    cash_amount: Math.abs(Number(row.cash_amount || 0)),
    mobile_cash_amount: 0,
    mobile_cash_net_amount: 0,
    arabic_tourism_cash_amount: 0,
    arabic_tourism_cash_net_amount: 0,
    merchant_cash_amount: 0,
    merchant_cash_net_amount: 0,
    merchant_cash_physical_amount: 0,
    merchant_id: row.merchant_id || null,
    currency,
    payment_currency: normalizeCurrency(row.payment_currency || currency),
    exchange_rate_used: Number(row.exchange_rate_used || 1) || 1,
    statement: row.statement || null,
    note: row.note || null,
  };
}

export async function importFinancialRows(
  table: "transactions" | "company_transactions",
  rows: Record<string, any>[],
  onProgress: (done: number, total: number) => void,
): Promise<ImportResult> {
  const boxes = await loadCashBoxes();
  const insertedIds: string[] = [];
  let failed = 0;

  // The batch id stays stable only while this exact import is pending. Row IDs
  // are derived from batch + row index, so two intentionally identical Excel
  // rows remain two separate financial operations.
  const batchFingerprint = financialOperationFingerprint({ table, rows });
  const batchOperationId = getOrCreateFinancialOperationId(`financial-import:${table}`, batchFingerprint);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowOperationId = deriveFinancialOperationUuid(batchOperationId, `${table}:row:${i}`);
    let parentId: string | null = null;
    let parentCreatedOrReused = false;
    try {
      const payload = table === "transactions" ? transactionParent(row) : companyParent(row);
      // Validate/resolve every target cash box before creating the parent row.
      const splits = buildPaymentSplits(
        row,
        boxes,
        table === "transactions" ? "in" : "out",
        table === "transactions" ? "paid" : "total_paid",
      );

      const parent = await ensureFinancialParentRow(table, rowOperationId, payload);
      if (parent.error) throw new Error(parent.error);
      parentId = parent.id;
      parentCreatedOrReused = true;

      if (splits.length) {
        const res = await postMovement({
          partyType: table === "transactions" ? "agent" : "company",
          partyId: table === "transactions" ? row.agent_id : row.company_id,
          kind: table === "transactions" ? "receipt" : "payment",
          date: row.date,
          note: row.note || undefined,
          statement: row.statement || undefined,
          sourceTable: table,
          sourceId: parentId,
          transactionId: table === "transactions" ? parentId : undefined,
          splits,
          operationId: rowOperationId,
        });
        if (!res.ok) throw new Error(res.error || "تعذر تسجيل حركة الخزنة");
      }

      if (!parent.reused) {
        try { await logCreate(table, parentId, { ...payload, id: parentId }, "استيراد بيانات"); } catch { /* audit must not invalidate a confirmed financial row */ }
      }
      insertedIds.push(parentId);
    } catch (error) {
      failed++;
      // If the network state is unknown, keep deterministic rows in place.
      // Retrying the same batch will discover them and resume safely.
      if (parentId && parentCreatedOrReused && !isLikelyNetworkError(error)) {
        try {
          const { voidAllForSource } = await import("@/lib/financialEngine");
          await voidAllForSource(table, parentId);
          await (supabase.from(table as any) as any).delete().eq("id", parentId);
        } catch { /* best-effort rollback for definitive validation/server errors */ }
      }
    }
    onProgress(i + 1, rows.length);
    await new Promise((r) => setTimeout(r, 0));
  }

  if (failed === 0) confirmFinancialOperation(batchOperationId);
  return { insertedIds, failed };
}

function executionCore(row: Record<string, any>, services: any[]) {
  return {
    passenger_name: String(row.passenger_name || "").trim(),
    national_id: row.national_id || null,
    dob: row.dob || null,
    passport: row.passport || null,
    birth_place: row.birth_place || null,
    agent_id: row.agent_id || null,
    status: row.status || "",
    operation_status: row.operation_status || "",
    departure_from: row.departure_from || null,
    destination: row.destination || null,
    airline: row.airline || null,
    travel_date: row.travel_date || null,
    notes: row.notes || null,
    approval_company_id: row.approval_company_id || null,
    passenger_type: row.passenger_type || null,
    issue_date: row.issue_date || null,
    approval_validity_enabled: !!row.approval_validity_enabled,
    services,
  };
}

function serviceFromRow(row: Record<string, any>) {
  const rawKind = String(row._service_kind || "").trim();
  const serviceType = String(row._service_type || "").trim();
  // The simplified execution template has no service/pricing columns.
  // In that case the execution is imported with an empty services array.
  if (!rawKind && !serviceType) return null;

  const isCompany = rawKind.includes("شركة") || rawKind.toLowerCase() === "company";
  const isAgent = rawKind.includes("وكيل") || rawKind.toLowerCase() === "agent";
  if (!isCompany && !isAgent) throw new Error(`طرف الخدمة غير صحيح: ${rawKind}`);
  const common = {
    kind: isCompany ? "company" as const : "agent" as const,
    service_type: serviceType,
    count: Math.max(1, Math.round(Number(row._service_count || 1))),
    currency: normalizeCurrency(row._service_currency),
    note: row._service_note || null,
  };
  if (isCompany) {
    if (!row._service_company_id) throw new Error("شركة الخدمة مطلوبة لسطر خدمة الشركة");
    return {
      ...common,
      company_id: row._service_company_id,
      company_price: Math.max(0, Number(row._company_price || 0)),
      company_value: Math.max(0, Number(row._company_value || 0)),
    };
  }
  return { ...common, agent_price: Math.max(0, Number(row._agent_price || 0)) };
}

export async function importExecutionRows(
  rows: Record<string, any>[],
  onProgress: (done: number, total: number) => void,
): Promise<ImportResult> {
  const groups = new Map<string, Record<string, any>[]>();
  rows.forEach((row, index) => {
    // Legacy files may still carry an explicit import group. New simplified
    // files do not, so every row gets its own internal group automatically.
    const explicitKey = String(row._import_group || "").trim();
    const key = explicitKey || `__row_${index}`;
    const list = groups.get(key) || [];
    list.push(row);
    groups.set(key, list);
  });

  const entries = Array.from(groups.entries());
  const insertedIds: string[] = [];
  let failed = 0;

  for (let i = 0; i < entries.length; i++) {
    const [, groupRows] = entries[i];
    let executionId: string | null = null;
    try {
      const first = groupRows[0];
      const identity = `${first.passenger_name || ""}|${first.passport || ""}|${first.national_id || ""}|${first.agent_id || ""}`;
      const inconsistent = groupRows.some((r) =>
        `${r.passenger_name || ""}|${r.passport || ""}|${r.national_id || ""}|${r.agent_id || ""}` !== identity,
      );
      if (inconsistent) throw new Error("بيانات المسافر غير متطابقة داخل نفس كود التنفيذ");

      const services = groupRows.map(serviceFromRow).filter((service): service is NonNullable<typeof service> => service !== null);
      const payload = executionCore(first, services);
      const { data, error } = await supabase.from("executions").insert(payload as any).select("id").single();
      if (error || !data?.id) throw new Error(error?.message || "تعذر إنشاء التنفيذ");
      executionId = String(data.id);

      await postExecutionFinancials({
        executionId,
        operationStatus: payload.operation_status,
        agentId: payload.agent_id,
        date: payload.travel_date,
        destination: payload.destination,
        airline: payload.airline,
        passengerName: payload.passenger_name,
        executionNotes: payload.notes,
        services: services as any,
      });

      if (payload.operation_status === "منفذ" && services.length > 0) {
        try {
          const { data: exRow } = await supabase
            .from("executions")
            .select("id,travel_date,created_at,operation_status,services,fx_locks,fx_locked_at")
            .eq("id", executionId)
            .maybeSingle();
          if (exRow) {
            const { ensureExecutionFxLocks } = await import("@/lib/executionProfit");
            await ensureExecutionFxLocks(supabase as any, exRow as any);
          }
        } catch { /* FX lock stays pending exactly like normal execution flow */ }
      }

      insertedIds.push(executionId);
    } catch {
      failed++;
      if (executionId) {
        try { await deleteExecutionLinkedRows(executionId); } catch {}
        try { await supabase.from("executions").delete().eq("id", executionId); } catch {}
      }
    }
    onProgress(i + 1, entries.length);
    await new Promise((r) => setTimeout(r, 0));
  }

  return { insertedIds, failed };
}