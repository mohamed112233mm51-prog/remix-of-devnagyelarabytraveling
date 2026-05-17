import * as XLSX from "xlsx";
import Papa from "papaparse";

export type ParsedFile = { headers: string[]; rows: Record<string, any>[] };

export async function parseFile(file: File): Promise<ParsedFile> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "";
  if (ext === "csv" || ext === "txt") return parseCSV(file);
  return parseXLSX(file);
}

async function parseXLSX(file: File): Promise<ParsedFile> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array", cellDates: true });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: "", raw: false });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { headers, rows };
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
        resolve({ headers, rows });
      },
      error: (err: any) => reject(err),
    });
  });
}
