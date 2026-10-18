export type BulkExecutionSnapshot = {
  id: string;
  operation_status?: string | null;
};

export type BulkExecutionCoreResult = {
  executionId: string;
  status: "executed" | "already_executed";
};

export type BulkExecutionCoreDeps<TExecution extends BulkExecutionSnapshot> = {
  loadExecution: (executionId: string) => Promise<TExecution | null>;
  saveWithFinancials: (execution: TExecution) => Promise<TExecution>;
  lockFxBestEffort?: (execution: TExecution) => Promise<void>;
};

const CANCELLED_STATUSES = new Set(["ملغي", "ملغية", "ملغى", "محذوف"]);

export async function executeExistingExecutionCore<TExecution extends BulkExecutionSnapshot>(
  executionId: string,
  deps: BulkExecutionCoreDeps<TExecution>,
): Promise<BulkExecutionCoreResult> {
  const current = await deps.loadExecution(executionId);
  if (!current) throw new Error("التنفيذ غير موجود");

  const previousStatus = String(current.operation_status || "").trim();
  if (previousStatus === "منفذ") {
    return { executionId, status: "already_executed" };
  }
  if (CANCELLED_STATUSES.has(previousStatus)) {
    throw new Error("لا يمكن تنفيذ عملية ملغية من شاشة المطابقة");
  }

  // Status and generated debts commit together in the canonical save RPC.
  const updated = await deps.saveWithFinancials(current);

  if (deps.lockFxBestEffort) {
    try {
      await deps.lockFxBestEffort(updated);
    } catch {
      // Same policy as the existing single-execution save flow: FX locking is
      // best-effort and never reverses a successfully posted execution.
    }
  }

  return { executionId, status: "executed" };
}
