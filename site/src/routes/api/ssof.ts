import { createFileRoute } from "@tanstack/react-router";
import { db, feedAuthorized } from "../../lib/ws.server";

/**
 * Syria link with the SSOF planning system. Both directions use the feed key.
 *
 * GET  - the feed SSOF reads:
 *   IMS      = what wholesalers were sold (sales invoices)
 *   Arrivals = what came into the Lattakia warehouse
 *   Both are per flavour, per format, per month, in mastercases. Packs of the same
 *   product are one line: the Lebanon-warning pack is merged into its parent.
 *   Movements the accountant enters in the app count the same as the imported ledger.
 *
 * POST - SSOF sends its active Syria SKUs, so a SKU the ledger does not have yet can be
 *   entered in the Entry tab. Only a list marked source "published" is accepted (a
 *   development workspace has its own database). Kept in config/ssofSkus. A SKU SSOF stops listing stays
 *   there as inactive, because a movement may refer to it. A movement entered for such
 *   a SKU goes back to SSOF in the feed with its SSOF id (ssofSkuId).
 */
type Feed = { flavour: string; format: string; ssofSkuId?: number };
type Sku = { id: string; en: string; ar: string; feed?: Feed };
type Row = [number, string, string, string, string, number, number, string?];
type SsofSku = {
  id: number; name: string; weight: string; packagingType: "Old" | "New" | null; category: string; sortOrder: number;
  /** the tracker product this SKU already is, by SSOF's own mapping; null when the tracker has none */
  tracker: { flavour: string; format: string } | null;
  active: boolean; firstSeen: string;
};

const formatOf = (en: string) => (/(?:\b|\d)Kg\b|Kilo/i.test(en) ? "Kg" : /\b250g\b|\bKF\b/i.test(en) ? "250g" : "50g");
const flavourOf = (en: string) =>
  /Two Apple/i.test(en)
    ? (/Iced|Frosty/i.test(en) ? "Two Apples Frosty" : /Black|Blk/i.test(en) ? "Two Apples Black" : "Two Apples")
    : /Red/i.test(en) ? "Red"
    : /Grape & Mint/i.test(en) ? "Grape & Mint"
    : /Grape/i.test(en) ? "Grape"
    : /Love/i.test(en) ? "Love"
    : "Blueberry";
const feedOf = (sku: Sku): Feed => sku.feed ?? { flavour: flavourOf(sku.en), format: formatOf(sku.en) };
const SSOF_SKUS = "config/ssofSkus";

export const Route = createFileRoute("/api/ssof")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await feedAuthorized(request))) return Response.json({ error: "feed key required" }, { status: 401 });
        const { results } = await db().prepare("SELECT path, json FROM docs WHERE path LIKE 'ledger/%' OR path LIKE 'moves/%' OR path = 'config/ssofSkus'").all<{ path: string; json: string }>();
        const docs = new Map<string, any>();
        for (const r of results ?? []) { try { docs.set(r.path, JSON.parse(r.json)); } catch { /* a corrupt row is skipped, not fatal */ } }
        const meta = docs.get("ledger/meta");
        if (!meta?.skus) return Response.json({ error: "no ledger yet" }, { status: 503 });
        const skus: Sku[] = [...meta.skus];
        const sent: SsofSku[] = Array.isArray(docs.get(SSOF_SKUS)?.skus) ? docs.get(SSOF_SKUS).skus : [];

        const rows: Row[] = [];
        for (let i = 0; i < (meta.chunks || 1); i += 1) for (const r of docs.get("ledger/rows-" + i)?.rows ?? []) rows.push(r as Row);
        const byId = new Map(skus.map((s, i) => [s.id, i]));
        // A movement entered for a SKU that came from SSOF ("ssof-<id>") is not in the ledger's product list.
        const indexOf = (id: unknown): number | undefined => {
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

        type Line = { flavour: string; format: string; month: string; week?: number; qty: number; ssofSkuId?: number };
        // Arrivals carry the week of the month (1-4) because SSOF books them into weekly buckets.
        const weekOf = (date: string) => Math.min(4, Math.floor((Number(date.slice(8, 10)) - 1) / 7) + 1);
        const put = (map: Map<string, Line>, fd: Feed, month: string, qty: number, week?: number) => {
          const k = `${fd.flavour}|${fd.format}|${fd.ssofSkuId ?? ""}|${month}|${week ?? 0}`;
          const cur = map.get(k) ?? { flavour: fd.flavour, format: fd.format, month, qty: 0, ...(week ? { week } : {}), ...(fd.ssofSkuId ? { ssofSkuId: fd.ssofSkuId } : {}) };
          cur.qty += qty; map.set(k, cur);
        };
        const ims = new Map<string, Line>(), arrivals = new Map<string, Line>();
        const products = new Map<string, { flavour: string; format: string; ssofSkuId?: number; trackerProducts: string[] }>();
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
        const sort = (a: Line, b: Line) => a.month.localeCompare(b.month) || (a.week ?? 0) - (b.week ?? 0) || a.flavour.localeCompare(b.flavour) || a.format.localeCompare(b.format);
        const body = {
          country: "Syria", countryCode: "SY", unit: "MC", source: "WS Tracker",
          generatedAt: new Date().toISOString(),
          period: { from: first.slice(0, 7), to: last.slice(0, 7), firstMovement: first, lastMovement: last },
          note: "Quantities are mastercases. One line per flavour and format; the Lebanon-warning pack is merged into its parent product. IMS lines are monthly; arrival lines also carry the week of the month (1-4). A line with ssofSkuId is a SKU SSOF sent to the tracker: match it by that id.",
          products: [...products.values()].sort((a, b) => a.flavour.localeCompare(b.flavour) || a.format.localeCompare(b.format)),
          ims: [...ims.values()].sort(sort),
          arrivals: [...arrivals.values()].sort(sort),
          // Dated inbound movements, so SSOF can log each as a clearance event on its real date.
          arrivalMovements: (() => {
            const m = new Map<string, { date: string; flavour: string; format: string; qty: number; ssofSkuId?: number }>();
            for (const r of rows) {
              const inb = Number(r[5]) || 0; if (!inb) continue;
              const sku = skus[r[0]]; if (!sku || !r[1]) continue;
              const date = String(r[1]), fd = feedOf(sku);
              const k = `${date}|${fd.flavour}|${fd.format}|${fd.ssofSkuId ?? ""}`;
              const cur = m.get(k) ?? { date, flavour: fd.flavour, format: fd.format, qty: 0, ...(fd.ssofSkuId ? { ssofSkuId: fd.ssofSkuId } : {}) };
              cur.qty += inb; m.set(k, cur);
            }
            return [...m.values()].sort((a, b) => a.date.localeCompare(b.date) || a.flavour.localeCompare(b.flavour) || a.format.localeCompare(b.format));
          })(),
          totals: { ims: imsTotal, arrivals: arrivalsTotal },
        };
        const url = new URL(request.url);
        if (url.searchParams.get("format") === "csv") {
          const lines = ["section,month,week,flavour,format,quantity_mc"];
          for (const l of body.ims) lines.push(`IMS,${l.month},,"${l.flavour}",${l.format},${l.qty}`);
          for (const l of body.arrivals) lines.push(`ARRIVAL,${l.month},${l.week ?? ""},"${l.flavour}",${l.format},${l.qty}`);
          return new Response(lines.join("\n") + "\n", { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
        }
        return Response.json(body, { headers: { "cache-control": "no-store" } });
      },

      POST: async ({ request }) => {
        if (!(await feedAuthorized(request))) return Response.json({ error: "feed key required" }, { status: 401 });
        let body: { country?: unknown; skus?: unknown; source?: unknown };
        try { body = await request.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
        if (body?.country !== "Syria" || !Array.isArray(body.skus) || body.skus.length > 1000) {
          return Response.json({ error: "expected { country: \"Syria\", skus: [...] }" }, { status: 400 });
        }
        // Only the published SSOF app may set the list: a development workspace has its own database and ids.
        if (body.source !== "published") return Response.json({ error: "only the published SSOF app may send the SKU list" }, { status: 400 });
        const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
        const clean = new Map<number, Omit<SsofSku, "active" | "firstSeen">>();
        for (const raw of body.skus as Record<string, unknown>[]) {
          if (!raw || typeof raw !== "object") continue;
          const id = Number(raw.id), name = str(raw.name, 120), weight = str(raw.weight, 20);
          if (!Number.isInteger(id) || id <= 0 || !name || !weight) continue;
          const t = raw.tracker && typeof raw.tracker === "object" ? (raw.tracker as Record<string, unknown>) : null;
          const pt = raw.packagingType;
          const flavour = str(t?.flavour, 60), format = str(t?.format, 10);
          clean.set(id, {
            id, name, weight,
            packagingType: pt === "Old" || pt === "New" ? pt : null,
            category: str(raw.category, 20), sortOrder: Number(raw.sortOrder) || 0,
            tracker: flavour && format ? { flavour, format } : null,
          });
        }
        // An empty list would hide every SSOF product in the Entry tab: treat it as a mistake.
        if (!clean.size) return Response.json({ error: "no usable SKUs in the list" }, { status: 400 });

        const row = await db().prepare("SELECT json FROM docs WHERE path = ?").bind(SSOF_SKUS).first<{ json: string }>();
        let prev: SsofSku[] = [];
        try { const p = JSON.parse(row?.json ?? "{}"); if (Array.isArray(p?.skus)) prev = p.skus; } catch { /* start again from an empty list */ }
        const before = new Map(prev.map((p) => [p.id, p]));
        const now = new Date().toISOString();
        const skus: SsofSku[] = [...clean.values()].map((s) => ({ ...s, active: true, firstSeen: before.get(s.id)?.firstSeen ?? now }));
        for (const p of prev) if (!clean.has(p.id)) skus.push({ ...p, active: false });
        await db().prepare("INSERT INTO docs (path, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
          .bind(SSOF_SKUS, JSON.stringify({ country: "Syria", receivedAt: now, skus }), now).run();
        return Response.json({
          ok: true, active: clean.size, inactive: skus.length - clean.size,
          // seen for the first time and not a product the tracker already has: the Entry tab now offers these
          new: [...clean.values()].filter((s) => !before.has(s.id) && !s.tracker).map((s) => `${s.name} ${s.weight}`),
        });
      },
    },
  },
});
