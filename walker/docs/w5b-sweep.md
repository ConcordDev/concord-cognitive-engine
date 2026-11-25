# ULW v3 W5b — ownership + private-broadcast sweep (GB-1576)

**Live leg:** `checks.LensWalk._broadcast_leg`, run from `trust_phase` · **Offline scan:** `concord_walker/ownerscan.py` + `walker.py owner-scan` · **Ranked list:** `walker/analysis/owner-scan-21303b4672.jsonl` (514 candidates at the deployed build) · **Selftest:** `selftest/test_w5b_sweep.py`

## The private-broadcast detector (live)

The trust probes (GB-1575 scope addition) extended the foreign-account
probe from reads to writes. This leg extends it to the third channel:
the socket. Wherever the isolation phase runs, the foreign context opens
the lens with a websocket frame capture armed (the WALK-04c
`FrameCapture` machinery), and the owner performs a private write on its
own labelled fixture with the run's unique fixture marker placed in a
text field. If that marker arrives in the foreign context's frames, the
lens broadcast private content to a non-owner: a LEAK, filed through the
standing ownership machinery at high severity. Verdicts mirror the trust
discipline: CLEAN when frames flowed and none carried the marker,
NO_FRAMES when no socket traffic was observed (inconclusive, named,
never a pass), SKIPPED with a named reason when there is no live
labelled fixture or no recorded owner write that can carry the marker.
The act is restored by re-issuing the owner's original recorded call.
The leg's outcome joins the per-lens `trust` block as its third leg.

## The offline scan

`owner-scan --from-repo <checkout>` walks a server tree (node_modules
and test files skipped — tests emit and look up by design and are not
shipped behaviour) and files a ranked file:line JSONL list of
candidates for human confirmation — a census in the W1 study's
section-3 form, never a verdict:

- **id_lookup_no_owner_check** — a request-supplied id (`req.params` /
  `req.body` / `req.query`, or a variable destructured from them)
  reaches an object lookup (`getDTU`, `*ById`, a store/DB `.get`,
  `findOne`) inside a route handler whose span shows no ownership
  comparison (no owner/creator/author/userId equality check against
  the session actor, no assert/require-owner helper). The X-05 shape:
  identity correct, ownership absent.
- **global_emit_private_payload** — a global socket emit (an `.emit(`
  not scoped by `.to(room)` and not a single-connection `socket.emit`)
  or a push onto a global event log, whose payload is data-shaped (a
  variable or object), not a constant: a private event reaching every
  listener or the global log.

Ranking is deterministic: signals add score (write-verb route +20,
result returned to the response +15, id sourced from the body +10,
private-shaped event name +15), ties break by file then line.

At the deployed build 21303b4672 the scan files **514 candidates**
(407 id-lookup, 107 global-emit/log). The top of the list is the shape
the sweep exists for, verified by hand at filing: `POST
/api/marketplace/listings/:id/assets` (durable.js:328) loads any
listing by id and attaches a caller-supplied artifact with no ownership
comparison anywhere in the handler — it reads `listing.owner_user_id`
for its log line and never checks it against the caller.

## Limits

- The scan is line/window heuristics: an ownership check expressed
  through a helper this scan's patterns do not recognise reads as
  absent, and a lookup whose id is sanitised upstream still lists.
  Every row is a candidate for human confirmation, in rank order —
  that is the deliverable's contract, not a defect list.
- Handler spans are route-registration windows (capped); a check in a
  shared middleware ahead of the route is outside the window and will
  not clear a row. Middleware-level ownership, where it exists, is the
  first thing a confirming human checks.
- The broadcast leg sees only what the walk's own session does: a lens
  whose private events fire on actions the walk never performs reads
  NO_FRAMES or CLEAN on the traffic it did generate, not a proof of
  socket hygiene.
