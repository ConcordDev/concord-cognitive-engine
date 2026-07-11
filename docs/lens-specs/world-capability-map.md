# World lens — capability map (backfill, summary-level, 2026-07-11)

## Scope note

This is a **summary-level backfill**, not an exhaustive re-audit. `/lenses/world`
is Concordia, Concord's 3D civilization simulator — `page.tsx` alone is
6,989 LOC, mounting ~270 components across `components/world/`,
`components/world-lens/`, and `components/concordia/`, backed by dozens of
REST route files and ~30 emergent/heartbeat subsystems. CLAUDE.md's own
"Concordia (World Lens)" and "Current Wiring Status" sections are the
authoritative, continuously-maintained source for this lens's architecture,
subsystem list, and invariants — this doc exists only to satisfy the
capability-map-per-lens convention with an honest overview, not to
duplicate or supersede that documentation.

## A naming collision worth flagging (not a defect)

`server/domains/world.js` registers 55 `world.*` macros (`indicatorTrack`,
`countryCompare`, `tradeFlow`, `demographicProfile`, `marketplace-summary`,
etc.) — but grepping `app/lenses/world/page.tsx` for any `lensRun('world', ...)`
call returns **zero matches**. `domains/world.js` is a wholly unrelated
geopolitical-data/world-statistics domain that happens to share the name
"world" — this is the same class of same-name-adjacent-domain situation
already documented elsewhere in this program (`lattice`/`mesh`,
`observe`/`observer`). It is not reachable from, and has nothing to do
with, the Concordia lens. Confirmed no other file under
`concord-frontend/app/lenses/world/` calls it either.

## What the Concordia lens actually is

Concordia is REST-route-based, not macro-based — `page.tsx` calls
`/api/worlds/:worldId/*` routes (11 direct call sites in the page file
alone; many more inside its ~270 mounted components) rather than
`POST /api/lens/run`. This matches CLAUDE.md's own framing: "The world
lens is the canonical surface... every gameplay feature must be reachable
from inside `/lenses/world`."

High-level subsystem inventory (see CLAUDE.md for the full, current list):
3D terrain/building/avatar rendering with physics (Rapier3D), real-time
Socket.IO presence, NPC dialogue/schedules/economy/asymmetry/nemesis
graphs, combat (server-authoritative action combat + a separate optional
party-tactics RTwP mode), crafting/resource-property substrate, faction
strategy + wars, quest engine + lattice-born quests, embodied signal layers
(environment, pain, dreams, forward-sim), procedural generation (regions,
kingdoms, settlements), 11 run-modes (roguelite/horde/extraction/horror/
time-loop/brawl + party combat), housing/guilds/festivals, and the
emergent event feed surfacing ~20 silent simulation channels to the UI.

## Verified: the ledger's specific claim still holds

The Flagship-3/3 ledger entry (`2e048948`) claims: "killed a permanently-
dead fake `progress={0}` loading bar, replaced with 3 real load-signal
states." Confirmed still true — `page.tsx:4807` has a comment referencing
this exact fix ("LoadingTransitions that was stuck at `progress={0}`"),
and no raw `progress={0}` literal remains anywhere in the file. Did not
re-verify the "3 real load-signal states" claim's live behavior beyond
this (would require a running server + browser, out of scope for a doc
backfill pass).

## What this doc does NOT claim

This pass did not re-audit the ~270 mounted components individually, did
not re-verify every REST route Concordia calls against its backing route
file, and did not check for fabricated data anywhere in this lens (that
would be a multi-day undertaking proportionate to the lens's actual size,
not a documentation backfill). If a future pass wants a real capability
audit of Concordia specifically, treat this doc as a starting map, not a
finished one — the earlier waves' work (Phase D "production sprint,"
Sprint D CK3-port, the Convergence sprint, the Belonging sprint, all
documented in CLAUDE.md's "Recent shipped work" table) is where the actual
verified, tested feature-by-feature history lives.

## Verification

- `grep -c "lensRun('world'" app/lenses/world/page.tsx` → 0 (confirms the
  domain-collision finding above).
- `grep -c "/api/worlds/" app/lenses/world/page.tsx` → 11 (confirms
  REST-route architecture).
- `grep -n "progress={0}" app/lenses/world/page.tsx` → 0 matches (dead
  loading bar confirmed gone).
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}`
  total 260, unchanged (no code touched in this pass).
