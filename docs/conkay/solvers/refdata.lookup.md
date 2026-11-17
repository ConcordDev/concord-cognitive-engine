# refdata.lookup — reference-data lookup with literal re-find (SX-XC-03)

The solver-facing consumer of the SXE-41 reference-data store.
Code: `server/lib/conkay/physics/solvers/refdata-lookup.js`
(registry solver, L1).

## Model

A value is accepted only when a matcher re-finds it at the locator.
The caller names a record — by store id or by sourceUrl — and the
literal it expects the source to contain. The lookup runs the
store's literal re-find over the record's stored content:

- literal found → PASS: `{found, occurrences, value, sha256,
  sourceUrl, licence, retrievedAt, retrievedVia, provenance}` — the
  value rides with the record's provenance, always.
- literal absent → **NOT_COMPUTED** `refdata_value_not_found` —
  a forged value at a real locator is rejected, never served
  (the reference case).
- record absent → **NOT_COMPUTED** `refdata_not_found:<id-or-url>`.
- no record named, or no literal → **NOT_COMPUTED**
  `missing_input:<field>` (SC-03: nothing is assumed).

## Inputs / units

`{recordId}` or `{sourceUrl}`, plus `{literal}` (string). No
dimensional inputs; outputs are the re-find verdict and provenance
fields above. Target: `value`.

## Envelope (validity)

Sourced records only — what the SXE-41 store holds, nothing else.
Every record in the store carries provenance by construction
(SXE-41 refuses a put without sourceUrl and licence), so no served
value can lack a citation. The catalogue template's
engine-unavailable leg maps here to record absence: this tier is
in-process, and an absent record is the honest NOT_COMPUTED.

## Reference + locator

All sources in SXE-41: the store's provenance records are the
citations. The DC-01 checker flow runs through this solver: the
checker names the cited sourceUrl and the value literal from the
solver declaration under review; PASS with matching provenance is
the re-find evidence, NOT_COMPUTED is the rejection.

## Replay

Walker: seed a record (SXE-41) whose content contains a cited
value, then `conkay_solve` refdata.lookup with that literal →
PASS + provenance; with an altered literal → NOT_COMPUTED
`refdata_value_not_found`. Reachability via solve.direct rides
SC-00 (named foundation); the MCP/chain paths reach the registry
entry as registered.
