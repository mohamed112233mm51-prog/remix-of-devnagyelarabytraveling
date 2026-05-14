import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronLeft, ShieldCheck, FileText, ListChecks, Search, Plus, Pencil, ShieldAlert, ShieldX, Clock, Zap, CalendarClock, Layers } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { badgeFor, useLive, useDropdownOptions, withSelected, buildTravelStatement, type Agent, type Approval, type IssuingCompany } from "@/lib/db";
import { syncCounterpart } from "@/lib/sync";
import { usePerm } from "@/hooks/usePerm";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { SafeSelectOptions } from "@/components/SafeSelectOptions";

export const Route = createFileRoute("/approvals")({
  component: () => <AppErrorBoundary><ApprovalsPage /></AppErrorBoundary>,
  errorComponent: () => <SafePageError />,
});

const STATUSES = ["سريعة", "بطيئة", "رفض أمني"];

function SafePageError() {
  return <div className="card" style={{ padding: 24 }}>تعذر تحميل الموافقات مؤقتًا. <button className="btn btn-gold" onClick={() => window.location.reload()}>إعادة المحاولة</button></div>;
}

function ApprovalsPage() {
  const perm = usePerm("approvals");
  const { rows: approvals, loading } = useLive<Approval>("approvals");
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const DESTINATIONS = useDropdownOptions("destination");
  const [tab, setTab] = useState<"list" | "add">("list");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [destination, setDestination] = useState("");
  const [editing, setEditing] = useState<Approval | null>(null);

  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name || "—";

  const filtered = useMemo(() => approvals.filter((a) => {
    if (search) {
      const q = search.toLowerCase();
      const aName = (agents.find((ag) => ag.id === a.agent_id)?.name || "").toLowerCase();
      const hay = `${a.passenger_name} ${a.passport || ""} ${a.national_id || ""} ${aName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (status && a.status !== status) return false;
    if (destination && a.destination !== destination) return false;
    return true;
  }), [approvals, agents, search, status, destination]);

  const stats = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    return {
      total: approvals.length,
      fast: approvals.filter((a) => a.status === "سريعة").length,
      slow: approvals.filter((a) => a.status === "بطيئة").length,
      rejected: approvals.filter((a) => a.status === "رفض أمني").length,
      pending: approvals.filter((a) => !a.issue_date).length,
      today: approvals.filter((a) => (a.submit_date || "").slice(0, 10) === today).length,
    };
  }, [approvals]);

  const activeFilters = (status ? 1 : 0) + (destination ? 1 : 0) + (search ? 1 : 0);
  const clearFilters = () => { setSearch(""); setStatus(""); setDestination(""); };

  return (
    <div className="section active accounts-page">
      <div className="page-head">
        <div className="page-head-text">
          <div className="breadcrumb-row">
            <span>العمليات</span>
            <ChevronLeft size={12} strokeWidth={2} />
            <span>الموافقات الأمنية</span>
            <ChevronLeft size={12} strokeWidth={2} />
            <span className="crumb-current">التقديمات</span>
          </div>
          <h1 className="page-h1"><ShieldCheck size={20} strokeWidth={2.2} /> تقديمات الموافقات الأمنية</h1>
          <div className="page-sub">إدارة ومتابعة حالات الموافقات الأمنية للمسافرين</div>
        </div>
        {perm.create && (
          <button className="btn btn-gold page-head-cta" onClick={() => setTab("add")} type="button">
            <Plus size={16} strokeWidth={2.4} /> تقديم موافقة
          </button>
        )}
      </div>

      <div
        className="account-summary kpi-rich"
        style={{ gridTemplateColumns: "repeat(6, minmax(0,1fr))" }}
      >
        <div className="sum-box">
          <div className="kpi-icon"><Layers size={18} strokeWidth={2} /></div>
          <div className="kpi-text"><div className="label">إجمالي التقديمات</div><div className="val">{stats.total}</div></div>
        </div>
        <div className="sum-box green">
          <div className="kpi-icon"><Zap size={18} strokeWidth={2} /></div>
          <div className="kpi-text"><div className="label">الموافقات السريعة</div><div className="val">{stats.fast}</div></div>
        </div>
        <div className="sum-box gold">
          <div className="kpi-icon"><Clock size={18} strokeWidth={2} /></div>
          <div className="kpi-text"><div className="label">الموافقات البطيئة</div><div className="val">{stats.slow}</div></div>
        </div>
        <div className="sum-box red">
          <div className="kpi-icon"><ShieldX size={18} strokeWidth={2} /></div>
          <div className="kpi-text"><div className="label">الرفض الأمني</div><div className="val">{stats.rejected}</div></div>
        </div>
        <div className="sum-box">
          <div className="kpi-icon"><ShieldAlert size={18} strokeWidth={2} /></div>
          <div className="kpi-text"><div className="label">قيد المراجعة</div><div className="val">{stats.pending}</div></div>
        </div>
        <div className="sum-box">
          <div className="kpi-icon"><CalendarClock size={18} strokeWidth={2} /></div>
          <div className="kpi-text"><div className="label">تقديمات اليوم</div><div className="val">{stats.today}</div></div>
        </div>
      </div>

      <div className="action-toolbar">
        <div className={`tool-tab ${tab === "list" ? "active" : ""}`} onClick={() => setTab("list")}>
          <ListChecks size={15} strokeWidth={2} /> <span>سجل التقديمات</span>
        </div>
        {perm.create && (
          <div
            className={`tool-tab tool-tab--primary ${tab === "add" ? "active" : ""}`}
            onClick={() => setTab("add")}
          >
            <Plus size={15} strokeWidth={2.4} /> <span>تقديم موافقة</span>
          </div>
        )}
      </div>

      {tab === "list" ? (
        <>
          <div className="filter-bar">
            <div className="search-wrap">
              <Search size={15} strokeWidth={2} className="search-wrap-icon" />
              <input
                className="search-input search-input--with-icon"
                placeholder="ابحث بالاسم، الجواز، الرقم القومي، أو الوكيل..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <select className="filter-select" value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="">جميع الوجهات</option>
              <SafeSelectOptions options={DESTINATIONS} />
            </select>
            <select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">جميع الحالات</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            {activeFilters > 0 && (
              <button type="button" className="btn" onClick={clearFilters} style={{ height: 38 }}>
                مسح الفلاتر ({activeFilters})
              </button>
            )}
          </div>

          <div className="card enterprise-table">
            <div className="card-header">
              <div className="card-title">
                <FileText size={16} strokeWidth={2.2} style={{ marginInlineEnd: 6, verticalAlign: "-3px", color: "var(--primary)" }} />
                سجل التقديمات
                <span className="muted-count">({filtered.length})</span>
              </div>
            </div>
            <div className="card-body">
              <div className="table-wrap">
                <table className="mobile-cards">
                  <thead>
                    <tr>
                      <th>#</th><th>اسم المسافر</th><th>الرقم القومي</th><th>رقم الجواز</th><th>الوجهة</th>
                      <th>الجهة</th><th>الشركة الصادرة</th><th>بيان السفر</th><th>الوكيل</th>
                      <th>تاريخ التقديم</th><th>تاريخ الصدور</th><th>الحالة</th><th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <tr key={`sk-${i}`}>
                          {Array.from({ length: 13 }).map((__, j) => (
                            <td key={j}><div style={{ height: 12, background: "#EEF2F7", borderRadius: 6, opacity: 0.7 }} /></td>
                          ))}
                        </tr>
                      ))
                    ) : filtered.length === 0 ? (
                      <tr>
                        <td colSpan={13}>
                          <div className="empty" style={{ padding: "40px 20px" }}>
                            <div className="empty-icon" style={{ width: 64, height: 64, borderRadius: 16, background: "#EFF6FF", color: "var(--primary)", display: "grid", placeItems: "center", margin: "0 auto 12px" }}>
                              <ShieldCheck size={30} strokeWidth={1.8} />
                            </div>
                            <div className="empty-text" style={{ fontWeight: 700, color: "var(--text)" }}>لا توجد تقديمات حالياً</div>
                            <div style={{ fontSize: 12.5, color: "var(--text3)", marginTop: 4 }}>
                              {activeFilters > 0 ? "جرّب تعديل الفلاتر أو مسحها لعرض جميع التقديمات." : "ابدأ بإضافة أول تقديم موافقة أمنية."}
                            </div>
                          </div>
                        </td>
                      </tr>
                    ) : filtered.map((a, i) => (
                      <tr key={a.id}>
                        <td data-label="#" className="num-col">{i + 1}</td>
                        <td className="bold" data-label="المسافر">{a.passenger_name}</td>
                        <td data-label="الرقم القومي">{a.national_id || "—"}</td>
                        <td data-label="الجواز">{a.passport || "—"}</td>
                        <td data-label="الوجهة">{a.destination || "—"}</td>
                        <td data-label="الجهة">{a.authority || "—"}</td>
                        <td data-label="الشركة الصادرة">{a.issuing_company || "—"}</td>
                        <td data-label="بيان السفر">{a.travel_statement || "—"}</td>
                        <td data-label="الوكيل">{agentName(a.agent_id)}</td>
                        <td data-label="التقديم" className="num-col">{a.submit_date || "—"}</td>
                        <td data-label="الصدور" className="num-col">{a.issue_date || "—"}</td>
                        <td data-label="الحالة"><span className={`pill-badge ${badgeFor(a.status)}`}>{a.status}</span></td>
                        <td data-label="إجراءات">
                          {perm.edit ? (
                            <button
                              type="button"
                              className="btn"
                              onClick={() => setEditing(a)}
                              title="تعديل"
                              style={{ height: 32, padding: "0 12px", display: "inline-flex", alignItems: "center", gap: 6 }}
                            >
                              <Pencil size={13} strokeWidth={2.2} /> تعديل
                            </button>
                          ) : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </>
      ) : (
        perm.create ? <ApprovalForm agents={agents} companies={companies} onDone={() => setTab("list")} /> : null
      )}
      {editing && perm.edit && (
        <EditApprovalModal approval={editing} agents={agents} companies={companies} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

function ApprovalForm({ agents, companies, onDone }: { agents: Agent[]; companies: IssuingCompany[]; onDone: () => void }) {
  const [form, setForm] = useState({
    passenger_name: "", national_id: "", passport: "", dob: "",
    destination: "", authority: "", issuing_company: "",
    agent_id: "", submit_date: "", issue_date: "",
    travel_date: "", airline: "",
    status: "", government_fee: "", notes: "",
  });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const DESTINATIONS = withSelected(useDropdownOptions("destination"), form.destination);
  const AUTHORITIES = withSelected(useDropdownOptions("authority"), form.authority);
  const AIRLINES = withSelected(useDropdownOptions("airline"), form.airline);
  const travelStatement = buildTravelStatement(form.destination, form.travel_date, form.airline);

  const save = async () => {
    if (!form.passenger_name.trim()) return alert("اسم المسافر مطلوب");
    if (!form.destination || !form.authority || !form.agent_id || !form.status) return alert("برجاء اختيار قيمة من القائمة");
    if (!form.issuing_company) return alert("برجاء اختيار الشركة الصادرة");
    let issuing_company_id = companies.find((c) => c.company_name === form.issuing_company)?.id || null;
    if (!issuing_company_id) {
      const { data, error: cErr } = await supabase.from("issuing_companies").insert({ company_name: form.issuing_company, status: "نشط" }).select("id").single();
      if (cErr) return alert(cErr.message);
      issuing_company_id = data.id;
    }
    const shared = {
      passenger_name: form.passenger_name,
      national_id: form.national_id || null,
      passport: form.passport || null,
      dob: form.dob || null,
      destination: form.destination || null,
      agent_id: form.agent_id || null,
      status: form.status,
      notes: form.notes || null,
      travel_date: form.travel_date || null,
      airline: form.airline || null,
      authority: form.authority || null,
      issuing_company: form.issuing_company || null,
      travel_statement: travelStatement || null,
    };
    const payload = {
      ...shared,
      issuing_company_id,
      submit_date: form.submit_date || null,
      issue_date: form.issue_date || null,
      government_fee: Number(form.government_fee || 0),
    };
    try {
      const { error } = await supabase.from("approvals").insert(payload);
      if (error) return toast.error(error.message);
      await syncCounterpart("approvals", shared);
      onDone();
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ الموافقة");
    }
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">➕ تقديم موافقة أمنية</div></div>
      <div className="form-grid">
        <div className="form-group"><label>اسم المسافر</label><input value={form.passenger_name} onChange={(e) => set("passenger_name", e.target.value)} /></div>
        <div className="form-group"><label>الرقم القومي</label><input value={form.national_id} onChange={(e) => set("national_id", e.target.value)} /></div>
        <div className="form-group"><label>رقم الجواز</label><input value={form.passport} onChange={(e) => set("passport", e.target.value)} /></div>
        <div className="form-group"><label>تاريخ الميلاد</label><input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} /></div>
        <div className="form-group"><label>الوجهة</label>
          <select value={form.destination} onChange={(e) => set("destination", e.target.value)}>
            <option value="" disabled>اختر...</option>
            <SafeSelectOptions options={DESTINATIONS} />
          </select>
        </div>
        <div className="form-group"><label>الجهة</label>
          <select value={form.authority} onChange={(e) => set("authority", e.target.value)}>
            <option value="" disabled>اختر...</option>
            <SafeSelectOptions options={AUTHORITIES} />
          </select>
        </div>
        <div className="form-group"><label>الشركة الصادرة</label>
          <select value={form.issuing_company} onChange={(e) => set("issuing_company", e.target.value)}>
            <option value="" disabled>اختر...</option>
            {companies.map((c) => <option key={c.id} value={c.company_name}>{c.company_name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>الوكيل</label>
          <select value={form.agent_id} onChange={(e) => set("agent_id", e.target.value)}>
            <option value="" disabled>اختر...</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>تاريخ التقديم</label><input type="date" value={form.submit_date} onChange={(e) => set("submit_date", e.target.value)} /></div>
        <div className="form-group"><label>تاريخ الصدور</label><input type="date" value={form.issue_date} onChange={(e) => set("issue_date", e.target.value)} /></div>
        <div className="form-group"><label>تاريخ السفر</label><input type="date" value={form.travel_date} onChange={(e) => set("travel_date", e.target.value)} /></div>
        <div className="form-group"><label>شركة الطيران</label>
          <select value={form.airline} onChange={(e) => set("airline", e.target.value)}>
            <option value="" disabled>اختر...</option>
            <SafeSelectOptions options={AIRLINES} />
          </select>
        </div>
        <div className="form-group"><label>الحالة</label>
          <select value={form.status} onChange={(e) => set("status", e.target.value)}>
            <option value="" disabled>اختر...</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group"><label>مبلغ الموافقة</label><input type="number" placeholder="0" value={form.government_fee} onChange={(e) => set("government_fee", e.target.value)} /></div>
        <div className="form-group full"><label>بيان السفر (تلقائي)</label><input value={travelStatement} disabled readOnly /></div>
        <div className="form-group full"><label>ملاحظات</label><textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      </div>
      <div className="form-footer">
        <button className="btn btn-gold" onClick={save}>💾 حفظ التقديم</button>
      </div>
    </div>
  );
}

function EditApprovalModal({ approval, agents, companies, onClose }: { approval: Approval; agents: Agent[]; companies: IssuingCompany[]; onClose: () => void }) {
  const [form, setForm] = useState({
    passenger_name: approval.passenger_name || "",
    national_id: approval.national_id || "",
    passport: approval.passport || "",
    dob: approval.dob || "",
    destination: approval.destination || "",
    authority: approval.authority || "",
    issuing_company: approval.issuing_company || "",
    agent_id: approval.agent_id || "",
    submit_date: approval.submit_date || "",
    issue_date: approval.issue_date || "",
    travel_date: approval.travel_date || "",
    airline: approval.airline || "",
    status: approval.status || "",
    government_fee: String(approval.government_fee ?? ""),
    notes: approval.notes || "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const DESTINATIONS = withSelected(useDropdownOptions("destination"), form.destination);
  const AUTHORITIES = withSelected(useDropdownOptions("authority"), form.authority);
  const AIRLINES = withSelected(useDropdownOptions("airline"), form.airline);
  const travelStatement = buildTravelStatement(form.destination, form.travel_date, form.airline);

  const save = async () => {
    if (!form.passenger_name.trim()) return alert("اسم المسافر مطلوب");
    setSaving(true);
    let issuing_company_id = approval.issuing_company_id;
    if (form.issuing_company && form.issuing_company !== approval.issuing_company) {
      issuing_company_id = companies.find((c) => c.company_name === form.issuing_company)?.id || null;
    }
    const shared = {
      passenger_name: form.passenger_name,
      national_id: form.national_id || null,
      passport: form.passport || null,
      dob: form.dob || null,
      destination: form.destination || null,
      agent_id: form.agent_id || null,
      status: form.status,
      notes: form.notes || null,
      travel_date: form.travel_date || null,
      airline: form.airline || null,
      authority: form.authority || null,
      issuing_company: form.issuing_company || null,
      travel_statement: travelStatement || null,
    };
    const payload = {
      ...shared,
      issuing_company_id,
      submit_date: form.submit_date || null,
      issue_date: form.issue_date || null,
      government_fee: Number(form.government_fee || 0),
    };
    try {
      const { error } = await supabase.from("approvals").update(payload).eq("id", approval.id);
      if (error) return toast.error(error.message);
      await syncCounterpart("approvals", shared);
      toast.success("تم حفظ التعديلات بنجاح");
      onClose();
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ التعديلات");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay open" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal-box" style={{ maxWidth: 820 }}>
        <div className="modal-header">
          <div className="modal-title">✏️ تعديل موافقة أمنية</div>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>
        <div className="modal-body">
          <div className="form-grid">
            <div className="form-group"><label>اسم المسافر</label><input value={form.passenger_name} onChange={(e) => set("passenger_name", e.target.value)} /></div>
            <div className="form-group"><label>الرقم القومي</label><input value={form.national_id} onChange={(e) => set("national_id", e.target.value)} /></div>
            <div className="form-group"><label>رقم الجواز</label><input value={form.passport} onChange={(e) => set("passport", e.target.value)} /></div>
            <div className="form-group"><label>تاريخ الميلاد</label><input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} /></div>
            <div className="form-group"><label>الوجهة</label>
              <select value={form.destination} onChange={(e) => set("destination", e.target.value)}>
                <option value="">اختر...</option>
                <SafeSelectOptions options={DESTINATIONS} />
              </select>
            </div>
            <div className="form-group"><label>الجهة</label>
              <select value={form.authority} onChange={(e) => set("authority", e.target.value)}>
                <option value="">اختر...</option>
                <SafeSelectOptions options={AUTHORITIES} />
              </select>
            </div>
            <div className="form-group"><label>الشركة الصادرة</label>
              <select value={form.issuing_company} onChange={(e) => set("issuing_company", e.target.value)}>
                <option value="">اختر...</option>
                {companies.map((c) => <option key={c.id} value={c.company_name}>{c.company_name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>الوكيل</label>
              <select value={form.agent_id} onChange={(e) => set("agent_id", e.target.value)}>
                <option value="">اختر...</option>
                {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <div className="form-group"><label>تاريخ التقديم</label><input type="date" value={form.submit_date} onChange={(e) => set("submit_date", e.target.value)} /></div>
            <div className="form-group"><label>تاريخ الصدور</label><input type="date" value={form.issue_date} onChange={(e) => set("issue_date", e.target.value)} /></div>
            <div className="form-group"><label>تاريخ السفر</label><input type="date" value={form.travel_date} onChange={(e) => set("travel_date", e.target.value)} /></div>
            <div className="form-group"><label>شركة الطيران</label>
              <select value={form.airline} onChange={(e) => set("airline", e.target.value)}>
                <option value="">اختر...</option>
                <SafeSelectOptions options={AIRLINES} />
              </select>
            </div>
            <div className="form-group"><label>الحالة</label>
              <select value={form.status} onChange={(e) => set("status", e.target.value)}>
                <option value="">اختر...</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="form-group"><label>مبلغ الموافقة</label><input type="number" value={form.government_fee} onChange={(e) => set("government_fee", e.target.value)} /></div>
            <div className="form-group full"><label>بيان السفر (تلقائي)</label><input value={travelStatement} disabled readOnly /></div>
            <div className="form-group full"><label>ملاحظات</label><textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn" onClick={onClose} disabled={saving}>إلغاء</button>
          <button className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "..." : "💾 حفظ التعديلات"}</button>
        </div>
      </div>
    </div>
  );
}
