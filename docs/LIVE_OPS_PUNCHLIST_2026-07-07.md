# Live Ops / UX Punch List — 2026-07-07

Captured during A40 deploy triage + a UX walkthrough. Not prioritized, not all
investigated in depth — this is a faithful record of what was found/reported,
for a later pass to work through. Status notes are added only where this
session already dug in; everything else is "open, needs triage."

---

## A. Infra / performance (found during live A40 diagnosis)

1. **Heartbeat/tick CPU contention.** Ticks running too frequently and too
   concurrently for a 9-vCPU box, blocking the event loop. Measured on the
   live box: `event_loop_lag_spike` up to 3060ms. Root cause: `CONCORD_HEARTBEAT_MS`
   defaults to 5000ms (clamped up to a 15s floor), tuned for the *recommended*
   16+ vCPU spec, not this box. **Fix identified, not yet applied**: raise
   `CONCORD_HEARTBEAT_MS` (e.g. 30000+) in `.env`.
2. **Rate limits too tight for real usage.** `server/rateLimit.js`:
   `write.lens` shares one 10/min bucket across every lens's write action
   (all funnel through `POST /api/lens/run`); `read.default` (120/min) is
   easily exhausted by polling HUD components (some poll every 1-2s). This is
   the direct cause of "too many requests" appearing across the site.
   **Fix identified, not yet applied**: raise both limits.
3. **"Connection lost / showing cached data" banner false-positives.**
   `components/common/ConnectionStatus.tsx` — 5s client-side timeout against
   `/api/brain/health`, which itself can legitimately take up to ~8s (5 parallel
   Ollama probes, each with its own 8s timeout) even without tick contention.
   Same root cause as #1 — event-loop blocking during heavy ticks pushes this
   over the edge. Note: the `stale`/`X-Concord-Stale` branch of that banner is
   dead code — the header is never set server-side, so only the harsher
   "Connection lost" message can ever fire.
4. **502 errors across multiple endpoints simultaneously** (forum, auth,
   dtus, events all failing at once) — means the whole `concord-backend`
   process was unreachable, not a per-route bug. Very likely the same tick/CPU
   root cause tipping into a full outage under load, but not confirmed —
   needs `pm2 status` / `pm2 logs concord-backend` captured live next time it
   happens to tell crash-loop vs. unresponsive-but-alive apart.
5. **DataCloneError crash.** `[FATAL] Unhandled promise rejection` from a
   `DOMException [DataCloneError]` — an HTTP-triggered call to a heavy-domain
   macro (routed through `workers/macro-pool.js`) is carrying a non-cloneable
   function inside its `input` payload into a `postMessage` call. Confirmed
   `actorInfo` (userId/role/scopes) is clean, so the function is coming in via
   the macro's actual `input`. Exact call site not yet found — need the
   domain/macro name from the next occurrence's log to trace it.
6. **Lattice-audit "object is not iterable" — FIXED.** Two unguarded
   `dtu.lineage || []` / `dtu.core?.claims || []` iterations in
   `server/emergent/index.js` didn't protect against a non-array truthy value
   (only falsy values get replaced by `||`). Hardened to
   `Array.isArray(x) ? x : []`. Committed (`dc88df0f`) and pushed to
   `claude/main-age-fix-issues-x1a1y5`.
7. **`concord-tunnel` PM2 process appears dead** — `pid 0`, blank status
   column, 0 uptime/restarts, while backend/frontend show `online`.
   Unconfirmed whether it's supposed to be running.
8. **`top`/`free` inside the container report host-level stats** (515GB
   total RAM seen vs. the ~50GB actually allocated to the pod) — likely a
   multi-tenant RunPod host exposing raw `/proc/meminfo`, not a cgroup-scoped
   view. Don't use raw `top` output for capacity planning on this box; check
   the cgroup limits directly (`/sys/fs/cgroup/memory.max` etc.).

## B. New hard requirement: tick/interval spacing

9. **Every timer/interval/tick in the codebase (beyond simple env-var-driven
   ones) must be at least 4 minutes apart from every other one, and no two
   may ever fire concurrently — no simultaneous ticks, ever.** Applies to the
   heartbeat registry's per-module frequencies *and* any other ad-hoc
   `setInterval`/`setTimeout`-driven periodic work across the codebase, not
   just the main governor tick. Needs a full audit of every periodic-work
   site, not just `server/emergent/heartbeat-registry.js`.

## C. UX / navigation

10. Dashboard "Create DTU" jumps straight into Concord Studio with no
    context — confusing entry point.
11. Concord Studio is barely usable.

## D. Lens architecture (structural)

12. The shared lens shell/shape suppresses per-lens functionality, causes UI
    overlaps, and prevents each lens's actual feature set from surfacing.
13. Buttons/actions are "slapped in with no context, just under the
    compute" — no real information architecture per lens.
14. Design philosophy correction: lenses are supposed to be full apps, not
    lightweight shared surfaces. The lightweight-surface discipline is the
    root cause of the clutter — reject it. No fake/half-finished UI, given
    the underlying macros already exist and are real.
15. Proposal on the table: consolidate the 260+ individual lightweight lenses
    into ~20 focused full apps, each absorbing the relevant lenses' actual
    functionality. Note: there's a partial precedent already in the codebase
    — the "~25 concentrated Destinations" nav layer (`lib/destinations.ts`,
    `DestinationNav`) — but that's currently just a navigation layer on top of
    still-lightweight lenses, not a real absorption/rebuild. This proposal is
    the deeper version.

## E. Per-lens bugs

16. Art lens — actions/buttons dead, unusable.
17. Council lens — doesn't let you do anything.
18. Podcast lens — needs a refactor.
19. Feed lens — cluttered, overlays block content.
20. "Unknown macros" / unlabeled buttons appearing on every lens, and
    specifically called out on "visuals" too.
21. Many lenses won't load at all.
22. Concordia (world lens) doesn't load.
23. Character creation screen has no real 3D assets — renders as a flat 2D
    polygon instead.

## F. Confirmed working (no action needed)

24. GitHub repo links load correctly (real repos load).

## G. Content: seeded DTUs taking a real-world stance

25. `server/dtus.js:49438` — `dtu_486_post_god_era_transition`. An
    authored/seeded DTU claiming "divine hypotheses become unnecessary" —
    reads as the platform itself taking a real-world religious stance.
    Flagged for removal.
26. `server/data/seed/dtus-part7.json`, `dtus-part8.json`,
    `dtus-unassigned.json` — hit by the same keyword scan (god/divine/
    deity/religion/etc.); content not yet individually reviewed. Needs a full
    pass to catch anything else in the same vein.
27. **Distinction to preserve when this gets worked on**: the "goddess"/deity
    references in `content/world/*` (factions.json, npcs.json, lore.json
    across fantasy/tunya/concordia-hub/etc.) are fictional in-game lore for
    the Concordia world simulator (e.g. the Concordia goddess NPC dialogue
    system) — not real-world claims. These should **not** be swept into the
    cleanup above by mistake.
