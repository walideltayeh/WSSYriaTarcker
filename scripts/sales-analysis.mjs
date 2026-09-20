import { createRequire } from "node:module";
const require2 = createRequire(import.meta.url);
const XLSX = require2("xlsx"); // npm install xlsx
// usage: node scripts/sales-analysis.mjs <combined workbook>
const wb = XLSX.readFile(process.argv[2] || "WS Data Syria - combined.xlsx");
const rows = XLSX.utils.sheet_to_json(wb.Sheets["All Movements"], { defval: null });
const sales = rows.filter((r) => r["Transaction Type"] === "Sales Invoice" && r["WS (grouped)"]);
const flavourOf = (en) => (/Two Apple/i.test(en) ? "Two Apples" : /Red/i.test(en) ? "Red" : /Grape & Mint/i.test(en) ? "Grape & Mint" : /Grape/i.test(en) ? "Grape" : /Love/i.test(en) ? "Love" : "Blueberry");
const mc = (r) => +r["Outbound (MC)"] || 0;
const months = [...new Set(sales.map((r) => String(r.Date).slice(0, 7)))].sort();
const piv = (key) => {
  const keys = [...new Set(sales.map(key))];
  const out = keys.map((k) => {
    const rs = sales.filter((r) => key(r) === k);
    const byM = months.map((m) => rs.filter((r) => String(r.Date).slice(0, 7) === m).reduce((a, r) => a + mc(r), 0));
    return { k, total: byM.reduce((a, b) => a + b, 0), byM, lines: rs.length, wss: new Set(rs.map((r) => r["WS (grouped)"])).size };
  }).sort((a, b) => b.total - a.total);
  return out;
};
const total = sales.reduce((a, r) => a + mc(r), 0);
const monthTot = months.map((m) => sales.filter((r) => String(r.Date).slice(0, 7) === m).reduce((a, r) => a + mc(r), 0));
const buyers = months.map((m) => new Set(sales.filter((r) => String(r.Date).slice(0, 7) === m).map((r) => r["WS (grouped)"])).size);
const orders = months.map((m) => new Set(sales.filter((r) => String(r.Date).slice(0, 7) === m).map((r) => r["WS (grouped)"] + r.Date)).size);
const p = (n) => Math.round((n / total) * 1000) / 10;
console.log("MONTHS       ", months.join("  "));
console.log("TOTAL MC     ", monthTot.join("  "), "| sum", total);
console.log("MoM %        ", monthTot.map((v, i) => (i ? Math.round(((v - monthTot[i - 1]) / monthTot[i - 1]) * 100) + "%" : "-")).join("  "));
console.log("BUYERS       ", buyers.join("  "));
console.log("ORDERS       ", orders.join("  "));
console.log("AVG ORDER    ", monthTot.map((v, i) => Math.round(v / orders[i])).join("  "));
for (const [name, key] of [["FLAVOUR", (r) => flavourOf(r["SKU (EN)"])], ["FORMAT", (r) => r.Format], ["WHOLESALER", (r) => r["WS (grouped)"]]]) {
  console.log("\n== " + name);
  for (const x of piv(key).slice(0, 8)) console.log(String(x.k).padEnd(22), String(x.total).padStart(6), (p(x.total) + "%").padStart(6), " | ", x.byM.join(" "));
}
