import { useEffect, useState } from "react";
import { Ban, RotateCcw, Loader2, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/Modal";
import { toast } from "sonner";
import {
  cancelFinancialTransaction,
  restoreFinancialTransaction,
  type CancellableTable,
} from "@/lib/financialEngine.cancel";
import { useAuth } from "@/hooks/useAuth";
import { checkPerm } from "@/hooks/usePerm";
import { supabase } from "@/integrations/supabase/client";

type Mode = "cancel" | "restore";

const TABLE_LABEL: Record<CancellableTable, string> = {
  transactions: "حركة وكيل",
  company_transactions: "حركة شركة",
  currency_supplier_transactions: "حركة مورد عملة",
  expense_deductions: "خصم مصروف",
  usd_treasury_transactions: "حركة خزينة",
  merchant_cash_collections: "تحصيل تاجر كاش",
  payment_splits: "تقسيم دفع",
};

function pickAmountAndCurrency(
  table: CancellableTable,
  row: any,
): { amount: number | null; currency: string } {
  if (!row) return { amount: null, currency: "" };
  const n = (v: any) => (typeof v === "number" && !isNaN(v) ? v : 0);
  switch (table) {
    case "transactions":
    case "company_transactions": {
      const paid =
        n(row.total_paid) ||
        n(row.paid) ||
        n(row.cash_amount) +
          n(row.instapay_amount) +
          n(row.mobile_cash_amount) +
          n(row.merchant_cash_amount) +
          n(row.arabic_tourism_cash_amount) +
          n(row.usd_amount);
      return {
        amount: paid || null,
        currency: row.payment_currency || row.currency || "EGP",
      };
    }
    case "currency_supplier_transactions": {
      if (n(row.bought_amount))
        return { amount: n(row.bought_amount), currency: row.bought_currency || "" };
      return { amount: n(row.sold_amount) || null, currency: row.sold_currency || "" };
    }
    case "usd_treasury_transactions":
      return {
        amount: n(row.usd_amount) || n(row.egp_amount) || null,
        currency: n(row.usd_amount) ? "USD" : "EGP",
      };
    case "expense_deductions":
      return {
        amount: n(row.amount) || n(row.usd_amount) || null,
        currency: row.currency || (n(row.usd_amount) ? "USD" : ""),
      };
    case "merchant_cash_collections":
      return { amount: n(row.amount) || null, currency: row.opening_currency || "" };
    case "payment_splits":
      return {
        amount: n(row.net_amount) || n(row.gross_amount) || n(row.amount) || null,
        currency: row.currency || "",
      };
  }
}
function pickDate(row: any): string {
  return row?.date || row?.deduction_date || row?.created_at?.slice(0, 10) || "";
}
function pickCounterparty(row: any): string {
  return row?.description || row?.notes || row?.reason || "";
}

export function CancelTransactionButton({
  table,
  id,
  cancelled,
  compact = true,
  onDone,
}: {
  table: CancellableTable;
  id: string;
  cancelled: boolean;
  compact?: boolean;
  onDone?: () => void;
}) {
  const { permissions, isAdmin, isSuperAdmin } = useAuth();
  const allowed =
    isSuperAdmin || isAdmin || checkPerm(permissions, false, "financial_cancel", "delete");

  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [row, setRow] = useState<any>(null);
  const [loadingRow, setLoadingRow] = useState(false);
  const mode: Mode = cancelled ? "restore" : "cancel";

  useEffect(() => {
    if (!open) return;
    let cancel = false;
    setLoadingRow(true);
    setRow(null);
    supabase
      .from(table as any)
      .select("*")
      .eq("id", id)
      .maybeSingle()
      .then(({ data }) => {
        if (!cancel) setRow(data);
      })
      .then(() => !cancel && setLoadingRow(false));
    return () => {
      cancel = true;
    };
  }, [open, table, id]);

  if (!allowed) return null;

  const submit = async () => {
    if (!reason.trim()) {
      toast.error("يجب إدخال سبب الإلغاء");
      return;
    }
    setBusy(true);
    try {
      if (mode === "cancel") {
        await cancelFinancialTransaction({ table, id, reason });
        toast.success("تم إلغاء الحركة وتحديث جميع الأرصدة");
      } else {
        await restoreFinancialTransaction({ table, id, reason });
        toast.success("تم إعادة تفعيل الحركة");
      }
      setOpen(false);
      setReason("");
      onDone?.();
    } catch (e: any) {
      toast.error(e?.message || "فشل تنفيذ العملية");
    } finally {
      setBusy(false);
    }
  };

  const amount = pickAmount(row);
  const currency = pickCurrency(row);
  const date = pickDate(row);
  const counterparty = pickCounterparty(row);

  return (
    <>
      <Button
        variant={cancelled ? "outline" : "destructive"}
        size={compact ? "sm" : "default"}
        onClick={() => setOpen(true)}
        title={cancelled ? "إعادة تفعيل" : "إلغاء الحركة"}
      >
        {cancelled ? <RotateCcw size={14} /> : <Ban size={14} />}
        {!compact && <span>{cancelled ? "إعادة تفعيل" : "إلغاء"}</span>}
      </Button>

      <Modal
        open={open}
        onClose={() => (busy ? null : setOpen(false))}
        maxWidth={520}
        title={
          <div className="flex items-center gap-2" style={{ color: "var(--text)" }}>
            {mode === "cancel" ? (
              <AlertTriangle size={18} style={{ color: "var(--red, #dc2626)" }} />
            ) : (
              <RotateCcw size={18} />
            )}
            <span>{mode === "cancel" ? "إلغاء الحركة المالية" : "إعادة تفعيل الحركة"}</span>
          </div>
        }
        footer={
          <div className="flex justify-end gap-2 w-full">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              تراجع
            </Button>
            <Button
              variant={mode === "cancel" ? "destructive" : "default"}
              onClick={submit}
              disabled={busy || !reason.trim()}
            >
              {busy && <Loader2 className="animate-spin" size={14} />}
              {mode === "cancel" ? "تأكيد الإلغاء" : "تأكيد إعادة التفعيل"}
            </Button>
          </div>
        }
      >
        <div className="space-y-4" dir="rtl">
          {mode === "cancel" && (
            <div
              className="rounded-md border p-3 text-sm flex gap-2"
              style={{
                background: "color-mix(in oklab, var(--red, #dc2626) 8%, transparent)",
                borderColor: "color-mix(in oklab, var(--red, #dc2626) 30%, transparent)",
                color: "var(--text)",
              }}
            >
              <AlertTriangle size={16} className="mt-0.5 shrink-0" style={{ color: "var(--red, #dc2626)" }} />
              <span>
                هذا الإجراء سيؤثر على الأرصدة والكشوف والتقارير المرتبطة بهذه الحركة.
              </span>
            </div>
          )}

          <div
            className="rounded-md border p-3 text-sm"
            style={{ background: "var(--card, #fff)", borderColor: "var(--border)" }}
          >
            <div className="font-medium mb-2" style={{ color: "var(--text)" }}>
              تفاصيل الحركة
            </div>
            {loadingRow ? (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader2 className="animate-spin" size={14} /> جاري التحميل…
              </div>
            ) : row ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
                <Row k="النوع" v={TABLE_LABEL[table]} />
                <Row k="التاريخ" v={date || "—"} />
                <Row
                  k="المبلغ"
                  v={amount != null ? amount.toLocaleString("en-US") : "—"}
                />
                <Row k="العملة" v={currency || "—"} />
                {counterparty && <Row k="البيان" v={counterparty} full />}
              </div>
            ) : (
              <div className="text-muted-foreground">تعذر تحميل التفاصيل</div>
            )}
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" style={{ color: "var(--text)" }}>
              سبب {mode === "cancel" ? "الإلغاء" : "إعادة التفعيل"}{" "}
              <span style={{ color: "var(--red, #dc2626)" }}>*</span>
            </label>
            <textarea
              autoFocus
              className="w-full rounded-md border px-3 py-2 text-sm min-h-24 focus:outline-none focus:ring-2"
              style={{ borderColor: "var(--border)", background: "var(--card, #fff)", color: "var(--text)" }}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={
                mode === "cancel"
                  ? "اكتب سبب إلغاء الحركة بوضوح (إلزامي)…"
                  : "اكتب سبب إعادة التفعيل…"
              }
              disabled={busy}
              dir="rtl"
            />
            {!reason.trim() && (
              <div className="text-xs text-muted-foreground">
                زر التأكيد سيصبح متاحاً بعد إدخال السبب.
              </div>
            )}
          </div>
        </div>
      </Modal>
    </>
  );
}

function Row({ k, v, full }: { k: string; v: string | number; full?: boolean }) {
  return (
    <div className={full ? "col-span-2 flex gap-2" : "flex gap-2"}>
      <span className="text-muted-foreground min-w-16">{k}:</span>
      <span className="font-medium" style={{ color: "var(--text)" }}>
        {v}
      </span>
    </div>
  );
}
