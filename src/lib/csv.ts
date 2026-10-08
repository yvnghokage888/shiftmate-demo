// CSV helpers, ported from the vanilla app. csvCell neutralises spreadsheet
// formula injection (a cell starting with = + - @ / tab / CR is treated as a
// formula by Excel/Sheets) and quote-escapes; downloadCsv builds + triggers a
// client-side data-URI download.

export function csvCell(v: unknown): string {
  let s = String(v == null ? "" : v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replace(/"/g, '""') + '"';
}

export function downloadCsv(filename: string, rows: (string | number)[][]): void {
  const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
  const a = document.createElement("a");
  a.href = "data:text/csv;charset=utf-8," + encodeURIComponent(csv);
  a.download = filename;
  a.click();
}
