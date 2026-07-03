import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { fmtNum, fmtCurrency, normalizeCurrency, type Merchant } from "@/lib/db";
import { toast } from "sonner";
import { confirmDialog } from "@/lib/confirm";
import { usePerm } from "@/hooks/usePerm";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { ExportButton } from "@/components/ExportButton";
import { ChevronLeft, Coins, ArrowDownCircle, ArrowUpCircle, Banknote, HandCoins } from "lucide-react";
import type { StatementExportData } from "@/lib/exportStatement";
import {
  PaymentSplits,
  type PaymentSplitRow,
  newPaymentSplitRow,
  validatePaymentSplits,
  filterValidSplits,
} from "@/components/PaymentSplits";
import { useSourceBalances, validateSplitOutflows, validateSingleOutflow } from "@/lib/balanceGuard";
import { CancelTransactionButton } from "@/components/CancelTransactionButton";
import { EditTransactionButton } from "@/components/EditTransactionButton";
import { postMovement, type MovementSplit } from "@/lib/financialEngine";
import { logCreate } from "@/lib/financialAudit";
import { ColumnVisibility, type ColumnDef } from "@/components/ColumnVisibility";
import { usePersistentColumnVisibility } from "@/hooks/usePersistentColumnVisibility";
import { CurrencyTotalsCards, type CurrencyTotal } from "@/components/CurrencyTotalsCards";

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
  validateSearch: (s: Record<string, unknown>) => ({ action: (s.action as string) || "" }),
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
  tx_type: "شراء عملة" | "بيع عملة" | "رصيد سابق" | "صرف نقدية" | "استلام نقدية";
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

// Foreign currency codes allowed — EGP is always the other side. All storage
// uses the canonical code (EGP/USD/LYD); Arabic labels are display-only.
const FOREIGN_CURRENCIES = ["USD", "LYD"] as const;
const EGP_CODE = "EGP";

const CURRENCY_LABEL_AR: Record<string, string> = {
  EGP: "جنيه مصري",
  USD: "دولار أمريكي",
  LYD: "دينار ليبي",
};

const ALL_FILTER_CURRENCIES = [EGP_CODE, ...FOREIGN_CURRENCIES];


function CurrencySupplierStatementPage() {
  const { supplierId } = Route.useParams();
  const { action } = Route.useSearch();
  const perm = usePerm("currency_suppliers");

  const [supplier, setSupplier] = useState<Supplier | null>(null);
  const [txns, setTxns] = useState<Tx[]>([]);
  const [boxes, setBoxes] = useState<CashBox[]>([]);
  const [merchants, setMerchants] = useState<Merchant[]>([]);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);

  const [showBuy, setShowBuy] = useState(false);
  const [showSell, setShowSell] = useState(false);
  const [showPay, setShowPay] = useState(false);
  const [showReceive, setShowReceive] = useState(false);

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

  // Realtime: refresh this supplier's statement whenever a related row
  // changes anywhere in the system. Filter by supplier_id where possible so
  // other suppliers' activity doesn't ping this screen.
  useEffect(() => {
    const bump = () => setReload((n) => n + 1);
    const ch = supabase
      .channel(`currency-supplier-statement-rt-${supplierId}`)
      .on("postgres_changes", {
        event: "*", schema: "public",
        table: "currency_supplier_transactions",
        filter: `supplier_id=eq.${supplierId}`,
      }, bump)
      .on("postgres_changes", {
        event: "*", schema: "public",
        table: "currency_suppliers",
        filter: `id=eq.${supplierId}`,
      }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "cash_boxes" }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_splits" }, bump)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [supplierId]);

  const filtered = useMemo(() => {
    // Normalize legacy Arabic currency values to canonical codes so old rows
    // group correctly with new ones.
    return txns
      .map((t) => ({
        ...t,
        bought_currency: normalizeCurrency(t.bought_currency),
        sold_currency: normalizeCurrency(t.sold_currency),
      }))
      .filter((t) => {
        if ((t as any).cancelled_at) return false;
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
    // Per-currency running balance on the supplier account.
    // Convention: POSITIVE = we still owe the supplier (creditor);
    //             NEGATIVE = supplier owes us (advance / debit).
    //
    // Rules:
    //  - رصيد سابق: opening balance (bought - sold on same currency).
    //  - شراء / بيع عملة: a completed exchange has ZERO impact on the supplier
    //    account. The foreign leg hits our cash-box, the EGP leg hits our
    //    cash-box (via payment_splits). Any UNSETTLED EGP amount
    //    (contracted − actually settled through splits) creates residual debt.
    //  - صرف نقدية: we paid supplier X foreign → supplier balance -= X
    //  - استلام نقدية: supplier gave us X foreign → supplier balance += X
    const bals = new Map<string, number>();
    return filtered.map((t) => {
      const isOpening = t.tx_type === "رصيد سابق";
      const isBuy = t.tx_type === "شراء عملة";
      const isSell = t.tx_type === "بيع عملة";
      const isPay = t.tx_type === "صرف نقدية";
      const isReceive = t.tx_type === "استلام نقدية";
      const isCashOnly = isPay || isReceive;

      // Display fields.
      const foreignCurrency = isCashOnly
        ? (isPay ? t.sold_currency : t.bought_currency)
        : isBuy ? t.bought_currency
        : isSell ? t.sold_currency
        : t.bought_currency; // opening
      const foreignAmount = isOpening
        ? Number(t.bought_amount || 0) + Number(t.sold_amount || 0)
        : isCashOnly
          ? (isPay ? Number(t.sold_amount || 0) : Number(t.bought_amount || 0))
          : isBuy ? Number(t.bought_amount || 0) : Number(t.sold_amount || 0);
      const egpAmount = isOpening || isCashOnly
        ? 0
        : isBuy ? Number(t.sold_amount || 0) : Number(t.bought_amount || 0);
      const rate = isOpening || isCashOnly
        ? 0
        : (Number(t.exchange_rate || 0) || (foreignAmount > 0 ? egpAmount / foreignAmount : 0));

      // Determine which currency & delta impact the supplier balance.
      let balanceCurrency = foreignCurrency;
      let delta = 0;
      if (isOpening) {
        // Same currency both sides; positive = supplier is creditor.
        delta = Number(t.bought_amount || 0) - Number(t.sold_amount || 0);
      } else if (isBuy || isSell) {
        // Residual EGP debt only (foreign leg always fully settled via cash-box).
        balanceCurrency = "EGP";
        const splits = Array.isArray(t.payment_splits) ? t.payment_splits : [];
        const settled = splits.reduce((s, r) => s + Number(r.amount || 0), 0);
        const contracted = isBuy ? Number(t.sold_amount || 0) : Number(t.bought_amount || 0);
        const shortfall = +(contracted - settled).toFixed(2);
        // Buy: we still owe supplier the unpaid EGP → +shortfall.
        // Sell: supplier still owes us the unreceived EGP → -shortfall.
        delta = isBuy ? shortfall : -shortfall;
      } else if (isPay) {
        delta = -Number(t.sold_amount || 0); // paid → supplier balance drops
      } else if (isReceive) {
        delta = +Number(t.bought_amount || 0); // received → supplier balance rises
      }

      const next = (bals.get(balanceCurrency) || 0) + delta;
      bals.set(balanceCurrency, next);
      return {
        ...t,
        balance: next,
        balanceCurrency,
        foreignCurrency,
        foreignAmount,
        egpAmount,
        rate,
        balanceDelta: delta,
      };
    });
  }, [filtered]);

  // Per-currency debit/credit/net/count aggregated from the same rows the
  // ledger displays — feeds the shared CurrencyTotalsCards component.
  const byCurrency = useMemo<CurrencyTotal[]>(() => {
    const map = new Map<string, { debit: number; credit: number; count: number }>();
    const bump = (cur: string, d: number, c: number) => {
      const k = cur || "EGP";
      const g = map.get(k) || { debit: 0, credit: 0, count: 0 };
      g.debit += d; g.credit += c; g.count += 1;
      map.set(k, g);
    };
    for (const r of rowsWithBalance) {
      const d = r.balanceDelta;
      if (d === 0) continue;
      if (d > 0) bump(r.balanceCurrency, d, 0);
      else bump(r.balanceCurrency, 0, -d);
    }
    return Array.from(map.entries())
      .map(([currency, v]) => ({ currency, debit: v.debit, credit: v.credit, net: v.debit - v.credit, count: v.count }))
      .filter((t) => t.debit !== 0 || t.credit !== 0 || t.net !== 0);
  }, [rowsWithBalance]);

  const exportData = (): StatementExportData => ({
    title: `كشف حساب مورد عملة — ${supplier?.name || ""}`,
    subtitle: currencyFilter ? `العملة: ${currencyFilter}` : undefined,
    summary: summary.map((s) => ({ label: s.currency, value: `${fmtNum(s.net)}` })),
    columns: ([
      { header: "التاريخ", key: "date" },
      { header: "نوع الحركة", key: "type" },
      { header: "العملة", key: "cur" },
      { header: "المبلغ", key: "amt" },
      { header: "سعر الصرف", key: "rate" },
      { header: "القيمة بالجنيه", key: "egp" },
      { header: "البيان", key: "desc" },
      { header: "الرصيد الحالي (حسب العملة)", key: "balance" },
    ] as Array<{ header: string; key: string }>).filter((c) => isVisible(c.key)),
    rows: rowsWithBalance.map((r) => ({
      date: r.tx_date,
      type: r.tx_type,
      cur: r.foreignCurrency,
      amt: r.foreignAmount,
      rate: r.rate,
      egp: r.egpAmount,
      desc: r.description || "",
      balance: Number(r.balance || 0),
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

      <CurrencyTotalsCards totals={byCurrency} entityKind="currency_supplier" />

      <div className="action-toolbar" style={{ flexWrap: "wrap", gap: 8 }}>
        {perm.create && (
          <>
            <button className="btn btn-gold" onClick={() => setShowBuy(true)} type="button">
              <ArrowDownCircle size={15} /> إضافة حركة شراء عملة
            </button>
            <button className="btn" onClick={() => setShowSell(true)} type="button" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <ArrowUpCircle size={15} /> إضافة حركة بيع عملة
            </button>
            <button className="btn" onClick={() => setShowPay(true)} type="button" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <Banknote size={15} /> صرف نقدية للمورد
            </button>
            <button className="btn" onClick={() => setShowReceive(true)} type="button" style={{ background: "var(--card)", border: "1px solid var(--border)" }}>
              <HandCoins size={15} /> استلام نقدية من المورد
            </button>
          </>
        )}
        <ColumnVisibility columns={CS_COLUMNS} visible={visible} onChange={setVisible} />
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
            <option value="صرف نقدية">صرف نقدية</option>
            <option value="استلام نقدية">استلام نقدية</option>
            <option value="رصيد سابق">رصيد سابق</option>
          </select>
        </div>
        <div className="form-group" style={{ minWidth: 180 }}>
          <label>العملة</label>
          <select value={currencyFilter} onChange={(e) => setCurrencyFilter(e.target.value)}>
            <option value="">الكل</option>
            {ALL_FILTER_CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL_AR[c] || c}</option>)}
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
                  {isVisible("date") && <th>التاريخ</th>}
                  {isVisible("type") && <th>نوع الحركة</th>}
                  {isVisible("cur") && <th>العملة</th>}
                  {isVisible("amt") && <th className="num-col">المبلغ</th>}
                  {isVisible("rate") && <th className="num-col">سعر الصرف</th>}
                  {isVisible("egp") && <th className="num-col">القيمة بالجنيه</th>}
                  {isVisible("desc") && <th>البيان</th>}
                  {isVisible("balance") && <th className="num-col">الرصيد الحالي</th>}
                  {isVisible("actions") && <th>إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {rowsWithBalance.length === 0 ? (
                  <tr><td colSpan={CS_COLUMNS.length}><div className="empty"><div className="empty-text">لا توجد حركات</div></div></td></tr>
                ) : rowsWithBalance.map((r) => (
                  <tr key={r.id}>
                    {isVisible("date") && <td data-label="التاريخ">{r.tx_date}</td>}
                    {isVisible("type") && <td data-label="النوع">
                      <span className={`badge pill-badge ${
                        r.tx_type === "شراء عملة" ? "badge-green" :
                        r.tx_type === "بيع عملة" ? "badge-blue" :
                        r.tx_type === "صرف نقدية" ? "badge-red" :
                        r.tx_type === "استلام نقدية" ? "badge-green" :
                        "badge"
                      }`}>{r.tx_type}</span>
                    </td>}
                    {isVisible("cur") && <td data-label="العملة">{r.foreignCurrency}</td>}
                    {isVisible("amt") && <td className="num-col" data-label="المبلغ">{fmtNum(r.foreignAmount)}</td>}
                    {isVisible("rate") && <td className="num-col" data-label="سعر الصرف">{r.rate ? r.rate.toFixed(4) : "—"}</td>}
                    {isVisible("egp") && <td className="num-col" data-label="القيمة بالجنيه">{r.egpAmount ? fmtNum(r.egpAmount) : "—"}</td>}
                    {isVisible("desc") && <td data-label="البيان">{r.description || ""}</td>}
                    {isVisible("balance") && <td className="num-col" data-label="الرصيد" style={{ fontWeight: 700 }}>{fmtCurrency(Number(r.balance || 0), r.balanceCurrency)}</td>}
                    {isVisible("actions") && (
                      <td data-label="إجراءات">
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          <EditTransactionButton table="currency_supplier_transactions" id={r.id} cancelled={false} onDone={refresh} />
                          <CancelTransactionButton table="currency_supplier_transactions" id={r.id} cancelled={false} onDone={refresh} />
                        </div>
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
      {showPay && perm.create && (
        <CashMovementModal supplierId={supplierId} kind="صرف نقدية" boxes={boxes} onClose={() => setShowPay(false)} onSaved={() => { setShowPay(false); refresh(); }} />
      )}
      {showReceive && perm.create && (
        <CashMovementModal supplierId={supplierId} kind="استلام نقدية" boxes={boxes} onClose={() => setShowReceive(false)} onSaved={() => { setShowReceive(false); refresh(); }} />
      )}
    </div>
  );
}

// Resolve the target cash_box for a currency code (foreign leg).
function resolveForeignBox(boxes: CashBox[], currencyCode: string): CashBox | null {
  const code = currencyCode;
  if (!code) return null;
  return (
    boxes.find((b) => b.currency === code && b.is_active !== false && b.name.includes("الرئيسية")) ||
    boxes.find((b) => b.currency === code && b.is_active !== false) ||
    null
  );
}


// Resolve the company EGP cash_box for a split method (company_cash | company_instapay).
function resolveCompanyEgpBox(boxes: CashBox[], method: string): CashBox | null {
  if (method === "company_cash") {
    return boxes.find((b) => b.currency === "EGP" && b.name.includes("نقدي") && b.name.includes("الشركة")) || null;
  }
  if (method === "company_instapay") {
    return boxes.find((b) => b.currency === "EGP" && b.name.includes("إنستا") && b.name.includes("الشركة")) || null;
  }
  return null;
}

// Method labels stored in payment_splits (kept consistent with CashMovementForms).
function methodLabelFor(s: SplitJson): string {
  if (s.method === "company_instapay") return "إنستاباي";
  if (s.method === "company_cash") return "نقدي";
  if (s.method === "merchant_instapay") return "انستا";
  if (s.method === "merchant_wallet") return "فودافون كاش";
  if (s.method === "merchant_physical") return "نقدي";
  return "نقدي";
}

// Apply all the side-effects of a saved transaction via the Financial Engine.
//   - Foreign box + company EGP boxes: payment_splits rows with cash_box_id (trigger updates balance).
//   - Merchant legs: payment_splits with cash_box_id=null (no box impact) + merchant_cash_collections row (merchant balance).
async function applyTransaction(opts: {
  kind: "شراء عملة" | "بيع عملة";
  supplierId: string;
  txId: string;
  txDate: string;
  foreignCurrency: string;
  foreignAmount: number;
  splits: SplitJson[];
  boxes: CashBox[];
  description: string;
}) {
  const { kind, supplierId, txId, txDate, foreignCurrency, foreignAmount, splits, boxes, description } = opts;
  const isBuy = kind === "شراء عملة";
  const foreignBox = resolveForeignBox(boxes, foreignCurrency);
  const foreignCode = foreignCurrency;

  const engineSplits: MovementSplit[] = [];

  // 1. Foreign currency leg (buy → +foreign box, sell → -foreign box)
  if (foreignBox && foreignCode && foreignAmount > 0) {
    engineSplits.push({
      method: "نقدي",
      currency: foreignCode as "EGP" | "USD" | "LYD",
      cashBoxId: foreignBox.id,
      amount: foreignAmount,
      direction: isBuy ? "in" : "out",
      grossAmount: foreignAmount,
      netAmount: foreignAmount,
      exchangeRate: 1,
      egpEquivalent: 0,
    });
  }

  // 2. EGP legs (company boxes update via trigger; merchant legs recorded but no box impact)
  for (const s of splits) {
    const amt = Number(s.amount || 0);
    if (!amt) continue;
    const dir: "in" | "out" = isBuy ? "out" : "in"; // buy → EGP leaves us; sell → EGP arrives
    let cashBoxId: string | null = null;
    if (s.source === "company") {
      cashBoxId = resolveCompanyEgpBox(boxes, s.method)?.id || null;
    }
    engineSplits.push({
      method: methodLabelFor(s),
      currency: "EGP",
      cashBoxId,
      amount: amt,
      direction: dir,
      grossAmount: amt,
      netAmount: amt,
      exchangeRate: 1,
      egpEquivalent: amt,
    });

    // Merchant balance is aggregated from merchant_cash_collections, so keep that row.
    if (s.source === "merchant" && s.merchant_id) {
      const signed = isBuy ? amt : -amt;
      await supabase.from("merchant_cash_collections").insert({
        merchant_id: s.merchant_id,
        date: txDate,
        amount: signed,
        note: null,
        statement: description?.trim() ? description.trim() : null,
      });
    }
  }

  if (engineSplits.length === 0) return;

  const res = await postMovement({
    partyType: "currency_supplier",
    partyId: supplierId,
    kind: isBuy ? "payment" : "receipt",
    date: txDate,
    statement: description?.trim() || undefined,
    splits: engineSplits,
    sourceTable: "currency_supplier_transactions",
    sourceId: txId,
  });
  if (!res.ok) {
    toast.error(res.error || "تعذر تسجيل الحركة في الخزائن");
  }
}

// Reverse a previously-applied transaction (used on delete).
async function reverseTransaction(r: Tx & { foreignCurrency: string; foreignAmount: number; egpAmount: number }, _boxes: CashBox[]) {
  void _boxes;
  // Deleting payment_splits rows triggers cash_boxes reversal automatically.
  await supabase
    .from("payment_splits")
    .delete()
    .eq("source_table", "currency_supplier_transactions")
    .eq("source_id", r.id);

  // Reverse merchant balance side-effects (merchant_cash_collections rows).
  const splits = Array.isArray(r.payment_splits) ? r.payment_splits : [];
  for (const s of splits) {
    const amt = Number(s.amount || 0);
    if (!amt) continue;
    if (s.source === "merchant" && s.merchant_id) {
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
  const [foreignCurrency, setForeignCurrency] = useState<string>("USD");
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
      const code = foreignCurrency;
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
      bought_currency: isBuy ? foreignCurrency : EGP_CODE,
      bought_amount: isBuy ? a : e,
      sold_currency: isBuy ? EGP_CODE : foreignCurrency,

      sold_amount: isBuy ? e : a,
      exchange_rate: r,
      description: description.trim() || null,
      payment_splits: splitsJson,
    };

    const { data: inserted, error } = await supabase
      .from("currency_supplier_transactions" as any)
      .insert(payload)
      .select("id")
      .single();
    if (error) return toast.error(error.message);
    const txId = (inserted as any)?.id as string;
    await logCreate("currency_supplier_transactions", txId, { ...payload, id: txId }, kind);

    await applyTransaction({
      kind,
      supplierId,
      txId,
      txDate,
      foreignCurrency,
      foreignAmount: a,
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
              {FOREIGN_CURRENCIES.map((c) => <option key={c} value={c}>{CURRENCY_LABEL_AR[c] || c}</option>)}
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

// Cash disbursement / receipt to a currency supplier (single cash box, same currency, no split).
function CashMovementModal({
  supplierId, kind, boxes, onClose, onSaved,
}: {
  supplierId: string;
  kind: "صرف نقدية" | "استلام نقدية";
  boxes: CashBox[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isPay = kind === "صرف نقدية";
  const allCurrencies = [EGP_CODE, ...FOREIGN_CURRENCIES] as const;
  const [currency, setCurrency] = useState<string>("USD");
  const [amount, setAmount] = useState<string>("");
  const [cashBoxId, setCashBoxId] = useState<string>("");
  const [txDate, setTxDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState<string>("");

  const availableBoxes = useMemo(
    () => boxes.filter((b) => b.currency === currency && b.is_active !== false),
    [boxes, currency],
  );

  // Auto-pick the first matching box when currency changes.
  useEffect(() => {
    if (availableBoxes.length && !availableBoxes.find((b) => b.id === cashBoxId)) {
      setCashBoxId(availableBoxes[0].id);
    }
    if (!availableBoxes.length) setCashBoxId("");
  }, [availableBoxes, cashBoxId]);

  const selectedBox = availableBoxes.find((b) => b.id === cashBoxId) || null;

  const save = async () => {
    const amt = Number(amount);
    if (!txDate) return toast.error("التاريخ مطلوب");
    if (!currency) return toast.error("اختر العملة");
    if (!(amt > 0)) return toast.error("أدخل مبلغاً صحيحاً");
    if (!cashBoxId || !selectedBox) return toast.error("اختر الخزينة");
    if (isPay) {
      // Guard: cash box must have enough balance in the same currency.
      const available = Number(selectedBox.balance || 0);
      if (amt > available + 0.001) {
        return toast.error(
          `رصيد ${selectedBox.name} غير كافٍ (${fmtCurrency(available, selectedBox.currency)})`,
        );
      }
    }

    // Store cash-only movement in currency_supplier_transactions using existing columns.
    //  - صرف نقدية:   sold_amount = amount, sold_currency = currency, bought = 0
    //  - استلام نقدية: bought_amount = amount, bought_currency = currency, sold = 0
    const payload: any = {
      supplier_id: supplierId,
      tx_date: txDate,
      tx_type: kind,
      bought_currency: currency,
      bought_amount: isPay ? 0 : amt,
      sold_currency: currency,
      sold_amount: isPay ? amt : 0,
      exchange_rate: null,
      description: description.trim() || null,
      payment_splits: [],
    };
    const { data: inserted, error } = await supabase
      .from("currency_supplier_transactions" as any)
      .insert(payload)
      .select("id")
      .single();
    if (error) return toast.error(error.message);
    const txId = (inserted as any)?.id as string;
    await logCreate("currency_supplier_transactions", txId, { ...payload, id: txId }, kind);

    // Post the single-box cash-box movement via the Financial Engine so that
    // the trigger updates cash_boxes.balance and Audit / reports pick it up.
    const engineSplits: MovementSplit[] = [{
      method: "نقدي",
      currency: currency as "EGP" | "USD" | "LYD",
      cashBoxId: cashBoxId,
      amount: amt,
      direction: isPay ? "out" : "in",
      grossAmount: amt,
      netAmount: amt,
      exchangeRate: 1,
      egpEquivalent: currency === "EGP" ? amt : 0,
    }];
    const res = await postMovement({
      partyType: "currency_supplier",
      partyId: supplierId,
      kind: isPay ? "payment" : "receipt",
      date: txDate,
      statement: description.trim() || undefined,
      splits: engineSplits,
      sourceTable: "currency_supplier_transactions",
      sourceId: txId,
    });
    if (!res.ok) {
      toast.error(res.error || "تعذر تسجيل الحركة في الخزائن");
      return;
    }
    toast.success("تم حفظ الحركة");
    onSaved();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 640, width: "100%", margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="card-header"><div className="card-title">{isPay ? "💸 صرف نقدية لمورد العملة" : "💰 استلام نقدية من مورد العملة"}</div></div>

        <div className="form-grid">
          <div className="form-group"><label>التاريخ</label>
            <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
          </div>
          <div className="form-group"><label>العملة</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value)}>
              {allCurrencies.map((c) => <option key={c} value={c}>{CURRENCY_LABEL_AR[c] || c}</option>)}
            </select>
          </div>
          <div className="form-group"><label>المبلغ</label>
            <input type="number" step="0.0001" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="form-group"><label>{isPay ? "الخزينة (مصدر الصرف)" : "الخزينة (وجهة الاستلام)"}</label>
            <select value={cashBoxId} onChange={(e) => setCashBoxId(e.target.value)}>
              {availableBoxes.length === 0 && <option value="">لا توجد خزينة بنفس العملة</option>}
              {availableBoxes.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name} — الرصيد: {fmtCurrency(Number(b.balance || 0), b.currency)}
                </option>
              ))}
            </select>
            {selectedBox && isPay && (
              <div style={{ fontSize: 12, color: "var(--muted, #666)", marginTop: 4 }}>
                الرصيد المتاح: <b>{fmtCurrency(Number(selectedBox.balance || 0), selectedBox.currency)}</b>
              </div>
            )}
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>البيان</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
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

