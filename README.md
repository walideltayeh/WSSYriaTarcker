# WS Tracker — Syria

Wholesaler stock counts and offtake tracking for a Lattakia warehouse.
Supervisors record the stock each wholesaler is holding; the app works out what
sold from those counts and the delivery ledger.

## How offtake is calculated

For one wholesaler and one product, between two consecutive counts:

    offtake = previous count + deliveries in between - the new count

The first count treats the previous stock as 0, so it reports offtake since that
product's first delivery. A negative result is flagged "Check" — a counting
mistake, or stock from a source the ledger does not show — and is left out of
the totals. From the offtake the app derives a daily rate, estimated stock
today, days of stock left and a suggested order.

**Every quantity is a mastercase (MC)** — deliveries, warehouse movements and
counts alike. Pack formats are 50g, 250g and Kg.

## What is in here

| Path | What it is |
|---|---|
| `app/ws-tracker.html` | The whole app: one page, no build step, English and Arabic with right-to-left layout |
| `site/shim.js` | Bridges the app's storage calls to the hosted API, and holds the access-code and owner-password prompts |
| `site/src/` | The hosted API: read the document store, write one document, with the two secrets checked server-side |
| `site/migrations/` | The database schema, and an example for the hashed secrets |
| `scripts/` | Workbook tooling: read an .xlsx without dependencies, build the ledger, rebuild a combined workbook, run the app locally |

## Running it locally

```
node scripts/harness.mjs      # serves the app at http://localhost:5175 with an in-memory store
```

The harness stands in for the hosted storage, so the app runs with no backend.

## Screens

- **Wholesalers** — who is due a stock count; each wholesaler's counts, offtake, suggested order and purchase history
- **Offtake** — per wholesaler, per format and per product, with market totals
- **Warehouse** — inbound movements, stock on hand and months of cover
- **Analysis** — two views. *Next orders*: for every wholesaler, when they last ordered, how often they order, a status (low stock, overdue, due, on track, lapsed) and a suggested next order by product, with a trial of every flavour they have never taken. *Sales*: sales per month by flavour, format, product or wholesaler, a month-by-month pivot and the wholesaler league
- **Data** — import the workbook, export to Excel, settings, merged wholesaler names

## Data and secrets

No ledger data, workbook or secret is committed here. The deployed app keeps its
data in its own database; secrets are stored only as SHA-256 hashes, set through
a migration you keep private.
