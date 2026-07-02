import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { fmtNum, type Merchant } from "@/lib/db";
import { toast } from "sonner";
import { confirmDialog } from "@/lib/confirm";
import { usePerm } from "@/hooks/usePerm";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { ExportButton } from "@/components/ExportButton";
import { ChevronLeft, Coins, ArrowDownCircle, ArrowUpCircle } from "lucide-react";
import type { StatementExportData } from "@/lib/exportStatement";
import {
  PaymentSplits,
  type PaymentSplitRow,
  newPaymentSplitRow,
  validatePaymentSplits,
  filterValidSplits,
} from "@/components/PaymentSplits";
import { useSourceBalances, validateSplitOutflows, validateSingleOutflow } from "@/lib/balanceGuard";
import { ColumnVisibility, type ColumnDef } from "@/components/ColumnVisibility";
import { usePersistentColumnVisibility } from "@/hooks/usePersistentColumnVisibility";

const CS_COLUMNS: ColumnDef[] = [
  { key: "date", label: "التاريخ" },
  { key: "type", label: "نوع الحركة" },
  { key: "cur", label: "العملة" },
  { key: "amt", label: "المبلغ" },
  { key: "rate", label: "سعر الصرف" },
  { key: "egp", label: "القيمة بالجنيه" },
  { key: "desc", label: "البيان" },
  { key: "balance", label: "الرصيد" },
  { key: "actions", label: "إجراءات" },
];


export const Route = createFileRoute("/currency-supplier-statement/$supplierId")({
  component: () => <AppErrorBoundary><CurrencySupplierStatementPage /></AppErrorBoundary>,
});

type Supplier = { id: string; name: string; phone: string | null; status: string; notes: string | null };
type SplitJson = {
  source: "company" | "merchant";
  currency: "EGP";
  merchant_id?: string | null;
  method: string;
  amount: number;
};
type Tx = {
  id: string;
  supplier_id: string;
  tx_date: string;
  tx_type: "شراء عملة" | "بيع عملة";
  bought_currency: string;
  bought_amount: number;
  sold_currency: string;
  sold_amount: number;
  exchange_rate: number | null;
  description: string | null;
  payment_splits: SplitJson[] | null;
  created_at: string;
};
type CashBox = { id: string; name: string; currency: string; balance: number; is_active: boolean };

// Foreign currencies allowed (display names) — EGP is always the other side.
const FOREIGN_CURRENCIES = ["دولار", "دينار ليبي"] as const;
const EGP_LABEL = "جنيه مصري";

// Map display name → cash_boxes.currency code
const CURRENCY_CODE: Record<string, "EGP" | "USD" | "LYD"> = {
  "جنيه مصري": "EGP",
  "دولار": "USD",
  "دينار ليبي": "LYD",
};

const ALL_FILTER_CURRENCIES = [EGP_LABEL, ...FOREIGN_CURRENCIES];

function CurrencySupplierStatementPage() {
  const { supplierId } = Route.useParams();
  const perm = usePerm("currency_suppliers");

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [txns, setTxns] = useState<Tx[]>([]);
  const [boxes, setBoxes] = useState<CashBox[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  const [showBuy, setShowBuy] = useState(false);
  const [showSell, setShowSell] = useState(false);

  // Filters
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("");
  const [currencyFilter, setCurrencyFilter] = useState<string>("");

  const [visible, setVisible] = usePersistentColumnVisibility("currency-supplier-statement", CS_COLUMNS);
  const isVisible = (k: string) => visible[k] !== false;


  useEffect(() => {
    let cancel = false;
    (async () => {
      setLoading(true);
      const [{ data: sup }, { data: tx, error: txErr }, { data: bx }, { data: mer }] = await Promise.all([
        supabase.from("currency_suppliers" as any).select("*").eq("id", supplierId).maybeSingle(),
        supabase.from("currency_supplier_transactions" as any).select("*").eq("supplier_id", supplierId).order("tx_date", { ascending: true }),
        supabase.from("cash_boxes" as any).select("*"),
        supabase.from("merchants").select("*").eq("status", "نشط").order("merchant_name"),
      ]);
      if (cancel) return;
      if (txErr) toast.error(txErr.message);
      setSupplier((sup as any) || null);
      setTxns(((tx as any) || []) as Tx[]);
      setBoxes(((bx as any) || []) as CashBox[]);
      setMerchants(((mer as any) || []) as Merchant[]);
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

  const summary = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of filtered) {
      map.set(t.bought_currency, (map.get(t.bought_currency) || 0) + Number(t.bought_amount || 0));
      map.set(t.sold_currency, (map.get(t.sold_currency) || 0) - Number(t.sold_amount || 0));
    }
    return Array.from(map.entries()).map(([cur, net]) => ({ currency: cur, net }));
  }, [filtered]);

  const rowsWithBalance = useMemo(() => {
    let running = 0;
    return filtered.map((t) => {
      let delta = 0;
      if (currencyFilter) {
        if (t.bought_currency === currencyFilter) delta += Number(t.bought_amount || 0);
        if (t.sold_currency === currencyFilter) delta -= Number(t.sold_amount || 0);
      }
      running += delta;
      // Foreign currency + amount + rate (for display in unified columns)
      const isForeignBought = t.tx_type === "شراء عملة";
      const foreignCurrency = isForeignBought ? t.bought_currency : t.sold_currency;
      const foreignAmount = isForeignBought ? Number(t.bought_amount || 0) : Number(t.sold_amount || 0);
      const egpAmount = isForeignBought ? Number(t.sold_amount || 0) : Number(t.bought_amount || 0);
      const rate = Number(t.exchange_rate || 0) || (foreignAmount > 0 ? egpAmount / foreignAmount : 0);
      return { ...t, balance: currencyFilter ? running : null, foreignCurrency, foreignAmount, egpAmount, rate };
    });
  }, [filtered, currencyFilter]);

  const exportData = (): StatementExportData => ({
    title: `كشف حساب مورد عملة — ${supplier?.name || ""}`,
    subtitle: currencyFilter ? `العملة: ${currencyFilter}` : undefined,
    summary: summary.map((s) => ({ label: s.currency, value: `${fmtNum(s.net)}` })),
    columns: [
      { header: "التاريخ", key: "date" },
      { header: "نوع الحركة", key: "type" },
      { header: "العملة", key: "cur" },
      { header: "المبلغ", key: "amt" },
      { header: "سعر الصرف", key: "rate" },
      { header: "القيمة بالجنيه", key: "egp" },
      { header: "البيان", key: "desc" },
      ...(currencyFilter ? [{ header: `الرصيد (${currencyFilter})`, key: "balance" }] : []),
    ],
    rows: rowsWithBalance.map((r) => ({
      date: r.tx_date,
      type: r.tx_type,
      cur: r.foreignCurrency,
      amt: r.foreignAmount,
      rate: r.rate,
      egp: r.egpAmount,
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
            {ALL_FILTER_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
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
                  <th>العملة</th>
                  <th className="num-col">المبلغ</th>
                  <th className="num-col">سعر الصرف</th>
                  <th className="num-col">القيمة بالجنيه</th>
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
                    <td data-label="العملة">{r.foreignCurrency}</td>
                    <td className="num-col" data-label="المبلغ">{fmtNum(r.foreignAmount)}</td>
                    <td className="num-col" data-label="سعر الصرف">{r.rate ? r.rate.toFixed(4) : "—"}</td>
                    <td className="num-col" data-label="القيمة بالجنيه">{fmtNum(r.egpAmount)}</td>
                    <td data-label="البيان">{r.description || "—"}</td>
                    {currencyFilter && <td className="num-col" data-label="الرصيد" style={{ fontWeight: 700 }}>{fmtNum(Number(r.balance || 0))}</td>}
                    {perm.delete && (
                      <td data-label="إجراءات">
                        <button className="action-btn" onClick={async () => {
                          const ok = await confirmDialog("حذف هذه الحركة؟ سيتم عكس تأثيرها على الخزائن وحسابات التجار.", { confirmLabel: "حذف", cancelLabel: "إلغاء" });
                          if (!ok) return;
                          await reverseTransaction(r, boxes);
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
        <TxModal supplierId={supplierId} kind="شراء عملة" boxes={boxes} merchants={merchants} onClose={() => setShowBuy(false)} onSaved={() => { setShowBuy(false); refresh(); }} />
      )}
      {showSell && perm.create && (
        <TxModal supplierId={supplierId} kind="بيع عملة" boxes={boxes} merchants={merchants} onClose={() => setShowSell(false)} onSaved={() => { setShowSell(false); refresh(); }} />
      )}
    </div>
  );
}

// Adjust a cash box for a given currency *display* name (e.g. "دولار", "جنيه مصري").
async function adjustCashBoxByCurrency(boxes: CashBox[], currencyDisplay: string, delta: number) {
  if (!currencyDisplay || !delta) return;
  const code = CURRENCY_CODE[currencyDisplay];
  if (!code) return;
  // Prefer "main" treasury for that currency; fallback to first active box of that currency.
  const box =
    boxes.find((b) => b.currency === code && b.is_active !== false && b.name.includes("الرئيسية")) ||
    boxes.find((b) => b.currency === code && b.is_active !== false);
  if (box) {
    await supabase.from("cash_boxes" as any).update({ balance: Number(box.balance || 0) + delta }).eq("id", box.id);
  } else {
    await supabase.from("cash_boxes" as any).insert({
      name: `الخزينة الرئيسية - ${currencyDisplay}`,
      currency: code,
      balance: delta,
      is_active: true,
    });
  }
}

// Adjust a specific company EGP cash box by method (company_cash | company_instapay).
async function adjustCompanyEgpBox(boxes: CashBox[], method: string, delta: number) {
  if (!delta) return;
  let box: CashBox | undefined;
  if (method === "company_cash") {
    box = boxes.find((b) => b.currency === "EGP" && b.name.includes("نقدي") && b.name.includes("الشركة"));
  } else if (method === "company_instapay") {
    box = boxes.find((b) => b.currency === "EGP" && b.name.includes("إنستا") && b.name.includes("الشركة"));
  }
  if (!box) {
    // fallback to any EGP company box
    box = boxes.find((b) => b.currency === "EGP" && b.name.includes("الشركة")) ||
          boxes.find((b) => b.currency === "EGP" && b.is_active !== false);
  }
  if (box) {
    await supabase.from("cash_boxes" as any).update({ balance: Number(box.balance || 0) + delta }).eq("id", box.id);
  }
}

// Apply all the side-effects of a saved transaction: cash boxes + merchant collections.
async function applyTransaction(opts: {
  kind: "شراء عملة" | "بيع عملة";
  supplierId: string;
  txDate: string;
  foreignCurrency: string;
  foreignAmount: number;
  egpAmount: number;
  splits: SplitJson[];
  boxes: CashBox[];
  description: string;
}) {
  const { kind, supplierId: _sid, txDate, foreignCurrency, foreignAmount, splits, boxes, description } = opts;
  // 1. Foreign currency box: + on buy, - on sell
  await adjustCashBoxByCurrency(boxes, foreignCurrency, kind === "شراء عملة" ? +foreignAmount : -foreignAmount);
  // 2. EGP side via splits
  for (const s of splits) {
    const amt = Number(s.amount || 0);
    if (!amt) continue;
    if (s.source === "company") {
      // buy → EGP leaves company box (-); sell → EGP arrives in company box (+)
      await adjustCompanyEgpBox(boxes, s.method, kind === "شراء عملة" ? -amt : +amt);
    } else if (s.source === "merchant" && s.merchant_id) {
      // buy: merchant pays on our behalf → his balance decreases (we owe him less / he owes us more depending on convention)
      // We mirror expenses pattern: insert a merchant_cash_collection deducting merchant balance.
      // sell: not typical for sell; if used → reverse sign.
      const signed = kind === "شراء عملة" ? amt : -amt;
      await supabase.from("merchant_cash_collections").insert({
        merchant_id: s.merchant_id,
        date: txDate,
        amount: signed,
        // نمرّر البيان كما أدخله المستخدم في نموذج التعامل بدون توليد تلقائي
        note: null,
        statement: description?.trim() ? description.trim() : null,
      });

    }
  }
}

// Reverse a previously-applied transaction (used on delete).
async function reverseTransaction(r: Tx & { foreignCurrency: string; foreignAmount: number; egpAmount: number }, boxes: CashBox[]) {
  await adjustCashBoxByCurrency(boxes, r.foreignCurrency, r.tx_type === "شراء عملة" ? -r.foreignAmount : +r.foreignAmount);
  const splits = Array.isArray(r.payment_splits) ? r.payment_splits : [];
  for (const s of splits) {
    const amt = Number(s.amount || 0);
    if (!amt) continue;
    if (s.source === "company") {
      await adjustCompanyEgpBox(boxes, s.method, r.tx_type === "شراء عملة" ? +amt : -amt);
    } else if (s.source === "merchant" && s.merchant_id) {
      const signed = r.tx_type === "شراء عملة" ? -amt : +amt;
      await supabase.from("merchant_cash_collections").insert({
        merchant_id: s.merchant_id,
        date: r.tx_date,
        amount: signed,
        note: null,
      });

    }
  }
}

function TxModal({
  supplierId, kind, boxes, merchants, onClose, onSaved,
}: {
  supplierId: string;
  kind: "شراء عملة" | "بيع عملة";
  boxes: CashBox[];
  merchants: Merchant[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const balances = useSourceBalances();

  // For buy: foreign is the BOUGHT side, EGP is the SOLD side.
  // For sell: foreign is the SOLD side, EGP is the BOUGHT side.
  const [foreignCurrency, setForeignCurrency] = useState<string>("دولار");
  const [foreignAmount, setForeignAmount] = useState<string>("");
  const [rate, setRate] = useState<string>("");
  const [egpAmount, setEgpAmount] = useState<string>("");
  const [txDate, setTxDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState<string>("");

  // Track which field was last edited so we know which to auto-compute
  const [lastEdited, setLastEdited] = useState<"amount" | "rate" | "egp" | null>(null);

  // Auto-compute the remaining field whenever two are known
  useEffect(() => {
    const a = Number(foreignAmount);
    const r = Number(rate);
    const e = Number(egpAmount);
    const hasA = a > 0, hasR = r > 0, hasE = e > 0;
    if (lastEdited === "amount" || lastEdited === "rate") {
      if (hasA && hasR) {
        const computed = +(a * r).toFixed(4);
        if (computed !== e) setEgpAmount(String(computed));
      }
    } else if (lastEdited === "egp") {
      if (hasA && hasE && lastEdited === "egp") {
        const computed = +(e / a).toFixed(6);
        if (computed !== r) setRate(String(computed));
      } else if (hasR && hasE) {
        const computed = +(e / r).toFixed(4);
        if (computed !== a) setForeignAmount(String(computed));
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foreignAmount, rate, egpAmount, lastEdited]);

  // Force EGP currency on splits (only EGP is allowed since EGP is the always-EGP side)
  const [splits, setSplits] = useState<PaymentSplitRow[]>(() => {
    const r = newPaymentSplitRow();
    r.currency = "EGP";
    return [r];
  });
  // Lock all rows to EGP currency
  const onSplitsChange = (next: PaymentSplitRow[]) => {
    setSplits(next.map((r) => ({ ...r, currency: "EGP" as const })));
  };

  const splitsTotal = useMemo(
    () => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [splits],
  );
  const egpNum = Number(egpAmount) || 0;
  const splitsDiff = +(egpNum - splitsTotal).toFixed(2);

  const save = async () => {
    const a = Number(foreignAmount);
    const r = Number(rate);
    const e = Number(egpAmount);
    if (!txDate) return toast.error("التاريخ مطلوب");
    if (!foreignCurrency) return toast.error("اختر العملة");
    if (!(a > 0) || !(r > 0) || !(e > 0)) return toast.error("أدخل قيمتين على الأقل لحساب الثالثة");
    const err = validatePaymentSplits(splits);
    if (err) return toast.error(err);
    if (Math.abs(splitsDiff) > 0.5) {
      return toast.error(`إجمالي وسائل الدفع (${fmtNum(splitsTotal)}) لا يساوي قيمة العملة المباعة بالجنيه (${fmtNum(egpNum)})`);
    }
    const validForCheck = filterValidSplits(splits);
    if (kind === "شراء عملة") {
      // EGP leaves the company / merchants → guard balances.
      const balanceErr = validateSplitOutflows(validForCheck, balances, merchants);
      if (balanceErr) return toast.error(balanceErr);
    } else {
      // sell: foreign currency leaves treasury → guard the foreign box.
      const code = CURRENCY_CODE[foreignCurrency];
      const box = boxes.find((b) => b.currency === code && b.is_active !== false);
      const available = Number(box?.balance || 0);
      const sErr = validateSingleOutflow(
        box?.name || `خزينة ${foreignCurrency}`,
        available,
        a,
      );
      if (sErr) return toast.error(sErr);
    }


    const valid = filterValidSplits(splits);
    // Resolve method label for storage (kept consistent with what other forms persist)
    const splitsJson: SplitJson[] = valid.map((row) => ({
      source: row.source,
      currency: "EGP",
      merchant_id: row.source === "merchant" ? row.merchant_id : null,
      method: row.method,
      amount: Number(row.amount) || 0,
    }));

    const isBuy = kind === "شراء عملة";
    const payload: any = {
      supplier_id: supplierId,
      tx_date: txDate,
      tx_type: kind,
      bought_currency: isBuy ? foreignCurrency : EGP_LABEL,
      bought_amount: isBuy ? a : e,
      sold_currency: isBuy ? EGP_LABEL : foreignCurrency,
      sold_amount: isBuy ? e : a,
      exchange_rate: r,
      description: description.trim() || null,
      payment_splits: splitsJson,
    };

    const { error } = await supabase.from("currency_supplier_transactions" as any).insert(payload);
    if (error) return toast.error(error.message);

    await applyTransaction({
      kind,
      supplierId,
      txDate,
      foreignCurrency,
      foreignAmount: a,
      egpAmount: e,
      splits: splitsJson,
      boxes,
      description: description.trim(),
    });

    toast.success("تم حفظ الحركة");
    onSaved();
  };

  if (typeof document === "undefined") return null;
  const isBuy = kind === "شراء عملة";

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 820, width: "100%", margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="card-header"><div className="card-title">{isBuy ? "💵 إضافة حركة شراء عملة" : "💱 إضافة حركة بيع عملة"}</div></div>

        <div className="form-grid">
          <div className="form-group"><label>التاريخ</label>
            <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
          </div>
          <div className="form-group"><label>{isBuy ? "العملة المشتراة" : "العملة المباعة"}</label>
            <select value={foreignCurrency} onChange={(e) => setForeignCurrency(e.target.value)}>
              {FOREIGN_CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="form-group"><label>{isBuy ? "مبلغ العملة المشتراة" : "مبلغ العملة المباعة"}</label>
            <input type="number" step="0.0001" value={foreignAmount}
              onChange={(e) => { setForeignAmount(e.target.value); setLastEdited("amount"); }} />
          </div>
          <div className="form-group"><label>{isBuy ? "سعر الشراء" : "سعر البيع"}</label>
            <input type="number" step="0.0001" value={rate}
              onChange={(e) => { setRate(e.target.value); setLastEdited("rate"); }} />
          </div>
          <div className="form-group"><label>{isBuy ? "قيمة العملة المباعة بالجنيه" : "قيمة العملة المشتراة بالجنيه"}</label>
            <input type="number" step="0.01" value={egpAmount}
              onChange={(e) => { setEgpAmount(e.target.value); setLastEdited("egp"); }} />
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>البيان</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>

        <PaymentSplits
          splits={splits}
          merchants={merchants}
          onChange={onSplitsChange}
          title={isBuy ? "وسائل الدفع (الجنيه المصري المدفوع للمورد)" : "وسائل استلام الجنيه المصري"}
        />

        <div style={{ padding: "4px 12px 8px", fontSize: 13 }}>
          إجمالي وسائل الدفع: <b>{fmtNum(splitsTotal)}</b>
          {Math.abs(splitsDiff) > 0.5 && (
            <span style={{ color: "var(--red, #c00)", marginInlineStart: 8 }}>
              الفرق: {fmtNum(splitsDiff)}
            </span>
          )}
        </div>

        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: 12 }}>
          <button className="action-btn" onClick={onClose}>إلغاء</button>
          <button data-confirm-save="تأكيد حفظ الحركة" className="btn btn-gold" onClick={save}>💾 حفظ الحركة</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

