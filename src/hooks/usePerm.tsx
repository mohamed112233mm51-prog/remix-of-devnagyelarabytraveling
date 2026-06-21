import { useAuth } from "@/hooks/useAuth";

export type PermAction = "view" | "create" | "edit" | "delete" | "export";

export const ALL_ACTIONS: PermAction[] = ["view", "create", "edit", "delete", "export"];

export const SECTION_KEYS = [
  "dashboard",
  "submissions",
  "executions",
  "accounts",
  "companies",
  "merchants",
  "currency_suppliers",
  "expenses",
  "reports",
  "data_import",
] as const;

// Settings sub-permissions (stored under permissions.settings.{key})
export const SETTINGS_SUB_KEYS = [
  "users_manage",
  "roles_manage",
  "backups_manage",
  "company_manage",
  "system_tools",
  "import_data",
] as const;
export type SettingsSubKey = typeof SETTINGS_SUB_KEYS[number];

export const SETTINGS_SUB_LABELS: Record<SettingsSubKey, string> = {
  users_manage: "إدارة المستخدمين",
  roles_manage: "إدارة الصلاحيات",
  backups_manage: "النسخ الاحتياطي",
  company_manage: "إعدادات الشركة",
  system_tools: "أدوات النظام",
  import_data: "مركز البيانات / الاستيراد",
};

// Map route path -> permission section key (null = always allowed)
export const ROUTE_PERM: Record<string, string | null> = {
  "/": "dashboard",
  "/submissions": "submissions",
  "/executions": "executions",
  "/accounts": "accounts",
  "/companies": "companies",
  "/merchants": "merchants",
  "/currency-suppliers": "currency_suppliers",
  "/expenses": "expenses",
  "/reports": "reports",
  "/data-import": "data_import",
};

export function checkPerm(
  perms: Record<string, any> | undefined | null,
  isAdmin: boolean,
  section: string | null | undefined,
  action: PermAction = "view",
): boolean {
  if (isAdmin) return true;
  if (!section) return true;
  const v = perms?.[section];
  if (v === true) return true; // legacy boolean = all actions
  if (!v) return false;
  if (typeof v === "object") {
    if (action === "view") {
      if (v.view === true) return true;
      if (v.view === false) return false;
      return ALL_ACTIONS.some((a) => v[a] === true);
    }
    return v[action] === true;
  }
  return false;
}

/**
 * Settings permissions are NOT auto-granted to admin role.
 * Only `isSuperAdmin` bypasses them. Admin users must be explicitly granted.
 */
export function checkSettingsPerm(
  perms: Record<string, any> | undefined | null,
  isSuperAdmin: boolean,
  sub: SettingsSubKey | "view",
): boolean {
  if (isSuperAdmin) return true;
  const s = perms?.settings;
  if (!s || typeof s !== "object") return false;
  if (sub === "view") {
    if (s.view === true) return true;
    return SETTINGS_SUB_KEYS.some((k) => s[k] === true);
  }
  return s[sub] === true;
}

export function usePerm(section: string | null | undefined) {
  const { permissions, isAdmin } = useAuth();
  return {
    view: checkPerm(permissions, isAdmin, section, "view"),
    create: checkPerm(permissions, isAdmin, section, "create"),
    edit: checkPerm(permissions, isAdmin, section, "edit"),
    delete: checkPerm(permissions, isAdmin, section, "delete"),
    export: checkPerm(permissions, isAdmin, section, "export"),
    isAdmin,
  };
}

export function useSettingsPerm() {
  const { permissions, isSuperAdmin } = useAuth();
  const view = checkSettingsPerm(permissions, isSuperAdmin, "view");
  const subs = Object.fromEntries(
    SETTINGS_SUB_KEYS.map((k) => [k, checkSettingsPerm(permissions, isSuperAdmin, k)]),
  ) as Record<SettingsSubKey, boolean>;
  return { view, isSuperAdmin, ...subs };
}

export function firstAllowedRoute(
  perms: Record<string, any> | undefined | null,
  isAdmin: boolean,
  isSuperAdmin: boolean = false,
): string | null {
  for (const [route, key] of Object.entries(ROUTE_PERM)) {
    if (checkPerm(perms, isAdmin, key, "view")) return route;
  }
  if (checkSettingsPerm(perms, isSuperAdmin, "view")) return "/settings";
  return null;
}
