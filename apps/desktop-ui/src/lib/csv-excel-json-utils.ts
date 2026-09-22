/**
 * CSV / Excel ↔ JSON helpers (browser). Dates: CSV ISO-like strings stay strings;
 * Excel uses cellDates + serial fallback → ISO strings in JSON.
 */
import type { BookType, WorkBook } from "xlsx";
import { downloadFile } from "@/lib/desktop/save-file";

export function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    const nextChar = line[i + 1];

    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

function coerceCsvCell(raw: string): unknown {
  const v = raw.trim();
  if (v === "") return null;
  const lower = v.toLowerCase();
  if (lower === "true") return true;
  if (lower === "false") return false;
  if (lower === "null") return null;
  // Keep ISO-like dates as strings (avoid Number() or mangled parsing)
  if (/^\d{4}-\d{2}-\d{2}([T ]\d)/.test(v)) return v;
  if (/^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(v)) {
    if (/^0\d/.test(v)) return v;
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  return v;
}

export function csvTextToRows(csv: string): Record<string, unknown>[] {
  const normalized = csv.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalized.split("\n").filter((l) => l.length > 0);
  if (lines.length < 2) {
    throw new Error("CSV needs a header row and at least one data row");
  }
  const headers = parseCSVLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = parseCSVLine(line);
    const obj: Record<string, unknown> = {};
    headers.forEach((h, i) => {
      obj[h] = coerceCsvCell(values[i] ?? "");
    });
    return obj;
  });
}

export function normalizeExcelCell(value: unknown): unknown {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  return value;
}

export async function excelBufferToRows(buffer: ArrayBuffer): Promise<Record<string, unknown>[]> {
  const XLSX = await import("xlsx");
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  const name = wb.SheetNames[0];
  if (!name) throw new Error("Workbook has no sheets");
  const ws = wb.Sheets[name];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(ws, {
    defval: null,
    raw: false,
  });
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      out[k] = normalizeExcelCell(v);
    }
    return out;
  });
}

export function parseJsonToRows(text: string): Record<string, unknown>[] {
  const data = JSON.parse(text) as unknown;
  if (!Array.isArray(data)) {
    throw new Error("JSON must be an array");
  }
  if (!data.length) {
    throw new Error("Array is empty — add at least one object row");
  }
  if (
    !data.every(
      (item) =>
        item !== null && typeof item === "object" && !Array.isArray(item)
    )
  ) {
    throw new Error("Each array item must be a plain object");
  }
  return data as Record<string, unknown>[];
}

function cellToCsvField(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    const str = JSON.stringify(value);
    return str.includes(",") || str.includes('"') || str.includes("\n")
      ? `"${str.replace(/"/g, '""')}"`
      : str;
  }
  const str = String(value);
  return str.includes(",") || str.includes('"') || str.includes("\n")
    ? `"${str.replace(/"/g, '""')}"`
    : str;
}

export function rowsToCSV(rows: Record<string, unknown>[]): string {
  const keySet = new Set<string>();
  rows.forEach((row) => {
    Object.keys(row).forEach((k) => keySet.add(k));
  });
  const columns = Array.from(keySet);
  if (columns.length === 0) {
    throw new Error("No columns to export");
  }
  const header = columns.map((c) => cellToCsvField(c)).join(",");
  const body = rows.map((row) =>
    columns.map((col) => cellToCsvField(row[col])).join(",")
  );
  return [header, ...body].join("\n");
}

const WORKBOOK_MIME: Partial<Record<BookType, string>> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv;charset=utf-8",
  txt: "text/plain;charset=utf-8",
};

/**
 * Write a SheetJS workbook to a file. `XLSX.writeFile` builds its own anchor
 * download, which the Tauri webview cancels — serialize and hand the bytes to
 * downloadFile instead.
 */
export async function downloadWorkbook(wb: WorkBook, filename: string, bookType: BookType = "xlsx") {
  const XLSX = await import("xlsx");
  const data = XLSX.write(wb, { type: "array", bookType }) as ArrayBuffer;
  downloadFile(new Uint8Array(data), filename, WORKBOOK_MIME[bookType]);
}

export async function rowsToXlsxFile(
  rows: Record<string, unknown>[],
  sheetName: string,
  filename: string
) {
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || "Sheet1");
  await downloadWorkbook(wb, filename);
}
