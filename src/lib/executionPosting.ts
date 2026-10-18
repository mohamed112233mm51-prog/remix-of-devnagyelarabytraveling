import { supabase } from "@/integrations/supabase/client";
import { buildExecutionFinancialRows } from "@/lib/executionPostingRows";
import {
  confirmFinancialOperation,
  deriveFinancialOperationUuid,
  financialOperationFingerprint,
  getOrCreateFinancialOperationId,
} from "@/lib/financialIdempotency";
import { refetchCompleteFinancialTables } from "@/hooks/useCompleteFinancialTables";
import { refetchLiveTables } from "@/lib/db";

// Ignore independent, best-effort FX locking when detecting stale execution edits.
// All operational fields, prices, service allocation and first posting date remain checked.
function expectedSnapshot(row?: object) {
  if (!row) return null;
  const { updated_at, fx_locks, fx_locked_at, ...snapshot } = row as Record<
    string,
    any
  >;
  return snapshot;
}

async function refreshExecutionTables() {
  try {
    await Promise.all([
      refetchCompleteFinancialTables([
        "executions",
        "transactions",
        "company_transactions",
      ]),
      refetchLiveTables(["submissions"]),
    ]);
  } catch (error) {
    console.warn("[execution] committed; refresh failed", error);
  }
}

/**
 * Save the canonical execution AND replace its generated debts in the existing
 * replace_execution_financials_atomic RPC. There is no direct-write fallback.
 * The first financial date is chosen/preserved by the database, separately from
 * creation/travel dates. Existing FX locking remains a best-effort follow-up.
 */
export async function postExecutionFinancials(input: {
  executionId?: string;
  executionPatch: Record<string, any>;
  expectedExecution?: object;
  refresh?: boolean;
}): Promise<{
  executionId: string;
  execution: Record<string, any>;
  reused: boolean;
}> {
  if (input.executionId && !input.expectedExecution)
    throw new Error("بيانات التنفيذ الأصلية مطلوبة للتعديل");
  const expected = input.executionId
    ? expectedSnapshot(input.expectedExecution)
    : null;
  const execution = { ...expected, ...input.executionPatch };
  const fingerprint = financialOperationFingerprint({
    action: "save",
    executionId: input.executionId || null,
    patch: input.executionPatch,
    expected,
  });
  const operationId = getOrCreateFinancialOperationId(
    `execution-save:${input.executionId || "new"}`,
    fingerprint,
  );
  const executionId =
    input.executionId || deriveFinancialOperationUuid(operationId, "execution");
  const rows =
    execution.operation_status === "منفذ"
      ? buildExecutionFinancialRows(
          {
            executionId,
            operationStatus: execution.operation_status,
            agentId: execution.agent_id || null,
            date: null,
            destination: execution.destination || null,
            airline: execution.airline || null,
            passengerName: execution.passenger_name || null,
            executionNotes: execution.notes || null,
            services: Array.isArray(execution.services)
              ? execution.services
              : [],
          },
          (key) => deriveFinancialOperationUuid(operationId, key),
        )
      : [];
  const { data, error } = await (supabase as any).rpc(
    "replace_execution_financials_atomic",
    {
      p_operation_id: operationId,
      p_fingerprint: fingerprint,
      p_execution_id: executionId,
      p_financial_posting_date: null,
      p_rows: {
        action: input.executionId ? "update" : "create",
        execution_patch: input.executionPatch,
        expected,
        rows,
      },
    },
  );
  if (error || data?.ok !== true)
    throw new Error(
      error?.message || data?.error || "تعذر حفظ التنفيذ وقيوده المالية معًا",
    );
  confirmFinancialOperation(operationId);
  if (input.refresh !== false) await refreshExecutionTables();
  return {
    executionId,
    execution: data.result.execution,
    reused: !!data.reused,
  };
}

/** Delete the execution and its linked debts atomically through the SAME RPC. */
export async function deleteExecutionWithFinancials(
  executionId: string,
  expectedExecution?: object,
  options?: { refresh?: boolean },
): Promise<void> {
  let expected = expectedSnapshot(expectedExecution);
  if (!expected) {
    const { data, error } = await supabase
      .from("executions")
      .select("*")
      .eq("id", executionId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return; // Re-running an import undo may include an already removed execution.
    expected = expectedSnapshot(data);
  }
  const fingerprint = financialOperationFingerprint({
    action: "delete",
    executionId,
    expected,
  });
  const operationId = getOrCreateFinancialOperationId(
    `execution-delete:${executionId}`,
    fingerprint,
  );
  const { data, error } = await (supabase as any).rpc(
    "replace_execution_financials_atomic",
    {
      p_operation_id: operationId,
      p_fingerprint: fingerprint,
      p_execution_id: executionId,
      p_financial_posting_date: null,
      p_rows: { action: "delete", expected, execution_patch: {}, rows: [] },
    },
  );
  if (error || data?.ok !== true)
    throw new Error(
      error?.message || data?.error || "تعذر حذف التنفيذ وقيوده المالية معًا",
    );
  confirmFinancialOperation(operationId);
  if (options?.refresh !== false) await refreshExecutionTables();
}
