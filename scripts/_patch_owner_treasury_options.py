from pathlib import Path

p = Path('src/routes/investors.tsx')
text = p.read_text(encoding='utf-8')

old_import = 'import { checkOutflowAllowed, postMovement } from "@/lib/financialEngine";\n'
new_import = old_import + 'import { resolveCompanyCashBoxForSplit } from "@/lib/balanceGuard";\n'
if text.count(old_import) != 1:
    raise SystemExit(f'import anchor count={text.count(old_import)}')
text = text.replace(old_import, new_import, 1)

old_type = 'type OwnerCashBox = { id: string; name: string; currency: string; balance: number | string | null; is_active: boolean };'
new_type = 'type OwnerCashBox = { id: string; name: string; currency: string; balance: number | string | null; is_active?: boolean | null; method_key?: string | null };'
if text.count(old_type) != 1:
    raise SystemExit(f'type anchor count={text.count(old_type)}')
text = text.replace(old_type, new_type, 1)

old_block = '''  const activeBoxes = useMemo(\n    () => boxes.filter((box) => box.is_active !== false && ["EGP", "USD", "LYD"].includes(String(box.currency || "").toUpperCase())),\n    [boxes],\n  );'''
new_block = '''  const activeBoxes = useMemo(() => {\n    const supported = boxes.filter((box) =>\n      box.is_active !== false\n      && ["EGP", "USD", "LYD"].includes(String(box.currency || "").toUpperCase()),\n    );\n\n    // Keep all previously available active treasuries, but explicitly resolve\n    // the two EGP company treasuries through the same stable mapping used by\n    // the rest of the financial system. This guarantees both company cash and\n    // company InstaPay are offered for owner funding when those boxes exist.\n    const companyCash = resolveCompanyCashBoxForSplit(boxes, "EGP", "company_cash")\n      || boxes.find((box) => box.is_active !== false && box.method_key === "company_cash")\n      || null;\n    const companyInstapay = resolveCompanyCashBoxForSplit(boxes, "EGP", "company_instapay")\n      || boxes.find((box) => box.is_active !== false && box.method_key === "company_instapay")\n      || null;\n\n    const ordered = [companyCash, companyInstapay, ...supported];\n    const seen = new Set<string>();\n    return ordered.filter((box): box is OwnerCashBox => {\n      if (!box || box.is_active === false || seen.has(box.id)) return false;\n      seen.add(box.id);\n      return true;\n    });\n  }, [boxes]);'''
if text.count(old_block) != 1:
    raise SystemExit(f'activeBoxes anchor count={text.count(old_block)}')
text = text.replace(old_block, new_block, 1)

p.write_text(text, encoding='utf-8')
