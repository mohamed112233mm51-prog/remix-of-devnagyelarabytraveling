import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/integrations/supabase/client";
import { fmtNum, fmtCurrency, formatExchangeRate, normalizeCurrency, type Merchant } from "@/lib/db";
import { toast } from "sonner";
import { confirmDialog } from "@/lib/confirm";
import { usePerm } from "@/hooks/usePerm";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { ExportButton } from "@/components/ExportButton";
import { ChevronLeft, Coins, ArrowDownCircle, ArrowUpCircle, Wallet } from "lucide-react";
import { buildArabicFileName, arabicCurrencyName, type StatementExportData } from "@/lib/exportStatement";
import CurrencyFilter from "@/components/CurrencyFilter";
import { cairoToday } from "@/lib/approvalFines";
import { currentMonthKey, monthPeriodFor } from "@/lib/monthlyLedger";
import { MonthPeriodPicker, buildMonthOptions, monthLabel } from "@/components/MonthPeriodPicker";
import {
  PaymentSplits,
  type PaymentSplitRow,
  type SplitCurrency,
  newPaymentSplitRow,
  validatePaymentSplits,
  filterValidSplits,
} from "@/components/PaymentSplits";
import { resolveCompanyCashBoxForSplit, useSourceBalances, validateSplitOutflows, validateSingleOutflow } from "@/lib/balanceGuard";
import { CancelTransactionButton } from "@/components/CancelTransactionButton";
import { EditTransactionButton } from "@/components/EditTransactionButton";
import { postMovement, type MovementSplit } from "@/lib/financialEngine";
import { logCreate } from "@/lib/financialAudit";
import { ColumnVisibility, type ColumnDef } from "@/components/ColumnVisibility";
import { usePersistentColumnVisibility } from "@/hooks/usePersistentColumnVisibility";
import { CurrencyTotalsCards, type CurrencyTotal } from "@/components/CurrencyTotalsCards";
import {
  summarizeCurrencySupplierStatement,
  summarizeCurrencySupplierNetByCurrency,
  attachRunningBalances,
  buildCurrencySupplierLedgerRows,
  currencySupplierDelta,
} from "@/lib/financialSummary";


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
type TxType = "شراء عملة" | "بيع عملة" | "رصيد سابق" | "دفع نقدية" | "استلام نقدية";
type Tx = {
  id: string;
  supplier_id: string;
  tx_date: string;
  tx_type: TxType;
  bought_currency: string;
  bought_amount: number;
  sold_currency: string;
  sold_amount: number;
  exchange_rate: number | null;
  description: string | null;
  payment_splits: SplitJson[] | null;
  opening_currency?: string | null;
  created_at: string;
  isOpeningCarryForward?: boolean;
};
type CashBox = { id: string; name: string; currency: string; balance: number; is_active: boolean; method_key?: string | null };

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
  

  // Filters
  const today = cairoToday();
  const [monthKey, setMonthKey] = useState<string>(() => currentMonthKey(today));
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

  const canonicalRows = useMemo(() => {
    // Normalize legacy Arabic currency values to canonical codes so old rows
    // group correctly with new ones.
    const normalized = txns.map((t) => ({
      ...t,
      bought_currency: normalizeCurrency(t.bought_currency),
      sold_currency: normalizeCurrency(t.sold_currency),
    }));
    // Single Source of Truth: استبعاد الحركات الملغاة + الترتيب الحتمي.
    return buildCurrencySupplierLedgerRows(normalized);
  }, [txns]);

  const monthOptions = useMemo(
    () => buildMonthOptions(canonicalRows.map((t) => t.tx_date), today),
    [canonicalRows, today],
  );
  const period = useMemo(() => monthPeriodFor(monthKey, today), [monthKey, today]);

  // نفس منطق الوكيل/الشركة: نحسب صافي كل ما قبل بداية الشهر لكل عملة
  // ونضيفه كسطر «رصيد سابق» افتراضي بدون أي INSERT في قاعدة البيانات.
  const periodRows = useMemo<Tx[]>(() => {
    const opening = new Map<string, number>();
    const monthRows: Tx[] = [];
    for (const t of canonicalRows) {
      const d = String(t.tx_date || "").slice(0, 10);
      const { currency, delta } = currencySupplierDelta(t);
      if (!d || d < period.start) {
        opening.set(currency, (opening.get(currency) || 0) + delta);
        continue;
      }
      if (d >= period.endExclusive) continue;
      monthRows.push(t);
    }
    const openingRows: Tx[] = Array.from(opening.entries())
      .filter(([, net]) => Math.abs(net) > 0.0000001)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, net]) => ({
        id: `opening:${supplierId}:${period.monthKey}:${currency}`,
        supplier_id: supplierId,
        tx_date: period.start,
        tx_type: "رصيد سابق",
        bought_currency: currency,
        bought_amount: net > 0 ? net : 0,
        sold_currency: currency,
        sold_amount: net < 0 ? Math.abs(net) : 0,
        exchange_rate: null,
        description: "رصيد سابق",
        payment_splits: null,
        opening_currency: currency,
        created_at: "",
        isOpeningCarryForward: true,
      }));
    return [...openingRows, ...monthRows];
  }, [canonicalRows, period, supplierId]);

  const filtered = useMemo(() => periodRows.filter((t) => {
    const opening = Boolean(t.isOpeningCarryForward);
    if (!opening && typeFilter && t.tx_type !== typeFilter) return false;
    if (currencyFilter && t.bought_currency !== currencyFilter && t.sold_currency !== currencyFilter && t.opening_currency !== currencyFilter) return false;
    return true;
  }), [periodRows, typeFilter, currencyFilter]);


  // ============================================================
  // جميع الحسابات المالية أدناه تعتمد على المحرك الموحد
  // (Financial Summary Engine) في src/lib/financialSummary.ts
  // — ممنوع تكرار المنطق الحسابي محلياً هنا.
  // ============================================================

  const summary = useMemo(
    () => summarizeCurrencySupplierNetByCurrency(filtered),
    [filtered],
  );

  const rowsWithBalance = useMemo(() => {
    const withBal = attachRunningBalances(filtered);
    return withBal.map((t) => {
      const isBuy = t.tx_type === "شراء عملة";
      const isSell = t.tx_type === "بيع عملة";
      const isCashOut = t.tx_type === "دفع نقدية";
      const isCashIn = t.tx_type === "استلام نقدية";
      const isOpening = t.tx_type === "رصيد سابق";
      const foreignCurrency =
        isBuy ? t.bought_currency :
        isSell ? t.sold_currency :
        isCashOut ? t.sold_currency :
        isCashIn ? t.bought_currency :
        (t.opening_currency || t.bought_currency);
      const foreignAmount =
        isBuy ? Number(t.bought_amount || 0) :
        isSell ? Number(t.sold_amount || 0) :
        isCashOut ? Number(t.sold_amount || 0) :
        isCashIn ? Number(t.bought_amount || 0) :
        isOpening ? Number(t.bought_amount || 0) + Number(t.sold_amount || 0) : 0;
      const egpAmount =
        isBuy ? Number(t.sold_amount || 0) :
        isSell ? Number(t.bought_amount || 0) : 0;
      const rate =
        (isBuy || isSell)
          ? (Number(t.exchange_rate || 0) || (foreignAmount > 0 ? egpAmount / foreignAmount : 0))
          : 0;
      return { ...t, foreignCurrency, foreignAmount, egpAmount, rate };
    });
  }, [filtered]);

  // كروت الإجماليات لكل عملة — من المحرك الموحد مباشرة.
  const byCurrency = useMemo<CurrencyTotal[]>(
    () => summarizeCurrencySupplierStatement(filtered),
    [filtered],
  );




  const exportData = (): StatementExportData => ({
    title: `كشف حساب مورد العملة${supplier?.name ? ` — ${supplier.name}` : ""} — ${monthLabel(period.monthKey)}${currencyFilter ? ` (${arabicCurrencyName(currencyFilter)})` : ""}`,
    subtitle: `${monthLabel(period.monthKey)} — من ${period.start} إلى ${period.endInclusive}${currencyFilter ? ` — العملة: ${arabicCurrencyName(currencyFilter)}` : ""}`,
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
    fileName: buildArabicFileName("كشف حساب مورد العملة", supplier?.name, currencyFilter),
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
              <Wallet size={15} /> صرف نقدية لمورد العملة
            </button>


          </>
        )}
        <ColumnVisibility columns={CS_COLUMNS} visible={visible} onChange={setVisible} />
        {perm.export && <ExportButton getData={exportData} whatsapp={{ phone: supplier?.phone || null, recipientName: supplier?.name || null }} />}
      </div>

      <div className="filter-bar" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <MonthPeriodPicker monthKey={monthKey} onChange={setMonthKey} options={monthOptions} period={period} today={today} />
        <div className="form-group" style={{ minWidth: 160 }}>
          <label>نوع الحركة</label>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">الكل</option>
            <option value="شراء عملة">شراء عملة</option>
            <option value="بيع عملة">بيع عملة</option>
            <option value="دفع نقدية">دفع نقدية للمورد</option>
            <option value="استلام نقدية">استلام نقدية من المورد</option>
            <option value="رصيد سابق">رصيد سابق</option>
          </select>
        </div>
        <CurrencyFilter value={currencyFilter} onChange={setCurrencyFilter} options={ALL_FILTER_CURRENCIES as unknown as string[]} />
        {(typeFilter || currencyFilter) && (
          <button className="action-btn" style={{ alignSelf: "end" }} onClick={() => { setTypeFilter(""); setCurrencyFilter(""); }}>
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
                        r.tx_type === "دفع نقدية" ? "badge-red" :
                        r.tx_type === "استلام نقدية" ? "badge-teal" :
                        "badge-gray"
                      }`}>{r.tx_type === "دفع نقدية" ? "صرف نقدية للمورد" : r.tx_type === "استلام نقدية" ? "استلام نقدية من المورد" : r.tx_type}</span>
                    </td>}
                    {isVisible("cur") && <td data-label="العملة">{r.foreignCurrency}</td>}
                    {isVisible("amt") && <td className="num-col" data-label="المبلغ">{fmtNum(r.foreignAmount)}</td>}
                    {isVisible("rate") && <td className="num-col" data-label="سعر الصرف">{formatExchangeRate(r.rate)}</td>}
                    {isVisible("egp") && <td className="num-col" data-label="القيمة بالجنيه">{r.egpAmount ? fmtNum(r.egpAmount) : "—"}</td>}
                    {isVisible("desc") && <td data-label="البيان">{r.description || ""}</td>}
                    {isVisible("balance") && <td className="num-col" data-label="الرصيد" style={{ fontWeight: 700 }}>{fmtCurrency(Number(r.balance || 0), r.balanceCurrency)}</td>}
                    {isVisible("actions") && (
                      <td data-label="إجراءات">
                        <div style={{ display: "inline-flex", gap: 6 }}>
                          {!r.isOpeningCarryForward && <>
                            <EditTransactionButton table="currency_supplier_transactions" id={r.id} cancelled={false} onDone={refresh} />
                            <CancelTransactionButton table="currency_supplier_transactions" id={r.id} cancelled={false} onDone={refresh} />
                          </>}
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
        <CashMovementModal supplierId={supplierId} kind="دفع نقدية" boxes={boxes} merchants={merchants} onClose={() => setShowPay(false)} onSaved={() => { setShowPay(false); refresh(); }} />
      )}


    </div>
  );
}

// Resolve the target cash_box for a currency code (foreign leg).
// Prefers the stable `method_key` (company_usd / company_lyd); falls back
// to the legacy "الرئيسية" name match for backwards compatibility.
function resolveForeignBox(boxes: CashBox[], currencyCode: string): CashBox | null {
  const code = currencyCode;
  if (!code) return null;
  const active = boxes.filter((b) => b.currency === code && b.is_active !== false);
  const expectedKey = code === "USD" ? "company_usd" : code === "LYD" ? "company_lyd" : null;
  if (expectedKey) {
    const byKey = active.find((b) => (b.method_key || "") === expectedKey);
    if (byKey) return byKey;
  }
  return (
    active.find((b) => b.name.includes("الرئيسية")) ||
    active[0] ||
    null
  );
}


// Resolve the company EGP cash_box for a split method (company_cash | company_instapay).
// Prefers `method_key`; legacy name matching kept as fallback.
function resolveCompanyEgpBox(boxes: CashBox[], method: string): CashBox | null {
  const active = boxes.filter((b) => b.currency === "EGP" && b.is_active !== false);
  if (method === "company_cash") {
    return (
      active.find((b) => (b.method_key || "") === "company_cash") ||
      active.find((b) => b.name.includes("نقدي") && b.name.includes("الشركة")) ||
      null
    );
  }
  if (method === "company_instapay") {
    return (
      active.find((b) => (b.method_key || "") === "company_instapay") ||
      active.find((b) => b.name.includes("إنستا") && b.name.includes("الشركة")) ||
      null
    );
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
  const [commission, setCommission] = useState<string>("0");
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
  const commissionNum = kind === "شراء عملة" ? (Number(commission) || 0) : 0;
  const totalEgpNum = +(egpNum + commissionNum).toFixed(2);
  const splitsDiff = +(totalEgpNum - splitsTotal).toFixed(2);

  const save = async () => {
    const a = Number(foreignAmount);
    const r = Number(rate);
    const e = Number(egpAmount);
    const commissionValue = isBuy ? (Number(commission) || 0) : 0;
    const totalEgp = +(e + commissionValue).toFixed(2);
    if (!txDate) return toast.error("التاريخ مطلوب");
    if (!foreignCurrency) return toast.error("اختر العملة");
    if (!(a > 0) || !(r > 0) || !(e > 0)) return toast.error("أدخل قيمتين على الأقل لحساب الثالثة");
    if (isBuy && commissionValue < 0) return toast.error("العمولة لا يمكن أن تكون سالبة");
    if (!(totalEgp > 0)) return toast.error("إجمالي قيمة العملية يجب أن يكون أكبر من صفر");
    // For "شراء عملة": payment is OPTIONAL. Allow zero payment (full credit to supplier),
    // partial payment, or full payment. Only validate split-row shape when the user
    // actually entered payment amounts. For "بيع عملة": receipts remain required
    // (previous behaviour).
    const hasAnyPayment = splitsTotal > 0;
    if (kind !== "شراء عملة" || hasAnyPayment) {
      const err = validatePaymentSplits(splits);
      if (err) return toast.error(err);
    }
    // Partial payment allowed. Only block if paying MORE than the exchange value.
    if (splitsDiff < -0.5) {
      return toast.error(`إجمالي وسائل الدفع (${fmtNum(splitsTotal)}) يتجاوز قيمة الصفقة بالجنيه (${fmtNum(egpNum)})`);
    }
    const validForCheck = filterValidSplits(splits);
    if (kind === "شراء عملة") {
      // EGP leaves the company / merchants → guard balances only if there are payments.
      if (validForCheck.length > 0) {
        const balanceErr = validateSplitOutflows(validForCheck, balances, merchants);
        if (balanceErr) return toast.error(balanceErr);
      }
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

      sold_amount: isBuy ? totalEgp : a,
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

    // WRITE-SIDE FX LOCK propagation: a newly recorded buy rate can unlock
    // executions and expenses that were pending on this currency. This runs
    // ONLY from the write path — never from a read screen (Dashboard/Reports).
    if (isBuy && foreignCurrency && foreignCurrency !== EGP_CODE) {
      try {
        const { lockPendingExecutionsForCurrency, lockPendingExpensesForCurrency } =
          await import("@/lib/executionProfit");
        await Promise.all([
          lockPendingExecutionsForCurrency(supabase as any, foreignCurrency),
          lockPendingExpensesForCurrency(supabase as any, foreignCurrency),
        ]);
      } catch (fxErr) {
        console.warn("[fx-lock] pending propagation failed", fxErr);
      }
    }

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
          {isBuy && (
            <div className="form-group"><label>العمولة *</label>
              <input type="number" min="0" step="0.01" value={commission}
                onChange={(e) => setCommission(e.target.value)} placeholder="0.00" />
            </div>
          )}
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
          إجمالي حساب المورد: <b>{fmtNum(totalEgpNum)}</b>
          {isBuy && commissionNum > 0 && (
            <span style={{ color: "var(--gold, #b8860b)", marginInlineStart: 8 }}>
              شامل العمولة: {fmtNum(commissionNum)}
            </span>
          )}
          <span style={{ marginInlineStart: 8 }}>إجمالي وسائل الدفع: <b>{fmtNum(splitsTotal)}</b></span>
          {splitsDiff > 0.5 && (
            <span style={{ color: "var(--gold, #b8860b)", marginInlineStart: 8 }}>
              الباقي المستحق للمورد: {fmtNum(splitsDiff)}
            </span>
          )}
          {splitsDiff < -0.5 && (
            <span style={{ color: "var(--red, #c00)", marginInlineStart: 8 }}>
              الفرق (زيادة): {fmtNum(-splitsDiff)}
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

// ============================================================
// CashMovementModal — صرف/استلام نقدية لمورد العملة
// يستخدم نفس PaymentSplits المستخدم في باقي النظام: يدعم الدفع
// من خزائن الشركة أو من تجار الكاش، بعملات مختلفة، وأكثر من سطر.
// ============================================================
function CashMovementModal({
  supplierId, kind, boxes, merchants, onClose, onSaved,
}: {
  supplierId: string;
  kind: "دفع نقدية" | "استلام نقدية";
  boxes: CashBox[];
  merchants: Merchant[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const isOut = kind === "دفع نقدية"; // out = we pay supplier
  const balances = useSourceBalances();

  const [currency, setCurrency] = useState<SplitCurrency>("EGP");
  const [amount, setAmount] = useState<string>("");
  const [txDate, setTxDate] = useState<string>(new Date().toISOString().slice(0, 10));
  const [description, setDescription] = useState<string>("");
  const [note, setNote] = useState<string>("");

  // Lock split rows to the modal's currency (single-currency movement).
  const [splits, setSplits] = useState<PaymentSplitRow[]>(() => {
    const r = newPaymentSplitRow();
    r.currency = "EGP";
    return [r];
  });
  useEffect(() => {
    setSplits((prev) => prev.map((r) => ({ ...r, currency })));
  }, [currency]);
  const onSplitsChange = (next: PaymentSplitRow[]) => {
    setSplits(next.map((r) => ({ ...r, currency })));
  };

  const splitsTotal = useMemo(
    () => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [splits],
  );
  const amountNum = Number(amount) || 0;
  const diff = +(amountNum - splitsTotal).toFixed(2);

  const save = async () => {
    if (!txDate) return toast.error("التاريخ مطلوب");
    if (!(amountNum > 0)) return toast.error("أدخل مبلغاً صحيحاً");
    const vErr = validatePaymentSplits(splits);
    if (vErr) return toast.error(vErr);
    if (Math.abs(diff) > 0.5) {
      return toast.error(`إجمالي سطور الدفع (${fmtNum(splitsTotal)}) لا يساوي المبلغ المطلوب (${fmtNum(amountNum)})`);
    }

    const validSplits = filterValidSplits(splits);

    // ==== Balance guard (outflow only) ====
    if (isOut) {
      // Merchant legs use the shared guard (per-merchant per-currency balances).
      const merchantErr = validateSplitOutflows(validSplits, balances, merchants);
      if (merchantErr) return toast.error(merchantErr);
      // Company legs: check the resolved cash box balance for THIS currency.
      for (const r of validSplits) {
        if (r.source !== "company") continue;
        const box = resolveCompanyBoxForSplit(boxes, r.currency, r.method);
        if (!box) {
          return toast.error(`لا توجد خزينة شركة لـ ${methodLabelForSplit(r.method)} بعملة ${r.currency}`);
        }
        const bErr = validateSingleOutflow(box.name, Number(box.balance || 0), Number(r.amount || 0));
        if (bErr) return toast.error(bErr);
      }
    }

    // ==== Insert parent transaction (metadata only) ====
    const payload: any = {
      supplier_id: supplierId,
      tx_date: txDate,
      tx_type: kind,
      bought_currency: currency,
      bought_amount: isOut ? 0 : amountNum,
      sold_currency: currency,
      sold_amount: isOut ? amountNum : 0,
      exchange_rate: 1,
      description: description.trim() || null,
      payment_splits: validSplits.map((r) => ({
        source: r.source,
        currency,
        merchant_id: r.source === "merchant" ? r.merchant_id : null,
        method: r.method,
        amount: Number(r.amount) || 0,
      })),
    };

    const { data: inserted, error } = await supabase
      .from("currency_supplier_transactions" as any)
      .insert(payload)
      .select("id")
      .single();
    if (error) return toast.error(error.message);
    const txId = (inserted as any)?.id as string;
    await logCreate("currency_supplier_transactions", txId, { ...payload, id: txId }, kind);

    // ==== Build engine splits + merchant side-effects ====
    const engineSplits: MovementSplit[] = [];
    for (const r of validSplits) {
      const amt = Number(r.amount) || 0;
      if (!amt) continue;
      let cashBoxId: string | null = null;
      if (r.source === "company") {
        cashBoxId = resolveCompanyBoxForSplit(boxes, r.currency, r.method)?.id || null;
      }
      engineSplits.push({
        method: methodLabelForSplit(r.method),
        currency,
        cashBoxId,
        amount: amt,
        direction: isOut ? "out" : "in",
        grossAmount: amt,
        netAmount: amt,
        exchangeRate: 1,
        egpEquivalent: currency === "EGP" ? amt : 0,
      });

      // Merchant balance is aggregated from merchant_cash_collections.
      // Convention (see applyTransaction): "buy"/"pay-out" via merchant → +amount
      // (merchant absorbs the outflow on our behalf); collection/receipt → -amount.
      if (r.source === "merchant" && r.merchant_id) {
        const signed = isOut ? +amt : -amt;
        await supabase.from("merchant_cash_collections").insert({
          merchant_id: r.merchant_id,
          date: txDate,
          amount: signed,
          note: null,
          statement: description.trim() ? description.trim() : null,
        });
      }
    }

    const res = await postMovement({
      partyType: "currency_supplier",
      partyId: supplierId,
      kind: isOut ? "payment" : "receipt",
      date: txDate,
      note: note.trim() || undefined,
      statement: description.trim() || undefined,
      splits: engineSplits,
      sourceTable: "currency_supplier_transactions",
      sourceId: txId,
    });
    if (!res.ok) {
      toast.error(res.error || "تعذر تسجيل الحركة في الخزائن");
      return;
    }

    toast.success(isOut ? "تم صرف المبلغ للمورد" : "تم تسجيل استلام المبلغ من المورد");
    onSaved();
  };

  if (typeof document === "undefined") return null;

  return createPortal(
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10001, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ maxWidth: 820, width: "100%", margin: 0, maxHeight: "90vh", overflowY: "auto" }}>
        <div className="card-header">
          <div className="card-title">
            {isOut ? "💸 صرف نقدية لمورد العملة" : "💰 استلام نقدية من مورد العملة"}
          </div>
        </div>

        <div className="form-grid">
          <div className="form-group"><label>التاريخ</label>
            <input type="date" value={txDate} onChange={(e) => setTxDate(e.target.value)} />
          </div>
          <div className="form-group"><label>العملة</label>
            <select value={currency} onChange={(e) => setCurrency(e.target.value as SplitCurrency)}>
              {[EGP_CODE, ...FOREIGN_CURRENCIES].map((c) => (
                <option key={c} value={c}>{CURRENCY_LABEL_AR[c] || c}</option>
              ))}
            </select>
          </div>
          <div className="form-group"><label>المبلغ الإجمالي</label>
            <input type="number" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>البيان</label>
            <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>ملاحظات</label>
            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} />
          </div>
        </div>

        <PaymentSplits
          splits={splits}
          merchants={merchants}
          onChange={onSplitsChange}
          title={isOut ? "سطور الدفع (من الشركة / تاجر كاش)" : "سطور الاستلام (إلى الشركة / تاجر كاش)"}
        />

        <div style={{ padding: "4px 12px 8px", fontSize: 13 }}>
          إجمالي السطور: <b>{fmtNum(splitsTotal)}</b>
          {Math.abs(diff) > 0.5 && (
            <span style={{ color: "var(--red, #c00)", marginInlineStart: 8 }}>
              الفرق عن المبلغ المطلوب: {fmtNum(diff)}
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

/**
 * Resolve the company cash_box for a given (currency, split method).
 *   - EGP + company_cash     → "خزينة نقدي الشركة" EGP
 *   - EGP + company_instapay → "خزينة إنستا الشركة" EGP
 *   - USD/LYD (any method)   → the main foreign box for that currency
 */
function resolveCompanyBoxForSplit(
  boxes: CashBox[],
  currency: string,
  method: string,
): CashBox | null {
  return resolveCompanyCashBoxForSplit(boxes, currency, method);
}

/** Arabic label persisted in payment_splits.method (mirrors CashMovementForms). */
function methodLabelForSplit(method: string): string {
  if (method === "company_instapay") return "إنستاباي";
  if (method === "company_cash") return "نقدي";
  if (method === "merchant_instapay") return "انستا";
  if (method === "merchant_wallet") return "فودافون كاش";
  if (method === "merchant_physical") return "نقدي";
  return "نقدي";
}



