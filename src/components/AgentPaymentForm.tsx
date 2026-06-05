import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLive, useDropdownOptions, type Agent, type Merchant } from "@/lib/db";
import { SafeSelectOptions } from "@/components/SafeSelectOptions";

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

  const [form, setForm] = useState({
    agent_id: lockedAgentId || "",
    date: new Date().toISOString().slice(0, 10),
    service_type: "",
    destination: "",
    count: "0",
    price: "",
    note: "",
  });
  const [splits, setSplits] = useState<SplitRow[]>([newRow()]);
  const [saving, setSaving] = useState(false);

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
    if (m.supports_cash_wallet) opts.push({ key: "merchant_wallet", label: `كاش محفظة ${m.merchant_name}` });
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
        : firstMethodKey === "merchant_wallet" ? "كاش محفظة"
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
      merchant_cash_amount: merchantWallet,
      merchant_cash_net_amount: merchantWallet,
      merchant_cash_physical_amount: merchantPhysical,
      arabic_tourism_cash_amount: 0,
      arabic_tourism_cash_net_amount: 0,
      mobile_cash_amount: 0,
      mobile_cash_net_amount: 0,
      total_paid: totalAmount,
      paid: totalAmount,
      merchant_id: firstMerchant,
      note: form.note.trim() || description,
      source_service_type: "payment",
    };

    setSaving(true);
    const { data: txnRow, error: txnErr } = await supabase
      .from("transactions").insert(payload).select("id").single();
    if (txnErr || !txnRow) { setSaving(false); return toast.error(txnErr?.message || "تعذر حفظ الدفعة"); }

    // Insert payment_splits for each row. Company rows → tie to cash_box; merchant rows → no cash_box.
    const splitRecords = validSplits.map((r) => {
      const amount = Number(r.amount) || 0;
      let methodLabel = "نقدي";
      let cashBoxId: string | null = null;
      if (r.method === "company_instapay") {
        methodLabel = "إنستاباي";
        const box = cashBoxes.find((b) => b.currency === r.currency && b.name.includes("إنستا") && b.name.includes("الشركة"));
        cashBoxId = box?.id || null;
      } else if (r.method === "company_cash") {
        methodLabel = "نقدي";
        const box = cashBoxes.find((b) => b.currency === r.currency && b.name.includes("نقدي") && b.name.includes("الشركة"));
        cashBoxId = box?.id || null;
      } else if (r.method === "merchant_instapay") methodLabel = "إنستاباي تاجر";
      else if (r.method === "merchant_wallet") methodLabel = "كاش محفظة تاجر";
      else if (r.method === "merchant_physical") methodLabel = "نقدي تاجر";

      return {
        transaction_id: txnRow.id,
        method: methodLabel,
        currency: r.currency,
        cash_box_id: cashBoxId,
        amount,
        exchange_rate: 1,
        egp_equivalent: r.currency === "EGP" ? amount : 0,
      };
    });
    if (splitRecords.length) {
      const { error: spErr } = await supabase.from("payment_splits").insert(splitRecords);
      if (spErr) console.warn("payment_splits insert error:", spErr.message);
    }

    try {
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("activity_logs").insert({
        user_id: u.user?.id ?? null,
        user_email: u.user?.email ?? null,
        action: "agent_payment_added",
        entity: "transactions",
        details: { agent_id: form.agent_id, amount: totalAmount, splits: validSplits.length, date: form.date },
      });
    } catch { /* ignore */ }

    setSaving(false);
    toast.success("تم تسجيل الدفعة");
    onDone();
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💳 إضافة دفعة من الوكيل</div></div>
      <div className="form-grid">
        <div className="form-group"><label>الوكيل *</label>
          <select value={form.agent_id} onChange={(e) => set("agent_id", e.target.value)} disabled={!!lockedAgentId}>
            <option value="" disabled>اختر...</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>التاريخ *</label>
          <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        </div>
        <div className="form-group"><label>نوع الخدمة (اختياري)</label>
          <select value={form.service_type} onChange={(e) => set("service_type", e.target.value)}>
            <option value="">— بدون خدمة —</option>
            <SafeSelectOptions options={SERVICE_TYPES} />
          </select>
        </div>
        <div className="form-group"><label>وجهة السفر (اختياري)</label>
          <select value={form.destination} onChange={(e) => set("destination", e.target.value)}>
            <option value="">—</option>
            <SafeSelectOptions options={DESTINATIONS} />
          </select>
        </div>
        <div className="form-group"><label>العدد (اختياري)</label>
          <input type="number" min={0} value={form.count} onChange={(e) => set("count", e.target.value)} />
        </div>
        <div className="form-group"><label>السعر (اختياري)</label>
          <input type="number" min={0} value={form.price} onChange={(e) => set("price", e.target.value)} />
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
        {splits.map((row, idx) => {
          const methods = methodsForSplit(row);
          return (
            <div key={row.uid} className="form-grid" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
              <div className="form-group"><label>جهة التحصيل</label>
                <select value={row.source} onChange={(e) => updateSplit(row.uid, { source: e.target.value as Source, merchant_id: "", method: e.target.value === "company" ? "company_cash" : "" })}>
                  <option value="company">الشركة</option>
                  <option value="merchant">تاجر</option>
                </select>
              </div>
              <div className="form-group"><label>العملة</label>
                <select value={row.currency} onChange={(e) => updateSplit(row.uid, { currency: e.target.value as Currency })}>
                  {CURRENCY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              {row.source === "merchant" && (
                <div className="form-group"><label>التاجر</label>
                  <select value={row.merchant_id} onChange={(e) => updateSplit(row.uid, { merchant_id: e.target.value, method: "" })}>
                    <option value="" disabled>اختر...</option>
                    {merchants.map((m) => <option key={m.id} value={m.id}>{m.merchant_name}</option>)}
                  </select>
                </div>
              )}
              <div className="form-group"><label>وسيلة الدفع</label>
                <select value={row.method} onChange={(e) => updateSplit(row.uid, { method: e.target.value })}>
                  <option value="" disabled>اختر...</option>
                  {methods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              <div className="form-group"><label>المبلغ</label>
                <input type="number" min={0} value={row.amount} onChange={(e) => updateSplit(row.uid, { amount: e.target.value })} />
              </div>
              <div className="form-group" style={{ alignSelf: "end" }}>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => removeSplit(row.uid)} disabled={splits.length === 1}>حذف</button>
              </div>
            </div>
          );
        })}
      </div>

      <div className="form-footer" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontWeight: 700 }}>إجمالي الدفعة: {totalAmount.toLocaleString()}</div>
        <button className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ الدفعة</button>
      </div>
    </div>
  );
}
