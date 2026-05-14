import { memo, useMemo } from "react";
import { normalizeDropdownValue } from "@/lib/db";

export const SafeSelectOptions = memo(function SafeSelectOptions({
  options,
  emptyLabel = "لا توجد بيانات",
}: {
  options?: readonly string[] | null;
  emptyLabel?: string;
}) {
  const safeOptions = useMemo(() => {
    const seen = new Set<string>();
    return (Array.isArray(options) ? options : [])
      .map(normalizeDropdownValue)
      .filter((value) => {
        if (!value || seen.has(value)) return false;
        seen.add(value);
        return true;
      });
  }, [options]);

  if (safeOptions.length === 0) {
    return <option value="" disabled>{emptyLabel}</option>;
  }

  return <>{safeOptions.map((value) => <option key={value} value={value}>{value}</option>)}</>;
});