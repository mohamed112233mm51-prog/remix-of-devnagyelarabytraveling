import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { useLive } from "@/lib/db";
import { toast } from "sonner";
import { usePerm } from "@/hooks/usePerm";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { Search, UserPlus, FileText, Coins, ChevronLeft } from "lucide-react";

export const Route = createFileRoute("/currency-suppliers")({
  component: () => <AppErrorBoundary><CurrencySuppliersPage /></AppErrorBoundary>,
});

type Supplier = {
  id: string;
  name: string;
  phone: string | null;
  notes: string | null;
  status: string;
  created_at: string;
};

function CurrencySuppliersPage() {
  const perm = usePerm("currency_suppliers");
  const navigate = useNavigate();
  // Use direct fetch (table not in useLive enum). Simple list with manual refresh.
  const [reloadTick, setReloadTick] = useState(0);
  const [rows, setRows] = useState<Supplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editRow, setEditRow] = useState<Supplier | null>(null);

  useMemo(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("currency_suppliers" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (cancel) return;
      if (error) toast.error(error.message);
      setRows((data as any) || []);
      setLoading(false);
    })();
    return () => { cancel = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reloadTick]);

  const refresh = () => setReloadTick((n) => n + 1);

  const debounced = useDebouncedValue(search, 200);
  const filtered = useMemo(() =>
    rows.filter((r) => !debounced || r.name.toLowerCase().includes(debounced.toLowerCase()) || (r.phone || "").includes(debounced)),
    [rows, debounced],
  );

  return (
    <div className="section active accounts-page">
      <div className="page-head">
        <div className="page-head-text">
          <div className="breadcrumb-row">
            <span>الحسابات المالية</span>
            <ChevronLeft size={12} strokeWidth={2} />
            <span className="crumb-current">حسابات موردي العملة</span>
          </div>
          <h1 className="page-h1"><Coins size={20} strokeWidth={2.2} /> حسابات موردي العملة</h1>
          <div className="page-sub">إدارة الموردين وحركات شراء وبيع العملات</div>
        </div>
        {perm.create && (
          <button className="btn btn-gold page-head-cta" onClick={() => setShowAdd(true)} type="button">
            <UserPlus size={16} strokeWidth={2.2} /> إضافة مورد
          </button>
        )}
      </div>

      <div className="filter-bar">
        <div className="search-wrap">
          <Search size={15} strokeWidth={2} className="search-wrap-icon" />
          <input
            className="search-input search-input--with-icon"
            placeholder="ابحث بالاسم أو الهاتف..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">قائمة الموردين <span className="muted-count">({filtered.length})</span></div>
        </div>
        <div className="card-body">
          <div className="table-wrap enterprise-table">
            <table className="mobile-cards">
              <thead>
                <tr>
                  <th>#</th>
                  <th>اسم المورد</th>
                  <th>الهاتف</th>
                  <th>الحالة</th>
                  <th>ملاحظات</th>
                  <th>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6}><div className="empty"><div className="empty-text">جارٍ التحميل...</div></div></td></tr>
                ) : filtered.length === 0 ? (
                  <tr><td colSpan={6}><div className="empty"><div className="empty-icon">💱</div><div className="empty-text">لا يوجد موردون — أضف أول مورد</div></div></td></tr>
                ) : filtered.map((s, i) => (
                  <tr key={s.id}>
                    <td data-label="#">{i + 1}</td>
                    <td className="bold" data-label="الاسم">{s.name}</td>
                    <td data-label="الهاتف">{s.phone || "—"}</td>
                    <td data-label="الحالة"><span className={`badge pill-badge ${s.status === "نشط" ? "badge-green" : "badge-red"}`}>{s.status}</span></td>
                    <td data-label="ملاحظات">{s.notes || "—"}</td>
                    <td data-label="إجراءات" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <button className="action-btn" onClick={() => navigate({ to: "/currency-supplier-statement/$supplierId", params: { supplierId: s.id } })}>
                        <FileText size={13} /> كشف حساب
                      </button>
                      {perm.edit && <button className="action-btn" onClick={() => setEditRow(s)}>✏️ تعديل</button>}
                      {perm.delete && (
                        <button className="action-btn" onClick={async () => {
                          if (!confirm(`حذف المورد "${s.name}"؟ سيتم حذف جميع حركاته.`)) return;
                          const { error } = await supabase.from("currency_suppliers" as any).delete().eq("id", s.id);
                          if (error) return toast.error(error.message);
                          toast.success("تم الحذف");
                          refresh();
                        }}>🗑 حذف</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showAdd && perm.create && (
        <SupplierModal onClose={() => setShowAdd(false)} onSaved={() => { setShowAdd(false); refresh(); }} />
      )}
      {editRow && perm.edit && (
        <SupplierModal supplier={editRow} onClose={() => setEditRow(null)} onSaved={() => { setEditRow(null); refresh(); }} />
      )}
    </div>
  );
}

function SupplierModal({ supplier, onClose, onSaved }: { supplier?: Supplier; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    name: supplier?.name || "",
    phone: supplier?.phone || "",
    notes: supplier?.notes || "",
    status: supplier?.status || "نشط",
  });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.name.trim()) return toast.error("اسم المورد مطلوب");
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
      status: form.status,
    };
    if (supplier) {
      const { error } = await supabase.from("currency_suppliers" as any).update(payload).eq("id", supplier.id);
      if (error) return toast.error(error.message);
      toast.success("تم التحديث");
    } else {
      const { error } = await supabase.from("currency_suppliers" as any).insert(payload);
      if (error) return toast.error(error.message);
      toast.success("تمت إضافة المورد");
    }
    onSaved();
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 560, width: "100%", margin: 0 }}>
        <div className="card-header"><div className="card-title">{supplier ? "✏️ تعديل المورد" : "➕ إضافة مورد"}</div></div>
        <div className="form-grid">
          <div className="form-group"><label>اسم المورد</label><input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="form-group"><label>الحالة</label>
            <select value={form.status} onChange={(e) => set("status", e.target.value)}>
              <option value="نشط">نشط</option>
              <option value="غير نشط">غير نشط</option>
            </select>
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>ملاحظات</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
          </div>
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="action-btn" onClick={onClose}>إلغاء</button>
          <button className="btn btn-gold" onClick={save}>💾 حفظ</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
