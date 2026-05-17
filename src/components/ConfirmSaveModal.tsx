import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/Modal";

type Listener = (onConfirm: () => void, title?: string) => void;
let listener: Listener | null = null;

export function openConfirmSave(onConfirm: () => void, title?: string) {
  if (listener) listener(onConfirm, title);
  else onConfirm();
}

/**
 * Global modal mounted once at root. Triggered via openConfirmSave(onConfirm).
 * - Title: "تأكيد حفظ نموذج التقديم"
 * - Enter (focused on Save button) confirms
 * - Esc cancels (handled by Modal)
 * - Save button auto-focused on open
 */
export function ConfirmSaveModalHost() {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("تأكيد حفظ نموذج التقديم");
  const handlerRef = useRef<(() => void) | null>(null);
  const saveBtnRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    listener = (onConfirm, customTitle) => {
      handlerRef.current = onConfirm;
      setTitle(customTitle || "تأكيد حفظ نموذج التقديم");
      setOpen(true);
    };
    return () => { listener = null; };
  }, []);

  useEffect(() => {
    if (open) {
      const t = setTimeout(() => saveBtnRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [open]);

  const close = () => setOpen(false);
  const confirm = () => {
    const fn = handlerRef.current;
    setOpen(false);
    handlerRef.current = null;
    if (fn) {
      try { fn(); } catch (e) { console.error(e); }
    }
  };

  return (
    <Modal
      open={open}
      onClose={close}
      title={title}
      maxWidth={460}
      footer={
        <>
          <button className="btn" onClick={close} data-no-kbd-nav>إلغاء</button>
          <button
            ref={saveBtnRef}
            className="btn btn-gold"
            onClick={confirm}
            data-no-kbd-nav
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); confirm(); }
            }}
          >
            حفظ
          </button>
        </>
      }
    >
      <div style={{ fontSize: 14, color: "#334155", lineHeight: 1.8 }} data-no-kbd-nav>
        هل تريد حفظ هذا النموذج؟
      </div>
    </Modal>
  );
}
