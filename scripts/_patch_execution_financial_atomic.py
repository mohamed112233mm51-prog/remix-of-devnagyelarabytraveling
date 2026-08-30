from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "src/lib/executionPosting.ts"
text = PATH.read_text(encoding="utf-8")

# Imports
text = text.replace(
    'import { cairoToday } from "@/lib/approvalFines";\n',
    'import { cairoToday } from "@/lib/approvalFines";\nimport { confirmFinancialOperation, deriveFinancialOperationUuid, financialOperationFingerprint, getOrCreateFinancialOperationId } from "@/lib/financialIdempotency";\n',
    1,
)

# Read-only date resolver: persistence now happens inside the DB transaction.
start = text.find('async function resolveFinancialPostingDate(')
end = text.find('\nasync function deleteLinked(', start)
if start < 0 or end < 0:
    raise RuntimeError("execution date resolver not found")
new_date = '''async function resolveFinancialPostingDate(executionId: string): Promise<string> {
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
'''
text = text[:start] + new_date + text[end:]

# Replace posting function completely, keeping row-building logic mostly intact.
start = text.find('export async function postExecutionFinancials(')
end = text.find('\nexport async function deleteExecutionLinkedRows(', start)
if start < 0 or end < 0:
    raise RuntimeError("execution posting function not found")
old = text[start:end]

# Pull the original body row-construction core between passenger setup and inserts.
body_start = old.find('  const passenger =')
rows_end = old.find('\n  if (agentRows.length) {')
if body_start < 0 or rows_end < 0:
    raise RuntimeError("execution row builder core not found")
row_builder = old[body_start:rows_end]

# Add stable IDs to every pushed parent row by targeted push markers.
row_builder = row_builder.replace(
    '        companyRows.push({\n',
    '        companyRows.push({\n          id: deriveFinancialOperationUuid(operationId, `company:${i}`),\n',
)
row_builder = row_builder.replace(
    '        agentRows.push({\n',
    '        agentRows.push({\n          id: deriveFinancialOperationUuid(operationId, `agent:${i}`),\n',
)
# Legacy pushes use less indentation.
row_builder = row_builder.replace(
    '      agentRows.push({\n',
    '      agentRows.push({\n        id: deriveFinancialOperationUuid(operationId, `agent:${i}`),\n',
)
row_builder = row_builder.replace(
    '      companyRows.push({\n',
    '      companyRows.push({\n        id: deriveFinancialOperationUuid(operationId, `company:${i}`),\n',
)

new_func = '''export async function postExecutionFinancials(input: ExecutionPostingInput): Promise<void> {
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
''' + row_builder + '''

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
'''
text = text[:start] + new_func + text[end:]

# Make the explicit delete helper atomic as well, using its own retry-safe op.
old_delete = '''export async function deleteExecutionLinkedRows(executionId: string): Promise<void> {
  await deleteLinked(executionId);
}'''
new_delete = '''export async function deleteExecutionLinkedRows(executionId: string): Promise<void> {
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
}'''
if old_delete not in text:
    raise RuntimeError("deleteExecutionLinkedRows marker not found")
text = text.replace(old_delete, new_delete, 1)

# deleteLinked is no longer used by public financial posting paths.
start = text.find('async function deleteLinked(')
end = text.find('\n/**\n * Idempotent:', start)
if start >= 0 and end >= 0:
    text = text[:start] + text[end:]

PATH.write_text(text, encoding="utf-8")
print("execution financial posting converted to atomic replacement")
