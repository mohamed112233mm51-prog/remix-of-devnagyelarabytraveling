import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck, Plus, Pencil, Trash2, Search, X, ArrowLeftRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLive, useDropdownOptions, withSelected, type Agent, type Submission } from "@/lib/db";
import { Modal } from "@/components/Modal";
import { usePerm } from "@/hooks/usePerm";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagination } from "@/hooks/usePagination";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { confirmAction } from "@/lib/confirm";

export const Route = createFileRoute("/submissions")({
  component: () => <AppErrorBoundary><SubmissionsPage /></AppErrorBoundary>,
});

const SERVICE_OPTIONS = ["موافقة أمنية", "تذكرة طيران", "استثمار ليبي"] as const;

function SubmissionsPage() {
  const perm = usePerm("submissions");
  const router = useRouter();
  const { rows: submissions } = useLive<Submission>("submissions");
  const { rows: agents } = useLive<Agent>("agents");
  const STATUSES = useDropdownOptions("submission_status" as any);
  const DEPARTURES = useDropdownOptions("departure_from" as any);
  const AUTHORITIES = useDropdownOptions("authority");

  const [tab, setTab] = useState<"list" | "add">("list");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editing, setEditing] = useState<Submission | null>(null);

  const debounced = useDebouncedValue(search, 250);

  const filtered = useMemo(() => submissions.filter((s) => {
    if (statusFilter && s.status !== statusFilter) return false;
    if (debounced) {
      const q = debounced.toLowerCase();
      const aName = (agents.find((a) => a.id === s.agent_id)?.name || "").toLowerCase();
      const hay = `${s.passenger_name} ${s.national_id || ""} ${s.passport || ""} ${aName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [submissions, agents, statusFilter, debounced]);

  const { pageRows, Controls, page, pageSize } = usePagination(filtered, 50);
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name || "—";

  const onDelete = async (row: Submission) => {
    if (!perm.delete) return;
    const ok = await confirmAction({
      title: "حذف التقديم",
      message: `سيتم حذف التقديم الخاص بـ "${row.passenger_name}". هل تريد المتابعة؟`,
      confirmLabel: "حذف",
      tone: "danger",
    });
    if (!ok) return;
    const { error } = await supabase.from("submissions").delete().eq("id", row.id);
    if (error) toast.error(error.message);
    else toast.success("تم الحذف");
  };

  const convertToExecution = (row: Submission) => {
    if (!perm.edit) return;
    // Carry over data via sessionStorage and open executions in add mode
    try {
      sessionStorage.setItem("execution:fromSubmission", JSON.stringify(row));
    } catch {}
    router.navigate({ to: "/executions", search: { from: row.id } as any });
  };

  return (
    <div dir="rtl" style={{ display: "grid", gap: 14 }}>
      {/* Header */}
      <div className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 10, background: "var(--primary)", color: "#fff", display: "grid", placeItems: "center" }}>
            <ClipboardCheck size={20} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>التقديمات</h2>
            <div style={{ fontSize: 12, color: "var(--muted, #64748b)" }}>متابعة وتجهيز الطلبات قبل التنفيذ — لا أثر مالي</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setTab("list")} style={tab === "list" ? activeBtnStyle : {}}>📋 القائمة</button>
          {perm.create && <button className="btn btn-gold" onClick={() => { setEditing(null); setTab("add"); }}><Plus size={14} /> إضافة تقديم</button>}
        </div>
      </div>

      {tab === "list" ? (
        <>
          {/* Filters */}
          <div className="card" style={{ padding: 12, display: "grid", gap: 8, gridTemplateColumns: "2fr 1fr 1fr" }}>
            <div style={{ position: "relative" }}>
              <Search size={14} style={{ position: "absolute", insetInlineStart: 10, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }} />
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="بحث بالاسم، الرقم القومي، الجواز، أو الوكيل..." style={{ ...inputStyle, paddingInlineStart: 30, width: "100%" }} />
              {search && <button onClick={() => setSearch("")} style={clearBtnStyle}><X size={12} /></button>}
            </div>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={inputStyle}>
              <option value="">جميع الحالات</option>
              {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div style={{ alignSelf: "center", fontSize: 12, color: "#64748b", textAlign: "end" }}>
              {filtered.length.toLocaleString("ar")} سجل
            </div>
          </div>

          {/* Table */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100, fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
                    {["م","الاسم","الرقم القومي","تاريخ الميلاد","رقم الجواز","محل الميلاد","الوكيل","الحالة","الجهة","تاريخ التقديم","تاريخ الصدور","جهة الموافقة","الخدمات","إجراءات"].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={14} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>لا توجد تقديمات</td></tr>
                  ) : pageRows.map((s, i) => (
                    <tr key={s.id} style={{ background: i % 2 ? "#fafbfd" : "#fff", borderBottom: "1px solid #f1f5f9" }}>
                      <td style={tdStyle}>{page * pageSize + i + 1}</td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{s.passenger_name}</td>
                      <td style={tdStyle}>{s.national_id || "—"}</td>
                      <td style={tdStyle}>{s.dob || "—"}</td>
                      <td style={tdStyle}>{s.passport || "—"}</td>
                      <td style={tdStyle}>{s.birth_place || "—"}</td>
                      <td style={tdStyle}>{agentName(s.agent_id)}</td>
                      <td style={tdStyle}><span style={badgeStyle(s.status)}>{s.status}</span></td>
                      <td style={tdStyle}>{s.departure_from || "—"}</td>
                      <td style={tdStyle}>{s.submit_date || "—"}</td>
                      <td style={tdStyle}>{s.issue_date || "—"}</td>
                      <td style={tdStyle}>{s.approval_authority || "—"}</td>
                      <td style={tdStyle}>{(s.services || []).join(" + ") || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "end", whiteSpace: "nowrap" }}>
                        {perm.edit && (
                          <button title="تحويل إلى تنفيذ" onClick={() => convertToExecution(s)} style={iconBtn}><ArrowLeftRight size={14} /></button>
                        )}
                        {perm.edit && (
                          <button title="تعديل" onClick={() => { setEditing(s); setTab("add"); }} style={iconBtn}><Pencil size={14} /></button>
                        )}
                        {perm.delete && (
                          <button title="حذف" onClick={() => onDelete(s)} style={{ ...iconBtn, color: "#b91c1c" }}><Trash2 size={14} /></button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {Controls}
          </div>
        </>
      ) : (
        <SubmissionForm
          editing={editing}
          agents={agents}
          statuses={STATUSES}
          departures={DEPARTURES}
          authorities={AUTHORITIES}
          onDone={() => { setTab("list"); setEditing(null); }}
        />
      )}
    </div>
  );
}

function SubmissionForm({
  editing, agents, statuses, departures, authorities, onDone,
}: {
  editing: Submission | null;
  agents: Agent[];
  statuses: readonly string[];
  departures: readonly string[];
  authorities: readonly string[];
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    services: editing?.services || [] as string[],
    passenger_name: editing?.passenger_name || "",
    national_id: editing?.national_id || "",
    dob: editing?.dob || "",
    passport: editing?.passport || "",
    birth_place: editing?.birth_place || "",
    agent_id: editing?.agent_id || "",
    status: editing?.status || (statuses[0] ?? "قيد المتابعة"),
    departure_from: editing?.departure_from || "",
    submit_date: editing?.submit_date || new Date().toISOString().slice(0, 10),
    issue_date: editing?.issue_date || "",
    approval_authority: editing?.approval_authority || "",
    notes: editing?.notes || "",
  });
  const [saving, setSaving] = useState(false);

  const toggleService = (s: string) => {
    setForm((f) => ({
      ...f,
      services: f.services.includes(s) ? f.services.filter((x) => x !== s) : [...f.services, s],
    }));
  };

  const save = async () => {
    if (!form.passenger_name.trim()) { toast.error("الاسم مطلوب"); return; }
    if (form.services.length === 0) { toast.error("يجب اختيار نوع خدمة واحد على الأقل"); return; }
    setSaving(true);
    const payload = {
      services: form.services,
      passenger_name: form.passenger_name.trim(),
      national_id: form.national_id || null,
      dob: form.dob || null,
      passport: form.passport || null,
      birth_place: form.birth_place || null,
      agent_id: form.agent_id || null,
      status: form.status,
      departure_from: form.departure_from || null,
      submit_date: form.submit_date || null,
      issue_date: form.issue_date || null,
      approval_authority: form.approval_authority || null,
      notes: form.notes || null,
    };
    try {
      if (editing) {
        const { error } = await supabase.from("submissions").update(payload).eq("id", editing.id);
        if (error) throw error;
        toast.success("تم التعديل");
      } else {
        const { error } = await supabase.from("submissions").insert(payload);
        if (error) throw error;
        toast.success("تم إضافة التقديم");
      }
      onDone();
    } catch (e: any) {
      toast.error(e?.message || "حدث خطأ أثناء الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ marginTop: 0 }}>{editing ? "تعديل التقديم" : "تقديم جديد"}</h3>

      <div style={{ marginBottom: 14 }}>
        <label style={labelStyle}>نوع الخدمة (يمكن اختيار أكثر من خدمة)</label>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {SERVICE_OPTIONS.map((s) => {
            const active = form.services.includes(s);
            return (
              <button key={s} type="button" onClick={() => toggleService(s)} style={{
                padding: "8px 14px", borderRadius: 999, fontSize: 13, fontWeight: 700,
                border: active ? "1.5px solid var(--primary)" : "1px solid #e2e8f0",
                background: active ? "var(--primary)" : "#fff",
                color: active ? "#fff" : "#0f172a",
                cursor: "pointer",
              }}>{active ? "✓ " : "＋ "}{s}</button>
            );
          })}
        </div>
      </div>

      <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        <Field label="الاسم"><input value={form.passenger_name} onChange={(e) => setForm({ ...form, passenger_name: e.target.value })} style={inputStyle} /></Field>
        <Field label="الرقم القومي"><input value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value })} style={inputStyle} /></Field>
        <Field label="تاريخ الميلاد"><input type="date" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} style={inputStyle} /></Field>
        <Field label="رقم الجواز"><input value={form.passport} onChange={(e) => setForm({ ...form, passport: e.target.value })} style={inputStyle} /></Field>
        <Field label="محل الميلاد"><input value={form.birth_place} onChange={(e) => setForm({ ...form, birth_place: e.target.value })} style={inputStyle} /></Field>
        <Field label="الوكيل">
          <select value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })} style={inputStyle}>
            <option value="">— اختر —</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="الحالة">
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={inputStyle}>
            {withSelected(statuses, form.status).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="الجهة (جهة المغادرة)">
          <select value={form.departure_from} onChange={(e) => setForm({ ...form, departure_from: e.target.value })} style={inputStyle}>
            <option value="">— اختر —</option>
            {withSelected(departures, form.departure_from).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="تاريخ التقديم"><input type="date" value={form.submit_date} onChange={(e) => setForm({ ...form, submit_date: e.target.value })} style={inputStyle} /></Field>
        <Field label="تاريخ الصدور"><input type="date" value={form.issue_date} onChange={(e) => setForm({ ...form, issue_date: e.target.value })} style={inputStyle} /></Field>
        <Field label="جهة الموافقة">
          <select value={form.approval_authority} onChange={(e) => setForm({ ...form, approval_authority: e.target.value })} style={inputStyle}>
            <option value="">— اختر —</option>
            {withSelected(authorities, form.approval_authority).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="ملاحظات" full><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} style={{ ...inputStyle, height: "auto", padding: 10 }} /></Field>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn" onClick={onDone} disabled={saving}>إلغاء</button>
        <button className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : (editing ? "حفظ التعديل" : "حفظ التقديم")}</button>
      </div>
    </div>
  );
}

// ---- shared inline styles ----
const inputStyle: React.CSSProperties = { height: 38, padding: "0 12px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, color: "#0f172a", outline: "none", width: "100%" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 };
const thStyle: React.CSSProperties = { padding: "10px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "10px 12px", color: "#0f172a", fontSize: 12.5 };
const iconBtn: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 6, marginInlineStart: 4, cursor: "pointer", color: "#475569" };
const clearBtnStyle: React.CSSProperties = { position: "absolute", insetInlineEnd: 8, top: "50%", transform: "translateY(-50%)", width: 20, height: 20, borderRadius: 6, border: 0, background: "#f1f5f9", color: "#64748b", cursor: "pointer", display: "grid", placeItems: "center" };
const activeBtnStyle: React.CSSProperties = { background: "var(--primary)", color: "#fff" };

function badgeStyle(status: string): React.CSSProperties {
  const k = status || "";
  if (k.includes("ملغي")) return { padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" };
  if (k.includes("جاهز")) return { padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0" };
  if (k.includes("مؤجل")) return { padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a" };
  return { padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" };
}

function Field({ label, children, full }: { label: string; children: React.ReactNode; full?: boolean }) {
  return (
    <div style={{ gridColumn: full ? "1 / -1" : undefined }}>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}
