from pathlib import Path


def remove_once(path: str, text: str, label: str):
    p = Path(path)
    content = p.read_text(encoding="utf-8")
    count = content.count(text)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    p.write_text(content.replace(text, "", 1), encoding="utf-8")


remove_once(
    "src/routes/investors.tsx",
    '          <div className="page-sub">فصل تمويل المالك عن أرباح التشغيل وربط التوريد والسحب بالخزائن الفعلية</div>\n',
    "owner page subtitle",
)

remove_once(
    "src/components/FinancialPositionPanel.tsx",
    '          <div style={{ color: "var(--text3, #64748B)", fontSize: 12, marginTop: 3 }}>\n            كل وكيل أو شركة صادرة أو تاجر كاش أو مورد عملة يُقيّم منفرداً: إن كان رصيده لصالح الشركة يدخل ضمن الحقوق، وإن كان على الشركة يدخل ضمن الالتزامات.\n          </div>\n',
    "financial position intro",
)

remove_once(
    "src/components/FinancialPositionPanel.tsx",
    '        <div style={{ fontSize: 12, lineHeight: 1.8, color: "var(--text3, #64748B)" }}>\n          رصيد تاجر الكاش الموجب يُعامل كأموال للشركة ضمن الخزائن/الأصول، بينما الرصيد السالب يُعامل كالتزام على الشركة. المصروفات المدفوعة لا تُخصم مرة ثانية هنا لأنها خفّضت رصيد الخزائن بالفعل؛ وهي تظل مخصومة في معادلة صافي الأرباح التشغيلية. تمويل المالك لا يدخل في صافي الأرباح.\n        </div>\n',
    "financial position explanatory paragraph",
)
