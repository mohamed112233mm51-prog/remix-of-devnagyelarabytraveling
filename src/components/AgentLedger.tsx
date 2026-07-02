import { Link, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { ExportButton } from "@/components/ExportButton";
import {
  badgeFor, fmtDL, fmtNum, tripValue, txnTotalPaid, merchantCashGross, merchantCashPhysical,
  useLive, GOVERNORATES,
  type Agent, type Transaction, type Merchant,
} from "@/lib/db";
import { AgentPaymentForm } from "@/components/AgentPaymentForm";
import * as CF from "@/components/ColumnFilter";
import { ColumnVisibility, type ColumnDef } from "@/components/ColumnVisibility";
import { usePersistentColumnVisibility } from "@/hooks/usePersistentColumnVisibility";

const LEDGER_COLUMNS: ColumnDef[] = [
  { key: "n", label: "#" },
  { key: "date", label: "التاريخ" },
  { key: "description", label: "البيان" },
  { key: "service", label: "نوع الخدمة" },
  { key: "destination", label: "وجهة السفر" },
  { key: "count", label: "العدد" },
  { key: "price", label: "السعر" },
  { key: "serviceValue", label: "قيمة الرحلة" },
  { key: "debit", label: "مدين" },
  { key: "credit", label: "دائن" },
  { key: "balance", label: "الرصيد الحالي" },
  { key: "method", label: "وسيلة الدفع" },
  { key: "note", label: "ملاحظات" },
];



import { useRegisterStatementCapture } from "@/lib/statementCapture";

type LedgerKind = "service" | "payment";
type LedgerEntry = {
  id: string; date: string; kind: LedgerKind; description: string; destination: string; service: string;
  count: number; price: number; serviceValue: number; payment: number; debit: number; credit: number;
  paymentMethod: string; note: string; raw: Transaction;
};

type AgentLedgerProps = {
  lockedAgentId?: string;
  initialAgentId?: string;
  showAgentProfile?: boolean;
  canExport?: boolean;
};

function classifyTxn(t: Transaction): LedgerKind {
  if ((t as any).source_service_type === "payment") return "payment";
  return Number(t.count || 0) * Number(t.price || 0) > 0 ? "service" : "payment";
}


function paymentMethodLabel(t: Transaction): string {
  const parts: string[] = [];
  if (Number(t.instapay_amount || 0) > 0) parts.push("إنستاباي");
  if (Number(t.cash_amount || 0) > 0) parts.push("نقدي");
  if (merchantCashGross(t) > 0) parts.push("تاجر محفظة");
  if (merchantCashPhysical(t) > 0) parts.push("تاجر نقدي");
  return parts.length ? parts.join(" + ") : (t.payment_method || "—");
}

function buildLedger(txns: Transaction[]): LedgerEntry[] {
  const safeTxns = Array.isArray(txns) ? txns.filter(Boolean) : [];
  return [...safeTxns]
    .sort((a, b) => (a.date || "").localeCompare(b.date || "") || (a.created_at || "").localeCompare(b.created_at || ""))
    .map((t) => {
      const kind = classifyTxn(t);
      const serviceValue = tripValue(t);
      const payment = txnTotalPaid(t);
      const isPayment = kind === "payment";
      const credit = isPayment ? (payment || serviceValue) : payment;
      const merchantGross = Number(t.merchant_cash_amount || 0);
      const merchantNet = merchantCashGross(t) > 0
        ? Math.round(Number(t.merchant_cash_net_amount || 0) || (merchantGross - merchantGross * 0.01))
        : 0;
      const merchantCommission = merchantGross - merchantNet;
      const sst = (t as any).source_service_type as string | undefined;
      const isOpening = sst === "opening_debit" || sst === "opening_credit";
      let description = isOpening
        ? "رصيد سابق"
        : (isPayment ? "دفعة من الوكيل" : (t.service_type || t.travel_statement || "خدمة منفذة"));
      if (!isOpening && isPayment && merchantGross > 0) {
        description += ` — تاجر الكاش: المستلم ${fmtDL(merchantGross)} − عمولة تاجر الكاش ${fmtDL(merchantCommission)} = صافي ${fmtDL(merchantNet)}`;
      }
      return {
        id: t.id || `${t.created_at || "row"}-${t.agent_id || "agent"}`,
        date: t.date || "",
        kind,
        description,
        destination: t.destination || "—",
        service: t.service_type || "—",
        count: Number(t.count || 0),
        price: Number(t.price || 0),
        serviceValue,
        payment: credit,
        debit: isPayment ? 0 : serviceValue,
        credit,
        paymentMethod: credit > 0 ? paymentMethodLabel(t) : "—",
        note: t.note || "—",
        raw: t,
      };
    });
}


export function AgentLedger({ lockedAgentId, initialAgentId = "", showAgentProfile = false, canExport = true }: AgentLedgerProps) {
  const router = useRouter();
  const { rows: liveAgents, loading: agentsLoading } = useLive<Agent>("agents");
  const flights: any[] = [];
  const { rows: liveTxns } = useLive<Transaction>("transactions");
  const { rows: liveMerchants } = useLive<Merchant>("merchants");
  const agents = Array.isArray(liveAgents) ? liveAgents : [];
  const txns = Array.isArray(liveTxns) ? liveTxns : [];
  const merchants = Array.isArray(liveMerchants) ? liveMerchants : [];
  const [selectedAgentId, setSelectedAgentId] = useState(lockedAgentId || initialAgentId || "");
  const [editOpen, setEditOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);


  const initialFilters = (): Record<string, CF.ColumnFilterState> => ({
    date: CF.emptyDateRange(),
    description: CF.emptyText(),
    service: CF.emptyMultiSelect(),
    destination: CF.emptyMultiSelect(),
    count: CF.emptyNumeric(),
    price: CF.emptyNumeric(),
    serviceValue: CF.emptyNumeric(),
    payment: CF.emptyNumeric(),
    debit: CF.emptyNumeric(),
    credit: CF.emptyNumeric(),
    balance: CF.emptyNumeric(),
    method: CF.emptyMultiSelect(),
    note: CF.emptyText(),
  });
  const [filters, setFilters] = useState<Record<string, CF.ColumnFilterState>>(() => CF.sanitizeFilterMap(undefined, initialFilters()));
  const setF = (k: string, s: CF.ColumnFilterState) => setFilters((p) => CF.sanitizeFilterMap({ ...p, [k]: s }, initialFilters()));
  const resetAll = () => setFilters(initialFilters());
  const safeFilters = CF.sanitizeFilterMap(filters, initialFilters());
  const anyActive = Object.values(safeFilters).some(CF.isFilterActive);

  const [visible, setVisible] = usePersistentColumnVisibility("agent-ledger", LEDGER_COLUMNS);
  const isVisible = (k: string) => visible[k] !== false;

  useEffect(() => { if (lockedAgentId) setSelectedAgentId(lockedAgentId); }, [lockedAgentId]);
  useEffect(() => { if (!lockedAgentId) setSelectedAgentId(initialAgentId || ""); }, [initialAgentId, lockedAgentId]);

  const agent = agents.find((a) => a.id === selectedAgentId);
  const merchantName = (mid: string | null) => mid ? (merchants.find((m) => m.id === mid)?.merchant_name || "") : "";

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("agent-statement-agent-change", {
      detail: agent ? { id: agent.id, whatsapp: agent.whatsapp || null } : null,
    }));
    return () => {
      window.dispatchEvent(new CustomEvent("agent-statement-agent-change", { detail: null }));
    };
  }, [agent]);

  useEffect(() => {
    if (showAgentProfile && !agentsLoading && lockedAgentId && !agent) {
      toast.error("تعذر فتح ملف الوكيل");
      router.history.back();
    }
  }, [showAgentProfile, agentsLoading, lockedAgentId, agent, router]);

  const myFlights = useMemo(() => flights.filter((f) => f.agent_id === selectedAgentId), [flights, selectedAgentId]);

  const myTxnsAll = useMemo(() => txns.filter((t) => t.agent_id === selectedAgentId), [txns, selectedAgentId]);
  const ledger = useMemo(() => buildLedger(myTxnsAll), [myTxnsAll]);
  const ledgerWithBalance = useMemo(() => {
    let balance = 0;
    return ledger.map((e) => ({ ...e, balance: (balance += e.debit - e.credit) }));
  }, [ledger]);
  const rowsWithMethodLabel = useMemo(() => ledgerWithBalance.map((e) => ({
    ...e,
    methodLabel: e.paymentMethod + (e.raw.merchant_id && merchantName(e.raw.merchant_id) ? ` — ${merchantName(e.raw.merchant_id)}` : ""),
  })), [ledgerWithBalance, merchants]);

  const serviceOptions = useMemo(() => Array.from(new Set(rowsWithMethodLabel.map((e) => e.service).filter(Boolean))).sort(), [rowsWithMethodLabel]);
  const destOptions = useMemo(() => Array.from(new Set(rowsWithMethodLabel.map((e) => e.destination).filter(Boolean))).sort(), [rowsWithMethodLabel]);
  const methodOptions = useMemo(() => Array.from(new Set(rowsWithMethodLabel.map((e) => e.methodLabel).filter((v) => v && v !== "—"))).sort(), [rowsWithMethodLabel]);

  const displayRows = useMemo(() => rowsWithMethodLabel.filter((e) => {
    if (!CF.matchDateRange(e.date, safeFilters.date)) return false;
    if (!CF.matchText(e.description, safeFilters.description)) return false;
    if (!CF.matchMultiSelect(e.service, safeFilters.service)) return false;
    if (!CF.matchMultiSelect(e.destination, safeFilters.destination)) return false;
    if (!CF.matchNumeric(e.count, safeFilters.count)) return false;
    if (!CF.matchNumeric(e.price, safeFilters.price)) return false;
    if (!CF.matchNumeric(e.serviceValue, safeFilters.serviceValue)) return false;
    if (!CF.matchNumeric(e.payment, safeFilters.payment)) return false;
    if (!CF.matchNumeric(e.debit, safeFilters.debit)) return false;
    if (!CF.matchNumeric(e.credit, safeFilters.credit)) return false;
    if (!CF.matchNumeric(e.balance, safeFilters.balance)) return false;
    if (!CF.matchMultiSelect(e.methodLabel, safeFilters.method)) return false;
    if (!CF.matchText(e.note, safeFilters.note)) return false;
    return true;
  }), [rowsWithMethodLabel, safeFilters]);

  const totalServices = ledger.reduce((s, e) => s + e.debit, 0);
  const totalPayments = ledger.reduce((s, e) => s + e.credit, 0);
  const net = totalServices - totalPayments;
  const accountStatus = net > 0 ? "مدين عليه" : net < 0 ? "دائن له" : "متوازن";
  const statusClass = net > 0 ? "red" : net < 0 ? "green" : "gold";

  const buildExportData = () => ({
    title: "كشف حساب الوكيل",
    subtitle: agent?.name || "",
    fileName: `كشف-حساب-${agent?.name || "الوكيل"}`,
    summary: [
      { label: "إجمالي قيمة الخدمات", value: fmtDL(totalServices) },
      { label: "إجمالي المدفوعات", value: fmtDL(totalPayments) },
      { label: "الصافي", value: fmtDL(Math.abs(net)) },
      { label: "حالة الحساب", value: accountStatus },
    ],
    columns: ([
      { header: "#", key: "n" }, { header: "التاريخ", key: "date" }, { header: "البيان", key: "description" },
      { header: "نوع الخدمة", key: "service" }, { header: "وجهة السفر", key: "destination" },
      { header: "العدد", key: "count" }, { header: "السعر", key: "price" },
      { header: "قيمة الرحلة", key: "serviceValue", exportKey: "sv" },
      { header: "مدين", key: "debit" }, { header: "دائن", key: "credit" },
      { header: "الرصيد الحالي", key: "balance" }, { header: "وسيلة الدفع", key: "method" }, { header: "ملاحظات", key: "note" },
    ] as Array<{ header: string; key: string; exportKey?: string }>)
      .filter((c) => isVisible(c.key))
      .map((c) => ({ header: c.header, key: c.exportKey || c.key })),
    rows: displayRows.map((e, i) => ({
      n: i + 1, date: e.date, description: e.description, service: e.service, destination: e.destination,
      count: e.count, count__excel: e.count, price: fmtNum(e.price), price__excel: e.price,
      sv: fmtDL(e.serviceValue), sv__excel: e.serviceValue,
      debit: e.debit > 0 ? fmtDL(e.debit) : "—", debit__excel: e.debit,
      credit: e.credit > 0 ? fmtDL(e.credit) : "—", credit__excel: e.credit,
      balance: fmtDL(e.balance), balance__excel: e.balance,
      method: e.methodLabel, note: e.note,
    })),
  });

  useRegisterStatementCapture(
    () => ({ data: buildExportData(), whatsapp: agent?.whatsapp || null, contextId: agent?.id || null }),
    [agent, displayRows, totalServices, totalPayments, net, accountStatus, filters],
  );

  if (agentsLoading && showAgentProfile) return null;

  const Th = ({ children, filterKey, options }: { children: React.ReactNode; filterKey?: string; options?: string[] }) => (
    <th>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 2 }}>
        <span>{children}</span>
        {filterKey && <CF.ColumnFilter label={String(children)} state={safeFilters[filterKey]} onChange={(s) => setF(filterKey, s)} options={options} />}
      </span>
    </th>
  );

  return (
    <div className="section active">
      {showAgentProfile && agent && (
        <div className="card no-print-actions">
          <div className="card-header"><div className="card-title">ملف الوكيل: {agent.name}</div><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}><button type="button" className="action-btn" onClick={() => setEditOpen(true)}>تعديل بيانات الوكيل</button><Link to="/accounts" className="action-btn">رجوع</Link></div></div>
          <div className="card-body" style={{ padding: 20 }}><div className="two-col"><div><div className="stat-row"><span className="stat-key">الاسم</span><span className="stat-val">{agent.name}</span></div><div className="stat-row"><span className="stat-key">الرقم القومي</span><span className="stat-val">{agent.national_id || "—"}</span></div><div className="stat-row"><span className="stat-key">الهاتف</span><span className="stat-val">{agent.phone || "—"}</span></div></div><div><div className="stat-row"><span className="stat-key">الواتساب</span><span className="stat-val">{agent.whatsapp || "—"}</span></div><div className="stat-row"><span className="stat-key">المحافظة</span><span className="stat-val">{agent.governorate || "—"}</span></div><div className="stat-row"><span className="stat-key">الحالة</span><span className="stat-val"><span className={`badge ${badgeFor(agent.status)}`}>{agent.status}</span></span></div><div className="stat-row"><span className="stat-key">عدد المسافرين</span><span className="stat-val">{fmtNum(myFlights.length)}</span></div></div></div></div>
        </div>
      )}

      {!lockedAgentId && (
        <div className="card no-print-actions" style={{ marginBottom: 12 }}>
          <div className="form-grid" style={{ padding: 12 }}><div className="form-group"><label>الوكيل</label><select value={selectedAgentId} onChange={(e) => setSelectedAgentId(e.target.value)}><option value="">— اختر وكيلاً —</option>{agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></div></div>
        </div>
      )}

      {!agent ? (
        <div className="card"><div className="card-body"><div className="empty"><div className="empty-text">اختر وكيلاً أولاً لعرض كشف الحساب</div></div></div></div>
      ) : (
        <>



        <div className="card">
          <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <div className="card-title">كشف حساب الوكيل</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {anyActive && <button type="button" className="action-btn" onClick={resetAll}>مسح جميع الفلاتر</button>}
              <ColumnVisibility columns={LEDGER_COLUMNS} visible={visible} onChange={setVisible} />
              {canExport && <ExportButton disabled={displayRows.length === 0} getData={buildExportData} />}
            </div>
          </div>
          <div className="card-body">
            <div className="table-wrap enterprise-table">
              <table className="mobile-cards">
                <thead>
                  <tr>
                    {isVisible("n") && <th>#</th>}
                    {isVisible("date") && <Th filterKey="date">التاريخ</Th>}
                    {isVisible("description") && <Th filterKey="description">البيان</Th>}
                    {isVisible("service") && <Th filterKey="service" options={serviceOptions}>نوع الخدمة</Th>}
                    {isVisible("destination") && <Th filterKey="destination" options={destOptions}>وجهة السفر</Th>}
                    {isVisible("count") && <Th filterKey="count">العدد</Th>}
                    {isVisible("price") && <Th filterKey="price">السعر</Th>}
                    {isVisible("serviceValue") && <Th filterKey="serviceValue">قيمة الرحلة</Th>}
                    {isVisible("debit") && <Th filterKey="debit">مدين</Th>}
                    {isVisible("credit") && <Th filterKey="credit">دائن</Th>}
                    {isVisible("balance") && <Th filterKey="balance">الرصيد الحالي</Th>}
                    {isVisible("method") && <Th filterKey="method" options={methodOptions}>وسيلة الدفع</Th>}
                    {isVisible("note") && <Th filterKey="note">ملاحظات</Th>}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.length === 0 ? (
                    <tr><td colSpan={LEDGER_COLUMNS.filter((c) => isVisible(c.key)).length}><div className="empty"><div className="empty-text">لا توجد حركات مطابقة</div></div></td></tr>
                  ) : displayRows.map((e, i) => (
                    <tr key={e.id} style={{ background: e.kind === "payment" ? "rgba(22,163,74,0.04)" : undefined }}>
                      {isVisible("n") && <td data-label="#">{i + 1}</td>}
                      {isVisible("date") && <td data-label="التاريخ">{e.date}</td>}
                      {isVisible("description") && <td data-label="البيان" className="bold">{e.description}</td>}
                      {isVisible("service") && <td data-label="نوع الخدمة">{e.service}</td>}
                      {isVisible("destination") && <td data-label="وجهة السفر">{e.destination}</td>}
                      {isVisible("count") && <td data-label="العدد">{e.count || "—"}</td>}
                      {isVisible("price") && <td data-label="السعر">{e.price ? fmtNum(e.price) : "—"}</td>}
                      {isVisible("serviceValue") && <td data-label="قيمة الرحلة">{e.serviceValue ? fmtDL(e.serviceValue) : "—"}</td>}
                      {isVisible("debit") && <td data-label="مدين" style={{ color: "var(--red)", fontWeight: 700 }}>{e.debit ? fmtDL(e.debit) : "—"}</td>}
                      {isVisible("credit") && <td data-label="دائن" style={{ color: "var(--green)", fontWeight: 700 }}>{e.credit ? fmtDL(e.credit) : "—"}</td>}
                      {isVisible("balance") && <td data-label="الرصيد الحالي" style={{ fontWeight: 800, color: e.balance > 0 ? "var(--red)" : e.balance < 0 ? "var(--green)" : undefined }}>{fmtDL(e.balance)}</td>}
                      {isVisible("method") && <td data-label="وسيلة الدفع">{e.methodLabel}</td>}
                      {isVisible("note") && <td data-label="ملاحظات">{e.note}</td>}
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={LEDGER_COLUMNS.filter((c) => isVisible(c.key)).length} style={{ fontWeight: 800 }}>
                      الإجمالي — مدين: {fmtDL(totalServices)} · دائن: {fmtDL(totalPayments)} · الصافي: {fmtDL(Math.abs(net))} ({accountStatus})
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>
        </>
      )}

      {editOpen && agent && <EditAgentModal agent={agent} onClose={() => setEditOpen(false)} />}
      {payOpen && agent && createPortal(
        <div onClick={() => setPayOpen(false)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001, padding: 16, overflow: "auto" }}>
          <div onClick={(e) => e.stopPropagation()} style={{ width: "100%", maxWidth: 880, maxHeight: "92vh", overflow: "auto" }}>
            <AgentPaymentForm agents={agents} merchants={merchants} lockedAgentId={agent.id} onDone={() => setPayOpen(false)} />
          </div>
        </div>,
        document.body,
      )}


    </div>
  );
}




function EditAgentModal({ agent, onClose }: { agent: Agent; onClose: () => void }) {
  const [form, setForm] = useState({ name: agent.name || "", national_id: agent.national_id || "", phone: agent.phone || "", whatsapp: agent.whatsapp || "", governorate: agent.governorate || "" });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.name.trim()) return toast.error("اسم الوكيل مطلوب");
    if (!form.phone.trim()) return toast.error("الهاتف مطلوب");
    setSaving(true);
    const { error } = await supabase.from("agents").update({ name: form.name.trim(), national_id: form.national_id.trim() || null, phone: form.phone.trim(), whatsapp: form.whatsapp.trim() || null, governorate: form.governorate || null }).eq("id", agent.id);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success("تم تحديث بيانات الوكيل بنجاح");
    onClose();
  };
  if (typeof document === "undefined") return null;
  return createPortal(<div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 9999, padding: 16 }}><div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto", margin: 0 }}><div className="card-header"><div className="card-title">تعديل بيانات الوكيل</div></div><div className="form-grid"><div className="form-group"><label>اسم الوكيل</label><input value={form.name} onChange={(e) => set("name", e.target.value)} /></div><div className="form-group"><label>الرقم القومي</label><input value={form.national_id} onChange={(e) => set("national_id", e.target.value)} /></div><div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div><div className="form-group"><label>الواتساب</label><input value={form.whatsapp} onChange={(e) => set("whatsapp", e.target.value)} /></div><div className="form-group"><label>المحافظة</label><select value={form.governorate} onChange={(e) => set("governorate", e.target.value)}><option value="">— غير محدد —</option>{GOVERNORATES.map((g) => <option key={g} value={g}>{g}</option>)}</select></div></div><div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}><button type="button" className="action-btn" onClick={onClose} disabled={saving}>إلغاء</button><button data-confirm-save="تأكيد حفظ التعديلات" type="button" className="btn btn-gold" onClick={save} disabled={saving}>حفظ التعديلات</button></div></div></div>, document.body);
}