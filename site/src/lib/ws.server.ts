import { bindings } from "./bindings.server";

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function db() {
  const d = bindings().DB;
  if (!d) throw new Error("database binding missing");
  return d;
}

function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/** Secrets live in the meta table as hashes; the plain values are never stored. */
async function matches(key: string, value: string): Promise<boolean> {
  if (!value) return false;
  const row = await db().prepare("SELECT value FROM meta WHERE key = ?").bind(key).first<{ value: string }>();
  if (!row?.value) return false;
  return sameHash(await sha256Hex(value), row.value);
}

/** The shared access code every user types once to open the app. */
export const authorized = (request: Request) => matches("access_hash", request.headers.get("x-ws-code") ?? "");

/** The owner's password, required on top of the access code to replace the ledger. */
export const adminAuthorized = (request: Request) => matches("admin_hash", request.headers.get("x-ws-admin") ?? "");

const PATH = new RegExp("^[A-Za-z0-9_.~:@+-]+(/[A-Za-z0-9_.~:@+-]+)+$");
export const validPath = (p: unknown): p is string => typeof p === "string" && p.length <= 200 && PATH.test(p);

/** The accountant's password, required to save a movement. */
export const entryAuthorized = (request: Request) => matches("entry_hash", request.headers.get("x-ws-entry") ?? "");

/** Movements the accountant enters live here. */
export const isMovePath = (p: string) => p.startsWith("moves/");

/** Ledger documents hold the imported workbook: owner-only. */
export const isLedgerPath = (p: string) => p === "ledger" || p.startsWith("ledger/");
