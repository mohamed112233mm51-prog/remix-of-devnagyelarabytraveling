import * as XLSX from "xlsx";
import Papa from "papaparse";

export type ParsedFile = {
  headers: string[];
  rows: Record<string, any>[];
  /** Optional raw cell values aligned with rows. Existing import consumers can ignore this. */
  rawRows?: Record<string, any>[];
};

export async function parseFile(file: File): Promise<ParsedFile> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (ext === "csv" || ext === "txt") return parseCSV(file);
  return parseXLSX(file);
}

function hasMeaningfulValue(row: Record<string, any>) {
  return Object.values(row).some((value) => String(value ?? "").trim() !== "");
}

async function parseXLSX(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const parsedRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
  const rawParsedRows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: true });

  // Smart templates may pre-fill formulas on hundreds of ready-to-use rows.
  // Formula rows that still evaluate to empty strings must not become fake imports.
  const rows: Record<string, any>[] = [];
  const rawRows: Record<string, any>[] = [];
  parsedRows.forEach((row, index) => {
    if (!hasMeaningfulValue(row)) return;
    rows.push(row);
    rawRows.push(rawParsedRows[index] || {});
  });

  const headers = parsedRows.length ? Object.keys(parsedRows[0]) : [];
  return { headers, rows, rawRows };
}

async function parseCSV(file: File): Promise<ParsedFile> {
  const text = await file.text();
  return new Promise((resolve, reject) => {
    Papa.parse<Record<string, any>>(text, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        const rows = res.data;
        const headers = res.meta.fields || (rows.length ? Object.keys(rows[0]) : []);
        resolve({ headers, rows, rawRows: rows });
      },
      error: (err: any) => reject(err),
    });
  });
}
