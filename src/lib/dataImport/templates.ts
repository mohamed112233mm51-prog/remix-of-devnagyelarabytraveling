import * as XLSX from "xlsx";
import type { ImportSpec } from "./specs";

function defaultExample(spec: ImportSpec): any[] {
  return spec.fields.map((f) => {
    if (f.example !== undefined) return f.example;
    if (f.type === "date") return "";
    if (f.type === "number" || f.type === "integer") return f.default ?? 0;
    if (f.type === "boolean") return f.default ? "نعم" : "لا";
    if (f.default !== undefined) return f.default;
    return "";
  });
}

export function downloadTemplate(spec: ImportSpec) {
  const headers = spec.fields.map((f) => f.label + (f.required ? " *" : ""));
  const exampleRows = spec.exampleRows?.length
    ? spec.exampleRows.map((row) => spec.fields.map((f) => row[f.key] ?? f.example ?? f.default ?? ""))
    : [defaultExample(spec)];

  const ws = XLSX.utils.aoa_to_sheet([headers, ...exampleRows]);
  (ws as any)["!cols"] = headers.map((h) => ({ wch: Math.max(18, Math.min(34, h.length + 6)) }));
  const wb = XLSX.utils.book_new();
  (wb as any).Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, spec.label.slice(0, 28));
  XLSX.writeFile(wb, `نموذج_${spec.id}.xlsx`);
}
