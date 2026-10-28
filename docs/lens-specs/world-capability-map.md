# World lens — capability map (backfill, summary-level, 2026-07-11)

> **Re-verification (HANDOFF-3 batch L6, 2026-10-28, against main e9791d4d):**
> The summary below is kept as history; its scope note still stands (this
> lens's ~270 components were not individually re-audited — CLAUDE.md
> remains the maintained architecture source). What changed / was
> verified this pass:
>
> - **Entry structure changed.** `app/lenses/world/page.tsx` is now a
>   27-line shell over `components/world/WorldUnityShell.tsx` — "Unity
>   viewport first": full-bleed Concordia WebGL (env `UNITY_WEBGL_URL`
>   or `/unity-client/`) with an honest unbuilt state when no WebGL
>   export exists. The ~7.6k-LOC `WorldOsSurface` remains reachable as
>   the Advanced OS tools surface (Menu → Advanced OS tools, or
>   `?surface=os`). The Unity client itself is out of scope for this
>   batch, per the handoff.
> - **Fabricated building citations — REMOVED in this batch.** Clicking
>   any building in `WorldOsSurface` generated three mock citations
>   (invented DTU ids `comp-concrete-found-v2` / `mat-usb-a` /
>   `infra-water-1`, invented creators `@engineer_jane` /
>   `@materials_lab` / `@civil_sara`) and the Inspector rendered them
>   as real provenance — the REMAINING-WORK-AUDIT's WorldOsSurface
>   mock-citations row. The handler now sets an empty list (the
>   Inspector's Citations section renders only when non-empty); a real
>   per-DTU citation lookup is not wired into this surface yet, and the
>   code comment says so.
> - **Fabricated lore — fixed separately in PR #1710**
>   (`fix/world-lore-honest-unavailable`): `GET
>   /api/world/narrative/lore` returned `ok:true` with a `lore_stub`
>   placeholder that the World Chronicle panel rendered as lore; it now
>   returns 503 `lore_generation_unavailable`, matching the refresh
>   endpoint's existing pattern.
> - **Concept art (52-world): immersion, not a headline.** The concept
>   is a near-chromeless full-screen world ("The world is the screen")
>   with only a hub chip — the Unity-first shell matches that direction.
>   Deliberate liberty: NO serif greeting was added to this lens,
>   unlike the other batches — the concept has no headline, and adding
>   one would fight the art direction.
> - **Domain collision re-verified:** `grep -c "lensRun('world'"`
>   on the lens page is still 0; `domains/world.js` (geopolitical data)
>   remains unrelated to this lens. `/api/worlds/` call sites in
>   `WorldOsSurface`: 11, as below.
> - **`docs/lens-specs/world.md` backlog:** all 8 items are marked
>   shipped (in-world building editor, inventory/equipment UI, party
>   play, minimap + fast travel, mounts UX, combat depth, LOD/streaming,
>   photo mode) with a ~95% parity claim vs Roblox/Genshin. Kept as
>   history — spot-verified structurally this pass, not re-audited
>   feature by feature.
> - **Server suites run locally this pass:** cross-world-effectiveness
>   + cross-world-effectiveness-rules — 15/15 pass. The concordia-*
>   suites boot the server and are Mac-run (listed in the PR).


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
