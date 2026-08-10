import type { ReactNode } from "react";
import { Building2, HandCoins, Landmark, Scale, Users, WalletCards } from "lucide-react";
import { CurrencyLines } from "@/components/CurrencyLines";
import { useFinancialPosition } from "@/hooks/useFinancialPosition";
import { usePerm } from "@/hooks/usePerm";

function DashboardCard({
  label,
  map,
  icon,
  tone,
}: {
  label: string;
  map: import("@/lib/financialSummary").CurrencyMap;
  icon: ReactNode;
  tone: "primary" | "navy" | "success" | "warning";
}) {
  return (
    <div className={`erp-hero erp-hero-${tone}`}>
      <div className="erp-hero-top">
        <span className="erp-hero-label">{label}</span>
        <span className="erp-hero-icon">{icon}</span>
      </div>
      <div className="erp-hero-value" style={{ fontSize: 20, lineHeight: 1.35 }}>
        <CurrencyLines map={map} />
      </div>
    </div>
  );
}

function FullCard({
  label,
  map,
  className = "",
}: {
  label: string;
  map: import("@/lib/financialSummary").CurrencyMap;
  className?: string;
}) {
  return (
    <div className={`sum-box ${className}`}>
      <div className="kpi-text">
        <div className="label">{label}</div>
        <div className="val"><CurrencyLines map={map} /></div>
      </div>
    </div>
  );
}

export function FinancialPositionPanel({ variant = "dashboard" }: { variant?: "dashboard" | "full" }) {
  const perm = usePerm("investors");
  if (!perm.view) return null;
  return <FinancialPositionPanelInner variant={variant} />;
}

function FinancialPositionPanelInner({ variant }: { variant: "dashboard" | "full" }) {
  const position = useFinancialPosition();

  if (variant === "dashboard") {
    return (
      <>
        <div className="erp-section-title">المركز المالي الحالي</div>
        <div className="erp-hero-grid">
          <DashboardCard
            label="الخزائن + أموال الشركة لدى تجار الكاش"
            map={position.treasury}
            icon={<Landmark size={18} />}
            tone="primary"
          />
          <DashboardCard
            label="مستحق للشركة عند الغير"
            map={position.receivables}
            icon={<HandCoins size={18} />}
            tone="success"
          />
          <DashboardCard
            label="مستحق على الشركة للغير"
            map={position.payables}
            icon={<Building2 size={18} />}
            tone="warning"
          />
          <DashboardCard
            label="صافي المركز المالي"
            map={position.netPosition}
            icon={<Scale size={18} />}
            tone="navy"
          />
          <DashboardCard
            label="تمويل المالك الحالي"
            map={position.ownerCapital}
            icon={<Users size={18} />}
            tone="primary"
          />
          <DashboardCard
            label="صافي أموال النشاط بعد استبعاد تمويل المالك"
            map={position.operatingFundsExOwner}
            icon={<WalletCards size={18} />}
            tone="success"
          />
        </div>
      </>
    );
  }

  return (
    <div className="card" style={{ marginBottom: 16 }}>
      <div className="card-header">
        <div>
          <div className="card-title">⚖️ المركز المالي الحالي للشركة</div>
        </div>
      </div>
      <div className="card-body">
        <div className="account-summary kpi-rich" style={{ marginBottom: 16 }}>
          <FullCard label="الخزائن + أموال الشركة لدى تجار الكاش" map={position.treasury} className="gold" />
          <FullCard label="مستحق للشركة" map={position.receivables} className="green" />
          <FullCard label="مستحق على الشركة" map={position.payables} className="red" />
          <FullCard label="صافي المركز المالي" map={position.netPosition} className="hero" />
          <FullCard label="تمويل المالك الحالي" map={position.ownerCapital} />
          <FullCard label="أموال النشاط بعد استبعاد تمويل المالك" map={position.operatingFundsExOwner} className="green" />
        </div>

        <div className="table-wrap enterprise-table" style={{ marginBottom: 12 }}>
          <table className="mobile-cards">
            <thead>
              <tr>
                <th>القسم</th>
                <th>مستحق للشركة</th>
                <th>مستحق على الشركة</th>
                <th>الصافي لصالح الشركة</th>
              </tr>
            </thead>
            <tbody>
              {position.sections.map((section) => (
                <tr key={section.key}>
                  <td className="bold" data-label="القسم">{section.label}</td>
                  <td data-label="مستحق للشركة"><CurrencyLines map={section.receivable} /></td>
                  <td data-label="مستحق على الشركة"><CurrencyLines map={section.payable} /></td>
                  <td data-label="الصافي"><CurrencyLines map={section.net} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {position.legacyInvestorTransactionCount > 0 && (
          <div style={{ marginTop: 8, padding: "9px 11px", borderRadius: 9, background: "#FFF7ED", color: "#9A3412", fontSize: 12, lineHeight: 1.7 }}>
            يوجد {position.legacyInvestorTransactionCount} حركة مستثمر قديمة غير مربوطة بخزينة فعلية. ظلت محفوظة في كشف المستثمر، لكنها لا تُستخدم لاستبعاد تمويل المالك من المركز المالي حتى لا يتم افتراض أو تحريك أرصدة قديمة بأثر رجعي.
          </div>
        )}
      </div>
    </div>
  );
}
