import { formatCurrencyLines, type CurrencyMap } from "@/lib/financialSummary";

/**
 * عرض CurrencyMap كسطر مستقل لكل عملة.
 * - الترتيب الموحد: EGP ثم USD ثم LYD (يأتي مرتباً من CurrencyMap.entries()).
 * - العملات ذات القيمة الصفرية لا تُعرض.
 * - يرث اللون والخط من الحاوية (لا يفرض ألواناً).
 * - لا يغيّر أي منطق حسابي — عرض فقط.
 */
export function CurrencyLines({
  map,
  emptyLabel = "0 ج.م",
  align = "inherit",
  style,
}: {
  map: CurrencyMap;
  emptyLabel?: string;
  align?: "inherit" | "start" | "end" | "center";
  style?: React.CSSProperties;
}) {
  const lines = formatCurrencyLines(map);
  if (lines.length === 0) {
    return <span style={style}>{emptyLabel}</span>;
  }
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 2,
        lineHeight: 1.35,
        textAlign: align === "inherit" ? undefined : align,
        ...style,
      }}
    >
      {lines.map((line, i) => (
        <div key={i} style={{ whiteSpace: "nowrap" }}>{line}</div>
      ))}
    </div>
  );
}
