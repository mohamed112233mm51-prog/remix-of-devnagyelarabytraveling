from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected 1 match, found {count}")
    return text.replace(old, new, 1)


# ---------------------------------------------------------------------------
# Agent payment: parent transaction + all payment splits in ONE RPC.
# ---------------------------------------------------------------------------
path = ROOT / "src/components/AgentPaymentForm.tsx"
text = path.read_text(encoding="utf-8")
start = text.find('    let txnRow: { id: string } | null = null;')
end = text.find('    try {\n      await logCreate("transactions", txnRow.id', start)
if start < 0 or end < 0:
    raise RuntimeError("agent payment legacy parent/split block not found")
new_block = '''    const engineRes = await postMovement({
      partyType: "agent",
      partyId: form.agent_id,
      kind: "receipt",
      date: form.date,
      note: form.note.trim() ? form.note.trim() : undefined,
      statement: form.statement.trim() ? form.statement.trim() : undefined,
      splits: engineSplits,
      operationId,
      atomicFingerprint: operationFingerprint,
      atomicParent: {
        table: "transactions",
        id: operationId,
        payload,
      },
    });

    if (!engineRes.ok) {
      setSaving(false);
      toast.error(
        isLikelyNetworkError(engineRes.error)
          ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات."
          : (engineRes.error || "تعذر تحديث الأرصدة"),
        { id: confirmationToastId },
      );
      return;
    }

    // The parent and every payment split committed in the SAME PostgreSQL
    // transaction. No cleanup/rollback request is needed on the client.
    const txnRow = { id: engineRes.transactionId || operationId };

'''
text = text[:start] + new_block + text[end:]
path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Cash movement forms: agent counterpart + company parent/counterparts are
# included in the same source-operation RPC.
# ---------------------------------------------------------------------------
path = ROOT / "src/components/CashMovementForms.tsx"
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    'import { confirmFinancialOperation, ensureFinancialParentRow, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
    'import { confirmFinancialOperation, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
    "cash remove parent helper import",
)
text = replace_once(
    text,
    'import { postMerchantCashOutToCompanyCounterparts, postMerchantCashOutToAgentCounterparts } from "@/lib/merchantCounterparty";\n',
    'import { buildMerchantCashOutToCompanyCounterpartRows, buildMerchantCashOutToAgentCounterpartRows } from "@/lib/merchantCounterparty";\n',
    "cash counterpart builder import",
)

old_agent_call = '''    const res = await postMovement({
      partyType: "agent",
      partyId: agentId,
      kind: "payment",
      date,
      note: note.trim() ? note.trim() : undefined,
      statement: statement.trim() ? statement.trim() : undefined,
      splits: engineSplits,
      operationId,
    });

    if (!res.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(res.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (res.error || "تعذر حفظ الحركة"), { id: toastId });
      return;
    }

    if (res.transactionId) {
      const merchantRes = await postMerchantCashOutToAgentCounterparts({
        splits: valid,
        agentTransactionId: res.transactionId,
        date,
        statement: statement.trim() || "صرف نقدية لوكيل",
        note: note.trim() || undefined,
      });
      if (!merchantRes.ok) {
        setSaving(false);
        toast.error(isLikelyNetworkError(merchantRes.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (merchantRes.error || "تعذر حفظ قيد تاجر الكاش"), { id: toastId });
        return;
      }
    }
'''
new_agent_call = '''    const counterpartRows = buildMerchantCashOutToAgentCounterpartRows({
      splits: valid,
      agentTransactionId: operationId,
      date,
      statement: statement.trim() || "صرف نقدية لوكيل",
      note: note.trim() || undefined,
    });
    const res = await postMovement({
      partyType: "agent",
      partyId: agentId,
      kind: "payment",
      date,
      note: note.trim() ? note.trim() : undefined,
      statement: statement.trim() ? statement.trim() : undefined,
      splits: engineSplits,
      operationId,
      atomicFingerprint: fingerprint,
      atomicExtraRows: counterpartRows,
    });

    if (!res.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(res.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (res.error || "تعذر حفظ الحركة"), { id: toastId });
      return;
    }
'''
text = replace_once(text, old_agent_call, new_agent_call, "agent cashout atomic counterpart")

old_merchant_tail = '''      splits: engineSplits,
      operationId,
    });'''
# At this point this exact text occurs once in MerchantCashOut after the agent
# block above was replaced (company uses sourceTable/sourceId later).
text = replace_once(
    text,
    old_merchant_tail,
    '''      splits: engineSplits,
      operationId,
      atomicFingerprint: fingerprint,
    });''',
    "merchant cashout atomic fingerprint",
)

company_start = text.find('    const txn = await ensureFinancialParentRow("company_transactions", operationId, parentPayload);')
company_end = text.find('\n    confirmFinancialOperation(operationId);', company_start)
if company_start < 0 or company_end < 0:
    raise RuntimeError("company supply legacy multi-write block not found")
company_new = '''    const counterpartRows = buildMerchantCashOutToCompanyCounterpartRows({
      splits: valid,
      companyTransactionId: operationId,
      date,
      statement: statement.trim() || "صادر لشركة",
      note: note.trim() || undefined,
    });
    const res = await postMovement({
      partyType: "company",
      partyId: companyId,
      kind: "receipt",
      date,
      note: note.trim() ? note.trim() : undefined,
      statement: statement.trim() ? statement.trim() : undefined,
      splits: engineSplits,
      operationId,
      atomicFingerprint: fingerprint,
      atomicParent: {
        table: "company_transactions",
        id: operationId,
        payload: parentPayload,
      },
      atomicExtraRows: counterpartRows,
    });
    if (!res.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(res.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (res.error || "تعذر حفظ الحركة المالية"), { id: toastId });
      return;
    }
'''
text = text[:company_start] + company_new + text[company_end:]
path.write_text(text, encoding="utf-8")


# ---------------------------------------------------------------------------
# Expenses: expense parent + deductions + treasury splits + merchant balance
# rows all commit in one database transaction, including merchant-only expense.
# ---------------------------------------------------------------------------
path = ROOT / "src/features/expenses/LegacyExpensesRoute.tsx"
text = path.read_text(encoding="utf-8")
text = replace_once(
    text,
    'import { confirmFinancialOperation, ensureFinancialChildRows, ensureFinancialParentRow, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
    'import { confirmFinancialOperation, deriveFinancialOperationUuid, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\nimport { atomicRow, buildAtomicPaymentSplitRows, executeFinancialAtomic } from "@/lib/financialAtomic";\n',
    "expense atomic imports",
)
old_parent = '''    const expenseRow = await ensureFinancialParentRow("expenses", operationId, expensePayload);
    if (expenseRow.error) {
      setSaving(false);
      toast.error(isLikelyNetworkError(expenseRow.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : expenseRow.error, { id: toastId });
      return;
    }
'''
text = replace_once(text, old_parent, '    const expenseRow = { id: operationId };\n', "expense defer parent insert")

# Remove the old deductions DB call but keep deterministic ids for audit/result.
ded_start = text.find('    const deductions = await ensureFinancialChildRows("expense_deductions"')
ded_end = text.find('\n\n    if (engineSplits.length)', ded_start)
if ded_start < 0 or ded_end < 0:
    raise RuntimeError("expense deductions legacy block not found")
ded_new = '''    const deductionIds = deductionRows.map((_, index) =>
      deriveFinancialOperationUuid(operationId, `deduction:${index}`),
    );
    const deductions = { ids: deductionIds };
'''
text = text[:ded_start] + ded_new + text[ded_end:]

# Remove old engine call; its rows are included below.
engine_start = text.find('    if (engineSplits.length) {', text.find(ded_new))
collections_start = text.find('    const collections = await ensureFinancialChildRows("merchant_cash_collections"', engine_start)
if engine_start < 0 or collections_start < 0:
    raise RuntimeError("expense engine/collection legacy blocks not found")
text = text[:engine_start] + text[collections_start:]

col_start = text.find('    const collections = await ensureFinancialChildRows("merchant_cash_collections"')
col_end = text.find('\n\n    if (!expenseRow.reused)', col_start)
if col_start < 0 or col_end < 0:
    raise RuntimeError("expense collections legacy block not found")
atomic_save = '''    const collectionIds = collectionRows.map((_, index) =>
      deriveFinancialOperationUuid(operationId, `merchant-collection:${index}`),
    );
    const collections = { ids: collectionIds };
    const atomicRows = [
      atomicRow("expenses", { ...expensePayload, id: operationId }),
      ...deductionRows.map((row, index) => atomicRow("expense_deductions", { ...row, id: deductionIds[index] })),
      ...buildAtomicPaymentSplitRows({
        operationId,
        splits: engineSplits,
        sourceTable: "expenses",
        sourceId: operationId,
      }),
      ...collectionRows.map((row, index) => atomicRow("merchant_cash_collections", { ...row, id: collectionIds[index] })),
    ];
    const saved = await executeFinancialAtomic({
      operationId,
      fingerprint,
      rows: atomicRows,
      result: { expenseId: operationId, deductionIds, collectionIds },
    });
    if (!saved.ok) {
      setSaving(false);
      toast.error(isLikelyNetworkError(saved.error) ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات." : (saved.error || "تعذر حفظ المصروف"), { id: toastId });
      return;
    }
'''
text = text[:col_start] + atomic_save + text[col_end:]
text = text.replace('    if (!expenseRow.reused) {', '    if (!saved.reused) {', 1)
# Avoid duplicate non-financial audit rows on an idempotent replay.
old_audits = '''    for (let i = 0; i < deductions.ids.length; i += 1) {
      try { await logCreate("expense_deductions", deductions.ids[i], { ...deductionRows[i], id: deductions.ids[i] }, "خصم مصروف"); } catch { /* non-blocking audit */ }
    }
    for (let i = 0; i < collections.ids.length; i += 1) {
      try { await logCreate("merchant_cash_collections", collections.ids[i], { ...collectionRows[i], id: collections.ids[i] }, "خصم رصيد تاجر (مصروف)"); } catch { /* non-blocking audit */ }
    }
'''
new_audits = '''    if (!saved.reused) {
      for (let i = 0; i < deductions.ids.length; i += 1) {
        try { await logCreate("expense_deductions", deductions.ids[i], { ...deductionRows[i], id: deductions.ids[i] }, "خصم مصروف"); } catch { /* non-blocking audit */ }
      }
      for (let i = 0; i < collections.ids.length; i += 1) {
        try { await logCreate("merchant_cash_collections", collections.ids[i], { ...collectionRows[i], id: collections.ids[i] }, "خصم رصيد تاجر (مصروف)"); } catch { /* non-blocking audit */ }
      }
    }
'''
text = replace_once(text, old_audits, new_audits, "expense audit replay guard")
path.write_text(text, encoding="utf-8")

print("core financial flows converted to atomic saves")
