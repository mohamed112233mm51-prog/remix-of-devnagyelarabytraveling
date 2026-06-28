export const NET_PROFIT_PERMISSION_KEY = "net_profit_view" as const;
export const PROFIT_SUMMARY_PERMISSION_KEY = "profit_summary_view" as const;

const LEGACY_NET_PROFIT_PERMISSION_KEY = "net_profit";
const LEGACY_PROFIT_SUMMARY_PERMISSION_KEY = "profit_summary";

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

export function isProfitPermissionKey(key: string | null | undefined): key is typeof PROFIT_PERMISSION_KEYS[number] {
  return key === NET_PROFIT_PERMISSION_KEY || key === PROFIT_SUMMARY_PERMISSION_KEY;
}

export function hasPermission(
  permissions: Record<string, any> | null | undefined,
  key: string | null | undefined,
): boolean {
  if (!key) return false;
  return permissions?.[key] === true;
}

export function hasExplicitPermission(
  permissions: Record<string, any> | null | undefined,
  key: string | null | undefined,
): boolean {
  if (!key) return false;
  return permissions?.[key] === true;
}

export function normalizePermissionsForLoad<T extends Record<string, any>>(permissions: T | null | undefined): Record<string, any> {
  const out = { ...(permissions ?? {}) };
  // Profit permissions are intentionally strict: only the new keys with a
  // literal boolean true grant access. Missing keys, legacy keys, objects like
  // { view: true }, undefined, null, or any non-true value are denied.
  for (const key of PROFIT_PERMISSION_KEYS) {
    out[key] = out[key] === true;
  }
  delete out[LEGACY_NET_PROFIT_PERMISSION_KEY];
  delete out[LEGACY_PROFIT_SUMMARY_PERMISSION_KEY];
  return out;
}

export const normalizePermissionsForSave = normalizePermissionsForLoad;

export function hasProfitViewPermission(
  permissions: Record<string, any> | null | undefined,
  isAdminOrSuperAdmin: boolean,
  key: typeof PROFIT_PERMISSION_KEYS[number],
) {
  if (isAdminOrSuperAdmin) return true;
  return hasExplicitPermission(permissions, key);
}

export function canViewProfitPermission(
  permissions: Record<string, any> | null | undefined,
  subject: { roles?: readonly string[]; isAdmin?: boolean; isSuperAdmin?: boolean },
  key: typeof PROFIT_PERMISSION_KEYS[number],
) {
  const isAdminRole = subject.isAdmin === true || subject.roles?.includes("admin") === true;
  if (subject.isSuperAdmin === true || isAdminRole) return true;
  return hasExplicitPermission(permissions, key);
}
