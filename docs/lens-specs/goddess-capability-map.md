# Goddess Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("goddess"' server/domains/goddess.js
```
→ **8** macros in `server/domains/goddess.js` (378 lines): `detail`,
`archive`, `react`, `reactions`, `subscribe`, `unsubscribe`, `subscriptions`,
`correlate`. Plus **2** more registered inline in `server.js`
(`grep -n 'register("goddess"' server/server.js`, lines ~76601/76610):
`compose_now`, `recent` — both delegate to `server/lib/goddess-broadcaster.js`.

`node scripts/lens-unsurfaced.mjs --lens goddess` → `0/10 macros never
referenced in the frontend`. Verified genuinely true this time (unlike some
other lenses in this wave, no dead-wired button was hiding behind that
number) — every one of the 10 has a real call site with a matching data
shape, confirmed by reading all 4 components + the page.

## What "Concordia Speaks" is

The goddess (Concordia) is the platform's in-world deity/narrative voice. A
"dispatch" is composed from three **real** signals — a world's
`ecosystem_score`, its refusal-field `strength` (base-6 glyph algebra per
CLAUDE.md's Refusal Field invariant), and (as of this pass) the most recent
alert/critical entry from Layer 12's system-wide reasoning-drift monitor —
and rendered through a deterministic template (`composeDispatch` in
`lib/goddess-broadcaster.js`), never an LLM call. This is intentional and
documented in the file's own header comment ("reads ecosystem_score +
refusal-field strength + most-recent drift-alert and produces a tone +
prose dispatch"), and is the correct honest design for an always-on ambient
feed — no brain dependency, no hallucination risk, tone selection is a pure
function of `ecosystemScore` via `pickTone`. This is genuine narrative-
bridge-adjacent content, not decorative filler: distinct from (and much
simpler than) the LLM-backed NPC dialogue / oracle-brain quest generation
elsewhere in Concordia, by design — the goddess speaks in short, deterministic
liturgical fragments, not conversational LLM prose.

## Reference app

No direct commercial analog (a deity ambient-broadcast feed is Concord-
specific worldbuilding). Nearest structural references: a status-page
incident feed (chronological, tone/severity-coded, permalink + correlation
to the underlying event) crossed with a devotional/journaling app's "reflect
on this" interaction (commune/react + notes). The design already reads that
way — parity target was "does every real capability the backend offers
(search, permalink, correlate-to-cause, subscribe-and-notify, react) have a
designed surface," which was already true before this pass.

## Classification (before this pass)

**Frontend: already fully real, zero defects found.** All 4 components
(`GoddessGallery.tsx`, `DispatchDetail.tsx`, `DispatchArchive.tsx`,
`ToneSubscriptions.tsx`) plus `page.tsx` were read in full:
- Feed tab: real `goddess.recent` poll (60s), tone filter, honest error
  state (never silently collapses a fetch failure into an empty state — the
  page's own comment calls this out explicitly), permalink drill-in.
- Archive tab: real `goddess.archive` full-text + tone + date-range search,
  real tone-distribution chart from `toneCounts`.
- Alerts tab: real `goddess.subscribe`/`unsubscribe`/`subscriptions` with
  fire-once notifications.
- Detail view: real `goddess.detail` + `goddess.correlate` +
  `goddess.react`/`reactions` — prev/next permalink nav, world-event
  correlation, commune reactions with per-user "mine" highlighting.
- `GoddessGallery` (real-world mythology reference panel): genuine Wikipedia
  REST API pull, honestly labeled, `SaveAsDtuButton` wired to real fetched
  data.

**Backend: two real defects found and fixed**, both in the
`compose_now`/`recent` content-generation path that domains/goddess.js's
interactive surface sits on top of — the interactive macros were fine, but
the underlying dispatch generator had never been exercised end-to-end in a
running deployment:

1. **Dead code — `driftKind` hardcoded to `null` forever.**
   `composeAndRecord` (`server/lib/goddess-broadcaster.js:88`) declared
   `let driftKind = null;` and never reassigned it before calling
   `composeDispatch`, despite `composeDispatch` having a full `if
   (driftKind)` branch with prose for all 6 drift types (`goodhart`,
   `memetic_drift`, `capability_creep`, `self_reference`, `echo_chamber`,
   `metric_divergence`) and the file's own header comment promising
   "...and most-recent drift-alert...". No dispatch ever composed through
   the real `compose_now`/heartbeat path could reach that branch — only the
   test suite's direct `composeDispatch({ driftKind: "goodhart" })` calls
   exercised it. **Fixed:** `composeAndRecord` now calls
   `emergent/drift-monitor.js#getDriftAlerts(STATE, { severity: ["alert",
   "critical"], limit: 1 })` and passes the most recent alert's `type`
   through. Pinned by 2 new tests in `server/tests/goddess-lens-macros.test.js`
   ("composeAndRecord wires the real drift-alert signal").

2. **Unsurfaced macro with zero callers — `compose_now` had no heartbeat
   and no frontend caller anywhere.** `grep -rn 'runMacro("goddess"'
   server/` (excluding the registration itself) and `grep -rn "compose_now"
   concord-frontend/` both returned empty. Meanwhile `page.tsx`'s own header
   claims dispatches are "composed hourly from world ecosystem score,
   refusal-field strength, and drift events" — an automatic cadence that
   did not exist anywhere in the codebase. In any real deployment,
   `goddess_dispatches` would stay **permanently empty** and the lens would
   read "The goddess has not yet spoken in this world." forever — a
   textbook honesty-copy overclaim (an automatic feature that was actually
   unreachable). **Fixed:** new heartbeat `server/emergent/goddess-broadcast-
   cycle.js` (`runGoddessBroadcastCycle`, registered at `server.js` next to
   `season-cycle`, frequency 240 ≈ 1h at the 15s tick — matching the
   frontend's own "hourly" claim, now made true instead of relabeled),
   walking active worlds (`worlds` table, capped 50, same fallback pattern
   as `season-cycle.js`) and calling `composeAndRecord` once per world per
   pass. Kill-switch `CONCORD_GODDESS_BROADCAST=0`. Pinned by 4 tests in
   the new `server/tests/goddess-broadcast-cycle.test.js` (composes one
   dispatch per world, degrades gracefully with no db/no worlds table,
   respects the kill-switch, isolates a per-world compose failure without
   throwing).

3. **Companion honesty fix — `composeAndRecord` always returned `ok:true`
   even when the DB write failed.** `recordDispatch`'s `{ok:false, error}`
   return was silently discarded (line: `recordDispatch(db, worldId,
   dispatch, {...});` with no use of the result). A write failure (e.g. a
   missing table on a not-yet-migrated DB) would report success while
   nothing was persisted. **Fixed:** `composeAndRecord` now propagates
   `recordDispatch`'s outcome (`{ ok: false, reason: "write_failed", error,
   dispatch }` on failure), so the new heartbeat's `composed` count is
   honest. Covered by the same new test file.

## What changed

- **`server/lib/goddess-broadcaster.js`** — wired the real drift-alert
  signal into `composeAndRecord` (defect 1); propagate `recordDispatch`'s
  write outcome instead of discarding it (defect 3).
- **`server/emergent/goddess-broadcast-cycle.js` (new)** — the heartbeat
  that makes the "composed hourly" claim true (defect 2).
- **`server/server.js`** — registers the new heartbeat next to
  `land-claims-cycle`/`season-cycle`.
- **`server/tests/goddess-lens-macros.test.js`** — 2 new tests for the
  drift-alert wiring.
- **`server/tests/goddess-broadcast-cycle.test.js` (new)** — 4 tests for
  the heartbeat.
- **No frontend files changed** — the frontend was already fully real; the
  gap was entirely in an unreachable backend generation path underneath it.

## Left alone, with reason

- **All 4 frontend components + `page.tsx`** — no defect found on full
  read; every macro call site matches the backend's real shape, every empty
  state is honest, no fabricated data anywhere.
- **`GoddessGallery`'s Wikipedia mythology panel** — a deliberately
  separate, honestly-labeled real-world reference feature (not a Concordia
  narrative claim), no change needed.
