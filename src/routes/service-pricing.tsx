import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { CompanyPricingTab } from "@/components/CompanyPricingTab";
import { PriceLookup } from "@/components/PriceLookup";
import { useLive, type Agent, type IssuingCompany } from "@/lib/db";
import { useAuth } from "@/hooks/useAuth";
import { checkPerm } from "@/hooks/usePerm";
import { ShieldAlert, Tag, Search } from "lucide-react";

export const Route = createFileRoute("/service-pricing")({
  component: () => (
    <AppErrorBoundary>
      <ServicePricingPage />
    </AppErrorBoundary>
  ),
});

type Tab = "manage" | "lookup";

function ServicePricingPage() {
  const { permissions, isAdmin } = useAuth();
  const canManage = checkPerm(permissions, isAdmin, "service_pricing_manage", "view");
  const canSearch = checkPerm(permissions, isAdmin, "service_price_search", "view");

  const initial: Tab | null = canManage ? "manage" : canSearch ? "lookup" : null;
  const [tab, setTab] = useState<Tab | null>(initial);

  if (!canManage && !canSearch) {
    return (
      <div style={{ display: "grid", placeItems: "center", padding: 40 }}>
        <div className="card" style={{ maxWidth: 420, textAlign: "center", padding: 28 }}>
          <ShieldAlert size={36} style={{ margin: "0 auto 8px", color: "#dc2626" }} />
          <h3 style={{ margin: "8px 0" }}>غير مصرح لك بالدخول</h3>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            لا تملك صلاحية الوصول إلى أسعار الخدمات.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="section active">
      <div className="page-head">
        <div className="page-head-text">
          <h1 className="page-h1">
            <Tag size={20} strokeWidth={2.2} /> أسعار الخدمات
          </h1>
          <div className="page-sub">إدارة وتسعير الخدمات والبحث عن الأسعار</div>
        </div>
      </div>

      <div className="action-toolbar">
        {canManage && (
          <div
            className={`tool-tab ${tab === "manage" ? "active" : ""}`}
            onClick={() => setTab("manage")}
          >
            <Tag size={15} strokeWidth={2} /> <span>تسعير خدمة</span>
          </div>
        )}
        {canSearch && (
          <div
            className={`tool-tab ${tab === "lookup" ? "active" : ""}`}
            onClick={() => setTab("lookup")}
          >
            <Search size={15} strokeWidth={2} /> <span>بحث سعر خدمة</span>
          </div>
        )}
      </div>

      {tab === "manage" && canManage && <ManagePanel />}
      {tab === "lookup" && canSearch && <LookupPanel />}
    </div>
  );
}

function ManagePanel() {
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const [companyId, setCompanyId] = useState<string>("");

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-header">
        <div className="card-title">تسعير خدمة</div>
      </div>
      <div className="card-body">
        <div className="form-group" style={{ maxWidth: 420 }}>
          <label>الشركة *</label>
          <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
            <option value="">— اختر الشركة —</option>
            {companies.map((c) => (
              <option key={c.id} value={c.id}>
                {c.company_name}
              </option>
            ))}
          </select>
        </div>
        {companyId ? (
          <CompanyPricingTab companyId={companyId} />
        ) : (
          <div className="empty" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
            اختر شركة لعرض ملف التسعير الخاص بها
          </div>
        )}
      </div>
    </div>
  );
}

function LookupPanel() {
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const [agentId, setAgentId] = useState<string>("");
  const [companyId, setCompanyId] = useState<string>("");

  const agent = useMemo(() => agents.find((a) => a.id === agentId) as any, [agents, agentId]);
  const tier: string | undefined = agent?.tier || undefined;

  return (
    <div className="card" style={{ marginTop: 12 }}>
      <div className="card-header">
        <div className="card-title">بحث سعر خدمة</div>
      </div>
      <div className="card-body">
        <div className="form-grid" style={{ marginBottom: 8 }}>
          <div className="form-group">
            <label>الوكيل *</label>
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">— اختر الوكيل —</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                  {(a as any).tier ? ` — شريحة ${(a as any).tier}` : ""}
                </option>
              ))}
            </select>
          </div>
          <div className="form-group">
            <label>الشركة *</label>
            <select value={companyId} onChange={(e) => setCompanyId(e.target.value)}>
              <option value="">— اختر الشركة —</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.company_name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {!agentId || !companyId ? (
          <div className="empty" style={{ padding: 24, textAlign: "center", color: "var(--muted)" }}>
            اختر الوكيل والشركة لبدء البحث
          </div>
        ) : (
          <PriceLookup
            key={`${agentId}-${companyId}`}
            mode="agent"
            companyId={companyId}
            agentTier={tier}
            bare
          />
        )}
      </div>
    </div>
  );
}
