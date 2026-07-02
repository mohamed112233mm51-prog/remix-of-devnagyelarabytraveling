import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
// useLive does not yet support this table; we fetch directly.
import { toast } from "sonner";
import { confirmDialog } from "@/lib/confirm";
import { usePerm } from "@/hooks/usePerm";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { Search, UserPlus, FileText, Coins, ChevronLeft, Pencil, Trash2 } from "lucide-react";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { syncCurrencySupplierOpeningBalance } from "@/lib/openingBalance";

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
  opening_debit?: number;
  opening_credit?: number;
  opening_currency?: string;
  opening_date?: string | null;
  opening_note?: string | null;
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

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("currency_suppliers" as any)
        .select("*")
        .order("created_at", { ascending: false });
      if (cancel) return;
      if (error) toast.error(error.message);
      setRows(((data as any) || []) as Supplier[]);
      setLoading(false);
    })();
    return () => { cancel = true; };
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
                    <td data-label="إجراءات">
                      <div style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
                        <button
                          type="button"
                          className="action-btn icon-only"
                          onClick={() => navigate({ to: "/currency-supplier-statement/$supplierId", params: { supplierId: s.id } })}
                          title="كشف حساب"
                          aria-label="كشف حساب"
                          style={{ width: 28, height: 28, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, color: "var(--primary, #0284C7)" }}
                        >
                          <FileText size={14} strokeWidth={2} />
                        </button>
                        {perm.edit && (
                          <button
                            type="button"
                            className="action-btn icon-only"
                            onClick={() => setEditRow(s)}
                            title="تعديل المورد"
                            aria-label="تعديل المورد"
                            style={{ width: 28, height: 28, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6 }}
                          >
                            <Pencil size={14} strokeWidth={2} />
                          </button>
                        )}
                        {perm.delete && (
                          <button
                            type="button"
                            className="action-btn icon-only"
                            onClick={async () => {
                              // Check for linked records before deletion
                              const { count } = await supabase
                                .from("currency_supplier_transactions" as any)
                                .select("id", { count: "exact", head: true })
                                .eq("supplier_id", s.id);
                              const linked = (count || 0) > 0;
                              if (linked) {
                                const ok = await confirmDialog(
                                  `هذا المورد "${s.name}" لديه بيانات مرتبطة. يفضل تعطيله بدلاً من حذفه للحفاظ على البيانات التاريخية.`,
                                  { confirmLabel: "تعطيل المورد", cancelLabel: "إلغاء" },
                                );
                                if (!ok) return;
                                const { error } = await supabase.from("currency_suppliers" as any).update({ status: "غير نشط" }).eq("id", s.id);
                                if (error) return toast.error(error.message);
                                toast.success("تم تعطيل المورد");
                                refresh();
                                return;
                              }
                              const ok = await confirmDialog(`حذف المورد "${s.name}"؟ لا توجد بيانات مرتبطة. لا يمكن التراجع.`, { confirmLabel: "حذف", cancelLabel: "إلغاء" });
                              if (!ok) return;
                              const { error } = await supabase.from("currency_suppliers" as any).delete().eq("id", s.id);
                              if (error) return toast.error(error.message);
                              toast.success("تم الحذف");
                              refresh();
                            }}
                            title="حذف المورد"
                            aria-label="حذف المورد"
                            style={{ width: 28, height: 28, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6, color: "var(--red, #dc2626)" }}
                          >
                            <Trash2 size={14} strokeWidth={2} />
                          </button>
                        )}
                      </div>
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
    opening_debit: supplier?.opening_debit ? String(supplier.opening_debit) : "",
    opening_credit: supplier?.opening_credit ? String(supplier.opening_credit) : "",
    opening_currency: supplier?.opening_currency || "EGP",
    opening_date: supplier?.opening_date || "",
    opening_note: supplier?.opening_note || "",
  });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const save = async () => {
    if (!form.name.trim()) return toast.error("اسم المورد مطلوب");
    const debit = Math.max(0, Number(form.opening_debit) || 0);
    const credit = Math.max(0, Number(form.opening_credit) || 0);
    const payload = {
      name: form.name.trim(),
      phone: form.phone.trim() || null,
      notes: form.notes.trim() || null,
      status: form.status,
      opening_debit: debit,
      opening_credit: credit,
      opening_currency: form.opening_currency || "EGP",
      opening_date: form.opening_date || null,
      opening_note: form.opening_note || null,
    };
    let id = supplier?.id;
    if (supplier) {
      const { error } = await supabase.from("currency_suppliers" as any).update(payload).eq("id", supplier.id);
      if (error) return toast.error(error.message);
    } else {
      const { data, error } = await supabase.from("currency_suppliers" as any).insert(payload).select("id").maybeSingle();
      if (error) return toast.error(error.message);
      id = (data as any)?.id;
    }
    if (id && (debit > 0 || credit > 0)) {
      try {
        await syncCurrencySupplierOpeningBalance(id, {
          debit, credit,
          currency: form.opening_currency || "EGP",
          date: form.opening_date || null,
          note: form.opening_note || null,
        });
      } catch (e: any) {
        return toast.error(String(e?.message || "").includes("ux_currency_supplier_opening_row")
          ? "يوجد رصيد سابق لهذه الجهة بهذه العملة"
          : (e?.message || "فشل حفظ الرصيد السابق"));
      }
    }
    toast.success(supplier ? "تم التحديث" : "تمت إضافة المورد");
    onSaved();
  };
  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 640, width: "100%", margin: 0, maxHeight: "90vh", overflow: "auto" }}>
        <div className="card-header"><div className="card-title">{supplier ? "✏️ تعديل المورد" : "➕ إضافة مورد"}</div></div>
        <div className="form-grid">
          <div className="form-group"><label>اسم المورد</label><input value={form.name} onChange={(e) => set("name", e.target.value)} /></div>
          <div className="form-group"><label>الهاتف</label><input value={form.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="form-group"><label>الحالة</label>
            <SearchableSelect value={form.status} onChange={(v) => set("status", v)} options={["نشط", "غير نشط"]} allowClear={false} />
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>ملاحظات</label>
            <textarea value={form.notes} onChange={(e) => set("notes", e.target.value)} rows={3} />
          </div>
          <div className="form-group full" style={{ gridColumn: "1 / -1", marginTop: 8, padding: 12, border: "1px dashed var(--border)", borderRadius: 8 }}>
            <label style={{ fontWeight: 700, marginBottom: 8 }}>رصيد سابق (اختياري)</label>
            <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
              <div className="form-group"><label>مدين (له علينا)</label><input type="number" min={0} value={form.opening_debit} onChange={(e) => set("opening_debit", e.target.value)} /></div>
              <div className="form-group"><label>دائن (علينا له)</label><input type="number" min={0} value={form.opening_credit} onChange={(e) => set("opening_credit", e.target.value)} /></div>
              <div className="form-group"><label>العملة</label>
                <select value={form.opening_currency} onChange={(e) => set("opening_currency", e.target.value)}>
                  <option value="EGP">جنيه مصري</option>
                  <option value="USD">دولار أمريكي</option>
                  <option value="LYD">دينار ليبي</option>
                </select>
              </div>
              <div className="form-group"><label>التاريخ</label><input type="date" value={form.opening_date} onChange={(e) => set("opening_date", e.target.value)} /></div>
              <div className="form-group full"><label>ملاحظات</label><input value={form.opening_note} onChange={(e) => set("opening_note", e.target.value)} /></div>
            </div>
          </div>
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="action-btn" onClick={onClose}>إلغاء</button>
          <button data-confirm-save="تأكيد حفظ المورّد" className="btn btn-gold" onClick={save}>💾 حفظ</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

