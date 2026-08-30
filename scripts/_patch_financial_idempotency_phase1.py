from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_between(text: str, start: str, end: str, new: str, label: str) -> str:
    i = text.find(start)
    if i < 0:
        raise RuntimeError(f"{label}: start marker not found")
    j = text.find(end, i)
    if j < 0:
        raise RuntimeError(f"{label}: end marker not found")
    j += len(end)
    return text[:i] + new + text[j:]


def patch_financial_engine() -> None:
    path = ROOT / "src/lib/financialEngine.ts"
    text = path.read_text(encoding="utf-8")

    text = replace_once(
        text,
        'import { useLive } from "@/lib/db";\n',
        'import { useLive } from "@/lib/db";\nimport { deriveFinancialOperationUuid } from "@/lib/financialIdempotency";\n',
        "financialEngine import",
    )

    text = replace_once(
        text,
        '  transactionId?: string;         // لو الحركة مرتبطة بصف transactions موجود\n};',
        '  transactionId?: string;         // لو الحركة مرتبطة بصف transactions موجود\n  operationId?: string;           // مفتاح ثابت لإعادة المحاولة بدون تكرار الحركة\n};',
        "financialEngine operationId type",
    )

    helpers_anchor = '''export type PostMovementResult = {
  ok: boolean;
  transactionId?: string;
  splitIds?: string[];
  error?: string;
};
'''
    helpers_new = helpers_anchor + '''
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sameNullable(a: unknown, b: unknown): boolean {
  return (a ?? null) === (b ?? null);
}

function splitMatchesExpected(existing: any, expected: any): boolean {
  return String(existing.method || "") === String(expected.method || "")
    && String(existing.currency || "") === String(expected.currency || "")
    && sameNullable(existing.cash_box_id, expected.cash_box_id)
    && Number(existing.amount || 0) === Number(expected.amount || 0)
    && String(existing.direction || "in") === String(expected.direction || "in")
    && sameNullable(existing.source_table, expected.source_table)
    && sameNullable(existing.source_id, expected.source_id)
    && sameNullable(existing.transaction_id, expected.transaction_id);
}
'''
    text = replace_once(text, helpers_anchor, helpers_new, "financialEngine helper functions")

    text = replace_once(
        text,
        '''    const validSplits = input.splits.filter((s) => Number(s.amount) > 0);
    if (validSplits.length === 0) {''',
        '''    const validSplits = input.splits.filter((s) => Number(s.amount) > 0);
    const operationId = input.operationId?.trim() || null;
    if (operationId && !UUID_RE.test(operationId)) {
      return { ok: false, error: "معرّف العملية المالية غير صالح" };
    }
    if (validSplits.length === 0) {''',
        "financialEngine operationId validation",
    )

    old_parent = '''      const { data: txn, error: txnErr } = await supabase
        .from("transactions")
        .insert(parentPayload)
        .select("id")
        .single();
      if (txnErr || !txn) {
        return { ok: false, error: txnErr?.message || "تعذر حفظ الصف الأم" };
      }
      transactionId = txn.id;
      sourceTable = "transactions";
      sourceId = txn.id;'''
    new_parent = '''      let txn: { id: string } | null = null;
      if (operationId) {
        const { data: existingTxn, error: existingTxnError } = await supabase
          .from("transactions")
          .select("id")
          .eq("id", operationId)
          .maybeSingle();
        if (existingTxnError) return { ok: false, error: existingTxnError.message };
        txn = existingTxn as { id: string } | null;
      }

      if (!txn) {
        const payloadWithId = operationId ? { ...parentPayload, id: operationId } : parentPayload;
        const { data: insertedTxn, error: txnErr } = await supabase
          .from("transactions")
          .insert(payloadWithId as any)
          .select("id")
          .single();
        if (txnErr || !insertedTxn) {
          // The server may have committed while the response was lost. A retry
          // with the same operation id must re-use that parent instead of duplicating it.
          if (operationId) {
            const { data: afterConflict } = await supabase
              .from("transactions")
              .select("id")
              .eq("id", operationId)
              .maybeSingle();
            if (afterConflict) txn = afterConflict as { id: string };
          }
          if (!txn) return { ok: false, error: txnErr?.message || "تعذر حفظ الصف الأم" };
        } else {
          txn = insertedTxn as { id: string };
        }
      }
      transactionId = txn.id;
      sourceTable = "transactions";
      sourceId = txn.id;'''
    text = replace_once(text, old_parent, new_parent, "financialEngine idempotent parent")

    text = replace_once(
        text,
        '''    const rows = validSplits.map((s) => ({
      transaction_id: transactionId,''',
        '''    const rows = validSplits.map((s, index) => ({
      ...(operationId ? { id: deriveFinancialOperationUuid(operationId, `split:${index}`) } : {}),
      transaction_id: transactionId,''',
        "financialEngine deterministic split ids",
    )

    old_insert = '''    const { data: inserted, error } = await supabase
      .from("payment_splits")
      .insert(rows)
      .select("id");
    if (error) return { ok: false, error: error.message };

    return {
      ok: true,
      transactionId: transactionId ?? undefined,
      splitIds: (inserted || []).map((r: any) => r.id),
    };'''
    new_insert = '''    if (operationId) {
      const expectedRows = rows as any[];
      const expectedIds = expectedRows.map((row) => row.id as string);
      const { data: existing, error: existingError } = await supabase
        .from("payment_splits")
        .select("id,transaction_id,method,currency,cash_box_id,amount,direction,source_table,source_id")
        .in("id", expectedIds);
      if (existingError) return { ok: false, error: existingError.message };

      const existingById = new Map((existing || []).map((row: any) => [row.id, row]));
      for (const row of expectedRows) {
        const old = existingById.get(row.id);
        if (old && !splitMatchesExpected(old, row)) {
          return { ok: false, error: "تعذر تأكيد العملية: توجد محاولة سابقة بنفس المعرّف ببيانات مختلفة" };
        }
      }

      const missing = expectedRows.filter((row) => !existingById.has(row.id));
      if (missing.length > 0) {
        const { error: insertError } = await supabase.from("payment_splits").insert(missing as any);
        if (insertError) {
          // A concurrent/retried request can win the insert race. Re-read and
          // accept it only when every deterministic row now matches exactly.
          const { data: afterInsert, error: afterInsertError } = await supabase
            .from("payment_splits")
            .select("id,transaction_id,method,currency,cash_box_id,amount,direction,source_table,source_id")
            .in("id", expectedIds);
          if (afterInsertError) return { ok: false, error: insertError.message };
          const afterById = new Map((afterInsert || []).map((row: any) => [row.id, row]));
          const complete = expectedRows.every((row) => {
            const saved = afterById.get(row.id);
            return saved && splitMatchesExpected(saved, row);
          });
          if (!complete) return { ok: false, error: insertError.message };
        }
      }

      return {
        ok: true,
        transactionId: transactionId ?? undefined,
        splitIds: expectedIds,
      };
    }

    const { data: inserted, error } = await supabase
      .from("payment_splits")
      .insert(rows)
      .select("id");
    if (error) return { ok: false, error: error.message };

    return {
      ok: true,
      transactionId: transactionId ?? undefined,
      splitIds: (inserted || []).map((r: any) => r.id),
    };'''
    text = replace_once(text, old_insert, new_insert, "financialEngine idempotent split insert")

    text = replace_once(
        text,
        '''  note?: string;
  method?: string;
}): Promise<PostMovementResult> {
  const method = args.method || "تحويل بين الخزائن";
  const transferRef = typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;''',
        '''  note?: string;
  method?: string;
  operationId?: string;
}): Promise<PostMovementResult> {
  const method = args.method || "تحويل بين الخزائن";
  const transferRef = args.operationId || (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`);''',
        "financialEngine transfer operation id",
    )
    text = replace_once(
        text,
        '''    sourceTable: "cash_box_transfer",
    sourceId: transferRef,
    splits: [''',
        '''    sourceTable: "cash_box_transfer",
    sourceId: transferRef,
    operationId: args.operationId,
    splits: [''',
        "financialEngine transfer pass operation id",
    )

    path.write_text(text, encoding="utf-8")


def patch_agent_payment() -> None:
    path = ROOT / "src/components/AgentPaymentForm.tsx"
    text = path.read_text(encoding="utf-8")

    text = replace_once(
        text,
        'import { postMovement } from "@/lib/financialEngine";\n',
        'import { postMovement } from "@/lib/financialEngine";\nimport { confirmFinancialOperation, financialOperationFingerprint, getOrCreateFinancialOperationId, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
        "AgentPayment idempotency import",
    )

    currency_guard = '''    if (validSplits.some((r) => r.currency !== selectedCurrency)) {
      return toast.error("لا يمكن حفظ دفعة واحدة بأكثر من عملة؛ أضف دفعة منفصلة لكل عملة");
    }
'''
    currency_guard_new = currency_guard + '''
    // Company-funded rows must resolve to a real company cash box BEFORE any
    // parent financial record is created. Never allow an orphan treasury split.
    for (const r of validSplits) {
      if (r.source !== "company") continue;
      const box = resolveCompanyCashBoxForSplit(cashBoxes, r.currency, r.method);
      if (!box) return toast.error(`لا توجد خزنة شركة مطابقة لوسيلة الدفع المختارة بعملة ${r.currency}`);
    }
'''
    text = replace_once(text, currency_guard, currency_guard_new, "AgentPayment cash box guard")

    start = '''    setSaving(true);
    const { data: txnRow, error: txnErr } = await supabase'''
    end = '''    if (!engineRes.ok) console.warn("engine post error:", engineRes.error);
'''
    replacement = '''    const engineSplits = validSplits.map((r) => {
      const b = splitBreakdown(r);
      let methodLabel = "نقدي";
      let cashBoxId: string | null = null;
      if (r.method === "company_instapay") {
        methodLabel = "إنستاباي";
        cashBoxId = resolveCompanyCashBoxForSplit(cashBoxes, r.currency, r.method)?.id || null;
      } else if (r.method === "company_cash") {
        methodLabel = "نقدي";
        cashBoxId = resolveCompanyCashBoxForSplit(cashBoxes, r.currency, r.method)?.id || null;
      } else if (r.method === "merchant_instapay") methodLabel = "انستا";
      else if (r.method === "merchant_wallet") methodLabel = "فودافون كاش";
      else if (r.method === "merchant_physical") methodLabel = "نقدي";
      return {
        method: methodLabel,
        currency: r.currency,
        cashBoxId,
        amount: b.net,
        direction: "in" as const,
        grossAmount: b.gross,
        commissionRate: b.rate,
        commissionAmount: b.commission,
        netAmount: b.net,
        exchangeRate: 1,
        egpEquivalent: r.currency === "EGP" ? b.net : 0,
      };
    });

    const operationFingerprint = financialOperationFingerprint({
      agentId: form.agent_id,
      date: form.date,
      destination: form.destination || null,
      serviceType: form.service_type || null,
      count: Number(form.count) || 0,
      price: Number(form.price) || 0,
      splits: validSplits.map((r) => ({
        source: r.source,
        currency: r.currency,
        merchantId: r.merchant_id || null,
        method: r.method,
        amount: Number(r.amount) || 0,
      })),
    });
    const operationId = getOrCreateFinancialOperationId("agent-payment", operationFingerprint);
    const confirmationToastId = `financial:${operationId}`;

    setSaving(true);
    toast.loading("جارٍ تأكيد العملية...", { id: confirmationToastId });

    let txnRow: { id: string } | null = null;
    const { data: existingTxn, error: existingTxnError } = await supabase
      .from("transactions")
      .select("id")
      .eq("id", operationId)
      .maybeSingle();
    if (existingTxnError) {
      setSaving(false);
      toast.error(
        isLikelyNetworkError(existingTxnError)
          ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات."
          : existingTxnError.message,
        { id: confirmationToastId },
      );
      return;
    }
    txnRow = existingTxn as { id: string } | null;

    if (!txnRow) {
      const { data: insertedTxn, error: txnErr } = await supabase
        .from("transactions")
        .insert({ ...payload, id: operationId })
        .select("id")
        .single();
      if (txnErr || !insertedTxn) {
        // If the response was lost after commit, try to discover the row. When
        // the network is still unavailable the same operation id stays pending
        // and the next user retry will resume it safely.
        const { data: afterInsert } = await supabase
          .from("transactions")
          .select("id")
          .eq("id", operationId)
          .maybeSingle();
        txnRow = afterInsert as { id: string } | null;
        if (!txnRow) {
          setSaving(false);
          toast.error(
            isLikelyNetworkError(txnErr)
              ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات."
              : (txnErr?.message || "تعذر حفظ الدفعة"),
            { id: confirmationToastId },
          );
          return;
        }
      } else {
        txnRow = insertedTxn as { id: string };
      }
    }

    const engineRes = await postMovement({
      partyType: "agent",
      partyId: form.agent_id,
      kind: "receipt",
      date: form.date,
      note: form.note.trim() ? form.note.trim() : undefined,
      statement: form.statement.trim() ? form.statement.trim() : undefined,
      splits: engineSplits,
      sourceTable: "transactions",
      sourceId: txnRow.id,
      transactionId: txnRow.id,
      operationId,
    });

    if (!engineRes.ok) {
      setSaving(false);
      const networkUnknown = isLikelyNetworkError(engineRes.error);
      if (!networkUnknown) {
        // A definitive server-side rejection means the split was not committed;
        // remove the metadata parent so the agent statement cannot show a half operation.
        await supabase.from("transactions").delete().eq("id", operationId);
      }
      toast.error(
        networkUnknown
          ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات."
          : (engineRes.error || "تعذر تحديث الأرصدة"),
        { id: confirmationToastId },
      );
      return;
    }
'''
    text = replace_between(text, start, end, replacement, "AgentPayment save core")

    text = replace_once(
        text,
        '''    await logCreate("transactions", txnRow.id, { ...payload, id: txnRow.id }, "دفعة وكيل");''',
        '''    try {
      await logCreate("transactions", txnRow.id, { ...payload, id: txnRow.id }, "دفعة وكيل");
    } catch { /* audit logging must not turn a confirmed financial write into a failed UI state */ }''',
        "AgentPayment nonblocking audit",
    )

    text = replace_once(
        text,
        '''    setSaving(false);
    toast.success("تم تسجيل الدفعة");
    resetDraft();
    onDone();''',
        '''    confirmFinancialOperation(operationId);
    setSaving(false);
    toast.success("تم تسجيل العملية وتحديث الأرصدة بنجاح", { id: confirmationToastId });
    resetDraft();
    onDone();''',
        "AgentPayment confirmation success",
    )

    path.write_text(text, encoding="utf-8")


def main() -> None:
    patch_financial_engine()
    patch_agent_payment()
    print("financial idempotency phase 1 patch applied")


if __name__ == "__main__":
    main()
