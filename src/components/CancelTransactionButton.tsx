import { useState } from "react";
import { Ban, RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import {
  cancelFinancialTransaction,
  restoreFinancialTransaction,
  type CancellableTable,
} from "@/lib/financialEngine.cancel";
import { useAuth } from "@/hooks/useAuth";
import { checkPerm } from "@/hooks/usePerm";

type Mode = "cancel" | "restore";

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
  const mode: Mode = cancelled ? "restore" : "cancel";

  if (!allowed) return null;

  const submit = async () => {
    if (!reason.trim()) {
      toast.error("سبب مطلوب");
      return;
    }
    setBusy(true);
    try {
      if (mode === "cancel") {
        await cancelFinancialTransaction({ table, id, reason });
        toast.success("تم إلغاء الحركة");
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

      <Dialog open={open} onOpenChange={(v) => (busy ? null : setOpen(v))}>
        <DialogContent dir="rtl">
          <DialogHeader>
            <DialogTitle>{mode === "cancel" ? "إلغاء حركة مالية" : "إعادة تفعيل حركة"}</DialogTitle>
            <DialogDescription>
              {mode === "cancel"
                ? "سيتم عكس أثر هذه الحركة من جميع الأرصدة والكشوف. لا يمكن التراجع إلا عبر إعادة التفعيل."
                : "سيتم إعادة احتساب أثر هذه الحركة في جميع الأرصدة والكشوف."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <label className="text-sm font-medium">السبب</label>
            <textarea
              className="w-full rounded-md border px-3 py-2 text-sm min-h-24"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={mode === "cancel" ? "لماذا يتم إلغاء هذه الحركة؟" : "لماذا يتم إعادة تفعيلها؟"}
              disabled={busy}
              dir="rtl"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              رجوع
            </Button>
            <Button
              variant={mode === "cancel" ? "destructive" : "default"}
              onClick={submit}
              disabled={busy || !reason.trim()}
            >
              {busy && <Loader2 className="animate-spin" size={14} />}
              {mode === "cancel" ? "تأكيد الإلغاء" : "تأكيد إعادة التفعيل"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
