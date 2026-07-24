import { createFileRoute } from "@tanstack/react-router";
import { CurrencyLines } from "@/components/CurrencyLines";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { badgeFor, fmtDL, fmtCurrency, useLive, useDropdownOptions, GOVERNORATES, applyOptimistic, type Agent, type Execution, type Merchant, type Transaction } from "@/lib/db";
import { CurrencyMap, formatCurrencyMap } from "@/lib/financialSummary";
import {
  computeAgentServicesByCurrencyPerAgent,
  computeAgentPaymentsByCurrencyPerAgent,
  subtractCurrencyMaps,
} from "@/lib/dashboardCollections";
import { useAgentAccountTotals } from "@/hooks/useAgentAccountTotals";


import { syncEntityOpeningEntries, readEntityOpeningEntries, type OpeningEntry } from "@/lib/openingBalance";
import { OpeningEntriesEditor } from "@/components/OpeningEntriesEditor";
import { toast } from "sonner";
import { usePerm, checkPerm } from "@/hooks/usePerm";
import { useAuth } from "@/hooks/useAuth";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { usePagination } from "@/hooks/usePagination";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { usePersistentState } from "@/hooks/usePersistentState";

import { AgentLedger } from "@/components/AgentLedger";
import { AgentPaymentForm } from "@/components/AgentPaymentForm";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { NumberInput } from "@/components/inputs/NumberInput";
import { DateInput } from "@/components/inputs/DateInput";
import { Plane, Wallet, AlertCircle, Search, UserPlus, CreditCard, FileText, Users, ChevronLeft, Banknote } from "lucide-react";
import { AgentCashOutForm } from "@/components/CashMovementForms";
import { EntityProfileModal } from "@/components/EntityProfileModal";
import { PriceLookup } from "@/components/PriceLookup";


export const Route = createFileRoute("/accounts")({
  component: () => <AppErrorBoundary><AccountsPage /></AppErrorBoundary>,
});

type Tab = "list" | "add" | "txn" | "cashout" | "statement";

function AccountsPage() {
  const perm = usePerm("accounts");
  const { permissions, isAdmin } = useAuth();
  const canSearchPricing = checkPerm(permissions, isAdmin, "service_price_search", "view");
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: txns } = useLive<Transaction>("transactions");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const [tab, setTab] = useState<Tab>("list");
  const [search, setSearch] = useState("");
  const [statementAgentId, setStatementAgentId] = useState<string>("");
  const [editAgent, setEditAgent] = useState<Agent | null>(null);
  const [viewAgent, setViewAgent] = useState<Agent | null>(null);
  const [showAgentLookup, setShowAgentLookup] = useState(false);


  // نفس مصدر الداشبورد بالضبط — لضمان تطابق كروت الوكلاء عملة بعملة:
  //   الخدمات  = executions.services (kind=agent) لتنفيذات "منفذ"، منسوبة لـ agent_id.
  //   المدفوعات = transactions مع agent_id، عبر txnCollectedAmount (بدون fallback).
  //   المستحق  = الخدمات − المدفوعات لكل عملة على حدة (بدون خلط عملات).
  const { rows: executions } = useLive<Execution>("executions");
  // Aggregate KPI boxes come from the shared source of truth
  // (`useAgentAccountTotals`) — same hook the dashboard consumes.
  const { services: totalTrips, payments: totalPaid, due: totalDue } = useAgentAccountTotals();
  // Per-agent breakdown for the table stays local (needs per-agent maps).
  const stats = useMemo(() => {
    const servicesPerAgent = computeAgentServicesByCurrencyPerAgent(executions as any);
    const paymentsPerAgent = computeAgentPaymentsByCurrencyPerAgent(txns);
    const map = new Map<string, { trips: CurrencyMap; paid: CurrencyMap; due: CurrencyMap }>();
    for (const a of agents) {
      const trips = servicesPerAgent.get(a.id) || new CurrencyMap();
      const paid = paymentsPerAgent.get(a.id) || new CurrencyMap();
      const due = subtractCurrencyMaps(trips, paid);
      map.set(a.id, { trips, paid, due });
    }
    return map;
  }, [agents, executions, txns]);



  const debouncedSearch = useDebouncedValue(search, 250);
  const filtered = useMemo(() => agents.filter((a) =>
    !debouncedSearch || a.name.toLowerCase().includes(debouncedSearch.toLowerCase()),
  ), [agents, debouncedSearch]);

  const { pageRows, Controls, page, pageSize } = usePagination(filtered, 50);

  return (
    <div className="section active accounts-page">
      <div className="page-head">
        <div className="page-head-text">
          <div className="breadcrumb-row">
            <span>الحسابات المالية</span>
            <ChevronLeft size={12} strokeWidth={2} />
            <span className="crumb-current">حسابات الوكلاء</span>
          </div>
          <h1 className="page-h1"><Users size={20} strokeWidth={2.2} /> حسابات الوكلاء</h1>
          <div className="page-sub">إدارة ومتابعة حسابات الوكلاء</div>
        </div>
        {perm.create && (
          <button className="btn btn-gold page-head-cta" onClick={() => setTab("add")} type="button">
            <UserPlus size={16} strokeWidth={2.2} /> إضافة وكيل
          </button>
        )}
      </div>

      <div className="account-summary kpi-rich">
        <div className="sum-box gold">
          <div className="kpi-icon"><Plane size={18} strokeWidth={2} /></div>
          <div className="kpi-text">
            <div className="label">قيمة الرحلات</div>
            <div className="val"><CurrencyLines map={totalTrips} /></div>
          </div>
        </div>
        <div className="sum-box green">
          <div className="kpi-icon"><Wallet size={18} strokeWidth={2} /></div>
          <div className="kpi-text">
            <div className="label">إجمالي المدفوعات</div>
            <div className="val"><CurrencyLines map={totalPaid} /></div>
          </div>
        </div>
        <div className="sum-box red">
          <div className="kpi-icon"><AlertCircle size={18} strokeWidth={2} /></div>
          <div className="kpi-text">
            <div className="label">الصافي المستحق</div>
            <div className="val"><CurrencyLines map={totalDue} /></div>

          </div>
        </div>
      </div>


      <div className="action-toolbar">
        <div className={`tool-tab ${tab === "list" ? "active" : ""}`} onClick={() => setTab("list")}>
          <Users size={15} strokeWidth={2} /> <span>قائمة الوكلاء</span>
        </div>
        {perm.create && (
          <div className={`tool-tab ${tab === "txn" ? "active" : ""}`} onClick={() => setTab("txn")}>
            <CreditCard size={15} strokeWidth={2} /> <span>إضافة دفعة من الوكيل</span>
          </div>
        )}
        {perm.create && (
          <div className={`tool-tab ${tab === "cashout" ? "active" : ""}`} onClick={() => setTab("cashout")}>
            <Banknote size={15} strokeWidth={2} /> <span>صرف نقدية</span>
          </div>
        )}
        <div className={`tool-tab ${tab === "statement" ? "active" : ""}`} onClick={() => setTab("statement")}>
          <FileText size={15} strokeWidth={2} /> <span>كشف حساب</span>
        </div>
      </div>

      {tab === "list" && (
        <>
          <div className="filter-bar">
            <div className="search-wrap">
              <Search size={15} strokeWidth={2} className="search-wrap-icon" />
              <input
                className="search-input search-input--with-icon"
                placeholder="ابحث بالاسم أو الكود..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="card">
            <div className="card-header">
              <div className="card-title">قائمة الوكلاء <span className="muted-count">({filtered.length})</span></div>
            </div>
            <div className="card-body">
              <div className="table-wrap enterprise-table">
                <table className="mobile-cards">
                  <thead>
                    <tr>
                      <th>#</th><th>اسم الوكيل</th><th>الرقم القومي</th><th>الهاتف</th><th>الواتساب</th><th>المحافظة</th>
                      <th className="num-col">قيمة الرحلات</th><th className="num-col">المدفوعات</th><th className="num-col">الصافي</th><th>الحالة</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.length === 0 ? (
                      <tr><td colSpan={10}><div className="empty"><div className="empty-icon">👥</div><div className="empty-text">أضف وكلاء من تبويب "وكيل جديد"</div></div></td></tr>
                    ) : pageRows.map((a, i) => {
                      const idx = page * pageSize + i;
                      const s = stats.get(a.id) || { trips: new CurrencyMap(), paid: new CurrencyMap(), due: new CurrencyMap() };
                      return (
                        <tr key={a.id} onClick={() => setViewAgent(a)} style={{ cursor: "pointer" }}>
                          <td data-label="#">{idx + 1}</td>
                          <td className="bold" data-label="الاسم">{a.name}</td>
                          <td data-label="الرقم القومي">{a.national_id || "—"}</td>
                          <td data-label="الهاتف">{a.phone || "—"}</td>
                          <td data-label="الواتساب">{a.whatsapp || "—"}</td>
                          <td data-label="المحافظة">{a.governorate || "—"}</td>
                          <td className="num-col" data-label="قيمة الرحلات"><CurrencyLines map={s.trips} /></td>
                          <td className="num-col" data-label="المدفوعات"><CurrencyLines map={s.paid} /></td>
                          <td className="num-col" data-label="الصافي" style={{ fontWeight: 700 }}><CurrencyLines map={s.due} /></td>
                          <td data-label="الحالة"><span className={`badge pill-badge ${badgeFor(a.status)}`}>{a.status}</span></td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot className="totals-foot">
                    <tr>
                      <td colSpan={6}>الإجمالي</td>
                      <td className="num-col"><CurrencyLines map={totalTrips} /></td>
                      <td className="num-col"><CurrencyLines map={totalPaid} /></td>
                      <td className="num-col"><CurrencyLines map={totalDue} /></td>
                      <td></td>
                    </tr>


                  </tfoot>
                </table>
              </div>
              <Controls />
            </div>
          </div>
        </>
      )}

      {tab === "add" && perm.create && <AgentForm onDone={() => setTab("list")} />}
      {tab === "txn" && perm.create && <TxnForm agents={agents} merchants={merchants} txns={txns} onDone={() => setTab("list")} />}
      {tab === "cashout" && perm.create && <AgentCashOutForm onDone={() => setTab("list")} />}
      {tab === "statement" && <AppErrorBoundary name="AgentLedger"><AgentLedger initialAgentId={statementAgentId} canExport={perm.export} /></AppErrorBoundary>}

      {editAgent && perm.edit && <EditAgentModal agent={editAgent} onClose={() => setEditAgent(null)} />}

      {viewAgent && (() => {
        const a = viewAgent as any;
        const s = stats.get(viewAgent.id) || { trips: new CurrencyMap(), paid: new CurrencyMap(), due: new CurrencyMap() };
        // لون "الصافي المستحق" — إذا كانت كل العملات موجبة نستخدم لوناً واحداً، وإلا لون محايد.
        const dueSigns = new Set(s.due.entries().map((e) => Math.sign(e.amount)));
        const dueTone: "red" | "green" | "default" = dueSigns.size !== 1 ? "default" : dueSigns.has(1) ? "red" : "default";
        return (
          <EntityProfileModal
            open={!!viewAgent}
            onClose={() => { setViewAgent(null); setShowAgentLookup(false); }}
            titlePrefix="ملف الوكيل"

            name={viewAgent.name}
            status={{ label: viewAgent.status || "—", tone: badgeFor(viewAgent.status) }}
            canEdit={perm.edit}
            editLabel="تعديل بيانات الوكيل"
            onEdit={() => { setEditAgent(viewAgent); setViewAgent(null); }}
            kpis={[
              { label: "قيمة الرحلات", value: <CurrencyLines map={s.trips} />, tone: "gold" },
              { label: "إجمالي المدفوعات", value: <CurrencyLines map={s.paid} />, tone: "green" },
              { label: "الصافي المستحق", value: <CurrencyLines map={s.due} />, tone: dueTone },
            ]}

            fields={[
              { label: "اسم الوكيل", value: viewAgent.name },
              { label: "الرقم القومي", value: viewAgent.national_id },
              { label: "الهاتف", value: viewAgent.phone },
              { label: "الواتساب", value: viewAgent.whatsapp },
              { label: "المحافظة", value: viewAgent.governorate },
              { label: "شريحة الوكيل", value: a.tier || "—" },
            ]}
            headerActions={
              canSearchPricing ? (
                <button
                  type="button"
                  className={`btn btn-outline${showAgentLookup ? " active" : ""}`}
                  onClick={() => setShowAgentLookup((v) => !v)}
                  title="بحث داخل أسعار خدمات الوكيل"
                  style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
                >
                  <Search size={14} strokeWidth={2} />
                  {showAgentLookup ? "إخفاء بحث سعر خدمة" : "بحث سعر خدمة"}
                </button>
              ) : null
            }
            extraContent={
              canSearchPricing && showAgentLookup ? (
                <PriceLookup mode="agent" agentTier={a.tier || undefined} />
              ) : null
            }
          />

        );
      })()}
    </div>
  );
}

function EditAgentModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const a = agent as any;
  const tierOptions = useDropdownOptions("agent_tier" as any);
  const [form, setForm] = useState({
    name: agent.name || "",
    national_id: agent.national_id || "",
    phone: agent.phone || "",
    whatsapp: agent.whatsapp || "",
    governorate: agent.governorate || "",
    tier: a.tier || "A",
    status: agent.status || "نشط",
  });
  const [openings, setOpenings] = useState<OpeningEntry[]>([]);
  useEffect(() => {
    let alive = true;
    readEntityOpeningEntries("agent", agent.id).then((rows) => { if (alive) setOpenings(rows); }).catch(() => {});
    return () => { alive = false; };
  }, [agent.id]);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.name.trim()) return toast.error("برجاء إدخال اسم الوكيل");
    if (!form.phone.trim()) return toast.error("برجاء إدخال رقم الهاتف");
    const patch = {
      name: form.name.trim(),
      national_id: form.national_id.trim() || null,
      phone: form.phone.trim(),
      whatsapp: form.whatsapp.trim() || null,
      governorate: form.governorate || null,
      tier: form.tier || "A",
      status: form.status || "نشط",
    } as any;
    const { ok } = await applyOptimistic({
      table: "agents", type: "update", id: agent.id, patch,
      run: async () => await supabase.from("agents").update(patch).eq("id", agent.id),
    });
    if (!ok) return;
    try {
      await syncEntityOpeningEntries("agent", agent.id, openings);
    } catch (e: any) {
      return toast.error(e?.message || "فشل حفظ الأرصدة الافتتاحية");
    }
    toast.success("تم تحديث بيانات الوكيل بنجاح");
    onClose();
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 640, width: "100%", margin: 0 }}>
        <div className="card-header"><div className="card-title">✏️ تعديل بيانات الوكيل</div></div>
        <div className="form-grid">
          <div className="form-group"><label>اسم الوكيل</label><input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="form-group"><label>الرقم القومي</label><input value={form.national_id} onChange={(e) => set("national_id", e.target.value)} /></div>
          <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
          <div className="form-group"><label>المحافظة</label>
            <SearchableSelect value={form.governorate} onChange={(v) => set("governorate", v)} options={GOVERNORATES as unknown as string[]} />
          </div>
          <div className="form-group"><label>شريحة الوكيل</label>
            <SearchableSelect value={form.tier} onChange={(v) => set("tier", v)} options={(tierOptions.length ? tierOptions : ["A","B","C"]) as string[]} />
          </div>
          <div className="form-group"><label>الحالة</label>
            <SearchableSelect value={form.status} onChange={(v) => set("status", v)} options={["نشط", "غير نشط"]} allowClear={false} />
          </div>
        </div>

        <OpeningEntriesEditor value={openings} onChange={setOpenings} />

        
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="action-btn" onClick={onClose}>إلغاء</button>
          <button data-confirm-save="تأكيد حفظ التعديلات" className="btn btn-gold" onClick={save}>💾 حفظ التعديلات</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}



function AgentForm({ onDone }: { onDone: () => void }) {
  const tierOptions = useDropdownOptions("agent_tier" as any);
  const [form, setForm, clearForm] = usePersistentState(
    "form:agent:add",
    { name: "", national_id: "", phone: "", whatsapp: "", governorate: "", tier: "A", status: "نشط" },
  );
  const [openings, setOpenings] = useState<OpeningEntry[]>([]);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const resetAll = () => { clearForm(); setOpenings([]); };

  const save = async () => {
    if (!form.name.trim()) return toast.error("اسم الوكيل مطلوب");
    if (!form.phone.trim()) return toast.error("الهاتف مطلوب");
    const { data, error } = await supabase.from("agents").insert({
      name: form.name,
      national_id: form.national_id || null,
      phone: form.phone,
      whatsapp: form.whatsapp || null,
      governorate: form.governorate || null,
      tier: form.tier || "A",
      status: form.status || "نشط",
    } as any).select("id").single();
    if (error) return toast.error(error.message);
    const agentId = data?.id;
    if (agentId) {
      try { await syncEntityOpeningEntries("agent", agentId, openings); }
      catch (e: any) { toast.error(e?.message || "فشل حفظ الأرصدة الافتتاحية"); }
    }
    resetAll();
    onDone();
  };
  return (
    <div className="card">
      <div className="card-header"><div className="card-title">➕ إضافة وكيل</div></div>
      <div className="form-grid">
        <div className="form-group"><label>اسم الوكيل</label><input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
        <div className="form-group"><label>الرقم القومي</label><input value={form.national_id} onChange={(e) => set("national_id", e.target.value)} /></div>
        <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
        <div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div>
        <div className="form-group"><label>المحافظة</label>
          <SearchableSelect value={form.governorate} onChange={(v) => set("governorate", v)} options={GOVERNORATES as unknown as string[]} />
        </div>
        <div className="form-group"><label>شريحة الوكيل</label>
          <SearchableSelect value={form.tier} onChange={(v) => set("tier", v)} options={(tierOptions.length ? tierOptions : ["A","B","C"]) as string[]} />
        </div>
        <div className="form-group"><label>الحالة</label>
          <SearchableSelect value={form.status} onChange={(v) => set("status", v)} options={["نشط", "غير نشط"]} allowClear={false} />
        </div>
      </div>

      <OpeningEntriesEditor value={openings} onChange={setOpenings} />

      <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button data-confirm-save="تأكيد حفظ الوكيل" className="btn btn-gold" onClick={save}>💾 حفظ الوكيل</button>
      </div>
    </div>
  );
}

function TxnForm(props: { agents: Agent[]; merchants: Merchant[]; txns: Transaction[]; onDone: () => void }) {
  return <AgentPaymentForm agents={props.agents} merchants={props.merchants} onDone={props.onDone} />;
}



