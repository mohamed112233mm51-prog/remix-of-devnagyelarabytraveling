// Shared helpers for "نشط/غير نشط" status across core entities
// (agents, issuing_companies, merchants, currency_suppliers).
//
// Dropdown call sites should expose only active rows, but always keep the
// currently-selected row visible so historical records still render the
// entity even after it has been deactivated.

export type WithStatus = { status?: string | null };

export function isActive(entity?: WithStatus | null): boolean {
  if (!entity) return true;
  return (entity.status || "نشط") === "نشط";
}

export function filterActive<T extends WithStatus>(rows: T[]): T[] {
  return rows.filter((r) => isActive(r));
}

/**
 * Returns rows whose status is active, plus the currently-selected row
 * (even if inactive) so old records keep showing the entity.
 */
export function activeWithSelected<T extends WithStatus & { id: string }>(
  rows: T[],
  selectedId?: string | null,
): T[] {
  const active = rows.filter((r) => isActive(r));
  if (!selectedId) return active;
  if (active.some((r) => r.id === selectedId)) return active;
  const sel = rows.find((r) => r.id === selectedId);
  return sel ? [...active, sel] : active;
}

/**
 * Build a dropdown option list from rows: actives only, but keep the
 * selected one (marked as "(غير نشط)") if it was deactivated after being saved.
 */
export function activeOptions<T extends WithStatus & { id: string }>(
  rows: T[],
  selectedId: string | null | undefined,
  labelOf: (r: T) => string,
): Array<{ value: string; label: string }> {
  const out: Array<{ value: string; label: string }> = [];
  for (const r of rows) {
    if (isActive(r)) out.push({ value: r.id, label: labelOf(r) });
  }
  if (selectedId && !out.some((o) => o.value === selectedId)) {
    const sel = rows.find((r) => r.id === selectedId);
    if (sel) out.push({ value: sel.id, label: `${labelOf(sel)} (غير نشط)` });
  }
  return out;
}
