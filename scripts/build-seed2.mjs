// Rebuild the ledger from the renamed workbook. Old (Cruz/KF/Kilo) and new (50g/250g/Kg) names map to one SKU.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const wb = JSON.parse(fs.readFileSync(path.join(dir, "ws.json"), "utf8"));
const iso = (serial) => new Date(Date.UTC(1899, 11, 30) + serial * 864e5).toISOString().slice(0, 10);
const canon = (en) => en.trim().replace(/\bCruz\b/gi, "50g").replace(/\bKF\b/g, "250g").replace(/\bKilo\b/gi, "Kg").replace(/\s+/g, " ");
const slug = (s) => s.toLowerCase().replace(/[()]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

const all = wb["All Movements"].filter(Boolean);
const hdr = all.findIndex((r) => r[0] === "SKU (EN)");
const H = all[hdr], col = (n) => H.indexOf(n);
const rows = all.slice(hdr + 1).filter((r) => r[col("SKU (EN)")] && typeof r[col("Date")] === "number");

// how was the rename applied?
const renamed = rows.filter((r) => canon(String(r[col("SKU (EN)")])) === String(r[col("SKU (EN)")]).trim() && /50g|250g|\bKg\b/.test(r[col("SKU (EN)")]));
const oldNamed = rows.filter((r) => /\b(Cruz|KF|Kilo)\b/.test(r[col("SKU (EN)")]));
const byWsRenamed = {};
for (const r of renamed) { const k = r[col("WS (grouped)")] || "(" + r[col("Transaction Type (EN)")] + ")"; byWsRenamed[k] = (byWsRenamed[k] || 0) + 1; }
console.log({ rows: rows.length, rowsWithNewName: renamed.length, rowsWithOldName: oldNamed.length, unchanged_TwoAppleBlack: rows.filter((r) => r[col("SKU (EN)")] === "Two Apple Black").length });
console.log("rows already renamed, by wholesaler/type:", byWsRenamed);

const skus = [], idx = new Map();
for (const r of rows) {
  const en = canon(String(r[col("SKU (EN)")]));
  if (!idx.has(en)) { idx.set(en, skus.length); skus.push({ id: slug(en), en, ar: String(r[col("SKU (AR)")]).trim(), src: String(r[col("Source")] ?? "") }); }
}
const ledgerRows = rows.map((r) => [idx.get(canon(String(r[col("SKU (EN)")]))), iso(r[col("Date")]), String(r[col("Transaction Type (EN)")] ?? "").trim(),
  r[col("WS (grouped)")] ? String(r[col("WS (grouped)")]).trim() : "", r[col("Ref")] == null ? "" : String(r[col("Ref")]), +r[col("Inbound")] || 0, +r[col("Outbound")] || 0]);

// compare against the previous (verified) ledger, mapping its old names the same way
const prevMeta = JSON.parse(fs.readFileSync(path.join(dir, "seed-meta.json"), "utf8"));
const prevRows = JSON.parse(fs.readFileSync(path.join(dir, "seed-rows-0.json"), "utf8")).rows;
const key = (skuEn, r) => [canon(skuEn), r[1], r[2], r[3], r[4], r[5], r[6]].join("|");
const prevKeys = prevRows.map((r) => key(prevMeta.skus[r[0]].en, r)).sort();
const newKeys = ledgerRows.map((r) => key(skus[r[0]].en, r)).sort();
const onlyPrev = prevKeys.filter((k, i, a) => !newKeys.includes(k));
const onlyNew = newKeys.filter((k) => !prevKeys.includes(k));
console.log({ sameRows: onlyPrev.length === 0 && onlyNew.length === 0, onlyInPrevious: onlyPrev.slice(0, 5), onlyInNew: onlyNew.slice(0, 5) });
const sales = ledgerRows.filter((r) => r[2] === "Sales Invoice");
console.log({ salesUnits: sales.reduce((a, r) => a + r[6], 0), inbound: ledgerRows.reduce((a, r) => a + r[5], 0), outbound: ledgerRows.reduce((a, r) => a + r[6], 0), wholesalers: new Set(sales.map((r) => r[3])).size });
console.log(skus.map((s) => `${s.id} = ${s.en} / ${s.ar}`).join("\n"));
fs.writeFileSync(path.join(dir, "seed2-meta.json"), JSON.stringify({ v: 1, source: "WS Data Syria Claude.xlsx", importedAt: new Date().toISOString(), rowCount: ledgerRows.length, chunks: 1, skus, cols: ["sku", "date", "type", "ws", "ref", "in", "out"] }));
fs.writeFileSync(path.join(dir, "seed2-rows-0.json"), JSON.stringify({ rows: ledgerRows }));
