import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { checkPerm } from "@/hooks/usePerm";
import { Modal } from "@/components/Modal";
import { toast } from "sonner";
import { fmtCurrency } from "@/lib/db";
import { FileClock, Search, Eye, RefreshCcw } from "lucide-react";
import { ExportButton } from "@/components/ExportButton";

export const Route = createFileRoute("/audit-log")({
  component: AuditLogPage,
});

type AuditRow = {
  id: string;
  table_name: string;
  record_id: string;
  action: "create" | "edit" | "cancel" | "restore" | "delete";
  reason: string | null;
  reference_no: string | null;
  entity_type: string | null;
  entity_id: string | null;
  before_value: any;
  after_value: any;
  performed_by: string | null;
  performed_at: string;
};

const TABLE_LABEL: Record<string, string> = {
  transactions: "حركة وكيل",
  company_transactions: "حركة شركة",
  currency_supplier_transactions: "حركة مورد عملة",
  merchant_cash_collections: "تحصيل تاجر كاش",
  usd_treasury_transactions: "خزينة دولار",
  expense_deductions: "خصم مصروف",
  payment_splits: "تقسيم دفع",
};
const ACTION_LABEL: Record<string, string> = {
  create: "إنشاء",
  edit: "تعديل",
  cancel: "إلغاء",
  restore: "إعادة تفعيل",
  delete: "حذف",
};
const ACTION_BADGE: Record<string, string> = {
  create: "badge-green",
  edit: "badge-blue",
  cancel: "badge-red",
  restore: "badge-gold",
  delete: "badge-red",
};
const ENTITY_LABEL: Record<string, string> = {
  agent: "وكيل",
  company: "شركة",
  currency_supplier: "مورد عملة",
  merchant: "تاجر كاش",
  usd_treasury: "الخزينة الدولارية",
  expense: "مصروف",
  payment_split: "تقسيم دفع",
};

// Arabic labels for DB column names
const FIELD_LABEL: Record<string, string> = {
  cash_amount: "المبلغ النقدي",
  amount: "المبلغ",
  total_paid: "إجمالي المدفوع",
  total_amount: "الإجمالي",
  statement: "البيان",
  note: "ملاحظة",
  notes: "ملاحظات",
  reason: "السبب",
  currency: "العملة",
  payment_method: "وسيلة الدفع",
  cash_box_id: "الخزينة",
  merchant_id: "تاجر الكاش",
  agent_id: "الوكيل",
  company_id: "الشركة",
  supplier_id: "مورد العملة",
  reference_no: "رقم المرجع",
  date: "التاريخ",
  transaction_date: "تاريخ الحركة",
  collection_date: "تاريخ التحصيل",
  status: "الحالة",
  is_active: "مفعّل",
  cancelled: "ملغى",
  cancelled_at: "تاريخ الإلغاء",
  cancelled_by: "أُلغي بواسطة",
  cancel_reason: "سبب الإلغاء",
  restored_at: "تاريخ إعادة التفعيل",
  restored_by: "أعاد التفعيل",
  price: "السعر",
  count: "العدد",
  quantity: "الكمية",
  rate: "سعر التحويل",
  fx_rate: "سعر الصرف",
  buy_price: "سعر الشراء",
  sell_price: "سعر البيع",
  usd_amount: "المبلغ بالدولار",
  egp_amount: "المبلغ بالجنيه",
  lyd_amount: "المبلغ بالدينار",
  from_currency: "من عملة",
  to_currency: "إلى عملة",
  from_cash_box_id: "من خزينة",
  to_cash_box_id: "إلى خزينة",
  category: "التصنيف",
  type: "النوع",
  kind: "النوع",
  direction: "الاتجاه",
  service_id: "الخدمة",
  execution_id: "التنفيذ",
  submission_id: "الطلب",
  invoice_no: "رقم الفاتورة",
  created_by: "أنشئ بواسطة",
  updated_by: "عُدل بواسطة",
};

const MONEY_FIELDS = new Set([
  "amount","cash_amount","total_paid","total_amount","price",
  "usd_amount","egp_amount","lyd_amount","buy_price","sell_price",
]);
const DATE_FIELDS = new Set([
  "date","transaction_date","collection_date",
  "cancelled_at","restored_at","created_at","updated_at",
]);
const BOOL_FIELDS = new Set(["is_active","cancelled"]);
const HIDDEN_FIELDS = new Set([
  "id","created_at","updated_at","org_id","tenant_id",
  "created_by","updated_by",
]);

function fieldLabel(k: string): string {
  return FIELD_LABEL[k] || k;
}

function formatValue(k: string, v: any, row: any): string {
  if (v === null || v === undefined || v === "") return "—";
  if (BOOL_FIELDS.has(k) || typeof v === "boolean") return v ? "نعم" : "لا";
  if (MONEY_FIELDS.has(k) && typeof v === "number") {
    const cur = row?.currency || row?.from_currency || "EGP";
    return fmtCurrency(v, cur);
  }
  if (DATE_FIELDS.has(k)) {
    try {
      const d = new Date(v);
      if (!isNaN(d.getTime())) return d.toLocaleString("ar-EG");
    } catch { /* noop */ }
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

type Lookups = {
  agents: Record<string, string>;
  companies: Record<string, string>;
  merchants: Record<string, string>;
  suppliers: Record<string, string>;
  cashBoxes: Record<string, string>;
};

const COMPANY_TREASURY_LABEL = "خزينة الشركة";

function resolveCashBox(id: string | null | undefined, lk: Lookups): string | null {
  if (!id) return null;
  return lk.cashBoxes[id] || COMPANY_TREASURY_LABEL;
}

function derivePaymentMethod(ctx: Record<string, any>): string | null {
  if (ctx.payment_method) return String(ctx.payment_method);
  const pairs: Array<[string, string]> = [
    ["cash_amount", "نقدي"],
    ["instapay_amount", "انستا باي"],
    ["mobile_cash_amount", "فودافون كاش"],
    ["arabic_tourism_cash_amount", "السياحة العربية كاش"],
    ["merchant_cash_amount", "عبر تاجر كاش"],
  ];
  const active = pairs.filter(([k]) => Number(ctx[k]) > 0).map(([, v]) => v);
  return active.length ? active.join(" + ") : null;
}

function pickAmount(ctx: Record<string, any>): { amount: number | null; currency: string | null } {
  const amt =
    Number(ctx.total_paid) ||
    Number(ctx.amount) ||
    Number(ctx.usd_amount) ||
    Number(ctx.bought_amount) ||
    Number(ctx.sold_amount) ||
    Number(ctx.cash_amount) ||
    null;
  const cur =
    ctx.currency ||
    ctx.payment_currency ||
    ctx.bought_currency ||
    ctx.sold_currency ||
    ctx.opening_currency ||
    null;
  return { amount: amt || null, currency: cur || null };
}

/**
 * Derive a "from → method → to" description of the underlying financial movement
 * from the audited row snapshot. Rules are heuristic per table_name.
 */
function deriveFlow(tableName: string, ctx: Record<string, any>, lk: Lookups, auditRow?: AuditRow) {
  // Fall back to audit row.entity_id when the snapshot didn't include the FK column.
  const et = auditRow?.entity_type || null;
  const eid = auditRow?.entity_id || null;
  const agentId = ctx.agent_id || (et === "agent" ? eid : null);
  const companyId = ctx.company_id || (et === "company" ? eid : null);
  const merchantId = ctx.merchant_id || (et === "merchant" ? eid : null);
  const supplierId = ctx.supplier_id || (et === "currency_supplier" ? eid : null);

  const agent = agentId ? (lk.agents[agentId] || "وكيل غير معروف") : null;
  const company = companyId ? (lk.companies[companyId] || "شركة غير معروفة") : null;
  const merchant = merchantId ? (lk.merchants[merchantId] || "تاجر كاش غير معروف") : null;
  const supplier = supplierId ? (lk.suppliers[supplierId] || "مورد عملة غير معروف") : null;
  const cashBox = resolveCashBox(ctx.cash_box_id, lk);
  const fromBox = resolveCashBox(ctx.from_cash_box_id, lk);
  const toBox = resolveCashBox(ctx.to_cash_box_id, lk);


  let from: string | null = null;
  let to: string | null = null;
  let method: string | null = derivePaymentMethod(ctx);
  const isPayIn = ["دفعة", "in", "buy", "شراء"].includes(String(ctx.tx_type || ctx.type || ""));

  switch (tableName) {
    case "transactions":
      from = agent;
      to = merchant ? `تاجر الكاش ${merchant}` : COMPANY_TREASURY_LABEL;
      break;
    case "company_transactions":
      from = merchant ? `تاجر الكاش ${merchant}` : COMPANY_TREASURY_LABEL;
      to = company;
      break;
    case "merchant_cash_collections":
      from = merchant ? `تاجر الكاش ${merchant}` : null;
      to = COMPANY_TREASURY_LABEL;
      if (!method) method = "نقدي";
      break;
    case "currency_supplier_transactions": {
      const buying = String(ctx.tx_type || "").includes("buy") || Number(ctx.bought_amount) > 0;
      if (buying) { from = COMPANY_TREASURY_LABEL; to = supplier; }
      else { from = supplier; to = COMPANY_TREASURY_LABEL; }
      break;
    }
    case "usd_treasury_transactions":
      from = fromBox || cashBox || COMPANY_TREASURY_LABEL;
      to = toBox || company || (merchant ? `تاجر الكاش ${merchant}` : null) || COMPANY_TREASURY_LABEL;
      break;
    case "expense_deductions":
      from = merchant ? `تاجر الكاش ${merchant}` : COMPANY_TREASURY_LABEL;
      to = "مصروف";
      break;
    case "payment_splits": {
      const outflow = String(ctx.direction || "in") === "out";
      const box = cashBox || COMPANY_TREASURY_LABEL;
      from = outflow ? box : null;
      to = outflow ? null : box;
      break;
    }
    default:
      from = agent || merchant || supplier || cashBox;
      to = company || cashBox;
  }

  // Fallbacks — never leave everything empty when we do have entities.
  if (!from && !to) {
    from = agent || merchant || supplier || cashBox;
    to = company || cashBox;
  }

  const { amount, currency } = pickAmount(ctx);
  return {
    from: from || "—",
    method: method || "—",
    to: to || "—",
    amount,
    currency,
    _isPayIn: isPayIn,
  };
}


function AuditLogPage() {
  const { permissions, isAdmin, isSuperAdmin } = useAuth();
  const allowed = isSuperAdmin || isAdmin || checkPerm(permissions, false, "audit_log_view", "view");
  const canExport = isSuperAdmin || isAdmin || checkPerm(permissions, false, "audit_log_view", "export");

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [lookups, setLookups] = useState<Lookups>({
    agents: {}, companies: {}, merchants: {}, suppliers: {}, cashBoxes: {},
  });
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [action, setAction] = useState<string>("");
  const [tableName, setTableName] = useState<string>("");
  const [entityType, setEntityType] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [q, setQ] = useState<string>("");

  // Load entity name lookups once so the modal can render human names instead of IDs.
  useEffect(() => {
    (async () => {
      const [ag, co, me, su, cb] = await Promise.all([
        supabase.from("agents").select("id,name"),
        supabase.from("issuing_companies").select("id,company_name"),
        supabase.from("merchants").select("id,merchant_name"),
        supabase.from("currency_suppliers").select("id,name"),
        supabase.from("cash_boxes").select("id,name,currency"),
      ]);
      const toMap = (rs: any[] | null, k: string) =>
        (rs || []).reduce<Record<string, string>>((m, r) => { if (r?.id && r?.[k]) m[r.id] = r[k]; return m; }, {});
      setLookups({
        agents: toMap(ag.data as any, "name"),
        companies: toMap(co.data as any, "company_name"),
        merchants: toMap(me.data as any, "merchant_name"),
        suppliers: toMap(su.data as any, "name"),
        cashBoxes: (cb.data || []).reduce<Record<string, string>>((m: any, r: any) => {
          if (!r?.id) return m;
          m[r.id] = r.currency ? `${r.name} — ${r.currency}` : r.name;
          return m;
        }, {}),
      });
    })();
  }, []);



  const refresh = async () => {
    if (!allowed) return;
    setLoading(true);
    try {
      let query = supabase
        .from("financial_audit_log")
        .select("*")
        .order("performed_at", { ascending: false })
        .limit(2000);
      if (from) query = query.gte("performed_at", `${from}T00:00:00`);
      if (to) query = query.lte("performed_at", `${to}T23:59:59`);
      if (action) query = query.eq("action", action);
      if (tableName) query = query.eq("table_name", tableName);
      if (entityType) query = query.eq("entity_type", entityType);
      if (userId) query = query.eq("performed_by", userId);
      const { data, error } = await query;
      if (error) throw error;
      setRows((data || []) as any);

      const uids = Array.from(new Set((data || []).map((r: any) => r.performed_by).filter(Boolean)));
      if (uids.length) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id,full_name,email")
          .in("id", uids);
        const map: Record<string, string> = {};
        (profs || []).forEach((p: any) => {
          map[p.id] = p.full_name || p.email || p.id;
        });
        setUsers(map);
      }
    } catch (e: any) {
      toast.error(e?.message || "تعذر تحميل السجل");
    } finally {
      setLoading(false);
    }
  };

  // Auto-refresh whenever any server-side filter changes (no apply button).
  useEffect(() => {
    const t = setTimeout(() => { refresh(); }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, action, tableName, entityType, userId]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return rows;
    return rows.filter((r) => {
      const hay = [
        r.reason,
        r.reference_no,
        r.record_id,
        r.entity_id,
        TABLE_LABEL[r.table_name],
        ACTION_LABEL[r.action],
        ENTITY_LABEL[r.entity_type || ""],
        users[r.performed_by || ""],
      ].filter(Boolean).join(" ").toLowerCase();
      return hay.includes(s);
    });
  }, [rows, q, users]);

  if (!allowed) {
    return (
      <div className="page" dir="rtl">
        <div className="card"><div className="card-body" style={{ textAlign: "center", padding: 40, color: "var(--text3)" }}>لا تملك صلاحية عرض سجل التدقيق.</div></div>
      </div>
    );
  }

  const buildExportData = () => ({
    title: "سجل تدقيق الحركات المالية",
    subtitle: `عدد العمليات: ${filtered.length}`,
    fileName: `audit-log-${new Date().toISOString().slice(0, 10)}`,
    columns: [
      { header: "التاريخ والوقت", key: "when" },
      { header: "المستخدم", key: "user" },
      { header: "العملية", key: "action" },
      { header: "نوع الحركة", key: "table" },
      { header: "نوع الجهة", key: "entity" },
      { header: "رقم المرجع", key: "ref" },
      { header: "السبب", key: "reason" },
    ],
    rows: filtered.map((r) => ({
      when: new Date(r.performed_at).toLocaleString("ar-EG"),
      user: users[r.performed_by || ""] || r.performed_by || "—",
      action: ACTION_LABEL[r.action] || r.action,
      table: TABLE_LABEL[r.table_name] || r.table_name,
      entity: ENTITY_LABEL[r.entity_type || ""] || r.entity_type || "—",
      ref: r.reference_no || "—",
      reason: r.reason || "—",
    })),
  });

  return (
    <div className="page" dir="rtl">
      <div className="page-header">
        <div className="page-title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <FileClock size={20} strokeWidth={2} />
          <span>سجل تدقيق الحركات المالية</span>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button className="btn btn-outline" onClick={refresh} disabled={loading}>
            <RefreshCcw size={14} /> تحديث
          </button>
          {canExport && (
            <ExportButton getData={buildExportData} disabled={loading || filtered.length === 0} />
          )}
        </div>
      </div>


      <div className="card">
        <div className="card-header"><div className="card-title">🔍 الفلاتر</div></div>
        <div className="card-body">
          <div className="filter-bar">
            <input type="date" className="filter-select" value={from} onChange={(e)=>setFrom(e.target.value)} title="من تاريخ" />
            <input type="date" className="filter-select" value={to} onChange={(e)=>setTo(e.target.value)} title="إلى تاريخ" />
            <select className="filter-select" value={action} onChange={(e)=>setAction(e.target.value)}>
              <option value="">كل العمليات</option>
              {Object.entries(ACTION_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
            <select className="filter-select" value={tableName} onChange={(e)=>setTableName(e.target.value)}>
              <option value="">كل أنواع الحركات</option>
              {Object.entries(TABLE_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
            <select className="filter-select" value={entityType} onChange={(e)=>setEntityType(e.target.value)}>
              <option value="">كل الجهات</option>
              {Object.entries(ENTITY_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
            <select className="filter-select" value={userId} onChange={(e)=>setUserId(e.target.value)}>
              <option value="">كل المستخدمين</option>
              {Object.entries(users).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
            <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
              <Search size={14} style={{ position: "absolute", top: 12, insetInlineEnd: 10, color: "var(--text3)" }} />
              <input
                className="search-input"
                value={q}
                onChange={(e)=>setQ(e.target.value)}
                placeholder="بحث حر: سبب / مرجع / جهة / مستخدم..."
                style={{ paddingInlineEnd: 32 }}
              />
            </div>
          </div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title">📋 السجل — {filtered.length} عملية</div></div>
        <div className="card-body">
          <div className="table-wrap enterprise-table">
            <table className="mobile-cards">
              <thead>
                <tr>
                  <th>التاريخ والوقت</th>
                  <th>المستخدم</th>
                  <th>العملية</th>
                  <th>نوع الحركة</th>
                  <th>نوع الجهة</th>
                  <th>رقم المرجع</th>
                  <th>السبب</th>
                  <th style={{ textAlign: "center" }}>تفاصيل</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8}><div className="empty"><div className="empty-text">جارٍ التحميل…</div></div></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={8}><div className="empty"><div className="empty-icon">📋</div><div className="empty-text">لا توجد سجلات مطابقة</div></div></td></tr>
                ) : filtered.map((r) => (
                  <tr key={r.id}>
                    <td data-label="التاريخ والوقت" style={{ whiteSpace: "nowrap" }}>{new Date(r.performed_at).toLocaleString("ar-EG")}</td>
                    <td data-label="المستخدم">{users[r.performed_by || ""] || "—"}</td>
                    <td data-label="العملية">
                      <span className={`badge pill-badge ${ACTION_BADGE[r.action] || ""}`}>{ACTION_LABEL[r.action] || r.action}</span>
                    </td>
                    <td data-label="نوع الحركة">{TABLE_LABEL[r.table_name] || r.table_name}</td>
                    <td data-label="نوع الجهة">{ENTITY_LABEL[r.entity_type || ""] || r.entity_type || "—"}</td>
                    <td data-label="رقم المرجع">{r.reference_no || "—"}</td>
                    <td data-label="السبب" style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={r.reason || ""}>{r.reason || "—"}</td>
                    <td data-label="تفاصيل" style={{ textAlign: "center" }}>
                      <button className="action-btn" onClick={()=>setSelected(r)} title="عرض التفاصيل">
                        <Eye size={14} /> عرض
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {selected && (
        <DetailsModal
          row={selected}
          userLabel={users[selected.performed_by || ""] || selected.performed_by || "—"}
          lookups={lookups}
          onClose={()=>setSelected(null)}
        />
      )}
    </div>
  );
}

function DetailsModal({ row, userLabel, lookups, onClose }: { row: AuditRow; userLabel: string; lookups: Lookups; onClose: () => void }) {
  const before = (row.before_value || {}) as Record<string, any>;
  const after = (row.after_value || {}) as Record<string, any>;
  const allKeys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((k) => !HIDDEN_FIELDS.has(k));

  // Only show fields that actually changed (for edit). For create/cancel/etc.
  // show all non-null after fields when before is empty, or vice versa.
  const changedKeys = allKeys.filter((k) => JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]));
  const rowsToShow = row.action === "edit"
    ? changedKeys
    : allKeys.filter((k) => (after?.[k] ?? before?.[k]) !== null && (after?.[k] ?? before?.[k]) !== undefined && (after?.[k] ?? before?.[k]) !== "");

  const context = { ...before, ...after };
  const flow = deriveFlow(row.table_name, context, lookups);


  return (
    <Modal
      open={true}
      onClose={onClose}
      maxWidth={960}
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          تفاصيل العملية
          <span className={`badge pill-badge ${ACTION_BADGE[row.action] || ""}`}>{ACTION_LABEL[row.action] || row.action}</span>
        </span>
      }
      footer={<button className="btn btn-outline" onClick={onClose}>إغلاق</button>}
    >
      <div dir="rtl" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Operation info card */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header"><div className="card-title">🧾 معلومات العملية</div></div>
          <div className="card-body">
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
              <InfoCell label="نوع العملية" value={ACTION_LABEL[row.action] || row.action} />
              <InfoCell label="المستخدم" value={userLabel} />
              <InfoCell label="التاريخ والوقت" value={new Date(row.performed_at).toLocaleString("ar-EG")} />
              <InfoCell label="نوع الحركة" value={TABLE_LABEL[row.table_name] || row.table_name} />
              <InfoCell label="نوع الجهة" value={ENTITY_LABEL[row.entity_type || ""] || row.entity_type || "—"} />
              <InfoCell label="رقم المرجع" value={row.reference_no || "—"} />
              <InfoCell label="السبب" value={row.reason || "—"} full />
            </div>
          </div>
        </div>

        {/* Financial flow path card */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header"><div className="card-title">🔀 مسار الحركة المالية</div></div>
          <div className="card-body">
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr auto 1fr", gap: 10, alignItems: "stretch" }}>
              <FlowNode label="من" value={flow.from} tone="red" />
              <FlowArrow />
              <FlowNode label="وسيلة الدفع / الخزينة" value={flow.method} tone="gold" />
              <FlowArrow />
              <FlowNode label="إلى" value={flow.to} tone="green" />
            </div>
            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
              <InfoCell
                label="المبلغ"
                value={flow.amount != null ? fmtCurrency(flow.amount, flow.currency) : "—"}
              />
              <InfoCell label="العملة" value={flow.currency || "—"} />
            </div>
          </div>
        </div>


        {/* Comparison card */}
        <div className="card" style={{ margin: 0 }}>
          <div className="card-header">
            <div className="card-title">
              🔄 مقارنة الحقول
              <span style={{ color: "var(--text3)", fontWeight: 400, fontSize: 12, marginInlineStart: 8 }}>
                (الحقول {row.action === "edit" ? "المتغيرة فقط" : "المتعلقة بالحركة"})
              </span>
            </div>
          </div>
          <div className="card-body">
            <div className="table-wrap enterprise-table" style={{ maxHeight: 420, overflow: "auto" }}>
              <table className="mobile-cards">
                <thead>
                  <tr>
                    <th style={{ width: "28%" }}>الحقل</th>
                    <th>قبل</th>
                    <th>بعد</th>
                  </tr>
                </thead>
                <tbody>
                  {rowsToShow.length === 0 ? (
                    <tr><td colSpan={3}><div className="empty"><div className="empty-text">لا توجد بيانات للمقارنة</div></div></td></tr>
                  ) : rowsToShow.map((k) => {
                    const b = formatValue(k, before?.[k], context);
                    const a = formatValue(k, after?.[k], context);
                    const isChanged = JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k]);
                    return (
                      <tr key={k}>
                        <td data-label="الحقل" style={{ fontWeight: 700 }}>{fieldLabel(k)}</td>
                        <td data-label="قبل">
                          <span
                            className="badge pill-badge"
                            style={isChanged ? {
                              background: "color-mix(in oklab, var(--red) 12%, transparent)",
                              color: "var(--red)",
                              border: "1px solid color-mix(in oklab, var(--red) 30%, transparent)",
                            } : undefined}
                          >{b}</span>
                        </td>
                        <td data-label="بعد">
                          <span
                            className="badge pill-badge"
                            style={isChanged ? {
                              background: "color-mix(in oklab, var(--green) 12%, transparent)",
                              color: "var(--green)",
                              border: "1px solid color-mix(in oklab, var(--green) 30%, transparent)",
                            } : undefined}
                          >{a}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function InfoCell({ label, value, full }: { label: string; value: string; full?: boolean }) {
  return (
    <div style={{
      background: "var(--card2, var(--card))",
      border: "1px solid var(--border)",
      borderRadius: 8,
      padding: "8px 10px",
      gridColumn: full ? "1 / -1" : undefined,
    }}>
      <div style={{ fontSize: 11, color: "var(--text3)", marginBottom: 4, fontWeight: 700 }}>{label}</div>
      <div style={{ fontSize: 13, color: "var(--text)", fontWeight: 600 }}>{value}</div>
    </div>
  );
}

function FlowNode({ label, value, tone }: { label: string; value: string; tone: "red" | "green" | "gold" }) {
  const color =
    tone === "red" ? "var(--red)" :
    tone === "green" ? "var(--green)" :
    "var(--gold2, #B45309)";
  return (
    <div style={{
      background: "var(--card2, var(--card))",
      border: `1px solid color-mix(in oklab, ${color} 35%, var(--border))`,
      borderRadius: 10,
      padding: "10px 12px",
      display: "flex",
      flexDirection: "column",
      gap: 4,
      minWidth: 0,
    }}>
      <div style={{ fontSize: 11, color, fontWeight: 800 }}>{label}</div>
      <div style={{ fontSize: 14, color: "var(--text)", fontWeight: 700, overflowWrap: "anywhere" }}>{value}</div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text3)", fontSize: 20, fontWeight: 700 }}>
      ←
    </div>
  );
}
