export const NET_PROFIT_PERMISSION_KEY = "net_profit" as const;
export const PROFIT_SUMMARY_PERMISSION_KEY = "profit_summary" as const;

export const PROFIT_PERMISSION_KEYS = [
  NET_PROFIT_PERMISSION_KEY,
  PROFIT_SUMMARY_PERMISSION_KEY,
] as const;

export type PermissionAction = "view" | "create" | "edit" | "delete" | "export";

export const PERMISSION_ACTIONS: PermissionAction[] = ["view", "create", "edit", "delete", "export"];

export function normalizePermissionBranch(value: unknown): Record<PermissionAction, boolean> {
  if (value === true) {
    return { view: true, create: true, edit: true, delete: true, export: true };
  }
  if (value && typeof value === "object") {
    const v = value as Record<string, unknown>;
    return {
      view: v.view === true,
      create: v.create === true,
      edit: v.edit === true,
      delete: v.delete === true,
      export: v.export === true,
    };
  }
  return { view: false, create: false, edit: false, delete: false, export: false };
}

export function normalizeProfitPermissionsForSave<T extends Record<string, any>>(permissions: T | null | undefined): Record<string, any> {
  const out = { ...(permissions ?? {}) };
  for (const key of PROFIT_PERMISSION_KEYS) {
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      out[key] = normalizePermissionBranch(out[key]);
    }
  }
  return out;
}

export function hasProfitViewPermission(
  permissions: Record<string, any> | null | undefined,
  isSuperAdmin: boolean,
  key: typeof PROFIT_PERMISSION_KEYS[number],
) {
  if (isSuperAdmin) return true;
  const branch = normalizePermissionBranch(permissions?.[key]);
  return PERMISSION_ACTIONS.some((action) => branch[action] === true);
}
