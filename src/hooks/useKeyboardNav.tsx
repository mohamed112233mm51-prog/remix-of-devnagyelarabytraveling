import { useEffect } from "react";
import { openConfirmSave } from "@/components/ConfirmSaveModal";

/**
 * Global ERP-style keyboard navigation.
 *
 * Works on ALL forms in the app — including the many "form-like cards" that
 * are not wrapped in a real <form> element. Detects:
 *   - <form>, [data-kbd-form], [data-kbd-scope]
 *   - .modal-box (our Modal component)
 *   - .card (ERP cards used as forms across expenses, agents, settings, …)
 *
 * Behaviour:
 *   - Enter on input/select: prevent default, move to next eligible field;
 *     on last field, click the primary action button (btn-gold / btn-primary /
 *     [data-kbd-submit] / button[type=submit] / first button labelled حفظ /
 *     إضافة / تأكيد / save).
 *   - Enter on textarea: native newline. Ctrl/Cmd+Enter: submit.
 *   - ArrowDown/ArrowUp on text inputs: move to next/previous field.
 *     Left/Right untouched (RTL caret stays intact). Number/date/etc keep
 *     native arrow behaviour. Native <select> keeps native arrow handling.
 *   - Skips disabled / readonly / hidden / aria-hidden / display:none fields.
 *   - Skips any field or container marked with [data-no-kbd-nav].
 *   - Tab / Shift+Tab / mouse / Escape behave natively.
 */

const TEXT_INPUT_TYPES = new Set([
  "text", "email", "tel", "url", "password", "search", "",
]);

const SKIP_ARROW_INPUT_TYPES = new Set([
  "number", "range", "date", "time", "datetime-local",
  "month", "week", "radio", "checkbox", "color", "file",
]);

function isVisible(el: HTMLElement): boolean {
  if (el.hidden) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  const rect = el.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function isFieldEligible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.closest("[data-no-kbd-nav]")) return false;
  const anyEl = el as HTMLInputElement;
  if (anyEl.disabled) return false;
  if (anyEl.readOnly) return false;
  if (el.tabIndex < 0) return false;
  if (!isVisible(el)) return false;
  if (el instanceof HTMLInputElement) {
    if (el.type === "hidden") return false;
    if (["button", "submit", "reset", "image", "checkbox", "radio", "file"].includes(el.type)) return false;
    return true;
  }
  return el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement;
}

function findContainer(target: HTMLElement): HTMLElement | null {
  // Explicit opt-in / opt-out
  const explicit =
    (target.closest("[data-kbd-form]") as HTMLElement | null) ||
    (target.closest("[data-kbd-scope]") as HTMLElement | null);
  if (explicit) return explicit;
  // Modal takes precedence over card (modal may sit inside a card)
  const modal = target.closest(".modal-box") as HTMLElement | null;
  if (modal) return modal;
  // Native <form>
  const form = target.closest("form") as HTMLElement | null;
  if (form) return form;
  // ERP "card-as-form": nearest card that has at least one primary action
  // button or contains a form-footer / form-grid (typical add/edit cards).
  let node: HTMLElement | null = target.closest(".card") as HTMLElement | null;
  while (node) {
    if (
      node.querySelector(".form-footer, .form-grid, [data-kbd-submit], button.btn-gold, button.btn-primary, button[type='submit']")
    ) {
      return node;
    }
    node = node.parentElement?.closest(".card") as HTMLElement | null;
  }
  return null;
}

function collectFields(container: HTMLElement): HTMLElement[] {
  const nodes = container.querySelectorAll<HTMLElement>("input, select, textarea");
  const list: HTMLElement[] = [];
  nodes.forEach((n) => { if (isFieldEligible(n)) list.push(n); });
  return list;
}

function focusField(el: HTMLElement) {
  el.focus();
  if (el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type)) {
    try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
  } else if (el instanceof HTMLTextAreaElement) {
    try { el.setSelectionRange(el.value.length, el.value.length); } catch {}
  }
}

const SUBMIT_TEXT_RE = /(حفظ|إضافة|اضافة|تأكيد|تاكيد|إرسال|ارسال|تسجيل|دخول|save|submit|confirm|add|sign\s*in|log\s*in)/i;

function findSubmitButton(container: HTMLElement): HTMLButtonElement | null {
  // Priority order
  const selectors = [
    "[data-kbd-submit]:not([disabled])",
    "button[type='submit']:not([disabled])",
    ".form-footer button.btn-gold:not([disabled])",
    ".form-footer button.btn-primary:not([disabled])",
    ".modal-footer button.btn-gold:not([disabled])",
    ".modal-footer button.btn-primary:not([disabled])",
    "button.btn-gold:not([disabled])",
    "button.btn-primary:not([disabled])",
  ];
  for (const sel of selectors) {
    const el = container.querySelector<HTMLButtonElement>(sel);
    if (el) return el;
  }
  // Fallback: any visible button whose label matches the submit verbs.
  const buttons = container.querySelectorAll<HTMLButtonElement>("button:not([disabled])");
  for (const b of Array.from(buttons)) {
    const txt = (b.textContent || "").trim();
    if (txt && SUBMIT_TEXT_RE.test(txt)) return b;
  }
  return null;
}

function submitContainer(container: HTMLElement) {
  if (container instanceof HTMLFormElement) {
    if (typeof container.requestSubmit === "function") container.requestSubmit();
    else container.submit();
    return;
  }
  const btn = findSubmitButton(container);
  if (btn) btn.click();
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

      const key = e.key;
      const isTextarea = target instanceof HTMLTextAreaElement;
      const inputType = target instanceof HTMLInputElement ? target.type : "";

      // Enter inside textarea = open save-confirmation modal (no newline).
      // Shift+Enter still inserts a newline for the rare case the user needs it.
      if (isTextarea && key === "Enter" && !e.shiftKey) {
        if (e.isComposing) return;
        const container = findContainer(target);
        if (!container) return;
        e.preventDefault();
        openConfirmSave(() => submitContainer(container));
        return;
      }

      if (key === "Enter" && !e.shiftKey && !e.ctrlKey) {
        if (e.isComposing) return;
        const container = findContainer(target);
        if (!container) return;
        const fields = collectFields(container);
        const idx = fields.indexOf(target);
        if (idx === -1) return;
        e.preventDefault();
        if (idx < fields.length - 1) {
          focusField(fields[idx + 1]);
        } else {
          openConfirmSave(() => submitContainer(container));
        }
        return;
      }

      if (key === "ArrowDown" || key === "ArrowUp") {
        if (isTextarea) return;
        if (SKIP_ARROW_INPUT_TYPES.has(inputType)) return;
        if (target instanceof HTMLSelectElement) return;
        const container = findContainer(target);
        if (!container) return;
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

    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
