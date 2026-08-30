from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "src/lib/financialEngine.ts"
text = PATH.read_text(encoding="utf-8")

old_import = 'import { deriveFinancialOperationUuid } from "@/lib/financialIdempotency";\n'
new_import = 'import { financialOperationFingerprint } from "@/lib/financialIdempotency";\nimport { atomicRow, buildAtomicPaymentSplitRows, executeFinancialAtomic, type FinancialAtomicRow, type FinancialAtomicTable } from "@/lib/financialAtomic";\n'
if text.count(old_import) != 1:
    raise RuntimeError(f"engine import expected once, found {text.count(old_import)}")
text = text.replace(old_import, new_import, 1)

old_type = '  operationId?: string;           // مفتاح ثابت لإعادة المحاولة بدون تكرار الحركة\n};'
new_type = '''  operationId?: string;           // مفتاح ثابت لإعادة المحاولة بدون تكرار الحركة
  atomicFingerprint?: string;     // بصمة ثابتة للعملية الكاملة
  atomicParent?: {
    table: FinancialAtomicTable;
    id?: string;
    payload: Record<string, unknown>;
  };
  atomicExtraRows?: FinancialAtomicRow[]; // قيود/أطراف تابعة يجب أن تنجح أو تفشل مع الحركة
};'''
if text.count(old_type) != 1:
    raise RuntimeError(f"PostMovementInput marker expected once, found {text.count(old_type)}")
text = text.replace(old_type, new_type, 1)

old_helpers_start = text.find('function sameNullable(')
old_helpers_end = text.find('\nexport type LedgerEntry', old_helpers_start)
if old_helpers_start >= 0 and old_helpers_end >= 0:
    text = text[:old_helpers_start] + text[old_helpers_end + 1:]

start = text.find('export async function postMovement(')
end = text.find('\n/**\n * تحويل بين خزينتين', start)
if start < 0 or end < 0:
    raise RuntimeError("postMovement block not found")

new_func = '''export async function postMovement(
  input: PostMovementInput,
): Promise<PostMovementResult> {
  try {
    const validSplits = input.splits.filter((s) => Number(s.amount) > 0);
    const operationId = input.operationId?.trim() || "";

    // Fail closed: every new financial write must be routed through the atomic
    // database RPC. A missing id is safer as a hard failure than a legacy
    // multi-request write that can leave half an operation behind.
    if (!operationId) {
      return { ok: false, error: "تم إيقاف العملية بدون تسجيل أي جزء: معرّف العملية المالية مطلوب للحفظ الذري" };
    }
    if (!UUID_RE.test(operationId)) {
      return { ok: false, error: "معرّف العملية المالية غير صالح" };
    }
    if (validSplits.length === 0) {
      return { ok: false, error: "لا توجد سطور دفع صالحة" };
    }
    if (validSplits.some((s) => !s.currency)) {
      return { ok: false, error: "يجب اختيار العملة" };
    }

    let transactionId = input.transactionId ?? null;
    let sourceTable = input.sourceTable ?? PARTY_TO_SOURCE_TABLE[input.partyType];
    let sourceId = input.sourceId ?? null;
    const movementCurrencies = Array.from(new Set(validSplits.map((s) => s.currency)));
    if ((sourceTable === "transactions" || sourceTable === "company_transactions") && movementCurrencies.length !== 1) {
      return { ok: false, error: "لا يمكن حفظ حركة واحدة بأكثر من عملة؛ أضف حركة منفصلة لكل عملة" };
    }

    const atomicRows: FinancialAtomicRow[] = [];

    if (input.atomicParent) {
      const parentId = input.atomicParent.id?.trim() || operationId;
      if (!UUID_RE.test(parentId)) return { ok: false, error: "معرّف الصف المالي الأم غير صالح" };
      sourceTable = input.atomicParent.table;
      sourceId = parentId;
      if (sourceTable === "transactions") transactionId = parentId;
      atomicRows.push(atomicRow(input.atomicParent.table, {
        ...input.atomicParent.payload,
        id: parentId,
      }));
    } else if (!sourceId && (input.partyType === "agent" || input.partyType === "merchant")) {
      const parentCurrency = movementCurrencies[0];
      const totalAmount = validSplits.reduce((s, r) => s + r.amount, 0);
      const isOut = input.kind === "payment" || input.kind === "expense";
      const signed = isOut ? -totalAmount : totalAmount;

      transactionId = operationId;
      sourceTable = "transactions";
      sourceId = operationId;
      atomicRows.push(atomicRow("transactions", {
        id: operationId,
        agent_id: input.partyType === "agent" ? input.partyId : null,
        merchant_id: input.partyType === "merchant" ? input.partyId : null,
        date: input.date,
        count: 0,
        price: 0,
        paid: signed,
        total_paid: signed,
        currency: parentCurrency,
        payment_method: firstMethodArabic(validSplits[0].method),
        note: input.note?.trim() ? input.note.trim() : null,
        statement: input.statement?.trim() ? input.statement.trim() : null,
        source_service_type: sourceServiceType(input.kind, input.partyType),
      }));
    }

    const splitRows = buildAtomicPaymentSplitRows({
      operationId,
      splits: validSplits,
      transactionId,
      sourceTable,
      sourceId,
    });
    const splitIds = splitRows.map((row) => String(row.row.id));
    atomicRows.push(...splitRows, ...(input.atomicExtraRows || []));

    const fingerprint = input.atomicFingerprint || financialOperationFingerprint({
      partyType: input.partyType,
      partyId: input.partyId,
      kind: input.kind,
      date: input.date,
      note: input.note?.trim() || null,
      statement: input.statement?.trim() || null,
      sourceTable,
      sourceId,
      transactionId,
      splits: validSplits,
      parent: input.atomicParent || null,
      extraRows: input.atomicExtraRows || [],
    });

    const saved = await executeFinancialAtomic({
      operationId,
      fingerprint,
      rows: atomicRows,
      result: {
        transactionId,
        splitIds,
      },
    });

    if (!saved.ok) return { ok: false, error: saved.error || "فشل الحفظ المالي الذري" };
    const result = (saved.result || {}) as { transactionId?: string | null; splitIds?: string[] };
    return {
      ok: true,
      transactionId: result.transactionId || transactionId || undefined,
      splitIds: result.splitIds || splitIds,
    };
  } catch (e: any) {
    return { ok: false, error: e?.message || "فشل حفظ الحركة" };
  }
}
'''

text = text[:start] + new_func + text[end:]
PATH.write_text(text, encoding="utf-8")
print("financialEngine atomic patch applied")
