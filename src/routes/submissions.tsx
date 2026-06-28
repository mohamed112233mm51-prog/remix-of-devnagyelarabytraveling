import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ClipboardCheck, Plus, Pencil, Trash2, Search, X, ArrowLeftRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useLive, useDropdownOptions, withSelected, type Agent, type Submission, type IssuingCompany } from "@/lib/db";
import { Modal } from "@/components/Modal";
import { usePerm } from "@/hooks/usePerm";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagination } from "@/hooks/usePagination";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { confirmDialog } from "@/lib/confirm";
import { toDisplayDate, parseDisplayDate, isValidDisplayDate } from "@/lib/dateFormat";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { DateInput } from "@/components/inputs/DateInput";
import { ExportButton } from "@/components/ExportButton";
import * as CF from "@/components/ColumnFilter";
import { ColumnVisibility, type ColumnDef } from "@/components/ColumnVisibility";
import { usePersistentColumnVisibility } from "@/hooks/usePersistentColumnVisibility";
import { ensureApprovalFines, computeApprovalExpiry, cairoToday } from "@/lib/approvalFines";
import { usePersistentState } from "@/hooks/usePersistentState";
import { activeOptions } from "@/lib/activeFilter";

export const Route = createFileRoute("/submissions")({
  component: () => <AppErrorBoundary><SubmissionsPage /></AppErrorBoundary>,
});



function SubmissionsPage() {
  const perm = usePerm("submissions");
  const router = useRouter();
  const { rows: submissions } = useLive<Submission>("submissions");
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const APPROVAL_STATUSES = useDropdownOptions("submission_status" as any);
  const OPERATION_STATUSES = useDropdownOptions("operation_status" as any);
  const DEPARTURES = useDropdownOptions("departure_from" as any);
  const SERVICE_KIND_OPTS = useDropdownOptions("service_kind" as any);
  const PASSENGER_TYPES = useDropdownOptions("passenger_type" as any);
  const activeCompanies = useMemo(() => companies.filter((c) => (c.status || "نشط") === "نشط"), [companies]);
  const companyName = (id: string | null | undefined, fallback?: string | null) =>
    (id && companies.find((c) => c.id === id)?.company_name) || fallback || "—";

  const [tab, setTab] = useState<"list" | "add">("list");
  const [editing, setEditing] = useState<Submission | null>(null);

  // Approval validity duration in days, loaded from app_settings.
  const [validityDays, setValidityDays] = useState<number>(30);
  const [fineAmount, setFineAmount] = useState<number>(0);
  useEffect(() => {
    supabase.from("app_settings").select("value").eq("key", "approval_validity_days").maybeSingle()
      .then(({ data }) => {
        const v = (data as any)?.value?.v;
        if (typeof v === "number" && v > 0) setValidityDays(v);
      });
    supabase.from("app_settings").select("value").eq("key", "approval_expiry_fine").maybeSingle()
      .then(({ data }) => {
        const v = (data as any)?.value?.v;
        if (typeof v === "number" && v >= 0) setFineAmount(v);
      });
  }, []);

  // Compute approval validity status for a submission row.
  // Pure date (YYYY-MM-DD) compare in Africa/Cairo. No time component.
  // Rule: today <= expiry → جارية, today > expiry → منتهية.
  const computeValidity = (s: Submission): { expiry: string; expired: boolean } | null => {
    if (!(s as any).approval_validity_enabled) return null;
    const expiry = computeApprovalExpiry(s.issue_date, validityDays);
    if (!expiry) return null;
    const today = cairoToday();
    const expired = today > expiry;
    return { expiry, expired };
  };

  // Auto-create approval-expiry fines (agent debit + company credit) for "موافقة أمنية" only.
  useEffect(() => {
    if (!Array.isArray(submissions) || submissions.length === 0) return;
    // Temporary debug — first row sample.
    const sample = submissions.find((s) => (s as any).approval_validity_enabled && s.issue_date);
    if (sample) {
      const expiry = computeApprovalExpiry(sample.issue_date, validityDays);
      const today = cairoToday();
      // eslint-disable-next-line no-console
      console.info("[approvalValidity:submission]", {
        today,
        issue_date: sample.issue_date,
        validityDays,
        expiry,
        status: expiry ? (today > expiry ? "منتهية" : "جارية") : null,
      });
    }
    void ensureApprovalFines(
      "submission",
      submissions.map((s) => ({
        id: String(s.id),
        agent_id: s.agent_id,
        approval_company_id: (s as any).approval_company_id ?? null,
        issue_date: s.issue_date,
        approval_validity_enabled: !!(s as any).approval_validity_enabled,
        services: (s as any).services,
      })),
      validityDays,
      fineAmount,
    );
  }, [submissions, fineAmount, validityDays]);


  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name || "—";

  // Column definitions for filters + visibility + export
  const SUBMISSION_COLUMNS: (ColumnDef & {
    filter?: "text" | "date" | "multi";
    accessor: (s: Submission) => string;
  })[] = [
    { key: "name", label: "الاسم", filter: "text", accessor: (s) => s.passenger_name || "" },
    { key: "nid", label: "الرقم القومي", filter: "text", accessor: (s) => s.national_id || "" },
    { key: "dob", label: "تاريخ الميلاد", filter: "date", accessor: (s) => s.dob || "" },
    { key: "passport", label: "رقم الجواز", filter: "text", accessor: (s) => s.passport || "" },
    { key: "birth_place", label: "محل الميلاد", filter: "text", accessor: (s) => s.birth_place || "" },
    { key: "agent", label: "الوكيل", filter: "multi", accessor: (s) => agentName(s.agent_id) },
    { key: "status", label: "الحالة", filter: "multi", accessor: (s) => s.status || "" },
    { key: "departure", label: "الجهة", filter: "multi", accessor: (s) => s.departure_from || "" },
    { key: "submit_date", label: "تاريخ التقديم", filter: "date", accessor: (s) => s.submit_date || "" },
    { key: "issue_date", label: "تاريخ الصدور", filter: "date", accessor: (s) => s.issue_date || "" },
    { key: "company", label: "جهة الموافقة", filter: "multi", accessor: (s) => companyName((s as any).approval_company_id, s.approval_authority) },
    { key: "services", label: "الخدمات", filter: "multi", accessor: (s) => (Array.isArray(s.services) ? s.services : []).join(" + ") },
      { key: "passenger_type", label: "نوع المسافر", filter: "multi", accessor: (s) => (s as any).passenger_type || "" },
      { key: "notes", label: "ملاحظات", filter: "text", accessor: (s) => (s as any).notes || "" },
      { key: "validity", label: "صلاحية الموافقة", filter: "multi", accessor: (s) => {
        const r = computeValidity(s); return r ? `${r.expiry} (${r.expired ? "منتهية" : "جارية"})` : "-";
      } },
    ];

  // Special-case filter accessor for validity column (returns just the status word).
  const validityStatusOf = (s: Submission): string => {
    const r = computeValidity(s);
    return r ? (r.expired ? "منتهية" : "جارية") : "";
  };

  const initialFilters = (): Record<string, CF.ColumnFilterState> => {
    const o: Record<string, CF.ColumnFilterState> = {};
    for (const c of SUBMISSION_COLUMNS) {
      o[c.key] = c.filter === "date" ? CF.emptyDateRange() : c.filter === "multi" ? CF.emptyMultiSelect() : CF.emptyText();
    }
    return o;
  };
  const [filters, setFilters] = useState<Record<string, CF.ColumnFilterState>>(() => CF.sanitizeFilterMap(undefined, initialFilters()));
  const setF = (k: string, s: CF.ColumnFilterState) => setFilters((p) => CF.sanitizeFilterMap({ ...p, [k]: s }, initialFilters()));
  const resetAll = () => setFilters(initialFilters());
  const safeFilters = CF.sanitizeFilterMap(filters, initialFilters());
  const anyActive = Object.values(safeFilters).some(CF.isFilterActive);

  const [visible, setVisible] = usePersistentColumnVisibility("submissions", SUBMISSION_COLUMNS);
  const visibleColumns = SUBMISSION_COLUMNS.filter((c) => visible[c.key] !== false);

  const filtered = useMemo(() => submissions.filter((s) => {
    for (const c of SUBMISSION_COLUMNS) {
      const fs = safeFilters[c.key];
      if (!CF.isFilterActive(fs)) continue;
      const v = c.key === "validity" ? validityStatusOf(s) : c.accessor(s);
      if (c.filter === "date" && !CF.matchDateRange(v, fs)) return false;
      if (c.filter === "multi" && !CF.matchMultiSelect(v, fs)) return false;
      if (c.filter === "text" && !CF.matchText(v, fs)) return false;
    }
    return true;
  }), [submissions, agents, companies, safeFilters, validityDays]);

  const optionsFor = (key: string) => {
    if (key === "validity") return ["جارية", "منتهية"];
    const col = SUBMISSION_COLUMNS.find((c) => c.key === key);
    if (!col) return [];
    const set = new Set<string>();
    submissions.forEach((s) => { const v = col.accessor(s); if (v) set.add(v); });
    return Array.from(set).sort();
  };

  const { pageRows, Controls, page, pageSize } = usePagination(filtered, 50);

  const onDelete = async (row: Submission) => {
    if (!perm.delete) return;
    const ok = await confirmDialog(`سيتم حذف التقديم الخاص بـ "${row.passenger_name}". هل تريد المتابعة؟`, { confirmLabel: "حذف" });
    if (!ok) return;
    const { error } = await supabase.from("submissions").delete().eq("id", row.id);
    if (error) toast.error(error.message);
    else toast.success("تم الحذف");
  };

  const convertToExecution = (row: Submission) => {
    if (!perm.edit) return;
    // Already converted: open the linked execution instead of creating a new one
    if ((row as any).execution_id) {
      toast.info("هذا التقديم تم تحويله للتنفيذ بالفعل");
      try { sessionStorage.setItem("executions:openId", String((row as any).execution_id)); } catch {}
      router.navigate({ to: "/executions" });
      return;
    }
    try {
      sessionStorage.setItem("execution:fromSubmission", JSON.stringify(row));
    } catch {}
    router.navigate({ to: "/executions" });
  };

  const NAVY = "#0f1b3d", GOLD = "#d4af37";
  const totalCount = submissions.length;
  const fastCount = submissions.filter((s) => (s.status || "") === "سريع").length;
  const slowCount = submissions.filter((s) => (s.status || "") === "بطيء").length;
  const rejectedCount = submissions.filter((s) => (s.status || "") === "رفض أمني").length;
  const expiredCount = submissions.filter((s) => { const r = computeValidity(s); return r && r.expired; }).length;

  const buildExportData = () => {
    const cols = [{ header: "م", key: "n" }, ...visibleColumns.map((c) => ({ header: c.label, key: c.key }))];
    return {
      title: "كشف التقديمات",
      fileName: "كشف-التقديمات",
      columns: cols,
      rows: filtered.map((s, i) => {
        const row: Record<string, string | number> = { n: i + 1 };
        for (const c of visibleColumns) {
          if (c.key === "dob") row[c.key] = toDisplayDate(s.dob) || "";
          else row[c.key] = c.accessor(s);
        }
        return row;
      }),
    };
  };


  return (
    <div dir="rtl" style={{ display: "grid", gap: 14 }}>
      {/* Navy hero header */}
      <div style={{ padding: "16px 20px", borderRadius: 14, border: "1px solid #1e3a8a44", background: `linear-gradient(135deg, ${NAVY} 0%, #1e3a8a 60%, #1e40af 100%)`, boxShadow: `0 10px 30px ${NAVY}2e`, color: "#fff", overflow: "hidden", position: "relative" }}>
        <div aria-hidden style={{ position: "absolute", top: -40, left: -40, width: 200, height: 200, borderRadius: "50%", background: `radial-gradient(circle, ${GOLD}30, transparent 65%)` }} />
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ display: "flex", gap: 12, alignItems: "center", minWidth: 0, flex: "1 1 320px" }}>
            <div style={{ width: 42, height: 42, borderRadius: 11, background: `linear-gradient(135deg, ${GOLD}, #e0b65c)`, color: NAVY, display: "grid", placeItems: "center", fontSize: 22, boxShadow: `0 6px 16px ${GOLD}55` }}><ClipboardCheck size={22} /></div>
            <div>
              <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900 }}>التقديمات</h1>
              <p style={{ margin: "2px 0 0", fontSize: 12, color: "#cbd5e1" }}>متابعة وتجهيز الطلبات قبل التنفيذ — لا أثر مالي</p>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button onClick={() => setTab("list")} style={{ height: 38, padding: "0 14px", borderRadius: 10, background: "rgba(255,255,255,.08)", color: "#fff", border: "1px solid rgba(255,255,255,.22)", fontWeight: 700, fontSize: 12.5, cursor: "pointer" }}>📋 القائمة</button>
            {perm.create && <button onClick={() => { setEditing(null); setTab("add"); }} style={{ height: 38, padding: "0 16px", borderRadius: 10, background: `linear-gradient(135deg, ${GOLD}, #e0b65c)`, color: NAVY, border: 0, fontWeight: 800, fontSize: 12.5, cursor: "pointer", boxShadow: `0 6px 16px ${GOLD}4d`, display: "inline-flex", alignItems: "center", gap: 6 }}><Plus size={14} /> إضافة تقديم</button>}
          </div>
        </div>
      </div>

      {/* KPI strip */}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        {[
          { icon: "📋", label: "إجمالي التقديمات", value: totalCount, bg: "#eef2ff", fg: NAVY, bd: "#dbe3ee" },
          { icon: "⚡", label: "سريع", value: fastCount, bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" },
          { icon: "🐢", label: "بطيء", value: slowCount, bg: "#f0f9ff", fg: "#0369a1", bd: "#bae6fd" },
          { icon: "⛔", label: "رفض أمني", value: rejectedCount, bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" },
          { icon: "⌛", label: "منتهية", value: expiredCount, bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" },
        ].map((k) => (
          <div key={k.label} style={{ minHeight: 84, padding: 14, borderRadius: 12, background: "#fff", border: "1px solid #eef2f7", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>
            <div style={{ width: 42, height: 42, borderRadius: 10, background: k.bg, color: k.fg, border: `1px solid ${k.bd}`, display: "grid", placeItems: "center", fontSize: 20 }}>{k.icon}</div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 3 }}>{k.label}</div>
              <div style={{ fontSize: 18, color: "#0f172a", fontWeight: 800 }}>{k.value.toLocaleString("ar")}</div>
            </div>
          </div>
        ))}
      </div>


      {tab === "list" ? (
        <>
          {/* Toolbar */}
          <div className="card" style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>{filtered.length.toLocaleString("ar")} سجل</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {anyActive && <button type="button" className="action-btn" onClick={resetAll}>مسح جميع الفلاتر</button>}
              <ColumnVisibility columns={SUBMISSION_COLUMNS} visible={visible} onChange={setVisible} />
              <ExportButton disabled={filtered.length === 0} getData={() => buildExportData()} />
            </div>
          </div>

          {/* Table */}
          <div className="card" style={{ padding: 0, overflow: "hidden" }}>
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100, fontSize: 13 }}>
                <thead>
                  <tr style={{ background: "#f8fafc", position: "sticky", top: 0 }}>
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
                    <tr><td colSpan={visibleColumns.length + 2} style={{ padding: 40, textAlign: "center", color: "#64748b" }}>لا توجد تقديمات</td></tr>
                  ) : pageRows.map((s, i) => (
                    <tr key={s.id} style={{ background: i % 2 ? "#fafbfd" : "#fff", borderBottom: "1px solid #f1f5f9" }}>
                      <td style={tdStyle}>{page * pageSize + i + 1}</td>
                      {visibleColumns.map((c) => {
                        if (c.key === "name") return <td key={c.key} style={{ ...tdStyle, fontWeight: 700 }}>{s.passenger_name}</td>;
                        if (c.key === "status") return <td key={c.key} style={tdStyle}><span style={badgeStyle(s.status)}>{s.status}</span></td>;
                        if (c.key === "dob") return <td key={c.key} style={tdStyle}>{toDisplayDate(s.dob) || "—"}</td>;
                        if (c.key === "validity") {
                          const r = computeValidity(s);
                          if (!r) return <td key={c.key} style={tdStyle}>-</td>;
                          const color = r.expired ? "#b91c1c" : "#15803d";
                          const bg = r.expired ? "#fef2f2" : "#dcfce7";
                          const bd = r.expired ? "#fecaca" : "#bbf7d0";
                          return <td key={c.key} style={tdStyle}><span style={{ padding: "3px 9px", borderRadius: 999, background: bg, color, border: `1px solid ${bd}`, fontWeight: 700, fontSize: 11 }}>{r.expiry} • {r.expired ? "منتهية" : "جارية"}</span></td>;
                        }
                        const v = c.accessor(s);
                        return <td key={c.key} style={tdStyle}>{v || "—"}</td>;
                      })}
                      <td style={{ ...tdStyle, textAlign: "end", whiteSpace: "nowrap" }}>
                        {perm.edit && (
                          <button data-confirm-save={(s as any).execution_id ? undefined : "تأكيد تحويل التقديم إلى تنفيذ"} title={(s as any).execution_id ? "فتح التنفيذ" : "تحويل إلى تنفيذ"} onClick={() => convertToExecution(s)} style={{ ...iconBtn, color: (s as any).execution_id ? "#047857" : "#475569" }}><ArrowLeftRight size={14} /></button>
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
            <Controls />
          </div>
        </>
      ) : (
        <SubmissionForm
          editing={editing}
          agents={agents}
          statuses={APPROVAL_STATUSES}
          departures={DEPARTURES}
          serviceKinds={SERVICE_KIND_OPTS}
          passengerTypes={PASSENGER_TYPES}
          companies={companies}
          activeCompanies={activeCompanies}
          onDone={() => { setTab("list"); setEditing(null); }}
        />
      )}
    </div>
  );
}

function SubmissionForm({
  editing, agents, statuses, departures, serviceKinds, passengerTypes, companies, activeCompanies, onDone,
}: {
  editing: Submission | null;
  agents: Agent[];
  statuses: readonly string[];
  departures: readonly string[];
  serviceKinds: readonly string[];
  passengerTypes: readonly string[];
  companies: IssuingCompany[];
  activeCompanies: IssuingCompany[];
  onDone: () => void;
}) {
  const initialServices = Array.isArray(editing?.services) ? editing.services.filter((s): s is string => typeof s === "string") : [];
  const draftKey = `draft:submission:${editing?.id || "new"}`;
  const [form, setForm, clearForm] = usePersistentState(`${draftKey}:form`, {
    service_type: initialServices[0] || "",
    passenger_name: editing?.passenger_name || "",
    national_id: editing?.national_id || "",
    dob: toDisplayDate(editing?.dob) || "",
    passport: editing?.passport || "",
    birth_place: editing?.birth_place || "",
    agent_id: editing?.agent_id || "",
    status: editing?.status || "",
    departure_from: editing?.departure_from || "",
    submit_date: editing?.submit_date || new Date().toISOString().slice(0, 10),
    issue_date: editing?.issue_date || "",
    approval_company_id: (editing as any)?.approval_company_id || "",
    approval_validity_enabled: Boolean((editing as any)?.approval_validity_enabled),
    passenger_type: (editing as any)?.passenger_type || "",
    notes: editing?.notes || "",
  });
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!form.passenger_name.trim()) { toast.error("الاسم مطلوب"); return; }
    if (!form.service_type) { toast.error("يجب اختيار نوع الخدمة"); return; }
    if (form.dob && !isValidDisplayDate(form.dob)) {
      toast.error("تاريخ الميلاد غير صحيح. الصيغة المطلوبة: DD/MM/YYYY");
      return;
    }
    setSaving(true);
    const payload = {
      services: [form.service_type],
      passenger_name: form.passenger_name.trim(),
      national_id: form.national_id || null,
      dob: parseDisplayDate(form.dob),
      passport: form.passport || null,
      birth_place: form.birth_place || null,
      agent_id: form.agent_id || null,
      status: form.status,
      departure_from: form.departure_from || null,
      submit_date: form.submit_date || null,
      issue_date: form.issue_date || null,
      approval_company_id: form.approval_company_id || null,
      approval_authority: form.approval_company_id
        ? (companies.find((c) => c.id === form.approval_company_id)?.company_name || null)
        : null,
      approval_validity_enabled: !!form.approval_validity_enabled,
      passenger_type: form.passenger_type || null,
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
      clearForm();
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

      <div className="form-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(220px,1fr))", gap: 12 }}>
        <Field label="نوع الخدمة">
          <SearchableSelect
            value={form.service_type}
            onChange={(v) => setForm({ ...form, service_type: v })}
            options={withSelected(serviceKinds, form.service_type)}
          />
        </Field>
        <Field label="الاسم"><input value={form.passenger_name} onChange={(e) => setForm({ ...form, passenger_name: e.target.value })} style={inputStyle} /></Field>
        <Field label="الرقم القومي"><input value={form.national_id} onChange={(e) => setForm({ ...form, national_id: e.target.value })} style={inputStyle} /></Field>
        <Field label="تاريخ الميلاد">
          <DateInput value={parseDisplayDate(form.dob) || ""} onChange={(iso) => setForm({ ...form, dob: iso ? toDisplayDate(iso) : "" })} />
        </Field>
        <Field label="رقم الجواز"><input value={form.passport} onChange={(e) => setForm({ ...form, passport: e.target.value })} style={inputStyle} /></Field>
        <Field label="محل الميلاد"><input value={form.birth_place} onChange={(e) => setForm({ ...form, birth_place: e.target.value })} style={inputStyle} /></Field>
        <Field label="الوكيل">
          <SearchableSelect
            value={form.agent_id}
            onChange={(v) => setForm({ ...form, agent_id: v })}
            options={agents.map((a) => ({ value: a.id, label: a.name }))}
          />
        </Field>
        <Field label="الحالة">
          <SearchableSelect
            value={form.status}
            onChange={(v) => setForm({ ...form, status: v })}
            options={withSelected(statuses, form.status)}
            placeholder="اختر الحالة..."
          />
        </Field>
        <Field label="الجهة (جهة المغادرة)">
          <SearchableSelect
            value={form.departure_from}
            onChange={(v) => setForm({ ...form, departure_from: v })}
            options={withSelected(departures, form.departure_from)}
          />
        </Field>
        <Field label="تاريخ التقديم">
          <DateInput value={form.submit_date} defaultToday={!editing} onChange={(iso) => setForm({ ...form, submit_date: iso })} />
        </Field>
        <Field label="تاريخ الصدور">
          <DateInput value={form.issue_date} onChange={(iso) => setForm({ ...form, issue_date: iso })} />
        </Field>
        <Field label="جهة الموافقة (الشركة الصادرة)">
          <SearchableSelect
            value={form.approval_company_id}
            onChange={(v) => setForm({ ...form, approval_company_id: v })}
            options={[
              ...activeCompanies.map((c) => ({ value: c.id, label: c.company_name })),
              ...(form.approval_company_id && !activeCompanies.find((c) => c.id === form.approval_company_id) && companies.find((c) => c.id === form.approval_company_id)
                ? [{ value: form.approval_company_id, label: `${companies.find((c) => c.id === form.approval_company_id)!.company_name} (غير نشطة)` }]
                : []),
            ]}
          />
        </Field>
        <Field label="نوع المسافر">
          <SearchableSelect
            value={form.passenger_type}
            onChange={(v) => setForm({ ...form, passenger_type: v })}
            options={withSelected(passengerTypes, form.passenger_type)}
          />
        </Field>
        <Field label="ملاحظات" full><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} style={{ ...inputStyle, height: "auto", padding: 10 }} /></Field>
        <Field label="تفعيل صلاحية الموافقة" full>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 10, cursor: "pointer", padding: "8px 12px", borderRadius: 10, border: "1px solid #e2e8f0", background: "#fff" }}>
            <span style={{ position: "relative", display: "inline-block", width: 40, height: 22 }}>
              <input type="checkbox" checked={!!form.approval_validity_enabled} onChange={(e) => setForm({ ...form, approval_validity_enabled: e.target.checked })} style={{ opacity: 0, width: 0, height: 0 }} />
              <span style={{ position: "absolute", inset: 0, borderRadius: 999, background: form.approval_validity_enabled ? "#15803d" : "#cbd5e1", transition: "background .15s" }} />
              <span style={{ position: "absolute", top: 2, [form.approval_validity_enabled ? "right" : "left"]: 2, width: 18, height: 18, borderRadius: "50%", background: "#fff", boxShadow: "0 1px 2px rgba(0,0,0,.2)", transition: "all .15s" } as any} />
            </span>
            <span style={{ fontSize: 12.5, color: "#334155", fontWeight: 700 }}>{form.approval_validity_enabled ? "مفعلة — تُحسب من تاريخ الصدور" : "غير مفعلة"}</span>
          </label>
        </Field>
      </div>

      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn" onClick={onDone} disabled={saving}>إلغاء</button>
        <button data-confirm-save={editing ? "تأكيد حفظ تعديل التقديم" : "تأكيد حفظ التقديم"} onClick={save} disabled={saving} style={{ height: 38, padding: "0 18px", borderRadius: 10, background: "linear-gradient(135deg, #d4af37, #e0b65c)", color: "#0f1b3d", border: 0, fontWeight: 800, fontSize: 13, cursor: saving ? "not-allowed" : "pointer", boxShadow: "0 6px 16px #d4af374d", opacity: saving ? 0.7 : 1 }}>{saving ? "جارٍ الحفظ..." : (editing ? "حفظ التعديل" : "حفظ التقديم")}</button>
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
