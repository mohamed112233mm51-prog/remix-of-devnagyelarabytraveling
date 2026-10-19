import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { checkSettingsPerm } from "@/hooks/usePerm";
import { usePassengerClassification, PASSENGER_QUERY_KEY } from "@/hooks/usePassengerClassification";
import { PASSENGER_CATEGORIES, PASSENGER_MAPPING_KEY, suggestedPassengerMapping, type PassengerMapping } from "@/lib/passengerClassification";

export function PassengerClassificationSettings() {
  const classification = usePassengerClassification();
  const queryClient = useQueryClient();
  const { permissions, isSuperAdmin } = useAuth();
  const canManage = checkSettingsPerm(permissions, isSuperAdmin, "company_manage");
  const [draft, setDraft] = useState<PassengerMapping>({});
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    if (classification.data && !dirty) setDraft(classification.data.configured ? classification.data.mapping : suggestedPassengerMapping(classification.data.options));
  }, [classification.data, dirty]);
  async function save() {
    if (!canManage || saving) return;
    setSaving(true);
    try {
      const current = await classification.getCurrent(true);
      const invalid = Object.values(draft).some(id => id && !current.options.some(o => o.id === id && o.is_active));
      if (invalid) throw new Error("أحد الخيارات المرتبطة محذوف أو معطل؛ اختر خيارًا نشطًا قبل الحفظ.");
      const { error } = await supabase.from("app_settings").upsert({ key: PASSENGER_MAPPING_KEY, value: { v: { version: 1, mapping: draft } } }, { onConflict: "key" });
      if (error) throw error;
      setDirty(false);
      await queryClient.invalidateQueries({ queryKey: PASSENGER_QUERY_KEY });
      toast.success("تم حفظ ربط نوع المسافر");
    } catch (error: any) { toast.error(error?.message || "تعذر حفظ الربط"); }
    finally { setSaving(false); }
  }
  return <section className="card" style={{ marginTop: 16, padding: 16 }} aria-label="ربط نوع المسافر التلقائي">
    <h3>ربط نوع المسافر التلقائي</h3>
    <p>اختر الاسم المعتمد لكل تصنيف. يُحسب العمر بتاريخ المغادرة إن وُجد، وإلا بتاريخ اليوم. السجلات المحفوظة لا تتغير.</p>
    {classification.isPending ? <p>جارِ تحميل القوائم والربط...</p> : classification.isError ? <p role="alert">تعذر تحميل الربط. <button type="button" onClick={() => classification.refetch()}>إعادة المحاولة</button></p> : <>
      {!classification.data?.configured && <p role="status">الاختيارات المقترحة لا تُفعّل إلا بعد حفظ الربط.</p>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(230px,1fr))", gap: 12 }}>
        {PASSENGER_CATEGORIES.map(c => <label key={c.key}>{c.label}<select aria-label={c.label} value={draft[c.key] || ""} disabled={saving || !canManage}
          onChange={e => { setDraft(d => ({ ...d, [c.key]: e.target.value })); setDirty(true); }} style={{ width: "100%" }}>
          <option value="">غير مرتبط — اختيار يدوي</option>
          {draft[c.key] && !classification.data?.options.some(o => o.id === draft[c.key] && o.is_active) && <option value={draft[c.key]}>الخيار المرتبط محذوف أو معطل</option>}
          {classification.data?.options.filter(o => o.is_active).map(o => <option key={o.id} value={o.id}>{o.value}</option>)}
        </select></label>)}
      </div>
      <p>لو الفئة المطلوبة غير موجودة، أضفها من قائمة «نوع المسافر» ثم اربطها هنا. الربط الناقص يتطلب اختيار النوع يدويًا.</p>
      <button type="button" className="btn btn-gold" disabled={saving || !canManage} onClick={save}>{saving ? "جارِ الحفظ..." : "حفظ ربط نوع المسافر"}</button>
    </>}
  </section>;
}
