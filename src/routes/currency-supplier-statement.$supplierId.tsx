import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { fmtNum } from "@/lib/db";
import { toast } from "sonner";
import { usePerm } from "@/hooks/usePerm";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { ExportButton } from "@/components/ExportButton";
import { ChevronLeft, Coins, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import type { StatementExportData } from "@/lib/exportStatement";

export const Route = createFileRoute("/currency-supplier-statement/$supplierId")({
  component: () => <AppErrorBoundary><CurrencySupplierStatementPage /></AppErrorBoundary>,
});

type Supplier = { id: string; name: string; phone: string | null; status: string; notes: string | null };
type Tx = {
  id: string;
  supplier_id: string;
  tx_date: string;
  tx_type: "شراء عملة" | "بيع عملة";
  bought_currency: string;
  bought_amount: number;
  sold_currency: string;
  sold_amount: number;
  description: string | null;
  created_at: string;
};
type CashBox = { id: string; name: string; currency: string; balance: number; is_active: boolean };

const CURRENCIES = ["جنيه مصري", "دولار", "يورو", "ريال سعودي", "درهم إماراتي", "دينار ليبي", "دينار كويتي"];

function CurrencySupplierStatementPage() {
  const { supplierId } = Route.useParams();
  const perm = usePerm("currency_suppliers");

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [txns, setTxns] = useState<Tx[]>([]);
  const [boxes, setBoxes] = useState<CashBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  const [showBuy, setShowBuy] = useState(false);
  const [showSell, setShowSell] = useState(false);

  // Filters
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [currencyFilter, setCurrencyFilter] = useState<string>("");

  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const [{ data: sup }, { data: tx, error: txErr }, { data: bx }] = await Promise.all([
        supabase.from("currency_suppliers" as any).select("*").eq("id", supplierId).maybeSingle(),
        supabase.from("currency_supplier_transactions" as any).select("*").eq("supplier_id", supplierId).order("tx_date", { ascending: true }),
        supabase.from("cash_boxes" as any).select("*"),
      ]);
      if (cancel) return;
      if (txErr) toast.error(txErr.message);
      setSupplier((sup as any) || null);
      setTxns(((tx as any) || []) as Tx[]);
      setBoxes(((bx as any) || []) as CashBox[]);
      setLoading(false);
    })();
    return () => { cancel = true; };
  }, [supplierId, reload]);

  const refresh = () => setReload((n) => n + 1);

  const filtered = useMemo(() => {
    return txns.filter((t) => {
      if (from && t.tx_date < from) return false;
      if (to && t.tx_date > to) return false;
      if (typeFilter && t.tx_type !== typeFilter) return false;
      if (currencyFilter && t.bought_currency !== currencyFilter && t.sold_currency !== currencyFilter) return false;
      return true;
    });
  }, [txns, from, to, typeFilter, currencyFilter]);

  // Per-currency net balance from supplier perspective
  const summary = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filtered) {
      map.set(t.bought_currency, (map.get(t.bought_currency) || 0) + Number(t.bought_amount || 0));
      map.set(t.sold_currency, (map.get(t.sold_currency) || 0) - Number(t.sold_amount || 0));
    }
    return Array.from(map.entries()).map(([cur, net]) => ({ currency: cur, net }));
  }, [filtered]);

  // Running balance per filter currency (if selected)
  const rowsWithBalance = useMemo(() => {
    let running = 0;
    return filtered.map((t) => {
      let delta = 0;
      if (currencyFilter) {
        if (t.bought_currency === currencyFilter) delta += Number(t.bought_amount || 0);
        if (t.sold_currency === currencyFilter) delta -= Number(t.sold_amount || 0);
      }
      running += delta;
      return { ...t, balance: currencyFilter ? running : null };
    });
  }, [filtered, currencyFilter]);

  const exportData = (): StatementExportData => ({
    title: `كشف حساب مورد عملة — ${supplier?.name || ""}`,
    subtitle: currencyFilter ? `العملة: ${currencyFilter}` : undefined,
    summary: summary.map((s) => ({ label: s.currency, value: `${fmtNum(s.net)}` })),
    columns: [
      { header: "التاريخ", key: "date" },
      { header: "نوع الحركة", key: "type" },
      { header: "العملة المشتراة", key: "bcur" },
      { header: "قيمة العملة المشتراة", key: "bamt" },
      { header: "العملة المباعة", key: "scur" },
      { header: "قيمة العملة المباعة", key: "samt" },
      { header: "البيان", key: "desc" },
      ...(currencyFilter ? [{ header: `الرصيد (${currencyFilter})`, key: "balance" }] : []),
    ],
    rows: rowsWithBalance.map((r) => ({
      date: r.tx_date,
      type: r.tx_type,
      bcur: r.bought_currency,
      bamt: Number(r.bought_amount || 0),
      scur: r.sold_currency,
      samt: Number(r.sold_amount || 0),
      desc: r.description || "—",
      ...(currencyFilter ? { balance: Number(r.balance || 0) } : {}),
    })),
    fileName: `currency-supplier-${supplier?.name || supplierId}`,
  });

  if (loading) return <div className="section active"><div className="card"><div className="card-body"><div className="empty">جارٍ التحميل...</div></div></div></div>;
  if (!supplier) return <div className="section active"><div className="card"><div className="card-body"><div className="empty">المورد غير موجود</div></div></div></div>;

  return (
    <div className="section active accounts-page">
      <div className="page-head">
        <div className="page-head-text">
          <div className="breadcrumb-row">
            <span>الحسابات المالية</span>
            <ChevronLeft size={12} strokeWidth={2} />
            <Link to="/currency-suppliers">حسابات موردي العملة</Link>
            <ChevronLeft size={12} strokeWidth={2} />
            <span className="crumb-current">{supplier.name}</span>
          </div>
          <h1 className="page-h1"><Coins size={20} strokeWidth={2.2} /> كشف حساب: {supplier.name}</h1>
          {supplier.phone && <div className="page-sub">الهاتف: {supplier.phone}</div>}
        </div>
      </div>

      {summary.length > 0 && (
        <div className="account-summary kpi-rich" style={{ flexWrap: "wrap" }}>
          {summary.map((s) => (
            <div key={s.currency} className={`sum-box ${s.net >= 0 ? "green" : "red"}`}>
              <div className="kpi-text">
                <div className="label">صافي {s.currency}</div>
                <div className="val">{fmtNum(s.net)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="action-toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
        {perm.create && (
          <>
            <button className="btn btn-gold" onClick={() => setShowBuy(true)} type="button">
              <ArrowDownCircle size={15} /> إضافة حركة شراء عملة
            </button>
            <button className="btn" onClick={() => setShowSell(true)} type="button" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <ArrowUpCircle size={15} /> إضافة حركة بيع عملة
            </button>
          </>
        )}
        {perm.export && <ExportButton getData={exportData} />}
      </div>

      <div className="filter-bar" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <div className="form-group" style={{ minWidth: 140 }}>
          <label>من تاريخ</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="form-group" style={{ minWidth: 140 }}>
          <label>إلى تاريخ</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
        <div className="form-group" style={{ minWidth: 160 }}>
          <label>نوع الحركة</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">الكل</option>
            <option value="شراء عملة">شراء عملة</option>
            <option value="بيع عملة">بيع عملة</option>
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 180 }}>
          <label>العملة</label>
          <select value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)}>
            <option value="">الكل</option>
            {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        {(from || to || typeFilter || currencyFilter) && (
          <button className="action-btn" style={{ alignSelf: "end" }} onClick={() => { setFrom(""); setTo(""); setTypeFilter(""); setCurrencyFilter(""); }}>
            مسح الفلاتر
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-header">
          <div className="card-title">الحركات <span className="muted-count">({filtered.length})</span></div>
        </div>
        <div className="card-body">
          <div className="table-wrap enterprise-table">
            <table className="mobile-cards">
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>نوع الحركة</th>
                  <th>العملة المشتراة</th>
                  <th className="num-col">قيمة المشتراة</th>
                  <th>العملة المباعة</th>
                  <th className="num-col">قيمة المباعة</th>
                  <th>البيان</th>
                  {currencyFilter && <th className="num-col">الرصيد ({currencyFilter})</th>}
                  {perm.delete && <th>إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {rowsWithBalance.length === 0 ? (
                  <tr><td colSpan={currencyFilter ? 9 : 8}><div className="empty"><div className="empty-text">لا توجد حركات</div></div></td></tr>
                ) : rowsWithBalance.map((r) => (
                  <tr key={r.id}>
                    <td data-label="التاريخ">{r.tx_date}</td>
                    <td data-label="النوع">
                      <span className={`badge pill-badge ${r.tx_type === "شراء عملة" ? "badge-green" : "badge-blue"}`}>{r.tx_type}</span>
                    </td>
                    <td data-label="العملة المشتراة">{r.bought_currency}</td>
                    <td className="num-col" data-label="قيمة المشتراة">{fmtNum(Number(r.bought_amount || 0))}</td>
                    <td data-label="العملة المباعة">{r.sold_currency}</td>
                    <td className="num-col" data-label="قيمة المباعة">{fmtNum(Number(r.sold_amount || 0))}</td>
                    <td data-label="البيان">{r.description || "—"}</td>
                    {currencyFilter && <td className="num-col" data-label="الرصيد" style={{ fontWeight: 700 }}>{fmtNum(Number(r.balance || 0))}</td>}
                    {perm.delete && (
                      <td data-label="إجراءات">
                        <button className="action-btn" onClick={async () => {
                          if (!confirm("حذف هذه الحركة؟ سيتم عكس تأثيرها على الخزائن.")) return;
                          // reverse cash boxes
                          await adjustCashBoxes(boxes, [
                            { currency: r.bought_currency, delta: -Number(r.bought_amount || 0) },
                            { currency: r.sold_currency, delta: +Number(r.sold_amount || 0) },
                          ]);
                          const { error } = await supabase.from("currency_supplier_transactions" as any).delete().eq("id", r.id);
                          if (error) return toast.error(error.message);
                          toast.success("تم حذف الحركة");
                          refresh();
                        }}>🗑</button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showBuy && perm.create && (
        <TxModal supplierId={supplierId} kind="شراء عملة" boxes={boxes} onClose={() => setShowBuy(false)} onSaved={() => { setShowBuy(false); refresh(); }} />
      )}
      {showSell && perm.create && (
        <TxModal supplierId={supplierId} kind="بيع عملة" boxes={boxes} onClose={() => setShowSell(false)} onSaved={() => { setShowSell(false); refresh(); }} />
      )}
    </div>
  );
}

async function adjustCashBoxes(boxes: CashBox[], changes: { currency: string; delta: number }[]) {
  for (const ch of changes) {
    if (!ch.currency || !ch.delta) continue;
    const box = boxes.find((b) => b.currency === ch.currency && b.is_active !== false);
    if (box) {
      await supabase.from("cash_boxes" as any).update({ balance: Number(box.balance || 0) + ch.delta }).eq("id", box.id);
    } else {
      // auto-create a cash box for this currency
      await supabase.from("cash_boxes" as any).insert({
        name: `خزينة ${ch.currency}`,
        currency: ch.currency,
        balance: ch.delta,
        is_active: true,
      });
    }
  }
}

function TxModal({ supplierId, kind, boxes, onClose, onSaved }: { supplierId: string; kind: "شراء عملة" | "بيع عملة"; boxes: CashBox[]; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    tx_date: new Date().toISOString().slice(0, 10),
    bought_currency: kind === "شراء عملة" ? "دولار" : "جنيه مصري",
    bought_amount: "",
    sold_currency: kind === "شراء عملة" ? "جنيه مصري" : "دولار",
    sold_amount: "",
    description: "",
  });
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const save = async () => {
    const bAmt = Number(form.bought_amount);
    const sAmt = Number(form.sold_amount);
    if (!form.tx_date) return toast.error("التاريخ مطلوب");
    if (!form.bought_currency || !form.sold_currency) return toast.error("اختر العملتين");
    if (!(bAmt > 0) || !(sAmt > 0)) return toast.error("القيم يجب أن تكون أكبر من صفر");
    if (form.bought_currency === form.sold_currency) return toast.error("لا يمكن أن تكون العملة المشتراة والمباعة متطابقتين");

    const { error } = await supabase.from("currency_supplier_transactions" as any).insert({
      supplier_id: supplierId,
      tx_date: form.tx_date,
      tx_type: kind,
      bought_currency: form.bought_currency,
      bought_amount: bAmt,
      sold_currency: form.sold_currency,
      sold_amount: sAmt,
      description: form.description.trim() || null,
    });
    if (error) return toast.error(error.message);
    // Update cash boxes: +bought, -sold
    await adjustCashBoxes(boxes, [
      { currency: form.bought_currency, delta: +bAmt },
      { currency: form.sold_currency, delta: -sAmt },
    ]);
    toast.success("تم حفظ الحركة");
    onSaved();
  };

  if (typeof document === "undefined") return null;
  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 720, width: "100%", margin: 0 }}>
        <div className="card-header"><div className="card-title">{kind === "شراء عملة" ? "💵 إضافة حركة شراء عملة" : "💱 إضافة حركة بيع عملة"}</div></div>
        <div className="form-grid">
          <div className="form-group"><label>التاريخ</label><input type="date" value={form.tx_date} onChange={(e) => set("tx_date", e.target.value)} /></div>
          <div className="form-group"><label>العملة المشتراة</label>
            <select value={form.bought_currency} onChange={(e) => set("bought_currency", e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group"><label>قيمة العملة المشتراة</label>
            <input type="number" step="0.01" value={form.bought_amount} onChange={(e) => set("bought_amount", e.target.value)} />
          </div>
          <div className="form-group"><label>العملة المباعة</label>
            <select value={form.sold_currency} onChange={(e) => set("sold_currency", e.target.value)}>
              {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group"><label>قيمة العملة المباعة</label>
            <input type="number" step="0.01" value={form.sold_amount} onChange={(e) => set("sold_amount", e.target.value)} />
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>البيان</label>
            <textarea value={form.description} onChange={(e) => set("description", e.target.value)} rows={2} />
          </div>
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button className="action-btn" onClick={onClose}>إلغاء</button>
          <button className="btn btn-gold" onClick={save}>💾 حفظ الحركة</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
