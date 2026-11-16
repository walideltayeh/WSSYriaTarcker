// Builds import/docs.sql from a state export ({ docs: { path: data } }) so every record goes into D1 as-is.
import fs from "node:fs";
const [src, out = "import/docs.sql", stamp = new Date().toISOString()] = process.argv.slice(2);
const { docs } = JSON.parse(fs.readFileSync(src, "utf8"));
const q = (s) => "'" + String(s).replace(/'/g, "''") + "'";
const lines = Object.entries(docs).map(([p, d]) => `INSERT OR REPLACE INTO docs (path, json, updated_at) VALUES (${q(p)}, ${q(JSON.stringify(d))}, ${q(stamp)});`);
// D1 refuses one SQL statement over 100 KB: stop with the record's name rather than fail halfway through an import
const big = lines.map((l, i) => [Buffer.byteLength(l), Object.keys(docs)[i]]).filter(([n]) => n > 99000);
if (big.length) throw new Error("too large for one D1 statement: " + big.map(([n, p]) => `${p} (${n} bytes)`).join(", "));
fs.writeFileSync(out, lines.join("\n") + "\n");
console.log("records", lines.length, "->", out, fs.statSync(out).size, "bytes");
