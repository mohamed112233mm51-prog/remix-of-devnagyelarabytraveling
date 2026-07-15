import type { CSSProperties } from "react";

/**
 * Absent-approval visual marker.
 *
 * الغرض: تمييز بصري (لون أحمر) للحركات المالية المرتبطة بتنفيذ حالته
 * الاعتمادية = "غياب". لا يغيّر أي قيمة مالية أو ترحيل أو رصيد —
 * فقط علامة عرض تُستخدم في:
 *   - نموذج التنفيذ (حقل الحالة + بطاقات الخدمات)
 *   - كشف حساب الوكيل
 *   - كشف حساب الشركة الصادرة
 *
 * الربط: transactions.source_service_type === "execution"
 *        transactions.source_service_id === `${executionId}::${index}`
 * الحالة محفوظة على مستوى التنفيذ (execution.status) — لذا تُلوَّن
 * جميع حركات التنفيذ عندما تكون الحالة "غياب".
 */

export const ABSENT_APPROVAL_STATUS = "غياب";

export function isAbsentStatus(status: unknown): boolean {
  return String(status ?? "").trim() === ABSENT_APPROVAL_STATUS;
}

/** Extracts the executionId prefix from `${executionId}::${index}`. */
export function extractExecutionIdFromSource(sourceServiceId: unknown): string | null {
  const s = String(sourceServiceId ?? "");
  if (!s) return null;
  const sep = s.indexOf("::");
  return sep > 0 ? s.slice(0, sep) : null;
}

export type AbsentLookup = {
  /** true ⇢ للحركة المالية مصدرها تنفيذ حالته "غياب". */
  isAbsentMovement: (t: { source_service_type?: string | null; source_service_id?: string | null } | null | undefined) => boolean;
};

/**
 * يبني Map مرة واحدة لتنفيذات "غياب" (id ⇢ true) لاستخدامها في تلوين
 * صفوف كشوف الحساب بدون Query إضافية لكل صف.
 */
export function buildAbsentLookup(executions: Array<{ id: string; status?: string | null }> | null | undefined): AbsentLookup {
  const absentIds = new Set<string>();
  for (const e of executions ?? []) {
    if (e && isAbsentStatus((e as any).status)) absentIds.add(e.id);
  }
  return {
    isAbsentMovement: (t) => {
      if (!t) return false;
      if (String(t.source_service_type ?? "").trim() !== "execution") return false;
      const execId = extractExecutionIdFromSource(t.source_service_id);
      return execId ? absentIds.has(execId) : false;
    },
  };
}

/** CSS خلفية "غياب" — تُطبَّق على <tr> أو <td> أو بطاقة/حقل. */
export const ABSENT_ROW_STYLE: React.CSSProperties = {
  backgroundColor: "#fee2e2",
  color: "#991b1b",
  // ضمان ظهور اللون في الطباعة وPDF
  WebkitPrintColorAdjust: "exact",
  printColorAdjust: "exact",
} as React.CSSProperties;

export const ABSENT_FIELD_STYLE: React.CSSProperties = {
  backgroundColor: "#fee2e2",
  borderColor: "#ef4444",
  color: "#991b1b",
} as React.CSSProperties;
