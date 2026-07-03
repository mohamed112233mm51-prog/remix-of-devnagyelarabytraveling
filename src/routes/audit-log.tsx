import { createFileRoute, redirect } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { checkPerm } from "@/hooks/usePerm";
import { Modal } from "@/components/Modal";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { toDisplayDate } from "@/lib/dateFormat";
import { FileClock, Search, Eye, Download, Printer, RefreshCcw } from "lucide-react";

export const Route = createFileRoute("/audit-log")({
  component: AuditLogPage,
  beforeLoad: () => {
    // Client-side gate only — deeper enforcement happens in the component.
  },
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
const ACTION_COLOR: Record<string, string> = {
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

function AuditLogPage() {
  const { permissions, isAdmin, isSuperAdmin } = useAuth();
  const allowed = isSuperAdmin || isAdmin || checkPerm(permissions, false, "audit_log_view", "view");
  const canExport = isSuperAdmin || isAdmin || checkPerm(permissions, false, "audit_log_view", "export");

  const [rows, setRows] = useState<AuditRow[]>([]);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AuditRow | null>(null);

  const [from, setFrom] = useState<string>("");
  const [to, setTo] = useState<string>("");
  const [action, setAction] = useState<string>("");
  const [tableName, setTableName] = useState<string>("");
  const [entityType, setEntityType] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [refNo, setRefNo] = useState<string>("");
  const [q, setQ] = useState<string>("");

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
      if (refNo.trim()) query = query.ilike("reference_no", `%${refNo.trim()}%`);
      const { data, error } = await query;
      if (error) throw error;
      setRows((data || []) as any);

      // fetch user labels for the rows we just got
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

  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, []);

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
      <div className="p-6" dir="rtl">
        <div className="card p-8 text-center text-muted-foreground">لا تملك صلاحية عرض سجل التدقيق.</div>
      </div>
    );
  }

  const exportCSV = () => {
    if (!canExport) { toast.error("لا تملك صلاحية التصدير"); return; }
    const header = ["التاريخ والوقت","المستخدم","العملية","نوع الحركة","نوع الجهة","رقم المرجع","السبب","record_id"];
    const lines = [header.join(",")];
    filtered.forEach((r) => {
      const cells = [
        new Date(r.performed_at).toLocaleString("ar-EG"),
        users[r.performed_by || ""] || r.performed_by || "",
        ACTION_LABEL[r.action] || r.action,
        TABLE_LABEL[r.table_name] || r.table_name,
        ENTITY_LABEL[r.entity_type || ""] || r.entity_type || "",
        r.reference_no || "",
        (r.reason || "").replace(/[\r\n,]/g, " "),
        r.record_id,
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
      lines.push(cells.join(","));
    });
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `audit-log-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  return (
    <div className="p-4 md:p-6 space-y-4" dir="rtl">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "var(--text)" }}>
          <FileClock size={22} /> سجل تدقيق الحركات المالية
        </h1>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={refresh} disabled={loading}>
            <RefreshCcw size={14} /> تحديث
          </Button>
          {canExport && (
            <>
              <Button variant="outline" onClick={exportCSV}><Download size={14} /> Excel/CSV</Button>
              <Button variant="outline" onClick={() => window.print()}><Printer size={14} /> طباعة</Button>
            </>
          )}
        </div>
      </div>

      <div className="card p-3">
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          <Field label="من"><input type="date" className="ip" value={from} onChange={(e)=>setFrom(e.target.value)} /></Field>
          <Field label="إلى"><input type="date" className="ip" value={to} onChange={(e)=>setTo(e.target.value)} /></Field>
          <Field label="العملية">
            <select className="ip" value={action} onChange={(e)=>setAction(e.target.value)}>
              <option value="">الكل</option>
              {Object.entries(ACTION_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="نوع الحركة">
            <select className="ip" value={tableName} onChange={(e)=>setTableName(e.target.value)}>
              <option value="">الكل</option>
              {Object.entries(TABLE_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="نوع الجهة">
            <select className="ip" value={entityType} onChange={(e)=>setEntityType(e.target.value)}>
              <option value="">الكل</option>
              {Object.entries(ENTITY_LABEL).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="المستخدم">
            <select className="ip" value={userId} onChange={(e)=>setUserId(e.target.value)}>
              <option value="">الكل</option>
              {Object.entries(users).map(([k,v])=><option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="رقم المرجع">
            <input className="ip" value={refNo} onChange={(e)=>setRefNo(e.target.value)} placeholder="بحث..." />
          </Field>
          <Field label="بحث حر">
            <div className="relative">
              <Search size={12} className="absolute top-2.5 right-2 text-muted-foreground" />
              <input className="ip pr-7" value={q} onChange={(e)=>setQ(e.target.value)} placeholder="سبب / جهة / مستخدم..." />
            </div>
          </Field>
        </div>
        <div className="mt-3 flex justify-end">
          <Button onClick={refresh} disabled={loading}>تطبيق الفلاتر</Button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="p-2 text-right">التاريخ والوقت</th>
                <th className="p-2 text-right">المستخدم</th>
                <th className="p-2 text-right">العملية</th>
                <th className="p-2 text-right">نوع الحركة</th>
                <th className="p-2 text-right">نوع الجهة</th>
                <th className="p-2 text-right">رقم المرجع</th>
                <th className="p-2 text-right">السبب</th>
                <th className="p-2 text-center">تفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">جارٍ التحميل…</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="p-6 text-center text-muted-foreground">لا توجد سجلات مطابقة.</td></tr>
              ) : filtered.map((r) => (
                <tr key={r.id} className="border-t hover:bg-muted/30">
                  <td className="p-2 whitespace-nowrap">{new Date(r.performed_at).toLocaleString("ar-EG")}</td>
                  <td className="p-2">{users[r.performed_by || ""] || "—"}</td>
                  <td className="p-2">
                    <span className={`badge pill-badge ${ACTION_COLOR[r.action] || ""}`}>{ACTION_LABEL[r.action] || r.action}</span>
                  </td>
                  <td className="p-2">{TABLE_LABEL[r.table_name] || r.table_name}</td>
                  <td className="p-2">{ENTITY_LABEL[r.entity_type || ""] || r.entity_type || "—"}</td>
                  <td className="p-2">{r.reference_no ? toDisplayDate(r.reference_no) || r.reference_no : "—"}</td>
                  <td className="p-2 max-w-[240px] truncate" title={r.reason || ""}>{r.reason || "—"}</td>
                  <td className="p-2 text-center">
                    <button className="action-btn" onClick={()=>setSelected(r)} title="عرض التفاصيل">
                      <Eye size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <DetailsModal row={selected} userLabel={users[selected.performed_by || ""] || selected.performed_by || "—"} onClose={()=>setSelected(null)} />
      )}

      <style>{`
        .ip { width: 100%; padding: 6px 8px; border: 1px solid var(--border); border-radius: 6px; background: var(--card, #fff); color: var(--text); font-size: 13px; }
        .ip:focus { outline: none; box-shadow: 0 0 0 2px color-mix(in oklab, var(--primary, #2563eb) 30%, transparent); }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-xs">
      <span className="text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

function DetailsModal({ row, userLabel, onClose }: { row: AuditRow; userLabel: string; onClose: () => void }) {
  const before = row.before_value || {};
  const after = row.after_value || {};
  const keys = Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((k) => !["created_at","updated_at"].includes(k));
  const changed = new Set<string>();
  keys.forEach((k) => {
    if (JSON.stringify(before?.[k]) !== JSON.stringify(after?.[k])) changed.add(k);
  });

  return (
    <Modal
      open={true}
      onClose={onClose}
      maxWidth={880}
      title={<span>تفاصيل عملية — {ACTION_LABEL[row.action] || row.action}</span>}
      footer={<Button variant="outline" onClick={onClose}>إغلاق</Button>}
    >
      <div dir="rtl" className="space-y-4 text-sm">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <Info label="المستخدم" value={userLabel} />
          <Info label="التاريخ والوقت" value={new Date(row.performed_at).toLocaleString("ar-EG")} />
          <Info label="العملية" value={ACTION_LABEL[row.action] || row.action} />
          <Info label="نوع الحركة" value={TABLE_LABEL[row.table_name] || row.table_name} />
          <Info label="نوع الجهة" value={ENTITY_LABEL[row.entity_type || ""] || row.entity_type || "—"} />
          <Info label="رقم المرجع" value={row.reference_no || "—"} />
          <Info label="رقم السجل" value={row.record_id} mono />
          <Info label="السبب" value={row.reason || "—"} full />
        </div>

        <div className="border-t pt-3">
          <div className="font-semibold mb-2">مقارنة الحقول <span className="text-muted-foreground text-xs">(الحقول المتغيرة مميزة)</span></div>
          <div className="overflow-auto max-h-96 border rounded">
            <table className="w-full text-xs">
              <thead className="bg-muted/50 sticky top-0">
                <tr>
                  <th className="p-2 text-right">الحقل</th>
                  <th className="p-2 text-right">قبل</th>
                  <th className="p-2 text-right">بعد</th>
                </tr>
              </thead>
              <tbody>
                {keys.length === 0 && <tr><td colSpan={3} className="p-3 text-center text-muted-foreground">لا توجد بيانات</td></tr>}
                {keys.map((k) => {
                  const isChanged = changed.has(k);
                  return (
                    <tr key={k} className={`border-t ${isChanged ? "bg-yellow-50" : ""}`}>
                      <td className="p-2 font-medium">{k}{isChanged && " •"}</td>
                      <td className="p-2 whitespace-pre-wrap break-all">{formatVal(before?.[k])}</td>
                      <td className="p-2 whitespace-pre-wrap break-all">{formatVal(after?.[k])}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function Info({ label, value, mono, full }: { label: string; value: string; mono?: boolean; full?: boolean }) {
  return (
    <div className={full ? "col-span-full" : ""}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={mono ? "font-mono text-xs break-all" : "text-sm"}>{value}</div>
    </div>
  );
}

function formatVal(v: any): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}
