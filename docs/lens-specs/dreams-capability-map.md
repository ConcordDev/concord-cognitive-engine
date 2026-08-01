# dreams — capability map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/dreams.js` (528 LOC) in full, plus its two upstream
> substrates (`server/lib/embodied/dream-engine.js`, 408 LOC, and
> `server/lib/embodied/forward-sim.js`, 303 LOC). Confirmed no additional
> inline `register("dreams", …)` calls exist outside the domain file.
>
> Reproduce the macro list:
> `grep -c 'register("dreams"' server/domains/dreams.js` → **11**
> `node scripts/lens-unsurfaced.mjs --lens dreams` → **0/11 unsurfaced**

## Scope boundary — THREE things share the word "dream," only one is this lens

This was the single most important finding of the audit. Concord has three
unrelated systems that all use "dream" in their name:

1. **`dreams` domain / Layer 9 embodied-dream substrate (THIS LENS).**
   `server/lib/embodied/dream-engine.js` composes one deterministic prose
   "dream" DTU per player roughly every 6h from that player's own real
   activity (`damage_events`, `pain_signals`, `player_inventory`,
   `world_visits`, self-authored `dtus`), persisted in the `dreams` table
   (migration 115). Its forward-looking sibling, `server/lib/embodied/
   forward-sim.js` (Layer 10, `forward_predictions` table, migration 116),
   speculates about the player's active quests/NPCs/factions while they're
   offline. Both are per-user, both are grounded (never invent an event
   outside the gathered fragment/subject list), both are read here.

2. **System-level 6-phase dream-cycle** (`server/emergent/dream-cycle.js`,
   `STATE.dreamState`, routes `/api/dreams/{state,start,history}`). A
   platform-wide replay/consolidate/connect/predict/heal/compose cycle over
   the *global DTU corpus*, unrelated to any one player. Its UI is
   `components/dreams/SubstrateDreams.tsx`, mounted on the home dashboard
   (`components/home/HomeClient.tsx:723`) — **not** in this lens, and
   correctly so; left untouched.

3. **Owner-only "dream capture" insight/convergence tool**
   (`server/emergent/dream-capture.js`, `register("dream", "capture" /
   "history" / "convergences" / "queue" / "count", …)`). This is a
   founder/operator note-taking tool: free text ("dreams" in the
   entrepreneurial-insight sense) gets checked for independent convergence
   against the in-memory autonomous-derivation lattice (`STATE.dtus`, a
   legacy in-memory Map, not the SQLite `dtus` table). Write access is
   gated `requireRole("owner")` (`POST /api/dream/capture`,
   `server.js:57730`). Its real UI home is `components/emergent/
   DreamPanel.tsx`, mounted in the `command-center` (sovereign console)
   lens.

**Defect found, then the component deleted outright (see "What this rebuild changed" below — it no longer exists in the tree):** `components/dreams/DreamConvergences.tsx` was
mounted inside *this* player-facing lens's page but called
`domain: 'dream'` (singular), macros `convergences`/`count` — system (3)
above, the owner-only tool. For a normal player this rendered a "Dream
substrate · live" panel that would read `0`/`0` forever (the in-memory
`STATE.dtus` Map it reads is populated only by the owner-gated capture
route, plus one call site in the entity-sleep tick at `server.js:34400`
that passes `{ entityId, tick, sleepState }` with no `text` field — always
short-circuiting `captureDream`'s `text.length < 10` guard, so that path
never actually inserts anything either). A "live" badge over a widget that
can never show real data for any real player is the same failure class as
fabricated content even though every byte it showed was a genuine backend
round-trip — it was reading the *wrong* substrate for its placement.

## Backend macro surface — 11 macros, all real, all per-user

| Macro | What it does | Frontend consumer (before → after) |
|---|---|---|
| `recent` | Last N composed dreams + hydrated DTU + tags | `page.tsx` "Recent" tab (unchanged) |
| `predictions` | Active (non-realised, non-expired) forward-sim predictions, optional world filter | world-lens HUD `DreamPanel` only → **now also** this lens's new `DreamPredictions` section |
| `detail` | Full prose + fragments + summary + scope/price/tags for one dream | `DreamReader` (unchanged) |
| `publish` | Flip scope→public, set CC price | `DreamReader` (unchanged) |
| `unpublish` | Flip scope→personal | `DreamReader` (unchanged) |
| `reprice` | Change a published dream's CC price | `DreamReader` (unchanged) |
| `tag` | Replace a dream's tag list (per-user in-memory, ≤12 tags) | `DreamReader` (unchanged) |
| `tags` | Distinct tag cloud + usage counts | `DreamLibrary` search tab (unchanged) |
| `search` | Free-text / tag / scope filter over dream history | `DreamLibrary` search tab (unchanged) |
| `timeline` | Dreams grouped by calendar day | `DreamLibrary` timeline tab (unchanged) |
| `interpret` | Deterministic reflection linking fragments → recent activity, cached per dream | `DreamReader` (unchanged) |

`lens-unsurfaced.mjs` already reported 0/11 before this audit — `predictions`
was technically reachable via the world-lens HUD widget
(`components/world/concordia-hud/panels/DreamPanel.tsx`). That widget is a
compact glance during play; it does not replace giving this dedicated lens
its own predictions surface (a player who opens `/lenses/dreams` to read
their dream history had no way to see what their subconscious anticipates
without leaving to the world HUD). Consolidating it here is a genuine
completeness fix, not a duplicate.

## Step 1.5 — reference-parity checklist

**Reference app:** the domain's own real shape — a deterministic
prose narrative *auto-composed from the player's own real activity data*,
browsable by search/tag/calendar, not free-text journaling (the player
never writes a word of it) — is closest to **Apple Journal's "Suggestions"
mechanic** (on-device ML surfaces narrative prompts from your own real
photos/workouts/locations; you browse/bookmark, you don't author from
scratch) crossed with **Apple Photos "Memories"** for the auto-curated,
periodic-cadence feed shape. Concord's unique twist neither reference has:
a **creator-marketplace publish path** (a composed dream can be sold for CC
with the standard royalty cascade paying the dreamer on every resale) and
a **forward-looking half** (Journal/Memories are purely retrospective;
Concord also runs a Layer 10 anticipation engine over the same player).

| Reference capability | Disposition | Evidence |
|---|---|---|
| Auto-generated narrative from real personal activity, on a cadence | ALREADY REAL | `dream-engine.js#composeDeterministic`/`tryComposeForUser`, 6h cooldown |
| Full detail view (narrative + supporting data) | ALREADY REAL | `dreams.detail` → `DreamReader` (prose + substrate-that-night stat grid) |
| Calendar / "on this day" grouping | ALREADY REAL | `dreams.timeline` → `DreamLibrary` timeline tab |
| Search across entries | ALREADY REAL | `dreams.search` → `DreamLibrary` search tab |
| Tagging / categorization | ALREADY REAL | `dreams.tag`/`dreams.tags` → `DreamReader` + tag-cloud filter chips |
| Deterministic "reflection" on an entry (Journal's own AI-assisted prompts, in reverse) | ALREADY REAL | `dreams.interpret` → `DreamReader` "Interpretation" section, cached, themes/tone derived only from the entry's own fragment counts |
| Publish/monetize an entry | ALREADY REAL (Concord-specific, no reference-app equivalent) | `dreams.publish`/`reprice`/`unpublish` → `DreamReader` marketplace controls, royalty cascade |
| Anticipatory / "what's coming" half | BACKEND-CAPABLE-BUT-UNSURFACED (in this lens) → **now wired** | `dreams.predictions` → new `DreamPredictions.tsx` |
| "Featured"/highlight ranking across entries (Photos Memories' curation) | GENUINELY MISSING | No significance/ranking signal exists in `dream-engine.js` beyond raw recency; every dream is presented equally. Scoped disposition: a future enhancement, not a defect — the domain has no notion of "which night mattered most" to rank by, and inventing one client-side would be exactly the fabricated-signal pattern the program forbids. Leave unbuilt until the backend has a real significance score. |
| Auto-generated "highlight reel" video/slideshow | GENUINELY MISSING, and rightly so | Concord's dream substrate is text-first (a prose DTU), not photo/video-first — the Photos-Memories "movie" concept has no analog here by design; not a gap against this domain's actual shape. |

## What this rebuild changed

- **Removed** `components/dreams/DreamConvergences.tsx` and its mount in
  `app/lenses/dreams/page.tsx`. It called the wrong substrate (system 3
  above — owner-only insight capture) from inside the player-facing lens;
  for any real player it was permanently-empty "live" data.
- **Added** `components/dreams/DreamPredictions.tsx` in its place — a real,
  correctly-scoped, bespoke component (not a generic button wall) wired to
  `dreams.predictions`: per-subject icon (quest/NPC/faction/decision/self),
  grounded one-line anticipation, confidence percentage, composed/expiry
  timestamps, honest empty state naming exactly what feeds the engine
  (quest progress / NPC encounters / faction membership in the lookback
  window), and a `SaveAsDtuButton` snapshot action matching the idiom
  other rebuilt lenses use (e.g. `cognition`'s `BrainPoolStatus`).
- **Updated** `app/lenses/dreams/page.tsx`'s header doc-comment to name the
  three-way scope boundary explicitly, so a future pass doesn't reintroduce
  the same substrate mix-up.
- Left `DreamReader.tsx` and `DreamLibrary.tsx` untouched — both audited in
  full and found genuinely real: every field they render traces to a real
  macro, no `Math.random()`, no hardcoded arrays, no placeholder/lorem
  content, no generic `<UniversalActions>`/`<LensFeaturePanel>` body.
- Left `components/dreams/SubstrateDreams.tsx` untouched — real component,
  correctly scoped to a *different* lens surface (home dashboard, system 2
  above), not part of this lens's page.
- Did not touch `server/domains/dreams.js` — no backend gap was found; all
  11 macros are real and already covered by
  `server/tests/dreams-domain-parity.test.js`.

### Styling note

The lens already uses a consistent purple/zinc Tailwind palette across
`page.tsx`/`DreamReader`/`DreamLibrary` (not the `lib/design-system.ts`
`ds.*`/lattice-token palette used by newer flagship lenses). The new
`DreamPredictions.tsx` matches the existing sibling components' palette
and spacing rather than introducing a second, inconsistent token system
into one page — internal consistency within the lens took precedence over
switching only one of four sibling files to a different design language.
No inline hex values or ad hoc one-off colors were introduced; every class
is a Tailwind utility already in use elsewhere in this same lens.

## Verification

- `cd concord-frontend && npx eslint app/lenses/dreams/page.tsx components/dreams/DreamPredictions.tsx components/dreams/DreamLibrary.tsx components/dreams/DreamReader.tsx` — clean, 0 errors/warnings.
- `node scripts/lens-unsurfaced.mjs --lens dreams` — 0/11 unsurfaced (unchanged; `predictions` was already technically reachable via the world-HUD widget — this rebuild gives it a home in the dedicated lens too).
- `grep -rn "DreamConvergences" concord-frontend/` — no references remain (component + import + mount all removed together).
- Manual read of `DreamPredictions.tsx` for type safety: no `any`, `Prediction` interface matches `getActivePredictions()`'s exact SELECT columns in `forward-sim.js`, icon map covers all 5 subject kinds the engine gathers (`quest`/`npc`/`faction`/`decision`/`self`) with a `Sparkles` fallback for future kinds.
- TypeScript not run project-wide by this agent (per instructions, to avoid a race with 5 concurrent sibling agents); the orchestrator's centralized `tsc --noEmit` run is the source of truth.
- Backend untouched; `server/tests/dreams-domain-parity.test.js` (11-macro contract suite) was not run by this agent since no backend file changed, but its existence confirms the macro surface pinned by this audit is stable.
