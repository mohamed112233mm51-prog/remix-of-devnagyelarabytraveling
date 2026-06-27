import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useDropdownOptions, useLive, type IssuingCompany } from "@/lib/db";
import { NumberInput } from "@/components/inputs/NumberInput";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { toast } from "sonner";
import { usePerm } from "@/hooks/usePerm";
import type { PricingRule } from "@/lib/pricingMatch";

type Row = Omit<PricingRule, "id" | "agent_price"> & { id?: string };

const EMPTY = (companyId: string, defaultService: string, defaultTier: string): Row => ({
  company_id: companyId,
  service_type: defaultService,
  agent_tier: defaultTier,
  departure_from: null,
  destination: null,
  airline: null,
  approval_company_id: null,
  status: null,
  passenger_type: null,
  company_price: 0,
  commission_type: "percentage",
  commission_value: 0,
});

function computeAgentPrice(r: Pick<Row, "company_price" | "commission_type" | "commission_value">): number {
  const cp = Number(r.company_price) || 0;
  const cv = Number(r.commission_value) || 0;
  if (r.commission_type === "fixed") return Math.round((cp + cv) * 100) / 100;
  return Math.round((cp * (1 + cv / 100)) * 100) / 100;
}

export function CompanyPricingTab({ companyId }: { companyId: string }) {
  const perm = usePerm("pricing");
  const services = useDropdownOptions("service_type");
  const tiers = useDropdownOptions("agent_tier" as any);
  const departures = useDropdownOptions("departure_from" as any);
  const destinations = useDropdownOptions("destination");
  const airlines = useDropdownOptions("airline");
  const statuses = useDropdownOptions("execution_status");
  const passengers = useDropdownOptions("passenger_type" as any);
  const { rows: allCompanies } = useLive<IssuingCompany>("issuing_companies");
  const approvalCompanies = useMemo(
    () => allCompanies.filter((c) => c.id !== companyId),
    [allCompanies, companyId],
  );

  const [rules, setRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState<Row | null>(null);
  const [showImport, setShowImport] = useState(false);

  const load = async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from("company_pricing_rules" as any)
      .select("*")
      .eq("company_id", companyId)
      .order("service_type", { ascending: true });
    setLoading(false);
    if (error) { toast.error(error.message); return; }
    setRules((data || []) as unknown as PricingRule[]);
  };
  useEffect(() => { load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [companyId]);

  const startNew = () => setDraft(EMPTY(companyId, services[0] || "", tiers[0] || "A"));
  const startEdit = (r: PricingRule) => setDraft({ ...r });

  const save = async () => {
    if (!draft) return;
    if (!draft.service_type) return toast.error("اختر الخدمة");
    if (!draft.agent_tier) return toast.error("اختر شريحة الوكيل");
    const payload: any = {
      ...draft,
      company_price: Number(draft.company_price) || 0,
      commission_value: Number(draft.commission_value) || 0,
    };
    delete payload.id;
    // Trigger recomputes agent_price; we don't send it.
    if (draft.id) {
      const { error } = await supabase.from("company_pricing_rules" as any).update(payload).eq("id", draft.id);
      if (error) return toast.error(error.message);
    } else {
      const { error } = await supabase.from("company_pricing_rules" as any).insert(payload);
      if (error) return toast.error(error.message);
    }
    setDraft(null);
    await load();
    toast.success("تم حفظ السعر");
  };

  const remove = async (id: string) => {
    if (!perm.delete) return toast.error("لا تملك صلاحية الحذف");
    if (!confirm("حذف هذا السعر؟")) return;
    const { error } = await supabase.from("company_pricing_rules" as any).delete().eq("id", id);
    if (error) return toast.error(error.message);
    await load();
  };

  const duplicate = async (r: PricingRule) => {
    if (!perm.create) return toast.error("لا تملك صلاحية الإضافة");
    try {
      const { id, created_at, updated_at, agent_price, ...rest } = r as any;
      const { data, error } = await supabase
        .from("company_pricing_rules" as any)
        .insert({ ...rest, company_id: companyId })
        .select()
        .single();
      if (error) throw error;
      await load();
      toast.success("تم تكرار سطر التسعير بنجاح");
      if (data) setDraft(data as any);
    } catch (e) {
      console.error("duplicate pricing rule failed", e);
      toast.error("تعذر تكرار سطر التسعير");
    }
  };

  if (!perm.view) {
    return <div className="card"><div className="card-body" style={{ textAlign: "center", padding: 24 }}>لا تملك صلاحية عرض ملف التسعير.</div></div>;
  }

  return (
    <div className="card" style={{ marginTop: 12, boxShadow: "none", border: "1px solid var(--border)" }}>
      <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div className="card-title">💰 ملف التسعير</div>
        <div style={{ display: "flex", gap: 6 }}>
          {perm.create && <button type="button" className="btn btn-gold" onClick={startNew}>➕ إضافة سعر</button>}
          {perm.create && <button type="button" className="action-btn" onClick={() => setShowImport(true)}>📥 استيراد من شركة أخرى</button>}
        </div>
      </div>
      <div className="card-body">
        {loading ? (
          <div style={{ textAlign: "center", padding: 16 }}>جاري التحميل...</div>
        ) : (
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
              <thead>
                <tr style={{ background: "var(--card)" }}>
                  <th style={{ padding: 6 }}>الخدمة</th>
                  <th style={{ padding: 6 }}>المغادرة</th>
                  <th style={{ padding: 6 }}>الوجهة</th>
                  <th style={{ padding: 6 }}>الطيران</th>
                  <th style={{ padding: 6 }}>جهة الموافقة</th>
                  <th style={{ padding: 6 }}>الحالة</th>
                  <th style={{ padding: 6 }}>نوع المسافر</th>
                  <th style={{ padding: 6 }}>سعر الشركة</th>
                  <th style={{ padding: 6 }}>الشريحة</th>
                  <th style={{ padding: 6 }}>نوع العمولة</th>
                  <th style={{ padding: 6 }}>قيمة الربح</th>
                  <th style={{ padding: 6 }}>سعر الوكيل</th>
                  <th style={{ padding: 6 }}>إجراءات</th>
                </tr>
              </thead>
              <tbody>
                {rules.length === 0 && (
                  <tr><td colSpan={13} style={{ padding: 12, textAlign: "center", color: "var(--muted)" }}>لا توجد قواعد تسعير بعد</td></tr>
                )}
                {rules.map((r) => (
                  <tr key={r.id} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: 6, fontWeight: 700 }}>{r.service_type}</td>
                    <td style={{ padding: 6 }}>{r.departure_from || "—"}</td>
                    <td style={{ padding: 6 }}>{r.destination || "—"}</td>
                    <td style={{ padding: 6 }}>{r.airline || "—"}</td>
                    <td style={{ padding: 6 }}>{approvalCompanies.find((c) => c.id === r.approval_company_id)?.company_name || "—"}</td>
                    <td style={{ padding: 6 }}>{r.status || "—"}</td>
                    <td style={{ padding: 6 }}>{r.passenger_type || "—"}</td>
                    <td style={{ padding: 6 }}>{Number(r.company_price).toFixed(2)}</td>
                    <td style={{ padding: 6 }}>{r.agent_tier}</td>
                    <td style={{ padding: 6 }}>{r.commission_type === "fixed" ? "مبلغ" : "نسبة"}</td>
                    <td style={{ padding: 6 }}>{Number(r.commission_value).toFixed(2)}</td>
                    <td style={{ padding: 6, fontWeight: 700, color: "var(--gold, #b8860b)" }}>{Number(r.agent_price).toFixed(2)}</td>
                    <td style={{ padding: 6, display: "flex", gap: 4 }}>
                      {perm.edit && <button type="button" className="action-btn" onClick={() => startEdit(r)} style={{ padding: "2px 6px" }}>تعديل</button>}
                      {perm.create && <button type="button" className="action-btn" onClick={() => duplicate(r)} title="تكرار" style={{ padding: "2px 6px", color: "var(--green, #16a34a)" }}>📋 تكرار</button>}
                      {perm.delete && <button type="button" className="action-btn" onClick={() => remove(r.id)} style={{ padding: "2px 6px" }}>حذف</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {draft && (
        <DraftEditor
          draft={draft}
          setDraft={setDraft}
          onCancel={() => setDraft(null)}
          onSave={save}
          services={services}
          tiers={tiers.length ? tiers : ["A","B","C"]}
          departures={departures}
          destinations={destinations}
          airlines={airlines}
          statuses={statuses}
          passengers={passengers}
          approvalCompanies={approvalCompanies}
        />
      )}

      {showImport && (
        <ImportFromCompanyModal
          targetCompanyId={companyId}
          companies={approvalCompanies}
          services={services}
          onClose={() => setShowImport(false)}
          onDone={async () => { setShowImport(false); await load(); }}
        />
      )}
    </div>
  );
}

function DraftEditor(props: {
  draft: Row;
  setDraft: (r: Row) => void;
  onCancel: () => void;
  onSave: () => void;
  services: readonly string[];
  tiers: readonly string[];
  departures: readonly string[];
  destinations: readonly string[];
  airlines: readonly string[];
  statuses: readonly string[];
  passengers: readonly string[];
  approvalCompanies: IssuingCompany[];
}) {
  const { draft, setDraft } = props;
  const upd = (patch: Partial<Row>) => setDraft({ ...draft, ...patch });
  const agentPrice = computeAgentPrice(draft);
  return (
    <div onClick={props.onCancel} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10010, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 720, maxHeight: "90vh", overflow: "auto", margin: 0 }}>
        <div className="card-header"><div className="card-title">{draft.id ? "تعديل سعر" : "إضافة سعر"}</div></div>
        <div className="form-grid">
          <div className="form-group"><label>الخدمة *</label>
            <SearchableSelect value={draft.service_type} onChange={(v) => upd({ service_type: v })} options={props.services as string[]} />
          </div>
          <div className="form-group"><label>شريحة الوكيل *</label>
            <SearchableSelect value={draft.agent_tier} onChange={(v) => upd({ agent_tier: v })} options={props.tiers as string[]} />
          </div>
          <div className="form-group"><label>جهة المغادرة</label>
            <SearchableSelect value={draft.departure_from || ""} onChange={(v) => upd({ departure_from: v || null })} options={["", ...props.departures] as string[]} />
          </div>
          <div className="form-group"><label>الوجهة</label>
            <SearchableSelect value={draft.destination || ""} onChange={(v) => upd({ destination: v || null })} options={["", ...props.destinations] as string[]} />
          </div>
          <div className="form-group"><label>الطيران</label>
            <SearchableSelect value={draft.airline || ""} onChange={(v) => upd({ airline: v || null })} options={["", ...props.airlines] as string[]} />
          </div>
          <div className="form-group"><label>جهة الموافقة</label>
            <select value={draft.approval_company_id || ""} onChange={(e) => upd({ approval_company_id: e.target.value || null })}>
              <option value="">—</option>
              {props.approvalCompanies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>الحالة</label>
            <SearchableSelect value={draft.status || ""} onChange={(v) => upd({ status: v || null })} options={["", ...props.statuses] as string[]} />
          </div>
          <div className="form-group"><label>نوع المسافر</label>
            <SearchableSelect value={draft.passenger_type || ""} onChange={(v) => upd({ passenger_type: v || null })} options={["", ...props.passengers] as string[]} />
          </div>
          <div className="form-group"><label>سعر الشركة</label>
            <NumberInput value={Number(draft.company_price) || 0} onChange={(n) => upd({ company_price: n })} min={0} />
          </div>
          <div className="form-group"><label>نوع العمولة</label>
            <select value={draft.commission_type} onChange={(e) => upd({ commission_type: e.target.value as any })}>
              <option value="percentage">نسبة %</option>
              <option value="fixed">مبلغ ثابت</option>
            </select>
          </div>
          <div className="form-group"><label>{draft.commission_type === "fixed" ? "قيمة الربح" : "نسبة الربح %"}</label>
            <NumberInput value={Number(draft.commission_value) || 0} onChange={(n) => upd({ commission_value: n })} min={0} />
          </div>
          <div className="form-group"><label>سعر الوكيل (محسوب)</label>
            <input value={agentPrice} disabled readOnly style={{ background: "var(--card)", fontWeight: 700 }} />
          </div>
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: 12 }}>
          <button type="button" className="action-btn" onClick={props.onCancel}>إلغاء</button>
          <button type="button" className="btn btn-gold" onClick={props.onSave}>💾 حفظ</button>
        </div>
      </div>
    </div>
  );
}

function ImportFromCompanyModal(props: {
  targetCompanyId: string;
  companies: IssuingCompany[];
  services: readonly string[];
  onClose: () => void;
  onDone: () => void;
}) {
  const [sourceId, setSourceId] = useState("");
  const [service, setService] = useState<string>(""); // empty = all
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [busy, setBusy] = useState(false);

  const run = async () => {
    if (!sourceId) return toast.error("اختر الشركة المصدر");
    setBusy(true);
    try {
      let q = supabase.from("company_pricing_rules" as any).select("*").eq("company_id", sourceId);
      if (service) q = q.eq("service_type", service);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data || []) as any[];
      if (rows.length === 0) { toast.error("لا توجد أسعار مطابقة في الشركة المصدر"); setBusy(false); return; }

      if (mode === "replace") {
        let del = supabase.from("company_pricing_rules" as any).delete().eq("company_id", props.targetCompanyId);
        if (service) del = del.eq("service_type", service);
        const { error: dErr } = await del;
        if (dErr) throw dErr;
      }

      const payload = rows.map((r) => {
        const { id, created_at, updated_at, agent_price, ...rest } = r;
        return { ...rest, company_id: props.targetCompanyId };
      });
      const { error: iErr } = await supabase.from("company_pricing_rules" as any).insert(payload);
      if (iErr) throw iErr;
      toast.success(`تم استيراد ${payload.length} سعر`);
      props.onDone();
    } catch (e: any) {
      toast.error(e?.message || "فشل الاستيراد");
    } finally { setBusy(false); }
  };

  return (
    <div onClick={props.onClose} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 10020, padding: 16 }}>
      <div onClick={(e) => e.stopPropagation()} className="card" style={{ width: "100%", maxWidth: 520, margin: 0 }}>
        <div className="card-header"><div className="card-title">📥 استيراد ملف تسعير من شركة أخرى</div></div>
        <div className="form-grid">
          <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>الشركة المصدر</label>
            <select value={sourceId} onChange={(e) => setSourceId(e.target.value)}>
              <option value="">— اختر شركة —</option>
              {props.companies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>الخدمة (اتركها فارغة لاستيراد جميع الخدمات)</label>
            <select value={service} onChange={(e) => setService(e.target.value)}>
              <option value="">جميع الخدمات</option>
              {props.services.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="form-group" style={{ gridColumn: "1 / -1" }}><label>الوضع</label>
            <div style={{ display: "flex", gap: 12 }}>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="radio" checked={mode === "merge"} onChange={() => setMode("merge")} /> دمج (إضافة فوق الحالي)
              </label>
              <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="radio" checked={mode === "replace"} onChange={() => setMode("replace")} /> استبدال (حذف ثم إضافة)
              </label>
            </div>
          </div>
        </div>
        <div className="form-footer" style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: 12 }}>
          <button type="button" className="action-btn" onClick={props.onClose} disabled={busy}>إلغاء</button>
          <button type="button" className="btn btn-gold" onClick={run} disabled={busy}>{busy ? "جاري..." : "تنفيذ الاستيراد"}</button>
        </div>
      </div>
    </div>
  );
}
