import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Global ERP modal wrapper.
 * - Renders into document.body via portal so it always centers in the viewport,
 *   regardless of any transformed/scrollable ancestor (table rows, cards, lists).
 * - Locks background scroll while open.
 * - Closes on ESC and on backdrop click.
 * - Uses the existing .modal-overlay / .modal-box ERP styles from src/erp.css.
 */
export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = 640,
  closeOnBackdrop = true,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  maxWidth?: number;
  closeOnBackdrop?: boolean;
}) {
  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarW = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarW > 0) document.body.style.paddingRight = `${scrollbarW}px`;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="modal-overlay open"
      onClick={(e) => {
        if (closeOnBackdrop && e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-box" style={{ maxWidth }}>
        {(title || onClose) && (
          <div className="modal-header">
            <div className="modal-title">{title}</div>
            <button className="modal-close" onClick={onClose} aria-label="إغلاق">×</button>
          </div>
        )}
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}
