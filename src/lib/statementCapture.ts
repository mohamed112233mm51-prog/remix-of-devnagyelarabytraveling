import { useEffect } from "react";
import type { StatementExportData } from "./exportStatement";

export type StatementCaptureContext = {
  /** The clean statement data used to render the offscreen image. */
  data: StatementExportData;
  /** WhatsApp number to enable the "إرسال عبر واتساب" button. */
  whatsapp?: string | null;
  /** Optional id (e.g. agent id) for tracking. */
  contextId?: string | null;
};

export type StatementCaptureProvider = () => StatementCaptureContext;

let currentProvider: StatementCaptureProvider | null = null;
const listeners = new Set<() => void>();

export function getStatementProvider(): StatementCaptureProvider | null {
  return currentProvider;
}

export function setStatementProvider(p: StatementCaptureProvider | null) {
  currentProvider = p;
  listeners.forEach((l) => l());
}

export function subscribeStatementProvider(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Register the current page as a statement source.
 * The screenshot tool will use this to render a clean PNG from data
 * instead of capturing the visible DOM.
 */
export function useRegisterStatementCapture(
  provider: StatementCaptureProvider | null,
  deps: React.DependencyList,
) {
  useEffect(() => {
    if (!provider) return;
    setStatementProvider(provider);
    return () => {
      if (currentProvider === provider) setStatementProvider(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
