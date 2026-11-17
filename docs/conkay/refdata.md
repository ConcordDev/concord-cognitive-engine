# ConKay reference-data store (SXE-41)

Solvers sign results against cited free public references (DC-01). This
store is where those references live once fetched, so a checker agent
can re-pull the record and verify — literally — that the source
contains the value it is cited for.

Code: `server/lib/conkay/refdata/` (`store.js`, `index.js`).

## Guarantees

- **Provenance records.** Every record carries its source URL, its
  licence (per-source free public licences only), the retrieval time
  and route, and the SHA-256 + byte count of the stored content. A
  `put` without a source URL or a licence is refused
  (`refdata_provenance_missing:*`) — a datum without provenance is
  exactly what this store exists to prevent.
- **Literal re-find.** `refind(id, literal)` counts literal occurrences
  of the cited value in the stored bytes. Zero occurrences means the
  citation does not support the value, whatever the solver claims.
- **SSRF-guarded on-demand fetch.** `fetchAndStore` accepts http/https
  only, refuses credentials-in-URL, resolves the host and requires
  *every* resolved address to be a public IP (private, loopback,
  link-local, multicast, and documentation ranges are refused),
  re-guards every redirect hop (max 3), and caps response size
  (5 MB default) and time (10 s default). Refusals happen before any
  fetch to a blocked target.
- **Disk budget.** Default 512 MB (`CONKAY_REFDATA_BUDGET_BYTES`). A
  write that would exceed the budget is refused with
  `refdata_budget_exceeded`; provenance records are never silently
  evicted.

## Shape

Records are content-addressed: the id derives from the source URL +
content hash, so storing the same source twice is one record. On disk
each record is `<id>.json` (the provenance record) + `<id>.content`
(the exact bytes), under `CONKAY_REFDATA_DIR` (default
`server/data/conkay-refdata/`).

Consumers: SX-XC-03 (`refdata.lookup`) serves solver-facing lookups
from this store; the DC-01 checker flow re-pulls the cited source,
recomputes, and uses `refind` to confirm the value is literally there
before any declaration signs.
