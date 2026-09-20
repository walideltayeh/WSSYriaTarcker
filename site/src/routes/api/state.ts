import { createFileRoute } from "@tanstack/react-router";
import { authorized, db } from "../../lib/ws.server";

export const Route = createFileRoute("/api/state")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        if (!(await authorized(request))) return Response.json({ error: "unauthorized" }, { status: 401 });
        const { results } = await db().prepare("SELECT path, json FROM docs").all<{ path: string; json: string }>();
        const docs: Record<string, unknown> = {};
        for (const row of results ?? []) {
          try { docs[row.path] = JSON.parse(row.json); } catch { /* skip a corrupt row rather than fail the page */ }
        }
        return Response.json({ docs }, { headers: { "cache-control": "no-store" } });
      },
    },
  },
});
