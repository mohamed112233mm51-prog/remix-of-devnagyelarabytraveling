/**
 * Dev-only reconciliation helper.
 * Prints per-currency diff between a section's KPI cards and the corresponding
 * report's "all-time" totals so drift between the two surfaces is loud in dev.
 *
 * لا يُعرض للمستخدم النهائي — يعمل فقط خلف `import.meta.env.DEV`.
 */
import { CurrencyMap, formatCurrencyMap } from "@/lib/financialSummary";
import { subtractCurrencyMaps } from "@/lib/dashboardCollections";

type CurrencyBlock = Record<string, CurrencyMap>;

export function logReconciliation(
  label: string,
  departmentTotals: CurrencyBlock,
  reportAllTimeTotals: CurrencyBlock,
): void {
  if (!import.meta.env?.DEV) return;
  if (typeof window === "undefined") return;
  const keys = Array.from(new Set([...Object.keys(departmentTotals), ...Object.keys(reportAllTimeTotals)]));
  const diff: Record<string, string> = {};
  let clean = true;
  for (const k of keys) {
    const d = departmentTotals[k] || new CurrencyMap();
    const r = reportAllTimeTotals[k] || new CurrencyMap();
    const delta = subtractCurrencyMaps(d, r);
    const entries = delta.entries().filter((e) => Math.abs(e.amount) > 0.01);
    if (entries.length) {
      clean = false;
      diff[k] = formatCurrencyMap(delta, { emptyLabel: "0" });
    } else {
      diff[k] = "0";
    }
  }
  // eslint-disable-next-line no-console
  console[clean ? "log" : "warn"](`[Reconcile:${label}]`, {
    department: Object.fromEntries(Object.entries(departmentTotals).map(([k, v]) => [k, formatCurrencyMap(v)])),
    reportAllTime: Object.fromEntries(Object.entries(reportAllTimeTotals).map(([k, v]) => [k, formatCurrencyMap(v)])),
    diffByCurrency: diff,
    clean,
  });
}
