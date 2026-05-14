import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  ShieldCheck, ChevronLeft, Search, Plus, ListChecks, FileText,
  Zap, Timer, Ban, Clock3, CalendarDays, Layers, MoreHorizontal,
  Eye, Pencil, Printer, RefreshCw, Trash2,
} from "lucide-react";
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

function isToday(d?: string | null) {
  if (!d) return false;
  const x = new Date(d); const t = new Date();
  return x.getFullYear() === t.getFullYear() && x.getMonth() === t.getMonth() && x.getDate() === t.getDate();
}

function RowActions({ canEdit, onView, onEdit, onPrint, onStatus, onDelete }: {
  canEdit: boolean; onView: () => void; onEdit: () => void; onPrint: () => void; onStatus: () => void; onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);
  return (
    <div className="row-actions" ref={ref}>
      <button className="row-actions-btn" onClick={() => setOpen((v) => !v)} aria-label="إجراءات">
        <MoreHorizontal size={16} />
      </button>
      {open && (
        <div className="row-actions-menu">
          <button onClick={() => { setOpen(false); onView(); }}><Eye size={14} /> عرض التفاصيل</button>
          {canEdit && <button onClick={() => { setOpen(false); onEdit(); }}><Pencil size={14} /> تعديل</button>}
          <button onClick={() => { setOpen(false); onPrint(); }}><Printer size={14} /> طباعة</button>
          {canEdit && <button onClick={() => { setOpen(false); onStatus(); }}><RefreshCw size={14} /> تحديث الحالة</button>}
          {canEdit && <button className="danger" onClick={() => { setOpen(false); onDelete(); }}><Trash2 size={14} /> حذف</button>}
        </div>
      )}
    </div>
  );
}

function SafePageError() {
  return <div className="card" style={{ padding: 24 }}>تعذر تحميل الموافقات مؤقتًا. <button className="btn btn-gold" onClick={() => window.location.reload()}>إعادة المحاولة</button></div>;
}

function ApprovalsPage() {
  const perm = usePerm("approvals");
  const { rows: approvals } = useLive<Approval>("approvals");
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

  return (
    <div className="section active">
      <div className="tabs">
        <div className={`tab ${tab === "list" ? "active" : ""}`} onClick={() => setTab("list")}>📋 سجل التقديمات</div>
        {perm.create && <div className={`tab ${tab === "add" ? "active" : ""}`} onClick={() => setTab("add")}>➕ تقديم موافقة</div>}
      </div>

      {tab === "list" ? (
        <>
          <div className="filter-bar">
            <input className="search-input" placeholder="🔍 ابحث بالاسم، الجواز، الرقم القومي، أو اسم الوكيل..." value={search} onChange={(e) => setSearch(e.target.value)} />
            <select className="filter-select" value={destination} onChange={(e) => setDestination(e.target.value)}>
              <option value="">جميع الوجهات</option>
              <SafeSelectOptions options={DESTINATIONS} />
            </select>
            <select className="filter-select" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">جميع الحالات</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div className="card">
            <div className="card-header">
              <div className="card-title">📋 تقديمات الموافقات الأمنية</div>
              <span style={{ fontSize: 12, color: "var(--text3)" }}>{filtered.length} تقديم</span>
            </div>
            <div className="card-body">
              <div className="table-wrap">
                <table className="mobile-cards">
                  <thead>
                    <tr>
                      <th>#</th><th>اسم المسافر</th><th>الرقم القومي</th><th>رقم الجواز</th><th>الوجهة</th>
                      <th>الجهة</th><th>الشركة الصادرة</th><th>بيان السفر</th><th>الوكيل</th><th>تاريخ التقديم</th><th>تاريخ الصدور</th><th>الحالة</th><th>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={13}><div className="empty"><div className="empty-icon">📋</div><div className="empty-text">لا توجد تقديمات</div></div></td></tr>
                    ) : filtered.map((a, i) => (
                      <tr key={a.id}>
                        <td data-label="#">{i + 1}</td>
                        <td className="bold" data-label="المسافر">{a.passenger_name}</td>
                        <td data-label="الرقم القومي">{a.national_id || "-"}</td>
                        <td data-label="الجواز">{a.passport || "—"}</td>
                        <td data-label="الوجهة">{a.destination || "—"}</td>
                        <td data-label="الجهة">{a.authority || "—"}</td>
                        <td data-label="الشركة الصادرة">{a.issuing_company || "—"}</td>
                        <td data-label="بيان السفر">{a.travel_statement || "—"}</td>
                        <td data-label="الوكيل">{agentName(a.agent_id)}</td>
                        <td data-label="التقديم">{a.submit_date || "—"}</td>
                        <td data-label="الصدور">{a.issue_date || "—"}</td>
                        <td data-label="الحالة"><span className={`badge ${badgeFor(a.status)}`}>{a.status}</span></td>
                        <td data-label="إجراءات">{perm.edit ? <button className="edit-btn" onClick={() => setEditing(a)}>✏️ تعديل</button> : null}</td>
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
