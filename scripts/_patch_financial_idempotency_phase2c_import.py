from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
path = ROOT / "src/lib/dataImport/specialImport.ts"
text = path.read_text(encoding="utf-8")

old_import = 'import { logCreate } from "@/lib/financialAudit";\n'
new_import = old_import + 'import { confirmFinancialOperation, deriveFinancialOperationUuid, ensureFinancialParentRow, financialOperationFingerprint, getOrCreateFinancialOperationId, isLikelyNetworkError } from "@/lib/financialIdempotency";\n'
if text.count(old_import) != 1:
    raise RuntimeError(f"financial import helper import expected once, found {text.count(old_import)}")
text = text.replace(old_import, new_import, 1)

start = text.find('export async function importFinancialRows(')
end_marker = '\n}\n\nfunction executionCore('
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise RuntimeError("importFinancialRows block not found")

new_func = '''export async function importFinancialRows(
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
}'''

text = text[:start] + new_func + text[end:]
path.write_text(text, encoding="utf-8")
print("financial import idempotency patch applied")
