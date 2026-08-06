import { Wallet, DollarSign, Coins } from "lucide-react";

export type CurrencyTotal = {
  currency: string;
  debit: number;
  credit: number;
  net: number;
  count?: number;
};

const CURRENCY_META: Record<
  string,
  { name: string; symbol: string; icon: React.ComponentType<{ size?: number }> }
> = {
  EGP: { name: "الجنيه المصري", symbol: "ج.م", icon: Wallet },
  USD: { name: "الدولار الأمريكي", symbol: "$", icon: DollarSign },
  LYD: { name: "الدينار الليبي", symbol: "د.ل", icon: Coins },
};

const fmt = (n: number) =>
  Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

function CountsWord(n: number) {
  if (n === 1) return "حركة";
  if (n === 2) return "حركتان";
  if (n >= 3 && n <= 10) return "حركات";
  return "حركة";
}

export type EntityKind = "agent" | "company" | "merchant" | "currency_supplier";

const ENTITY_LABELS: Record<EntityKind, { debit: string; credit: string }> = {
  agent: { debit: "مستحق على الوكيل", credit: "مستحق للوكيل" },
  company: { debit: "مستحق للشركة", credit: "مستحق على الشركة" },
  merchant: { debit: "مستحق على التاجر", credit: "مستحق للتاجر" },
  currency_supplier: { debit: "مستحق على المورد", credit: "مستحق للمورد" },
};

export function CurrencyTotalsCards({
  totals,
  entityKind = "agent",
  movementMode = false,
}: {
  totals: CurrencyTotal[];
  entityKind?: EntityKind;
  /** عند true تعرض الكروت حركة الفترة، وليس رصيدًا أو استحقاقًا تراكميًا. */
  movementMode?: boolean;
}) {
  const labels = ENTITY_LABELS[entityKind] || ENTITY_LABELS.agent;
  // Defensive: accept only a valid array
  const list = Array.isArray(totals) ? totals : [];
  const shown = list.filter(
    (t) => t && ((t.count ?? 0) > 0 || t.debit !== 0 || t.credit !== 0 || t.net !== 0),
  );
  if (shown.length === 0) return null;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
        gap: 12,
        padding: 12,
      }}
      dir="rtl"
    >
      {shown.map((t) => {
        const meta = CURRENCY_META[t.currency] || {
          name: t.currency,
          symbol: t.currency,
          icon: Wallet,
        };
        const Icon = meta.icon;
        const status = movementMode
          ? (t.net > 0 ? "حركة مدين" : t.net < 0 ? "حركة دائن" : "متوازن")
          : (t.net > 0 ? labels.debit : t.net < 0 ? labels.credit : "متوازن");
        const statusColor =
          t.net > 0
            ? "var(--red, #dc2626)"
            : t.net < 0
              ? "var(--green, #16a34a)"
              : "var(--gold, #ca8a04)";
        const statusBg =
          t.net > 0
            ? "color-mix(in oklab, var(--red, #dc2626) 12%, transparent)"
            : t.net < 0
              ? "color-mix(in oklab, var(--green, #16a34a) 12%, transparent)"
              : "color-mix(in oklab, var(--gold, #ca8a04) 12%, transparent)";

        return (
          <div
            key={t.currency}
            style={{
              background: "var(--card, #fff)",
              border: "1px solid var(--border)",
              borderRadius: 12,
              boxShadow: "var(--shadow, 0 1px 3px rgba(0,0,0,0.06))",
              padding: 14,
              display: "flex",
              flexDirection: "column",
              gap: 10,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                fontWeight: 800,
                color: "var(--text)",
                fontSize: 15,
                borderBottom: "1px solid var(--border)",
                paddingBottom: 8,
              }}
            >
              <Icon size={18} />
              <span>{meta.name}</span>
            </div>

            <div
              style={{
                display: "grid",
                gridTemplateColumns: "1fr 1fr",
                gap: 8,
              }}
            >
              <Stat
                label="مدين"
                value={`${fmt(t.debit)} ${meta.symbol}`}
                color="var(--red, #dc2626)"
              />
              <Stat
                label="دائن"
                value={`${fmt(t.credit)} ${meta.symbol}`}
                color="var(--green, #16a34a)"
              />
            </div>

            <div
              style={{
                background: statusBg,
                border: `1px solid ${statusColor}`,
                borderRadius: 10,
                padding: "10px 12px",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span style={{ fontSize: 11, color: "var(--muted-foreground, #64748b)" }}>
                  {movementMode ? "صافي حركة الفترة" : "الصافي"}
                </span>
                <span style={{ fontSize: 16, fontWeight: 800, color: statusColor }}>
                  {fmt(Math.abs(t.net))} {meta.symbol}
                </span>
              </div>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  color: statusColor,
                  background: "var(--card, #fff)",
                  padding: "4px 10px",
                  borderRadius: 999,
                  border: `1px solid ${statusColor}`,
                }}
              >
                {status}
              </span>
            </div>

            {typeof t.count === "number" && (
              <div
                style={{
                  fontSize: 12,
                  color: "var(--muted-foreground, #64748b)",
                  display: "flex",
                  justifyContent: "space-between",
                }}
              >
                <span>عدد الحركات</span>
                <span style={{ fontWeight: 700, color: "var(--text)" }}>
                  {t.count} {CountsWord(t.count)}
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <span style={{ fontSize: 11, color: "var(--muted-foreground, #64748b)" }}>
        {label}
      </span>
      <span style={{ fontSize: 14, fontWeight: 700, color }}>{value}</span>
    </div>
  );
}
