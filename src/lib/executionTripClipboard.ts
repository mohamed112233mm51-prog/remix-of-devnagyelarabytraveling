function detectDelimiter(firstLine: string): string {
  if (firstLine.includes("\t")) return "\t";
  if (firstLine.includes(";")) return ";";
  return ",";
}

function splitLine(line: string, delimiter: string): string[] {
  if (delimiter === "\t") return line.split("\t").map((value) => value.trim());

  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }
    if (char === delimiter && !quoted) {
      cells.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  cells.push(current.trim());
  return cells;
}

export type PastedManifest = {
  headers: string[];
  rows: Record<string, any>[];
  rawRows?: Record<string, any>[];
};

export function parsePastedManifest(text: string): PastedManifest {
  const normalized = String(text || "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .trim();

  if (!normalized) throw new Error("الصق صفوف Excel أولًا");

  const lines = normalized
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.trim() !== "");

  if (lines.length < 2) {
    throw new Error("الصق صف العناوين ومعه صف بيانات واحد على الأقل");
  }

  const delimiter = detectDelimiter(lines[0]);
  const rawHeaders = splitLine(lines[0], delimiter);
  const headers = rawHeaders.map((header, index) => header.trim() || `عمود ${index + 1}`);

  if (!headers.some(Boolean)) throw new Error("تعذر قراءة عناوين الأعمدة من البيانات الملصقة");

  const rows = lines.slice(1)
    .map((line) => {
      const cells = splitLine(line, delimiter);
      const row: Record<string, any> = {};
      headers.forEach((header, index) => {
        row[header] = cells[index] ?? "";
      });
      return row;
    })
    .filter((row) => Object.values(row).some((value) => String(value ?? "").trim() !== ""));

  if (!rows.length) throw new Error("البيانات الملصقة لا تحتوي على ركاب");

  return { headers, rows, rawRows: rows };
}
