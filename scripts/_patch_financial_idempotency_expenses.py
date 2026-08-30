from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PATH = ROOT / "src/features/expenses/LegacyExpensesRoute.tsx"


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def main() -> None:
    text = PATH.read_text(encoding="utf-8")

    text = replace_once(
        text,
        'import { postMovement, type MovementSplit } from "@/lib/financialEngine";\n',
        'import { postMovement, type MovementSplit } from "@/lib/financialEngine";\nimport { confirmFinancialOperation, ensureFinancialChildRows, ensureFinancialParentRow, financialConfirmationToastId, financialOperationFingerprint, getOrCreateFinancialOperationId, FINANCIAL_CONFIRMING_MESSAGE, FINANCIAL_SUCCESS_MESSAGE, isLikelyNetworkError } from "@/lib/financialIdempotency";\n',
        "expense idempotency import",
    )

    text = replace_once(
        text,
        '  const [splits, setSplits] = useState<PaymentSplitRow[]>([newPaymentSplitRow()]);\n',
        '  const [splits, setSplits] = useState<PaymentSplitRow[]>([newPaymentSplitRow()]);\n  const [saving, setSaving] = useState(false);\n',
        "expense saving state",
    )

    old_parent = '''    const { data: expenseRow, error } = await supabase
      .from("expenses").insert(expensePayload).select("id").single();
    if (error || !expenseRow) return toast.error(error?.message || "تعذر حفظ المصروف");
'''
    new_parent = '''    const missingCompanyBox = valid.find((r) =>
      r.source === "company" && !resolveCompanyCashBoxForSplit(cashBoxes, r.currency || "EGP", r.method)
    );
    if (missingCompanyBox) return toast.error(`لا توجد خزنة شركة مطابقة لوسيلة الدفع المختارة بعملة ${missingCompanyBox.currency || "EGP"}`);

    const fingerprint = financialOperationFingerprint({
      expenseName: form.expense_name.trim(),
      expenseType: form.expense_type,
      amount: totalAmount,
      date: form.date,
      splits: valid.map((r) => ({
        source: r.source,
        merchantId: r.merchant_id || null,
        method: r.method,
        currency: r.currency || "EGP",
        amount: Number(r.amount) || 0,
      })),
    });
    const operationId = getOrCreateFinancialOperationId("expense-create", fingerprint);
    const toastId = financialConfirmationToastId(operationId);
    setSaving(true);
    toast.loading(FINANCIAL_CONFIRMING_MESSAGE, { id: toastId });

    const parent = await ensureFinancialParentRow("expenses", operationId, expensePayload);
    if (parent.error) {
      setSaving(false);
      toast.error(
        isLikelyNetworkError(parent.error)
          ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات."
          : parent.error,
        { id: toastId },
      );
      return;
    }
    const expenseRow = { id: parent.id };
'''
    text = replace_once(text, old_parent, new_parent, "expense idempotent parent")

    old_deductions = '''    if (deductionRows.length) {
      const { data: dedIns, error: e2 } = await supabase.from("expense_deductions").insert(deductionRows).select("id");
      if (e2) toast.error("تم حفظ المصروف لكن تعذر تسجيل بعض الخصومات: " + e2.message);
      else if (dedIns) {
        for (let i = 0; i < dedIns.length; i++) {
          const id = (dedIns[i] as any)?.id;
          if (id) await logCreate("expense_deductions", id, { ...deductionRows[i], id }, "خصم مصروف");
        }
      }
    }
'''
    new_deductions = '''    if (deductionRows.length) {
      const ded = await ensureFinancialChildRows("expense_deductions", operationId, "expense-deduction", deductionRows);
      if (ded.error) {
        setSaving(false);
        toast.error(
          isLikelyNetworkError(ded.error)
            ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات."
            : ("تعذر تسجيل خصومات المصروف: " + ded.error),
          { id: toastId },
        );
        return;
      }
      for (let i = 0; i < ded.ids.length; i++) {
        const id = ded.ids[i];
        if (id) await logCreate("expense_deductions", id, { ...deductionRows[i], id }, "خصم مصروف").catch(() => undefined);
      }
    }
'''
    text = replace_once(text, old_deductions, new_deductions, "expense idempotent deductions")

    text = replace_once(
        text,
        '''        sourceTable: "expenses",
        sourceId: expenseRow.id,
      });
      if (!res.ok) toast.error("تم حفظ المصروف لكن تعذر تحديث رصيد الخزنة: " + res.error);
''',
        '''        sourceTable: "expenses",
        sourceId: expenseRow.id,
        operationId,
      });
      if (!res.ok) {
        setSaving(false);
        toast.error(
          isLikelyNetworkError(res.error)
            ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات."
            : ("تعذر تحديث رصيد الخزنة: " + (res.error || "خطأ غير معروف")),
          { id: toastId },
        );
        return;
      }
''',
        "expense idempotent engine",
    )

    old_collections = '''    if (collectionRows.length) {
      const { data: colIns, error: e3 } = await supabase.from("merchant_cash_collections").insert(collectionRows).select("id");
      if (e3) toast.error("تم حفظ المصروف لكن تعذر خصم رصيد بعض التجار: " + e3.message);
      else if (colIns) {
        for (let i = 0; i < colIns.length; i++) {
          const id = (colIns[i] as any)?.id;
          if (id) await logCreate("merchant_cash_collections", id, { ...collectionRows[i], id }, "خصم رصيد تاجر (مصروف)");
        }
      }
    }



    toast.success("تم حفظ المصروف وخصمه من مصادر الدفع");
'''
    new_collections = '''    if (collectionRows.length) {
      const col = await ensureFinancialChildRows("merchant_cash_collections", operationId, "expense-merchant-collection", collectionRows);
      if (col.error) {
        setSaving(false);
        toast.error(
          isLikelyNetworkError(col.error)
            ? "تعذر تأكيد العملية الآن بسبب الاتصال. أعد المحاولة بنفس البيانات."
            : ("تعذر خصم رصيد بعض التجار: " + col.error),
          { id: toastId },
        );
        return;
      }
      for (let i = 0; i < col.ids.length; i++) {
        const id = col.ids[i];
        if (id) await logCreate("merchant_cash_collections", id, { ...collectionRows[i], id }, "خصم رصيد تاجر (مصروف)").catch(() => undefined);
      }
    }

    confirmFinancialOperation(operationId);
    setSaving(false);
    toast.success(FINANCIAL_SUCCESS_MESSAGE, { id: toastId });
'''
    text = replace_once(text, old_collections, new_collections, "expense idempotent merchant collections")

    text = replace_once(
        text,
        '<button data-confirm-save={initial ? "تأكيد حفظ تعديلات المصروف" : "تأكيد حفظ المصروف"} className="btn btn-gold" onClick={save}>💾 {initial ? "حفظ التعديلات" : "حفظ المصروف"}</button>',
        '<button data-confirm-save={initial ? "تأكيد حفظ تعديلات المصروف" : "تأكيد حفظ المصروف"} className="btn btn-gold" onClick={save} disabled={saving}>💾 {initial ? "حفظ التعديلات" : "حفظ المصروف"}</button>',
        "expense disable save while confirming",
    )

    PATH.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    main()
