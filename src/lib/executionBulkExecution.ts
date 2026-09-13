import { supabase } from "@/integrations/supabase/client";
import type { Execution } from "@/lib/db";
import { postExecutionFinancials } from "@/lib/executionPosting";
import { ensureExecutionFxLocks } from "@/lib/executionProfit";
import {
  executeExistingExecutionCore,
  type BulkExecutionSnapshot,
} from "@/lib/executionBulkExecutionCore";

type ExecutionSnapshot = Execution & BulkExecutionSnapshot & {
  fx_locks?: Record<string, number> | null;
  fx_locked_at?: string | null;
  financial_posting_date?: string | null;
};

async function loadExecution(executionId: string): Promise<ExecutionSnapshot | null> {
  const { data, error } = await (supabase as any)
    .from("executions")
    .select("*")
    .eq("id", executionId)
    .maybeSingle();
  if (error) throw new Error(error.message || "تعذر تحميل التنفيذ");
  return (data || null) as ExecutionSnapshot | null;
}

async function setOperationStatus(
  executionId: string,
  nextStatus: string,
  expectedCurrentStatus: string | null,
): Promise<ExecutionSnapshot> {
  let query = (supabase as any)
    .from("executions")
    .update({ operation_status: nextStatus })
    .eq("id", executionId);

  query = expectedCurrentStatus == null
    ? query.is("operation_status", null)
    : query.eq("operation_status", expectedCurrentStatus);

  const { data, error } = await query.select("*").maybeSingle();
  if (error) throw new Error(error.message || "تعذر تحديث حالة التنفيذ");
  if (!data) throw new Error("تم تعديل حالة هذا التنفيذ بواسطة مستخدم آخر؛ أعد المطابقة ثم حاول مرة أخرى");
  return data as ExecutionSnapshot;
}

async function postCanonicalFinancials(execution: ExecutionSnapshot): Promise<void> {
  await postExecutionFinancials({
    executionId: execution.id,
    operationStatus: execution.operation_status || "",
    agentId: execution.agent_id || null,
    date: execution.travel_date || null,
    destination: execution.destination || null,
    airline: execution.airline || null,
    passengerName: execution.passenger_name || null,
    executionNotes: execution.notes || null,
    services: Array.isArray(execution.services) ? execution.services : [],
  });
}

/**
 * Bulk reconciliation adapter for ONE existing execution.
 *
 * It deliberately does not reproduce any accounting rules. The status change
 * is guarded against concurrent edits, and all money posting goes through the
 * existing `postExecutionFinancials` function / atomic RPC. If that canonical
 * posting fails, the operation status is compare-and-set back to its prior
 * value so the UI cannot leave a "منفذ" row without its financial effect.
 */
export async function executeExistingExecution(executionId: string) {
  return executeExistingExecutionCore<ExecutionSnapshot>(executionId, {
    loadExecution,
    setOperationStatus,
    postFinancials: postCanonicalFinancials,
    lockFxBestEffort: async (execution) => {
      await ensureExecutionFxLocks(supabase as any, execution as any);
    },
  });
}
