// One combined workbook: merged wholesaler, one naming for products, every sheet computed from the movements.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
const require2 = createRequire(import.meta.url);
const XLSX = require2("xlsx"); // npm install xlsx
const dir = path.dirname(fileURLToPath(import.meta.url));

// usage: node scripts/combine.mjs <source workbook> [output workbook]
const src = XLSX.readFile(process.argv[2] || path.join(dir, "merged.xlsx"));
const aoa = XLSX.utils.sheet_to_json(src.Sheets["All Movements"], { header: 1, raw: true, defval: null });
const hi = aoa.findIndex((r) => r && r[0] === "SKU (EN)");
const H = aoa[hi], col = (n) => H.indexOf(n);
const iso = (v) => (typeof v === "number" ? new Date(Date.UTC(1899, 11, 30) + v * 864e5).toISOString().slice(0, 10) : String(v ?? ""));
const squash = (s) => s.split(" ").filter(Boolean).join(" ");
const canon = (en) => squash(en.trim().replace(/Cruz/gi, "50g").replace(/KF/g, "250g").replace(/Kilo/gi, "Kg"));
const fmtOf = (en) => (/Kg/i.test(en) ? "Kg" : /250g/i.test(en) ? "250g" : "50g");

const rows = aoa.slice(hi + 1).filter((r) => r && r[col("SKU (EN)")] && typeof r[col("Date")] === "number").map((r) => ({
  en: canon(String(r[col("SKU (EN)")])), asWritten: String(r[col("SKU (EN)")]).trim(), ar: String(r[col("SKU (AR)")] ?? "").trim(),
  source: String(r[col("Source")] ?? ""), date: iso(r[col("Date")]), type: String(r[col("Transaction Type (EN)")] ?? "").trim(),
  raw: r[col("WS Name")] ? String(r[col("WS Name")]).trim() : "", ws: r[col("WS (grouped)")] ? String(r[col("WS (grouped)")]).trim() : "",
  ref: r[col("Ref")] == null ? "" : String(r[col("Ref")]), inb: +r[col("Inbound")] || 0, out: +r[col("Outbound")] || 0,
}));
const sales = rows.filter((r) => r.type === "Sales Invoice");
const sum = (a, f) => a.reduce((n, r) => n + f(r), 0);
const total = sum(sales, (r) => r.out);
const skus = [...new Set(rows.map((r) => r.en))].sort((a, b) => sum(sales.filter((r) => r.en === b), (r) => r.out) - sum(sales.filter((r) => r.en === a), (r) => r.out));
const wss = [...new Set(sales.map((r) => r.ws).filter(Boolean))];
const fmts = ["50g", "250g", "Kg"];

const mv = [["SKU (EN)", "SKU as written", "SKU (AR)", "Format", "Source", "Date", "Transaction Type", "WS Name (as invoiced)", "WS (grouped)", "Ref", "Inbound (MC)", "Outbound (MC)"]];
for (const r of rows) mv.push([r.en, r.asWritten, r.ar, fmtOf(r.en), r.source, r.date, r.type, r.raw, r.ws, r.ref, r.inb, r.out]);

const sm = [["SKU (EN)", "SKU (AR)", "Format", "Inbound (MC)", "Outbound (MC)", "Closing stock (MC)", "Movements"]];
for (const s of skus) {
  const rs = rows.filter((r) => r.en === s);
  sm.push([s, rs[0].ar, fmtOf(s), sum(rs, (r) => r.inb), sum(rs, (r) => r.out), sum(rs, (r) => r.inb) - sum(rs, (r) => r.out), rs.length]);
}
sm.push(["TOTAL", "", "", sum(rows, (r) => r.inb), sum(rows, (r) => r.out), sum(rows, (r) => r.inb - r.out), rows.length]);

const board = wss.map((w) => {
  const rs = sales.filter((r) => r.ws === w);
  const per = {};
  for (const r of rs) per[r.en] = (per[r.en] || 0) + r.out;
  const top = Object.entries(per).sort((a, b) => b[1] - a[1])[0];
  const days = [...new Set(rs.map((r) => r.date))].sort();
  return [w, sum(rs, (r) => r.out), rs.length, days.length, Object.keys(per).length, top[0], top[1], sum(rs, (r) => r.out) / total, days[0], days[days.length - 1]];
}).sort((a, b) => b[1] - a[1]);
const wa = [["Rank", "WS (grouped)", "Total MC", "Sales lines", "Order days", "SKUs", "Biggest SKU", "MC in biggest", "Share of total", "First order", "Last order"]];
board.forEach((r, i) => wa.push([i + 1, ...r]));
wa.push(["", "TOTAL", total, sales.length, "", "", "", "", 1, "", ""]);

const mx = [["WS (grouped)", ...skus, "Total"]];
for (const b of board) {
  const rs = sales.filter((r) => r.ws === b[0]);
  const cells = skus.map((s) => sum(rs.filter((r) => r.en === s), (r) => r.out));
  mx.push([b[0], ...cells, cells.reduce((x, y) => x + y, 0)]);
}
mx.push(["TOTAL", ...skus.map((s) => sum(sales.filter((r) => r.en === s), (r) => r.out)), total]);

const wf = [["WS (grouped)", ...fmts, "Total"]];
for (const b of board) {
  const rs = sales.filter((r) => r.ws === b[0]);
  const cells = fmts.map((f) => sum(rs.filter((r) => fmtOf(r.en) === f), (r) => r.out));
  wf.push([b[0], ...cells, cells.reduce((x, y) => x + y, 0)]);
}
wf.push(["TOTAL", ...fmts.map((f) => sum(sales.filter((r) => fmtOf(r.en) === f), (r) => r.out)), total]);

const dates = rows.map((r) => r.date).sort();
const notes = [["WS Tracker — combined workbook"], [],
  ["Merged wholesaler", "ابو ظافر  →  يوسف ابو فرحان (one person; 7,385 MC over 34 sales lines)"],
  ["WS (grouped)", "The wholesaler each invoice belongs to, after merging."],
  ["WS Name (as invoiced)", "Kept unchanged, so you can still see what each invoice said."],
  ["SKU names", "Old ledger wording (Cruz / KF / Kilo) is shown under the current naming (50g / 250g / Kg); the original stays in SKU as written."],
  ["Units", "Every quantity is mastercases (MC): inbound, outbound and stock alike."],
  ["Sheets", "All Movements is the source. Summary, WS Analysis, WS x SKU and WS x Format are calculated from it as values, so nothing can go stale."], [],
  ["Movements", rows.length], ["Sales lines", sales.length], ["Total sold (MC)", total],
  ["Inbound (MC)", sum(rows, (r) => r.inb)], ["Outbound (MC)", sum(rows, (r) => r.out)], ["Closing stock (MC)", sum(rows, (r) => r.inb - r.out)],
  ["Wholesalers", wss.length], ["Products", skus.length], ["Period", dates[0] + "  →  " + dates[dates.length - 1]], ["Built", new Date().toISOString().slice(0, 10)]];

const wb = XLSX.utils.book_new();
const add = (name, data, widths) => { const ws = XLSX.utils.aoa_to_sheet(data); ws["!cols"] = widths; ws["!freeze"] = { xSplit: 0, ySplit: 1 }; XLSX.utils.book_append_sheet(wb, ws, name); };
add("Notes", notes, [{ wch: 26 }, { wch: 86 }]);
add("Summary", sm, [{ wch: 30 }, { wch: 30 }, { wch: 8 }, { wch: 13 }, { wch: 14 }, { wch: 18 }, { wch: 11 }]);
add("WS Analysis", wa, [{ wch: 6 }, { wch: 24 }, { wch: 10 }, { wch: 11 }, { wch: 11 }, { wch: 7 }, { wch: 26 }, { wch: 13 }, { wch: 13 }, { wch: 12 }, { wch: 12 }]);
add("WS x SKU", mx, [{ wch: 24 }, ...skus.map(() => ({ wch: 17 })), { wch: 10 }]);
add("WS x Format", wf, [{ wch: 24 }, { wch: 10 }, { wch: 10 }, { wch: 10 }, { wch: 10 }]);
add("All Movements", mv, [{ wch: 28 }, { wch: 26 }, { wch: 30 }, { wch: 8 }, { wch: 16 }, { wch: 11 }, { wch: 21 }, { wch: 24 }, { wch: 22 }, { wch: 8 }, { wch: 12 }, { wch: 13 }]);
const out = process.argv[3] || path.join(dir, "WS Data Syria - combined.xlsx");
XLSX.writeFile(wb, out);
console.log(JSON.stringify({ movements: rows.length, salesLines: sales.length, total, wholesalers: wss.length, skus: skus.length, yousef: board.find((b) => b[0].indexOf("يوسف") === 0), top3: board.slice(0, 3).map((b) => [b[0], b[1]]) }, null, 1));
