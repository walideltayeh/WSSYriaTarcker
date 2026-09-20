// Minimal dependency-free xlsx reader: dumps every sheet as JSON rows.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "ws_x");
const rd = (p) => fs.readFileSync(path.join(root, p), "utf8");
const dec = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, "&");

const shared = fs.existsSync(path.join(root, "xl/sharedStrings.xml"))
  ? [...rd("xl/sharedStrings.xml").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => t[1]).join("")))
  : [];
const wb = rd("xl/workbook.xml");
const rels = rd("xl/_rels/workbook.xml.rels");
const sheets = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].map(([, name, rid]) => {
  const target = rels.match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"`))?.[1] ?? rels.match(new RegExp(`Target="([^"]+)"[^>]*Id="${rid}"`))?.[1];
  return { name: dec(name), file: "xl/" + target.replace(/^\/?xl\//, "") };
});
const colIdx = (ref) => ref.replace(/\d+/g, "").split("").reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0) - 1;
const out = {};
for (const s of sheets) {
  const xml = rd(s.file);
  const rows = [];
  for (const r of xml.matchAll(/<row [^>]*r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g)) {
    const row = [];
    for (const c of r[2].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = c[1];
      const ref = attrs.match(/r="([A-Z]+\d+)"/)[1];
      const t = attrs.match(/t="(\w+)"/)?.[1];
      const v = c[2]?.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      const is = c[2]?.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/)?.[1];
      let val = t === "s" ? shared[+v] : t === "inlineStr" ? dec(is ?? "") : t === "str" ? dec(v ?? "") : v !== undefined ? +v : null;
      row[colIdx(ref)] = val;
    }
    rows[+r[1] - 1] = row;
  }
  out[s.name] = rows;
}
fs.writeFileSync(path.join(root, "..", "ws.json"), JSON.stringify(out));
for (const [name, rows] of Object.entries(out)) {
  const filled = rows.filter(Boolean);
  console.log(`\n=== ${name}  (${filled.length} rows)`);
  rows.slice(0, 14).forEach((r, i) => r && console.log(i + 1, JSON.stringify(r)));
}
