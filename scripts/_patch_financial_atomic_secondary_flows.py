from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# Investor parent + treasury split in one transaction.
path = ROOT / "src/routes/investors.tsx"
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    'import { confirmFinancialOperation, ensureFinancialParentRow, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
    'import { confirmFinancialOperation, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
    "investor remove parent helper",
)
parent_start = text.find('    const parent = await ensureFinancialParentRow("investor_transactions", operationId, {')
move_end = text.find('\n    if (!movement.ok) {', parent_start)
if parent_start < 0 or move_end < 0:
    raise RuntimeError("investor multi-write block not found")
old_segment = text[parent_start:move_end]
# Extract the payload literally from current code by replacing the known whole block.
new_segment = '''    const parentPayload = {
      investor_id: form.investor_id,
      transaction_type: kind,
      date: form.date,
      amount,
      payment_method: selectedBox.name,
      note: form.note.trim() ? form.note.trim() : null,
      statement: form.statement.trim() ? form.statement.trim() : null,
    };
    const movement = await postMovement({
      partyType: "investor",
      partyId: form.investor_id,
      kind: kind === "توريد نقدية" ? "receipt" : "payment",
      date: form.date,
      note: form.note.trim() || undefined,
      statement: form.statement.trim() || undefined,
      operationId,
      atomicFingerprint: fingerprint,
      atomicParent: {
        table: "investor_transactions",
        id: operationId,
        payload: parentPayload,
      },
      splits: [{
        method: selectedBox.name,
        currency: normalizeCurrency(selectedBox.currency) as "EGP" | "USD" | "LYD",
        cashBoxId: selectedBox.id,
        amount,
        direction: kind === "توريد نقدية" ? "in" : "out",
      }],
    });'''
text = text[:parent_start] + new_segment + text[move_end:]
path.write_text(text, encoding="utf-8")


# Financial import: every imported parent + its treasury rows commit in one RPC.
path = ROOT / "src/lib/dataImport/specialImport.ts"
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    'import { confirmFinancialOperation, deriveFinancialOperationUuid, ensureFinancialParentRow, financialOperationFingerprint, getOrCreateFinancialOperationId, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
    'import { confirmFinancialOperation, deriveFinancialOperationUuid, financialOperationFingerprint, getOrCreateFinancialOperationId } from "@/lib/financialIdempotency";\nimport { atomicRow, executeFinancialAtomic } from "@/lib/financialAtomic";\n',
    "import atomic imports",
)
func_start = text.find('export async function importFinancialRows(')
func_end = text.find('\nfunction executionCore(', func_start)
if func_start < 0 or func_end < 0:
    raise RuntimeError("importFinancialRows function not found")
new_func = '''export async function importFinancialRows(
  table: "transactions" | "company_transactions",
  rows: Record<string, any>[],
  onProgress: (done: number, total: number) => void,
): Promise<ImportResult> {
  const boxes = await loadCashBoxes();
  const insertedIds: string[] = [];
  let failed = 0;

  const batchFingerprint = financialOperationFingerprint({ table, rows });
  const batchOperationId = getOrCreateFinancialOperationId(`financial-import:${table}`, batchFingerprint);

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowOperationId = deriveFinancialOperationUuid(batchOperationId, `${table}:row:${i}`);
    try {
      const payload = table === "transactions" ? transactionParent(row) : companyParent(row);
      const splits = buildPaymentSplits(
        row,
        boxes,
        table === "transactions" ? "in" : "out",
        table === "transactions" ? "paid" : "total_paid",
      );
      const rowFingerprint = financialOperationFingerprint({ table, index: i, row, payload, splits });

      if (splits.length > 0) {
        const res = await postMovement({
          partyType: table === "transactions" ? "agent" : "company",
          partyId: table === "transactions" ? row.agent_id : row.company_id,
          kind: table === "transactions" ? "receipt" : "payment",
          date: row.date,
          note: row.note || undefined,
          statement: row.statement || undefined,
          splits,
          operationId: rowOperationId,
          atomicFingerprint: rowFingerprint,
          atomicParent: {
            table,
            id: rowOperationId,
            payload,
          },
        });
        if (!res.ok) throw new Error(res.error || "تعذر تسجيل الحركة المالية");
      } else {
        // Metadata-only financial import still uses the operation tracker/RPC;
        // never fall back to a standalone parent INSERT.
        const saved = await executeFinancialAtomic({
          operationId: rowOperationId,
          fingerprint: rowFingerprint,
          rows: [atomicRow(table, { ...payload, id: rowOperationId })],
          result: { transactionId: rowOperationId },
        });
        if (!saved.ok) throw new Error(saved.error || "تعذر تسجيل الحركة المالية");
      }

      try { await logCreate(table, rowOperationId, { ...payload, id: rowOperationId }, "استيراد بيانات"); } catch { /* audit is non-financial */ }
      insertedIds.push(rowOperationId);
    } catch {
      // execute_financial_atomic is all-or-nothing: no client-side compensating
      // delete is required, and a retry with the same row id is safe.
      failed++;
    }
    onProgress(i + 1, rows.length);
    await new Promise((r) => setTimeout(r, 0));
  }

  if (failed === 0) confirmFinancialOperation(batchOperationId);
  return { insertedIds, failed };
}
'''
text = text[:func_start] + new_func + text[func_end:]
path.write_text(text, encoding="utf-8")

print("secondary financial flows converted to atomic saves")
