import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useLive, useDropdownOptions, type Agent, type Merchant } from "@/lib/db";
import { SafeSelectOptions } from "@/components/SafeSelectOptions";

type MethodKey =
  | "company_instapay"
  | "company_cash"
  | "merchant_instapay"
  | "merchant_wallet"
  | "merchant_physical";

type CashBox = { id: string; name: string; currency: string; balance: number; is_active: boolean };

const COMPANY_CASH_BOX_NAME = "خزينة نقدي الشركة";
const COMPANY_INSTAPAY_BOX_NAME = "خزينة إنستا الشركة";

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
    count: "1",
    price: "",
    payment_method: "company_instapay" as MethodKey,
    merchant_id: "",
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string | boolean) =>
    setForm((p) => ({ ...p, [k]: v }) as typeof p);

  useEffect(() => {
    if (lockedAgentId) setForm((p) => ({ ...p, agent_id: lockedAgentId }));
  }, [lockedAgentId]);

  const tripValueNum = (Number(form.count) || 0) * (Number(form.price) || 0);

  const merchant = useMemo(
    () => merchants.find((m) => m.id === form.merchant_id),
    [merchants, form.merchant_id],
  );

  const methodOptions = useMemo<{ key: MethodKey; label: string }[]>(() => {
    const opts: { key: MethodKey; label: string }[] = [
      { key: "company_instapay", label: "إنستا الشركة" },
      { key: "company_cash", label: "نقدي الشركة" },
    ];
    if (merchant) {
      if (merchant.supports_instapay) opts.push({ key: "merchant_instapay", label: `إنستا ${merchant.merchant_name}` });
      if (merchant.supports_cash_wallet) opts.push({ key: "merchant_wallet", label: `كاش محفظة ${merchant.merchant_name}` });
      if (merchant.supports_physical_cash) opts.push({ key: "merchant_physical", label: `نقدي ${merchant.merchant_name}` });
    }
    return opts;
  }, [merchant]);

  useEffect(() => {
    if (!methodOptions.some((o) => o.key === form.payment_method)) {
      setForm((p) => ({ ...p, payment_method: (methodOptions[0]?.key || "company_instapay") as MethodKey }));
    }
  }, [methodOptions]);

  const save = async () => {
    if (!form.agent_id) return toast.error("اختر الوكيل");
    if (!form.service_type) return toast.error("اختر نوع الخدمة");
    if (!form.destination) return toast.error("اختر وجهة السفر");
    if (tripValueNum <= 0) return toast.error("قيمة الرحلة يجب أن تكون أكبر من صفر");
    if (methodOptions.length === 0) return toast.error("لا توجد وسيلة دفع مفعلة لهذا التاجر");

    const m = form.payment_method;
    const isMerchantMethod = m.startsWith("merchant_");
    const merchantIdToSave = isMerchantMethod ? form.merchant_id || null : null;
    const amount = tripValueNum;

    const payload: any = {
      agent_id: form.agent_id,
      date: form.date,
      destination: form.destination,
      service_type: form.service_type,
      count: Number(form.count) || 1,
      price: Number(form.price) || 0,
      payment_method:
        m === "company_instapay" || m === "merchant_instapay" ? "إنستاباي"
          : m === "company_cash" ? "نقدي"
          : m === "merchant_wallet" ? "كاش محفظة"
          : "كاش نقدي تاجر",
      instapay_amount: 0,
      cash_amount: 0,
      merchant_cash_amount: 0,
      merchant_cash_net_amount: 0,
      merchant_cash_physical_amount: 0,
      arabic_tourism_cash_amount: 0,
      arabic_tourism_cash_net_amount: 0,
      mobile_cash_amount: 0,
      mobile_cash_net_amount: 0,
      total_paid: amount,
      paid: amount,
      merchant_id: merchantIdToSave,
      note: form.note.trim() || null,
      source_service_type: "payment",
    };
    if (m === "company_instapay" || m === "merchant_instapay") payload.instapay_amount = amount;
    else if (m === "company_cash") payload.cash_amount = amount;
    else if (m === "merchant_wallet") { payload.merchant_cash_amount = amount; payload.merchant_cash_net_amount = amount; }
    else if (m === "merchant_physical") payload.merchant_cash_physical_amount = amount;

    setSaving(true);
    const { data: txnRow, error: txnErr } = await supabase
      .from("transactions").insert(payload).select("id").single();
    if (txnErr || !txnRow) { setSaving(false); return toast.error(txnErr?.message || "تعذر حفظ الدفعة"); }

    if (m === "company_instapay" || m === "company_cash") {
      const boxName = m === "company_instapay" ? COMPANY_INSTAPAY_BOX_NAME : COMPANY_CASH_BOX_NAME;
      const box = cashBoxes.find((b) => b.name === boxName && b.currency === "EGP");
      if (box) {
        await supabase.from("payment_splits").insert({
          transaction_id: txnRow.id,
          method: payload.payment_method,
          currency: "EGP",
          cash_box_id: box.id,
          amount,
          exchange_rate: 1,
          egp_equivalent: amount,
        });
      }
    }

    try {
      const { data: u } = await supabase.auth.getUser();
      await supabase.from("activity_logs").insert({
        user_id: u.user?.id ?? null,
        user_email: u.user?.email ?? null,
        action: "agent_payment_added",
        entity: "transactions",
        details: { agent_id: form.agent_id, amount, method: m, merchant_id: merchantIdToSave, date: form.date },
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
        <div className="form-group"><label>الوكيل</label>
          <select value={form.agent_id} onChange={(e) => set("agent_id", e.target.value)} disabled={!!lockedAgentId}>
            <option value="" disabled>اختر...</option>
            {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>التاريخ</label>
          <input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
        </div>
        <div className="form-group"><label>نوع الخدمة</label>
          <select value={form.service_type} onChange={(e) => set("service_type", e.target.value)}>
            <option value="" disabled>اختر...</option>
            <SafeSelectOptions options={SERVICE_TYPES} />
          </select>
        </div>
        <div className="form-group"><label>وجهة السفر</label>
          <select value={form.destination} onChange={(e) => set("destination", e.target.value)}>
            <option value="" disabled>اختر...</option>
            <SafeSelectOptions options={DESTINATIONS} />
          </select>
        </div>
        <div className="form-group"><label>العدد</label>
          <input type="number" min={1} value={form.count} onChange={(e) => set("count", e.target.value)} />
        </div>
        <div className="form-group"><label>السعر</label>
          <input type="number" min={0} value={form.price} onChange={(e) => set("price", e.target.value)} />
        </div>
        <div className="form-group"><label>
          قيمة الرحلة
          <span style={{ marginInlineStart: 8, fontSize: 11, fontWeight: 400, color: "var(--muted)" }}>
            <input type="checkbox" checked={form.trip_value_manual} onChange={(e) => set("trip_value_manual", e.target.checked)} style={{ marginInlineEnd: 4 }} />
            تعديل يدوي
          </span>
        </label>
          <input
            type="number"
            min={0}
            value={form.trip_value_manual ? form.trip_value : String(autoTripValue || "")}
            onChange={(e) => set("trip_value", e.target.value)}
            disabled={!form.trip_value_manual}
          />
        </div>
        <div className="form-group"><label>التاجر (اختياري)</label>
          <select value={form.merchant_id} onChange={(e) => set("merchant_id", e.target.value)}>
            <option value="">— بدون تاجر (الشركة) —</option>
            {merchants.map((mm) => <option key={mm.id} value={mm.id}>{mm.merchant_name}</option>)}
          </select>
        </div>
        <div className="form-group"><label>وسيلة الدفع</label>
          <select value={form.payment_method} onChange={(e) => set("payment_method", e.target.value as MethodKey)}>
            {methodOptions.length === 0 && <option value="" disabled>لا توجد وسائل مفعلة لهذا التاجر</option>}
            {methodOptions.map((o) => <option key={o.key} value={o.key}>{o.label}</option>)}
          </select>
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="اختياري" />
        </div>
      </div>

      <div className="form-footer">
        <button className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ الدفعة</button>
      </div>
    </div>
  );
}
