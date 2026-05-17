import * as XLSX from "xlsx";
import type { ImportSpec } from "./specs";

export function downloadTemplate(spec: ImportSpec) {
  const headers = spec.fields.map((f) => f.label + (f.required ? " *" : ""));
  const example: any[] = spec.fields.map((f) => {
    if (f.type === "date") return new Date().toISOString().slice(0, 10);
    if (f.type === "number" || f.type === "integer") return 0;
    if (f.default !== undefined) return f.default;
    return "";
  });
  const ws = XLSX.utils.aoa_to_sheet([headers, example]);
  // Right-to-left
  (ws as any)["!cols"] = headers.map(() => ({ wch: 22 }));
  const wb = XLSX.utils.book_new();
  (wb as any).Workbook = { Views: [{ RTL: true }] };
  XLSX.utils.book_append_sheet(wb, ws, spec.label.slice(0, 28));
  XLSX.writeFile(wb, `نموذج_${spec.id}.xlsx`);
}
