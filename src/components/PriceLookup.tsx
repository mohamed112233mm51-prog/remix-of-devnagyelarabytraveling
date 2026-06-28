import { useEffect, useMemo, useState } from "react";
// SearchableSelect not needed here — native selects suffice for cascading filters.
import { useLive, type IssuingCompany } from "@/lib/db";
import type { PricingRule } from "@/lib/pricingMatch";
import { supabase } from "@/integrations/supabase/client";
import { Search, X, Pencil } from "lucide-react";
import { usePersistentState } from "@/hooks/usePersistentState";

type Mode = "company" | "agent";

const NA = "__na__"; // sentinel for "غير محدد"
const NA_LABEL = "غير محدد";

const FIELDS = [
  "service_type",
  "agent_tier",
  "departure_from",
  "destination",
  "airline",
  "approval_company_id",
  "status",
  "passenger_type",
] as const;
type FilterKey = (typeof FIELDS)[number];
type Filters = Record<FilterKey, string>;
const emptyFilters = (): Filters =>
  FIELDS.reduce((acc, k) => ({ ...acc, [k]: "" }), {} as Filters);

function fieldVal(r: PricingRule, k: FilterKey): string {
  const v = (r as any)[k];
  return v == null || v === "" ? NA : String(v);
}

export function PriceLookup(props: {
  mode: Mode;
  /** company mode: fixed company id (used to fetch rules if not provided). */
  companyId?: string;
  /** agent mode: pre-known tier (from agent profile) */
  agentTier?: string;
  /** Pre-loaded pricing rules. If absent, the component will fetch by companyId. */
  rules?: PricingRule[];
  /** company mode only — edit a matching rule */
  onOpenRule?: (rule: PricingRule) => void;
  /** Notify parent of the currently filtered subset. */
  onFilteredChange?: (rules: PricingRule[]) => void;
  /** Notify parent when any filter is active. */
  onActiveChange?: (active: boolean) => void;
  /** When changed, clears all filters. */
  resetKey?: number;
  /** Hide outer card chrome (when embedded in a Modal). */
  bare?: boolean;
}) {
  const { mode, companyId: fixedCompanyId, agentTier, rules: externalRules, onOpenRule, onFilteredChange, onActiveChange, resetKey, bare } = props;
  const { rows: allCompanies } = useLive<IssuingCompany>("issuing_companies");

  // ----- Source rules -----
  // Persist the agent-mode company pick so reopening the lookup restores the
  // previous selection (and therefore the previous filters under that key).
  const [companyId, setCompanyId, clearStoredCompanyId] = usePersistentState<string>(
    `pricelookup:${mode}:companyId`,
    fixedCompanyId || "",
  );
  const [internalRules, setInternalRules] = useState<PricingRule[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (externalRules) return; // parent supplies rules
    if (!companyId) { setInternalRules([]); return; }
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("company_pricing_rules" as any)
        .select("*")
        .eq("company_id", companyId);
      if (!cancelled) setInternalRules(((data || []) as unknown) as PricingRule[]);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [companyId, externalRules]);

  const rawRules: PricingRule[] = externalRules ?? internalRules;
  // Agent mode with a locked tier: include only rules for that tier OR generic rules with no tier.
  const rules: PricingRule[] = useMemo(() => {
    if (mode === "agent" && agentTier) {
      return rawRules.filter((r) => !r.agent_tier || String(r.agent_tier) === String(agentTier));
    }
    return rawRules;
  }, [rawRules, mode, agentTier]);

  // ----- Filters -----
  const persistKey = `pricelookup:${mode}:${fixedCompanyId || companyId || "any"}:${agentTier || "any"}`;
  const [filters, setFilters, clearStoredFilters] = usePersistentState<Filters>(persistKey, emptyFilters());

  // Tier is applied at the source level above; do not also set it as a UI filter.

  // (tier handling moved to source-rule filtering above)


  const setFilter = (k: FilterKey, v: string) =>
    setFilters((f) => ({ ...f, [k]: v }));

  const matches = (r: PricingRule, exclude?: FilterKey) =>
    FIELDS.every((k) => {
      if (k === exclude) return true;
      const f = filters[k];
      if (!f) return true;
      return fieldVal(r, k) === f;
    });

  const filtered = useMemo(() => rules.filter((r) => matches(r)), [rules, filters]);

  useEffect(() => { onFilteredChange?.(filtered); }, [filtered, onFilteredChange]);

  const anyFilterSet = FIELDS.some((k) => {
    if (k === "agent_tier" && agentTier) return false;
    return !!filters[k];
  });

  useEffect(() => { onActiveChange?.(anyFilterSet); }, [anyFilterSet, onActiveChange]);

  useEffect(() => {
    if (resetKey === undefined) return;
    setFilters(emptyFilters());

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  const companyNameOf = (id?: string | null) =>
    id ? (allCompanies.find((c) => c.id === id)?.company_name || "—") : "—";

  const labelFor = (k: FilterKey, v: string) => {
    if (v === NA) return NA_LABEL;
    if (k === "approval_company_id") return companyNameOf(v);
    return v;
  };

  const optionsFor = (k: FilterKey): { value: string; label: string }[] => {
    const seen = new Set<string>();
    for (const r of rules) {
      if (!matches(r, k)) continue;
      seen.add(fieldVal(r, k));
    }
    return Array.from(seen)
      .map((v) => ({ value: v, label: labelFor(k, v) }))
      .sort((a, b) => a.label.localeCompare(b.label, "ar"));
  };

  const FilterSelect = ({ k, label }: { k: FilterKey; label: string }) => {
    const opts = optionsFor(k);
    return (
      <div className="form-group">
        <label>{label}</label>
        <select
          value={filters[k]}
          onChange={(e) => setFilter(k, e.target.value)}
        >
          <option value="">— الكل —</option>
          {opts.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>
    );
  };

  const clearFilters = () => {
    clearStoredFilters();
    if (!fixedCompanyId) clearStoredCompanyId();
  };


  return (
    <div className={bare ? "" : "card"} style={bare ? { marginTop: 0 } : { marginTop: 12, boxShadow: "none", border: "1px solid var(--border)" }}>
      {!bare && (
        <div className="card-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
          <div className="card-title" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <Search size={16} strokeWidth={2.2} /> بحث سعر خدمة (فلترة تفاعلية)
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 12, color: "var(--muted)" }}>
              {filtered.length} / {rules.length}
            </span>
            {anyFilterSet && (
              <button
                type="button"
                className="action-btn"
                onClick={clearFilters}
                title="مسح الفلاتر"
                style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
              >
                <X size={14} strokeWidth={2} /> مسح الفلاتر
              </button>
            )}
          </div>
        </div>
      )}
      {bare && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 12, color: "var(--muted)" }}>النتائج: {filtered.length} / {rules.length}</span>
          {anyFilterSet && (
            <button
              type="button"
              className="action-btn"
              onClick={clearFilters}
              title="مسح الفلاتر"
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <X size={14} strokeWidth={2} /> مسح الفلاتر
            </button>
          )}
        </div>
      )}
      <div className={bare ? "" : "card-body"}>
        {!fixedCompanyId && mode === "agent" && (
          <div className="form-group" style={{ marginBottom: 8 }}>
            <label>الشركة *</label>
            <select
              value={companyId}
              onChange={(e) => { setCompanyId(e.target.value); setFilters(emptyFilters()); }}
            >
              <option value="">—</option>
              {allCompanies.map((c) => <option key={c.id} value={c.id}>{c.company_name}</option>)}
            </select>
          </div>
        )}

        <div className="form-grid">
          <FilterSelect k="service_type" label="الخدمة" />
          {!agentTier && mode !== "agent" && <FilterSelect k="agent_tier" label="شريحة الوكيل" />}
          {!agentTier && mode === "agent" && <FilterSelect k="agent_tier" label="شريحة الوكيل" />}
          <FilterSelect k="departure_from" label="جهة المغادرة" />
          <FilterSelect k="destination" label="الوجهة" />
          <FilterSelect k="airline" label="الطيران" />
          <FilterSelect k="approval_company_id" label="جهة الموافقة" />
          <FilterSelect k="status" label="الحالة" />
          <FilterSelect k="passenger_type" label="نوع المسافر" />
        </div>

        {(mode === "agent" && !companyId && !externalRules) ? (
          <div className="empty" style={{ padding: 16, textAlign: "center", color: "var(--muted)" }}>
            اختر الشركة لبدء البحث
          </div>
        ) : loading ? (
          <div style={{ textAlign: "center", padding: 12 }}>جاري التحميل...</div>
        ) : onFilteredChange ? (
          // Parent owns the data table; we are filters-only. No separate results table.
          null
        ) : rules.length === 0 ? (
          <div className="empty" style={{ padding: 16, textAlign: "center", color: "var(--muted)" }}>
            لا توجد قواعد تسعير لهذه الشركة
          </div>
        ) : filtered.length === 0 ? (
          <div className="empty" style={{ padding: 16, textAlign: "center", border: "1px dashed var(--border)", borderRadius: 8, color: "var(--muted)" }}>
            هذه الخدمة لم تُسعّر من قبل حسب الخانات المختارة
          </div>
        ) : (
          <div style={{ overflowX: "auto", marginTop: 8 }}>
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
                  {mode === "company" && <th style={{ padding: 6 }}>سعر الشركة</th>}
                  {mode === "company" && !agentTier && <th style={{ padding: 6 }}>الشريحة</th>}
                  <th style={{ padding: 6 }}>سعر الوكيل</th>
                  {mode === "company" && onOpenRule && <th style={{ padding: 6 }}>إجراءات</th>}
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => {
                  const isOnly = filtered.length === 1;
                  return (
                    <tr key={r.id} style={{ borderTop: "1px solid var(--border)", background: isOnly ? "color-mix(in srgb, var(--gold, #b8860b) 8%, transparent)" : undefined }}>
                      <td style={{ padding: 6, fontWeight: 700 }}>
                        {r.service_type}
                        {isOnly && <span className="badge" style={{ marginInlineStart: 6, fontSize: 10, background: "var(--gold, #b8860b)", color: "#fff", borderRadius: 4, padding: "1px 6px" }}>مطابق</span>}
                      </td>
                      <td style={{ padding: 6 }}>{r.departure_from || NA_LABEL}</td>
                      <td style={{ padding: 6 }}>{r.destination || NA_LABEL}</td>
                      <td style={{ padding: 6 }}>{r.airline || NA_LABEL}</td>
                      <td style={{ padding: 6 }}>{companyNameOf(r.approval_company_id)}</td>
                      <td style={{ padding: 6 }}>{r.status || NA_LABEL}</td>
                      <td style={{ padding: 6 }}>{r.passenger_type || NA_LABEL}</td>
                      {mode === "company" && <td style={{ padding: 6 }}>{Number(r.company_price).toFixed(2)}</td>}
                      {mode === "company" && !agentTier && <td style={{ padding: 6 }}>{r.agent_tier}</td>}
                      <td style={{ padding: 6, fontWeight: 700, color: "var(--gold, #b8860b)" }}>{Number(r.agent_price).toFixed(2)}</td>
                      {mode === "company" && onOpenRule && (
                        <td style={{ padding: 6 }}>
                          <button
                            type="button"
                            className="action-btn icon-only"
                            onClick={() => onOpenRule(r)}
                            title="تعديل"
                            aria-label="تعديل"
                            style={{ width: 28, height: 28, padding: 0, display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 6 }}
                          >
                            <Pencil size={14} strokeWidth={2} />
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

      </div>
    </div>
  );
}
