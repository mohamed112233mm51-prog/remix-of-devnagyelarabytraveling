import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLive, useDropdownOptions, type Agent, type Merchant } from "@/lib/db";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { NumberInput } from "@/components/inputs/NumberInput";
import { DateInput } from "@/components/inputs/DateInput";
import { usePersistentState } from "@/hooks/usePersistentState";
import { activeOptions } from "@/lib/activeFilter";
import { postMovement } from "@/lib/financialEngine";

type CashBox = { id: string; name: string; currency: string; balance: number; is_active: boolean };

type Currency = "EGP" | "USD" | "LYD";
type Source = "company" | "merchant";

type SplitRow = {
  uid: string;
  source: Source;
  currency: Currency;
  merchant_id: string;
  method: string; // chosen label key from method dropdown
  amount: string;
};

const CURRENCY_OPTIONS: { value: Currency; label: string }[] = [
  { value: "EGP", label: "جنيه مصري" },
  { value: "USD", label: "دولار" },
  { value: "LYD", label: "دينار ليبي" },
];

// Company method keys
const COMPANY_METHODS = [
  { key: "company_cash", label: "نقدي الشركة" },
  { key: "company_instapay", label: "إنستا الشركة" },
];

const newRow = (): SplitRow => ({
  uid: Math.random().toString(36).slice(2),
  source: "company",
  currency: "EGP",
  merchant_id: "",
  method: "company_cash",
  amount: "",
});

export function AgentPaymentForm({
  agents,
  merchants,
  lockedAgentId,
  onDone,
}: {
  agents: Agent[];
  merchants: Merchant[];
  lockedAgentId?: string;
  onDone: () => void;
}) {
  const { rows: cashBoxes } = useLive<CashBox>("cash_boxes");
  const SERVICE_TYPES = useDropdownOptions("service_type");
  const DESTINATIONS = useDropdownOptions("destination");

  const draftKey = `draft:agent-payment:${lockedAgentId || "new"}`;
  const [form, setForm, clearForm] = usePersistentState(`${draftKey}:form`, {
    agent_id: lockedAgentId || "",
    date: new Date().toISOString().slice(0, 10),
    service_type: "",
    destination: "",
    count: "0",
    price: "",
    note: "",
    statement: "",
  });

  const [splits, setSplits, clearSplits] = usePersistentState<SplitRow[]>(`${draftKey}:splits`, [newRow()]);
  const [saving, setSaving] = useState(false);
  const resetDraft = () => { clearForm(); clearSplits(); };

  useEffect(() => {
    if (lockedAgentId) setForm((p) => ({ ...p, agent_id: lockedAgentId }));
  }, [lockedAgentId]);

  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));
  const tripValueNum = (Number(form.count) || 0) * (Number(form.price) || 0);

  const updateSplit = (uid: string, patch: Partial<SplitRow>) =>
    setSplits((rows) => rows.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  const removeSplit = (uid: string) =>
    setSplits((rows) => (rows.length === 1 ? rows : rows.filter((r) => r.uid !== uid)));
  const addSplit = () => setSplits((rows) => [...rows, newRow()]);

  const methodsForSplit = (row: SplitRow): { key: string; label: string }[] => {
    if (row.source === "company") return COMPANY_METHODS;
    const m = merchants.find((x) => x.id === row.merchant_id);
    if (!m) return [];
    const opts: { key: string; label: string }[] = [];
    if (m.supports_instapay) opts.push({ key: "merchant_instapay", label: `إنستا ${m.merchant_name}` });
    if (m.supports_cash_wallet) opts.push({ key: "merchant_wallet", label: `تاجر الكاش ${m.merchant_name}` });
    if (m.supports_physical_cash) opts.push({ key: "merchant_physical", label: `نقدي ${m.merchant_name}` });
    return opts;
  };

  const splitBreakdown = (r: SplitRow) => {
    const gross = Number(r.amount) || 0;
    const hasCommission = r.method === "merchant_wallet";
    const rate = hasCommission ? 1 : 0;
    const commission = hasCommission ? Math.round(gross * 0.01) : 0;
    const net = gross - commission;
    return { gross, rate, commission, net, hasCommission };
  };

  const totalGross = useMemo(
    () => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [splits],
  );
  const totalNet = useMemo(
    () => splits.reduce((s, r) => s + splitBreakdown(r).net, 0),
    [splits],
  );

  const save = async () => {
    if (!form.agent_id) return toast.error("اختر الوكيل");
    if (!form.date) return toast.error("التاريخ مطلوب");

    const validSplits = splits.filter((r) => Number(r.amount) > 0);
    if (validSplits.length === 0) return toast.error("أضف وسيلة دفع واحدة على الأقل بمبلغ");

    for (const r of validSplits) {
      if (r.source === "merchant" && !r.merchant_id) return toast.error("اختر التاجر لكل سطر تاجر");
      if (!r.method) return toast.error("اختر وسيلة الدفع لكل سطر");
      const allowed = methodsForSplit(r).map((m) => m.key);
      if (!allowed.includes(r.method)) return toast.error("وسيلة الدفع غير مفعلة لهذا التاجر");
    }

    // Aggregate amounts onto the transaction record (used by ledger)
    let instapay = 0, cash = 0, merchantWalletGross = 0, merchantWalletNet = 0, merchantPhysical = 0;
    for (const r of validSplits) {
      const a = Number(r.amount) || 0;
      const b = splitBreakdown(r);
      if (r.method === "company_instapay" || r.method === "merchant_instapay") instapay += a;
      else if (r.method === "company_cash") cash += a;
      else if (r.method === "merchant_wallet") { merchantWalletGross += b.gross; merchantWalletNet += b.net; }
      else if (r.method === "merchant_physical") merchantPhysical += a;
    }

    const firstMerchant = validSplits.find((r) => r.source === "merchant")?.merchant_id || null;
    const firstMethodKey = validSplits[0].method;
    const firstMethodLabel =
      firstMethodKey === "company_instapay" ? "إنستاباي"
        : firstMethodKey === "company_cash" ? "نقدي"
        : firstMethodKey === "merchant_instapay" ? "إنستاباي"
        : firstMethodKey === "merchant_wallet" ? "تاجر الكاش"
        : "كاش نقدي تاجر";

    const description = form.service_type || "دفعة من الوكيل";

    const payload: any = {
      agent_id: form.agent_id,
      date: form.date,
      destination: form.destination || null,
      service_type: form.service_type || null,
      count: Number(form.count) || 0,
      price: Number(form.price) || 0,
      payment_method: firstMethodLabel,
      instapay_amount: instapay,
      cash_amount: cash,
      merchant_cash_amount: merchantWalletGross,
      merchant_cash_net_amount: merchantWalletNet,
      merchant_cash_physical_amount: merchantPhysical,
      arabic_tourism_cash_amount: 0,
      arabic_tourism_cash_net_amount: 0,
      mobile_cash_amount: 0,
      mobile_cash_net_amount: 0,
      total_paid: totalNet,
      paid: totalNet,
      merchant_id: firstMerchant,
      note: form.note.trim() || description,
      source_service_type: "payment",
    };

    setSaving(true);
    const { data: txnRow, error: txnErr } = await supabase
      .from("transactions").insert(payload).select("id").single();
    if (txnErr || !txnRow) { setSaving(false); return toast.error(txnErr?.message || "تعذر حفظ الدفعة"); }

    // Post financial movement via Engine → payment_splits with direction/source
    // → triggers auto-update cash boxes → ledgers/dashboard/reports all consistent.
    const engineSplits = validSplits.map((r) => {
      const b = splitBreakdown(r);
      let methodLabel = "نقدي";
      let cashBoxId: string | null = null;
      if (r.method === "company_instapay") {
        methodLabel = "إنستاباي";
        const box = cashBoxes.find((bb) => bb.currency === r.currency && bb.name.includes("إنستا") && bb.name.includes("الشركة"));
        cashBoxId = box?.id || null;
      } else if (r.method === "company_cash") {
        methodLabel = "نقدي";
        const box = cashBoxes.find((bb) => bb.currency === r.currency && bb.name.includes("نقدي") && bb.name.includes("الشركة"));
        cashBoxId = box?.id || null;
      } else if (r.method === "merchant_instapay") methodLabel = "إنستاباي تاجر";
      else if (r.method === "merchant_wallet") methodLabel = "تاجر الكاش تاجر";
      else if (r.method === "merchant_physical") methodLabel = "نقدي تاجر";
      return {
        method: methodLabel,
        currency: r.currency,
        cashBoxId,
        amount: b.net,
        direction: "in" as const,
        grossAmount: b.gross,
        commissionRate: b.rate,
        commissionAmount: b.commission,
        netAmount: b.net,
        exchangeRate: 1,
        egpEquivalent: r.currency === "EGP" ? b.net : 0,
      };
    });
    const engineRes = await postMovement({
      partyType: "agent",
      partyId: form.agent_id,
      kind: "receipt",
      date: form.date,
      note: form.note.trim() || description,
      splits: engineSplits,
      sourceTable: "transactions",
      sourceId: txnRow.id,
      transactionId: txnRow.id,
    });
    if (!engineRes.ok) console.warn("engine post error:", engineRes.error);

    try {
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("activity_logs").insert({
        user_id: u.user?.id ?? null,
        user_email: u.user?.email ?? null,
        action: "agent_payment_added",
        entity: "transactions",
        details: { agent_id: form.agent_id, gross: totalGross, net: totalNet, splits: validSplits.length, date: form.date },
      });
    } catch { /* ignore */ }


    setSaving(false);
    toast.success("تم تسجيل الدفعة");
    resetDraft();
    onDone();
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💳 إضافة دفعة من الوكيل</div></div>
      <div className="form-grid">
        <div className="form-group"><label>الوكيل *</label>
          <SearchableSelect
            value={form.agent_id}
            onChange={(v) => set("agent_id", v)}
            options={activeOptions(agents, form.agent_id, (a) => a.name)}
            disabled={!!lockedAgentId}
            placeholder="اختر..."
          />
        </div>
        <div className="form-group"><label>التاريخ *</label>
          <DateInput value={form.date} onChange={(iso) => set("date", iso)} defaultToday />
        </div>
        <div className="form-group"><label>نوع الخدمة (اختياري)</label>
          <SearchableSelect value={form.service_type} onChange={(v) => set("service_type", v)} options={SERVICE_TYPES as unknown as string[]} placeholder="— بدون خدمة —" />
        </div>
        <div className="form-group"><label>وجهة السفر (اختياري)</label>
          <SearchableSelect value={form.destination} onChange={(v) => set("destination", v)} options={DESTINATIONS as unknown as string[]} />
        </div>
        <div className="form-group"><label>العدد (اختياري)</label>
          <NumberInput value={Number(form.count) || 0} onChange={(n) => set("count", n === 0 ? "" : String(n))} min={0} />
        </div>
        <div className="form-group"><label>السعر (اختياري)</label>
          <NumberInput value={Number(form.price) || 0} onChange={(n) => set("price", n === 0 ? "" : String(n))} min={0} />
        </div>
        <div className="form-group"><label>قيمة الرحلة (محسوبة)</label>
          <input type="number" value={tripValueNum || ""} disabled readOnly />
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="اختياري" />
        </div>
      </div>

      <div className="card-header" style={{ marginTop: 8 }}>
        <div className="card-title">وسيلة الدفع</div>
        <button type="button" className="btn btn-sm" onClick={addSplit}>+ إضافة سطر</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8 }}>
        {splits.map((row) => {
          const methods = methodsForSplit(row);
          const b = splitBreakdown(row);
          return (
            <div key={row.uid} className="form-grid" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
              <div className="form-group"><label>جهة التحصيل</label>
                <SearchableSelect
                  value={row.source}
                  onChange={(v) => updateSplit(row.uid, { source: v as Source, merchant_id: "", method: v === "company" ? "company_cash" : "" })}
                  options={[{ value: "company", label: "الشركة" }, { value: "merchant", label: "تاجر" }]}
                  allowClear={false}
                />
              </div>
              <div className="form-group"><label>العملة</label>
                <SearchableSelect
                  value={row.currency}
                  onChange={(v) => updateSplit(row.uid, { currency: v as Currency })}
                  options={CURRENCY_OPTIONS.map((c) => ({ value: c.value, label: c.label }))}
                  allowClear={false}
                />
              </div>
              {row.source === "merchant" && (
                <div className="form-group"><label>التاجر</label>
                  <SearchableSelect
                    value={row.merchant_id}
                    onChange={(v) => updateSplit(row.uid, { merchant_id: v, method: "" })}
                    options={activeOptions(merchants, row.merchant_id, (m) => m.merchant_name)}
                    placeholder="اختر..."
                  />
                </div>
              )}
              <div className="form-group"><label>وسيلة الدفع</label>
                <SearchableSelect
                  value={row.method}
                  onChange={(v) => updateSplit(row.uid, { method: v })}
                  options={methods.map((m) => ({ value: m.key, label: m.label }))}
                  placeholder="اختر..."
                />
              </div>
              <div className="form-group"><label>{b.hasCommission ? "المبلغ المستلم من الوكيل" : "المبلغ"}</label>
                <NumberInput value={Number(row.amount) || 0} onChange={(n) => updateSplit(row.uid, { amount: n === 0 ? "" : String(n) })} min={0} />
              </div>
              {b.hasCommission && (
                <>
                  <div className="form-group"><label>عمولة تاجر الكاش 1%</label>
                    <input type="number" value={b.commission || ""} disabled readOnly />
                  </div>
                  <div className="form-group"><label>الصافي المخصوم من الوكيل</label>
                    <input type="number" value={b.net || ""} disabled readOnly style={{ fontWeight: 700, color: "var(--green)" }} />
                  </div>
                </>
              )}
              <div className="form-group" style={{ alignSelf: "end" }}>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => removeSplit(row.uid)} disabled={splits.length === 1}>حذف</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="form-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontWeight: 700 }}>
          الصافي المخصوم من الوكيل: {totalNet.toLocaleString()}
          {totalGross !== totalNet && (
            <span style={{ fontWeight: 400, marginInlineStart: 12, color: "var(--muted)" }}>
              (المستلم: {totalGross.toLocaleString()} − عمولة تاجر الكاش: {(totalGross - totalNet).toLocaleString()})
            </span>
          )}
        </div>
        <button data-confirm-save="تأكيد حفظ الدفعة" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ الدفعة</button>
      </div>
    </div>
  );
}
