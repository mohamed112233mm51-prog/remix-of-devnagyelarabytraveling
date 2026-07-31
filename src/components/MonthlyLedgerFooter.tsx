import { fmtCurrency } from "@/lib/db";
import type { MonthlyLedgerView, MonthlyLedgerRowBase } from "@/lib/monthlyLedger";

/**
 * تذييل كشف الحساب الشهري:
 * الرصيد السابق · إجمالي مدين الشهر · إجمالي دائن الشهر · الرصيد الختامي.
 * إجماليات الشهر لا تحتسب صف «رصيد سابق».
 */
export function MonthlyLedgerFooter<T extends MonthlyLedgerRowBase>({ view }: { view: MonthlyLedgerView<T> }) {
  const currencies = Array.from(new Set([
    ...Object.keys(view.openingByCurrency),
    ...Object.keys(view.monthlyDebitByCurrency),
    ...Object.keys(view.monthlyCreditByCurrency),
    ...Object.keys(view.closingBalanceByCurrency),
  ])).sort();
  if (currencies.length === 0) return null;
  return (
    <div className="table-wrap enterprise-table" style={{ marginTop: 12 }}>
      <table>
        <thead>
          <tr>
            <th>العملة</th>
            <th>الرصيد السابق</th>
            <th>إجمالي المدين خلال الشهر</th>
            <th>إجمالي الدائن خلال الشهر</th>
            <th>الرصيد الختامي</th>
          </tr>
        </thead>
        <tbody>
          {currencies.map((cur) => {
            const opening = view.openingByCurrency[cur] || 0;
            const closing = view.closingBalanceByCurrency[cur] || 0;
            return (
              <tr key={cur}>
                <td style={{ fontWeight: 700 }}>{cur}</td>
                <td>{fmtCurrency(opening, cur)}</td>
                <td style={{ color: "var(--red)" }}>{fmtCurrency(view.monthlyDebitByCurrency[cur] || 0, cur)}</td>
                <td style={{ color: "var(--green)" }}>{fmtCurrency(view.monthlyCreditByCurrency[cur] || 0, cur)}</td>
                <td style={{ fontWeight: 800 }}>{fmtCurrency(closing, cur)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
