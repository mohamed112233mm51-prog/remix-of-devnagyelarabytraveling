// Cash movement forms — reuse the system's existing payment-splits flow.
// Each form exposes ONLY entity / date / notes, then the standard
// <PaymentSplits/> widget handles cashbox / amount / currency / method.
//
// Persistence mirrors the existing forms, with signs inverted where the
// movement is an outflow (agent/merchant cash out) or an inflow without
// trip (company cash supply). No new financial logic is introduced.

import { useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useLive, type Agent, type Merchant, type IssuingCompany } from "@/lib/db";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { DateInput } from "@/components/inputs/DateInput";
import { usePersistentState } from "@/hooks/usePersistentState";
import {
  PaymentSplits,
  newPaymentSplitRow,
  validatePaymentSplits,
  filterValidSplits,
  
  type PaymentSplitRow,
} from "@/components/PaymentSplits";

type CashBox = { id: string; name: string; currency: string; balance: number; is_active: boolean };

/* ============================ AGENT CASH OUT ============================ */
export function AgentCashOutForm({ initialAgentId, onDone }: { initialAgentId?: string; onDone?: () => void }) {
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: cashBoxes } = useLive<CashBox>("cash_boxes");

  const draftKey = `draft:agent-cash-out:${initialAgentId || "new"}`;
  const [agentId, setAgentId, clearAgentId] = usePersistentState<string>(`${draftKey}:agentId`, initialAgentId || "");
  const [date, setDate, clearDate] = usePersistentState<string>(`${draftKey}:date`, new Date().toISOString().slice(0, 10));
  const [note, setNote, clearNote] = usePersistentState<string>(`${draftKey}:note`, "");
  const [splits, setSplits, clearSplits] = usePersistentState<PaymentSplitRow[]>(`${draftKey}:splits`, [newPaymentSplitRow()]);
  const [saving, setSaving] = useState(false);
  const resetDraft = () => { clearAgentId(); clearDate(); clearNote(); clearSplits(); };

  const total = useMemo(() => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0), [splits]);

  const save = async () => {
    if (!agentId) return toast.error("اختر الوكيل");
    if (!date) return toast.error("التاريخ مطلوب");
    const err = validatePaymentSplits(splits);
    if (err) return toast.error(err);
    const valid = filterValidSplits(splits);

    setSaving(true);
    // Reverse-payment on agent ledger (negative paid).
    const payload: any = {
      agent_id: agentId,
      date,
      count: 0,
      price: 0,
      paid: -total,
      total_paid: -total,
      cash_amount: -total,
      payment_method: "نقدي",
      note: note.trim() || "صرف نقدية للوكيل",
      source_service_type: "agent_cash_out",
    };
    const { data: txn, error: txnErr } = await supabase
      .from("transactions").insert(payload).select("id").single();
    if (txnErr || !txn) { setSaving(false); return toast.error(txnErr?.message || "تعذر حفظ الحركة"); }

    // payment_splits → existing trigger decreases cash boxes for company rows.
    const rows = valid.map((r) => {
      const a = Number(r.amount) || 0;
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
      else if (r.method === "merchant_wallet") methodLabel = "تاجر الكاش تاجر";
      else if (r.method === "merchant_physical") methodLabel = "نقدي تاجر";
      const signed = -a;
      return {
        transaction_id: txn.id,
        method: methodLabel,
        currency: r.currency,
        cash_box_id: cashBoxId,
        amount: signed,
        gross_amount: a,
        merchant_commission_rate: 0,
        merchant_commission_amount: 0,
        net_amount: a,
        exchange_rate: 1,
        egp_equivalent: r.currency === "EGP" ? signed : 0,
      };
    });
    if (rows.length) {
      const { error: spErr } = await supabase.from("payment_splits").insert(rows);
      if (spErr) { setSaving(false); return toast.error(spErr.message); }
    }

    setSaving(false);
    toast.success("تم تسجيل صرف النقدية");
    resetDraft();
    onDone?.();
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💸 صرف نقدية للوكيل</div></div>
      <div className="form-grid">
        <div className="form-group"><label>الوكيل *</label>
          <SearchableSelect value={agentId} onChange={setAgentId} options={agents.map((a) => ({ value: a.id, label: a.name }))} placeholder="اختر..." disabled={!!initialAgentId} />
        </div>
        <div className="form-group"><label>التاريخ *</label>
          <DateInput value={date} onChange={setDate} defaultToday />
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="اختياري" />
        </div>
      </div>

      <PaymentSplits splits={splits} merchants={merchants} onChange={setSplits} title="سطور الدفع" />

      <div style={{ padding: "0 8px", textAlign: "end", fontWeight: 600 }}>
        الإجمالي: {total.toLocaleString()}
      </div>
      <div className="form-footer">
        <button data-confirm-save="تأكيد صرف النقدية" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ الصرف</button>
      </div>
    </div>
  );
}

/* ============================ MERCHANT CASH OUT ============================ */
export function MerchantCashOutForm({ initialMerchantId, onDone }: { initialMerchantId?: string; onDone?: () => void }) {
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: cashBoxes } = useLive<CashBox>("cash_boxes");

  const draftKey = `draft:merchant-cash-out:${initialMerchantId || "new"}`;
  const [merchantId, setMerchantId, clearMerchantId] = usePersistentState<string>(`${draftKey}:merchantId`, initialMerchantId || "");
  const [date, setDate, clearDate] = usePersistentState<string>(`${draftKey}:date`, new Date().toISOString().slice(0, 10));
  const [note, setNote, clearNote] = usePersistentState<string>(`${draftKey}:note`, "");
  const [splits, setSplits, clearSplits] = usePersistentState<PaymentSplitRow[]>(`${draftKey}:splits`, [newPaymentSplitRow()]);
  const [saving, setSaving] = useState(false);
  const resetDraft = () => { clearMerchantId(); clearDate(); clearNote(); clearSplits(); };

  const total = useMemo(() => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0), [splits]);

  const save = async () => {
    if (!merchantId) return toast.error("اختر التاجر");
    if (!date) return toast.error("التاريخ مطلوب");
    const err = validatePaymentSplits(splits);
    if (err) return toast.error(err);
    const valid = filterValidSplits(splits);

    setSaving(true);
    // Same shape as agent cash-out: a transactions row + payment_splits
    // (general second-line payments flow). agent_id is nullable; merchant_id
    // tags the row so merchant ledgers/reports pick it up automatically.
    const payload: any = {
      agent_id: null,
      merchant_id: merchantId,
      date,
      count: 0,
      price: 0,
      paid: -total,
      total_paid: -total,
      merchant_cash_physical_amount: -total,
      payment_method: "نقدي",
      note: note.trim() || "صرف نقدية للتاجر",
      source_service_type: "merchant_cash_out",
    };
    const { data: txn, error: txnErr } = await supabase
      .from("transactions").insert(payload).select("id").single();
    if (txnErr || !txn) { setSaving(false); return toast.error(txnErr?.message || "تعذر حفظ الحركة"); }

    const rows = valid.map((r) => {
      const a = Number(r.amount) || 0;
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
      else if (r.method === "merchant_wallet") methodLabel = "تاجر الكاش تاجر";
      else if (r.method === "merchant_physical") methodLabel = "نقدي تاجر";
      const signed = -a;
      return {
        transaction_id: txn.id,
        method: methodLabel,
        currency: r.currency,
        cash_box_id: cashBoxId,
        amount: signed,
        gross_amount: a,
        merchant_commission_rate: 0,
        merchant_commission_amount: 0,
        net_amount: a,
        exchange_rate: 1,
        egp_equivalent: r.currency === "EGP" ? signed : 0,
      };
    });
    if (rows.length) {
      const { error: spErr } = await supabase.from("payment_splits").insert(rows);
      if (spErr) { setSaving(false); return toast.error(spErr.message); }
    }

    setSaving(false);
    toast.success("تم تسجيل صرف النقدية للتاجر");
    resetDraft();
    onDone?.();
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💸 صرف نقدية للتاجر</div></div>
      <div className="form-grid">
        <div className="form-group"><label>التاجر *</label>
          <SearchableSelect value={merchantId} onChange={setMerchantId} options={merchants.map((m) => ({ value: m.id, label: m.merchant_name }))} placeholder="اختر..." disabled={!!initialMerchantId} />
        </div>
        <div className="form-group"><label>التاريخ *</label>
          <DateInput value={date} onChange={setDate} defaultToday />
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="اختياري" />
        </div>
      </div>

      <PaymentSplits splits={splits} merchants={merchants} onChange={setSplits} title="سطور الدفع" />

      <div style={{ padding: "0 8px", textAlign: "end", fontWeight: 600 }}>
        الإجمالي: {total.toLocaleString()}
      </div>
      <div className="form-footer">
        <button data-confirm-save="تأكيد صرف النقدية للتاجر" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ الصرف</button>
      </div>
    </div>
  );
}


/* ============================ COMPANY CASH SUPPLY ============================ */
export function CompanySupplyForm({ initialCompanyId, onDone }: { initialCompanyId?: string; onDone?: () => void }) {
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const { rows: merchants } = useLive<Merchant>("merchants");
  const { rows: cashBoxes } = useLive<CashBox>("cash_boxes");

  const [companyId, setCompanyId] = useState(initialCompanyId || "");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [splits, setSplits] = useState<PaymentSplitRow[]>([newPaymentSplitRow()]);
  const [saving, setSaving] = useState(false);

  const total = useMemo(() => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0), [splits]);

  const save = async () => {
    if (!companyId) return toast.error("اختر الشركة الصادرة");
    if (!date) return toast.error("التاريخ مطلوب");
    const err = validatePaymentSplits(splits);
    if (err) return toast.error(err);
    const valid = filterValidSplits(splits);

    // Aggregate (cash supply = inflow → negative total_paid on company ledger).
    let instapay = 0, cash = 0, merchantWallet = 0, merchantPhysical = 0;
    for (const r of valid) {
      const a = Number(r.amount) || 0;
      if (r.method === "company_instapay" || r.method === "merchant_instapay") instapay += a;
      else if (r.method === "company_cash") cash += a;
      else if (r.method === "merchant_wallet") merchantWallet += a;
      else if (r.method === "merchant_physical") merchantPhysical += a;
    }
    const firstMerchant = valid.find((r) => r.source === "merchant")?.merchant_id || null;

    const payload: any = {
      company_id: companyId,
      date,
      count: 0,
      price: 0,
      trip_value: 0,
      instapay_amount: -instapay,
      cash_amount: -cash,
      merchant_cash_amount: -merchantWallet,
      merchant_cash_net_amount: -merchantWallet,
      merchant_cash_physical_amount: -merchantPhysical,
      arabic_tourism_cash_amount: 0,
      arabic_tourism_cash_net_amount: 0,
      mobile_cash_amount: 0,
      mobile_cash_net_amount: 0,
      total_paid: -total,
      usd_amount: 0,
      payment_currency: "EGP",
      merchant_id: firstMerchant,
      note: note.trim() || "توريد نقدية",
      source_service_type: "company_cash_supply",
    };

    setSaving(true);
    const { data: txn, error: txnErr } = await supabase
      .from("company_transactions").insert(payload).select("id").single();
    if (txnErr || !txn) { setSaving(false); return toast.error(txnErr?.message || "تعذر حفظ الحركة"); }

    // payment_splits with POSITIVE amounts → trigger INCREASES cash boxes.
    const rows = valid.map((r) => {
      const a = Number(r.amount) || 0;
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
      else if (r.method === "merchant_wallet") methodLabel = "تاجر الكاش تاجر";
      else if (r.method === "merchant_physical") methodLabel = "نقدي تاجر";
      return {
        transaction_id: txn.id,
        method: methodLabel,
        currency: r.currency,
        cash_box_id: cashBoxId,
        amount: a,
        gross_amount: a,
        merchant_commission_rate: 0,
        merchant_commission_amount: 0,
        net_amount: a,
        exchange_rate: 1,
        egp_equivalent: r.currency === "EGP" ? a : 0,
      };
    });
    if (rows.length) {
      const { error: spErr } = await supabase.from("payment_splits").insert(rows);
      if (spErr) { setSaving(false); return toast.error(spErr.message); }
    }

    setSaving(false);
    toast.success("تم تسجيل توريد النقدية");
    setSplits([newPaymentSplitRow()]); setNote("");
    onDone?.();
  };

  return (
    <div className="card">
      <div className="card-header"><div className="card-title">💰 توريد نقدية من الشركة الصادرة</div></div>
      <div className="form-grid">
        <div className="form-group"><label>الشركة الصادرة *</label>
          <SearchableSelect value={companyId} onChange={setCompanyId} options={companies.map((c) => ({ value: c.id, label: c.company_name }))} placeholder="اختر..." disabled={!!initialCompanyId} />
        </div>
        <div className="form-group"><label>التاريخ *</label>
          <DateInput value={date} onChange={setDate} defaultToday />
        </div>
        <div className="form-group full"><label>ملاحظات</label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="اختياري" />
        </div>
      </div>

      <PaymentSplits splits={splits} merchants={merchants} onChange={setSplits} title="سطور الدفع" />

      <div style={{ padding: "0 8px", textAlign: "end", fontWeight: 600 }}>
        الإجمالي: {total.toLocaleString()}
      </div>
      <div className="form-footer">
        <button data-confirm-save="تأكيد توريد النقدية" className="btn btn-gold" onClick={save} disabled={saving}>💾 حفظ التوريد</button>
      </div>
    </div>
  );
}
