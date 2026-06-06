import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAgentPricingMap, useDropdownOptions } from "@/lib/db";

type PricingRowState = { company_price: string; agent_price: string; company_percentage: string; company_profit_value: string };
const EMPTY_ROW: PricingRowState = { company_price: "", agent_price: "", company_percentage: "", company_profit_value: "" };
function round2(n: number) { return Math.round(n * 100) / 100; }

export function AgentPricingSection({ agentId }: { agentId: string }) {
  const map = useAgentPricingMap(agentId);
  const serviceTypes = useDropdownOptions("service_type");
  const allTypes = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const st of serviceTypes) if (st && !seen.has(st)) { seen.add(st); out.push(st); }
    for (const st of Object.keys(map)) if (st && !seen.has(st)) { seen.add(st); out.push(st); }
    return out;
  }, [serviceTypes, map]);
  const [rows, setRows] = useState<Record<string, PricingRowState>>({});
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    const next: Record<string, PricingRowState> = {};
    for (const st of allTypes) {
      const r = map[st];
      next[st] = r ? {
        company_price: String(r.company_price ?? 0),
        agent_price: String(r.agent_price ?? 0),
        company_percentage: String(r.company_percentage ?? 0),
        company_profit_value: String(r.company_profit_value ?? 0),
      } : { ...EMPTY_ROW };
    }
    setRows(next);
  }, [map, allTypes]);

  const updateRow = (st: string, patch: Partial<PricingRowState>) => {
    setRows((prev) => {
      const cur = { ...(prev[st] || EMPTY_ROW), ...patch };
      const cp = Number(cur.company_price) || 0;
      const ap = Number(cur.agent_price) || 0;
      if (ap >= cp && ap > 0) {
        const profit = round2(ap - cp);
        const percentage = round2((profit / ap) * 100);
        cur.company_profit_value = String(profit);
        cur.company_percentage = String(percentage);
      } else {
        cur.company_profit_value = "";
        cur.company_percentage = "";
      }
      return { ...prev, [st]: cur };
    });
  };

  const saveRow = async (st: string) => {
    const r = rows[st]; if (!r) return;
    const cp = Number(r.company_price) || 0;
    const ap = Number(r.agent_price) || 0;
    if (ap < cp) return toast.error("سعر الوكيل يجب أن يكون أكبر من أو يساوي سعر الشركة");
    setSaving(st);
    const payload = {
      agent_id: agentId,
      service_type: st,
      company_price: cp,
      agent_price: ap,
      company_percentage: Number(r.company_percentage) || 0,
      company_profit_value: Number(r.company_profit_value) || 0,
      updated_at: new Date().toISOString(),
    };
    const { error } = await supabase.from("agent_service_pricing").upsert(payload, { onConflict: "agent_id,service_type" });
    setSaving(null);
    if (error) return toast.error(error.message);
    toast.success("تم حفظ التسعير");
  };

  const deleteRow = async (st: string) => {
    if (!map[st]) {
      setRows((p) => ({ ...p, [st]: { ...EMPTY_ROW } }));
      return;
    }
    const { error } = await supabase.from("agent_service_pricing").delete().eq("agent_id", agentId).eq("service_type", st);
    if (error) return toast.error(error.message);
    toast.success("تم حذف التسعير");
  };

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-header"><div className="card-title">💰 تسعير الخدمات</div></div>
      <div className="card-body">
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr style={{ background: "var(--card)" }}>
                <th style={{ padding: 8, textAlign: "right" }}>نوع الخدمة</th>
                <th style={{ padding: 8 }}>سعر الشركة</th>
                <th style={{ padding: 8 }}>سعر الوكيل</th>
                <th style={{ padding: 8 }}>نسبة الشركة %</th>
                <th style={{ padding: 8 }}>ربح الشركة</th>
                <th style={{ padding: 8 }}>إجراءات</th>
              </tr>
            </thead>
            <tbody>
              {allTypes.length === 0 ? (
                <tr><td colSpan={6} style={{ padding: 12, textAlign: "center", color: "var(--muted)" }}>أضف أنواع الخدمة من الإعدادات → القوائم المنسدلة</td></tr>
              ) : allTypes.map((st: string) => {
                const r = rows[st] || EMPTY_ROW;
                return (
                  <tr key={st} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: 6, fontWeight: 700 }}>{st}</td>
                    <td style={{ padding: 6 }}><input type="number" style={{ width: "100%" }} value={r.company_price} onChange={(e) => updateRow(st, { company_price: e.target.value })} /></td>
                    <td style={{ padding: 6 }}><input type="number" style={{ width: "100%" }} value={r.agent_price} onChange={(e) => updateRow(st, { agent_price: e.target.value })} /></td>
                    <td style={{ padding: 6 }}><input type="number" style={{ width: "100%" }} value={r.company_percentage} disabled readOnly /></td>
                    <td style={{ padding: 6 }}><input type="number" style={{ width: "100%" }} value={r.company_profit_value} disabled readOnly /></td>
                    <td style={{ padding: 6, display: "flex", gap: 4, flexWrap: "wrap" }}>
                      <button className="btn btn-gold" disabled={saving === st} onClick={() => saveRow(st)} style={{ padding: "4px 8px", fontSize: 11 }}>حفظ</button>
                      <button className="action-btn" onClick={() => deleteRow(st)} style={{ padding: "4px 8px", fontSize: 11 }}>حذف</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
