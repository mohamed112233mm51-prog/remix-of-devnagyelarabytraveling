from pathlib import Path

path = Path("src/features/currency-suppliers/LegacyCurrencySupplierStatementRoute.tsx")
s = path.read_text(encoding="utf-8")

replacements = [
(
'''  const [rate, setRate] = useState<string>("");\n  const [egpAmount, setEgpAmount] = useState<string>("");\n  const [txDate, setTxDate''',
'''  const [rate, setRate] = useState<string>("");\n  const [egpAmount, setEgpAmount] = useState<string>("");\n  const [commission, setCommission] = useState<string>("0");\n  const [txDate, setTxDate'''),
(
'''  const splitsTotal = useMemo(\n    () => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0),\n    [splits],\n  );\n  const egpNum = Number(egpAmount) || 0;\n  const splitsDiff = +(egpNum - splitsTotal).toFixed(2);''',
'''  const splitsTotal = useMemo(\n    () => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0),\n    [splits],\n  );\n  const egpNum = Number(egpAmount) || 0;\n  const commissionNum = kind === "شراء عملة" ? (Number(commission) || 0) : 0;\n  const totalEgpNum = +(egpNum + commissionNum).toFixed(2);\n  const splitsDiff = +(totalEgpNum - splitsTotal).toFixed(2);'''),
(
'''    const a = Number(foreignAmount);\n    const r = Number(rate);\n    const e = Number(egpAmount);\n    if (!txDate) return toast.error("التاريخ مطلوب");''',
'''    const a = Number(foreignAmount);\n    const r = Number(rate);\n    const e = Number(egpAmount);\n    const commissionValue = isBuy ? (Number(commission) || 0) : 0;\n    const totalEgp = +(e + commissionValue).toFixed(2);\n    if (!txDate) return toast.error("التاريخ مطلوب");'''),
(
'''    if (!(a > 0) || !(r > 0) || !(e > 0)) return toast.error("أدخل قيمتين على الأقل لحساب الثالثة");''',
'''    if (!(a > 0) || !(r > 0) || !(e > 0)) return toast.error("أدخل قيمتين على الأقل لحساب الثالثة");\n    if (isBuy && commissionValue < 0) return toast.error("العمولة لا يمكن أن تكون سالبة");\n    if (!(totalEgp > 0)) return toast.error("إجمالي قيمة العملية يجب أن يكون أكبر من صفر");'''),
(
'''      sold_amount: isBuy ? e : a,\n      exchange_rate: r,''',
'''      sold_amount: isBuy ? totalEgp : a,\n      exchange_rate: r,'''),
(
'''          <div className="form-group"><label>{isBuy ? "قيمة العملة المباعة بالجنيه" : "قيمة العملة المشتراة بالجنيه"}</label>\n            <input type="number" step="0.01" value={egpAmount}\n              onChange={(e) => { setEgpAmount(e.target.value); setLastEdited("egp"); }} />\n          </div>\n          <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>البيان</label>''',
'''          <div className="form-group"><label>{isBuy ? "قيمة العملة المباعة بالجنيه" : "قيمة العملة المشتراة بالجنيه"}</label>\n            <input type="number" step="0.01" value={egpAmount}\n              onChange={(e) => { setEgpAmount(e.target.value); setLastEdited("egp"); }} />\n          </div>\n          {isBuy && (\n            <div className="form-group"><label>العمولة *</label>\n              <input type="number" min="0" step="0.01" value={commission}\n                onChange={(e) => setCommission(e.target.value)} placeholder="0.00" />\n            </div>\n          )}\n          <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>البيان</label>'''),
(
'''          إجمالي وسائل الدفع: <b>{fmtNum(splitsTotal)}</b>\n          {splitsDiff > 0.5 && (\n            <span style={{ color: "var(--gold, #b8860b)", marginInlineStart: 8 }}>\n              الباقي المستحق للمورد: {fmtNum(splitsDiff)}\n            </span>\n          )}''',
'''          إجمالي حساب المورد: <b>{fmtNum(totalEgpNum)}</b>\n          {isBuy && commissionNum > 0 && (\n            <span style={{ color: "var(--gold, #b8860b)", marginInlineStart: 8 }}>\n              شامل العمولة: {fmtNum(commissionNum)}\n            </span>\n          )}\n          <span style={{ marginInlineStart: 8 }}>إجمالي وسائل الدفع: <b>{fmtNum(splitsTotal)}</b></span>\n          {splitsDiff > 0.5 && (\n            <span style={{ color: "var(--gold, #b8860b)", marginInlineStart: 8 }}>\n              الباقي المستحق للمورد: {fmtNum(splitsDiff)}\n            </span>\n          )}'''),
]

for old, new in replacements:
    if old not in s:
        raise SystemExit("Expected code pattern not found; aborting without changes.")
    s = s.replace(old, new, 1)

path.write_text(s, encoding="utf-8")
print("patched", path)
