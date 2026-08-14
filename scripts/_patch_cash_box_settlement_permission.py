from pathlib import Path


def replace_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly 1 match in {path}, found {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def ensure_once(path: str, old: str, new: str, label: str) -> None:
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    if new in text:
        return
    replace_once(path, old, new, label)

# Same strict view-permission pattern used by the existing financial dashboard cards.
ensure_once(
    "src/lib/permissionKeys.ts",
    '''export const DASHBOARD_VIEW_PERMISSION_KEYS = [\n  ...PROFIT_PERMISSION_KEYS,\n  FINANCIAL_POSITION_PERMISSION_KEY,\n] as const;''',
    '''export const DASHBOARD_VIEW_PERMISSION_KEYS = [\n  ...PROFIT_PERMISSION_KEYS,\n  FINANCIAL_POSITION_PERMISSION_KEY,\n  CASH_BOX_SETTLEMENT_PERMISSION_KEY,\n] as const;''',
    "register cash settlement as strict view permission",
)
ensure_once(
    "src/lib/permissionKeys.ts",
    '''export function isDashboardViewPermissionKey(key: string | null | undefined): key is DashboardViewPermissionKey {\n  return key === NET_PROFIT_PERMISSION_KEY\n    || key === PROFIT_SUMMARY_PERMISSION_KEY\n    || key === FINANCIAL_POSITION_PERMISSION_KEY;\n}''',
    '''export function isDashboardViewPermissionKey(key: string | null | undefined): key is DashboardViewPermissionKey {\n  return key === NET_PROFIT_PERMISSION_KEY\n    || key === PROFIT_SUMMARY_PERMISSION_KEY\n    || key === FINANCIAL_POSITION_PERMISSION_KEY\n    || key === CASH_BOX_SETTLEMENT_PERMISSION_KEY;\n}''',
    "include cash settlement in strict permission detector",
)

# Reports: transfers remain controlled by reports.edit; settlement is independent.
ensure_once(
    "src/routes/reports.tsx",
    'import { usePerm } from "@/hooks/usePerm";',
    'import { CASH_BOX_SETTLEMENT_PERMISSION_KEY, usePerm } from "@/hooks/usePerm";',
    "import cash settlement permission key",
)
ensure_once(
    "src/routes/reports.tsx",
    '''function TreasuriesReport({ inRange }: { inRange: (d: string | null | undefined) => boolean }) {\n  const reportPerm = usePerm("reports");''',
    '''function TreasuriesReport({ inRange }: { inRange: (d: string | null | undefined) => boolean }) {\n  const reportPerm = usePerm("reports");\n  const settlementPerm = usePerm(CASH_BOX_SETTLEMENT_PERMISSION_KEY);''',
    "add independent treasury settlement permission",
)
replace_once(
    "src/routes/reports.tsx",
    '{reportPerm.edit ? (<>',
    '{reportPerm.edit || settlementPerm.view ? (<>',
    "open independent treasury actions gate",
)
replace_once(
    "src/routes/reports.tsx",
    '''                      <button type="button" className="action-btn" onClick={() => setEditBox(b)}>رصيد افتتاحي</button>\n                      <button type="button" className="action-btn" style={{ marginInlineStart: 6 }} onClick={() => setReconcileBox(b)}>⚖️ تسوية الخزنة</button>''',
    '''                      {reportPerm.edit && <button type="button" className="action-btn" onClick={() => setEditBox(b)}>رصيد افتتاحي</button>}\n                      {settlementPerm.view && <button type="button" className="action-btn" style={{ marginInlineStart: 6 }} onClick={() => setReconcileBox(b)}>⚖️ تسوية الخزنة</button>}''',
    "split treasury opening and settlement actions",
)

# Defense in depth: the modal and save path also require the dedicated permission.
ensure_once(
    "src/routes/reports.tsx",
    '''function CashBoxReconcileModal({ box, onClose }: { box: CashBoxRow; onClose: () => void }) {\n  const currentBalance = Number(box.balance || 0);''',
    '''function CashBoxReconcileModal({ box, onClose }: { box: CashBoxRow; onClose: () => void }) {\n  const settlementPerm = usePerm(CASH_BOX_SETTLEMENT_PERMISSION_KEY);\n  const currentBalance = Number(box.balance || 0);''',
    "guard reconciliation modal with dedicated permission",
)
ensure_once(
    "src/routes/reports.tsx",
    '''  const save = async () => {\n    if (!hasPhysical) { toast.error("أدخل الرصيد الفعلي بعد الجرد"); return; }''',
    '''  const save = async () => {\n    if (!settlementPerm.view) { toast.error("ليس لديك صلاحية تسوية الخزائن"); return; }\n    if (!hasPhysical) { toast.error("أدخل الرصيد الفعلي بعد الجرد"); return; }''',
    "protect reconciliation save",
)

# Settings: expose it as an independent view-only permission, exactly like the dashboard cards.
ensure_once(
    "src/routes/settings.tsx",
    'import { FINANCIAL_POSITION_PERMISSION_KEY, NET_PROFIT_PERMISSION_KEY, PROFIT_SUMMARY_PERMISSION_KEY, isDashboardViewPermissionKey, normalizePermissionBranch } from "@/lib/permissionKeys";',
    'import { CASH_BOX_SETTLEMENT_PERMISSION_KEY, FINANCIAL_POSITION_PERMISSION_KEY, NET_PROFIT_PERMISSION_KEY, PROFIT_SUMMARY_PERMISSION_KEY, isDashboardViewPermissionKey, normalizePermissionBranch } from "@/lib/permissionKeys";',
    "import cash settlement permission in settings",
)
ensure_once(
    "src/routes/settings.tsx",
    '''  { key: FINANCIAL_POSITION_PERMISSION_KEY, label: "المركز المالي الحالي — الداشبورد", route: "/#financial-position" },\n];''',
    '''  { key: FINANCIAL_POSITION_PERMISSION_KEY, label: "المركز المالي الحالي — الداشبورد", route: "/#financial-position" },\n  { key: CASH_BOX_SETTLEMENT_PERMISSION_KEY, label: "تسوية الخزائن", route: "/reports#treasuries" },\n];''',
    "add cash settlement permission to settings",
)

print("Cash box settlement permission patch applied")
