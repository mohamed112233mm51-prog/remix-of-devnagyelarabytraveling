import { useMemo, useState } from "react";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { useDropdownOptions, useLive, type IssuingCompany } from "@/lib/db";
import { resolveAgentPrice, type PricingRule, type ResolveContext } from "@/lib/pricingMatch";
import { toast } from "sonner";

type Mode = "company" | "agent";

export function PriceLookup(props: {
  mode: Mode;
  /** company mode: fixed company id. agent mode: optional initial company id. */
  companyId?: string;
  /** agent mode: pre-known tier (from agent profile) */
  agentTier?: string;
  /** agent mode: list of tiers if tier not pre-known */
  onOpenRule?: (rule: PricingRule) => void;
}) {
  const { mode, companyId: fixedCompanyId, agentTier, onOpenRule } = props;
  const services = useDropdownOptions("service_type");
  const tiers = useDropdownOptions("agent_tier" as any);
  const departures = useDropdownOptions("departure_from" as any);
  const destinations = useDropdownOptions("destination");
  const airlines = useDropdownOptions("airline");
  const statuses = useDropdownOptions("execution_status");
  const passengers = useDropdownOptions("passenger_type" as any);
  const { rows: allCompanies } = useLive<IssuingCompany>("issuing_companies");

  const [companyId, setCompanyId] = useState<string>(fixedCompanyId || "");
  const [serviceType, setServiceType] = useState<string>("");
  const [tier, setTier] = useState<string>(agentTier || "");
  const [departure, setDeparture] = useState<string>("");
  const [destination, setDestination] = useState<string>("");
  const [airline, setAirline] = useState<string>("");
  const [approvalCompanyId, setApprovalCompanyId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const [passengerType, setPassengerType] = useState<string>("");

  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ rule: PricingRule | null; reason?: string } | null>(null);

  const approvalCompanies = useMemo(
    () => allCompanies.filter((c) => c.id !== companyId),
    [allCompanies, companyId],
  );

  const resetResult = () => setResult(null);
  const wrap = <T,>(fn: (v: T) => void) => (v: T) => { fn(v); resetResult(); };

  const run = async () => {
    const effectiveCompany = fixedCompanyId || companyId;
    const effectiveTier = agentTier || tier;
    if (!effectiveCompany) return toast.error("اختر الشركة");
    if (!serviceType) return toast.error("اختر الخدمة");
    if (!effectiveTier) return toast.error("اختر شريحة الوكيل");
    setBusy(true);
    const ctx: ResolveContext = {
      company_id: effectiveCompany,
      service_type: serviceType,
      agent_tier: effectiveTier,
      departure_from: departure || null,
      destination: destination || null,
      airline: airline || null,
      approval_company_id: approvalCompanyId || null,
      status: status || null,
      passenger_type: passengerType || null,
    };
    const res = await resolveAgentPrice(ctx);
    setBusy(false);
    setResult({ rule: res.rule, reason: res.reason });
  };

  const companyOf = (id?: string | null) => id ? (allCompanies.find((c) => c.id === id)?.company_name || "—") : "—";

  return (
    <div className="card" style={{ marginTop: 12, boxShadow: "none", border: "1px solid var(--border)" }}>
      <div className="card-header"><div className="card-title">🔎 بحث سعر خدمة</div></div>
      <div className="card-body">
        <div className="form-grid">
          {!fixedCompanyId && (
            <div className="form-group"><label>الشركة *</label>
              <select value={companyId} onChange={(e) => { setCompanyId(e.target.value); resetResult(); }}>
                <option value="">—</option>
                {allCompanies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
              </select>
            </div>
          )}
          <div className="form-group"><label>الخدمة *</label>
            <SearchableSelect value={serviceType} onChange={wrap(setServiceType)} options={services as string[]} />
          </div>
          {!agentTier && (
            <div className="form-group"><label>شريحة الوكيل *</label>
              <SearchableSelect value={tier} onChange={wrap(setTier)} options={(tiers.length ? tiers : ["A","B","C"]) as string[]} />
            </div>
          )}
          <div className="form-group"><label>جهة المغادرة</label>
            <SearchableSelect value={departure} onChange={wrap(setDeparture)} options={["", ...departures] as string[]} />
          </div>
          <div className="form-group"><label>الوجهة</label>
            <SearchableSelect value={destination} onChange={wrap(setDestination)} options={["", ...destinations] as string[]} />
          </div>
          <div className="form-group"><label>الطيران</label>
            <SearchableSelect value={airline} onChange={wrap(setAirline)} options={["", ...airlines] as string[]} />
          </div>
          <div className="form-group"><label>جهة الموافقة</label>
            <select value={approvalCompanyId} onChange={(e) => { setApprovalCompanyId(e.target.value); resetResult(); }}>
              <option value="">—</option>
              {(fixedCompanyId ? approvalCompanies : allCompanies).map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
          <div className="form-group"><label>الحالة</label>
            <SearchableSelect value={status} onChange={wrap(setStatus)} options={["", ...statuses] as string[]} />
          </div>
          <div className="form-group"><label>نوع المسافر</label>
            <SearchableSelect value={passengerType} onChange={wrap(setPassengerType)} options={["", ...passengers] as string[]} />
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", padding: 12 }}>
          <button type="button" className="btn btn-gold" onClick={run} disabled={busy}>
            {busy ? "جاري البحث..." : "🔍 بحث السعر"}
          </button>
        </div>

        {result && (
          <div style={{ padding: 12 }}>
            {result.rule ? (
              <div className="card" style={{ border: "1px solid var(--border)", margin: 0 }}>
                <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <div className="card-title">نتيجة المطابقة</div>
                  {mode === "company" && onOpenRule && (
                    <button type="button" className="action-btn" onClick={() => onOpenRule(result.rule!)}>تعديل السطر</button>
                  )}
                </div>
                <div className="card-body">
                  <div className="two-col">
                    <div>
                      <Row k="الخدمة" v={result.rule.service_type} />
                      <Row k="جهة المغادرة" v={result.rule.departure_from || "—"} />
                      <Row k="الوجهة" v={result.rule.destination || "—"} />
                      <Row k="الطيران" v={result.rule.airline || "—"} />
                      <Row k="جهة الموافقة" v={companyOf(result.rule.approval_company_id)} />
                      <Row k="الحالة" v={result.rule.status || "—"} />
                      <Row k="نوع المسافر" v={result.rule.passenger_type || "—"} />
                    </div>
                    <div>
                      {mode === "company" ? (
                        <>
                          <Row k="شريحة الوكيل" v={result.rule.agent_tier} />
                          <Row k="سعر الشركة" v={Number(result.rule.company_price).toFixed(2)} />
                          <Row k="نوع العمولة" v={result.rule.commission_type === "fixed" ? "مبلغ" : "نسبة"} />
                          <Row k={result.rule.commission_type === "fixed" ? "قيمة الربح" : "نسبة الربح %"} v={Number(result.rule.commission_value).toFixed(2)} />
                          <Row k="سعر الوكيل" v={Number(result.rule.agent_price).toFixed(2)} highlight />
                        </>
                      ) : (
                        <Row k="سعر الوكيل" v={Number(result.rule.agent_price).toFixed(2)} highlight />
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty" style={{ padding: 16, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8, color: "var(--muted)" }}>
                هذه الخدمة لم تُسعّر من قبل
                {result.reason ? <div style={{ fontSize: 12, marginTop: 4 }}>{result.reason}</div> : null}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v, highlight }: { k: string; v: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="stat-row">
      <span className="stat-key">{k}</span>
      <span className="stat-val" style={highlight ? { fontWeight: 800, color: "var(--gold, #b8860b)" } : undefined}>{v}</span>
    </div>
  );
}
