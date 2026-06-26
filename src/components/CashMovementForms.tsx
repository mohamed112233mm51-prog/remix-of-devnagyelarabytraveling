// Cash movement forms — reuse existing tables and balance-mutation logic.
// - Agent "صرف نقدية":   transactions(paid<0) + payment_splits(amount<0) → cash box decreases via existing trigger.
// - Merchant "صرف نقدية": merchant_cash_collections(amount<0) + direct cash_boxes.balance update (same effect as the trigger).
// - Company "توريد نقدية": company_transactions(total_paid<0, cash_amount<0) + direct cash_boxes.balance increase.
// No new financial logic — only re-uses the shapes the rest of the app already reads.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLive, type Agent, type Merchant, type IssuingCompany } from "@/lib/db";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { NumberInput } from "@/components/inputs/NumberInput";
import { DateInput } from "@/components/inputs/DateInput";

type CashBox = { id: string; name: string; currency: string; balance: number; is_active: boolean };

const CURRENCIES = ["EGP", "USD", "LYD"];

function useCashBoxes() {
  const { rows } = useLive<CashBox>("cash_boxes");
  return rows.filter((b) => b.is_active);
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="form-grid">{children}</div>;
}

/* ============================ AGENT CASH OUT ============================ */
export function AgentCashOutForm({ initialAgentId, onDone }: { initialAgentId?: string; onDone?: () => void }) {
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const boxes = useCashBoxes();

  const [form, setForm] = useState({
    agent_id: initialAgentId || "",
    company_id: "",
    currency: "EGP",
    cash_box_id: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const filteredBoxes = useMemo(() => boxes.filter((b) => b.currency === form.currency), [boxes, form.currency]);

  const save = async () => {
    const amount = Number(form.amount) || 0;
    if (!form.agent_id) return toast.error("اختر الوكيل");
    if (!form.company_id) return toast.error("اختر الشركة الصادرة");
    if (!form.cash_box_id) return toast.error("اختر الخزينة");
    if (amount <= 0) return toast.error("المبلغ يجب أن يكون أكبر من صفر");
    const box = boxes.find((b) => b.id === form.cash_box_id);
    if (!box) return toast.error("الخزينة غير موجودة");
    if (Number(box.balance || 0) < amount) {
      return toast.error(`رصيد الخزينة غير كافٍ. المتاح: ${Number(box.balance || 0).toLocaleString()} — المطلوب: ${amount.toLocaleString()}`);
    }
    const companyName = companies.find((c) => c.id === form.company_id)?.company_name || "";
    const noteText = `صرف نقدية - ${companyName}${form.note ? " - " + form.note : ""}`;

    setSaving(true);
    // 1) Insert a reverse-payment transaction on the agent ledger (negative paid).
    const { data: txn, error: txnErr } = await supabase.from("transactions").insert({
      agent_id: form.agent_id,
      date: form.date,
      count: 1,
      price: 0,
      paid: -amount,
      total_paid: -amount,
      cash_amount: -amount,
      payment_method: "نقدي",
      note: noteText,
      source_service_type: "agent_cash_out",
    } as any).select("id").single();
    if (txnErr || !txn) { setSaving(false); return toast.error(txnErr?.message || "تعذر حفظ الحركة"); }

    // 2) Insert payment_splits row → existing trigger decreases the cash box.
    const { error: spErr } = await supabase.from("payment_splits").insert({
      transaction_id: txn.id,
      method: "نقدي",
      currency: form.currency,
      cash_box_id: form.cash_box_id,
      amount: -amount,
      gross_amount: -amount,
      net_amount: -amount,
      egp_equivalent: form.currency === "EGP" ? -amount : 0,
      exchange_rate: 1,
    } as any);
    if (spErr) { setSaving(false); return toast.error(spErr.message); }

    setSaving(false);
    toast.success("تم تسجيل صرف النقدية");
    setForm((p) => ({ ...p, amount: "", note: "" }));
    onDone?.();
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💸 صرف نقدية للوكيل</div></div>
      <FieldGrid>
        <div className="form-group"><label>الوكيل *</label>
          <SearchableSelect value={form.agent_id} onChange={(v) => set("agent_id", v)} options={agents.map((a) => ({ value: a.id, label: a.name }))} placeholder="اختر..." />
        </div>
        <div className="form-group"><label>الشركة الصادرة *</label>
          <SearchableSelect value={form.company_id} onChange={(v) => set("company_id", v)} options={companies.map((c) => ({ value: c.id, label: c.company_name }))} placeholder="اختر..." />
        </div>
        <div className="form-group"><label>العملة</label>
          <SearchableSelect value={form.currency} onChange={(v) => { set("currency", v); set("cash_box_id", ""); }} options={CURRENCIES} />
        </div>
        <div className="form-group"><label>الخزينة *</label>
          <SearchableSelect value={form.cash_box_id} onChange={(v) => set("cash_box_id", v)} options={filteredBoxes.map((b) => ({ value: b.id, label: `${b.name} (${Number(b.balance || 0).toLocaleString()} ${b.currency})` }))} placeholder="اختر..." />
        </div>
        <div className="form-group"><label>المبلغ *</label>
          <NumberInput value={Number(form.amount) || 0} onChange={(n) => set("amount", n === 0 ? "" : String(n))} min={0} />
        </div>
        <div className="form-group"><label>التاريخ *</label>
          <DateInput value={form.date} onChange={(iso) => set("date", iso)} defaultToday />
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="اختياري" />
        </div>
      </FieldGrid>
      <div className="form-footer">
        <button data-confirm-save="تأكيد صرف النقدية" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ الصرف</button>
      </div>
    </div>
  );
}

/* ============================ MERCHANT CASH OUT ============================ */
export function MerchantCashOutForm({ initialMerchantId, onDone }: { initialMerchantId?: string; onDone?: () => void }) {
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const boxes = useCashBoxes();

  const [form, setForm] = useState({
    merchant_id: initialMerchantId || "",
    company_id: "",
    currency: "EGP",
    cash_box_id: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const filteredBoxes = useMemo(() => boxes.filter((b) => b.currency === form.currency), [boxes, form.currency]);

  const save = async () => {
    const amount = Number(form.amount) || 0;
    if (!form.merchant_id) return toast.error("اختر التاجر");
    if (!form.company_id) return toast.error("اختر الشركة الصادرة");
    if (!form.cash_box_id) return toast.error("اختر الخزينة");
    if (amount <= 0) return toast.error("المبلغ يجب أن يكون أكبر من صفر");
    const box = boxes.find((b) => b.id === form.cash_box_id);
    if (!box) return toast.error("الخزينة غير موجودة");
    if (Number(box.balance || 0) < amount) {
      return toast.error(`رصيد الخزينة غير كافٍ. المتاح: ${Number(box.balance || 0).toLocaleString()} — المطلوب: ${amount.toLocaleString()}`);
    }
    const companyName = companies.find((c) => c.id === form.company_id)?.company_name || "";
    const noteText = `صرف نقدية - ${companyName}${form.note ? " - " + form.note : ""}`;

    setSaving(true);
    // 1) Negative collection on the merchant ledger.
    const { error: cErr } = await supabase.from("merchant_cash_collections").insert({
      merchant_id: form.merchant_id,
      date: form.date,
      amount: -amount,
      note: noteText,
    } as any);
    if (cErr) { setSaving(false); return toast.error(cErr.message); }

    // 2) Decrease cash box balance (same effect as the payment_splits trigger).
    const newBal = Number(box.balance || 0) - amount;
    const { error: bErr } = await supabase.from("cash_boxes").update({ balance: newBal }).eq("id", form.cash_box_id);
    if (bErr) { setSaving(false); return toast.error(bErr.message); }

    setSaving(false);
    toast.success("تم تسجيل صرف النقدية للتاجر");
    setForm((p) => ({ ...p, amount: "", note: "" }));
    onDone?.();
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💸 صرف نقدية للتاجر</div></div>
      <FieldGrid>
        <div className="form-group"><label>التاجر *</label>
          <SearchableSelect value={form.merchant_id} onChange={(v) => set("merchant_id", v)} options={merchants.map((m) => ({ value: m.id, label: m.merchant_name }))} placeholder="اختر..." />
        </div>
        <div className="form-group"><label>الشركة الصادرة *</label>
          <SearchableSelect value={form.company_id} onChange={(v) => set("company_id", v)} options={companies.map((c) => ({ value: c.id, label: c.company_name }))} placeholder="اختر..." />
        </div>
        <div className="form-group"><label>العملة</label>
          <SearchableSelect value={form.currency} onChange={(v) => { set("currency", v); set("cash_box_id", ""); }} options={CURRENCIES} />
        </div>
        <div className="form-group"><label>الخزينة *</label>
          <SearchableSelect value={form.cash_box_id} onChange={(v) => set("cash_box_id", v)} options={filteredBoxes.map((b) => ({ value: b.id, label: `${b.name} (${Number(b.balance || 0).toLocaleString()} ${b.currency})` }))} placeholder="اختر..." />
        </div>
        <div className="form-group"><label>المبلغ *</label>
          <NumberInput value={Number(form.amount) || 0} onChange={(n) => set("amount", n === 0 ? "" : String(n))} min={0} />
        </div>
        <div className="form-group"><label>التاريخ *</label>
          <DateInput value={form.date} onChange={(iso) => set("date", iso)} defaultToday />
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="اختياري" />
        </div>
      </FieldGrid>
      <div className="form-footer">
        <button data-confirm-save="تأكيد صرف النقدية للتاجر" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ الصرف</button>
      </div>
    </div>
  );
}

/* ============================ COMPANY CASH SUPPLY ============================ */
export function CompanySupplyForm({ initialCompanyId, onDone }: { initialCompanyId?: string; onDone?: () => void }) {
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const boxes = useCashBoxes();

  const [form, setForm] = useState({
    company_id: initialCompanyId || "",
    currency: "EGP",
    cash_box_id: "",
    amount: "",
    date: new Date().toISOString().slice(0, 10),
    note: "",
  });
  const [saving, setSaving] = useState(false);
  const set = (k: string, v: string) => setForm((p) => ({ ...p, [k]: v }));

  const filteredBoxes = useMemo(() => boxes.filter((b) => b.currency === form.currency), [boxes, form.currency]);

  const save = async () => {
    const amount = Number(form.amount) || 0;
    if (!form.company_id) return toast.error("اختر الشركة الصادرة");
    if (!form.cash_box_id) return toast.error("اختر الخزينة");
    if (amount <= 0) return toast.error("المبلغ يجب أن يكون أكبر من صفر");
    const box = boxes.find((b) => b.id === form.cash_box_id);
    if (!box) return toast.error("الخزينة غير موجودة");
    const noteText = `توريد نقدية${form.note ? " - " + form.note : ""}`;

    setSaving(true);
    // 1) Negative payment row on the company ledger = supply received from company.
    const { error: cErr } = await supabase.from("company_transactions").insert({
      company_id: form.company_id,
      date: form.date,
      count: 0,
      price: 0,
      trip_value: 0,
      cash_amount: form.currency === "EGP" ? -amount : 0,
      usd_amount: form.currency === "USD" ? -amount : 0,
      total_paid: -amount,
      payment_currency: form.currency,
      note: noteText,
      source_service_type: "company_cash_supply",
    } as any);
    if (cErr) { setSaving(false); return toast.error(cErr.message); }

    // 2) Increase cash box balance.
    const newBal = Number(box.balance || 0) + amount;
    const { error: bErr } = await supabase.from("cash_boxes").update({ balance: newBal }).eq("id", form.cash_box_id);
    if (bErr) { setSaving(false); return toast.error(bErr.message); }

    setSaving(false);
    toast.success("تم تسجيل توريد النقدية");
    setForm((p) => ({ ...p, amount: "", note: "" }));
    onDone?.();
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💰 توريد نقدية من الشركة الصادرة</div></div>
      <FieldGrid>
        <div className="form-group"><label>الشركة الصادرة *</label>
          <SearchableSelect value={form.company_id} onChange={(v) => set("company_id", v)} options={companies.map((c) => ({ value: c.id, label: c.company_name }))} placeholder="اختر..." />
        </div>
        <div className="form-group"><label>العملة</label>
          <SearchableSelect value={form.currency} onChange={(v) => { set("currency", v); set("cash_box_id", ""); }} options={CURRENCIES} />
        </div>
        <div className="form-group"><label>الخزينة *</label>
          <SearchableSelect value={form.cash_box_id} onChange={(v) => set("cash_box_id", v)} options={filteredBoxes.map((b) => ({ value: b.id, label: `${b.name} (${Number(b.balance || 0).toLocaleString()} ${b.currency})` }))} placeholder="اختر..." />
        </div>
        <div className="form-group"><label>المبلغ *</label>
          <NumberInput value={Number(form.amount) || 0} onChange={(n) => set("amount", n === 0 ? "" : String(n))} min={0} />
        </div>
        <div className="form-group"><label>التاريخ *</label>
          <DateInput value={form.date} onChange={(iso) => set("date", iso)} defaultToday />
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="اختياري" />
        </div>
      </FieldGrid>
      <div className="form-footer">
        <button data-confirm-save="تأكيد توريد النقدية" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ التوريد</button>
      </div>
    </div>
  );
}
