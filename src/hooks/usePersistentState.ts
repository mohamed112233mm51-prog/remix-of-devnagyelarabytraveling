import { useEffect, useRef, useState, useCallback } from "react";

/**
 * Like useState, but the value is mirrored to sessionStorage under `key`.
 * - On mount: hydrates from sessionStorage if present, else uses `initial`.
 * - On change: writes to sessionStorage.
 * - clear(): removes the key (and resets in-memory state to `initial`).
 *
 * Use this to preserve form values across modal close/reopen within the
 * same browser tab. sessionStorage is automatically cleared when the user
 * closes the tab — matching the requirement "تمسح عند مغادرة الصفحة بالكامل".
 */
export function usePersistentState<T>(
  key: string,
  initial: T,
): [T, React.Dispatch<React.SetStateAction<T>>, () => void] {
  const initialRef = useRef(initial);
  const [state, setState] = useState<T>(() => {
    if (typeof window === "undefined") return initial;
    try {
      const raw = window.sessionStorage.getItem(key);
      if (raw == null) return initial;
      return JSON.parse(raw) as T;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.sessionStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* quota / serialization errors are non-fatal */
    }
  }, [key, state]);

  const clear = useCallback(() => {
    if (typeof window !== "undefined") {
      try { window.sessionStorage.removeItem(key); } catch { /* ignore */ }
    }
    setState(initialRef.current);
  }, [key]);

  return [state, setState, clear];
}
