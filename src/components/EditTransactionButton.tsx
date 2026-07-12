import { useEffect, useMemo, useState } from "react";
import { Pencil, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/Modal";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { checkFinancialActionPerm } from "@/hooks/usePerm";
import {
  updateFinancialTransaction,
  type EditableTable,
  type EditPatch,
} from "@/lib/financialEngine.update";

const TABLE_LABEL: Record<EditableTable, string> = {
  transactions: "حركة وكيل",
  company_transactions: "حركة شركة",
  currency_supplier_transactions: "حركة مورد عملة",
  expense_deductions: "خصم مصروف",
  usd_treasury_transactions: "حركة خزينة",
  merchant_cash_collections: "تحصيل تاجر كاش",
  payment_splits: "تقسيم دفع",
};

function pickAmount(table: EditableTable, row: any): number {
  const n = (v: any) => Number(v) || 0;
  switch (table) {
    case "transactions":
    case "company_transactions":
      return n(row.total_paid) || n(row.paid);
    case "currency_supplier_transactions":
      return n(row.bought_amount) || n(row.sold_amount);
    case "usd_treasury_transactions":
      return n(row.usd_amount) || n(row.egp_amount);
    case "expense_deductions":
      return n(row.amount) || n(row.usd_amount);
    case "merchant_cash_collections":
      return n(row.amount);
    case "payment_splits":
      return n(row.net_amount) || n(row.amount);
  }
}
function pickCurrency(table: EditableTable, row: any): string {
  switch (table) {
    case "transactions":
    case "company_transactions":
      return row.payment_currency || row.currency || "EGP";
    case "currency_supplier_transactions":
      return Number(row.bought_amount) > 0 ? row.bought_currency : row.sold_currency;
    case "usd_treasury_transactions":
      return Number(row.usd_amount) > 0 ? "USD" : "EGP";
    case "expense_deductions":
      return row.currency || (Number(row.usd_amount) > 0 ? "USD" : "EGP");
    case "merchant_cash_collections":
      return row.opening_currency || "";
    case "payment_splits":
      return row.currency || "";
  }
}
function pickDate(table: EditableTable, row: any): string {
  if (table === "currency_supplier_transactions") return row.tx_date || "";
  if (table === "expense_deductions") return row.deduction_date || "";
  return row.date || row.created_at?.slice(0, 10) || "";
}
function pickNote(table: EditableTable, row: any): string {
  if (table === "currency_supplier_transactions") return row.description || "";
  return row.note || "";
}

export function EditTransactionButton({
  table,
  id,
  cancelled,
  onDone,
}: {
  table: EditableTable;
  id: string;
  cancelled: boolean;
  onDone?: () => void;
}) {
  const { permissions, isAdmin, isSuperAdmin } = useAuth();
  const allowed =
    isSuperAdmin || isAdmin || checkPerm(permissions, false, "financial_transaction_update", "edit");

  const [open, setOpen] = useState(false);
  const [row, setRow] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [amount, setAmount] = useState<string>("");
  const [date, setDate] = useState<string>("");
  const [statement, setStatement] = useState<string>("");
  const [note, setNote] = useState<string>("");
  const [reason, setReason] = useState<string>("");
  const [splitCount, setSplitCount] = useState<number>(0);

  useEffect(() => {
    if (!open) return;
    let stop = false;
    setLoading(true);
    setRow(null);
    (async () => {
      const { data } = await supabase.from(table as any).select("*").eq("id", id).maybeSingle();
      if (stop) return;
      setRow(data);
      if (data) {
        setAmount(String(pickAmount(table, data)));
        setDate(pickDate(table, data));
        setStatement((data as any).statement || "");
        setNote(pickNote(table, data));
      }
      // count related splits (for amount-edit gating)
      if (table !== "payment_splits") {
        const { count } = await supabase
          .from("payment_splits")
          .select("id", { count: "exact", head: true })
          .eq("source_table", table)
          .eq("source_id", id)
          .is("cancelled_at", null);
        if (!stop) setSplitCount(count || 0);
      } else {
        setSplitCount(1);
      }
      if (!stop) setLoading(false);
    })();
    return () => { stop = true; };
  }, [open, table, id]);

  const originalAmount = row ? pickAmount(table, row) : 0;
  const originalDate = row ? pickDate(table, row) : "";
  const originalStatement = row ? (row as any).statement || "" : "";
  const originalNote = row ? pickNote(table, row) : "";

  const amountEditable = splitCount <= 1; // multi-split rows: metadata-only
  const anyChange = useMemo(() => {
    if (!row) return false;
    if (amountEditable && Number(amount) !== originalAmount) return true;
    if (date !== originalDate) return true;
    if ((statement || "") !== originalStatement) return true;
    if ((note || "") !== originalNote) return true;
    return false;
  }, [row, amount, date, statement, note, amountEditable, originalAmount, originalDate, originalStatement, originalNote]);

  if (!allowed) return null;
  if (cancelled) return null;

  const submit = async () => {
    if (!reason.trim()) { toast.error("سبب التعديل مطلوب"); return; }
    if (!anyChange) { toast.info("لا يوجد أي تغيير للحفظ"); return; }
    setBusy(true);
    try {
      const patch: EditPatch = {};
      if (amountEditable && Number(amount) !== originalAmount) patch.amount = Number(amount);
      if (date !== originalDate) patch.date = date;
      if ((statement || "") !== originalStatement) patch.statement = statement || null;
      if ((note || "") !== originalNote) patch.note = note || null;
      await updateFinancialTransaction({ table, id, patch, reason });
      toast.success("تم تعديل الحركة وتحديث جميع الأرصدة");
      setOpen(false);
      setReason("");
      onDone?.();
    } catch (e: any) {
      toast.error(e?.message || "فشل حفظ التعديل");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        title="تعديل الحركة المالية"
        aria-label="تعديل الحركة المالية"
        className="inline-flex items-center justify-center h-8 w-8 rounded-md text-muted-foreground transition-all duration-150 hover:scale-110 hover:text-blue-600 hover:bg-blue-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40"
      >
        <Pencil size={16} />
      </button>

      <Modal
        open={open}
        onClose={() => (busy ? null : setOpen(false))}
        maxWidth={560}
        title={
          <div className="flex items-center gap-2" style={{ color: "var(--text)" }}>
            <Pencil size={18} />
            <span>تعديل الحركة المالية — {TABLE_LABEL[table]}</span>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>تراجع</Button>
            <Button onClick={submit} disabled={busy || !reason.trim() || !anyChange}>
              {busy && <Loader2 className="animate-spin" size={14} />}
              حفظ التعديل
            </Button>
          </div>
        }
      >
        <div className="space-y-4" dir="rtl">
          {loading ? (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="animate-spin" size={14} /> جاري التحميل…
            </div>
          ) : !row ? (
            <div className="text-muted-foreground">تعذر تحميل الحركة</div>
          ) : (
            <>
              <div
                className="rounded-md border p-3 text-xs flex gap-2"
                style={{
                  background: "color-mix(in oklab, var(--primary, #2563eb) 6%, transparent)",
                  borderColor: "color-mix(in oklab, var(--primary, #2563eb) 25%, transparent)",
                  color: "var(--text)",
                }}
              >
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  سيتم عكس أثر القيم القديمة على الخزائن والأرصدة وإعادة التسجيل بالقيم الجديدة تلقائياً.
                  {!amountEditable && " هذه الحركة تحتوي على أكثر من تقسيم دفع — يمكن تعديل البيانات الوصفية فقط. لتغيير المبلغ، ألغِ الحركة وأعد إنشاءها."}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label={`المبلغ (${pickCurrency(table, row) || "—"})`}>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2" style={{ borderColor: "var(--border)", background: "var(--card, #fff)", color: "var(--text)" }}
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    disabled={busy || !amountEditable}
                  />
                </Field>
                <Field label="التاريخ">
                  <input
                    type="date"
                    className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2" style={{ borderColor: "var(--border)", background: "var(--card, #fff)", color: "var(--text)" }}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    disabled={busy}
                  />
                </Field>
              </div>

              <Field label="البيان">
                <input
                  type="text"
                  className="w-full rounded-md border px-3 py-2 text-sm focus:outline-none focus:ring-2" style={{ borderColor: "var(--border)", background: "var(--card, #fff)", color: "var(--text)" }}
                  value={statement}
                  onChange={(e) => setStatement(e.target.value)}
                  disabled={busy}
                />
              </Field>

              <Field label="الملاحظات">
                <textarea
                  className="w-full rounded-md border px-3 py-2 text-sm min-h-16 focus:outline-none focus:ring-2" style={{ borderColor: "var(--border)", background: "var(--card, #fff)", color: "var(--text)" }}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  disabled={busy}
                />
              </Field>

              <div className="space-y-1.5 pt-2 border-t" style={{ borderColor: "var(--border)" }}>
                <label className="text-sm font-medium" style={{ color: "var(--text)" }}>
                  سبب التعديل <span style={{ color: "var(--red, #dc2626)" }}>*</span>
                </label>
                <textarea
                  autoFocus
                  className="w-full rounded-md border px-3 py-2 text-sm min-h-20 focus:outline-none focus:ring-2"
                  style={{ borderColor: "var(--border)", background: "var(--card, #fff)", color: "var(--text)" }}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="اكتب سبب تعديل الحركة بوضوح (إلزامي)…"
                  disabled={busy}
                  dir="rtl"
                />
              </div>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      {children}
    </div>
  );
}
