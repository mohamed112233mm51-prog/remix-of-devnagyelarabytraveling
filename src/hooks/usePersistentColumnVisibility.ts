import { useCallback, useEffect, useState } from "react";
import { sanitizeVisibility, type ColumnDef } from "@/components/ColumnVisibility";
import { useAuth } from "@/hooks/useAuth";

const PREFIX = "column_visibility";

function storageKey(userId: string | undefined | null, tableKey: string) {
  return `${PREFIX}:${userId || "guest"}:${tableKey}`;
}

function readStored(userId: string | undefined | null, tableKey: string, columns: ColumnDef[]) {
  if (typeof window === "undefined") return sanitizeVisibility(undefined, columns);
  try {
    const raw = window.localStorage.getItem(storageKey(userId, tableKey));
    if (!raw) return sanitizeVisibility(undefined, columns);
    return sanitizeVisibility(JSON.parse(raw), columns);
  } catch {
    return sanitizeVisibility(undefined, columns);
  }
}

/**
 * Persists per-user, per-table column visibility in localStorage.
 * Hidden columns stay hidden across refresh / re-login until manually shown.
 */
export function usePersistentColumnVisibility(tableKey: string, columns: ColumnDef[]) {
  const { user } = useAuth();
  const userId = user?.id;
  const [visible, setVisibleState] = useState<Record<string, boolean>>(() =>
    readStored(userId, tableKey, columns),
  );

  // Reload when user identity changes (login/logout/switch).
  useEffect(() => {
    setVisibleState(readStored(userId, tableKey, columns));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, tableKey]);

  const setVisible = useCallback(
    (next: Record<string, boolean>) => {
      const sanitized = sanitizeVisibility(next, columns);
      setVisibleState(sanitized);
      try {
        window.localStorage.setItem(storageKey(userId, tableKey), JSON.stringify(sanitized));
      } catch {
        /* ignore quota / privacy errors */
      }
    },
    [userId, tableKey, columns],
  );

  return [visible, setVisible] as const;
}
