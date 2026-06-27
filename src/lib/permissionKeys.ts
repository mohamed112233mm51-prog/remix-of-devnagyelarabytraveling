export const NET_PROFIT_PERMISSION_KEY = "net_profit_view" as const;
export const PROFIT_SUMMARY_PERMISSION_KEY = "profit_summary_view" as const;

const LEGACY_NET_PROFIT_PERMISSION_KEY = "net_profit" as const;
const LEGACY_PROFIT_SUMMARY_PERMISSION_KEY = "profit_summary" as const;

export const PROFIT_PERMISSION_KEYS = [
  NET_PROFIT_PERMISSION_KEY,
  PROFIT_SUMMARY_PERMISSION_KEY,
] as const;

const LEGACY_PROFIT_PERMISSION_KEYS: Record<typeof PROFIT_PERMISSION_KEYS[number], string> = {
  [NET_PROFIT_PERMISSION_KEY]: LEGACY_NET_PROFIT_PERMISSION_KEY,
  [PROFIT_SUMMARY_PERMISSION_KEY]: LEGACY_PROFIT_SUMMARY_PERMISSION_KEY,
};

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

function permissionValueToViewBoolean(value: unknown): boolean {
  if (value === true) return true;
  if (value && typeof value === "object") {
    return normalizePermissionBranch(value).view === true;
  }
  return false;
}

export function isProfitPermissionKey(key: string | null | undefined): key is typeof PROFIT_PERMISSION_KEYS[number] {
  return key === NET_PROFIT_PERMISSION_KEY || key === PROFIT_SUMMARY_PERMISSION_KEY;
}

export function hasPermission(
  permissions: Record<string, any> | null | undefined,
  key: string | null | undefined,
): boolean {
  if (!key) return true;
  return permissions?.[key] === true;
}

export function normalizePermissionsForLoad<T extends Record<string, any>>(permissions: T | null | undefined): Record<string, any> {
  const out = { ...(permissions ?? {}) };
  for (const key of PROFIT_PERMISSION_KEYS) {
    const legacyKey = LEGACY_PROFIT_PERMISSION_KEYS[key];
    const hasNewKey = Object.prototype.hasOwnProperty.call(out, key);
    out[key] = hasNewKey
      ? permissionValueToViewBoolean(out[key])
      : permissionValueToViewBoolean(out[legacyKey]);
    delete out[legacyKey];
  }
  return out;
}

export const normalizePermissionsForSave = normalizePermissionsForLoad;

export function hasProfitViewPermission(
  permissions: Record<string, any> | null | undefined,
  isSuperAdmin: boolean,
  key: typeof PROFIT_PERMISSION_KEYS[number],
) {
  if (isSuperAdmin) return true;
  return hasPermission(permissions, key);
}
