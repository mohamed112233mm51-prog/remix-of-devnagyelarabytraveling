from pathlib import Path
import re


def replace_once(path: str, old: str, new: str, label: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 match, found {count}")
    p.write_text(text.replace(old, new, 1), encoding="utf-8")


def regex_once(path: str, pattern: str, replacement: str, label: str):
    p = Path(path)
    text = p.read_text(encoding="utf-8")
    new_text, count = re.subn(pattern, replacement, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f"{label}: expected 1 regex match, found {count}")
    p.write_text(new_text, encoding="utf-8")


# ---------------------------------------------------------------------------
# financialEngine.ts — make investor a first-class financial party.
# ---------------------------------------------------------------------------
replace_once(
    "src/lib/financialEngine.ts",
    '''  | "merchant"\n  | "expense"\n  | "treasury";''',
    '''  | "merchant"\n  | "investor"\n  | "expense"\n  | "treasury";''',
    "financialEngine PartyType",
)
replace_once(
    "src/lib/financialEngine.ts",
    '''  merchant: "merchant_cash_collections",\n  expense: "expenses",''',
    '''  merchant: "merchant_cash_collections",\n  investor: "investor_transactions",\n  expense: "expenses",''',
    "financialEngine party table",
)
replace_once(
    "src/lib/financialEngine.ts",
    '''  merchant: "merchant_id",\n  expense: "id",''',
    '''  merchant: "merchant_id",\n  investor: "investor_id",\n  expense: "id",''',
    "financialEngine party id",
)
replace_once(
    "src/lib/financialEngine.ts",
    '''    merchant: "التاجر",\n    expense: "المصروف",''',
    '''    merchant: "التاجر",\n    investor: "المالك / المستثمر",\n    expense: "المصروف",''',
    "financialEngine party label",
)

# ---------------------------------------------------------------------------
# Permissions — investors is an independent protected financial section.
# ---------------------------------------------------------------------------
replace_once(
    "src/hooks/usePerm.tsx",
    '''  "merchants",\n  "currency_suppliers",\n  "expenses",''',
    '''  "merchants",\n  "currency_suppliers",\n  "investors",\n  "expenses",''',
    "permission section key",
)
replace_once(
    "src/hooks/usePerm.tsx",
    '''    case "merchant_cash_collections":\n      return "merchants";\n    case "expense_deductions":''',
    '''    case "merchant_cash_collections":\n      return "merchants";\n    case "investor_transactions":\n      return "investors";\n    case "expense_deductions":''',
    "permission financial table",
)
replace_once(
    "src/hooks/usePerm.tsx",
    '''  "/currency-suppliers": "currency_suppliers",\n  "/expenses": "expenses",''',
    '''  "/currency-suppliers": "currency_suppliers",\n  "/investors": "investors",\n  "/expenses": "expenses",''',
    "permission route",
)

# ---------------------------------------------------------------------------
# Layout + settings permissions.
# ---------------------------------------------------------------------------
replace_once(
    "src/components/Layout.tsx",
    '''      { to: "/currency-suppliers", icon: Coins, label: "حسابات موردي العملة", section: "الحسابات المالية", permKey: "currency_suppliers" },\n      \n    ],''',
    '''      { to: "/currency-suppliers", icon: Coins, label: "حسابات موردي العملة", section: "الحسابات المالية", permKey: "currency_suppliers" },\n      { to: "/investors", icon: Landmark, label: "حساب المالك / المستثمرين", section: "الحسابات المالية", permKey: "investors" },\n      \n    ],''',
    "layout investors nav",
)
replace_once(
    "src/components/Layout.tsx",
    '''  "/currency-suppliers": (<>حسابات <span>موردي العملة</span></>),\n  \n  "/expenses":''',
    '''  "/currency-suppliers": (<>حسابات <span>موردي العملة</span></>),\n  "/investors": (<>حساب <span>المالك / المستثمرين</span></>),\n  \n  "/expenses":''',
    "layout investors title",
)
replace_once(
    "src/routes/settings.tsx",
    '''  { key: "currency_suppliers", label: "حسابات موردي العملة",      route: "/currency-suppliers" },\n  \n  { key: "expenses",''',
    '''  { key: "currency_suppliers", label: "حسابات موردي العملة",      route: "/currency-suppliers" },\n  { key: "investors",          label: "حساب المالك / المستثمرين",   route: "/investors" },\n  \n  { key: "expenses",''',
    "settings investors permission",
)

# ---------------------------------------------------------------------------
# Dashboard — add current financial-position snapshot, without touching P&L.
# ---------------------------------------------------------------------------
replace_once(
    "src/routes/index.tsx",
    '''import { CurrencyLines } from "@/components/CurrencyLines";\nimport { usePerm } from "@/hooks/usePerm";''',
    '''import { CurrencyLines } from "@/components/CurrencyLines";\nimport { FinancialPositionPanel } from "@/components/FinancialPositionPanel";\nimport { usePerm } from "@/hooks/usePerm";''',
    "dashboard financial position import",
)
replace_once(
    "src/routes/index.tsx",
    '''      {/* === System-wide KPIs === */}\n      <div className="erp-section-title">المؤشرات الرئيسية</div>''',
    '''      <FinancialPositionPanel variant="dashboard" />\n\n      {/* === System-wide KPIs === */}\n      <div className="erp-section-title">المؤشرات الرئيسية</div>''',
    "dashboard financial position panel",
)

# ---------------------------------------------------------------------------
# FinancialPositionPanel typing cleanup.
# ---------------------------------------------------------------------------
replace_once(
    "src/components/FinancialPositionPanel.tsx",
    '''import { Building2, HandCoins, Landmark, Scale, Users, WalletCards } from "lucide-react";''',
    '''import type { ReactNode } from "react";\nimport { Building2, HandCoins, Landmark, Scale, Users, WalletCards } from "lucide-react";''',
    "financial position ReactNode import",
)
replace_once(
    "src/components/FinancialPositionPanel.tsx",
    '''  icon: React.ReactNode;''',
    '''  icon: ReactNode;''',
    "financial position ReactNode type",
)

# ---------------------------------------------------------------------------
# investors.tsx — integrate owner funding with actual cash boxes.
# ---------------------------------------------------------------------------
replace_once(
    "src/routes/investors.tsx",
    '''import { useMemo, useState } from "react";\nimport { createPortal } from "react-dom";\nimport { toast } from "sonner";\nimport { supabase } from "@/integrations/supabase/client";\nimport { fmtDL, useLive, type Investor, type InvestorTransaction } from "@/lib/db";\nimport { useInvestorsSummary, useInvestorsTotals, summarizeInvestor } from "@/lib/financialSummary";\nimport { ExportButton } from "@/components/ExportButton";''',
    '''import { useEffect, useMemo, useState } from "react";\nimport { createPortal } from "react-dom";\nimport { toast } from "sonner";\nimport { supabase } from "@/integrations/supabase/client";\nimport { fmtCurrency, refetchLiveTables, useLive, type Investor, type InvestorTransaction } from "@/lib/db";\nimport { formatCurrencyMap } from "@/lib/financialSummary";\nimport { CurrencyLines } from "@/components/CurrencyLines";\nimport { FinancialPositionPanel } from "@/components/FinancialPositionPanel";\nimport { buildInvestorCapitalSummary, investorTransactionCurrency, type FinancialPositionSplit } from "@/hooks/useFinancialPosition";\nimport { checkOutflowAllowed, postMovement } from "@/lib/financialEngine";\nimport { usePerm } from "@/hooks/usePerm";\nimport { ExportButton } from "@/components/ExportButton";''',
    "investors imports",
)
replace_once(
    "src/routes/investors.tsx",
    '''const PAYMENT_METHODS = ["انستا", "نقدي", "كاش"] as const;\nconst TXN_TYPES = ["صرف نقدية", "توريد نقدية"] as const;''',
    '''const TXN_TYPES = ["صرف نقدية", "توريد نقدية"] as const;\n\ntype OwnerCashBox = { id: string; name: string; currency: string; balance: number | string | null; is_active: boolean };''',
    "investors constants",
)
replace_once(
    "src/routes/investors.tsx",
    '''  const { rows: investors } = useLive<Investor>("investors");\n  const { rows: txns } = useLive<InvestorTransaction>("investor_transactions");\n  const [tab, setTab] = useState<Tab>("history");\n\n  const { deposit: totalDeposit, withdraw: totalWithdraw, balance } = useInvestorsTotals();''',
    '''  const perm = usePerm("investors");\n  const { rows: investors } = useLive<Investor>("investors");\n  const { rows: txns } = useLive<InvestorTransaction>("investor_transactions");\n  const { rows: paymentSplits } = useLive<FinancialPositionSplit>("payment_splits");\n  const [tab, setTab] = useState<Tab>("history");\n\n  const capitalTotals = useMemo(\n    () => buildInvestorCapitalSummary(txns, paymentSplits, { includeLegacy: true }),\n    [txns, paymentSplits],\n  );''',
    "investors page data",
)
replace_once(
    "src/routes/investors.tsx",
    '''            <span className="crumb-current">حسابات المستثمرين</span>\n          </div>\n          <h1 className="page-h1"><Briefcase size={22} strokeWidth={2.2} /> حسابات المستثمرين</h1>\n          <div className="page-sub">إدارة الإيداعات والسحوبات وأرصدة المستثمرين</div>\n        </div>\n        <button className="page-head-cta" onClick={() => setTab("add")}>\n          <UserPlus size={16} strokeWidth={2.4} /> إضافة مستثمر\n        </button>''',
    '''            <span className="crumb-current">حساب المالك / المستثمرين</span>\n          </div>\n          <h1 className="page-h1"><Briefcase size={22} strokeWidth={2.2} /> حساب المالك / المستثمرين</h1>\n          <div className="page-sub">فصل تمويل المالك عن أرباح التشغيل وربط التوريد والسحب بالخزائن الفعلية</div>\n        </div>\n        {perm.create && (\n          <button className="page-head-cta" onClick={() => setTab("add")}>\n            <UserPlus size={16} strokeWidth={2.4} /> إضافة مالك / مستثمر\n          </button>\n        )}''',
    "investors page heading",
)
replace_once(
    "src/routes/investors.tsx",
    '''          <div className="kpi-text"><div className="label">إجمالي الإيداعات</div><div className="val">{fmtDL(totalDeposit)}</div></div>''',
    '''          <div className="kpi-text"><div className="label">إجمالي التمويل / التوريدات</div><div className="val"><CurrencyLines map={capitalTotals.deposit} /></div></div>''',
    "investors deposit card",
)
replace_once(
    "src/routes/investors.tsx",
    '''          <div className="kpi-text"><div className="label">إجمالي السحوبات</div><div className="val">{fmtDL(totalWithdraw)}</div></div>''',
    '''          <div className="kpi-text"><div className="label">إجمالي السحوبات</div><div className="val"><CurrencyLines map={capitalTotals.withdraw} /></div></div>''',
    "investors withdrawal card",
)
replace_once(
    "src/routes/investors.tsx",
    '''            <div className="label">صافي الرصيد</div>\n            <div className="val">{fmtDL(balance)}</div>\n            <div className="kpi-sub">الرصيد الصافي للمستثمرين</div>''',
    '''            <div className="label">صافي حساب المالك / المستثمرين</div>\n            <div className="val"><CurrencyLines map={capitalTotals.balance} /></div>\n            <div className="kpi-sub">التوريدات ناقص السحوبات — كل عملة مستقلة</div>''',
    "investors balance card",
)
replace_once(
    "src/routes/investors.tsx",
    '''      </div>\n\n      <div className="action-toolbar">''',
    '''      </div>\n\n      <FinancialPositionPanel variant="full" />\n\n      <div className="action-toolbar">''',
    "investors financial position panel",
)
replace_once(
    "src/routes/investors.tsx",
    '''        <div className={`tool-tab ${tab === "deposit" ? "active" : ""}`} onClick={() => setTab("deposit")}>\n          <ArrowDownLeft size={15} strokeWidth={2} /> <span>توريد نقدية</span>\n        </div>\n        <div className={`tool-tab ${tab === "withdraw" ? "active" : ""}`} onClick={() => setTab("withdraw")}>\n          <ArrowUpRight size={15} strokeWidth={2} /> <span>صرف نقدية</span>\n        </div>''',
    '''        {perm.create && (\n          <div className={`tool-tab ${tab === "deposit" ? "active" : ""}`} onClick={() => setTab("deposit")}>\n            <ArrowDownLeft size={15} strokeWidth={2} /> <span>توريد تمويل</span>\n          </div>\n        )}\n        {perm.create && (\n          <div className={`tool-tab ${tab === "withdraw" ? "active" : ""}`} onClick={() => setTab("withdraw")}>\n            <ArrowUpRight size={15} strokeWidth={2} /> <span>سحب من التمويل</span>\n          </div>\n        )}''',
    "investors action permissions",
)
replace_once(
    "src/routes/investors.tsx",
    '''      {tab === "list" && <InvestorsListTab investors={investors} txns={txns} />}\n\n      {tab === "add" && (''',
    '''      {tab === "list" && <InvestorsListTab investors={investors} txns={txns} splits={paymentSplits} canEdit={perm.edit} />}\n\n      {tab === "add" && perm.create && (''',
    "investors list and add permission",
)
replace_once(
    "src/routes/investors.tsx",
    '''      {tab === "history" && <HistoryTab txns={txns} investorName={investorName} investors={investors} />}\n      {tab === "statement" && <StatementTab txns={txns} investors={investors} />}\n      {tab === "withdraw" && <TxnForm investors={investors} kind="صرف نقدية" methodLabel="وسيلة الصرف" title="⬆️ صرف نقدية" />}\n      {tab === "deposit" && <TxnForm investors={investors} kind="توريد نقدية" methodLabel="وسيلة التوريد" title="⬇️ توريد نقدية" />}''',
    '''      {tab === "history" && <HistoryTab txns={txns} investorName={investorName} investors={investors} splits={paymentSplits} />}\n      {tab === "statement" && <StatementTab txns={txns} investors={investors} splits={paymentSplits} canExport={perm.export} />}\n      {tab === "withdraw" && perm.create && <TxnForm investors={investors} kind="صرف نقدية" methodLabel="الخزينة" title="⬆️ سحب من تمويل المالك / المستثمر" />}\n      {tab === "deposit" && perm.create && <TxnForm investors={investors} kind="توريد نقدية" methodLabel="الخزينة" title="⬇️ توريد تمويل المالك / المستثمر" />}''',
    "investors tab props",
)

# Replace TxnForm completely.
regex_once(
    "src/routes/investors.tsx",
    r'''function TxnForm\(\{ investors, kind, methodLabel, title \}: \{ investors: Investor\[\]; kind: typeof TXN_TYPES\[number\]; methodLabel: string; title: string \}\) \{.*?\n\}\n\n\nfunction HistoryTab''',
    '''function TxnForm({ investors, kind, methodLabel, title }: { investors: Investor[]; kind: typeof TXN_TYPES[number]; methodLabel: string; title: string }) {\n  const { rows: boxes } = useLive<OwnerCashBox>("cash_boxes");\n  const activeBoxes = useMemo(\n    () => boxes.filter((box) => box.is_active !== false && ["EGP", "USD", "LYD"].includes(String(box.currency || "").toUpperCase())),\n    [boxes],\n  );\n  const [form, setForm] = useState({\n    investor_id: "",\n    date: new Date().toISOString().slice(0, 10),\n    amount: "",\n    cash_box_id: "",\n    note: "",\n    statement: "",\n  });\n  const [saving, setSaving] = useState(false);\n  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));\n\n  useEffect(() => {\n    if (!form.cash_box_id && activeBoxes[0]?.id) set("cash_box_id", activeBoxes[0].id);\n  }, [activeBoxes, form.cash_box_id]);\n\n  const selectedBox = activeBoxes.find((box) => box.id === form.cash_box_id) || null;\n\n  const save = async () => {\n    if (!form.investor_id) return toast.error("اختر المالك / المستثمر");\n    const amount = Math.round(Number(form.amount || 0));\n    if (amount <= 0) return toast.error("أدخل المبلغ");\n    if (!selectedBox) return toast.error(`اختر ${methodLabel}`);\n\n    setSaving(true);\n    let parentId: string | null = null;\n    try {\n      if (kind === "صرف نقدية") {\n        const outflowError = await checkOutflowAllowed(selectedBox.id, amount, selectedBox.name);\n        if (outflowError) { toast.error(outflowError); return; }\n      }\n\n      const { data: parent, error: parentError } = await supabase\n        .from("investor_transactions")\n        .insert({\n          investor_id: form.investor_id,\n          transaction_type: kind,\n          date: form.date,\n          amount,\n          payment_method: selectedBox.name,\n          note: form.note.trim() ? form.note.trim() : null,\n          statement: form.statement.trim() ? form.statement.trim() : null,\n        } as any)\n        .select("id")\n        .single();\n      if (parentError || !parent) throw new Error(parentError?.message || "تعذر حفظ حركة المالك");\n      parentId = parent.id;\n\n      const movement = await postMovement({\n        partyType: "investor",\n        partyId: form.investor_id,\n        kind: kind === "توريد نقدية" ? "receipt" : "payment",\n        date: form.date,\n        note: form.note.trim() || undefined,\n        statement: form.statement.trim() || undefined,\n        sourceTable: "investor_transactions",\n        sourceId: parent.id,\n        splits: [{\n          method: selectedBox.name,\n          currency: String(selectedBox.currency).toUpperCase() as "EGP" | "USD" | "LYD",\n          cashBoxId: selectedBox.id,\n          amount,\n          direction: kind === "توريد نقدية" ? "in" : "out",\n        }],\n      });\n      if (!movement.ok) throw new Error(movement.error || "فشل ربط حركة المالك بالخزينة");\n\n      await refetchLiveTables(["investor_transactions", "payment_splits", "cash_boxes"]);\n      toast.success(kind === "توريد نقدية" ? "تم توريد التمويل إلى الخزينة" : "تم سحب المبلغ من الخزينة");\n      setForm({ investor_id: "", date: new Date().toISOString().slice(0, 10), amount: "", cash_box_id: activeBoxes[0]?.id || "", note: "", statement: "" });\n    } catch (error: any) {\n      if (parentId) await supabase.from("investor_transactions").delete().eq("id", parentId);\n      toast.error(error?.message || "فشل حفظ حركة المالك / المستثمر");\n    } finally {\n      setSaving(false);\n    }\n  };\n\n  return (\n    <div className="card">\n      <div className="card-header"><div className="card-title">{title}</div></div>\n      <div className="form-grid">\n        <div className="form-group"><label>المالك / المستثمر</label>\n          <SearchableSelect value={form.investor_id} onChange={(v) => set("investor_id", v)} options={investors.map((i) => ({ value: i.id, label: i.investor_name }))} placeholder="اختر..." />\n        </div>\n        <div className="form-group"><label>التاريخ</label><DateInput value={form.date} onChange={(iso) => set("date", iso)} defaultToday /></div>\n        <div className="form-group"><label>المبلغ</label><NumberInput value={Number(form.amount) || 0} onChange={(n) => set("amount", n === 0 ? "" : String(n))} min={0} /></div>\n        <div className="form-group"><label>{methodLabel}</label>\n          <select value={form.cash_box_id} onChange={(e) => set("cash_box_id", e.target.value)}>\n            <option value="">اختر الخزينة...</option>\n            {activeBoxes.map((box) => (\n              <option key={box.id} value={box.id}>{box.name} — {fmtCurrency(Number(box.balance || 0), box.currency)}</option>\n            ))}\n          </select>\n        </div>\n        {selectedBox && (\n          <div className="form-group full">\n            <div style={{ padding: 10, borderRadius: 9, background: "#F8FAFC", color: "#475569", fontSize: 12 }}>\n              العملة: {selectedBox.currency} — الرصيد الحالي: {fmtCurrency(Number(selectedBox.balance || 0), selectedBox.currency)}. هذه الحركة ستؤثر على الخزينة فقط ولن تدخل في صافي الأرباح.\n            </div>\n          </div>\n        )}\n        <div className="form-group full"><label>البيان</label><input value={form.statement} onChange={(e) => set("statement", e.target.value)} /></div>\n        <div className="form-group full"><label>ملاحظات</label><input value={form.note} onChange={(e) => set("note", e.target.value)} /></div>\n      </div>\n      <div className="form-footer"><button data-confirm-save="تأكيد حفظ الحركة" className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "💾 حفظ الحركة"}</button></div>\n    </div>\n  );\n}\n\n\nfunction HistoryTab''',
    "investors TxnForm",
)

# Replace HistoryTab completely.
regex_once(
    "src/routes/investors.tsx",
    r'''function HistoryTab\(.*?\n\}\n\nfunction StatementTab''',
    '''function HistoryTab({ txns, investorName, investors, splits }: { txns: InvestorTransaction[]; investorName: (id: string) => string; investors: Investor[]; splits: FinancialPositionSplit[] }) {\n  const [investorId, setInvestorId] = useState("");\n  const [from, setFrom] = useState("");\n  const [to, setTo] = useState("");\n  const filtered = txns.filter((t) =>\n    (!investorId || t.investor_id === investorId) &&\n    (!from || t.date >= from) &&\n    (!to || t.date <= to)\n  );\n  return (\n    <div className="card">\n      <div className="card-header"><div className="card-title">📜 سجل حركات المالك / المستثمرين</div></div>\n      <div className="card-body">\n        <div className="filter-bar" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 12 }}>\n          <SearchableSelect value={investorId} onChange={setInvestorId} options={investors.map((i) => ({ value: i.id, label: i.investor_name }))} placeholder="كل المالكين / المستثمرين" />\n          <DateInput value={from} onChange={setFrom} placeholder="من" />\n          <DateInput value={to} onChange={setTo} placeholder="إلى" />\n          <button className="action-btn" onClick={() => { setInvestorId(""); setFrom(""); setTo(""); }}>إعادة ضبط</button>\n        </div>\n        <div className="table-wrap enterprise-table">\n          <table className="mobile-cards">\n            <thead><tr><th>#</th><th>التاريخ</th><th>المالك / المستثمر</th><th>نوع الحركة</th><th className="num-col">المبلغ</th><th>العملة</th><th>الخزينة</th><th>البيان</th><th>ملاحظات</th></tr></thead>\n            <tbody>\n              {filtered.length === 0 ? (\n                <tr><td colSpan={9}><div className="empty"><div className="empty-icon">📜</div><div className="empty-text">لا توجد حركات مالية بعد</div></div></td></tr>\n              ) : filtered.map((t, i) => {\n                const isDep = t.transaction_type === "توريد نقدية";\n                const currency = investorTransactionCurrency(t.id, splits);\n                return (\n                  <tr key={t.id}>\n                    <td data-label="#">{i + 1}</td>\n                    <td data-label="التاريخ">{t.date}</td>\n                    <td className="bold" data-label="المالك / المستثمر">{investorName(t.investor_id)}</td>\n                    <td data-label="نوع الحركة">{t.transaction_type}</td>\n                    <td className="num-col" data-label="المبلغ" style={{ color: isDep ? "#15803D" : "#B91C1C", fontWeight: 700 }}>{fmtCurrency(Number(t.amount || 0), currency)}</td>\n                    <td data-label="العملة">{currency}</td>\n                    <td data-label="الخزينة">{t.payment_method || "حركة قديمة غير مربوطة"}</td>\n                    <td data-label="البيان">{(t as any).statement || ""}</td>\n                    <td data-label="ملاحظات">{t.note || "—"}</td>\n                  </tr>\n                );\n              })}\n            </tbody>\n          </table>\n        </div>\n      </div>\n    </div>\n  );\n}\n\nfunction StatementTab''',
    "investors HistoryTab",
)

# Replace StatementTab completely.
regex_once(
    "src/routes/investors.tsx",
    r'''function StatementTab\(.*?\n\}\n\nfunction InvestorsListTab''',
    '''function StatementTab({ txns, investors, splits, canExport }: { txns: InvestorTransaction[]; investors: Investor[]; splits: FinancialPositionSplit[]; canExport: boolean }) {\n  const [investorId, setInvestorId] = useState("");\n  const [from, setFrom] = useState("");\n  const [to, setTo] = useState("");\n\n  const investor = investors.find((i) => i.id === investorId);\n  const filtered = useMemo(() => txns.filter((t) =>\n    (!investorId || t.investor_id === investorId) &&\n    (!from || t.date >= from) &&\n    (!to || t.date <= to)\n  ), [txns, investorId, from, to]);\n  const totals = useMemo(\n    () => buildInvestorCapitalSummary(filtered, splits, { includeLegacy: true }),\n    [filtered, splits],\n  );\n\n  const buildData = () => ({\n    title: `كشف حساب المالك / المستثمر${investor?.investor_name ? ` — ${investor.investor_name}` : ""}`,\n    subtitle: investor ? investor.investor_name : "كل المالكين / المستثمرين",\n    fileName: buildArabicFileName("كشف حساب المالك المستثمر", investor?.investor_name),\n    summary: [\n      { label: "إجمالي التوريد", value: formatCurrencyMap(totals.deposit) },\n      { label: "إجمالي الصرف", value: formatCurrencyMap(totals.withdraw) },\n      { label: "الرصيد", value: formatCurrencyMap(totals.balance) },\n    ],\n    columns: [\n      { header: "#", key: "n" },\n      { header: "التاريخ", key: "date" },\n      { header: "نوع الحركة", key: "type" },\n      { header: "المبلغ", key: "amount" },\n      { header: "العملة", key: "currency" },\n      { header: "الخزينة", key: "method" },\n      { header: "البيان", key: "statement" },\n      { header: "ملاحظات", key: "note" },\n    ],\n    rows: filtered.map((t, i) => {\n      const amount = Number(t.amount || 0);\n      const currency = investorTransactionCurrency(t.id, splits);\n      return {\n        n: i + 1,\n        date: t.date,\n        type: t.transaction_type,\n        amount: fmtCurrency(amount, currency),\n        amount__excel: amount,\n        currency,\n        method: t.payment_method || "حركة قديمة غير مربوطة",\n        statement: (t as any).statement || "",\n        note: t.note || "—",\n      };\n    }),\n  });\n\n  useRegisterStatementCapture(\n    () => ({ data: buildData(), whatsapp: (investor as any)?.whatsapp || null, contextId: investor?.id || null }),\n    [investor, from, to, filtered.length, splits.length, totals.linkedTransactionCount, totals.legacyTransactionCount],\n  );\n\n  return (\n    <div className="card">\n      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>\n        <div className="card-title">🧾 كشف حساب المالك / المستثمر</div>\n        {canExport && <ExportButton disabled={filtered.length === 0} getData={buildData} whatsapp={{ phone: (investor as any)?.whatsapp || (investor as any)?.phone || null, recipientName: (investor as any)?.investor_name || null }} />}\n      </div>\n      <div className="card-body">\n        <div className="filter-bar" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 12 }}>\n          <div className="form-group"><label>المالك / المستثمر</label>\n            <SearchableSelect value={investorId} onChange={setInvestorId} options={investors.map((i) => ({ value: i.id, label: i.investor_name }))} placeholder="اختر..." />\n          </div>\n          <div className="form-group"><label>التاريخ من</label><DateInput value={from} onChange={setFrom} /></div>\n          <div className="form-group"><label>التاريخ إلى</label><DateInput value={to} onChange={setTo} /></div>\n        </div>\n\n        {investor && (\n          <div className="account-summary" style={{ marginBottom: 12 }}>\n            <div className="sum-box"><div className="label">المالك / المستثمر</div><div className="val">{investor.investor_name}</div></div>\n            <div className="sum-box green"><div className="label">إجمالي التوريد</div><div className="val"><CurrencyLines map={totals.deposit} /></div></div>\n            <div className="sum-box red"><div className="label">إجمالي الصرف</div><div className="val"><CurrencyLines map={totals.withdraw} /></div></div>\n            <div className="sum-box gold"><div className="label">الرصيد</div><div className="val"><CurrencyLines map={totals.balance} /></div></div>\n          </div>\n        )}\n\n        <div className="table-wrap enterprise-table">\n          <table className="mobile-cards">\n            <thead><tr><th>#</th><th>التاريخ</th><th>نوع الحركة</th><th className="num-col">المبلغ</th><th>العملة</th><th>الخزينة</th><th>البيان</th><th>ملاحظات</th></tr></thead>\n            <tbody>\n              {filtered.length === 0 ? (\n                <tr><td colSpan={8}><div className="empty"><div className="empty-icon">🧾</div><div className="empty-text">لا توجد حركات في الفترة المحددة</div></div></td></tr>\n              ) : filtered.map((t, i) => {\n                const isDep = t.transaction_type === "توريد نقدية";\n                const currency = investorTransactionCurrency(t.id, splits);\n                return (\n                  <tr key={t.id}>\n                    <td data-label="#">{i + 1}</td>\n                    <td data-label="التاريخ">{t.date}</td>\n                    <td className="bold" data-label="نوع الحركة">{t.transaction_type}</td>\n                    <td className="num-col" data-label="المبلغ" style={{ color: isDep ? "#15803D" : "#B91C1C", fontWeight: 700 }}>{fmtCurrency(Number(t.amount || 0), currency)}</td>\n                    <td data-label="العملة">{currency}</td>\n                    <td data-label="الخزينة">{t.payment_method || "حركة قديمة غير مربوطة"}</td>\n                    <td data-label="البيان">{(t as any).statement || ""}</td>\n                    <td data-label="ملاحظات">{t.note || "—"}</td>\n                  </tr>\n                );\n              })}\n              {filtered.length > 0 && (\n                <tr style={{ background: "#F8FAFC", fontWeight: 800 }}>\n                  <td colSpan={3} data-label="الإجمالي">الرصيد</td>\n                  <td colSpan={5} data-label="الرصيد"><CurrencyLines map={totals.balance} /></td>\n                </tr>\n              )}\n            </tbody>\n          </table>\n        </div>\n      </div>\n    </div>\n  );\n}\n\nfunction InvestorsListTab''',
    "investors StatementTab",
)

# Replace InvestorsListTab completely.
regex_once(
    "src/routes/investors.tsx",
    r'''function InvestorsListTab\(.*?\n\}\n\nfunction EditInvestorModal''',
    '''function InvestorsListTab({ investors, txns, splits, canEdit }: { investors: Investor[]; txns: InvestorTransaction[]; splits: FinancialPositionSplit[]; canEdit: boolean }) {\n  const [edit, setEdit] = useState<Investor | null>(null);\n  const totals = useMemo(() => {\n    const map = new Map<string, ReturnType<typeof buildInvestorCapitalSummary>>();\n    for (const investor of investors) {\n      map.set(\n        investor.id,\n        buildInvestorCapitalSummary(txns.filter((t) => t.investor_id === investor.id), splits, { includeLegacy: true }),\n      );\n    }\n    return map;\n  }, [investors, txns, splits]);\n\n  return (\n    <div className="card">\n      <div className="card-header"><div className="card-title">🧑‍💼 قائمة المالكين / المستثمرين</div></div>\n      <div className="card-body">\n        <div className="table-wrap enterprise-table">\n          <table className="mobile-cards">\n            <thead><tr><th>#</th><th>المالك / المستثمر</th><th>الهاتف</th><th>الواتساب</th><th className="num-col">إجمالي التوريد</th><th className="num-col">إجمالي الصرف</th><th className="num-col">الرصيد</th><th>إجراءات</th></tr></thead>\n            <tbody>\n              {investors.length === 0 ? (\n                <tr><td colSpan={8}><div className="empty"><div className="empty-icon">🧑‍💼</div><div className="empty-text">لا يوجد مالكون / مستثمرون</div></div></td></tr>\n              ) : investors.map((inv, i) => {\n                const t = totals.get(inv.id) || buildInvestorCapitalSummary([], [], { includeLegacy: true });\n                return (\n                  <tr key={inv.id}>\n                    <td data-label="#">{i + 1}</td>\n                    <td className="bold" data-label="المالك / المستثمر">{inv.investor_name}</td>\n                    <td data-label="الهاتف">{inv.phone || "—"}</td>\n                    <td data-label="الواتساب">{inv.whatsapp || "—"}</td>\n                    <td className="num-col" data-label="إجمالي التوريد" style={{ color: "#15803D", fontWeight: 700 }}><CurrencyLines map={t.deposit} /></td>\n                    <td className="num-col" data-label="إجمالي الصرف" style={{ color: "#B91C1C", fontWeight: 700 }}><CurrencyLines map={t.withdraw} /></td>\n                    <td className="num-col" data-label="الرصيد" style={{ fontWeight: 800 }}><CurrencyLines map={t.balance} /></td>\n                    <td data-label="إجراءات">{canEdit ? <button className="action-btn" onClick={() => setEdit(inv)}>✏️ تعديل</button> : "—"}</td>\n                  </tr>\n                );\n              })}\n            </tbody>\n          </table>\n        </div>\n      </div>\n      {edit && canEdit && <EditInvestorModal investor={edit} onClose={() => setEdit(null)} />}\n    </div>\n  );\n}\n\nfunction EditInvestorModal''',
    "investors InvestorsListTab",
)

print("Scoped owner financial-position patch applied successfully")
