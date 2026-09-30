# Parallel work — frontend (Grok) + backend concurrency (Claude), Sept 2026

Point-in-time coordination doc. Two agents working the same repo at once:

| Stream | Owner | Scope | Tracking doc |
|---|---|---|---|
| **Lens de-stacking** | Grok | `concord-frontend/` only | `docs/LENS_CONSOLIDATION_PLAYBOOK.md`, `audit/lens-stacking-report.md` |
| **Concurrency ceiling** | Claude | `server/` only | `docs/CONCURRENCY_CEILING_AUDIT.md`, `docs/CONCURRENCY_STATE_AUDIT.md` |

## Why this is safe to run in parallel

**The file surfaces do not overlap.**
- Grok touches: `concord-frontend/app/lenses/<lens>/page.tsx`, new
  `concord-frontend/components/<lens>/*.tsx`, `concord-frontend/` vitest.
- Claude touches: `server/server.js`, `server/lib/*`, `server/emergent/*`,
  `server/tests/*`, `engines/concord-*sidecar/`, `ecosystem.config.cjs`.
- Neither touches the other's tree.

**The API contract is stable across the backend work.** The concurrency fixes
make macros *faster*, not *different*:
- `userVisibleDTUs()` / `dtusArray()` are `server.js`-internal — **zero
  frontend references** (verified). `dtu.list` / `dtu.stats` / `goals.list`
  return the same shape, just sooner.
- Heartbeat-in-its-own-process and the read-replica change *where* code runs,
  not *what* `POST /api/lens/run` returns.
- A consolidated lens that still calls the same `(domain, macro)` pairs keeps
  working unchanged — and runs faster once Tier 0 lands.

So Grok can consolidate `chat`, `world`, etc. against today's API and nothing
Claude ships will break those lenses.

## The four real coordination points

1. **Shared docs.** Both streams edit `CLAUDE.md` and sometimes
   `docs/STATE_OF_CONCORD.md`. This is the only likely merge conflict.
   Mitigation: each stream edits only its *own* paragraph/section; whoever
   pushes first wins, the other rebases their one-paragraph change. Never
   rewrite a section the other stream owns.

2. **Heavy builds are serialized on this box** (CLAUDE.md §6: "a full
   `next build` + a full `node --test` together OOM and corrupt `.next`").
   The current self-host is a **swap-thrashing 16 GB Mac** — this is not
   optional. Rule: **do not start `next build` while a `node --test` run is
   going, and vice versa.** If both agents need a heavy run, one waits. The
   A40 coming back removes this constraint.

3. **Git strategy — use separate branches.**
   - Grok: branch `frontend-destacking` off `concurrency-refactor`.
   - Claude: stays on `concurrency-refactor`.
   - Merge frontend → `concurrency-refactor` in reviewed batches (one lens or
     a small group per merge, per the playbook's "one lens per PR" rule).
   - If both must share one branch: `git pull --rebase` before every push,
     `git add <named paths>` never `-A`, and expect the CLAUDE.md conflict
     from point 1.

4. **Contract regressions are Claude's to catch, not Grok's.** If a backend
   cache returns stale DTUs, a lens shows stale data — that's a backend test
   failure (`engines/concord-dtu-sidecar/proof/run-proof.mjs` pins the
   in-memory filter to the Rust sidecar; keep them in lockstep). Grok does not
   need to know the internals; Claude verifies every backend change against
   the behavior suite + the differential proof before merging.

## Checklist before either agent starts a session

- [ ] `git pull --rebase` (or fetch + check the other branch's HEAD)
- [ ] Confirm no heavy Node build is currently running (`ps aux | grep -E "next build|node --test"`)
- [ ] Work only your tree; stage only named files
- [ ] Backend: run the affected behavior test + `run-proof.mjs` before commit
- [ ] Frontend: `npm run type-check && npm run lint` + the lens's behavior test + `node scripts/detect-lens-stacking.mjs` (score must drop) before commit
- [ ] Doc edits: your section only

## Known drift during Grok's pass (Grok refreshes on commit)

- `docs/PREMIUM_UI_AUDIT.md:178` — "arbitrary `text-[Npx]` occurrences: 1802" is
  a `grep ... concord-frontend/app/lenses/*/page.tsx` count. As of 2026-09-08 a
  live re-run returns 1715 and falling — Grok's lens edits are changing those
  files. `check-doc-claims-all.mjs --ci` will flag this until Grok's pass
  settles and Grok updates the number (it's a frontend-file metric, Grok owns
  it). Claude does NOT touch this line.

## Escalate to the owner if

- A backend change genuinely needs a frontend contract change (shouldn't happen
  for Tier 0/1 — flag it if it does).
- The `/api/credits/*` fix (`CONCURRENCY_STATE_AUDIT.md` Tier M) — it deletes or
  DB-backs a money surface the `billing` lens helper calls. Coordinate that one.
- Both streams want the box's one heavy-build slot at the same time repeatedly.
