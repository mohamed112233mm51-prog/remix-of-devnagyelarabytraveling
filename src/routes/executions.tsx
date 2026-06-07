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
import { toDisplayDate, parseDisplayDate, isValidDisplayDate } from "@/lib/dateFormat";
import { ExportButton } from "@/components/ExportButton";
import * as CF from "@/components/ColumnFilter";
import { ColumnVisibility, sanitizeVisibility, type ColumnDef } from "@/components/ColumnVisibility";

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
  const { rows: merchants } = useLive<Merchant>("merchants");
  // status = حالة الموافقة, operation_status = حالة العملية
  const APPROVAL_STATUSES = useDropdownOptions("execution_status" as any);
  const OPERATION_STATUSES = useDropdownOptions("operation_status" as any);
  const DEPARTURES = useDropdownOptions("departure_from" as any);
  const DESTINATIONS = useDropdownOptions("destination");
  const AIRLINES = useDropdownOptions("airline");
  const SERVICE_KIND_OPTS = useDropdownOptions("service_kind" as any);

  const [tab, setTab] = useState<"list" | "add">("list");
  const [editing, setEditing] = useState<Execution | null>(null);
  const activeCompanies = useMemo(() => companies.filter((c) => (c.status || "نشط") === "نشط"), [companies]);
  const companyName = (id: string | null | undefined) =>
    (id && companies.find((c) => c.id === id)?.company_name) || "—";
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name || "—";


  // If arriving from a submission, prefill the form
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("execution:fromSubmission");
      if (raw) {
        const sub = JSON.parse(raw);
        sessionStorage.removeItem("execution:fromSubmission");
        if (!sub || typeof sub !== "object" || Array.isArray(sub)) return;
        const submissionServices = Array.isArray(sub.services) ? sub.services : [];
        setEditing({
          id: "",
          submission_id: sub.id,
          passenger_name: sub.passenger_name,
          national_id: sub.national_id,
          dob: sub.dob,
          passport: sub.passport,
          birth_place: sub.birth_place,
          agent_id: sub.agent_id,
          status: sub.status || "بطيء",
          operation_status: "قيد التنفيذ",
          departure_from: sub.departure_from,
          destination: null, airline: null, travel_date: null,
          notes: sub.notes,
          approval_company_id: sub.approval_company_id || null,
          services: submissionServices.map((s: string) => ({ service_type: String(s || ""), count: 1, agent_price: 0, company_price: 0, company_value: 0 })).filter((s: { service_type: string }) => s.service_type),
          created_at: "", updated_at: "",
        } as Execution);
        setTab("add");
      }
    } catch {}
  }, []);

  // Open existing execution by id (when coming from submission already converted)
  useEffect(() => {
    try {
      const openId = sessionStorage.getItem("executions:openId");
      const safeExecutions = Array.isArray(executions) ? executions : [];
      if (openId && safeExecutions.length) {
        const found = safeExecutions.find((e) => e.id === openId);
        if (found) {
          sessionStorage.removeItem("executions:openId");
          setEditing(found);
          setTab("add");
        }
      }
    } catch {}
  }, [executions]);


  const svcText = (e: Execution, side: "company" | "agent") => {
    const svcs = Array.isArray(e.services) ? e.services : [];
    const isCompanySvc = (s: any) => s?.kind === "company" || (!s?.kind && Number(s?.company_price || 0) > 0);
    const isAgentSvc = (s: any) => s?.kind === "agent" || (!s?.kind && Number(s?.agent_price || 0) > 0);
    const list = svcs.filter(side === "company" ? isCompanySvc : isAgentSvc);
    return list.map((s: any) => s?.service_type).filter(Boolean).join(" + ");
  };

  // Column definitions
  const EXECUTION_COLUMNS: (ColumnDef & {
    filter?: "text" | "date" | "multi";
    accessor: (e: Execution) => string;
  })[] = [
    { key: "name", label: "الاسم", filter: "text", accessor: (e) => e.passenger_name || "" },
    { key: "nid", label: "الرقم القومي", filter: "text", accessor: (e) => e.national_id || "" },
    { key: "dob", label: "تاريخ الميلاد", filter: "date", accessor: (e) => e.dob || "" },
    { key: "passport", label: "رقم الجواز", filter: "text", accessor: (e) => e.passport || "" },
    { key: "birth_place", label: "محل الميلاد", filter: "text", accessor: (e) => e.birth_place || "" },
    { key: "agent", label: "الوكيل", filter: "multi", accessor: (e) => agentName(e.agent_id) },
    { key: "status", label: "الحالة", filter: "multi", accessor: (e) => e.status || "" },
    { key: "op_status", label: "حالة العملية", filter: "multi", accessor: (e) => e.operation_status || "" },
    { key: "departure", label: "جهة المغادرة", filter: "multi", accessor: (e) => e.departure_from || "" },
    { key: "destination", label: "الوجهة", filter: "multi", accessor: (e) => e.destination || "" },
    { key: "airline", label: "الطيران", filter: "multi", accessor: (e) => e.airline || "" },
    { key: "travel_date", label: "تاريخ المغادرة", filter: "date", accessor: (e) => e.travel_date || "" },
    { key: "company", label: "جهة الموافقة", filter: "multi", accessor: (e) => companyName((e as any).approval_company_id) },
    { key: "company_services", label: "خدمات الشركة", filter: "multi", accessor: (e) => svcText(e, "company") },
    { key: "agent_services", label: "خدمات الوكيل", filter: "multi", accessor: (e) => svcText(e, "agent") },
    { key: "notes", label: "ملاحظات", filter: "text", accessor: (e) => e.notes || "" },
  ];

  const initialFilters = (): Record<string, CF.ColumnFilterState> => {
    const o: Record<string, CF.ColumnFilterState> = {};
    for (const c of EXECUTION_COLUMNS) {
      o[c.key] = c.filter === "date" ? CF.emptyDateRange() : c.filter === "multi" ? CF.emptyMultiSelect() : CF.emptyText();
    }
    return o;
  };
  const [filters, setFilters] = useState<Record<string, CF.ColumnFilterState>>(() => CF.sanitizeFilterMap(undefined, initialFilters()));
  const setF = (k: string, s: CF.ColumnFilterState) => setFilters((p) => CF.sanitizeFilterMap({ ...p, [k]: s }, initialFilters()));
  const resetAll = () => setFilters(initialFilters());
  const safeFilters = CF.sanitizeFilterMap(filters, initialFilters());
  const anyActive = Object.values(safeFilters).some(CF.isFilterActive);

  const [visible, setVisible] = useState<Record<string, boolean>>(() => sanitizeVisibility(undefined, EXECUTION_COLUMNS));
  const visibleColumns = EXECUTION_COLUMNS.filter((c) => visible[c.key] !== false);

  const filtered = useMemo(() => executions.filter((e) => {
    for (const c of EXECUTION_COLUMNS) {
      const fs = safeFilters[c.key];
      if (!CF.isFilterActive(fs)) continue;
      const v = c.accessor(e);
      if (c.filter === "date" && !CF.matchDateRange(v, fs)) return false;
      if (c.filter === "multi" && !CF.matchMultiSelect(v, fs)) return false;
      if (c.filter === "text" && !CF.matchText(v, fs)) return false;
    }
    return true;
  }), [executions, agents, companies, safeFilters]);

  const optionsFor = (key: string) => {
    const col = EXECUTION_COLUMNS.find((c) => c.key === key);
    if (!col) return [];
    const set = new Set<string>();
    executions.forEach((e) => { const v = col.accessor(e); if (v) set.add(v); });
    return Array.from(set).sort();
  };

  const { pageRows, Controls, page, pageSize } = usePagination(filtered, 50);

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const onDelete = async (row: Execution) => {
    if (!perm.delete) return;
    if (!row?.id || !UUID_RE.test(row.id)) {
      toast.error("معرّف العملية غير صحيح");
      return;
    }
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

  const totalCount = executions.length;
  const doneCount = executions.filter((e) => e.operation_status === "منفذ").length;
  const pendingCount = executions.filter((e) => e.operation_status === "قيد التنفيذ").length;
  const cancelledCount = executions.filter((e) => e.operation_status === "ملغي").length;
  const today = new Date().toISOString().slice(0, 10);
  const todayCount = executions.filter((e) => (e.travel_date || "").slice(0, 10) === today).length;

  const buildExportData = () => {
    const cols = [{ header: "م", key: "n" }, ...visibleColumns.map((c) => ({ header: c.label, key: c.key }))];
    return {
      title: "كشف التنفيذ",
      fileName: "كشف-التنفيذ",
      columns: cols,
      rows: filtered.map((e, i) => {
        const row: Record<string, string | number> = { n: i + 1 };
        for (const c of visibleColumns) {
          if (c.key === "dob") row[c.key] = toDisplayDate(e.dob) || "";
          else row[c.key] = c.accessor(e);
        }
        return row;
      }),
    };
  };


  return (
    <div dir="rtl" style={{ display: "grid", gap: 14 }}>
      {/* Navy hero header */}
      <div style={{
        padding: "16px 20px", borderRadius: 14, border: "1px solid #1e3a8a44",
        background: `linear-gradient(135deg, ${NAVY} 0%, #1e3a8a 60%, #1e40af 100%)`,
        boxShadow: `0 10px 30px ${NAVY}2e`, color: "#fff", overflow: "hidden", position: "relative",
      }}>
        <div aria-hidden style={{ position: "absolute", top: -40, left: -40, width: 200, height: 200, borderRadius: "50%", background: `radial-gradient(circle, ${GOLD}30, transparent 65%)` }} />
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0, flex: "1 1 320px" }}>
            <div style={{ width: 42, height: 42, borderRadius: 11, background: `linear-gradient(135deg, ${GOLD}, #e0b65c)`, color: NAVY, display: "grid", placeItems: "center", fontSize: 22, boxShadow: `0 6px 16px ${GOLD}55` }}>⚙️</div>
            <div>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: "-0.01em" }}>التنفيذ</h1>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#cbd5e1" }}>اعتماد الخدمات ماليًا — يؤثر على حسابات الوكلاء والشركات والداشبورد</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setTab("list")} style={{ height: 38, padding: "0 14px", borderRadius: 10, background: "rgba(255,255,255,.08)", color: "#fff", border: "1px solid rgba(255,255,255,.22)", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>📋 القائمة</button>
            {perm.create && <button onClick={() => { setEditing(null); setTab("add"); }} style={{ height: 38, padding: "0 16px", borderRadius: 10, background: `linear-gradient(135deg, ${GOLD}, #e0b65c)`, color: NAVY, border: 0, fontWeight: 800, fontSize: 12.5, cursor: "pointer", boxShadow: `0 6px 16px ${GOLD}4d`, display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={14} /> إضافة تنفيذ</button>}
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <KpiCard icon="📋" label="إجمالي عمليات التنفيذ" value={totalCount} tone="navy" />
        <KpiCard icon="✅" label="منفذ" value={doneCount} tone="emerald" />
        <KpiCard icon="⏳" label="قيد التنفيذ" value={pendingCount} tone="sky" />
        <KpiCard icon="⛔" label="ملغي" value={cancelledCount} tone="rose" />
        <KpiCard icon="📅" label="تنفيذ اليوم" value={todayCount} tone="amber" />
      </div>


      {tab === "list" ? (
        <>
          <div className="card" style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>{filtered.length.toLocaleString("ar")} سجل</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {anyActive && <button type="button" className="action-btn" onClick={resetAll}>مسح جميع الفلاتر</button>}
              <ColumnVisibility columns={EXECUTION_COLUMNS} visible={visible} onChange={setVisible} />
              <ExportButton disabled={filtered.length === 0} getData={() => buildExportData()} />
            </div>
          </div>


          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1300, fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc" }}>
                    <th style={thStyle}>م</th>
                    {visibleColumns.map((c) => (
                      <th key={c.key} style={thStyle}>
                        <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
                          <span>{c.label}</span>
                          {c.filter && (
                            <CF.ColumnFilter
                              label={c.label}
                              state={safeFilters[c.key]}
                              onChange={(s) => setF(c.key, s)}
                              options={c.filter === "multi" ? optionsFor(c.key) : undefined}
                            />
                          )}
                        </span>
                      </th>
                    ))}
                    <th style={thStyle}>إجراءات</th>
                  </tr>
                </thead>
                <tbody>
                  {pageRows.length === 0 ? (
                    <tr><td colSpan={visibleColumns.length + 2} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>لا توجد عمليات تنفيذ</td></tr>
                  ) : pageRows.map((e, i) => (
                    <tr key={e.id} style={{ background: i % 2 ? "#fafbfd" : "#fff", borderBottom: "1px solid #f1f5f9" }}>
                      <td style={tdStyle}>{page * pageSize + i + 1}</td>
                      {visibleColumns.map((c) => {
                        if (c.key === "name") return <td key={c.key} style={{ ...tdStyle, fontWeight: 700 }}>{e.passenger_name}</td>;
                        if (c.key === "status") return <td key={c.key} style={tdStyle}><span style={approvalBadge(e.status)}>{e.status}</span></td>;
                        if (c.key === "op_status") return <td key={c.key} style={tdStyle}><span style={statusBadge(e.operation_status)}>{e.operation_status}</span></td>;
                        if (c.key === "dob") return <td key={c.key} style={tdStyle}>{toDisplayDate(e.dob) || "—"}</td>;
                        const v = c.accessor(e);
                        return <td key={c.key} style={tdStyle}>{v || "—"}</td>;
                      })}
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
          activeCompanies={activeCompanies}
          merchants={merchants}
          approvalStatuses={APPROVAL_STATUSES}
          operationStatuses={OPERATION_STATUSES}

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

function KpiCard({ icon, label, value, tone }: { icon: string; label: string; value: number | string; tone: "navy" | "emerald" | "sky" | "rose" | "amber" }) {
  const tones: Record<string, { bg: string; fg: string; bd: string }> = {
    navy:    { bg: "#eef2ff", fg: NAVY,      bd: "#dbe3ee" },
    emerald: { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" },
    sky:     { bg: "#f0f9ff", fg: "#0369a1", bd: "#bae6fd" },
    rose:    { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" },
    amber:   { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" },
  };
  const t = tones[tone];
  return (
    <div style={{ minHeight: 84, padding: 14, borderRadius: 12, background: "#fff", border: "1px solid #eef2f7", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>
      <div style={{ width: 42, height: 42, borderRadius: 10, background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, display: "grid", placeItems: "center", fontSize: 20 }}>{icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 18, color: "#0f172a", fontWeight: 800 }}>{typeof value === "number" ? value.toLocaleString("ar") : value}</div>
      </div>
    </div>
  );
}

function ExecutionForm({
  editing, agents, companies, activeCompanies, merchants, approvalStatuses, operationStatuses, departures, destinations, airlines, serviceKinds, onDone,
}: {
  editing: Execution | null;
  agents: Agent[];
  companies: IssuingCompany[];
  activeCompanies: IssuingCompany[];
  merchants: Merchant[];
  approvalStatuses: readonly string[];
  operationStatuses: readonly string[];
  departures: readonly string[];
  destinations: readonly string[];
  airlines: readonly string[];
  serviceKinds: readonly string[];
  onDone: () => void;
}) {
  const [form, setForm] = useState({
    passenger_name: editing?.passenger_name || "",
    national_id: editing?.national_id || "",
    dob: toDisplayDate(editing?.dob) || "",
    passport: editing?.passport || "",
    birth_place: editing?.birth_place || "",
    agent_id: editing?.agent_id || "",
    status: editing?.status || (approvalStatuses[0] ?? "بطيء"),
    operation_status: editing?.operation_status || (operationStatuses[0] ?? "قيد التنفيذ"),
    departure_from: editing?.departure_from || "",
    destination: editing?.destination || "",
    airline: editing?.airline || "",
    travel_date: editing?.travel_date || "",
    notes: editing?.notes || "",
    approval_company_id: (editing as any)?.approval_company_id || "",
    submission_id: editing?.submission_id || null as string | null,
  });
  const [services, setServices] = useState<ExecutionServiceItem[]>(() => {
    const raw = editing?.services;
    const src: any[] = Array.isArray(raw) ? raw : [];
    // ترقية بيانات قديمة (بدون kind) إلى نموذج الشراء/البيع — مع حماية ضد القيم الفاسدة.
    const out: ExecutionServiceItem[] = [];
    for (const s of src) {
      if (!s || typeof s !== "object") continue;
      const service_type = (s.service_type as string) || (serviceKinds[0] || "تذكرة طيران");
      const note = s.note ?? null;
      if (s.kind === "company" || s.kind === "agent") {
        out.push({ ...s, service_type, note });
        continue;
      }
      // legacy
      if (s.company_id && ((Number(s.company_value) || 0) > 0 || (Number(s.company_price) || 0) > 0)) {
        out.push({ kind: "company", service_type, company_id: s.company_id, count: Number(s.count) || 1, company_price: Number(s.company_price) || 0, company_value: Number(s.company_value) || 0, note });
      }
      if ((Number(s.agent_price) || 0) > 0) {
        out.push({ kind: "agent", service_type, count: Number(s.count) || 1, agent_price: Number(s.agent_price) || 0, note });
      }
    }
    if (out.length === 0) {
      out.push({ kind: "agent", service_type: serviceKinds[0] || "تذكرة طيران", count: 1, agent_price: 0 });
    }
    return out;
  });
  const [saving, setSaving] = useState(false);

  const companyServices = services.map((s, idx) => ({ s, idx })).filter((x) => x.s.kind === "company");
  const agentServices = services.map((s, idx) => ({ s, idx })).filter((x) => x.s.kind === "agent");
  const companyTotal = companyServices.reduce((sum, { s }) => {
    const cnt = Number(s.count) || 1;
    const cv = Number(s.company_value) || 0;
    const cp = Number(s.company_price) || 0;
    return sum + (cv > 0 ? cv : cp * cnt);
  }, 0);
  const agentTotal = agentServices.reduce((sum, { s }) => sum + ((Number(s.agent_price) || 0) * (Number(s.count) || 1)), 0);
  const profit = agentTotal - companyTotal;

  const addCompanyService = () => setServices((s) => [...s, { kind: "company", service_type: serviceKinds[0] || "تذكرة طيران", company_id: null, count: 1, company_price: 0, company_value: 0 }]);
  const addAgentService = () => setServices((s) => [...s, { kind: "agent", service_type: serviceKinds[0] || "تذكرة طيران", count: 1, agent_price: 0 }]);


  const save = async () => {
    if (!form.passenger_name.trim()) { toast.error("الاسم مطلوب"); return; }
    if (services.length === 0) { toast.error("أضف خدمة واحدة على الأقل"); return; }
    if (form.dob && !isValidDisplayDate(form.dob)) {
      toast.error("تاريخ الميلاد غير صحيح. الصيغة المطلوبة: DD/MM/YYYY");
      return;
    }
    setSaving(true);
    const payload = {
      passenger_name: form.passenger_name.trim(),
      national_id: form.national_id || null,
      dob: parseDisplayDate(form.dob),
      passport: form.passport || null,
      birth_place: form.birth_place || null,
      agent_id: form.agent_id || null,
      status: form.status,
      operation_status: form.operation_status,
      departure_from: form.departure_from || null,
      destination: form.destination || null,
      airline: form.airline || null,
      travel_date: form.travel_date || null,
      notes: form.notes || null,
      approval_company_id: form.approval_company_id || null,
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
            operation_status: "تم التحويل للتنفيذ",
          }).eq("id", form.submission_id);
        }
      }
      // Post / unpost financials based on حالة العملية
      await postExecutionFinancials({
        executionId,
        operationStatus: form.operation_status,
        agentId: form.agent_id || null,
        date: form.travel_date || null,
        destination: form.destination || null,
        airline: form.airline || null,
        passengerName: form.passenger_name,
        services,
      });
      toast.success(form.operation_status === "منفذ" ? "تم التنفيذ واعتماد الحركات المالية" : "تم الحفظ");
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
        <Field label="تاريخ الميلاد"><input type="text" inputMode="numeric" placeholder="DD/MM/YYYY" value={form.dob} onChange={(e) => setForm({ ...form, dob: e.target.value })} style={inputStyle} maxLength={10} /></Field>
        <Field label="رقم الجواز"><input value={form.passport} onChange={(e) => setForm({ ...form, passport: e.target.value })} style={inputStyle} /></Field>
        <Field label="محل الميلاد"><input value={form.birth_place} onChange={(e) => setForm({ ...form, birth_place: e.target.value })} style={inputStyle} /></Field>
        <Field label="الوكيل">
          <select value={form.agent_id} onChange={(e) => setForm({ ...form, agent_id: e.target.value })} style={inputStyle}>
            <option value="">— اختر —</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
        <Field label="حالة الموافقة">
          <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} style={inputStyle}>
            {withSelected(approvalStatuses, form.status).map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="حالة العملية">
          <select value={form.operation_status} onChange={(e) => setForm({ ...form, operation_status: e.target.value })} style={inputStyle}>
            {withSelected(operationStatuses, form.operation_status).map((s) => <option key={s} value={s}>{s}</option>)}
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
        <Field label="جهة الموافقة (الشركة الصادرة)">
          <select value={form.approval_company_id} onChange={(e) => setForm({ ...form, approval_company_id: e.target.value })} style={inputStyle}>
            <option value="">— اختر —</option>
            {activeCompanies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            {form.approval_company_id && !activeCompanies.find((c) => c.id === form.approval_company_id) && companies.find((c) => c.id === form.approval_company_id) && (
              <option value={form.approval_company_id}>{companies.find((c) => c.id === form.approval_company_id)!.company_name} (غير نشطة)</option>
            )}
          </select>
        </Field>
        <Field label="ملاحظات" full><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} style={{ ...inputStyle, height: "auto", padding: 10 }} /></Field>
      </div>

      {/* خدمات الشركات الصادرة (شراء) */}
      <div style={{ marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#0f1b3d" }}>أ) خدمات الشركات الصادرة (شراء)</h4>
          <button type="button" className="btn" onClick={addCompanyService}><Plus size={12} /> إضافة خدمة شركة صادرة</button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {companyServices.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: "#64748b", border: "1px dashed #cbd5e1", borderRadius: 10, textAlign: "center", background: "#fff" }}>لا توجد خدمات شراء من شركات صادرة</div>
          )}
          {companyServices.map(({ s, idx: i }) => {
            const cnt = Number(s.count) || 1;
            const cp = Number(s.company_price) || 0;
            const total = (Number(s.company_value) || 0) > 0 ? Number(s.company_value) : cp * cnt;
            return (
              <div key={i} style={{ border: "1px solid #c7d2fe", borderRadius: 10, padding: 12, background: "#eef2ff" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                  <Field label="الشركة الصادرة">
                    <select value={s.company_id || ""} onChange={(e) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, company_id: e.target.value || null } : x))} style={inputStyle}>
                      <option value="">— اختر —</option>
                      {companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
                    </select>
                  </Field>
                  <Field label="نوع الخدمة">
                    <select value={s.service_type} onChange={(e) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, service_type: e.target.value } : x))} style={inputStyle}>
                      {withSelected(serviceKinds, s.service_type).map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </Field>
                  <Field label="العدد"><input type="number" min={1} value={s.count ?? 1} onChange={(e) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, count: Number(e.target.value) || 1 } : x))} style={inputStyle} /></Field>
                  <Field label="سعر الشركة (للوحدة)"><input type="number" min={0} value={s.company_price ?? 0} onChange={(e) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, company_price: Number(e.target.value) || 0 } : x))} style={inputStyle} /></Field>
                  <Field label="الإجمالي"><input value={total.toLocaleString("ar")} readOnly style={{ ...inputStyle, background: "#f1f5f9", fontWeight: 700 }} /></Field>
                  <Field label="ملاحظات"><input value={s.note || ""} onChange={(e) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, note: e.target.value || null } : x))} style={inputStyle} /></Field>
                </div>
                <div style={{ marginTop: 8, textAlign: "end" }}>
                  <button type="button" onClick={() => setServices((arr) => arr.filter((_, k) => k !== i))} style={{ ...iconBtn, color: "#b91c1c" }}><Trash2 size={12} /> إزالة</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* خدمات الوكيل (بيع) */}
      <div style={{ marginTop: 20 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#0f1b3d" }}>ب) خدمات الوكيل (بيع)</h4>
          <button type="button" className="btn" onClick={addAgentService}><Plus size={12} /> إضافة خدمة وكيل</button>
        </div>
        <div style={{ display: "grid", gap: 10 }}>
          {agentServices.length === 0 && (
            <div style={{ padding: 12, fontSize: 12, color: "#64748b", border: "1px dashed #cbd5e1", borderRadius: 10, textAlign: "center", background: "#fff" }}>لا توجد خدمات بيع للوكيل</div>
          )}
          {agentServices.map(({ s, idx: i }) => {
            const cnt = Number(s.count) || 1;
            const ap = Number(s.agent_price) || 0;
            const total = ap * cnt;
            return (
              <div key={i} style={{ border: "1px solid #a7f3d0", borderRadius: 10, padding: 12, background: "#ecfdf5" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                  <Field label="نوع الخدمة المباعة">
                    <select value={s.service_type} onChange={(e) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, service_type: e.target.value } : x))} style={inputStyle}>
                      {withSelected(serviceKinds, s.service_type).map((k) => <option key={k} value={k}>{k}</option>)}
                    </select>
                  </Field>
                  <Field label="العدد"><input type="number" min={1} value={s.count ?? 1} onChange={(e) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, count: Number(e.target.value) || 1 } : x))} style={inputStyle} /></Field>
                  <Field label="سعر البيع للوكيل (للوحدة)"><input type="number" min={0} value={s.agent_price ?? 0} onChange={(e) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, agent_price: Number(e.target.value) || 0 } : x))} style={inputStyle} /></Field>
                  <Field label="الإجمالي"><input value={total.toLocaleString("ar")} readOnly style={{ ...inputStyle, background: "#f1f5f9", fontWeight: 700 }} /></Field>
                  <Field label="ملاحظات"><input value={s.note || ""} onChange={(e) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, note: e.target.value || null } : x))} style={inputStyle} /></Field>
                </div>
                <div style={{ marginTop: 8, textAlign: "end" }}>
                  <button type="button" onClick={() => setServices((arr) => arr.filter((_, k) => k !== i))} style={{ ...iconBtn, color: "#b91c1c" }}><Trash2 size={12} /> إزالة</button>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ملخص الربح */}
      <div style={{ marginTop: 16, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        <div style={{ padding: 12, borderRadius: 10, background: "#eef2ff", border: "1px solid #c7d2fe" }}>
          <div style={{ fontSize: 11, color: "#475569", fontWeight: 700 }}>إجمالي تكاليف الشركات الصادرة</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#1e3a8a", marginTop: 4 }}>{companyTotal.toLocaleString("ar")}</div>
        </div>
        <div style={{ padding: 12, borderRadius: 10, background: "#ecfdf5", border: "1px solid #a7f3d0" }}>
          <div style={{ fontSize: 11, color: "#475569", fontWeight: 700 }}>إجمالي بيع الوكيل</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#047857", marginTop: 4 }}>{agentTotal.toLocaleString("ar")}</div>
        </div>
        <div style={{ padding: 12, borderRadius: 10, background: profit >= 0 ? "#fffbeb" : "#fef2f2", border: `1px solid ${profit >= 0 ? "#fde68a" : "#fecaca"}` }}>
          <div style={{ fontSize: 11, color: "#475569", fontWeight: 700 }}>صافي الربح</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: profit >= 0 ? "#b45309" : "#b91c1c", marginTop: 4 }}>{profit.toLocaleString("ar")}</div>
        </div>
      </div>


      <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: form.operation_status === "منفذ" ? "#ecfdf5" : "#f8fafc", border: `1px solid ${form.operation_status === "منفذ" ? "#a7f3d0" : "#e2e8f0"}`, fontSize: 12, color: "#475569" }}>
        <CheckCircle2 size={14} style={{ verticalAlign: "middle", marginInlineEnd: 6 }} />
        {form.operation_status === "منفذ"
          ? "عند الحفظ بحالة العملية «منفذ» سيتم إنشاء الحركات المالية على حساب الوكيل والشركة."
          : "الحركات المالية تُنشأ فقط عند حالة العملية «منفذ». حالة الموافقة لا تؤثر ماليًا."}
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

function approvalBadge(status: string): React.CSSProperties {
  const k = status || "";
  if (k.includes("رفض")) return { padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" };
  if (k.includes("سريع")) return { padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0" };
  if (k.includes("بطيء")) return { padding: "3px 10px", borderRadius: 999, fontSize: 11.5, fontWeight: 700, background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a" };
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
