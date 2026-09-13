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
  setOperationStatus: (
    executionId: string,
    nextStatus: string,
    expectedCurrentStatus: string | null,
  ) => Promise<TExecution>;
  postFinancials: (execution: TExecution) => Promise<void>;
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

  let updated: TExecution | null = null;
  try {
    updated = await deps.setOperationStatus(executionId, "منفذ", current.operation_status ?? null);
    await deps.postFinancials(updated);
  } catch (error) {
    if (updated) {
      try {
        await deps.setOperationStatus(executionId, current.operation_status || "", "منفذ");
      } catch {
        // Preserve the original posting error. The adapter uses a guarded
        // compare-and-set rollback so a concurrent change is never overwritten.
      }
    }
    throw error;
  }

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
