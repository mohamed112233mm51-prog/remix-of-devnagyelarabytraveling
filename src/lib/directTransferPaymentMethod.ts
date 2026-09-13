export type DirectTransferPaymentMethod =
  | "direct_instapay"
  | "direct_vodafone_cash"
  | "direct_cash";

export const DIRECT_TRANSFER_PAYMENT_METHODS: Array<{
  key: DirectTransferPaymentMethod;
  label: string;
}> = [
  { key: "direct_instapay", label: "إنستا" },
  { key: "direct_vodafone_cash", label: "فودافون كاش" },
  { key: "direct_cash", label: "نقدي" },
];

export function isDirectTransferPaymentMethod(value: unknown): value is DirectTransferPaymentMethod {
  return DIRECT_TRANSFER_PAYMENT_METHODS.some((option) => option.key === value);
}

export function directTransferPaymentLabel(method: DirectTransferPaymentMethod): string {
  return DIRECT_TRANSFER_PAYMENT_METHODS.find((option) => option.key === method)?.label || "دفع مباشر";
}

export function directTransferPaymentAmounts(method: DirectTransferPaymentMethod, amount: number) {
  const value = Number(amount) || 0;
  return {
    instapayAmount: method === "direct_instapay" ? value : 0,
    cashAmount: method === "direct_cash" ? value : 0,
    mobileCashAmount: method === "direct_vodafone_cash" ? value : 0,
    mobileCashNetAmount: method === "direct_vodafone_cash" ? value : 0,
  };
}

export function directTransferPaymentLabelFromRow(row: {
  instapay_amount?: number | string | null;
  cash_amount?: number | string | null;
  mobile_cash_amount?: number | string | null;
}): string | null {
  if (Math.abs(Number(row.instapay_amount || 0)) > 0) return "إنستا";
  if (Math.abs(Number(row.mobile_cash_amount || 0)) > 0) return "فودافون كاش";
  if (Math.abs(Number(row.cash_amount || 0)) > 0) return "نقدي";
  return null;
}
