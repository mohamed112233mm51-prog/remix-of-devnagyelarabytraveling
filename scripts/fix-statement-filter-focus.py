from pathlib import Path
import re

FILES = [
    Path("src/components/AgentLedger.tsx"),
    Path("src/features/companies/LegacyCompaniesRoute.tsx"),
]

OLD_TH = '''  const Th = ({ children, filterKey, options }: { children: React.ReactNode; filterKey?: string; options?: string[] }) => (\n    <th>\n      <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>\n        <span>{children}</span>\n        {filterKey && <CF.ColumnFilter label={String(children)} state={safeFilters[filterKey]} onChange={(s) => setF(filterKey, s)} options={options} />}\n      </span>\n    </th>\n  );\n'''

NEW_TH = '''  // Render helper (not a nested React component): keeps ColumnFilter mounted while live filtering re-renders the statement.\n  const renderFilterTh = (children: React.ReactNode, filterKey: string, options?: string[]) => (\n    <th>\n      <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>\n        <span>{children}</span>\n        <CF.ColumnFilter label={String(children)} state={safeFilters[filterKey]} onChange={(s) => setF(filterKey, s)} options={options} />\n      </span>\n    </th>\n  );\n'''

WITH_OPTIONS = re.compile(
    r'\{isVisible\("([^"]+)"\) && <Th filterKey="([^"]+)" options=\{([^}]+)\}>([^<]+)</Th>\}'
)
WITHOUT_OPTIONS = re.compile(
    r'\{isVisible\("([^"]+)"\) && <Th filterKey="([^"]+)">([^<]+)</Th>\}'
)

for path in FILES:
    text = path.read_text(encoding="utf-8")
    if text.count(OLD_TH) != 1:
        raise SystemExit(f"{path}: expected exactly one nested Th definition, found {text.count(OLD_TH)}")
    if text.count("<Th filterKey=") != 13:
        raise SystemExit(f"{path}: expected 13 filter header usages, found {text.count('<Th filterKey=')}")

    text = text.replace(OLD_TH, NEW_TH, 1)
    text, count_options = WITH_OPTIONS.subn(
        lambda m: f'{{isVisible("{m.group(1)}") && renderFilterTh("{m.group(4)}", "{m.group(2)}", {m.group(3)})}}',
        text,
    )
    text, count_plain = WITHOUT_OPTIONS.subn(
        lambda m: f'{{isVisible("{m.group(1)}") && renderFilterTh("{m.group(3)}", "{m.group(2)}")}}',
        text,
    )

    if count_options != 3 or count_plain != 10:
        raise SystemExit(f"{path}: expected 3 option headers + 10 plain headers, got {count_options} + {count_plain}")
    if "<Th filterKey=" in text:
        raise SystemExit(f"{path}: old nested Th usages remain")

    path.write_text(text, encoding="utf-8")
