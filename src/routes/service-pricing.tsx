import { createFileRoute, useRouterState } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppErrorBoundary } from "@/components/AppErrorBoundary";
import { CompanyPricingTab } from "@/components/CompanyPricingTab";
import { PriceLookup } from "@/components/PriceLookup";
import { useLive, type Agent, type IssuingCompany } from "@/lib/db";
import { useAuth } from "@/hooks/useAuth";
import { checkPerm } from "@/hooks/usePerm";
import { SearchableSelect } from "@/components/inputs/SearchableSelect";
import { ShieldAlert, Tag, Search, ChevronLeft } from "lucide-react";

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
  const hash = useRouterState({ select: (s) => s.location.hash });
  useEffect(() => {
    if (hash === "lookup" && canSearch) setTab("lookup");
    else if (hash === "manage" && canManage) setTab("manage");
  }, [hash, canManage, canSearch]);

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
    <div className="section active fin-page accounts-page">
      <div className="page-head">
        <div className="page-head-text">
          <div className="breadcrumb-row">
            <span>الإعدادات والأدوات</span>
            <ChevronLeft size={12} strokeWidth={2} />
            <span className="crumb-current">أسعار الخدمات</span>
          </div>
          <h1 className="page-h1">
            <Tag size={20} strokeWidth={2.2} /> أسعار الخدمات
          </h1>
          <div className="page-sub">إدارة تسعير الخدمات والبحث عن أسعار الخدمات</div>
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

  const companyOptions = useMemo(
    () =>
      companies
        .filter((c: any) => ((c.status || "نشط") === "نشط") || c.id === companyId)
        .map((c) => ({
          value: c.id,
          label: ((c as any).status || "نشط") === "نشط" ? c.company_name : `${c.company_name} (غير نشطة)`,
        })),
    [companies, companyId],
  );

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div className="card-title">اختيار الشركة</div>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div className="form-group">
              <label>الشركة *</label>
              <SearchableSelect
                value={companyId}
                onChange={setCompanyId}
                options={companyOptions}
                placeholder="— اختر الشركة —"
              />
            </div>
          </div>
        </div>
      </div>

      {companyId ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-header">
            <div className="card-title">ملف التسعير</div>
          </div>
          <div className="card-body">
            <CompanyPricingTab companyId={companyId} />
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-body">
            <div className="empty" style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
              اختر شركة لعرض ملف التسعير الخاص بها
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function LookupPanel() {
  const { rows: agents } = useLive<Agent>("agents");
  const { rows: companies } = useLive<IssuingCompany>("issuing_companies");
  const [agentId, setAgentId] = useState<string>("");
  const [companyId, setCompanyId] = useState<string>("");

  const agent = useMemo(() => agents.find((a) => a.id === agentId) as any, [agents, agentId]);
  const tier: string | undefined = agent?.tier || undefined;

  const agentOptions = useMemo(
    () =>
      agents
        .filter((a: any) => ((a.status || "نشط") === "نشط") || a.id === agentId)
        .map((a) => ({
          value: a.id,
          label: `${a.name}${(a as any).tier ? ` — شريحة ${(a as any).tier}` : ""}${((a as any).status || "نشط") !== "نشط" ? " (غير نشط)" : ""}`,
        })),
    [agents, agentId],
  );
  const companyOptions = useMemo(
    () =>
      companies
        .filter((c: any) => ((c.status || "نشط") === "نشط") || c.id === companyId)
        .map((c) => ({
          value: c.id,
          label: ((c as any).status || "نشط") === "نشط" ? c.company_name : `${c.company_name} (غير نشطة)`,
        })),
    [companies, companyId],
  );

  return (
    <>
      <div className="card">
        <div className="card-header">
          <div className="card-title">اختيار الوكيل والشركة</div>
        </div>
        <div className="card-body">
          <div className="form-grid">
            <div className="form-group">
              <label>الوكيل *</label>
              <SearchableSelect
                value={agentId}
                onChange={setAgentId}
                options={agentOptions}
                placeholder="— اختر الوكيل —"
              />
            </div>
            <div className="form-group">
              <label>الشركة *</label>
              <SearchableSelect
                value={companyId}
                onChange={setCompanyId}
                options={companyOptions}
                placeholder="— اختر الشركة —"
              />
            </div>
          </div>
        </div>
      </div>

      {!agentId || !companyId ? (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-body">
            <div className="empty" style={{ padding: 32, textAlign: "center", color: "var(--muted)" }}>
              اختر الوكيل والشركة لبدء البحث
            </div>
          </div>
        </div>
      ) : (
        <div className="card" style={{ marginTop: 12 }}>
          <div className="card-header">
            <div className="card-title">بحث سعر خدمة</div>
          </div>
          <div className="card-body">
            <PriceLookup
              key={`${agentId}-${companyId}`}
              mode="agent"
              companyId={companyId}
              agentTier={tier}
              bare
            />
          </div>
        </div>
      )}
    </>
  );
}
