import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Search, X, CheckCircle2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  useLive, useDropdownOptions, withSelected,
  type Agent, type Execution, type ExecutionServiceItem, type IssuingCompany, type Merchant,
} from "@/lib/db";
import { postExecutionFinancials, deleteExecutionLinkedRows } from "@/lib/executionPosting";
import { usePerm } from "@/hooks/usePerm";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagination } from "@/hooks/usePagination";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { confirmDialog } from "@/lib/confirm";

export const Route = createFileRoute("/executions")({
  component: () => <AppErrorBoundary><ExecutionsPage /></AppErrorBoundary>,
});

const NAVY = "#0f1b3d", GOLD = "#d4af37";
const PAYMENT_METHODS = ["نقدي", "إنستاباي", "محفظة", "تاجر إنستاباي", "تاجر محفظة", "تاجر نقدي"] as const;

const SERVICE_KINDS = ["موافقة أمنية", "تذكرة طيران", "استثمار ليبي"] as const;

function ExecutionsPage() {
  const perm = usePerm("executions");
  const { rows: executions } = useLive<Execution>("executions");
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const STATUSES = useDropdownOptions("execution_status" as any);
  const DEPARTURES = useDropdownOptions("departure_from" as any);
  const DESTINATIONS = useDropdownOptions("destination");
  const AIRLINES = useDropdownOptions("airline");
  const SERVICE_KIND_OPTS = useDropdownOptions("service_kind" as any);

  const [tab, setTab] = useState<"list" | "add">("list");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [editing, setEditing] = useState<Execution | null>(null);
  const debounced = useDebouncedValue(search, 250);

  // If arriving from a submission, prefill the form
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("execution:fromSubmission");
      if (raw) {
        const sub = JSON.parse(raw);
        sessionStorage.removeItem("execution:fromSubmission");
        setEditing({
          id: "",
          submission_id: sub.id,
          passenger_name: sub.passenger_name,
          national_id: sub.national_id,
          dob: sub.dob,
          passport: sub.passport,
          birth_place: sub.birth_place,
          agent_id: sub.agent_id,
          status: "قيد التنفيذ",
          departure_from: sub.departure_from,
          destination: null, airline: null, travel_date: null,
          notes: sub.notes,
          services: (sub.services || []).map((s: string) => ({ service_type: s, count: 1, agent_price: 0, company_price: 0, company_value: 0 })),
          created_at: "", updated_at: "",
        } as Execution);
        setTab("add");
      }
    } catch {}
  }, []);

  const filtered = useMemo(() => executions.filter((e) => {
    if (statusFilter && e.status !== statusFilter) return false;
    if (debounced) {
      const q = debounced.toLowerCase();
      const aName = (agents.find((a) => a.id === e.agent_id)?.name || "").toLowerCase();
      const hay = `${e.passenger_name} ${e.national_id || ""} ${e.passport || ""} ${aName}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  }), [executions, agents, statusFilter, debounced]);

  const { pageRows, Controls, page, pageSize } = usePagination(filtered, 50);
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name || "—";

  const onDelete = async (row: Execution) => {
    if (!perm.delete) return;
    const ok = await confirmDialog(`سيتم حذف التنفيذ "${row.passenger_name}" وإلغاء كل الحركات المالية المرتبطة. هل تريد المتابعة؟`, { confirmLabel: "حذف" });
    if (!ok) return;
    try {
      await deleteExecutionLinkedRows(row.id);
      const { error } = await supabase.from("executions").delete().eq("id", row.id);
      if (error) throw error;
      toast.success("تم الحذف وإلغاء الحركات المالية");
    } catch (e: any) {
      toast.error(e?.message || "حدث خطأ");
    }
  };

  return (
    <div dir="rtl" style={{ display: "grid", gap: 14 }}>
      <div className="card" style={{ padding: 16, display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{ width: 42, height: 42, borderRadius: 10, background: "var(--primary)", color: "#fff", display: "grid", placeItems: "center" }}>
            <Plane size={20} />
          </div>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>التنفيذ</h2>
            <div style={{ fontSize: 12, color: "#64748b" }}>اعتماد الخدمات ماليًا — يؤثر على حسابات الوكلاء والشركات والداشبورد</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn" onClick={() => setTab("list")}>📋 القائمة</button>
          {perm.create && <button className="btn btn-gold" onClick={() => { setEditing(null); setTab("add"); }}><Plus size={14} /> إضافة تنفيذ</button>}
        </div>
      </div>

      {tab === "list" ? (
        <>
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

          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1200, fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    {["م","الاسم","الرقم القومي","تاريخ الميلاد","رقم الجواز","محل الميلاد","الوكيل","الحالة","جهة المغادرة","الوجهة","الطيران","تاريخ المغادرة","الخدمات","ملاحظات","إجراءات"].map((h) => (
                      <th key={h} style={thStyle}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={15} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>لا توجد عمليات تنفيذ</td></tr>
                  ) : pageRows.map((e, i) => (
                    <tr key={e.id} style={{ background: i % 2 ? "#fafbfd" : "#fff", borderBottom: "1px solid #f1f5f9" }}>
                      <td style={tdStyle}>{page * pageSize + i + 1}</td>
                      <td style={{ ...tdStyle, fontWeight: 700 }}>{e.passenger_name}</td>
                      <td style={tdStyle}>{e.national_id || "—"}</td>
                      <td style={tdStyle}>{e.dob || "—"}</td>
                      <td style={tdStyle}>{e.passport || "—"}</td>
                      <td style={tdStyle}>{e.birth_place || "—"}</td>
                      <td style={tdStyle}>{agentName(e.agent_id)}</td>
                      <td style={tdStyle}><span style={statusBadge(e.status)}>{e.status}</span></td>
                      <td style={tdStyle}>{e.departure_from || "—"}</td>
                      <td style={tdStyle}>{e.destination || "—"}</td>
                      <td style={tdStyle}>{e.airline || "—"}</td>
                      <td style={tdStyle}>{e.travel_date || "—"}</td>
                      <td style={tdStyle}>{(e.services || []).map((s) => s.service_type).join(" + ") || "—"}</td>
                      <td style={tdStyle}>{e.notes || "—"}</td>
                      <td style={{ ...tdStyle, textAlign: "end", whiteSpace: "nowrap" }}>
                        {perm.edit && <button title="تعديل" onClick={() => { setEditing(e); setTab("add"); }} style={iconBtn}><Pencil size={14} /></button>}
                        {perm.delete && <button title="حذف" onClick={() => onDelete(e)} style={{ ...iconBtn, color: "#b91c1c" }}><Trash2 size={14} /></button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Controls />
          </div>
        </>
      ) : (
        <ExecutionForm
          editing={editing}
          agents={agents}
          companies={companies}
          statuses={STATUSES}
          departures={DEPARTURES}
          destinations={DESTINATIONS}
          airlines={AIRLINES}
          serviceKinds={SERVICE_KIND_OPTS.length ? SERVICE_KIND_OPTS : [...SERVICE_KINDS]}
          onDone={() => { setTab("list"); setEditing(null); }}
        />
      )}
    </div>
  );
}

function ExecutionForm({
  editing, agents, companies, statuses, departures, destinations, airlines, serviceKinds, onDone,
}: {
  editing: Execution | null;
  agents: Agent[];
  companies: IssuingCompany[];
  statuses: readonly string[];
  departures: readonly string[];
  destinations: readonly string[];
  airlines: readonly string[];
  serviceKinds: readonly string[];
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    passenger_name: editing?.passenger_name || "",
    national_id: editing?.national_id || "",
    dob: editing?.dob || "",
    passport: editing?.passport || "",
    birth_place: editing?.birth_place || "",
    agent_id: editing?.agent_id || "",
    status: editing?.status || (statuses[0] ?? "قيد التنفيذ"),
    departure_from: editing?.departure_from || "",
    destination: editing?.destination || "",
    airline: editing?.airline || "",
    travel_date: editing?.travel_date || "",
    notes: editing?.notes || "",
    submission_id: editing?.submission_id || null as string | null,
  });
  const [services, setServices] = useState<ExecutionServiceItem[]>(
    editing?.services?.length
      ? editing.services
      : [{ service_type: serviceKinds[0] || "تذكرة طيران", company_id: null, count: 1, agent_price: 0, company_price: 0, company_value: 0 }],
  );
  const [saving, setSaving] = useState(false);

  const addService = () => setServices((s) => [...s, { service_type: serviceKinds[0] || "تذكرة طيران", company_id: null, count: 1, agent_price: 0, company_price: 0, company_value: 0 }]);
  const updateService = (i: number, patch: Partial<ExecutionServiceItem>) => setServices((s) => s.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const removeService = (i: number) => setServices((s) => s.filter((_, idx) => idx !== i));

  const save = async () => {
    if (!form.passenger_name.trim()) { toast.error("الاسم مطلوب"); return; }
    if (services.length === 0) { toast.error("أضف خدمة واحدة على الأقل"); return; }
    setSaving(true);
    const payload = {
      passenger_name: form.passenger_name.trim(),
      national_id: form.national_id || null,
      dob: form.dob || null,
      passport: form.passport || null,
      birth_place: form.birth_place || null,
      agent_id: form.agent_id || null,
      status: form.status,
      departure_from: form.departure_from || null,
      destination: form.destination || null,
      airline: form.airline || null,
      travel_date: form.travel_date || null,
      notes: form.notes || null,
      services: services as any,
      submission_id: form.submission_id,
    };
    try {
      let executionId = editing?.id || "";
      if (editing && editing.id) {
        const { error } = await supabase.from("executions").update(payload).eq("id", editing.id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("executions").insert(payload).select("id").single();
        if (error) throw error;
        executionId = data!.id as string;
        // Mark linked submission as executed
        if (form.submission_id) {
          await supabase.from("submissions").update({
            execution_id: executionId,
            executed_at: new Date().toISOString(),
            status: "جاهز للتنفيذ",
          }).eq("id", form.submission_id);
        }
      }
      // Post / unpost financials based on status
      await postExecutionFinancials({
        executionId,
        status: form.status,
        agentId: form.agent_id || null,
        date: form.travel_date || null,
        destination: form.destination || null,
        airline: form.airline || null,
        passengerName: form.passenger_name,
        services,
      });
      toast.success(form.status === "منفذ" ? "تم التنفيذ واعتماد الحركات المالية" : "تم الحفظ");
      onDone();
    } catch (e: any) {
      toast.error(e?.message || "حدث خطأ أثناء الحفظ");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card" style={{ padding: 20 }}>
      <h3 style={{ marginTop: 0 }}>{editing?.id ? "تعديل التنفيذ" : "تنفيذ جديد"}</h3>

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
        <Field label="جهة المغادرة">
          <select value={form.departure_from} onChange={(e) => setForm({ ...form, departure_from: e.target.value })} style={inputStyle}>
            <option value="">— اختر —</option>
            {withSelected(departures, form.departure_from).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="الوجهة">
          <select value={form.destination} onChange={(e) => setForm({ ...form, destination: e.target.value })} style={inputStyle}>
            <option value="">— اختر —</option>
            {withSelected(destinations, form.destination).map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </Field>
        <Field label="الطيران">
          <select value={form.airline} onChange={(e) => setForm({ ...form, airline: e.target.value })} style={inputStyle}>
            <option value="">— اختر —</option>
            {withSelected(airlines, form.airline).map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
        </Field>
        <Field label="تاريخ المغادرة"><input type="date" value={form.travel_date} onChange={(e) => setForm({ ...form, travel_date: e.target.value })} style={inputStyle} /></Field>
        <Field label="ملاحظات" full><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} style={{ ...inputStyle, height: "auto", padding: 10 }} /></Field>
      </div>

      {/* Services */}
      <div style={{ marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800 }}>الخدمات</h4>
          <button type="button" className="btn" onClick={addService}><Plus size={12} /> إضافة خدمة</button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {services.map((s, i) => (
            <div key={i} style={{ border: "1px solid #e2e8f0", borderRadius: 10, padding: 12, background: "#fafbfd" }}>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                <Field label="نوع الخدمة">
                  <select value={s.service_type} onChange={(e) => updateService(i, { service_type: e.target.value })} style={inputStyle}>
                    {withSelected(serviceKinds, s.service_type).map((k) => <option key={k} value={k}>{k}</option>)}
                  </select>
                </Field>
                <Field label="الشركة الصادرة">
                  <select value={s.company_id || ""} onChange={(e) => updateService(i, { company_id: e.target.value || null })} style={inputStyle}>
                    <option value="">— بدون —</option>
                    {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                  </select>
                </Field>
                <Field label="العدد"><input type="number" min={1} value={s.count ?? 1} onChange={(e) => updateService(i, { count: Number(e.target.value) || 1 })} style={inputStyle} /></Field>
                <Field label="سعر الوكيل (للوحدة)"><input type="number" min={0} value={s.agent_price ?? 0} onChange={(e) => updateService(i, { agent_price: Number(e.target.value) || 0 })} style={inputStyle} /></Field>
                <Field label="سعر الشركة (للوحدة)"><input type="number" min={0} value={s.company_price ?? 0} onChange={(e) => updateService(i, { company_price: Number(e.target.value) || 0 })} style={inputStyle} /></Field>
                <Field label="قيمة الشركة (إجمالي)"><input type="number" min={0} value={s.company_value ?? 0} onChange={(e) => updateService(i, { company_value: Number(e.target.value) || 0 })} style={inputStyle} /></Field>
              </div>
              {services.length > 1 && (
                <div style={{ marginTop: 8, textAlign: "end" }}>
                  <button type="button" onClick={() => removeService(i)} style={{ ...iconBtn, color: "#b91c1c" }}><Trash2 size={12} /> إزالة هذه الخدمة</button>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: form.status === "منفذ" ? "#ecfdf5" : "#f8fafc", border: `1px solid ${form.status === "منفذ" ? "#a7f3d0" : "#e2e8f0"}`, fontSize: 12, color: "#475569" }}>
        <CheckCircle2 size={14} style={{ verticalAlign: "middle", marginInlineEnd: 6 }} />
        {form.status === "منفذ"
          ? "عند الحفظ بحالة «منفذ» سيتم إنشاء الحركات المالية على حساب الوكيل والشركة."
          : "الحركات المالية تُنشأ فقط عند الحفظ بحالة «منفذ». باقي الحالات للمتابعة فقط."}
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn" onClick={onDone} disabled={saving}>إلغاء</button>
        <button className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "جارٍ الحفظ..." : "حفظ"}</button>
      </div>
    </div>
  );
}

// ---- shared styles ----
const inputStyle: React.CSSProperties = { height: 38, padding: "0 12px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff", fontSize: 13, color: "#0f172a", outline: "none", width: "100%" };
const labelStyle: React.CSSProperties = { display: "block", fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 };
const thStyle: React.CSSProperties = { padding: "10px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" };
const tdStyle: React.CSSProperties = { padding: "10px 12px", color: "#0f172a", fontSize: 12.5 };
const iconBtn: React.CSSProperties = { background: "#fff", border: "1px solid #e2e8f0", borderRadius: 8, padding: 6, marginInlineStart: 4, cursor: "pointer", color: "#475569" };
const clearBtnStyle: React.CSSProperties = { position: "absolute", insetInlineEnd: 8, top: "50%", transform: "translateY(-50%)", width: 20, height: 20, borderRadius: 6, border: 0, background: "#f1f5f9", color: "#64748b", cursor: "pointer", display: "grid", placeItems: "center" };

function statusBadge(status: string): React.CSSProperties {
  const k = status || "";
  if (k.includes("منفذ")) return { padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0" };
  if (k.includes("ملغي")) return { padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" };
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
