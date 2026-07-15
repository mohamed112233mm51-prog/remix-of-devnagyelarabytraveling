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
import { Modal } from "@/components/Modal";
import { confirmDialog } from "@/lib/confirm";
import { toDisplayDate, parseDisplayDate, isValidDisplayDate } from "@/lib/dateFormat";
import { ExportButton } from "@/components/ExportButton";
import * as CF from "@/components/ColumnFilter";
import { ColumnVisibility, type ColumnDef } from "@/components/ColumnVisibility";
import { usePersistentColumnVisibility } from "@/hooks/usePersistentColumnVisibility";
import { ensureApprovalFines, computeApprovalExpiry, cairoToday } from "@/lib/approvalFines";
import { isAbsentStatus, ABSENT_FIELD_STYLE, ABSENT_ROW_STYLE } from "@/lib/absentApproval";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { NumberInput } from "@/components/inputs/NumberInput";
import { DateInput } from "@/components/inputs/DateInput";
import { resolveAgentPrice, currencyShortLabel } from "@/lib/pricingMatch";
import { useAuth } from "@/hooks/useAuth";
import { canViewProfitPermission, NET_PROFIT_PERMISSION_KEY } from "@/lib/permissionKeys";
import { usePersistentState } from "@/hooks/usePersistentState";
import { activeOptions } from "@/lib/activeFilter";
import {
  computeExecutionProfitEGP,
  loadCurrencyBuyRows,
  resolveRateFromRows,
  aggregateExecutionByCurrency,
  type CurrencyBuyRow,
  type FxLocks,
} from "@/lib/executionProfit";

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
  const PASSENGER_TYPES = useDropdownOptions("passenger_type" as any);

  // Approval validity days + fine amount from app_settings (mirrors submissions logic)
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

  // Auto-create approval-expiry fines (agent debit + company credit) for "موافقة أمنية" only.
  useEffect(() => {
    if (!Array.isArray(executions) || executions.length === 0) return;
    const sample = executions.find((e) => (e as any).approval_validity_enabled && (e as any).issue_date);
    if (sample) {
      const issue = (sample as any).issue_date as string;
      const expiry = computeApprovalExpiry(issue, validityDays);
      const today = cairoToday();
      // eslint-disable-next-line no-console
      console.info("[approvalValidity:execution]", {
        today,
        issue_date: issue,
        validityDays,
        expiry,
        status: expiry ? (today > expiry ? "منتهية" : "جارية") : null,
      });
    }
    void ensureApprovalFines(
      "execution",
      executions.map((e) => ({
        id: String(e.id),
        agent_id: e.agent_id,
        approval_company_id: (e as any).approval_company_id ?? null,
        issue_date: (e as any).issue_date ?? null,
        approval_validity_enabled: !!(e as any).approval_validity_enabled,
        services: (e as any).services,
      })),
      validityDays,
      fineAmount,
    );
  }, [executions, fineAmount, validityDays]);

  // Pure date compare in Africa/Cairo. today <= expiry → جارية, today > expiry → منتهية.
  const computeValidity = (e: Execution): { expiry: string; expired: boolean } | null => {
    if (!(e as any).approval_validity_enabled) return null;
    const expiry = computeApprovalExpiry((e as any).issue_date ?? null, validityDays);
    if (!expiry) return null;
    const today = cairoToday();
    return { expiry, expired: today > expiry };
  };

  const validityStatusOf = (e: Execution): string => {
    const r = computeValidity(e); return r ? (r.expired ? "منتهية" : "جارية") : "";
  };

  // Prefill from a submission (if user clicked "تحويل التقديم إلى تنفيذ").
  // Read synchronously in the useState initializer so React StrictMode's
  // double-mount in dev cannot collapse the form back to the list before
  // the user has saved (a useEffect-based read would remove the key on the
  // first mount and find nothing on the second).
  const initialPrefill = (() => {
    if (typeof window === "undefined") return null;
    try {
      const raw = sessionStorage.getItem("execution:fromSubmission");
      if (!raw) return null;
      const sub = JSON.parse(raw);
      if (!sub || typeof sub !== "object" || Array.isArray(sub)) return null;
      const submissionServices = Array.isArray(sub.services) ? sub.services : [];
      return {
        id: "",
        submission_id: sub.id,
        passenger_name: sub.passenger_name,
        national_id: sub.national_id,
        dob: sub.dob,
        passport: sub.passport,
        birth_place: sub.birth_place,
        agent_id: sub.agent_id,
        status: "",
        operation_status: "",
        departure_from: sub.departure_from,
        destination: null, airline: null, travel_date: null,
        notes: sub.notes,
        approval_company_id: sub.approval_company_id || null,
        passenger_type: sub.passenger_type || null,
        issue_date: sub.issue_date || null,
        approval_validity_enabled: !!sub.approval_validity_enabled,
        services: submissionServices.map((s: string) => ({ service_type: String(s || ""), count: 1, agent_price: 0, company_price: 0, company_value: 0 })).filter((s: { service_type: string }) => s.service_type),
        created_at: "", updated_at: "",
      } as any as Execution;
    } catch { return null; }
  })();

  const [tab, setTab] = useState<"list" | "add">(initialPrefill ? "add" : "list");
  const [editing, setEditing] = useState<Execution | null>(initialPrefill);
  const activeCompanies = useMemo(() => companies.filter((c) => (c.status || "نشط") === "نشط"), [companies]);
  const companyName = (id: string | null | undefined) =>
    (id && companies.find((c) => c.id === id)?.company_name) || "—";
  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name || "—";

  // Clear the prefill key only after both StrictMode mounts have read it.
  useEffect(() => {
    if (!initialPrefill) return;
    const t = setTimeout(() => {
      try { sessionStorage.removeItem("execution:fromSubmission"); } catch {}
    }, 0);
    return () => clearTimeout(t);
     
  }, []);

  // Open existing execution by id (when coming from submission already converted)
  useEffect(() => {
    try {
      const openId = typeof window !== "undefined" ? sessionStorage.getItem("executions:openId") : null;
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
    { key: "passenger_type", label: "نوع المسافر", filter: "multi", accessor: (e) => (e as any).passenger_type || "" },
    { key: "notes", label: "ملاحظات", filter: "text", accessor: (e) => e.notes || "" },
    { key: "validity", label: "صلاحية الموافقة", filter: "multi", accessor: (e) => {
      const r = computeValidity(e); return r ? `${r.expiry} (${r.expired ? "منتهية" : "جارية"})` : "-";
    } },
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

  const [visible, setVisible] = usePersistentColumnVisibility("executions", EXECUTION_COLUMNS);
  const visibleColumns = EXECUTION_COLUMNS.filter((c) => visible[c.key] !== false);

  const filtered = useMemo(() => executions.filter((e) => {
    for (const c of EXECUTION_COLUMNS) {
      const fs = safeFilters[c.key];
      if (!CF.isFilterActive(fs)) continue;
      const v = c.key === "validity" ? validityStatusOf(e) : c.accessor(e);
      if (c.filter === "date" && !CF.matchDateRange(v, fs)) return false;
      if (c.filter === "multi" && !CF.matchMultiSelect(v, fs)) return false;
      if (c.filter === "text" && !CF.matchText(v, fs)) return false;
    }
    return true;
  }), [executions, agents, companies, safeFilters, validityDays]);

  const optionsFor = (key: string) => {
    if (key === "validity") return ["جارية", "منتهية"];
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
  // "تنفيذ اليوم" = السجلات التي تاريخ مغادرتها (travel_date) يساوي اليوم بتوقيت القاهرة،
  // باستثناء الملغية فقط. لا يعتمد على تاريخ الإنشاء/التقديم/الإصدار أو الحالة.
  const todayISO = cairoToday();
  const CANCELLED_STATUSES = new Set(["ملغي", "ملغية", "ملغى", "محذوف"]);
  const isTodayDeparture = (e: Execution) => {
    const raw = String((e as any).travel_date || "").trim();
    if (!raw) return false;
    // dعم ISO (YYYY-MM-DD[...]) و DD/MM/YYYY
    const iso = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : (parseDisplayDate(raw) || "");
    if (iso !== todayISO) return false;
    return !CANCELLED_STATUSES.has(String(e.operation_status || "").trim());
  };
  const todayCount = executions.filter(isTodayDeparture).length;

  const applyTodayFilter = () => {
    const base = initialFilters();
    base["travel_date"] = { type: "dateRange", from: todayISO, to: todayISO } as CF.ColumnFilterState;
    setFilters(base);
    setTab("list");
  };

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
        <KpiCard icon="📋" label="إجمالي التنفيذ" value={totalCount} tone="navy" />
        <KpiCard icon="✅" label="منفذ" value={doneCount} tone="emerald" />
        <KpiCard icon="⏳" label="قيد التنفيذ" value={pendingCount} tone="sky" />
        <KpiCard icon="📅" label="تنفيذ اليوم" value={todayCount} tone="amber" onClick={applyTodayFilter} />
      </div>


      {tab === "list" ? (
        <>
          <div className="card" style={{ padding: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "#64748b" }}>{filtered.length.toLocaleString("ar")} سجل</span>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {anyActive && <button type="button" className="action-btn" onClick={resetAll}>مسح جميع الفلاتر</button>}
              <ColumnVisibility columns={EXECUTION_COLUMNS} visible={visible} onChange={setVisible} />
              <ExportButton disabled={filtered.length === 0} getData={() => buildExportData()} whatsapp={{ phone: null }} />
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
                  ) : pageRows.map((e, i) => {
                    const ageBg = paxAgeBg(e.dob, e.created_at);
                    const defaultBg = i % 2 ? "#fafbfd" : "#fff";
                    return (
                    <tr key={e.id} style={{ background: ageBg || defaultBg, borderBottom: "1px solid #f1f5f9" }}>

                      <td style={tdStyle}>{page * pageSize + i + 1}</td>
                      {visibleColumns.map((c) => {
                        if (c.key === "name") return <td key={c.key} style={{ ...tdStyle, fontWeight: 700 }}>{e.passenger_name}</td>;
                        if (c.key === "status") return <td key={c.key} style={tdStyle}><span style={approvalBadge(e.status)}>{e.status}</span></td>;
                        if (c.key === "op_status") return <td key={c.key} style={tdStyle}><span style={statusBadge(e.operation_status)}>{e.operation_status}</span></td>;
                        if (c.key === "dob") return <td key={c.key} style={tdStyle}>{toDisplayDate(e.dob) || "—"}</td>;
                        if (c.key === "validity") {
                          const r = computeValidity(e);
                          if (!r) return <td key={c.key} style={tdStyle}>-</td>;
                          const color = r.expired ? "#b91c1c" : "#15803d";
                          const bg = r.expired ? "#fef2f2" : "#dcfce7";
                          const bd = r.expired ? "#fecaca" : "#bbf7d0";
                          return <td key={c.key} style={tdStyle}><span style={{ padding: "3px 9px", borderRadius: 999, background: bg, color, border: `1px solid ${bd}`, fontWeight: 700, fontSize: 11 }}>{r.expiry} • {r.expired ? "منتهية" : "جارية"}</span></td>;
                        }
                        const v = c.accessor(e);
                        return <td key={c.key} style={tdStyle}>{v || "—"}</td>;
                      })}
                      <td style={{ ...tdStyle, textAlign: "end", whiteSpace: "nowrap" }}>
                        {perm.edit && <button title="تعديل" onClick={() => { setEditing(e); setTab("add"); }} style={iconBtn}><Pencil size={14} /></button>}
                        {perm.delete && <button title="حذف" onClick={() => onDelete(e)} style={{ ...iconBtn, color: "#b91c1c" }}><Trash2 size={14} /></button>}
                      </td>
                    </tr>
                    );
                  })}

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
          passengerTypes={PASSENGER_TYPES}
          onDone={() => { setTab("list"); setEditing(null); }}
        />
      )}
    </div>
  );
}

function KpiCard({ icon, label, value, tone, onClick }: { icon: string; label: string; value: number | string; tone: "navy" | "emerald" | "sky" | "rose" | "amber"; onClick?: () => void }) {
  const tones: Record<string, { bg: string; fg: string; bd: string }> = {
    navy:    { bg: "#eef2ff", fg: NAVY,      bd: "#dbe3ee" },
    emerald: { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" },
    sky:     { bg: "#f0f9ff", fg: "#0369a1", bd: "#bae6fd" },
    rose:    { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" },
    amber:   { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" },
  };
  const t = tones[tone];
  const clickable = typeof onClick === "function";
  return (
    <div
      onClick={onClick}
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onKeyDown={clickable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onClick?.(); } } : undefined}
      style={{ minHeight: 84, padding: 14, borderRadius: 12, background: "#fff", border: "1px solid #eef2f7", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 2px rgba(15,23,42,.04)", cursor: clickable ? "pointer" : "default" }}
    >
      <div style={{ width: 42, height: 42, borderRadius: 10, background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, display: "grid", placeItems: "center", fontSize: 20 }}>{icon}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 3 }}>{label}</div>
        <div style={{ fontSize: 18, color: "#0f172a", fontWeight: 800 }}>{typeof value === "number" ? value.toLocaleString("ar") : value}</div>
      </div>
    </div>
  );
}

function ExecutionForm({
  editing, agents, companies, activeCompanies, merchants, approvalStatuses, operationStatuses, departures, destinations, airlines, serviceKinds, passengerTypes, onDone,
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
  passengerTypes: readonly string[];
  onDone: () => void;
}) {
  const { permissions, roles, isSuperAdmin, profileLoaded } = useAuth();
  const canViewNetProfit = profileLoaded && canViewProfitPermission(permissions, { roles, isSuperAdmin }, NET_PROFIT_PERMISSION_KEY);
  const draftKey = `draft:execution:${editing?.id || "new"}`;
  const [form, setForm, clearForm] = usePersistentState(`${draftKey}:form`, {
    passenger_name: editing?.passenger_name || "",
    national_id: editing?.national_id || "",
    dob: toDisplayDate(editing?.dob) || "",
    passport: editing?.passport || "",
    birth_place: editing?.birth_place || "",
    agent_id: editing?.agent_id || "",
    status: editing?.status || "",
    operation_status: editing?.operation_status || "",
    departure_from: editing?.departure_from || "",
    destination: editing?.destination || "",
    airline: editing?.airline || "",
    travel_date: editing?.travel_date || "",
    notes: editing?.notes || "",
    approval_company_id: (editing as any)?.approval_company_id || "",
    passenger_type: (editing as any)?.passenger_type || "",
    issue_date: (editing as any)?.issue_date || "",
    approval_validity_enabled: Boolean((editing as any)?.approval_validity_enabled),
    submission_id: editing?.submission_id || null as string | null,
  });
  const [services, setServices, clearServices] = usePersistentState<ExecutionServiceItem[]>(`${draftKey}:services`, (() => {
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
      out.push({ kind: "company", service_type: serviceKinds[0] || "تذكرة طيران", company_id: null, count: 1, company_price: 0, company_value: 0 });
      out.push({ kind: "agent", service_type: serviceKinds[0] || "تذكرة طيران", count: 1, agent_price: 0 });
    }

    return out;
  })());
  const [saving, setSaving] = useState(false);
  const [dupWarning, setDupWarning] = useState<{ matches: any[] } | null>(null);

  const companyServices = services.map((s, idx) => ({ s, idx })).filter((x) => x.s.kind === "company");
  const agentServices = services.map((s, idx) => ({ s, idx })).filter((x) => x.s.kind === "agent");
  const companyTotal = companyServices.reduce((sum, { s }) => {
    const cnt = Number(s.count) || 1;
    const cv = Number(s.company_value) || 0;
    const cp = Number(s.company_price) || 0;
    return sum + (cv > 0 ? cv : cp * cnt);
  }, 0);
  const agentTotal = agentServices.reduce((sum, { s }) => sum + ((Number(s.agent_price) || 0) * (Number(s.count) || 1)), 0);
  const companyCurrencies = Array.from(new Set(companyServices.map(({ s }) => ((s as any).currency || "EGP")).filter(Boolean)));
  const agentCurrencies = Array.from(new Set(agentServices.map(({ s }) => ((s as any).currency || "EGP")).filter(Boolean)));
  const companyCurrency = companyCurrencies.length === 1 ? companyCurrencies[0] : null;
  const agentCurrency = agentCurrencies.length === 1 ? agentCurrencies[0] : null;
  // Per-currency totals & profit: never sum across currencies.
  const companyTotalByCurrency: Record<string, number> = {};
  const agentTotalByCurrency: Record<string, number> = {};
  const profitByCurrency: Record<string, number> = {};
  for (const { s } of companyServices) {
    const cur = ((s as any).currency || "EGP") as string;
    const cnt = Number(s.count) || 1;
    const cv = Number(s.company_value) || 0;
    const cp = Number(s.company_price) || 0;
    const amt = cv > 0 ? cv : cp * cnt;
    companyTotalByCurrency[cur] = (companyTotalByCurrency[cur] || 0) + amt;
    profitByCurrency[cur] = (profitByCurrency[cur] || 0) - amt;
  }
  for (const { s } of agentServices) {
    const cur = ((s as any).currency || "EGP") as string;
    const amt = (Number(s.agent_price) || 0) * (Number(s.count) || 1);
    agentTotalByCurrency[cur] = (agentTotalByCurrency[cur] || 0) + amt;
    profitByCurrency[cur] = (profitByCurrency[cur] || 0) + amt;
  }
  const profitCurrencies = Object.keys(profitByCurrency);
  const singleProfitCurrency = profitCurrencies.length === 1 ? profitCurrencies[0] : null;
  const profit = singleProfitCurrency ? profitByCurrency[singleProfitCurrency] : 0;
  const profitCurrency = singleProfitCurrency;
  // Fixed display order for currencies across all cards.
  const CURRENCY_ORDER = ["EGP", "USD", "LYD"];
  const sortCurrencies = (curs: string[]) => {
    const rank = (c: string) => {
      const i = CURRENCY_ORDER.indexOf(c);
      return i === -1 ? CURRENCY_ORDER.length : i;
    };
    return [...curs].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));
  };

  // ─── Net-profit preview (EGP) — SAME central source used by Dashboard.
  // Read-only preview: never writes fx_locks. Resolves historical rates
  // via `resolveRateFromRows(rows, cur, travel_date)` and feeds them as
  // synthetic locks to `computeExecutionProfitEGP`. If any required
  // currency has no rate on/before travel_date, preview is "pending".
  const [buyRows, setBuyRows] = useState<CurrencyBuyRow[]>([]);
  useEffect(() => {
    let alive = true;
    loadCurrencyBuyRows(supabase)
      .then((rows) => { if (alive) setBuyRows(rows); })
      .catch(() => { if (alive) setBuyRows([]); });
    return () => { alive = false; };
  }, []);
  const profitPreview = useMemo(() => {
    const synthetic = {
      id: editing?.id || "preview",
      travel_date: form.travel_date || null,
      operation_status: "منفذ",
      services,
      fx_locks: ((editing as any)?.fx_locks as FxLocks | null) || null,
      fx_locked_at: (editing as any)?.fx_locked_at || null,
    };
    // If already locked historically, use those locks verbatim.
    const existing: FxLocks = { ...(synthetic.fx_locks || {}) };
    const { salesByCur, costByCur } = aggregateExecutionByCurrency(synthetic);
    const foreign = Array.from(
      new Set([...Object.keys(salesByCur), ...Object.keys(costByCur)].filter((c) => c !== "EGP")),
    );
    const missingForPreview: string[] = [];
    const previewLocks: FxLocks = { ...existing };
    if (form.travel_date) {
      for (const cur of foreign) {
        if (Number(previewLocks[cur]) > 0) continue;
        const rate = resolveRateFromRows(buyRows, cur, form.travel_date);
        if (rate !== null) previewLocks[cur] = rate;
        else missingForPreview.push(cur);
      }
    } else {
      for (const cur of foreign) if (!(Number(previewLocks[cur]) > 0)) missingForPreview.push(cur);
    }
    if (foreign.length > 0 && missingForPreview.length > 0) {
      return {
        status: "pending" as const,
        profitEGP: null as number | null,
        missing: missingForPreview,
        reason: !form.travel_date
          ? "أدخل تاريخ المغادرة أولاً لحساب الربح بالجنيه."
          : `لا يمكن حساب الربح حتى يتم تسجيل سعر شراء للعملات: ${missingForPreview.join(", ")}`,
      };
    }
    const res = computeExecutionProfitEGP({ ...synthetic, fx_locks: previewLocks });
    return {
      status: res.status,
      profitEGP: res.profitEGP,
      missing: res.missingCurrencies,
      reason: res.reason,
    };
  }, [services, form.travel_date, buyRows, editing?.id, (editing as any)?.fx_locks]);


  const addCompanyService = () => setServices((s) => [...s, { kind: "company", service_type: serviceKinds[0] || "تذكرة طيران", company_id: null, count: 1, company_price: 0, company_value: 0 }]);
  const addAgentService = () => setServices((s) => [...s, { kind: "agent", service_type: serviceKinds[0] || "تذكرة طيران", count: 1, agent_price: 0 }]);


  const save = async (skipDupCheck = false) => {
    if (!form.passenger_name.trim()) { toast.error("الاسم مطلوب"); return; }
    if (services.length === 0) { toast.error("أضف خدمة واحدة على الأقل"); return; }
    if (form.dob && !isValidDisplayDate(form.dob)) {
      toast.error("تاريخ الميلاد غير صحيح. الصيغة المطلوبة: DD/MM/YYYY");
      return;
    }
    // Duplicate check by passport OR national_id (case/space-insensitive, ignore cancelled)
    const passportNorm = (form.passport || "").trim().toLowerCase();
    const nationalNorm = (form.national_id || "").trim().toLowerCase();
    if (!skipDupCheck && (passportNorm || nationalNorm)) {
      try {
        const filters: string[] = [];
        if (passportNorm) filters.push(`passport.ilike.${passportNorm}`);
        if (nationalNorm) filters.push(`national_id.ilike.${nationalNorm}`);
        const { data: dups } = await supabase
          .from("executions")
          .select("id,passenger_name,passport,national_id,operation_status,status,travel_date,created_at,services")
          .or(filters.join(","));
        const matches = (dups || []).filter((d: any) => {
          if (d.id === editing?.id) return false;
          const op = (d.operation_status || "").toString();
          if (op.includes("ملغي") || op.includes("ملغاة")) return false;
          const pMatch = passportNorm && (d.passport || "").trim().toLowerCase() === passportNorm;
          const nMatch = nationalNorm && (d.national_id || "").trim().toLowerCase() === nationalNorm;
          return pMatch || nMatch;
        });
        if (matches.length > 0) {
          setDupWarning({ matches });
          return;
        }
      } catch { /* if check fails, don't block save */ }
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
      passenger_type: form.passenger_type || null,
      issue_date: form.issue_date || null,
      approval_validity_enabled: !!form.approval_validity_enabled,
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
        executionNotes: form.notes || null,
        services,
      });
      // Try to lock FX rates for this execution (once, on first success).
      // If no buy rate exists yet for a currency, the execution stays "pending"
      // and is excluded from all profit aggregates until the lock succeeds.
      try {
        if (form.operation_status === "منفذ") {
          const { data: exRow } = await supabase
            .from("executions")
            .select("id, travel_date, created_at, operation_status, services, fx_locks, fx_locked_at")
            .eq("id", executionId)
            .maybeSingle();
          if (exRow) {
            const { ensureExecutionFxLocks } = await import("@/lib/executionProfit");
            await ensureExecutionFxLocks(supabase as any, exRow as any);
          }
        }
      } catch (fxErr) {
        console.warn("[fx-lock] failed for execution", executionId, fxErr);
      }
      toast.success(form.operation_status === "منفذ" ? "تم التنفيذ واعتماد الحركات المالية" : "تم الحفظ");
      clearForm();
      clearServices();
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
        <Field label="تاريخ الميلاد"><DateInput value={parseDisplayDate(form.dob) || ""} onChange={(iso) => setForm({ ...form, dob: toDisplayDate(iso) || "" })} /></Field>
        <Field label="رقم الجواز"><input value={form.passport} onChange={(e) => setForm({ ...form, passport: e.target.value })} style={inputStyle} /></Field>
        <Field label="محل الميلاد"><input value={form.birth_place} onChange={(e) => setForm({ ...form, birth_place: e.target.value })} style={inputStyle} /></Field>
        <Field label="الوكيل">
          <SearchableSelect
            value={form.agent_id}
            onChange={(v) => setForm({ ...form, agent_id: v })}
            options={activeOptions(agents, form.agent_id, (a) => a.name)}
          />
        </Field>
        <Field label="حالة الموافقة">
          <div style={isAbsentStatus(form.status) ? { padding: 6, borderRadius: 8, border: "1px solid #ef4444", ...ABSENT_FIELD_STYLE } : undefined}>
            <SearchableSelect
              value={form.status}
              onChange={(v) => setForm({ ...form, status: v })}
              options={withSelected(approvalStatuses, form.status)}
              placeholder="اختر الحالة..."
            />
          </div>
        </Field>
        <Field label="حالة العملية">
          <SearchableSelect
            value={form.operation_status}
            onChange={(v) => setForm({ ...form, operation_status: v })}
            options={withSelected(operationStatuses, form.operation_status)}
            placeholder="اختر حالة العملية..."
          />
        </Field>

        <Field label="جهة المغادرة">
          <SearchableSelect
            value={form.departure_from}
            onChange={(v) => setForm({ ...form, departure_from: v })}
            options={withSelected(departures, form.departure_from)}
          />
        </Field>
        <Field label="الوجهة">
          <SearchableSelect
            value={form.destination}
            onChange={(v) => setForm({ ...form, destination: v })}
            options={withSelected(destinations, form.destination)}
          />
        </Field>
        <Field label="الطيران">
          <SearchableSelect
            value={form.airline}
            onChange={(v) => setForm({ ...form, airline: v })}
            options={withSelected(airlines, form.airline)}
          />
        </Field>
        <Field label="تاريخ المغادرة"><DateInput value={form.travel_date} onChange={(iso) => setForm({ ...form, travel_date: iso })} /></Field>
        <Field label="جهة الموافقة (الشركة الصادرة)">
          <SearchableSelect
            value={form.approval_company_id}
            onChange={(v) => setForm({ ...form, approval_company_id: v })}
            options={(() => {
              const opts = activeCompanies.map((c) => ({ value: c.id, label: c.company_name }));
              if (form.approval_company_id && !activeCompanies.find((c) => c.id === form.approval_company_id)) {
                const inactive = companies.find((c) => c.id === form.approval_company_id);
                if (inactive) opts.push({ value: inactive.id, label: `${inactive.company_name} (غير نشطة)` });
              }
              return opts;
            })()}
          />
        </Field>
        <Field label="نوع المسافر">
          <SearchableSelect
            value={form.passenger_type}
            onChange={(v) => setForm({ ...form, passenger_type: v })}
            options={withSelected(passengerTypes, form.passenger_type)}
          />
        </Field>
        <Field label="تاريخ الصدور"><DateInput value={form.issue_date} onChange={(iso) => setForm({ ...form, issue_date: iso })} /></Field>
        <Field label="ملاحظات" full><textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} style={{ ...inputStyle, height: "auto", padding: 10 }} /></Field>
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
              <div key={i} style={isAbsentStatus(form.status) ? { border: "1px solid #ef4444", borderRadius: 10, padding: 12, ...ABSENT_FIELD_STYLE } : { border: "1px solid #c7d2fe", borderRadius: 10, padding: 12, background: "#eef2ff" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                  <Field label="الشركة الصادرة">
                    <SearchableSelect
                      value={s.company_id || ""}
                      onChange={(v) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, company_id: v || null } : x))}
                      options={activeOptions(companies, s.company_id, (c) => c.company_name)}
                    />
                  </Field>
                  <Field label="نوع الخدمة">
                    <SearchableSelect
                      value={s.service_type}
                      onChange={(v) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, service_type: v } : x))}
                      options={withSelected(serviceKinds, s.service_type)}
                      allowClear={false}
                    />
                  </Field>
                  <Field label="العدد"><NumberInput value={Number(s.count) || 0} onChange={(n) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, count: n || 1 } : x))} min={1} /></Field>
                  <Field label={`سعر الشركة (للوحدة) — ${currencyShortLabel((s as any).currency || "EGP")}`}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <NumberInput value={Number(s.company_price) || 0} onChange={(n) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, company_price: n } : x))} min={0} />
                      <button type="button" className="btn" title="جلب السعر من ملف تسعير الشركة"
                        onClick={async () => {
                          const companyId = s.company_id || form.approval_company_id;
                          if (!companyId) return toast.error("اختر الشركة الصادرة أولاً");
                          const agent = agents.find((a) => a.id === form.agent_id);
                          const tier = (agent as any)?.tier || "A";
                          const res = await resolveAgentPrice({
                            company_id: companyId,
                            service_type: s.service_type,
                            agent_tier: tier,
                            departure_from: form.departure_from || null,
                            destination: form.destination || null,
                            airline: form.airline || null,
                            approval_company_id: form.approval_company_id || null,
                            status: form.status || null,
                            passenger_type: form.passenger_type || null,
                          });
                          const cp = res.rule ? Number(res.rule.company_price) : null;
                          if (cp == null) return toast.error(res.reason || "لا يوجد سعر مطابق");
                          const cur = res.rule?.currency || "EGP";
                          setServices((arr) => arr.map((x, k) => k === i ? { ...x, company_price: cp, currency: cur } : x));
                          toast.success(`تم جلب السعر: ${cp.toFixed(2)} (${cur})`);

                        }}
                        style={{ padding: "4px 8px", fontSize: 11 }}
                      >🔄</button>
                    </div>
                  </Field>
                  <Field label="الإجمالي"><input value={`${total.toLocaleString("ar")} ${currencyShortLabel((s as any).currency || "EGP")}`} readOnly style={{ ...inputStyle, background: "#f1f5f9", fontWeight: 700 }} /></Field>
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
              <div key={i} style={isAbsentStatus(form.status) ? { border: "1px solid #ef4444", borderRadius: 10, padding: 12, ...ABSENT_FIELD_STYLE } : { border: "1px solid #a7f3d0", borderRadius: 10, padding: 12, background: "#ecfdf5" }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10 }}>
                  <Field label="نوع الخدمة المباعة">
                    <SearchableSelect
                      value={s.service_type}
                      onChange={(v) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, service_type: v } : x))}
                      options={withSelected(serviceKinds, s.service_type)}
                      allowClear={false}
                    />
                  </Field>
                  <Field label="العدد"><NumberInput value={Number(s.count) || 0} onChange={(n) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, count: n || 1 } : x))} min={1} /></Field>
                  <Field label={`سعر البيع للوكيل (للوحدة) — ${currencyShortLabel((s as any).currency || "EGP")}`}>
                    <div style={{ display: "flex", gap: 4 }}>
                      <NumberInput value={Number(s.agent_price) || 0} onChange={(n) => setServices((arr) => arr.map((x, k) => k === i ? { ...x, agent_price: n } : x))} min={0} />
                      <button type="button" className="btn" title="جلب السعر من ملف تسعير الشركة"
                        onClick={async () => {
                          const agent = agents.find((a) => a.id === form.agent_id);
                          if (!form.approval_company_id) return toast.error("اختر جهة الموافقة (الشركة) أولاً");
                          if (!agent) return toast.error("اختر الوكيل أولاً");
                          const tier = (agent as any).tier || "A";
                          const res = await resolveAgentPrice({
                            company_id: form.approval_company_id,
                            service_type: s.service_type,
                            agent_tier: tier,
                            departure_from: form.departure_from || null,
                            destination: form.destination || null,
                            airline: form.airline || null,
                            approval_company_id: form.approval_company_id || null,
                            status: form.status || null,
                            passenger_type: form.passenger_type || null,
                          });
                          if (res.agentPrice == null) return toast.error(res.reason || "لا يوجد سعر مطابق");
                          const cur = res.rule?.currency || "EGP";
                          setServices((arr) => arr.map((x, k) => k === i ? { ...x, agent_price: res.agentPrice as number, currency: cur } : x));
                          toast.success(`تم جلب السعر: ${(res.agentPrice as number).toFixed(2)} (${cur})`);

                        }}
                        style={{ padding: "4px 8px", fontSize: 11 }}
                      >🔄</button>
                    </div>
                  </Field>
                  <Field label="الإجمالي"><input value={`${total.toLocaleString("ar")} ${currencyShortLabel((s as any).currency || "EGP")}`} readOnly style={{ ...inputStyle, background: "#f1f5f9", fontWeight: 700 }} /></Field>
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

      {canViewNetProfit && (
      <div style={{ marginTop: 16, display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(180px,1fr))" }}>
        <div style={{ padding: 12, borderRadius: 10, background: "#eef2ff", border: "1px solid #c7d2fe" }}>
          <div style={{ fontSize: 11, color: "#475569", fontWeight: 700 }}>
            {companyCurrency ? "إجمالي تكاليف الشركات الصادرة" : "إجمالي تكاليف الشركة حسب العملة"}
          </div>
          {companyCurrency ? (
            <div style={{ fontSize: 18, fontWeight: 800, color: "#1e3a8a", marginTop: 4 }}>
              {companyTotal.toLocaleString("ar")} {currencyShortLabel(companyCurrency)}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
              {sortCurrencies(Object.keys(companyTotalByCurrency)).map((cur) => (
                <div key={cur} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, fontWeight: 800, color: "#1e3a8a" }}>
                  <span style={{ color: "#475569", fontWeight: 700 }}>{currencyShortLabel(cur)}</span>
                  <span>{(companyTotalByCurrency[cur] || 0).toLocaleString("ar")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div style={{ padding: 12, borderRadius: 10, background: "#ecfdf5", border: "1px solid #a7f3d0" }}>
          <div style={{ fontSize: 11, color: "#475569", fontWeight: 700 }}>
            {agentCurrency ? "إجمالي بيع الوكيل" : "إجمالي بيع الوكيل حسب العملة"}
          </div>
          {agentCurrency ? (
            <div style={{ fontSize: 18, fontWeight: 800, color: "#047857", marginTop: 4 }}>
              {agentTotal.toLocaleString("ar")} {currencyShortLabel(agentCurrency)}
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
              {sortCurrencies(Object.keys(agentTotalByCurrency)).map((cur) => (
                <div key={cur} style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 13, fontWeight: 800, color: "#047857" }}>
                  <span style={{ color: "#475569", fontWeight: 700 }}>{currencyShortLabel(cur)}</span>
                  <span>{(agentTotalByCurrency[cur] || 0).toLocaleString("ar")}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        {(() => {
          const pending = profitPreview.status !== "locked" || profitPreview.profitEGP === null;
          const val = Number(profitPreview.profitEGP || 0);
          const bg = pending ? "#f8fafc" : (val >= 0 ? "#fffbeb" : "#fef2f2");
          const border = pending ? "#e2e8f0" : (val >= 0 ? "#fde68a" : "#fecaca");
          return (
            <div style={{ padding: 12, borderRadius: 10, background: bg, border: `1px solid ${border}` }}>
              <div style={{ fontSize: 11, color: "#475569", fontWeight: 700 }}>صافي الربح (بالجنيه)</div>
              {pending ? (
                <div style={{ fontSize: 12, color: "#b45309", fontWeight: 700, marginTop: 6, lineHeight: 1.5 }}>
                  {profitPreview.reason || "لا يمكن حساب الربح حالياً."}
                </div>
              ) : (
                <div style={{ fontSize: 18, fontWeight: 800, color: val >= 0 ? "#b45309" : "#b91c1c", marginTop: 4 }}>
                  {val.toLocaleString("ar")} ج.م
                </div>
              )}
            </div>
          );
        })()}
      </div>
      )}


      <div style={{ marginTop: 16, padding: 12, borderRadius: 10, background: form.operation_status === "منفذ" ? "#ecfdf5" : "#f8fafc", border: `1px solid ${form.operation_status === "منفذ" ? "#a7f3d0" : "#e2e8f0"}`, fontSize: 12, color: "#475569" }}>
        <CheckCircle2 size={14} style={{ verticalAlign: "middle", marginInlineEnd: 6 }} />
        {form.operation_status === "منفذ"
          ? "عند الحفظ بحالة العملية «منفذ» سيتم إنشاء الحركات المالية على حساب الوكيل والشركة."
          : "الحركات المالية تُنشأ فقط عند حالة العملية «منفذ». حالة الموافقة لا تؤثر ماليًا."}
      </div>


      <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
        <button className="btn" onClick={onDone} disabled={saving}>إلغاء</button>
        <button data-confirm-save={editing?.id ? "تأكيد حفظ تعديل التنفيذ" : "تأكيد حفظ التنفيذ"} onClick={() => save()} disabled={saving} style={{ height: 38, padding: "0 18px", borderRadius: 10, background: "linear-gradient(135deg, #d4af37, #e0b65c)", color: "#0f1b3d", border: 0, fontWeight: 800, fontSize: 13, cursor: saving ? "not-allowed" : "pointer", boxShadow: "0 6px 16px #d4af374d", opacity: saving ? 0.7 : 1 }}>{saving ? "جارٍ الحفظ..." : "حفظ"}</button>
      </div>

      <Modal
        open={!!dupWarning}
        onClose={() => setDupWarning(null)}
        title="تنبيه: تنفيذ مكرر لنفس رقم الجواز"
        maxWidth={560}
        zIndex={100001}
        footer={
          <>
            <button className="btn" onClick={() => setDupWarning(null)}>إلغاء الحفظ</button>
            <button
              className="btn"
              style={{ background: "#b45309", color: "#fff", border: 0, fontWeight: 800 }}
              onClick={() => { setDupWarning(null); void save(true); }}
            >
              تأكيد الحفظ على أي حال
            </button>
          </>
        }
      >
        <div style={{ fontSize: 13, color: "#334155", lineHeight: 1.9 }}>
          <div style={{ padding: 10, borderRadius: 8, background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e", marginBottom: 12, fontWeight: 700 }}>
            هذا المسافر تم تسجيل تنفيذ له من قبل بنفس رقم الجواز.
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 10, maxHeight: 320, overflowY: "auto" }}>
            {dupWarning?.matches.map((m: any) => {
              const svcNames = Array.isArray(m.services)
                ? m.services.map((s: any) => s?.service_type).filter(Boolean).join("، ")
                : "";
              return (
                <div key={m.id} style={{ padding: 10, borderRadius: 8, border: "1px solid #e2e8f0", background: "#f8fafc" }}>
                  <div><b>الاسم:</b> {m.passenger_name || "—"}</div>
                  <div><b>رقم الجواز:</b> {m.passport || "—"}</div>
                  <div><b>الرقم القومي:</b> {m.national_id || "—"}</div>
                  <div><b>حالة العملية:</b> {m.operation_status || "—"}</div>
                  <div><b>تاريخ التنفيذ:</b> {toDisplayDate(m.created_at) || "—"}</div>
                  <div><b>تاريخ السفر:</b> {toDisplayDate(m.travel_date) || "—"}</div>
                  {svcNames && <div><b>الخدمة:</b> {svcNames}</div>}
                  <div style={{ color: "#64748b", fontSize: 11 }}>رقم العملية: {m.id}</div>
                </div>
              );
            })}
          </div>
        </div>
      </Modal>
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

function paxAgeBg(dob: string | null | undefined, execDate: string | null | undefined): string | null {
  if (!dob || !execDate) return null;
  const b = new Date(dob);
  const e = new Date(execDate);
  if (isNaN(b.getTime()) || isNaN(e.getTime())) return null;
  let years = e.getFullYear() - b.getFullYear();
  const m = e.getMonth() - b.getMonth();
  if (m < 0 || (m === 0 && e.getDate() < b.getDate())) years--;
  if (years < 2) return "#dcfce7";
  if (years < 8) return "#fef9c3";
  return null;
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
