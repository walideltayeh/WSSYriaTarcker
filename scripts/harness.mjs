// Local test server: serves ws-tracker.html with an in-memory stand-in for window.claude (db/user/downloads).
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const dir = path.dirname(fileURLToPath(import.meta.url));
const mock = `
<script>
(() => {
  const data = new Map(); const subs = new Set();
  const snapDoc = (p) => ({ id: p.split("/").pop(), exists: data.has(p), data: () => data.get(p), metadata: { fromCache: false, hasPendingWrites: false } });
  const notify = () => setTimeout(() => subs.forEach((s) => s()), 0);
  const parentOf = (p) => p.split("/").slice(0, -1).join("/");
  const docRef = (p) => ({ id: p.split("/").pop(), path: p,
    get: async () => snapDoc(p),
    set: async (d) => { data.set(p, JSON.parse(JSON.stringify(d))); notify(); },
    update: async (d) => { if (!data.has(p)) throw { code: "invalid_argument" }; data.set(p, { ...data.get(p), ...d }); notify(); },
    delete: async () => { data.delete(p); notify(); },
    onSnapshot: (next) => { const f = () => next(snapDoc(p)); subs.add(f); setTimeout(f, 5); return () => subs.delete(f); } });
  const colRef = (c) => ({ path: c, doc: (id) => docRef(c + "/" + (id || Math.random().toString(36).slice(2))),
    get: async () => { const docs = [...data.keys()].filter((k) => parentOf(k) === c).sort().map(snapDoc); return { docs, size: docs.length, empty: !docs.length }; },
    onSnapshot: (next) => { const f = () => { const docs = [...data.keys()].filter((k) => parentOf(k) === c).sort().map(snapDoc); next({ docs, size: docs.length, empty: !docs.length, docChanges: () => [] }); }; subs.add(f); setTimeout(f, 5); return () => subs.delete(f); } });
  window.__mockData = data;
  const seed = window.__SEED || {}; for (const [k, v] of Object.entries(seed)) data.set(k, v);
  const me = { id: "u_owner", name: "Walid (test)", avatarUrl: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26'%3E%3Ccircle cx='13' cy='13' r='13' fill='%230d5b62'/%3E%3C/svg%3E", color: "#0d5b62", email: null, isOwner: true, canEdit: true };
  const M = {
    db: { doc: docRef, collection: colRef },
    user: { me: async () => me, id: async () => me.id, isOwner: async () => true, canEdit: async () => true, can: async () => true,
      profiles: async (ids) => Object.fromEntries([].concat(ids).map((i) => [i, { id: i, name: i === "u_owner" ? "Walid (test)" : "Supervisor A", avatarUrl: me.avatarUrl, color: "#888", email: null, isMe: i === me.id }])) },
    downloads: { save: async (r) => { console.log("download", r.filename); return { status: "saved" }; } },
  };
  window.claude = { use: async (n) => { await new Promise((r) => setTimeout(r, 30)); return M[n] ?? null; } };
})();
</script>`;
const server = http.createServer((req, res) => {
  // Seed files are private and not committed; without them the app starts empty and you import the workbook from the Data tab.
  const read = (f) => (fs.existsSync(path.join(dir, f)) ? JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) : null);
  const meta = read("seed-meta.json"), rows = read("seed-rows-0.json");
  const seed = meta && rows ? { "ledger/meta": meta, "ledger/rows-0": rows, ...(read("seed-test-counts.json") || {}) } : {};
  const app = fs.readFileSync(path.join(dir, "..", "app", "ws-tracker.html"), "utf8");
  const themed = false;
  const ribbon = themed ? `<div style="position:fixed;inset-inline-start:12px;bottom:88px;z-index:50;background:#1F1A1A;color:#fff;font:500 11px/1.4 Jost,system-ui,sans-serif;letter-spacing:.12em;text-transform:uppercase;padding:6px 10px;border-radius:3px;opacity:.85">Theme preview · sample counts</div>` : "";
  const page = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>WS Tracker — local</title><style>:root{padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)}body{margin:0}[hidden]{display:none!important}</style></head><body><script>window.__SEED=${JSON.stringify(seed)}</script>${mock}${app}${ribbon}</body></html>`;
  res.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
  res.end(page);
});
const port = +process.env.PORT || 5175;
server.listen(port, () => console.log("harness up on " + port));
