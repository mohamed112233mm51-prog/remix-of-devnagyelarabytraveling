import { EditTransactionButton } from "@/components/EditTransactionButton";
import { CancelTransactionButton } from "@/components/CancelTransactionButton";
import { useEffect, useMemo, useState } from "react";
import { normalizeCurrency, fmtBalance } from "@/lib/db";
import { cairoToday } from "@/lib/approvalFines";
import { monthLabel } from "@/components/MonthPeriodPicker";
import type { ExpenseArchiveScope } from "@/lib/expenseArchive";
import { emptyTreasuryPage, TREASURY_PAGE_SIZE } from "@/lib/treasuryLedger";
import { useTreasuryLedgerPage } from "@/hooks/useTreasuryLedgerPage";

export type TreasuryLedgerCashBox = {
  id: string; name: string; currency: string; balance: number | string | null;
  is_active?: boolean | null; method_key?: string | null;
};
const CURRENCY_LABEL: Record<string, string> = { EGP: "جنيه مصري", USD: "دولار أمريكي", LYD: "دينار ليبي" };
function resolveTrackedBoxes(boxes: TreasuryLedgerCashBox[]) {
  const active = boxes.filter((box) => box.is_active !== false);
  const byKey = new Map(active.filter((box) => box.method_key).map((box) => [String(box.method_key), box]));
  const picked = new Map<string, TreasuryLedgerCashBox>();

  const take = (box: TreasuryLedgerCashBox | undefined | null) => {
    if (box) picked.set(box.id, box);
  };

  take(byKey.get("company_cash"));
  take(byKey.get("company_instapay"));
  take(byKey.get("company_usd"));
  take(byKey.get("company_lyd"));

  if (!byKey.get("company_cash")) {
    take(active.find((box) => normalizeCurrency(box.currency) === "EGP" && /نقد|cash/i.test(box.name) && /شركة|company/i.test(box.name)));
  }
  if (!byKey.get("company_instapay")) {
    take(active.find((box) => normalizeCurrency(box.currency) === "EGP" && /انستا|insta/i.test(box.name) && /شركة|company/i.test(box.name)));
  }
  if (!byKey.get("company_usd")) {
    take(active.find((box) => normalizeCurrency(box.currency) === "USD" && /رئيس|main/i.test(box.name)) || active.find((box) => normalizeCurrency(box.currency) === "USD"));
  }
  if (!byKey.get("company_lyd")) {
    take(active.find((box) => normalizeCurrency(box.currency) === "LYD" && /رئيس|main/i.test(box.name)) || active.find((box) => normalizeCurrency(box.currency) === "LYD"));
  }

  return Array.from(picked.values());
}


export function TreasuryMovementLedger({ boxes, operationsOnly = false }: {
  boxes: TreasuryLedgerCashBox[]; operationsOnly?: boolean;
}) {
  const [today, setToday] = useState(cairoToday);
  const [scope, setScope] = useState<ExpenseArchiveScope>("current");
  const [month, setMonth] = useState("");
  const [page, setPage] = useState(0);
  const [historyBox, setHistoryBox] = useState("");
  const [direction, setDirection] = useState("");
  const [kind, setKind] = useState("");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const tracked = useMemo(() => operationsOnly ? boxes : resolveTrackedBoxes(boxes), [boxes, operationsOnly]);
  const ids = useMemo(() => tracked.map(box => box.id).sort(), [tracked]);
  useEffect(() => {
    const timer = setInterval(() => setToday(cairoToday()), 60_000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => { setDebouncedSearch(search); setPage(0); }, 300);
    return () => clearTimeout(timer);
  }, [search]);
  useEffect(() => { setPage(0); setMonth(""); }, [today.slice(0, 7)]);
  const result = useTreasuryLedgerPage({
    boxIds: ids, scope, month, page, boxId: historyBox, direction, search: debouncedSearch,
    operations: operationsOnly, kind,
  }, today.slice(0, 7));
  const data = result.data || emptyTreasuryPage;
  const pageCount = Math.max(1, Math.ceil(data.total / TREASURY_PAGE_SIZE));
  const currentPage = data.page;
  const changeScope = (value: ExpenseArchiveScope) => { setScope(value); setMonth(""); setPage(0); };
  const clear = () => { setHistoryBox(""); setDirection(""); setKind(""); setSearch(""); setDebouncedSearch(""); setPage(0); };
  const refresh = () => { void result.refetch(); };
  const busy = result.isFetching;
  const rows = result.data?.rows || [];
  const title = operationsOnly ? "📜 سجل تسويات وتحويلات الخزائن" : "📒 سجل الوارد والصادر للخزائن";
  return (
    <div className="card" style={{ marginTop: 16, marginBottom: 0 }}>
      <div className="card-header"><div className="card-title">{title} — {data.total} حركة</div></div>
      <div className="card-body">
        <div className="filter-bar" role="group" aria-label={operationsOnly ? "أرشيف التسويات والتحويلات" : "أرشيف سجل الخزائن"}
          style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <button type="button" className={"action-btn" + (scope === "current" ? " active" : "")}
            aria-pressed={scope === "current"} onClick={() => changeScope("current")}>الشهر الحالي ({data.currentCount})</button>
          <button type="button" className={"action-btn" + (scope === "archive" ? " active" : "")}
            aria-pressed={scope === "archive"} onClick={() => changeScope("archive")}>الأرشيف ({data.archivedCount})</button>
          {data.upcomingCount > 0 && <button type="button" className="action-btn" onClick={() => changeScope("upcoming")}>المستقبلية ({data.upcomingCount})</button>}
          {data.undatedCount > 0 && <button type="button" className="action-btn" onClick={() => changeScope("undated")}>بلا تاريخ صالح ({data.undatedCount})</button>}
          {scope === "archive" && <select className="filter-select" value={month}
            onChange={e => { setMonth(e.target.value); setPage(0); }} aria-label="اختيار شهر أرشيف الخزائن">
            <option value="">كل الأرشيف</option>{data.months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
          </select>}
          <button type="button" className="action-btn" onClick={refresh} disabled={busy}>تحديث</button>
        </div>
        <div className="filter-bar" style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <select className="filter-select" value={historyBox} onChange={e => { setHistoryBox(e.target.value); setPage(0); }} aria-label="فلتر الخزينة">
            <option value="">كل خزائن الشركة</option>{tracked.map(box => <option key={box.id} value={box.id}>{box.name}</option>)}
          </select>
          {operationsOnly ? <select className="filter-select" value={kind} onChange={e => { setKind(e.target.value); setPage(0); }} aria-label="فلتر نوع حركة الخزينة">
            <option value="">كل أنواع الحركات</option><option value="transfer">تحويل بين الخزائن</option>
            <option value="settlement_in">تسوية زيادة خزنة</option><option value="settlement_out">تسوية عجز خزنة</option>
          </select> : <select className="filter-select" value={direction} onChange={e => { setDirection(e.target.value); setPage(0); }} aria-label="فلتر اتجاه حركة الخزينة">
            <option value="">وارد وصادر</option><option value="in">وارد فقط</option><option value="out">صادر فقط</option>
          </select>}
          <input className="search-input" value={search} onChange={e => setSearch(e.target.value)}
            placeholder="بحث في سجل الخزائن..." aria-label="بحث في سجل الخزائن" style={{ minWidth: 180, flex: "1 1 180px" }} />
          <button type="button" className="action-btn" onClick={clear} disabled={!historyBox && !direction && !kind && !search}>مسح الفلاتر</button>
        </div>
        {result.error && <div role="alert" className="empty-text">{result.error.message}<button type="button" className="action-btn" onClick={refresh}>إعادة المحاولة</button></div>}
        <div className="table-wrap enterprise-table" aria-busy={busy}>
          <table className="mobile-cards">
            <thead><tr>
              <th>التاريخ والوقت</th>{!operationsOnly && <th>الخزينة</th>}<th>نوع الحركة</th>
              {operationsOnly ? <><th>من</th><th>إلى</th></> : <><th>الاتجاه</th><th>المصدر / الطرف</th></>}
              <th>المبلغ</th><th>العملة</th>{!operationsOnly && <th>رصيد الخزينة بعد الحركة</th>}<th>التفاصيل</th>{operationsOnly && <th>إجراءات</th>}
            </tr></thead>
            <tbody>
              {busy ? <tr><td colSpan={operationsOnly ? 8 : 9}>جارٍ تحميل سجل الخزائن...</td></tr>
                : result.error ? null : rows.length === 0 ? <tr><td colSpan={operationsOnly ? 8 : 9}>لا توجد حركات خزائن مطابقة للفترة والفلاتر</td></tr>
                : rows.map(row => <tr key={row.id}>
                  <td data-label="التاريخ والوقت" style={{ whiteSpace: "nowrap" }}>{row.performedAt
                    ? new Date(row.performedAt).toLocaleString("ar-EG-u-nu-latn", { timeZone: "Africa/Cairo" }) : "—"}</td>
                  {!operationsOnly && <td className="bold" data-label="الخزينة">{row.cashBoxName}</td>}
                  <td data-label="نوع الحركة">{row.type}</td>
                  {operationsOnly ? <><td data-label="من">{row.from}</td><td data-label="إلى">{row.to}</td></> : <>
                    <td data-label="الاتجاه"><span className={"badge pill-badge " + (row.direction === "in" ? "badge-green" : "badge-red")}>{row.directionLabel}</span></td>
                    <td data-label="المصدر / الطرف" className="bold">{row.counterparty}</td>
                  </>}
                  <td data-label="المبلغ" style={{ fontWeight: 700 }}>{fmtBalance(Number(row.amount))}</td>
                  <td data-label="العملة">{CURRENCY_LABEL[row.currency] || row.currency}</td>
                  {!operationsOnly && <td data-label="الرصيد بعد الحركة" style={{ fontWeight: 800 }}>{fmtBalance(Number(row.balanceAfter))}</td>}
                  <td data-label="التفاصيل">{row.details}</td>
                  {operationsOnly && <td data-label="إجراءات">{row.kind === "transfer" && <>
                    <EditTransactionButton table="payment_splits" id={row.id} cancelled={false} onDone={refresh} />
                    <CancelTransactionButton table="payment_splits" id={row.id} cancelled={false} onDone={refresh} />
                  </>}</td>}
                </tr>)}
            </tbody>
          </table>
        </div>
        <div className="filter-bar" style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 12, flexWrap: "wrap" }} aria-label="صفحات سجل الخزائن">
          <span>عرض {data.total ? currentPage * TREASURY_PAGE_SIZE + 1 : 0} – {Math.min(data.total, (currentPage + 1) * TREASURY_PAGE_SIZE)} من {data.total}</span>
          <button type="button" className="action-btn" disabled={busy || currentPage === 0} onClick={() => setPage(0)}>الأولى</button>
          <button type="button" className="action-btn" disabled={busy || currentPage === 0} onClick={() => setPage(currentPage - 1)}>السابق</button>
          <span>صفحة {currentPage + 1} من {pageCount} — 50 سطرًا / صفحة</span>
          <button type="button" className="action-btn" disabled={busy || currentPage + 1 >= pageCount} onClick={() => setPage(currentPage + 1)}>التالي</button>
          <button type="button" className="action-btn" disabled={busy || currentPage + 1 >= pageCount} onClick={() => setPage(pageCount - 1)}>الأخيرة</button>
        </div>
      </div>
    </div>
  );
}
