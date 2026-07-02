import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { fmtDL, useLive, type Investor, type InvestorTransaction } from "@/lib/db";
import { ExportButton } from "@/components/ExportButton";
import { useRegisterStatementCapture } from "@/lib/statementCapture";
import { Briefcase, ArrowDownCircle, ArrowUpCircle, Wallet, UserPlus, Users, Receipt, FileText, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { NumberInput } from "@/components/inputs/NumberInput";
import { DateInput } from "@/components/inputs/DateInput";

export const Route = createFileRoute("/investors")({
  component: InvestorsPage,
});

const PAYMENT_METHODS = ["انستا", "نقدي", "كاش"] as const;
const TXN_TYPES = ["صرف نقدية", "توريد نقدية"] as const;

type Tab = "list" | "add" | "history" | "statement" | "withdraw" | "deposit";

function InvestorsPage() {
  const { rows: investors } = useLive<Investor>("investors");
  const { rows: txns } = useLive<InvestorTransaction>("investor_transactions");
  const [tab, setTab] = useState<Tab>("history");

  const totalDeposit = useMemo(
    () => txns.filter((t) => t.transaction_type === "توريد نقدية").reduce((s, t) => s + Number(t.amount || 0), 0),
    [txns],
  );
  const totalWithdraw = useMemo(
    () => txns.filter((t) => t.transaction_type === "صرف نقدية").reduce((s, t) => s + Number(t.amount || 0), 0),
    [txns],
  );
  const balance = totalDeposit - totalWithdraw;

  const investorName = (id: string) => investors.find((i) => i.id === id)?.investor_name || "—";

  return (
    <div className="section active fin-page accounts-page">
      <div className="page-head">
        <div className="page-head-text">
          <div className="breadcrumb-row">
            <span>الحسابات المالية</span>
            <span>›</span>
            <span className="crumb-current">حسابات المستثمرين</span>
          </div>
          <h1 className="page-h1"><Briefcase size={22} strokeWidth={2.2} /> حسابات المستثمرين</h1>
          <div className="page-sub">إدارة الإيداعات والسحوبات وأرصدة المستثمرين</div>
        </div>
        <button className="page-head-cta" onClick={() => setTab("add")}>
          <UserPlus size={16} strokeWidth={2.4} /> إضافة مستثمر
        </button>
      </div>
      <div className="account-summary kpi-rich kpi-investors">
        <div className="sum-box green">
          <span className="kpi-icon"><ArrowDownCircle size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">إجمالي الإيداعات</div><div className="val">{fmtDL(totalDeposit)}</div></div>
        </div>
        <div className="sum-box red">
          <span className="kpi-icon"><ArrowUpCircle size={20} strokeWidth={2} /></span>
          <div className="kpi-text"><div className="label">إجمالي السحوبات</div><div className="val">{fmtDL(totalWithdraw)}</div></div>
        </div>
        <div className="sum-box hero">
          <span className="kpi-icon"><Wallet size={22} strokeWidth={2} /></span>
          <div className="kpi-text">
            <div className="label">صافي الرصيد</div>
            <div className="val">{fmtDL(balance)}</div>
            <div className="kpi-sub">الرصيد الصافي للمستثمرين</div>
          </div>
        </div>
      </div>

      <div className="action-toolbar">
        <div className={`tool-tab ${tab === "history" ? "active" : ""}`} onClick={() => setTab("history")}>
          <Receipt size={15} strokeWidth={2} /> <span>سجل الحركات</span>
        </div>
        <div className={`tool-tab ${tab === "list" ? "active" : ""}`} onClick={() => setTab("list")}>
          <Users size={15} strokeWidth={2} /> <span>قائمة المستثمرين</span>
        </div>
        <div className={`tool-tab ${tab === "statement" ? "active" : ""}`} onClick={() => setTab("statement")}>
          <FileText size={15} strokeWidth={2} /> <span>كشف حساب</span>
        </div>
        <div className={`tool-tab ${tab === "deposit" ? "active" : ""}`} onClick={() => setTab("deposit")}>
          <ArrowDownLeft size={15} strokeWidth={2} /> <span>توريد نقدية</span>
        </div>
        <div className={`tool-tab ${tab === "withdraw" ? "active" : ""}`} onClick={() => setTab("withdraw")}>
          <ArrowUpRight size={15} strokeWidth={2} /> <span>صرف نقدية</span>
        </div>
      </div>

      {tab === "list" && <InvestorsListTab investors={investors} txns={txns} />}

      {tab === "add" && (
        <>
          <InvestorForm />
          <div className="card" style={{ marginTop: 16 }}>
            <div className="card-header"><div className="card-title">🧑‍💼 قائمة المستثمرين</div></div>
            <div className="card-body">
              <div className="table-wrap">
                <table className="mobile-cards">
                  <thead><tr><th>#</th><th>اسم المستثمر</th><th>الهاتف</th><th>الواتساب</th></tr></thead>
                  <tbody>
                    {investors.length === 0 ? (
                      <tr><td colSpan={4}><div className="empty"><div className="empty-icon">🧑‍💼</div><div className="empty-text">أضف مستثمر من تبويب "إضافة مستثمر جديد"</div></div></td></tr>
                    ) : investors.map((inv, i) => (
                      <tr key={inv.id}>
                        <td data-label="#">{i + 1}</td>
                        <td className="bold" data-label="اسم المستثمر">{inv.investor_name}</td>
                        <td data-label="الهاتف">{inv.phone || "—"}</td>
                        <td data-label="الواتساب">{inv.whatsapp || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      )}

      {tab === "history" && <HistoryTab txns={txns} investorName={investorName} investors={investors} />}
      {tab === "statement" && <StatementTab txns={txns} investors={investors} />}
      {tab === "withdraw" && <TxnForm investors={investors} kind="صرف نقدية" methodLabel="وسيلة الصرف" title="⬆️ صرف نقدية" />}
      {tab === "deposit" && <TxnForm investors={investors} kind="توريد نقدية" methodLabel="وسيلة التوريد" title="⬇️ توريد نقدية" />}
    </div>
  );
}

function InvestorForm() {
  const [form, setForm] = useState({ investor_name: "", phone: "", whatsapp: "" });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.investor_name.trim()) return toast.error("اسم المستثمر مطلوب");
    const { error } = await supabase.from("investors").insert({
      investor_name: form.investor_name,
      phone: form.phone || null,
      whatsapp: form.whatsapp || null,
    });
    if (error) return toast.error(error.message);
    setForm({ investor_name: "", phone: "", whatsapp: "" });
  };
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">➕ إضافة مستثمر جديد</div></div>
      <div className="form-grid">
        <div className="form-group"><label>اسم المستثمر</label><input value={form.investor_name} onChange={(e) => set("investor_name", e.target.value)} /></div>
        <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
        <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
      </div>
      <div className="form-footer"><button data-confirm-save="تأكيد حفظ المستثمر" className="btn btn-gold" onClick={save}>💾 حفظ المستثمر</button></div>
    </div>
  );
}

function TxnForm({ investors, kind, methodLabel, title }: { investors: Investor[]; kind: typeof TXN_TYPES[number]; methodLabel: string; title: string }) {
  const [form, setForm] = useState({
    investor_id: "",
    date: new Date().toISOString().slice(0, 10),
    amount: "",
    payment_method: "",
    note: "",
    statement: "",
  });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.investor_id) return toast.error("اختر المستثمر");
    if (!Number(form.amount)) return toast.error("أدخل المبلغ");
    if (!form.payment_method) return toast.error(`اختر ${methodLabel}`);
    const { error } = await supabase.from("investor_transactions").insert({
      investor_id: form.investor_id,
      transaction_type: kind,
      date: form.date,
      amount: Math.round(Number(form.amount || 0)),
      payment_method: form.payment_method,
      note: form.note.trim() ? form.note.trim() : null,
      statement: form.statement.trim() ? form.statement.trim() : null,
    } as any);
    if (error) return toast.error(error.message);
    setForm({ investor_id: "", date: new Date().toISOString().slice(0, 10), amount: "", payment_method: "", note: "", statement: "" });
  };
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">{title}</div></div>
      <div className="form-grid">
        <div className="form-group"><label>المستثمر</label>
          <SearchableSelect value={form.investor_id} onChange={(v) => set("investor_id", v)} options={investors.map((i) => ({ value: i.id, label: i.investor_name }))} placeholder="اختر..." />
        </div>
        <div className="form-group"><label>التاريخ</label><DateInput value={form.date} onChange={(iso) => set("date", iso)} defaultToday /></div>
        <div className="form-group"><label>المبلغ</label><NumberInput value={Number(form.amount) || 0} onChange={(n) => set("amount", n === 0 ? "" : String(n))} min={0} /></div>
        <div className="form-group"><label>{methodLabel}</label>
          <SearchableSelect value={form.payment_method} onChange={(v) => set("payment_method", v)} options={PAYMENT_METHODS as unknown as string[]} placeholder="اختر..." />
        </div>
        <div className="form-group full"><label>البيان</label><input value={form.statement} onChange={(e) => set("statement", e.target.value)} /></div>
        <div className="form-group full"><label>ملاحظات</label><input value={form.note} onChange={(e) => set("note", e.target.value)} /></div>
      </div>
      <div className="form-footer"><button data-confirm-save="تأكيد حفظ الحركة" className="btn btn-gold" onClick={save}>💾 حفظ الحركة</button></div>
    </div>
  );
}


function HistoryTab({ txns, investorName, investors }: { txns: InvestorTransaction[]; investorName: (id: string) => string; investors: Investor[] }) {
  const [investorId, setInvestorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const filtered = txns.filter((t) =>
    (!investorId || t.investor_id === investorId) &&
    (!from || t.date >= from) &&
    (!to || t.date <= to)
  );
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">📜 سجل الحركات المالية للمستثمرين</div></div>
      <div className="card-body">
        <div className="filter-bar" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 12 }}>
          <SearchableSelect value={investorId} onChange={setInvestorId} options={investors.map((i) => ({ value: i.id, label: i.investor_name }))} placeholder="كل المستثمرين" />
          <DateInput value={from} onChange={setFrom} placeholder="من" />
          <DateInput value={to} onChange={setTo} placeholder="إلى" />
          <button className="action-btn" onClick={() => { setInvestorId(""); setFrom(""); setTo(""); }}>إعادة ضبط</button>
        </div>
        <div className="table-wrap enterprise-table">
          <table className="mobile-cards">
            <thead><tr><th>#</th><th>التاريخ</th><th>المستثمر</th><th>نوع الحركة</th><th className="num-col">المبلغ</th><th>وسيلة الدفع</th><th>البيان</th><th>ملاحظات</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={7}><div className="empty"><div className="empty-icon">📜</div><div className="empty-text">لا توجد حركات مالية للمستثمرين بعد</div></div></td></tr>
              ) : filtered.map((t, i) => {
                const isDep = t.transaction_type === "توريد نقدية";
                return (
                  <tr key={t.id}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="التاريخ">{t.date}</td>
                    <td className="bold" data-label="المستثمر">{investorName(t.investor_id)}</td>
                    <td data-label="نوع الحركة">{t.transaction_type}</td>
                    <td className="num-col" data-label="المبلغ" style={{ color: isDep ? "#15803D" : "#B91C1C", fontWeight: 700 }}>{fmtDL(Number(t.amount || 0))}</td>
                    <td data-label="وسيلة الدفع">{t.payment_method || "—"}</td>
                    <td data-label="ملاحظات">{t.note || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatementTab({ txns, investors }: { txns: InvestorTransaction[]; investors: Investor[] }) {
  const [investorId, setInvestorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const investor = investors.find((i) => i.id === investorId);
  const filtered = txns.filter((t) =>
    (!investorId || t.investor_id === investorId) &&
    (!from || t.date >= from) &&
    (!to || t.date <= to)
  );
  const totalDeposit = filtered.filter((t) => t.transaction_type === "توريد نقدية").reduce((s, t) => s + Number(t.amount || 0), 0);
  const totalWithdraw = filtered.filter((t) => t.transaction_type === "صرف نقدية").reduce((s, t) => s + Number(t.amount || 0), 0);
  const balance = totalDeposit - totalWithdraw;

  const buildData = () => ({
    title: "كشف حساب المستثمر",
    subtitle: investor ? investor.investor_name : "كل المستثمرين",
    fileName: `كشف-حساب-${investor?.investor_name || "المستثمرين"}`,
    summary: [
      { label: "إجمالي التوريد", value: fmtDL(totalDeposit) },
      { label: "إجمالي الصرف", value: fmtDL(totalWithdraw) },
      { label: "الرصيد", value: fmtDL(balance) },
    ],
    columns: [
      { header: "#", key: "n" },
      { header: "التاريخ", key: "date" },
      { header: "نوع الحركة", key: "type" },
      { header: "المبلغ", key: "amount" },
      { header: "وسيلة الدفع", key: "method" },
      { header: "ملاحظات", key: "note" },
    ],
    rows: filtered.map((t, i) => {
      const amount = Number(t.amount || 0);
      return {
        n: i + 1,
        date: t.date,
        type: t.transaction_type,
        amount: fmtDL(amount),
        amount__excel: amount,
        method: t.payment_method || "—",
        note: t.note || "—",
      };
    }),
  });

  useRegisterStatementCapture(
    () => ({ data: buildData(), whatsapp: (investor as any)?.whatsapp || null, contextId: investor?.id || null }),
    [investor, from, to, filtered.length, totalDeposit, totalWithdraw],
  );

  return (
    <div className="card">
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div className="card-title">🧾 كشف حساب المستثمر</div>
        <ExportButton disabled={filtered.length === 0} getData={buildData} />
      </div>
      <div className="card-body">
        <div className="filter-bar" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 8, marginBottom: 12 }}>
          <div className="form-group"><label>المستثمر</label>
            <SearchableSelect value={investorId} onChange={setInvestorId} options={investors.map((i) => ({ value: i.id, label: i.investor_name }))} placeholder="اختر..." />
          </div>
          <div className="form-group"><label>التاريخ من</label><DateInput value={from} onChange={setFrom} /></div>
          <div className="form-group"><label>التاريخ إلى</label><DateInput value={to} onChange={setTo} /></div>
        </div>

        {investor && (
          <div className="account-summary" style={{ marginBottom: 12 }}>
            <div className="sum-box"><div className="label">المستثمر</div><div className="val">{investor.investor_name}</div></div>
            <div className="sum-box"><div className="label">الهاتف</div><div className="val">{investor.phone || "—"}</div></div>
            <div className="sum-box"><div className="label">الواتساب</div><div className="val">{investor.whatsapp || "—"}</div></div>
            <div className="sum-box green"><div className="label">إجمالي التوريد</div><div className="val">{fmtDL(totalDeposit)}</div></div>
            <div className="sum-box red"><div className="label">إجمالي الصرف</div><div className="val">{fmtDL(totalWithdraw)}</div></div>
            <div className="sum-box gold"><div className="label">الرصيد</div><div className="val">{fmtDL(balance)}</div></div>
          </div>
        )}

        <div className="table-wrap enterprise-table">
          <table className="mobile-cards">
            <thead><tr><th>#</th><th>التاريخ</th><th>نوع الحركة</th><th className="num-col">المبلغ</th><th>وسيلة الدفع</th><th>ملاحظات</th></tr></thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={6}><div className="empty"><div className="empty-icon">🧾</div><div className="empty-text">لا توجد حركات في الفترة المحددة</div></div></td></tr>
              ) : filtered.map((t, i) => {
                const isDep = t.transaction_type === "توريد نقدية";
                return (
                  <tr key={t.id}>
                    <td data-label="#">{i + 1}</td>
                    <td data-label="التاريخ">{t.date}</td>
                    <td className="bold" data-label="نوع الحركة">{t.transaction_type}</td>
                    <td className="num-col" data-label="المبلغ" style={{ color: isDep ? "#15803D" : "#B91C1C", fontWeight: 700 }}>{fmtDL(Number(t.amount || 0))}</td>
                    <td data-label="وسيلة الدفع">{t.payment_method || "—"}</td>
                    <td data-label="ملاحظات">{t.note || "—"}</td>
                  </tr>
                );
              })}
              {filtered.length > 0 && (
                <tr style={{ background: "#F8FAFC", fontWeight: 800 }}>
                  <td colSpan={3} data-label="الإجمالي">الإجمالي</td>
                  <td className="num-col" data-label="الرصيد" style={{ color: balance >= 0 ? "#15803D" : "#B91C1C" }}>{fmtDL(balance)}</td>
                  <td colSpan={2}></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function InvestorsListTab({ investors, txns }: { investors: Investor[]; txns: InvestorTransaction[] }) {
  const [edit, setEdit] = useState<Investor | null>(null);
  const totals = useMemo(() => {
    const map = new Map<string, { dep: number; wd: number }>();
    for (const t of txns) {
      const v = map.get(t.investor_id) || { dep: 0, wd: 0 };
      if (t.transaction_type === "توريد نقدية") v.dep += Number(t.amount || 0);
      else if (t.transaction_type === "صرف نقدية") v.wd += Number(t.amount || 0);
      map.set(t.investor_id, v);
    }
    return map;
  }, [txns]);
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">🧑‍💼 قائمة المستثمرين</div></div>
      <div className="card-body">
        <div className="table-wrap enterprise-table">
          <table className="mobile-cards">
            <thead><tr><th>#</th><th>اسم المستثمر</th><th>الهاتف</th><th>الواتساب</th><th className="num-col">إجمالي التوريد</th><th className="num-col">إجمالي الصرف</th><th className="num-col">الرصيد</th><th>إجراءات</th></tr></thead>
            <tbody>
              {investors.length === 0 ? (
                <tr><td colSpan={8}><div className="empty"><div className="empty-icon">🧑‍💼</div><div className="empty-text">لا يوجد مستثمرين</div></div></td></tr>
              ) : investors.map((inv, i) => {
                const t = totals.get(inv.id) || { dep: 0, wd: 0 };
                const bal = t.dep - t.wd;
                return (
                  <tr key={inv.id}>
                    <td data-label="#">{i + 1}</td>
                    <td className="bold" data-label="اسم المستثمر">{inv.investor_name}</td>
                    <td data-label="الهاتف">{inv.phone || "—"}</td>
                    <td data-label="الواتساب">{inv.whatsapp || "—"}</td>
                    <td className="num-col" data-label="إجمالي التوريد" style={{ color: "#15803D", fontWeight: 700 }}>{fmtDL(t.dep)}</td>
                    <td className="num-col" data-label="إجمالي الصرف" style={{ color: "#B91C1C", fontWeight: 700 }}>{fmtDL(t.wd)}</td>
                    <td className="num-col" data-label="الرصيد" style={{ fontWeight: 800, color: bal >= 0 ? "#15803D" : "#B91C1C" }}>{fmtDL(bal)}</td>
                    <td data-label="إجراءات"><button className="action-btn" onClick={() => setEdit(inv)}>✏️ تعديل</button></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {edit && <EditInvestorModal investor={edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function EditInvestorModal({ investor, onClose }: { investor: Investor; onClose: () => void }) {
  const [form, setForm] = useState({
    investor_name: investor.investor_name || "",
    phone: investor.phone || "",
    whatsapp: investor.whatsapp || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.investor_name.trim()) return toast.error("اسم المستثمر مطلوب");
    setSaving(true);
    const { error } = await supabase.from("investors").update({
      investor_name: form.investor_name.trim(),
      phone: form.phone.trim() || null,
      whatsapp: form.whatsapp.trim() || null,
    }).eq("id", investor.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    onClose();
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto", margin: 0 }}>
        <div className="card-header"><div className="card-title">✏️ تعديل بيانات المستثمر</div></div>
        <div className="form-grid">
          <div className="form-group"><label>اسم المستثمر</label><input value={form.investor_name} onChange={(e) => set("investor_name", e.target.value)} /></div>
          <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="action-btn" onClick={onClose} disabled={saving}>إلغاء</button>
          <button data-confirm-save="تأكيد حفظ التعديلات" type="button" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ التعديلات</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
