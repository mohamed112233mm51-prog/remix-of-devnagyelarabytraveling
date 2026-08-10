from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match, found {count}")
    return text.replace(old, new, 1)

# 1) Shared permission keys: add a strict, view-only dashboard permission.
p = Path("src/lib/permissionKeys.ts")
text = p.read_text(encoding="utf-8")
text = replace_once(
    text,
    'export const PROFIT_SUMMARY_PERMISSION_KEY = "profit_summary_view" as const;\n',
    'export const PROFIT_SUMMARY_PERMISSION_KEY = "profit_summary_view" as const;\nexport const FINANCIAL_POSITION_PERMISSION_KEY = "financial_position_view" as const;\n',
    "add financial-position key",
)
text = replace_once(
    text,
    '''export const PROFIT_PERMISSION_KEYS = [\n  NET_PROFIT_PERMISSION_KEY,\n  PROFIT_SUMMARY_PERMISSION_KEY,\n] as const;\n''',
    '''export const PROFIT_PERMISSION_KEYS = [\n  NET_PROFIT_PERMISSION_KEY,\n  PROFIT_SUMMARY_PERMISSION_KEY,\n] as const;\n\nexport const DASHBOARD_VIEW_PERMISSION_KEYS = [\n  ...PROFIT_PERMISSION_KEYS,\n  FINANCIAL_POSITION_PERMISSION_KEY,\n] as const;\n\nexport type DashboardViewPermissionKey = typeof DASHBOARD_VIEW_PERMISSION_KEYS[number];\n''',
    "add dashboard view-only key list",
)
text = replace_once(
    text,
    '''export function isProfitPermissionKey(key: string | null | undefined): key is typeof PROFIT_PERMISSION_KEYS[number] {\n  return key === NET_PROFIT_PERMISSION_KEY || key === PROFIT_SUMMARY_PERMISSION_KEY;\n}\n''',
    '''export function isProfitPermissionKey(key: string | null | undefined): key is typeof PROFIT_PERMISSION_KEYS[number] {\n  return key === NET_PROFIT_PERMISSION_KEY || key === PROFIT_SUMMARY_PERMISSION_KEY;\n}\n\nexport function isDashboardViewPermissionKey(key: string | null | undefined): key is DashboardViewPermissionKey {\n  return key === NET_PROFIT_PERMISSION_KEY\n    || key === PROFIT_SUMMARY_PERMISSION_KEY\n    || key === FINANCIAL_POSITION_PERMISSION_KEY;\n}\n''',
    "add dashboard view-only detector",
)
text = replace_once(
    text,
    '''  // Profit permissions are intentionally strict: only the new keys with a\n  // literal boolean true grant access. Missing keys, legacy keys, objects like\n  // { view: true }, undefined, null, or any non-true value are denied.\n  for (const key of PROFIT_PERMISSION_KEYS) {\n    out[key] = out[key] === true;\n  }\n''',
    '''  // Sensitive dashboard-card permissions are intentionally strict: only a\n  // literal boolean true grants access. Missing keys, objects like { view: true },\n  // undefined, null, or any non-true value are denied.\n  for (const key of DASHBOARD_VIEW_PERMISSION_KEYS) {\n    out[key] = out[key] === true;\n  }\n''',
    "normalize strict dashboard permissions",
)
text = replace_once(
    text,
    '''export function hasProfitViewPermission(\n  permissions: Record<string, any> | null | undefined,\n  isAdminOrSuperAdmin: boolean,\n  key: typeof PROFIT_PERMISSION_KEYS[number],\n) {\n  if (isAdminOrSuperAdmin) return true;\n  return hasExplicitPermission(permissions, key);\n}\n''',
    '''export function hasDashboardViewPermission(\n  permissions: Record<string, any> | null | undefined,\n  isAdminOrSuperAdmin: boolean,\n  key: DashboardViewPermissionKey,\n) {\n  if (isAdminOrSuperAdmin) return true;\n  return hasExplicitPermission(permissions, key);\n}\n\nexport function hasProfitViewPermission(\n  permissions: Record<string, any> | null | undefined,\n  isAdminOrSuperAdmin: boolean,\n  key: typeof PROFIT_PERMISSION_KEYS[number],\n) {\n  return hasDashboardViewPermission(permissions, isAdminOrSuperAdmin, key);\n}\n''',
    "add generic strict dashboard permission check",
)
p.write_text(text, encoding="utf-8")

# 2) Permission hook: expose and honor the new view-only key.
p = Path("src/hooks/usePerm.tsx")
text = p.read_text(encoding="utf-8")
text = replace_once(
    text,
    'import { hasPermission, hasProfitViewPermission, NET_PROFIT_PERMISSION_KEY, PROFIT_SUMMARY_PERMISSION_KEY, normalizePermissionsForLoad } from "@/lib/permissionKeys";\n',
    'import { FINANCIAL_POSITION_PERMISSION_KEY, hasDashboardViewPermission, hasPermission, isDashboardViewPermissionKey, NET_PROFIT_PERMISSION_KEY, PROFIT_SUMMARY_PERMISSION_KEY, normalizePermissionsForLoad } from "@/lib/permissionKeys";\n',
    "update usePerm imports",
)
text = replace_once(
    text,
    'export { NET_PROFIT_PERMISSION_KEY, PROFIT_SUMMARY_PERMISSION_KEY } from "@/lib/permissionKeys";\n',
    'export { FINANCIAL_POSITION_PERMISSION_KEY, NET_PROFIT_PERMISSION_KEY, PROFIT_SUMMARY_PERMISSION_KEY } from "@/lib/permissionKeys";\n',
    "export financial-position key",
)
text = replace_once(
    text,
    '  PROFIT_SUMMARY_PERMISSION_KEY,\n] as const;\n',
    '  PROFIT_SUMMARY_PERMISSION_KEY,\n  FINANCIAL_POSITION_PERMISSION_KEY,\n] as const;\n',
    "register section key",
)
text = replace_once(
    text,
    '''  if ((section === NET_PROFIT_PERMISSION_KEY || section === PROFIT_SUMMARY_PERMISSION_KEY) && action === "view") {\n    return hasProfitViewPermission(normalizePermissionsForLoad(perms ?? {}), isAdmin, section);\n  }\n''',
    '''  if (isDashboardViewPermissionKey(section) && action === "view") {\n    return hasDashboardViewPermission(normalizePermissionsForLoad(perms ?? {}), isAdmin, section);\n  }\n''',
    "strict checkPerm dashboard cards",
)
text = replace_once(
    text,
    '''  if ((section === NET_PROFIT_PERMISSION_KEY || section === PROFIT_SUMMARY_PERMISSION_KEY) && action === "view") {\n    return hasProfitViewPermission(perms, isSuperAdmin, section);\n  }\n''',
    '''  if (isDashboardViewPermissionKey(section) && action === "view") {\n    return hasDashboardViewPermission(normalizePermissionsForLoad(perms ?? {}), isSuperAdmin, section);\n  }\n''',
    "strict owner/explicit dashboard cards",
)
p.write_text(text, encoding="utf-8")

# 3) Settings UI: investors already exists; add a separate view-only dashboard row.
p = Path("src/routes/settings.tsx")
text = p.read_text(encoding="utf-8")
old_import = 'import { NET_PROFIT_PERMISSION_KEY, PROFIT_SUMMARY_PERMISSION_KEY, isProfitPermissionKey, normalizePermissionBranch } from "@/lib/permissionKeys";\n'
new_import = 'import { FINANCIAL_POSITION_PERMISSION_KEY, NET_PROFIT_PERMISSION_KEY, PROFIT_SUMMARY_PERMISSION_KEY, isDashboardViewPermissionKey, normalizePermissionBranch } from "@/lib/permissionKeys";\n'
text = replace_once(text, old_import, new_import, "settings permission imports")
text = replace_once(
    text,
    '  { key: PROFIT_SUMMARY_PERMISSION_KEY, label: "ملخص الأرباح",     route: "/#profit-summary" },\n',
    '  { key: PROFIT_SUMMARY_PERMISSION_KEY, label: "ملخص الأرباح",     route: "/#profit-summary" },\n  { key: FINANCIAL_POSITION_PERMISSION_KEY, label: "المركز المالي الحالي — الداشبورد", route: "/#financial-position" },\n',
    "add financial position settings row",
)
if text.count('{ key: "investors",') != 1:
    raise SystemExit("investors permission row must exist exactly once")
old_count = text.count("isProfitPermissionKey")
if old_count < 2:
    raise SystemExit(f"settings expected profit-key checks, found {old_count}")
text = text.replace("isProfitPermissionKey", "isDashboardViewPermissionKey")
if "isProfitPermissionKey" in text:
    raise SystemExit("old special-permission detector remains in settings")
p.write_text(text, encoding="utf-8")

# 4) Dashboard financial-position cards: independent permission from investor section.
p = Path("src/components/FinancialPositionPanel.tsx")
text = p.read_text(encoding="utf-8")
text = replace_once(
    text,
    'import { usePerm } from "@/hooks/usePerm";\n',
    'import { FINANCIAL_POSITION_PERMISSION_KEY, usePerm } from "@/hooks/usePerm";\n',
    "financial panel permission import",
)
text = replace_once(
    text,
    '''export function FinancialPositionPanel({ variant = "dashboard" }: { variant?: "dashboard" | "full" }) {\n  const perm = usePerm("investors");\n  if (!perm.view) return null;\n  return <FinancialPositionPanelInner variant={variant} />;\n}\n''',
    '''export function FinancialPositionPanel({ variant = "dashboard" }: { variant?: "dashboard" | "full" }) {\n  const permissionKey = variant === "dashboard" ? FINANCIAL_POSITION_PERMISSION_KEY : "investors";\n  const perm = usePerm(permissionKey);\n  if (!perm.view) return null;\n  return <FinancialPositionPanelInner variant={variant} />;\n}\n''',
    "separate dashboard/full panel permissions",
)
text = replace_once(
    text,
    '<div className="erp-section-title">المركز المالي الحالي</div>',
    '<div id="financial-position" className="erp-section-title">المركز المالي الحالي</div>',
    "dashboard financial position anchor",
)
p.write_text(text, encoding="utf-8")

print("Scoped permission patch applied")
