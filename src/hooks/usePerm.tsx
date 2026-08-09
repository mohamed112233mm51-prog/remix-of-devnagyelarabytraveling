import { useAuth } from "@/hooks/useAuth";
import { hasPermission, hasProfitViewPermission, NET_PROFIT_PERMISSION_KEY, PROFIT_SUMMARY_PERMISSION_KEY, normalizePermissionsForLoad } from "@/lib/permissionKeys";

export { NET_PROFIT_PERMISSION_KEY, PROFIT_SUMMARY_PERMISSION_KEY } from "@/lib/permissionKeys";

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
  "investors",
  "expenses",
  "reports",
  "data_import",
  "service_pricing_manage",
  "service_price_search",
  "financial_cancel",
  "financial_transaction_update",
  "audit_log_view",
  NET_PROFIT_PERMISSION_KEY,
  PROFIT_SUMMARY_PERMISSION_KEY,
] as const;

/**
 * Maps a financial-transaction table to the ERP section whose permission
 * governs edit/cancel actions on its rows. Used by EditTransactionButton and
 * CancelTransactionButton so that a section manager (e.g. agents_manage,
 * companies_manage) can maintain their own section's ledger without needing
 * a blanket Admin role. Returns null for tables that have no single owning
 * section (e.g. payment_splits, which is derived from a parent row).
 */
export function sectionForFinancialTable(table: string): string | null {
  switch (table) {
    case "transactions":
      return "accounts";
    case "company_transactions":
      return "companies";
    case "currency_supplier_transactions":
      return "currency_suppliers";
    case "merchant_cash_collections":
      return "merchants";
    case "investor_transactions":
      return "investors";
    case "expense_deductions":
      return "expenses";
    case "usd_treasury_transactions":
      return "reports";
    default:
      return null;
  }
}

/**
 * Grants a financial edit/cancel action if the user has EITHER:
 *   1. the legacy blanket permission (financial_transaction_update / financial_cancel), OR
 *   2. the matching action on the section that owns the row's table.
 * Admin/SuperAdmin bypass through the standard checkPerm(_, isAdmin, ...) path.
 */
export function checkFinancialActionPerm(
  perms: Record<string, any> | undefined | null,
  isAdmin: boolean,
  isSuperAdmin: boolean,
  table: string,
  action: "edit" | "delete",
): boolean {
  if (isSuperAdmin || isAdmin) return true;
  const legacyKey = action === "edit" ? "financial_transaction_update" : "financial_cancel";
  if (checkPerm(perms, false, legacyKey, action)) return true;
  const section = sectionForFinancialTable(table);
  if (section && checkPerm(perms, false, section, action)) return true;
  return false;
}

// Settings sub-permissions (stored under permissions.settings.{key})
export const SETTINGS_SUB_KEYS = [
  "users_manage",
  "roles_manage",
  "backups_manage",
  "company_manage",
  "system_tools",
  "import_data",
  "change_password",
] as const;
export type SettingsSubKey = typeof SETTINGS_SUB_KEYS[number];

export const SETTINGS_SUB_LABELS: Record<SettingsSubKey, string> = {
  users_manage: "إدارة المستخدمين",
  roles_manage: "إدارة الصلاحيات",
  backups_manage: "النسخ الاحتياطي",
  company_manage: "إعدادات الشركة",
  system_tools: "أدوات النظام",
  import_data: "مركز البيانات / الاستيراد",
  change_password: "تغيير كلمة السر",
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
  "/investors": "investors",
  "/expenses": "expenses",
  "/reports": "reports",
  "/data-import": "data_import",
  "/audit-log": "audit_log_view",
};

export function checkPerm(
  perms: Record<string, any> | undefined | null,
  isAdmin: boolean,
  section: string | null | undefined,
  action: PermAction = "view",
): boolean {
  if (!section) return true;
  if ((section === NET_PROFIT_PERMISSION_KEY || section === PROFIT_SUMMARY_PERMISSION_KEY) && action === "view") {
    return hasProfitViewPermission(normalizePermissionsForLoad(perms ?? {}), isAdmin, section);
  }
  if (isAdmin) return true;
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
 * Strict section check used for sensitive in-page permissions.
 * Strict section check used for sensitive in-page permissions. For profit
 * permissions, `isSuperAdmin` may also be an admin-or-owner bypass flag.
 */
export function checkOwnerOrExplicitPerm(
  perms: Record<string, any> | undefined | null,
  isSuperAdmin: boolean,
  section: string | null | undefined,
  action: PermAction = "view",
): boolean {
  if ((section === NET_PROFIT_PERMISSION_KEY || section === PROFIT_SUMMARY_PERMISSION_KEY) && action === "view") {
    return hasProfitViewPermission(perms, isSuperAdmin, section);
  }
  return !!isSuperAdmin || checkPerm(perms, false, section, action);
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
