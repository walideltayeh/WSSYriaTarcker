// WS Tracker Syria on Cloudflare: the tracker page (static asset) plus three data endpoints over one D1 database.
// A straight port of the earlier site's server code: same tables, same headers, same rules.
//   GET  /api/state  everything (access code)
//   POST /api/write  set / delete one record (access code; ledger also needs the owner password, movements the entry password)
//   GET  /api/ssof   the Syria feed SSOF reads (feed key);  POST /api/ssof  SSOF sends its active Syria SKUs (feed key)
// Secrets live in the meta table as SHA-256 hashes; the plain values are never stored.

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });

async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
function sameHash(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function matches(env, key, value) {
  if (!value) return false;
  const row = await env.DB.prepare("SELECT value FROM meta WHERE key = ?").bind(key).first();
  if (!row || !row.value) return false;
  return sameHash(await sha256Hex(value), row.value);
}
/** The shared access code every user types once to open the app. */
const authorized = (env, req) => matches(env, "access_hash", req.headers.get("x-ws-code") ?? "");
/** The owner's password, required on top of the access code to replace the ledger. */
const adminAuthorized = (env, req) => matches(env, "admin_hash", req.headers.get("x-ws-admin") ?? "");
/** The accountant's password, required to save a movement. */
const entryAuthorized = (env, req) => matches(env, "entry_hash", req.headers.get("x-ws-entry") ?? "");
/** The key the SSOF planning system reads the Syria feed with. */
const feedAuthorized = (env, req) => matches(env, "feed_hash", req.headers.get("x-ssof-key") || new URL(req.url).searchParams.get("key") || "");

const PATH = /^[A-Za-z0-9_.~:@+-]+(\/[A-Za-z0-9_.~:@+-]+)+$/;
// a record name like counts/<id>; a part made only of dots ("." / "..") is refused
const validPath = (p) => typeof p === "string" && p.length <= 200 && PATH.test(p) && !p.split("/").some((s) => /^\.+$/.test(s));
const isMovePath = (p) => p.startsWith("moves/");
const isLedgerPath = (p) => p === "ledger" || p.startsWith("ledger/");
const UPSERT = "INSERT INTO docs (path, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at";

async function getState(env, req) {
  if (!(await authorized(env, req))) return json({ error: "unauthorized" }, 401);
  const { results } = await env.DB.prepare("SELECT path, json FROM docs").all();
  const docs = {};
  for (const row of results ?? []) {
    try { docs[row.path] = JSON.parse(row.json); } catch { /* skip a corrupt row rather than fail the page */ }
  }
  return json({ docs });
}

async function postWrite(env, req) {
  if (!(await authorized(env, req))) return json({ error: "unauthorized" }, 401);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (!body || !validPath(body.path)) return json({ error: "bad path" }, 400);
  const path = body.path;
  if (isLedgerPath(path) && !(await adminAuthorized(env, req))) return json({ error: "admin password required" }, 403);
  if (isMovePath(path) && !(await entryAuthorized(env, req))) return json({ error: "entry password required" }, 403);
  if (path === SSOF_SKUS) return json({ error: "set by SSOF only" }, 403);
  if (body.op === "delete") {
    await env.DB.prepare("DELETE FROM docs WHERE path = ?").bind(path).run();
    return json({ ok: true });
  }
  if (body.op !== "set" || typeof body.data !== "object" || body.data === null || Array.isArray(body.data)) return json({ error: "bad op" }, 400);
  const data = JSON.stringify(body.data);
  if (data.length > 900000) return json({ error: "too large" }, 413);
  await env.DB.prepare(UPSERT).bind(path, data, new Date().toISOString()).run();
  return json({ ok: true });
}

/* ---------- Syria link with the SSOF planning system (both directions use the feed key) ----------
 * GET  - the feed SSOF reads: IMS (sales invoices to wholesalers) and Arrivals (into the Lattakia warehouse), per
 *        flavour, per format, per month, in mastercases. The Lebanon-warning pack is merged into its parent. Movements
 *        the accountant enters in the app count the same as the imported ledger.
 * POST - SSOF sends its active Syria SKUs (only a list marked source "published"), kept in config/ssofSkus. A SKU SSOF
 *        stops listing stays there as inactive; a movement entered for such a SKU goes back in the feed with its ssofSkuId.
 */
const SSOF_SKUS = "config/ssofSkus";
const formatOf = (en) => (/(?:\b|\d)Kg\b|Kilo/i.test(en) ? "Kg" : /\b250g\b|\bKF\b/i.test(en) ? "250g" : "50g");
const flavourOf = (en) =>
  /Two Apple/i.test(en)
    ? (/Iced|Frosty/i.test(en) ? "Two Apples Frosty" : /Black|Blk/i.test(en) ? "Two Apples Black" : "Two Apples")
    : /Red/i.test(en) ? "Red"
    : /Grape & Mint/i.test(en) ? "Grape & Mint"
    : /Grape/i.test(en) ? "Grape"
    : /Love/i.test(en) ? "Love"
    : "Blueberry";
const feedOf = (sku) => sku.feed ?? { flavour: flavourOf(sku.en), format: formatOf(sku.en) };

async function getSsof(env, req) {
  if (!(await feedAuthorized(env, req))) return json({ error: "feed key required" }, 401);
  const { results } = await env.DB.prepare("SELECT path, json FROM docs WHERE path LIKE 'ledger/%' OR path LIKE 'moves/%' OR path = 'config/ssofSkus'").all();
  const docs = new Map();
  for (const r of results ?? []) { try { docs.set(r.path, JSON.parse(r.json)); } catch { /* a corrupt row is skipped, not fatal */ } }
  const meta = docs.get("ledger/meta");
  if (!meta?.skus) return json({ error: "no ledger yet" }, 503);
  const skus = [...meta.skus];
  const sent = Array.isArray(docs.get(SSOF_SKUS)?.skus) ? docs.get(SSOF_SKUS).skus.filter((x) => x && typeof x === "object") : [];

  const rows = [];
  for (let i = 0; i < (meta.chunks || 1); i += 1) for (const r of docs.get("ledger/rows-" + i)?.rows ?? []) rows.push(r);
  const byId = new Map(skus.map((s, i) => [s.id, i]));
  // A movement entered for a SKU that came from SSOF ("ssof-<id>") is not in the ledger's product list.
  const indexOf = (id) => {
    if (typeof id !== "string") return undefined;
    const known = byId.get(id);
    if (known != null || !id.startsWith("ssof-")) return known;
    const k = sent.find((x) => x.id === Number(id.slice(5)));
    if (!k) return undefined;
    skus.push({ id, en: `${k.name} ${k.weight}`, ar: "", feed: k.tracker ? { flavour: k.tracker.flavour, format: k.tracker.format } : { flavour: k.name, format: k.weight, ssofSkuId: k.id } });
    byId.set(id, skus.length - 1);
    return skus.length - 1;
  };
  for (const [path, m] of docs) {
    if (!path.startsWith("moves/") || !m?.date || !Array.isArray(m.lines)) continue;
    for (const l of m.lines) {
      const i = indexOf(l.sku), qty = Number(l.qty);
      if (i == null || !(qty > 0)) continue;
      rows.push(m.kind === "out"
        ? [i, m.date, "Sales Invoice", String(m.ws || ""), String(m.ref || ""), 0, qty, "entered"]
        : [i, m.date, "Transfer from Lattakia", "", String(m.ref || ""), qty, 0, "entered"]);
    }
  }
  // Arrivals carry the week of the month (1-4) because SSOF books them into weekly buckets.
  const weekOf = (date) => Math.min(4, Math.floor((Number(date.slice(8, 10)) - 1) / 7) + 1);
  const put = (map, fd, month, qty, week) => {
    const k = `${fd.flavour}|${fd.format}|${fd.ssofSkuId ?? ""}|${month}|${week ?? 0}`;
    const cur = map.get(k) ?? { flavour: fd.flavour, format: fd.format, month, qty: 0, ...(week ? { week } : {}), ...(fd.ssofSkuId ? { ssofSkuId: fd.ssofSkuId } : {}) };
    cur.qty += qty; map.set(k, cur);
  };
  const ims = new Map(), arrivals = new Map(), products = new Map();
  let imsTotal = 0, arrivalsTotal = 0, first = "", last = "";
  for (const r of rows) {
    const sku = skus[r[0]]; if (!sku || !r[1]) continue;
    const fd = feedOf(sku), month = String(r[1]).slice(0, 7), pk = `${fd.flavour}|${fd.format}|${fd.ssofSkuId ?? ""}`;
    const p = products.get(pk) ?? { flavour: fd.flavour, format: fd.format, ...(fd.ssofSkuId ? { ssofSkuId: fd.ssofSkuId } : {}), trackerProducts: [] };
    if (!p.trackerProducts.includes(sku.en)) p.trackerProducts.push(sku.en);
    products.set(pk, p);
    if (!first || r[1] < first) first = r[1];
    if (r[1] > last) last = r[1];
    const out = Number(r[6]) || 0, inb = Number(r[5]) || 0;
    if (r[2] === "Sales Invoice" && out) { put(ims, fd, month, out); imsTotal += out; }
    if (inb) { put(arrivals, fd, month, inb, weekOf(String(r[1]))); arrivalsTotal += inb; }
  }
  const sort = (a, b) => a.month.localeCompare(b.month) || (a.week ?? 0) - (b.week ?? 0) || a.flavour.localeCompare(b.flavour) || a.format.localeCompare(b.format);
  const arrivalMovements = (() => {
    const m = new Map();
    for (const r of rows) {
      const inb = Number(r[5]) || 0; if (!inb) continue;
      const sku = skus[r[0]]; if (!sku || !r[1]) continue;
      const date = String(r[1]), fd = feedOf(sku);
      const k = `${date}|${fd.flavour}|${fd.format}|${fd.ssofSkuId ?? ""}`;
      const cur = m.get(k) ?? { date, flavour: fd.flavour, format: fd.format, qty: 0, ...(fd.ssofSkuId ? { ssofSkuId: fd.ssofSkuId } : {}) };
      cur.qty += inb; m.set(k, cur);
    }
    return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || a.flavour.localeCompare(b.flavour) || a.format.localeCompare(b.format));
  })();
  const body = {
    country: "Syria", countryCode: "SY", unit: "MC", source: "WS Tracker",
    generatedAt: new Date().toISOString(),
    period: { from: first.slice(0, 7), to: last.slice(0, 7), firstMovement: first, lastMovement: last },
    note: "Quantities are mastercases. One line per flavour and format; the Lebanon-warning pack is merged into its parent product. IMS lines are monthly; arrival lines also carry the week of the month (1-4). A line with ssofSkuId is a SKU SSOF sent to the tracker: match it by that id.",
    products: [...products.values()].sort((a, b) => a.flavour.localeCompare(b.flavour) || a.format.localeCompare(b.format)),
    ims: [...ims.values()].sort(sort),
    arrivals: [...arrivals.values()].sort(sort),
    // Dated inbound movements, so SSOF can log each as a clearance event on its real date.
    arrivalMovements,
    totals: { ims: imsTotal, arrivals: arrivalsTotal },
  };
  if (new URL(req.url).searchParams.get("format") === "csv") {
    const lines = ["section,month,week,flavour,format,quantity_mc"];
    // a quote inside a name is doubled; a format with a comma, quote or line break is quoted
    const cell = (v) => `"${String(v).replace(/"/g, '""')}"`, fmtCell = (v) => (/[",\r\n]/.test(String(v)) ? cell(v) : String(v));
    for (const l of body.ims) lines.push(`IMS,${l.month},,${cell(l.flavour)},${fmtCell(l.format)},${l.qty}`);
    for (const l of body.arrivals) lines.push(`ARRIVAL,${l.month},${l.week ?? ""},${cell(l.flavour)},${fmtCell(l.format)},${l.qty}`);
    return new Response(lines.join("\n") + "\n", { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
  }
  return json(body);
}

async function postSsof(env, req) {
  if (!(await feedAuthorized(env, req))) return json({ error: "feed key required" }, 401);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  if (body?.country !== "Syria" || !Array.isArray(body.skus) || body.skus.length > 1000) return json({ error: "expected { country: \"Syria\", skus: [...] }" }, 400);
  // Only the published SSOF app may set the list: a development workspace has its own database and ids.
  if (body.source !== "published") return json({ error: "only the published SSOF app may send the SKU list" }, 400);
  const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
  const clean = new Map();
  for (const raw of body.skus) {
    if (!raw || typeof raw !== "object") continue;
    const id = Number(raw.id), name = str(raw.name, 120), weight = str(raw.weight, 20);
    if (!Number.isInteger(id) || id <= 0 || !name || !weight) continue;
    const t = raw.tracker && typeof raw.tracker === "object" ? raw.tracker : null;
    const pt = raw.packagingType, flavour = str(t?.flavour, 60), format = str(t?.format, 10);
    clean.set(id, { id, name, weight, packagingType: pt === "Old" || pt === "New" ? pt : null, category: str(raw.category, 20), sortOrder: Number(raw.sortOrder) || 0, tracker: flavour && format ? { flavour, format } : null });
  }
  // An empty list would hide every SSOF product in the Entry tab: treat it as a mistake.
  if (!clean.size) return json({ error: "no usable SKUs in the list" }, 400);
  const row = await env.DB.prepare("SELECT json FROM docs WHERE path = ?").bind(SSOF_SKUS).first();
  let prev = [];
  try { const p = JSON.parse(row?.json ?? "{}"); if (Array.isArray(p?.skus)) prev = p.skus.filter((x) => x && typeof x === "object"); } catch { /* start again from an empty list */ }
  const before = new Map(prev.map((p) => [p.id, p]));
  const now = new Date().toISOString();
  const skus = [...clean.values()].map((s) => ({ ...s, active: true, firstSeen: before.get(s.id)?.firstSeen ?? now }));
  for (const p of prev) if (!clean.has(p.id)) skus.push({ ...p, active: false });
  await env.DB.prepare(UPSERT).bind(SSOF_SKUS, JSON.stringify({ country: "Syria", source: "published", receivedAt: now, skus }), now).run();
  return json({
    ok: true, active: clean.size, inactive: skus.length - clean.size,
    // seen for the first time and not a product the tracker already has: the Entry tab now offers these
    new: [...clean.values()].filter((s) => !before.has(s.id) && !s.tracker).map((s) => `${s.name} ${s.weight}`),
  });
}

const ROUTES = {
  "GET /api/state": getState,
  "POST /api/write": postWrite,
  "GET /api/ssof": getSsof,
  "POST /api/ssof": postSsof,
};
const SECURITY = { "x-content-type-options": "nosniff", "referrer-policy": "same-origin", "x-robots-tag": "noindex, nofollow" };

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/" || url.pathname === "/index.html") return Response.redirect(new URL("/tracker.html", url).toString(), 302);
    if (url.pathname.startsWith("/api/")) {
      const handler = ROUTES[`${req.method} ${url.pathname}`];
      if (!handler) return json({ error: "not found" }, url.pathname in { "/api/state": 1, "/api/write": 1, "/api/ssof": 1 } ? 405 : 404);
      try {
        const res = await handler(env, req);
        for (const [k, v] of Object.entries(SECURITY)) res.headers.set(k, v);
        return res;
      } catch (err) {
        console.error(err);
        return json({ error: "server error" }, 500);
      }
    }
    // Static files (the tracker page, the icon) are served before the Worker runs; anything else is not here.
    const asset = await env.ASSETS.fetch(req);
    if (asset.status !== 404) return asset;
    return new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", ...SECURITY } });
  },
};
