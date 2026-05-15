import { toast } from "sonner";

/**
 * Promise-based confirm dialog using sonner toast (Arabic RTL).
 * Replaces native window.confirm.
 */
export function confirmDialog(
  message: string,
  opts?: { confirmLabel?: string; cancelLabel?: string },
): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const settle = (v: boolean) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const id = toast(message, {
      duration: 15000,
      action: {
        label: opts?.confirmLabel ?? "تأكيد",
        onClick: () => {
          settle(true);
          toast.dismiss(id);
        },
      },
      cancel: {
        label: opts?.cancelLabel ?? "إلغاء",
        onClick: () => {
          settle(false);
          toast.dismiss(id);
        },
      },
      onDismiss: () => settle(false),
      onAutoClose: () => settle(false),
    });
  });
}
