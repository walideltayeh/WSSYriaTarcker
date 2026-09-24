import { createFileRoute } from "@tanstack/react-router";
import { adminAuthorized, authorized, db, entryAuthorized, isLedgerPath, isMovePath, validPath } from "../../lib/ws.server";

export const Route = createFileRoute("/api/write")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!(await authorized(request))) return Response.json({ error: "unauthorized" }, { status: 401 });
        let body: { op?: string; path?: unknown; data?: unknown };
        try { body = await request.json(); } catch { return Response.json({ error: "bad json" }, { status: 400 }); }
        if (!validPath(body.path)) return Response.json({ error: "bad path" }, { status: 400 });
        const path = body.path;
        if (isLedgerPath(path) && !(await adminAuthorized(request))) {
          return Response.json({ error: "admin password required" }, { status: 403 });
        }
        if (isMovePath(path) && !(await entryAuthorized(request))) {
          return Response.json({ error: "entry password required" }, { status: 403 });
        }
        if (body.op === "delete") {
          await db().prepare("DELETE FROM docs WHERE path = ?").bind(path).run();
          return Response.json({ ok: true });
        }
        if (body.op !== "set" || typeof body.data !== "object" || body.data === null || Array.isArray(body.data)) {
          return Response.json({ error: "bad op" }, { status: 400 });
        }
        const json = JSON.stringify(body.data);
        if (json.length > 900000) return Response.json({ error: "too large" }, { status: 413 });
        await db().prepare("INSERT INTO docs (path, json, updated_at) VALUES (?, ?, ?) ON CONFLICT(path) DO UPDATE SET json = excluded.json, updated_at = excluded.updated_at")
          .bind(path, json, new Date().toISOString()).run();
        return Response.json({ ok: true });
      },
    },
  },
});
