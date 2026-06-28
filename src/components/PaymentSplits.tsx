import { useMemo } from "react";
import type { Merchant } from "@/lib/db";

/**
 * Reusable multi-row payment widget.
 *
 * Mirrors the "وسيلة الدفع" widget used in CompanyTxnForm. Each row:
 *  - source: company | merchant
 *  - currency: EGP | USD | LYD
 *  - merchant (only when source = merchant) → restricts methods to merchant's enabled ones
 *  - method (label key)
 *  - amount (full value — NO 1% commission, NO net calculation)
 *
 * Designed for all financial forms EXCEPT the Agent Payment form (which keeps
 * its own 1% commission logic for تاجر الكاش).
 */

export type SplitCurrency = "EGP" | "USD" | "LYD";
export type SplitSource = "company" | "merchant";

export type PaymentSplitRow = {
  uid: string;
  source: SplitSource;
  currency: SplitCurrency;
  merchant_id: string;
  method: string;
  amount: string;
};

export const SPLIT_CURRENCY_OPTIONS: { value: SplitCurrency; label: string }[] = [
  { value: "EGP", label: "جنيه مصري" },
  { value: "USD", label: "دولار" },
  { value: "LYD", label: "دينار ليبي" },
];

export const SPLIT_COMPANY_METHODS = [
  { key: "company_cash", label: "نقدي الشركة" },
  { key: "company_instapay", label: "إنستا الشركة" },
];

export const newPaymentSplitRow = (): PaymentSplitRow => ({
  uid: Math.random().toString(36).slice(2),
  source: "company",
  currency: "EGP",
  merchant_id: "",
  method: "company_cash",
  amount: "",
});

export function methodsForSplit(
  row: PaymentSplitRow,
  merchants: Merchant[],
): { key: string; label: string }[] {
  if (row.source === "company") return SPLIT_COMPANY_METHODS;
  const m = merchants.find((x) => x.id === row.merchant_id);
  if (!m) return [];
  const opts: { key: string; label: string }[] = [];
  if (m.supports_instapay) opts.push({ key: "merchant_instapay", label: `إنستا ${m.merchant_name}` });
  if (m.supports_cash_wallet) opts.push({ key: "merchant_wallet", label: `تاجر الكاش ${m.merchant_name}` });
  if (m.supports_physical_cash) opts.push({ key: "merchant_physical", label: `نقدي ${m.merchant_name}` });
  return opts;
}

export function PaymentSplits({
  splits,
  merchants,
  onChange,
  title = "وسيلة الدفع",
  hideSource = false,
  lockMerchantId,
}: {
  hideSource?: boolean;
  lockMerchantId?: string;
  splits: PaymentSplitRow[];
  merchants: Merchant[];
  onChange: (next: PaymentSplitRow[]) => void;
  title?: string;
}) {
  const update = (uid: string, patch: Partial<PaymentSplitRow>) =>
    onChange(splits.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  const remove = (uid: string) =>
    onChange(splits.length === 1 ? splits : splits.filter((r) => r.uid !== uid));
  const add = () => onChange([...splits, newPaymentSplitRow()]);

  const total = useMemo(
    () => splits.reduce((s, r) => s + (Number(r.amount) || 0), 0),
    [splits],
  );

  return (
    <>
      <div className="card-header" style={{ marginTop: 8 }}>
        <div className="card-title">{title}</div>
        <button type="button" className="btn btn-sm" onClick={add}>+ إضافة سطر</button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 8 }}>
        {splits.map((row) => {
          const methods = methodsForSplit(row, merchants);
          return (
            <div key={row.uid} className="form-grid" style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8 }}>
              {!hideSource && (
                <div className="form-group"><label>جهة الدفع</label>
                  <select
                    value={row.source}
                    onChange={(e) => update(row.uid, {
                      source: e.target.value as SplitSource,
                      merchant_id: "",
                      method: e.target.value === "company" ? "company_cash" : "",
                    })}
                  >
                    <option value="company">الشركة</option>
                    <option value="merchant">تاجر</option>
                  </select>
                </div>
              )}
              <div className="form-group"><label>العملة</label>
                <select value={row.currency} onChange={(e) => update(row.uid, { currency: e.target.value as SplitCurrency })}>
                  {SPLIT_CURRENCY_OPTIONS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                </select>
              </div>
              {row.source === "merchant" && !lockMerchantId && (
                <div className="form-group"><label>التاجر</label>
                  <select value={row.merchant_id} onChange={(e) => update(row.uid, { merchant_id: e.target.value, method: "" })}>
                    <option value="" disabled>اختر...</option>
                    {merchants
                      .filter((m) => ((m as any).status || "نشط") === "نشط" || m.id === row.merchant_id)
                      .map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.merchant_name}
                          {((m as any).status || "نشط") !== "نشط" ? " (غير نشط)" : ""}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              <div className="form-group"><label>وسيلة الدفع</label>
                <select value={row.method} onChange={(e) => update(row.uid, { method: e.target.value })}>
                  <option value="" disabled>اختر...</option>
                  {methods.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </select>
              </div>
              <div className="form-group"><label>المبلغ</label>
                <input type="number" min={0} value={row.amount} onChange={(e) => update(row.uid, { amount: e.target.value })} />
              </div>
              <div className="form-group" style={{ alignSelf: "end" }}>
                <button
                  type="button"
                  className="btn btn-sm btn-danger"
                  onClick={() => remove(row.uid)}
                  disabled={splits.length === 1}
                >
                  حذف
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: "none" }} aria-hidden>{total}</div>
    </>
  );
}

/**
 * Validation helper — returns an error message string when invalid, or null when OK.
 */
export function validatePaymentSplits(splits: PaymentSplitRow[]): string | null {
  const valid = splits.filter((r) => Number(r.amount) > 0);
  if (valid.length === 0) return "أضف وسيلة دفع واحدة على الأقل بمبلغ";
  for (const r of valid) {
    if (r.source === "merchant" && !r.merchant_id) return "اختر التاجر لكل سطر تاجر";
    if (!r.method) return "اختر وسيلة الدفع لكل سطر";
  }
  return null;
}

export function filterValidSplits(splits: PaymentSplitRow[]): PaymentSplitRow[] {
  return splits.filter((r) => Number(r.amount) > 0);
}
