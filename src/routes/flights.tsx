import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Modal } from "@/components/Modal";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { badgeFor, fmtNum, useLive, useDropdownOptions, useAgentPricingMap, withSelected, buildTravelStatement, applyOptimistic, type Agent, type Flight, type IssuingCompany } from "@/lib/db";

import { postServiceFinancials, updateServiceFinancials } from "@/lib/servicePosting";
import { usePerm } from "@/hooks/usePerm";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagination } from "@/hooks/usePagination";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { SafeSelectOptions } from "@/components/SafeSelectOptions";

export const Route = createFileRoute("/flights")({
  component: () => <AppErrorBoundary><FlightsPage /></AppErrorBoundary>,
  errorComponent: () => <SafePageError />,
});

const STATUSES = ["سريعة", "بطيئة", "رفض أمني"];

function SafePageError() {
  return <div className="card" style={{ padding: 24 }}>تعذر تحميل الرحلات مؤقتًا. <button className="btn btn-gold" onClick={() => window.location.reload()}>إعادة المحاولة</button></div>;
}

function FlightsPage() {
  const perm = usePerm("flights");
  const { rows: flights } = useLive<Flight>("flights");
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const AIRLINES = useDropdownOptions("airline");
  const DESTINATIONS = useDropdownOptions("destination");
  const [tab, setTab] = useState<"list" | "add">(() => {
    if (typeof window === "undefined") return "list";
    return new URLSearchParams(window.location.search).get("tab") === "add" && perm.create ? "add" : "list";
  });
  const [search, setSearch] = useState("");
  const [airline, setAirline] = useState("");
  const [destination, setDestination] = useState("");
  const [status, setStatus] = useState("");
  const [issuingCompany, setIssuingCompany] = useState("");
  const [editing, setEditing] = useState<Flight | null>(null);

  const agentName = (id: string | null) => agents.find((a) => a.id === id)?.name || "—";

  const debouncedSearch = useDebouncedValue(search, 250);

  const filtered = useMemo(() => {
    return flights.filter((f) => {
      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const aName = (agents.find((a) => a.id === f.agent_id)?.name || "").toLowerCase();
        const hay = `${f.passenger_name} ${f.passport || ""} ${f.national_id || ""} ${aName}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (airline && f.airline !== airline) return false;
      if (destination && f.destination !== destination) return false;
      if (status && f.status !== status) return false;
      if (issuingCompany && f.issuing_company !== issuingCompany) return false;
      return true;
    });
  }, [flights, agents, debouncedSearch, airline, destination, status, issuingCompany]);

  const { pageRows, Controls, page, pageSize } = usePagination(filtered, 50);

  const NAVY = "#0f1b3d", GOLD = "#d4af37";
  const today = new Date().toISOString().slice(0, 10);
  const totalPassengers = flights.length;
  const fastApprovals = flights.filter((f) => f.status === "سريعة").length;
  const slowApprovals = flights.filter((f) => f.status === "بطيئة").length;
  const rejected = flights.filter((f) => f.status === "رفض أمني").length;
  const upcoming = flights.filter((f) => f.travel_date && f.travel_date > today).length;
  const todayCount = flights.filter((f) => f.travel_date === today).length;
  const totalFlights = new Set(flights.map((f) => `${f.airline || ""}|${f.destination || ""}|${f.travel_date || ""}`).filter((k) => k !== "||")).size;

  const clearFilters = () => { setSearch(""); setAirline(""); setDestination(""); setStatus(""); setIssuingCompany(""); };
  const activeFilterCount = [search, airline, destination, status, issuingCompany].filter(Boolean).length;

  const statusStyle = (s: string): React.CSSProperties => {
    const k = s || "";
    if (k === "سريعة") return { background: "#ecfdf5", color: "#047857", border: "1px solid #a7f3d0" };
    if (k === "رفض أمني") return { background: "#fef2f2", color: "#b91c1c", border: "1px solid #fecaca" };
    if (k === "بطيئة") return { background: "#fffbeb", color: "#b45309", border: "1px solid #fde68a" };
    return { background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" };
  };

  const Kpi = ({ icon, label, value, tone }: { icon: string; label: string; value: number | string; tone: "navy" | "indigo" | "emerald" | "rose" | "amber" | "sky" }) => {
    const tones: Record<string, { bg: string; fg: string; bd: string }> = {
      navy:    { bg: "#eef2ff", fg: NAVY,      bd: "#dbe3ee" },
      indigo:  { bg: "#eef2ff", fg: "#4338ca", bd: "#c7d2fe" },
      emerald: { bg: "#ecfdf5", fg: "#047857", bd: "#a7f3d0" },
      rose:    { bg: "#fef2f2", fg: "#b91c1c", bd: "#fecaca" },
      amber:   { bg: "#fffbeb", fg: "#b45309", bd: "#fde68a" },
      sky:     { bg: "#f0f9ff", fg: "#0369a1", bd: "#bae6fd" },
    };
    const t = tones[tone];
    return (
      <div className="fl-card" style={{ minHeight: 84, padding: 14, borderRadius: 12, background: "#fff", border: "1px solid #eef2f7", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>
        <div style={{ width: 42, height: 42, borderRadius: 10, background: t.bg, color: t.fg, border: `1px solid ${t.bd}`, display: "grid", placeItems: "center", fontSize: 20, flexShrink: 0 }}>{icon}</div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 11, color: "#64748b", fontWeight: 700, marginBottom: 3 }}>{label}</div>
          <div style={{ fontSize: 18, color: "#0f172a", fontWeight: 800, lineHeight: 1.1 }}>{typeof value === "number" ? value.toLocaleString("ar") : value}</div>
        </div>
      </div>
    );
  };

  const inputStyle: React.CSSProperties = {
    height: 38, padding: "0 12px", borderRadius: 10, border: "1px solid #e2e8f0",
    background: "#fff", fontSize: 13, color: "#0f172a", outline: "none", minWidth: 0,
  };

  return (
    <div className="section active" style={{ display: "grid", gap: 14 }}>
      <style>{`
        .fl-card{transition:transform .2s ease, box-shadow .25s ease, border-color .2s ease;}
        .fl-card:hover{transform:translateY(-2px); box-shadow:0 6px 20px rgba(15,23,42,.07); border-color:#dbe3ee;}
        .fl-row{transition:background .15s ease;}
        .fl-row:hover{background:#f8fafc !important;}
        .fl-tab{transition:all .2s ease;}
        .fl-tab:hover{color:#0f1b3d;}
        .fl-btn{transition:transform .15s ease, box-shadow .2s ease, background .2s ease;}
        .fl-btn:hover:not(:disabled){transform:translateY(-1px);}
        .fl-icon-btn{transition:all .15s ease;}
        .fl-icon-btn:hover:not(:disabled){transform:translateY(-1px); background:#f1f5f9;}
        .fl-input:focus{border-color:#1d4ed8 !important; box-shadow:0 0 0 3px rgba(29,78,216,.12) !important;}
        @media (max-width: 700px){
          .fl-toolbar{grid-template-columns:1fr 1fr !important;}
          .fl-search{grid-column:1 / -1 !important;}
        }
      `}</style>

      {/* ===== Header ===== */}
      <div style={{
        padding: "16px 20px", borderRadius: 14, border: "1px solid #1e3a8a44",
        background: `linear-gradient(135deg, ${NAVY} 0%, #1e3a8a 60%, #1e40af 100%)`,
        boxShadow: `0 10px 30px ${NAVY}2e`, color: "#fff", overflow: "hidden", position: "relative",
      }}>
        <div aria-hidden style={{ position: "absolute", top: -40, left: -40, width: 200, height: 200, borderRadius: "50%", background: `radial-gradient(circle, ${GOLD}30, transparent 65%)` }} />
        <div style={{ position: "relative", display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
          <div style={{ minWidth: 0, flex: "1 1 320px" }}>
            <nav aria-label="breadcrumb" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11.5, color: "#cbd5e1", marginBottom: 8, flexWrap: "wrap" }}>
              <span>العمليات</span>
              <span style={{ opacity: .6 }}>›</span>
              <span>الرحلات</span>
              <span style={{ opacity: .6 }}>›</span>
              <span style={{ color: GOLD, fontWeight: 700 }}>قائمة الرحلات</span>
            </nav>
            <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
              <div style={{ width: 42, height: 42, borderRadius: 11, background: `linear-gradient(135deg, ${GOLD}, #e0b65c)`, color: NAVY, display: "grid", placeItems: "center", flexShrink: 0, boxShadow: `0 6px 16px ${GOLD}55`, fontSize: 22 }}>✈️</div>
              <div style={{ minWidth: 0 }}>
                <h1 style={{ margin: 0, fontSize: 18, fontWeight: 900, letterSpacing: "-0.01em", lineHeight: 1.2 }}>قائمة الرحلات</h1>
                <p style={{ margin: "2px 0 0", fontSize: 12, color: "#cbd5e1", lineHeight: 1.4 }}>إدارة ومتابعة الرحلات والموافقات الأمنية للمسافرين</p>
              </div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            <button className="fl-btn" onClick={() => setTab("list")} style={{
              display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 14px", borderRadius: 10,
              background: "rgba(255,255,255,.08)", color: "#fff", border: "1px solid rgba(255,255,255,.22)",
              fontWeight: 700, fontSize: 12.5, cursor: "pointer", backdropFilter: "blur(6px)",
            }}>📋 القائمة الكاملة</button>
            {perm.create && (
              <button className="fl-btn" onClick={() => setTab("add")} style={{
                display: "inline-flex", alignItems: "center", gap: 6, height: 38, padding: "0 16px", borderRadius: 10,
                background: `linear-gradient(135deg, ${GOLD}, #e0b65c)`, color: NAVY, border: 0,
                fontWeight: 800, fontSize: 12.5, cursor: "pointer", boxShadow: `0 6px 16px ${GOLD}4d`,
              }}>＋ إضافة رحلة</button>
            )}
          </div>
        </div>
      </div>

      {/* ===== KPI Cards ===== */}
      <div style={{ display: "grid", gap: 10, gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))" }}>
        <Kpi icon="✈️" label="إجمالي الرحلات" value={totalFlights} tone="navy" />
        <Kpi icon="👥" label="عدد المسافرين" value={totalPassengers} tone="indigo" />
        <Kpi icon="✅" label="الموافقات السريعة" value={fastApprovals} tone="emerald" />
        <Kpi icon="⛔" label="الموافقات المرفوضة" value={rejected} tone="rose" />
        <Kpi icon="🛫" label="الرحلات القادمة" value={upcoming} tone="sky" />
        <Kpi icon="📅" label="الرحلات اليوم" value={todayCount} tone="amber" />
      </div>

      {tab === "list" ? (
        <>
          {/* ===== Filters Toolbar ===== */}
          <div style={{ padding: 14, borderRadius: 12, border: "1px solid #eef2f7", background: "#fff", boxShadow: "0 1px 2px rgba(15,23,42,.04)" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 13, fontWeight: 800, color: "#0f172a" }}>🔎 الفلاتر</span>
                {activeFilterCount > 0 && (
                  <span style={{ fontSize: 11, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: "#eff6ff", color: "#1d4ed8", border: "1px solid #bfdbfe" }}>
                    {activeFilterCount} نشط
                  </span>
                )}
              </div>
              {activeFilterCount > 0 && (
                <button onClick={clearFilters} className="fl-btn" style={{ height: 30, padding: "0 10px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: "#64748b", fontSize: 11.5, fontWeight: 700, cursor: "pointer" }}>
                  ✕ مسح الفلاتر
                </button>
              )}
            </div>
            <div className="fl-toolbar" style={{ display: "grid", gap: 8, gridTemplateColumns: "2fr 1fr 1fr 1fr 1fr" }}>
              <div className="fl-search" style={{ position: "relative", minWidth: 0 }}>
                <span style={{ position: "absolute", insetInlineStart: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8", fontSize: 14 }}>🔍</span>
                <input
                  className="fl-input"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="ابحث بالاسم، الجواز، الرقم القومي، أو الوكيل..."
                  style={{ ...inputStyle, width: "100%", paddingInlineStart: 34, paddingInlineEnd: search ? 32 : 12 }}
                />
                {search && (
                  <button onClick={() => setSearch("")} aria-label="مسح" style={{ position: "absolute", insetInlineEnd: 8, top: "50%", transform: "translateY(-50%)", width: 22, height: 22, borderRadius: 6, border: 0, background: "#f1f5f9", color: "#64748b", cursor: "pointer", display: "grid", placeItems: "center", fontSize: 12 }}>✕</button>
                )}
              </div>
              <select className="fl-input" value={airline} onChange={(e) => setAirline(e.target.value)} style={inputStyle}>
                <option value="">جميع شركات الطيران</option>
                <SafeSelectOptions options={AIRLINES} />
              </select>
              <select className="fl-input" value={destination} onChange={(e) => setDestination(e.target.value)} style={inputStyle}>
                <option value="">جميع الوجهات</option>
                <SafeSelectOptions options={DESTINATIONS} />
              </select>
              <select className="fl-input" value={status} onChange={(e) => setStatus(e.target.value)} style={inputStyle}>
                <option value="">جميع الحالات</option>
                {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
              <select className="fl-input" value={issuingCompany} onChange={(e) => setIssuingCompany(e.target.value)} style={inputStyle}>
                <option value="">جميع الشركات الصادرة</option>
                {companies.map((c) => <option key={c.id} value={c.company_name}>{c.company_name}</option>)}
              </select>
            </div>
          </div>

          {/* ===== Table Card ===== */}
          <div className="fl-card" style={{ borderRadius: 12, border: "1px solid #eef2f7", background: "#fff", boxShadow: "0 1px 2px rgba(15,23,42,.04)", overflow: "hidden" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, padding: "14px 16px", borderBottom: "1px solid #eef2f7" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 9, background: `${NAVY}10`, color: NAVY, display: "grid", placeItems: "center", fontSize: 16 }}>✈️</div>
                <div>
                  <h4 style={{ margin: 0, fontSize: 14, fontWeight: 800, color: "#0f172a" }}>قائمة المسافرين</h4>
                  <div style={{ fontSize: 11, color: "#94a3b8" }}>عرض ومتابعة جميع المسافرين والموافقات الأمنية</div>
                </div>
              </div>
              <span style={{ fontSize: 11, fontWeight: 700, color: NAVY, background: `${GOLD}22`, border: `1px solid ${GOLD}66`, padding: "3px 10px", borderRadius: 999 }}>
                {filtered.length.toLocaleString("ar")} مسافر
              </span>
            </div>

            {filtered.length === 0 ? (
              <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding: "48px 20px", color: "#64748b", background: "linear-gradient(180deg,#fafbfd,#fff)" }}>
                <div style={{ width: 80, height: 80, borderRadius: "50%", background: `${NAVY}08`, display: "grid", placeItems: "center", marginBottom: 14, fontSize: 36 }}>✈️</div>
                <div style={{ fontSize: 15, fontWeight: 800, color: "#0f172a" }}>لا توجد رحلات حالياً</div>
                <div style={{ fontSize: 12.5, color: "#94a3b8", marginTop: 6, textAlign: "center", maxWidth: 360 }}>
                  {activeFilterCount > 0 ? "لا توجد نتائج مطابقة للفلاتر الحالية. جرّب تعديل أو مسح الفلاتر." : "ابدأ بإضافة أول رحلة لمتابعة المسافرين والموافقات الأمنية."}
                </div>
                {perm.create && activeFilterCount === 0 && (
                  <button className="fl-btn" onClick={() => setTab("add")} style={{ marginTop: 14, display: "inline-flex", alignItems: "center", gap: 6, padding: "10px 18px", borderRadius: 10, background: `linear-gradient(135deg, ${NAVY}, #1e3a8a)`, color: GOLD, border: 0, fontWeight: 800, fontSize: 13, cursor: "pointer" }}>
                    ＋ إضافة أول رحلة
                  </button>
                )}
              </div>
            ) : (
              <div style={{ overflowX: "auto" }}>
                <table className="mobile-cards" style={{ width: "100%", borderCollapse: "collapse", minWidth: 1100, fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: "linear-gradient(180deg,#f8fafc,#f1f5f9)", position: "sticky", top: 0, zIndex: 1 }}>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>#</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>الاسم</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>الرقم القومي</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>تاريخ الميلاد</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>رقم الجواز</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>الوكيل</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>شركة الطيران</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>الشركة الصادرة</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>الوجهة</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>تاريخ السفر</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>بيان السفر</th>
                      <th style={{ padding: "10px 12px", textAlign: "right", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>الحالة</th>
                      <th style={{ padding: "10px 12px", textAlign: "left", fontSize: 11.5, fontWeight: 800, color: "#475569", borderBottom: "1px solid #e2e8f0", whiteSpace: "nowrap" }}>إجراءات</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((f, i) => {
                      const idx = page * pageSize + i;
                      return (
                      <tr key={f.id} className="fl-row" style={{ background: idx % 2 ? "#fafbfd" : "#fff", borderBottom: "1px solid #f1f5f9" }}>
                        <td data-label="#" style={{ padding: "10px 12px", fontSize: 12, color: "#94a3b8", fontWeight: 700 }}>{idx + 1}</td>
                        <td data-label="الاسم" style={{ padding: "10px 12px", fontWeight: 700, color: "#0f172a" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ width: 28, height: 28, borderRadius: "50%", background: `linear-gradient(135deg, ${NAVY}, #1e3a8a)`, color: "#fff", display: "grid", placeItems: "center", fontSize: 11, fontWeight: 800, flexShrink: 0 }}>
                              {(f.passenger_name || "?").trim().charAt(0)}
                            </div>
                            <span>{f.passenger_name}</span>
                          </div>
                        </td>
                        <td data-label="الرقم القومي" style={{ padding: "10px 12px", color: "#475569", fontFamily: "ui-monospace,monospace", fontSize: 12 }}>{f.national_id || "—"}</td>
                        <td data-label="تاريخ الميلاد" style={{ padding: "10px 12px", color: "#64748b", fontSize: 12 }}>{f.dob || "—"}</td>
                        <td data-label="رقم الجواز" style={{ padding: "10px 12px", color: "#475569", fontFamily: "ui-monospace,monospace", fontSize: 12 }}>{f.passport || "—"}</td>
                        <td data-label="الوكيل" style={{ padding: "10px 12px", color: "#0f172a", fontWeight: 600 }}>{agentName(f.agent_id)}</td>
                        <td data-label="شركة الطيران" style={{ padding: "10px 12px", color: "#475569" }}>{f.airline || "—"}</td>
                        <td data-label="الشركة الصادرة" style={{ padding: "10px 12px", color: "#475569" }}>{f.issuing_company || "—"}</td>
                        <td data-label="الوجهة" style={{ padding: "10px 12px", color: "#475569" }}>{f.destination ? <span>📍 {f.destination}</span> : "—"}</td>
                        <td data-label="تاريخ السفر" style={{ padding: "10px 12px", color: "#475569", whiteSpace: "nowrap", fontSize: 12 }}>{f.travel_date || "—"}</td>
                        <td data-label="بيان السفر" style={{ padding: "10px 12px", color: "#64748b", fontSize: 12, maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={f.travel_statement || buildTravelStatement(f.destination, f.travel_date, f.airline) || ""}>
                          {f.travel_statement || buildTravelStatement(f.destination, f.travel_date, f.airline) || "—"}
                        </td>
                        <td data-label="الحالة" style={{ padding: "10px 12px" }}>
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4, padding: "3px 10px", borderRadius: 999, fontSize: 11, fontWeight: 700, ...statusStyle(f.status) }}>
                            {f.status || "—"}
                          </span>
                        </td>
                        <td data-label="إجراءات" style={{ padding: "10px 12px" }}>
                          {perm.edit ? (
                            <button className="fl-icon-btn" onClick={() => setEditing(f)} style={{ display: "inline-flex", alignItems: "center", gap: 5, height: 30, padding: "0 10px", borderRadius: 8, border: "1px solid #e2e8f0", background: "#fff", color: NAVY, fontSize: 12, fontWeight: 700, cursor: "pointer" }}>
                              ✏️ تعديل
                            </button>
                          ) : "—"}
                        </td>
                      </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr style={{ background: "#f8fafc" }}>
                      <td colSpan={12} style={{ padding: "10px 12px", textAlign: "right", fontSize: 12, fontWeight: 700, color: "#475569" }}>إجمالي المسافرين:</td>
                      <td style={{ padding: "10px 12px", fontSize: 13, fontWeight: 800, color: NAVY }}>{filtered.length.toLocaleString("ar")}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        perm.create ? <FlightForm agents={agents} companies={companies} onDone={() => setTab("list")} /> : null
      )}
      {editing && perm.edit && (
        <EditFlightModal
          flight={editing}
          agents={agents}
          companies={companies}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}

export function FlightForm({ agents, companies, onDone }: { agents: Agent[]; companies: IssuingCompany[]; onDone: () => void }) {
  const [form, setForm] = useState({
    passenger_name: "", national_id: "", passport: "", dob: "", airline: "",
    destination: "", travel_date: "", agent_id: "", status: "", notes: "", issuing_company: "",
    count: "1", price: "", company_value: "",
  });
  const [linkApproval, setLinkApproval] = useState(false);
  const [linkInvestment, setLinkInvestment] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const AIRLINES = withSelected(useDropdownOptions("airline"), form.airline);
  const DESTINATIONS = withSelected(useDropdownOptions("destination"), form.destination);
  const travelStatement = buildTravelStatement(form.destination, form.travel_date, form.airline);
  const tripValue = Number(form.count || 0) * Number(form.price || 0);

  const pricingMap = useAgentPricingMap(form.agent_id || null);
  const pricing = pricingMap["تذاكر طيران"];
  const [pricingTouched, setPricingTouched] = useState(false);
  useEffect(() => {
    if (!form.agent_id) return;
    if (pricing) {
      setForm((p) => ({
        ...p,
        price: String(pricing.agent_price ?? ""),
        company_value: String(pricing.company_price ?? ""),
      }));
      setPricingTouched(false);
    }
  }, [form.agent_id, pricing?.id]);

  const save = async () => {
    if (!form.passenger_name.trim()) return toast.error("اسم المسافر مطلوب");
    if (!form.airline || !form.destination || !form.agent_id || !form.status) return toast.error("برجاء اختيار قيمة من القائمة");
    if (!form.issuing_company) return toast.error("برجاء اختيار الشركة الصادرة");
    const companyId = companies.find((c) => c.company_name === form.issuing_company)?.id || null;
    const payload = {
      ...form,
      dob: form.dob || null,
      travel_date: form.travel_date || null,
      agent_id: form.agent_id || null,
      national_id: form.national_id || null,
      passport: form.passport || null,
      destination: form.destination || null,
      notes: form.notes || null,
      travel_statement: travelStatement || null,
      issuing_company: form.issuing_company || null,
      count: Math.max(1, Math.round(Number(form.count) || 1)),
      price: Number(form.price) || 0,
      company_value: Number(form.company_value) || 0,
      company_price: Number(form.company_value) || 0,
      agent_price: Number(form.price) || 0,
      company_percentage: (Number(form.price) || 0) > 0 ? Math.round(((Number(form.price) - Number(form.company_value)) / Number(form.price)) * 10000) / 100 : 0,
      company_profit_value: Math.round(((Number(form.price) || 0) - (Number(form.company_value) || 0)) * 100) / 100,
    };
    try {
      const { data: inserted, error } = await supabase.from("flights").insert(payload).select("id").single();
      if (error) return toast.error(error.message);
      const linkedShared = {
        passenger_name: payload.passenger_name,
        national_id: payload.national_id,
        passport: payload.passport,
        dob: payload.dob,
        destination: payload.destination,
        agent_id: payload.agent_id,
        notes: payload.notes,
        travel_date: payload.travel_date,
        airline: payload.airline,
        authority: null as string | null,
        issuing_company: payload.issuing_company,
        issuing_company_id: companyId,
        travel_statement: payload.travel_statement,
      };
      if (linkApproval) {
        const { error: e1 } = await supabase.from("approvals").insert({ ...linkedShared, status: "سريعة", service_type: "security_approval" });
        if (e1) toast.warning("تعذر إنشاء الموافقة المرتبطة: " + e1.message);
      }
      if (linkInvestment) {
        const { error: e2 } = await supabase.from("approvals").insert({ ...linkedShared, status: "سريعة", service_type: "libyan_investment" });
        if (e2) toast.warning("تعذر إنشاء الاستثمار المرتبط: " + e2.message);
      }
      if (inserted?.id) {
        try {
          await postServiceFinancials({
            serviceId: inserted.id,
            serviceKind: "flight_ticket",
            agentId: payload.agent_id,
            companyId,
            date: payload.travel_date,
            destination: payload.destination,
            travelStatement: payload.travel_statement,
            passengerName: payload.passenger_name,
            count: payload.count,
            price: payload.price,
            companyValue: payload.company_value,
          });
        } catch (postErr: any) {
          toast.warning(postErr?.message || "تم حفظ الرحلة لكن تعذر إنشاء حركة مالية");
        }
      }
      onDone();
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ الرحلة");
    }
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">➕ إضافة مسافر جديد</div></div>
      <div style={{ padding: "12px 16px", margin: "0 0 8px", background: "#f8fafc", border: "1px solid var(--border)", borderRadius: 10 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "#0f1b3d", marginBottom: 8 }}>خدمات مرتبطة</div>
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={linkApproval} onChange={(e) => setLinkApproval(e.target.checked)} /> موافقة أمنية
          </label>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, cursor: "pointer" }}>
            <input type="checkbox" checked={linkInvestment} onChange={(e) => setLinkInvestment(e.target.checked)} /> استثمار ليبي
          </label>
        </div>
      </div>
      <div className="form-grid">
        <div className="form-group"><label>اسم المسافر</label><input value={form.passenger_name} onChange={(e) => set("passenger_name", e.target.value)} placeholder="الاسم الكامل" /></div>
        <div className="form-group"><label>الرقم القومي</label><input value={form.national_id} onChange={(e) => set("national_id", e.target.value)} placeholder="الرقم القومي" /></div>
        <div className="form-group"><label>رقم الجواز</label><input value={form.passport} onChange={(e) => set("passport", e.target.value)} /></div>
        <div className="form-group"><label>تاريخ الميلاد</label><input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} /></div>
        <div className="form-group"><label>شركة الطيران</label>
          <select value={form.airline} onChange={(e) => set("airline", e.target.value)}>
            <option value="" disabled>اختر...</option>
            <SafeSelectOptions options={AIRLINES} />
          </select>
        </div>
        <div className="form-group"><label>الوجهة</label>
          <select value={form.destination} onChange={(e) => set("destination", e.target.value)}>
            <option value="" disabled>اختر...</option>
            <SafeSelectOptions options={DESTINATIONS} />
          </select>
        </div>
        <div className="form-group"><label>تاريخ السفر</label><input type="date" value={form.travel_date} onChange={(e) => set("travel_date", e.target.value)} /></div>
        <div className="form-group"><label>الوكيل</label>
          <select value={form.agent_id} onChange={(e) => set("agent_id", e.target.value)}>
            <option value="" disabled>اختر...</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>حالة الموافقة الأمنية</label>
          <select value={form.status} onChange={(e) => set("status", e.target.value)}>
            <option value="" disabled>اختر...</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group"><label>الشركة الصادرة</label>
          <select value={form.issuing_company} onChange={(e) => set("issuing_company", e.target.value)}>
            <option value="" disabled>اختر...</option>
            {companies.map((c) => <option key={c.id} value={c.company_name}>{c.company_name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>العدد</label><input type="number" min={1} value={form.count} onChange={(e) => set("count", e.target.value)} /></div>
        <div className="form-group"><label>السعر (للوكيل)</label><input type="number" min={0} placeholder="0" value={form.price} onChange={(e) => { set("price", e.target.value); setPricingTouched(true); }} /></div>
        <div className="form-group"><label>قيمة الرحلة (تلقائي)</label><input value={fmtNum(tripValue)} disabled readOnly /></div>
        <div className="form-group"><label>قيمة الشركة الصادرة</label><input type="number" min={0} placeholder="0" value={form.company_value} onChange={(e) => { set("company_value", e.target.value); setPricingTouched(true); }} /></div>
        {form.agent_id && pricing && (
          <div className="form-group full" style={{ fontSize: 12, color: "#0f766e", background: "#ecfdf5", border: "1px solid #a7f3d0", borderRadius: 8, padding: 8 }}>
            تم جلب السعر من تسعير الوكيل ويمكن تعديله لهذه الخدمة فقط{pricingTouched ? " (تم التعديل)" : ""}
          </div>
        )}
        {form.agent_id && !pricing && (
          <div className="form-group full" style={{ fontSize: 12, color: "#92400e", background: "#fffbeb", border: "1px solid #fde68a", borderRadius: 8, padding: 8 }}>
            لا يوجد تسعير محفوظ لهذه الخدمة لهذا الوكيل
          </div>
        )}
        <div className="form-group full"><label>بيان السفر (تلقائي)</label><input value={travelStatement} disabled readOnly /></div>
        <div className="form-group full"><label>ملاحظات</label><textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      </div>
      <div className="form-footer">
        <button className="btn btn-gold" onClick={save}>💾 حفظ الرحلة</button>
      </div>
    </div>
  );
}


function EditFlightModal({ flight, agents, companies, onClose }: { flight: Flight; agents: Agent[]; companies: IssuingCompany[]; onClose: () => void }) {
  const [form, setForm] = useState({
    passenger_name: flight.passenger_name || "",
    national_id: flight.national_id || "",
    passport: flight.passport || "",
    dob: flight.dob || "",
    airline: flight.airline || "",
    destination: flight.destination || "",
    travel_date: flight.travel_date || "",
    agent_id: flight.agent_id || "",
    status: flight.status || "",
    notes: flight.notes || "",
    issuing_company: flight.issuing_company || "",
    count: String(flight.count ?? 1),
    price: String(flight.price ?? ""),
    company_value: String(flight.company_value ?? ""),
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  // Lock body scroll while modal is open
  useEffect(() => {
    const prevOverflow = document.body.style.overflow;
    const prevPaddingRight = document.body.style.paddingRight;
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = "hidden";
    if (scrollbarWidth > 0) document.body.style.paddingRight = `${scrollbarWidth}px`;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prevOverflow;
      document.body.style.paddingRight = prevPaddingRight;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const AIRLINES = withSelected(useDropdownOptions("airline"), form.airline);
  const DESTINATIONS = withSelected(useDropdownOptions("destination"), form.destination);
  const travelStatement = buildTravelStatement(form.destination, form.travel_date, form.airline);

  const save = async () => {
    if (!form.passenger_name.trim()) return toast.error("اسم المسافر مطلوب");
    setSaving(true);
    const companyId = companies.find((c) => c.company_name === form.issuing_company)?.id || null;
    const payload = {
      passenger_name: form.passenger_name,
      national_id: form.national_id || null,
      passport: form.passport || null,
      dob: form.dob || null,
      airline: form.airline || null,
      destination: form.destination || null,
      travel_date: form.travel_date || null,
      agent_id: form.agent_id || null,
      status: form.status,
      notes: form.notes || null,
      issuing_company: form.issuing_company || null,
      travel_statement: travelStatement || null,
      count: Math.max(1, Math.round(Number(form.count) || 1)),
      price: Number(form.price) || 0,
      company_value: Number(form.company_value) || 0,
    };
    try {
      const r = await applyOptimistic({
        table: "flights", type: "update", id: flight.id, patch: payload,
        run: async () => await supabase.from("flights").update(payload).eq("id", flight.id),
      });
      if (!r.ok) { setSaving(false); return; }
      try {
        await updateServiceFinancials({
          serviceId: flight.id,
          serviceKind: "flight_ticket",
          agentId: payload.agent_id,
          companyId,
          date: payload.travel_date,
          destination: payload.destination,
          travelStatement: payload.travel_statement,
          passengerName: payload.passenger_name,
          count: payload.count,
          price: payload.price,
          companyValue: payload.company_value,
        });
      } catch (postErr: any) {
        toast.warning(postErr?.message || "تم حفظ الرحلة لكن تعذر تحديث الحركة المالية");
      }
      toast.success("تم حفظ التعديلات بنجاح");
      onClose();
    } catch (error: any) {
      toast.error(error?.message || "تعذر حفظ التعديلات");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title="✏️ تعديل رحلة"
      maxWidth={820}
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={saving}>إلغاء</button>
          <button className="btn btn-gold" onClick={save} disabled={saving}>{saving ? "..." : "💾 حفظ التعديلات"}</button>
        </>
      }
    >
      <div className="form-grid">
        <div className="form-group"><label>اسم المسافر</label><input value={form.passenger_name} onChange={(e) => set("passenger_name", e.target.value)} /></div>
        <div className="form-group"><label>الرقم القومي</label><input value={form.national_id} onChange={(e) => set("national_id", e.target.value)} /></div>
        <div className="form-group"><label>رقم الجواز</label><input value={form.passport} onChange={(e) => set("passport", e.target.value)} /></div>
        <div className="form-group"><label>تاريخ الميلاد</label><input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} /></div>
        <div className="form-group"><label>شركة الطيران</label>
          <select value={form.airline} onChange={(e) => set("airline", e.target.value)}>
            <option value="">اختر...</option>
            <SafeSelectOptions options={AIRLINES} />
          </select>
        </div>
        <div className="form-group"><label>الوجهة</label>
          <select value={form.destination} onChange={(e) => set("destination", e.target.value)}>
            <option value="">اختر...</option>
            <SafeSelectOptions options={DESTINATIONS} />
          </select>
        </div>
        <div className="form-group"><label>تاريخ السفر</label><input type="date" value={form.travel_date} onChange={(e) => set("travel_date", e.target.value)} /></div>
        <div className="form-group"><label>الوكيل</label>
          <select value={form.agent_id} onChange={(e) => set("agent_id", e.target.value)}>
            <option value="">اختر...</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>حالة الموافقة الأمنية</label>
          <select value={form.status} onChange={(e) => set("status", e.target.value)}>
            <option value="">اختر...</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div className="form-group"><label>الشركة الصادرة</label>
          <select value={form.issuing_company} onChange={(e) => set("issuing_company", e.target.value)}>
            <option value="">اختر...</option>
            {companies.map((c) => <option key={c.id} value={c.company_name}>{c.company_name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>العدد</label><input type="number" min={1} value={form.count} onChange={(e) => set("count", e.target.value)} /></div>
        <div className="form-group"><label>السعر (للوكيل)</label><input type="number" min={0} value={form.price} onChange={(e) => set("price", e.target.value)} /></div>
        <div className="form-group"><label>قيمة الرحلة (تلقائي)</label><input value={fmtNum(Number(form.count || 0) * Number(form.price || 0))} disabled readOnly /></div>
        <div className="form-group"><label>قيمة الشركة الصادرة</label><input type="number" min={0} value={form.company_value} onChange={(e) => set("company_value", e.target.value)} /></div>
        <div className="form-group full"><label>بيان السفر (تلقائي)</label><input value={travelStatement} disabled readOnly /></div>
        <div className="form-group full"><label>ملاحظات</label><textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      </div>
    </Modal>
  );
}
