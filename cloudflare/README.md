# WS Tracker Syria on Cloudflare

One Cloudflare Worker (`src/worker.js`) serves the tracker page (`public/tracker.html`) and three data endpoints over
one D1 database (`docs` = every record, `meta` = SHA-256 hashes of the access code and passwords).

| Endpoint | Needs |
|---|---|
| `GET /api/state` | access code (`x-ws-code`) |
| `POST /api/write` | access code; `ledger/*` also the owner password (`x-ws-admin`); `moves/*` also the entry password (`x-ws-entry`) |
| `GET /api/ssof`, `POST /api/ssof` | SSOF feed key (`x-ssof-key` or `?key=`) |

## Run locally

```
npm install
npx wrangler d1 migrations apply DB --local
node make-import.mjs <state-export.json> import/docs.sql
npx wrangler d1 execute DB --local --file import/docs.sql
npx wrangler d1 execute DB --local --file local-test/meta.sql   # test codes only, never --remote
npx wrangler dev --local
```

## Go live (owner's account)

1. Owner: create the Cloudflare account, open Workers & Pages once and pick the workers.dev subdomain, then run
   `npx wrangler login` on this PC.
2. `npx wrangler d1 create ws-tracker --binding DB --location eeur` (fills in the DB entry in `wrangler.jsonc`; check there is exactly one).
3. `npx wrangler d1 migrations apply DB --remote`
4. Export the current data, then `node make-import.mjs export.json import/docs.sql` and
   `npx wrangler d1 execute DB --remote --file import/docs.sql`.
5. `npx wrangler d1 execute DB --remote --file secrets/prod-meta.sql` (hashes copied from the old database; never committed).
6. `npx wrangler deploy`
7. Check: the page opens with the usual access code; `/api/state` returns the same records as the old site.

## Switch over

- Tell the team the new address; stop using the old one.
- Copy any record written on the old site after step 4 (compare both `/api/state` exports).
- In SSOF (Replit secrets), set `WS_TRACKER_FEED_URL` to `https://<new address>/api/ssof`. The feed key stays the same.

`secrets/`, `import/` and `.wrangler/` are never committed.
