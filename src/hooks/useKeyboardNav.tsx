import { useEffect } from "react";

/**
 * Global ERP-style keyboard navigation.
 *
 * Behaviour (system-wide, opt-out via `data-no-kbd-nav` on a field or container):
 *  - Enter inside <input>/<select> moves focus to the next field in the same
 *    form/modal/container. If it is the last field, the primary submit button
 *    of that container is clicked (HTML5 validation still runs).
 *  - Enter inside <textarea> inserts a newline (native). Ctrl/Cmd+Enter submits.
 *  - ArrowDown / ArrowUp move to next / previous field for text-like inputs and
 *    <select>. Number/date/range/radio/checkbox keep native arrow behaviour.
 *  - ArrowLeft / ArrowRight are NOT intercepted (RTL caret movement stays intact).
 *  - Escape on Modal is already handled by <Modal />.
 *  - Tab / Shift+Tab keep native behaviour.
 *  - Mouse and touch are not affected.
 */

const TEXT_INPUT_TYPES = new Set([
  "text",
  "email",
  "tel",
  "url",
  "password",
  "search",
  "",
]);

const SKIP_ARROW_INPUT_TYPES = new Set([
  "number",
  "range",
  "date",
  "time",
  "datetime-local",
  "month",
  "week",
  "radio",
  "checkbox",
  "color",
  "file",
]);

function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isFieldEligible(el: Element): el is HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest("[data-no-kbd-nav]")) return false;
  if ((el as HTMLInputElement).disabled) return false;
  if ((el as HTMLInputElement).readOnly) return false;
  if (el.tabIndex < 0) return false;
  if (!isVisible(el)) return false;
  if (el instanceof HTMLInputElement) {
    if (el.type === "hidden") return false;
    if (["button", "submit", "reset", "image"].includes(el.type)) return false;
    return true;
  }
  return el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}

function findContainer(target: HTMLElement): HTMLElement | null {
  return (
    target.closest("[data-kbd-form]") as HTMLElement | null) ||
    (target.closest("form") as HTMLElement | null) ||
    (target.closest(".modal-box") as HTMLElement | null) ||
    (target.closest("[data-kbd-scope]") as HTMLElement | null);
}

function collectFields(container: HTMLElement): HTMLElement[] {
  const nodes = container.querySelectorAll<HTMLElement>(
    "input, select, textarea",
  );
  const list: HTMLElement[] = [];
  nodes.forEach((n) => {
    if (isFieldEligible(n)) list.push(n);
  });
  return list;
}

function focusField(el: HTMLElement) {
  el.focus();
  // Place caret at end for text inputs / textareas for fast typing.
  if (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type)) {
    try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
  } else if (el instanceof HTMLTextAreaElement) {
    try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
  } else if (el instanceof HTMLSelectElement) {
    // no-op
  }
}

function submitContainer(container: HTMLElement) {
  // Native <form>: rely on requestSubmit so validation runs.
  if (container instanceof HTMLFormElement) {
    if (typeof container.requestSubmit === "function") {
      container.requestSubmit();
    } else {
      container.submit();
    }
    return;
  }
  // Modal / custom container: click the explicit submit button.
  const explicit = container.querySelector<HTMLButtonElement>(
    "[data-kbd-submit]:not([disabled])",
  );
  if (explicit) { explicit.click(); return; }
  const submitBtn = container.querySelector<HTMLButtonElement>(
    "button[type='submit']:not([disabled])",
  );
  if (submitBtn) { submitBtn.click(); return; }
  // Last resort: first primary button in footer / container.
  const footer = container.querySelector<HTMLElement>(".modal-footer");
  const scope = footer || container;
  const primary = scope.querySelector<HTMLButtonElement>(
    "button.btn-primary:not([disabled]), button.btn.btn-primary:not([disabled])",
  );
  if (primary) primary.click();
}

export function useGlobalKeyboardNav() {
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.defaultPrevented) return;
      if (e.altKey || e.metaKey) return;
      const target = e.target as HTMLElement | null;
      if (!target) return;
      if (!(target instanceof HTMLInputElement) &&
          !(target instanceof HTMLSelectElement) &&
          !(target instanceof HTMLTextAreaElement)) return;
      if (target.closest("[data-no-kbd-nav]")) return;
      if ((target as HTMLElement).isContentEditable) return;

      const container = findContainer(target);
      if (!container) return;

      const key = e.key;
      const isTextarea = target instanceof HTMLTextAreaElement;
      const inputType = target instanceof HTMLInputElement ? target.type : "";

      // Ctrl+Enter inside textarea = submit
      if (isTextarea && key === "Enter" && e.ctrlKey) {
        e.preventDefault();
        submitContainer(container);
        return;
      }

      // Plain Enter
      if (key === "Enter" && !e.shiftKey && !e.ctrlKey) {
        if (isTextarea) return; // newline
        // Let composition (IME) finish naturally
        if (e.isComposing) return;
        // Skip if it's a button-like input we shouldn't intercept
        const fields = collectFields(container);
        const idx = fields.indexOf(target);
        if (idx === -1) return;
        e.preventDefault();
        if (idx < fields.length - 1) {
          focusField(fields[idx + 1]);
        } else {
          submitContainer(container);
        }
        return;
      }

      // Arrow navigation (Up/Down only — Left/Right stays native for RTL caret)
      if (key === "ArrowDown" || key === "ArrowUp") {
        if (isTextarea) return; // native caret movement
        if (SKIP_ARROW_INPUT_TYPES.has(inputType)) return;
        // <select> native handling cycles options; don't hijack.
        if (target instanceof HTMLSelectElement) return;
        const fields = collectFields(container);
        const idx = fields.indexOf(target);
        if (idx === -1) return;
        const nextIdx = key === "ArrowDown" ? idx + 1 : idx - 1;
        if (nextIdx < 0 || nextIdx >= fields.length) return;
        e.preventDefault();
        focusField(fields[nextIdx]);
        return;
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
}
