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

/** Bulk reconciliation uses the same atomic execution save as the main form. */
export async function executeExistingExecution(executionId: string) {
  return executeExistingExecutionCore<ExecutionSnapshot>(executionId, {
    loadExecution,
    saveWithFinancials: async (current) => {
      const saved = await postExecutionFinancials({
        executionId: current.id,
        expectedExecution: current,
        executionPatch: { operation_status: "منفذ" },
        refresh: false,
      });
      return saved.execution as ExecutionSnapshot;
    },
    lockFxBestEffort: async (execution) => {
      await ensureExecutionFxLocks(supabase as any, execution as any);
    },
  });
}
