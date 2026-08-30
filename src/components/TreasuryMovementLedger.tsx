import { useEffect, useMemo, useState } from "react";
import { useCompleteFinancialTable } from "@/hooks/useCompleteFinancialTables";
import { supabase } from "@/integrations/supabase/client";
import { normalizeCurrency } from "@/lib/db";

export type TreasuryLedgerCashBox = {
  id: string;
  name: string;
  currency: string;
  balance: number | string | null;
  is_active?: boolean | null;
  method_key?: string | null;
};

type TreasuryLedgerSplit = {
  id: string;
  cash_box_id: string | null;
  amount: number | string | null;
  currency: string | null;
  direction: "in" | "out" | string | null;
  method: string | null;
  source_table: string | null;
  source_id: string | null;
  created_at: string;
  cancelled_at?: string | null;
};

type LedgerKind = "in" | "out" | "transfer_in" | "transfer_out" | "settlement_in" | "settlement_out";

type LedgerRow = {
  id: string;
  cashBoxId: string;
  cashBoxName: string;
  performedAt: string;
  kind: LedgerKind;
  type: string;
  directionLabel: "وارد" | "صادر";
  amount: number;
  currency: string;
  counterparty: string;
  details: string;
  balanceAfter: number;
};

const CURRENCY_LABEL: Record<string, string> = {
  EGP: "جنيه مصري",
  USD: "دولار أمريكي",
  LYD: "دينار ليبي",
};

const SOURCE_LABELS: Record<string, string> = {
  transactions: "حركة وكيل",
  company_transactions: "حركة شركة صادرة",
  expenses: "مصروف",
  expense_deductions: "مصروف",
  currency_supplier_transactions: "حركة مورد عملة",
  investor_transactions: "حركة مالك / مستثمر",
  merchant_cash_collections: "حركة تاجر كاش",
  usd_treasury_transactions: "حركة خزينة دولارية",
  cash_box_transfer: "تحويل بين الخزائن",
  cash_transfers: "تسوية خزنة",
};

function fmt(v: number) {
  return Number(v || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });
}

async function fetchRowsByIds(table: string, columns: string, ids: string[]) {
  if (!ids.length) return [] as any[];
  const rows: any[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await (supabase.from(table as any) as any)
      .select(columns)
      .in("id", chunk);
    if (error) throw error;
    rows.push(...(Array.isArray(data) ? data : []));
  }
  return rows;
}

function uniqueIds(rows: any[], key: string) {
  return Array.from(new Set(rows.map((row) => String(row?.[key] || "")).filter(Boolean)));
}

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

function movementType(split: TreasuryLedgerSplit): { kind: LedgerKind; type: string; directionLabel: "وارد" | "صادر" } {
  const incoming = split.direction === "in";
  const method = String(split.method || "");
  if (split.source_table === "cash_box_transfer") {
    return incoming
      ? { kind: "transfer_in", type: "تحويل وارد من خزنة", directionLabel: "وارد" }
      : { kind: "transfer_out", type: "تحويل صادر إلى خزنة", directionLabel: "صادر" };
  }
  if (split.source_table === "cash_transfers" && method.startsWith("تسوية")) {
    return incoming
      ? { kind: "settlement_in", type: "تسوية زيادة خزنة", directionLabel: "وارد" }
      : { kind: "settlement_out", type: "تسوية عجز خزنة", directionLabel: "صادر" };
  }
  return incoming
    ? { kind: "in", type: "وارد للخزنة", directionLabel: "وارد" }
    : { kind: "out", type: "صادر من الخزنة", directionLabel: "صادر" };
}

function buildCounterparty(
  split: TreasuryLedgerSplit,
  groupBySource: Map<string, TreasuryLedgerSplit[]>,
  boxNameById: Map<string, string>,
  partyNameBySource: Map<string, string>,
) {
  const sourceKey = `${split.source_table || ""}:${split.source_id || ""}`;
  if (split.source_table === "cash_box_transfer") {
    const peer = (groupBySource.get(sourceKey) || []).find((row) => row.cash_box_id && row.cash_box_id !== split.cash_box_id);
    if (peer?.cash_box_id) return boxNameById.get(peer.cash_box_id) || "خزنة أخرى";
    return "خزنة أخرى";
  }
  if (split.source_table === "cash_transfers") return "تسوية الخزنة";
  return partyNameBySource.get(sourceKey)
    || SOURCE_LABELS[String(split.source_table || "")]
    || String(split.source_table || "حركة مالية");
}

export function TreasuryMovementLedger({
  boxes,
  inRange,
}: {
  boxes: TreasuryLedgerCashBox[];
  inRange: (d: string | null | undefined) => boolean;
}) {
  const { rows: allSplits, loading, error } = useCompleteFinancialTable<TreasuryLedgerSplit>("payment_splits");
  const trackedBoxes = useMemo(() => resolveTrackedBoxes(boxes), [boxes]);
  const trackedIds = useMemo(() => new Set(trackedBoxes.map((box) => box.id)), [trackedBoxes]);
  const boxNameById = useMemo(() => new Map(boxes.map((box) => [box.id, box.name])), [boxes]);
  const [partyNameBySource, setPartyNameBySource] = useState<Map<string, string>>(new Map());
  const [historyBox, setHistoryBox] = useState("");
  const [historyDirection, setHistoryDirection] = useState("");
  const [historySearch, setHistorySearch] = useState("");

  useEffect(() => {
    let alive = true;

    const loadCounterparties = async () => {
      try {
        const relevant = allSplits.filter((split) =>
          !split.cancelled_at
          && split.cash_box_id
          && trackedIds.has(split.cash_box_id)
          && split.source_id
          && split.source_table,
        );

        const idsFor = (table: string) => Array.from(new Set(
          relevant
            .filter((split) => split.source_table === table && split.source_id)
            .map((split) => String(split.source_id)),
        ));

        const [agentTxns, companyTxns, merchantCollections, supplierTxns, investorTxns, usdTxns, expenses] = await Promise.all([
          fetchRowsByIds("transactions", "id,agent_id", idsFor("transactions")),
          fetchRowsByIds("company_transactions", "id,company_id", idsFor("company_transactions")),
          fetchRowsByIds("merchant_cash_collections", "id,merchant_id", idsFor("merchant_cash_collections")),
          fetchRowsByIds("currency_supplier_transactions", "id,supplier_id", idsFor("currency_supplier_transactions")),
          fetchRowsByIds("investor_transactions", "id,investor_id", idsFor("investor_transactions")),
          fetchRowsByIds("usd_treasury_transactions", "id,company_id,merchant_id", idsFor("usd_treasury_transactions")),
          fetchRowsByIds("expenses", "id,expense_name", idsFor("expenses")),
        ]);

        const agentIds = uniqueIds(agentTxns, "agent_id");
        const companyIds = Array.from(new Set([
          ...uniqueIds(companyTxns, "company_id"),
          ...uniqueIds(usdTxns, "company_id"),
        ]));
        const merchantIds = Array.from(new Set([
          ...uniqueIds(merchantCollections, "merchant_id"),
          ...uniqueIds(usdTxns, "merchant_id"),
        ]));
        const supplierIds = uniqueIds(supplierTxns, "supplier_id");
        const investorIds = uniqueIds(investorTxns, "investor_id");

        const [agents, companies, merchants, suppliers, investors] = await Promise.all([
          fetchRowsByIds("agents", "id,name", agentIds),
          fetchRowsByIds("issuing_companies", "id,company_name", companyIds),
          fetchRowsByIds("merchants", "id,merchant_name", merchantIds),
          fetchRowsByIds("currency_suppliers", "id,name", supplierIds),
          fetchRowsByIds("investors", "id,investor_name", investorIds),
        ]);

        const agentName = new Map(agents.map((row) => [String(row.id), String(row.name || "")]));
        const companyName = new Map(companies.map((row) => [String(row.id), String(row.company_name || "")]));
        const merchantName = new Map(merchants.map((row) => [String(row.id), String(row.merchant_name || "")]));
        const supplierName = new Map(suppliers.map((row) => [String(row.id), String(row.name || "")]));
        const investorName = new Map(investors.map((row) => [String(row.id), String(row.investor_name || "")]));

        const resolved = new Map<string, string>();
        for (const row of agentTxns) {
          const name = agentName.get(String(row.agent_id || ""));
          if (name) resolved.set(`transactions:${row.id}`, name);
        }
        for (const row of companyTxns) {
          const name = companyName.get(String(row.company_id || ""));
          if (name) resolved.set(`company_transactions:${row.id}`, name);
        }
        for (const row of merchantCollections) {
          const name = merchantName.get(String(row.merchant_id || ""));
          if (name) resolved.set(`merchant_cash_collections:${row.id}`, name);
        }
        for (const row of supplierTxns) {
          const name = supplierName.get(String(row.supplier_id || ""));
          if (name) resolved.set(`currency_supplier_transactions:${row.id}`, name);
        }
        for (const row of investorTxns) {
          const name = investorName.get(String(row.investor_id || ""));
          if (name) resolved.set(`investor_transactions:${row.id}`, name);
        }
        for (const row of usdTxns) {
          const company = companyName.get(String(row.company_id || ""));
          const merchant = merchantName.get(String(row.merchant_id || ""));
          if (company || merchant) resolved.set(`usd_treasury_transactions:${row.id}`, company || merchant || "");
        }
        for (const row of expenses) {
          const name = String(row.expense_name || "").trim();
          if (name) resolved.set(`expenses:${row.id}`, name);
        }

        if (alive) setPartyNameBySource(resolved);
      } catch {
        if (alive) setPartyNameBySource(new Map());
      }
    };

    void loadCounterparties();
    return () => { alive = false; };
  }, [allSplits, trackedIds]);

  const ledger = useMemo(() => {
    const usable = allSplits
      .filter((split) => !split.cancelled_at && split.cash_box_id && trackedIds.has(split.cash_box_id))
      .map((split) => ({ ...split, currency: normalizeCurrency(String(split.currency || "EGP")) }));

    const groupBySource = new Map<string, TreasuryLedgerSplit[]>();
    for (const split of usable) {
      const key = `${split.source_table || ""}:${split.source_id || ""}`;
      const group = groupBySource.get(key) || [];
      group.push(split);
      groupBySource.set(key, group);
    }

    // نحسب الرصيد بعد كل حركة بالرجوع من الرصيد الحالي للخزنة للخلف.
    // ثم نطبق فلتر الفترة في النهاية، لذلك اختيار شهر/فترة لا يغيّر الرصيد التاريخي للحركة.
    const balanceCursor = new Map<string, number>();
    for (const box of trackedBoxes) balanceCursor.set(box.id, Number(box.balance || 0));

    const sortedDesc = [...usable].sort((a, b) => {
      const byDate = String(b.created_at || "").localeCompare(String(a.created_at || ""));
      if (byDate !== 0) return byDate;
      return String(b.id).localeCompare(String(a.id));
    });

    const rows: LedgerRow[] = [];
    for (const split of sortedDesc) {
      if (!split.cash_box_id) continue;
      const current = balanceCursor.get(split.cash_box_id) ?? 0;
      const amount = Math.abs(Number(split.amount || 0));
      const meta = movementType(split);
      const boxName = boxNameById.get(split.cash_box_id) || "خزينة غير معروفة";
      rows.push({
        id: split.id,
        cashBoxId: split.cash_box_id,
        cashBoxName: boxName,
        performedAt: split.created_at,
        kind: meta.kind,
        type: meta.type,
        directionLabel: meta.directionLabel,
        amount,
        currency: String(split.currency || "EGP"),
        counterparty: buildCounterparty(split, groupBySource, boxNameById, partyNameBySource),
        details: String(split.method || SOURCE_LABELS[String(split.source_table || "")] || "حركة مالية"),
        balanceAfter: current,
      });
      balanceCursor.set(split.cash_box_id, split.direction === "out" ? current + amount : current - amount);
    }

    return rows.filter((row) => inRange(String(row.performedAt || "").slice(0, 10)));
  }, [allSplits, trackedBoxes, trackedIds, boxNameById, partyNameBySource, inRange]);

  const filtered = useMemo(() => {
    const search = historySearch.trim().toLowerCase();
    return ledger.filter((row) => {
      if (historyBox && row.cashBoxId !== historyBox) return false;
      if (historyDirection && row.directionLabel !== historyDirection) return false;
      if (!search) return true;
      return [row.cashBoxName, row.type, row.directionLabel, row.counterparty, row.details, row.currency, String(row.amount), String(row.balanceAfter)]
        .join(" ")
        .toLowerCase()
        .includes(search);
    });
  }, [ledger, historyBox, historyDirection, historySearch]);

  const clear = () => {
    setHistoryBox("");
    setHistoryDirection("");
    setHistorySearch("");
  };

  return (
    <div className="card" style={{ marginTop: 16, marginBottom: 0 }}>
      <div className="card-header">
        <div>
          <div className="card-title">📒 سجل الوارد والصادر للخزائن — {filtered.length} من {ledger.length} حركة</div>
          <div className="muted" style={{ marginTop: 4, fontSize: 12 }}>يشمل نقدي الشركة وإنستا الشركة والخزينة الرئيسية للدولار والدينار، مع رصيد الخزينة بعد كل حركة.</div>
        </div>
      </div>
      <div className="card-body">
        <div className="filter-bar" style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 12 }}>
          <select className="filter-select" value={historyBox} onChange={(e) => setHistoryBox(e.target.value)} aria-label="فلتر الخزينة">
            <option value="">كل خزائن الشركة</option>
            {trackedBoxes.map((box) => <option key={box.id} value={box.id}>{box.name}</option>)}
          </select>
          <select className="filter-select" value={historyDirection} onChange={(e) => setHistoryDirection(e.target.value)} aria-label="فلتر اتجاه حركة الخزينة">
            <option value="">وارد وصادر</option>
            <option value="وارد">وارد فقط</option>
            <option value="صادر">صادر فقط</option>
          </select>
          <input
            className="search-input"
            value={historySearch}
            onChange={(e) => setHistorySearch(e.target.value)}
            placeholder="بحث في سجل الخزائن..."
            style={{ minWidth: 220, flex: "1 1 220px" }}
          />
          <button type="button" className="action-btn" onClick={clear} disabled={!historyBox && !historyDirection && !historySearch}>
            مسح الفلاتر
          </button>
        </div>

        {error && <div className="empty" style={{ marginBottom: 10 }}><div className="empty-text">تعذر تحميل سجل الخزائن كاملًا: {error}</div></div>}

        <div className="table-wrap enterprise-table">
          <table className="mobile-cards">
            <thead>
              <tr>
                <th>التاريخ والوقت</th>
                <th>الخزينة</th>
                <th>نوع الحركة</th>
                <th>الاتجاه</th>
                <th>المصدر / الطرف</th>
                <th>المبلغ</th>
                <th>العملة</th>
                <th>رصيد الخزينة بعد الحركة</th>
                <th>التفاصيل</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9}><div className="empty"><div className="empty-text">جارٍ تحميل سجل الخزائن...</div></div></td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={9}><div className="empty"><div className="empty-text">لا توجد حركات خزائن مطابقة للفلاتر</div></div></td></tr>
              ) : filtered.map((row) => (
                <tr key={row.id}>
                  <td data-label="التاريخ والوقت" style={{ whiteSpace: "nowrap" }}>{new Date(row.performedAt).toLocaleString("ar-EG")}</td>
                  <td className="bold" data-label="الخزينة">{row.cashBoxName}</td>
                  <td data-label="نوع الحركة">{row.type}</td>
                  <td data-label="الاتجاه">
                    <span className={`badge pill-badge ${row.directionLabel === "وارد" ? "badge-green" : "badge-red"}`}>{row.directionLabel}</span>
                  </td>
                  <td className="bold" data-label="المصدر / الطرف">{row.counterparty}</td>
                  <td data-label="المبلغ" style={{ fontWeight: 700 }}>{fmt(row.amount)}</td>
                  <td data-label="العملة">{CURRENCY_LABEL[row.currency] || row.currency}</td>
                  <td data-label="الرصيد بعد الحركة" style={{ fontWeight: 800 }}>{fmt(row.balanceAfter)}</td>
                  <td data-label="التفاصيل">{row.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
