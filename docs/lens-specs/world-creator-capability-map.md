# World Creator Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every claim below was checked against the working
> tree (full reads of every file involved) and every test count is a real
> `node --test` / `npx vitest run` invocation, not a guess.

World Creator (`/lenses/world-creator`) is a **top-down 2D visual scene
editor for player-built sub-worlds** — "Roblox Studio's place-editor, scoped
to Concord's world primitives": start a blank draft or a preset template,
place props/spawn-points/zones/NPCs on a 500m×500m top-down canvas, author
factions, preview the biome's climate, tune four rule modulators, run a
playtest-readiness check, and **Playtest** mints the draft into a real
`worlds` row via `POST /api/worlds` and jumps straight into `/lenses/world`.
"You become the world's sole creator — there is no admin role" (the page's
own header copy, and it's true end-to-end: see the anomalies-authz section).

## Not to be confused with `/lenses/foundry`

Two genuinely distinct lenses share the "build a world" theme but nothing
else — confirmed by reading both, not by name-matching:

| | World Creator | Foundry |
|---|---|---|
| Domain string | `world-creator.*` (22 macros, `server/domains/world-creator.js`) | `foundry.*` + 4 runtime domains (`server/domains/foundry.js` + `foundry-systems.js`) |
| Product | Hand-placed top-down scene editor (props/spawns/zones/NPCs/factions on an SVG canvas) | No-code system-composition builder (select/configure 34 prebuilt systems — combat, economy, NPC behavior — into a worldspec, compile, publish) |
| Reference app | A lightweight Tiled/RPG-Maker-style top-down placer | Roblox Studio / Core (`docs/lens-specs/foundry-capability-map.md`) |
| Storage | In-memory per-user drafts (`STATE.worldCreatorLens.drafts`, a `Map<userId, draft[]>`) | `worldspecs` + `worlds` (migrations 191–192) |

Both ultimately mint a `worlds` row via the same `/api/worlds` REST route,
so "which one do I use" is legitimately "do you want to place things by hand
or compose systems" — not a duplicate.

## Backend surface

`server/domains/world-creator.js` (551 lines), a single file, registers
**22 macros**, all real handlers with no stubs (every branch returns
`{ ok, result }` or `{ ok:false, error }`, never throws — verified by the
domain's own "degrade-graceful" test suite below):

```
grep -oE 'registerLensAction\("world-creator", "[a-z-]+"' server/domains/world-creator.js | sort -u | wc -l
# → 22
```

`templates`, `biomes`, `biome-preview`, `draft-create`, `draft-list`,
`draft-get`, `draft-update`, `draft-delete`, `prop-place`, `prop-move`,
`prop-remove`, `spawn-add`, `spawn-remove`, `zone-add`, `zone-remove`,
`npc-place`, `npc-remove`, `faction-add`, `faction-remove`, `draft-publish`,
`discover`, `playtest-check`.

Static reference data is real computed content, not filler: 8 biomes with
distinct temperature/humidity/light/hazard/growth/palette values, 3 seeded
templates (forest/desert/urban) with real prop/spawn/zone counts, and
`biome-preview` derives an actual 6-point day-cycle temperature/light curve
plus a hazard-scaled storm-chance forecast from `Math.sin` solar-angle math
— not a static table (pinned by
`server/tests/world-creator-lens.test.js`'s "computes a 6-point day curve"
and "storm chance scales with weather intensity" tests, which assert the
literal computed numbers: `hazardScore(extreme=4) × 12 × weather(1.0) =
48`).

The `/api/worlds` REST route (`server/routes/worlds.js:183`) is the mint
target: `requireAuth`-gated, requires `name` + `universe_type`, and stamps
`created_by = req.user.id` — the load-bearing fact the anomalies-authz
section below depends on.

## Frontend surface

- `app/lenses/world-creator/page.tsx` (82 lines) — `LensShell` + toggles
  between `DraftGallery` (landing) and `DraftEditor` (a single draft), plus
  a `WorldBuilderInspo` panel (live `r/worldbuilding` Reddit top-posts feed
  — a real external API call, not fabricated inspiration content) and a
  link to `/lenses/world-creator/anomalies` (a separate registered
  lens-registry entry, `id: 'world-creator/anomalies'`, discoverable via
  ⌘K independently — see the authz section).
- `components/world-creator/DraftGallery.tsx` (207 lines) — genuine 3-state
  load machine (loading/error-with-retry/populated, both `role="status"`
  and `role="alert"` used correctly), new-draft form, template gallery,
  draft grid with real per-draft counts, and a discovery search over public
  worlds by other creators.
- `components/world-creator/DraftEditor.tsx` (476 lines pre-fix / 531 lines
  post-fix) — the scene editor: 4 tabs (scene/biome/rules/publish), tool
  palette (select/prop/spawn/zone/npc), an inspector panel, faction
  authoring, rule-modulator + terrain sliders, playtest-readiness check,
  and delete.
- `components/world-creator/SceneCanvas.tsx` (187 lines) — a dependency-free
  SVG top-down plotter (props/NPCs/zones/spawns rendered with glyphs +
  color-coded zone rings), click-to-place, drag-to-move.
- `components/world-creator/BiomePreview.tsx` (118 lines) — palette
  swatches + a real `ChartKit` line chart of the computed climate curve.

## Macro coverage — every macro is called; the gap was in the fields, not the wiring

```
for m in templates biomes biome-preview draft-create draft-list draft-get draft-update draft-delete \
         prop-place prop-move prop-remove spawn-add spawn-remove zone-add zone-remove \
         npc-place npc-remove faction-add faction-remove draft-publish discover playtest-check; do
  grep -rq "'$m'" concord-frontend/components/world-creator/ concord-frontend/app/lenses/world-creator/ || echo "MISSING: $m"
done
# → no output (every one of the 22 registered macros has a literal call site
#   in the frontend — the remove-macros are dispatched through a lookup
#   table in DraftEditor.tsx's removeSelected, not a bare lensRun(...) call,
#   which is why a naive `lensRun\(` grep alone under-detects them)
```

All 22 macros are reached (confirmed by direct read of `DraftGallery.tsx` +
`DraftEditor.tsx` + `BiomePreview.tsx`, and independently pinned by
`server/tests/world-creator-lens.test.js`'s "registers all macros the page +
children call via lensRun" test). **No dead backend macro. No fake frontend
button.** This lens had already been through a prior hardening pass (the
existing 505-line `world-creator-lens.test.js` behavioral suite —
create→list→get round-trips, per-user isolation, cross-creator discovery
privacy, clamp/fail-closed poisoned-numeric handling, degrade-graceful with
no STATE — none of that was written this session; it pre-dates this audit
and is the reason the macro layer needed no repair).

The real defect class this pass found was **narrower**: four of the
domain's already-accepted, already-tested optional fields were dead
*inside* otherwise-correctly-wired macro calls — the UI always sent a
subset of what the backend would accept, silently discarding the rest.

## What was found and fixed

### 1. `biomePalette` — a declared `SceneCanvas` prop the caller never passed

`SceneCanvas.tsx:48` has always accepted an optional `biomePalette?:
string[]` used to tint the canvas ground rect to the draft's biome (`const
fill = biomePalette && biomePalette.length >= 2 ? biomePalette[1] :
'#1c1917'`). `DraftEditor.tsx` never passed it — the Scene tab's canvas
ground was always the same dark neutral gray regardless of which of the 8
biomes was selected, even though the *same* biome-palette data (`biomes`
macro result, already fetched for the Biome tab's swatches) was sitting
unused in state. Fixed: `Biome` interface extended with `palette?:
string[]` (the macro already returns it — `server/domains/world-creator.js`
`biomes` handler: `palette: b.palette`), and `<SceneCanvas biomePalette=
{biomes.find(b => b.id === draft.biome)?.palette} .../>`. Zero new backend
code — this is 100% "wire the dead-but-real field."

### 2. Zone radius hardcoded to 50, ignoring the already-accepted `radius` param

`zone-add` clamps `params.radius` to `[5, 250]` and the domain-parity test
suite already asserts this clamp (`"zone-add validates kind + clamps
radius"`), but `DraftEditor.tsx`'s `onCanvasClick` sent a literal `radius:
50` for every zone regardless of tool selection — there was no way, from
the UI, to place a safe zone smaller than a sprawling 250m hazard zone. Zone
size materially changes gameplay (a "safe" zone's whole point is its
footprint), so this wasn't cosmetic. Fixed: added a `zoneRadius` number
input (`aria-label="Zone radius in meters"`, clamped client-side to the
same `[5, 250]` the backend enforces) next to the zone-kind selector, wired
into the `zone-add` call.

### 3. Prop rotation/scale — inspector displayed them read-only despite `prop-move` already accepting + clamping both

The Inspector panel showed `Rotation: {p.rotation}°` / `Scale: {p.scale}×`
as static text. `prop-move` already accepts and clamps `rotation` (`[0,
360]`) and `scale` (`[0.25, 4]`) independently of position — pinned
server-side by `server/tests/depth/world-creator-behavior.test.js`
(`prop-place … scale: 10` clamps to 4; `prop-move … rotation: 90` round-
trips). There was no way to actually orient or resize a placed prop after
dropping it — a real gap for a scene editor whose entire job is visual
placement. Fixed: the two static rows became number inputs
(`aria-label="Prop rotation in degrees"` / `"Prop scale multiplier"`)
wired through a new shared `updateProp(id, patch)` write path.

### 4. Drag-move: no reconciliation on failure, and a real network-spam bug

Two related defects in the pre-existing `onMove` (drag-to-move a prop):

- **Fire-and-forget with no reconciliation.** `void lensRun('world-creator',
  'prop-move', …)` — the optimistic client-side position update was never
  checked against the real response. A rejected/failed `prop-move` (e.g. a
  `draft not found` race) would leave the client silently disagreeing with
  the server until the next full `refresh()`, with no error surfaced — the
  exact "optimistic state that silently swallows a real failure" pattern
  `docs/UI_QUALITY_RUBRIC.md`'s fluidity discipline forbids.
- **Unthrottled network calls during a drag.** `onMove` fires on every
  `mousemove` tick while dragging (`SceneCanvas.tsx`'s `handleDragMove`
  has no throttle), so a single drag gesture could fire dozens of
  `prop-move` calls, most landing on the same rounded integer cell.

Fixed together: `updateProp` is now the single write path for
position/rotation/scale, checks `r.data?.ok` and surfaces `setErr(...)` +
`refresh()` on failure (visible reconciliation instead of silent
disagreement); `onMove` dedupes against a `lastMoveRef` of the last
committed `(id, x, z)` so a drag gesture revisiting the same cell fires the
macro once, not once per pixel — pinned by the new
`"dragging a prop to the same integer cell twice fires prop-move only
once"` test.

### 5. Anomaly resolve/dismiss silently swallowed a failed request

`app/lenses/world-creator/anomalies/page.tsx`'s `resolve()` handler
`await fetch(...)` and then unconditionally called `fetchWorld(worldId)` —
it never inspected `res.ok` or the response body. A failed resolve/dismiss
(session expired mid-review, a stale worldId, a genuine 403 from the
server's real `worlds.created_by` ownership gate — see below) made the
Resolve/Dismiss button appear to do nothing: no error, no console output,
the row just... stayed. Fixed: the handler now awaits + parses the JSON
body, and on `!res.ok || !json?.ok` calls the page's existing `setError(...)`
(the same banner the page already uses for the public-transparency-log
load failure) instead of silently returning — pinned by the new
`"a failed resolve (403 not_world_creator) surfaces the server error
instead of silently doing nothing"` test, alongside a companion test
proving the success path still refetches and the row disappears.

## Authz check (per the wave's repeated missing-server-side-authz pattern)

World Creator has exactly one per-object ownership surface that isn't the
macro-domain's own per-user Map isolation: the anomalies sub-page's
per-world resolve/dismiss/list. Read `server/routes/anomalies.js` in full —
**this was already correctly authz'd before this audit, not a gap this pass
had to close**:

- `_userOwnsWorld(userId, worldId)` does a real `SELECT created_by FROM
  worlds WHERE id = ?` and compares against the requesting user — not a
  frontend-only gate. `GET /world/:worldId`, `POST .../resolve`, and
  `POST .../dismiss` all call it and return `403 not_world_creator` on
  mismatch, `before` any DB read/write.
- `GET /public` deliberately omits `user_id` from its response — pinned by
  `"public aggregate omits user identity"` in the existing test suite.
- Cross-user isolation is independently proven: `server/tests/
  world-creator-lens.test.js`'s REST-surface suite seeds `world_a` owned by
  `creator_a` and `world_b` owned by `creator_b`, then asserts `creator_b`
  gets `403` reading/resolving/dismissing against `world_a`, and an
  anonymous caller (no `x-user-id`) is also rejected.

The `world-creator.*` macro domain itself has no admin/operator surface —
every macro scopes strictly by `aid(ctx)` (`ctx.actor.userId`) into a
per-user bucket of `STATE.worldCreatorLens.drafts`; `draft-get`/
`draft-update`/`draft-delete`/etc. all call `findDraft(s, aid(ctx), id)`,
which only searches the caller's own bucket — cross-user access to another
creator's draft by id returns `not found`, not another user's data
(pinned: `"per-user isolation: … cross-user get rejected"`). `discover`
deliberately walks every creator's bucket but returns **only** `visibility
=== 'public'` drafts with non-sensitive summary fields — the one
intentional cross-user read, and it's the discovery feature's entire
purpose (pinned: `"discover only surfaces PUBLIC drafts"`).

In production, `/api/lens/run`'s `_lensActionForbiddenForAnon` gate
(`server.js:6690`) additionally rejects any anonymous (`actor.userId ===
"anon"`) lens-action call outright when `NODE_ENV === "production"` and
`AUTH_MODE !== "public"` — so an unauthenticated caller can't even reach
the per-user Map logic in a secured deploy.

**No authz defect found or fixed here — the pattern that bit other lenses
this wave (a frontend-only gate on an operator surface) does not apply;
World Creator's one per-object-ownership surface already had the real
server-side check, independently pinned by tests that predate this pass.**

## Fabricated-data check

`grep -rn "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem\|TODO" concord-frontend/components/world-creator/ concord-frontend/app/lenses/world-creator/`
→ zero hits in any shipped component or page (the new *tests* under
`concord-frontend/tests/` do say "mock" — that's `vi.mock('@/lib/api/client', …)`
standing in for the network layer, not fabricated render data, and tests
are outside this grep's scope by design). `WorldBuilderInspo`'s
Reddit feed is a genuine live external fetch (matches the established
"inspo panel" pattern used by other lenses), not canned copy — an
`isError` state renders "Reddit unreachable," never a silent fallback list.
Every count rendered in `DraftGallery` (props/NPCs/zones/spawns/factions)
comes straight through from the macro result; nothing is client-invented.

## Genuinely missing (deferred) — triage

These are real, honestly-scoped gaps, not defects — none of them involve
fabricated data or a broken macro call; they're backend fields/capabilities
that would need either a UX decision beyond this pass's budget or a new
macro that doesn't exist yet. Triaged per the sixth hard invariant so a
future pass has a work order instead of a vague "polish later":

- **ENGINEERING — NPC `backstory` (600-char) and non-default `level`
  (1–100) are accepted by `npc-place` but only ever sent as their defaults**
  (`backstory: ''`, `level: 1`) because the UI captures only a name via a
  single `window.prompt`. Closing this needs either extending the prompt
  chain (cheap, but not premium UX for a multi-line field) or a proper
  placement form — a small, scoped frontend addition, no backend change.
- **ENGINEERING — zones/spawns/NPCs can only be placed then deleted, never
  repositioned.** `prop-move` exists; there is no `zone-move` /
  `spawn-move` / `npc-move` macro, so (unlike props) moving a misplaced
  zone/spawn/NPC requires delete+recreate. This is a real new-macro ask
  (three small handlers mirroring `prop-move`'s clamp-and-patch shape) —
  correctly deferred rather than invented mid-audit per this project's
  "prefer wiring existing capability over inventing new backend code"
  guidance.
- **ENGINEERING — zone name and spawn-point name are never user-set at
  creation** (`zone-add`/`spawn-add` both accept a `name`, but
  `onCanvasClick` always sends `''`/omits it, so the backend's own
  fallback naming — `` `${kind} zone}` ``/`Spawn N` — is the only name a
  world ever gets). Low priority: not fabricated, just always-default: a
  quick text-input addition alongside the existing kind/radius selectors
  would close it.
- **Not a gap — noted for completeness:** `universeType` is set once at
  `draft-create` (defaulting to `concordia-hub` since `DraftGallery`'s
  `createDraft` never sends it) and has no editing surface in
  `DraftEditor`. This is an honestly-defaulted field, not a lie — every
  draft simply targets the hub universe today. Low value to surface until
  Concord ships a second selectable universe type in this flow.

## What changed (files)

- **`concord-frontend/components/world-creator/DraftEditor.tsx`** — wired
  `biomePalette` into `SceneCanvas`; added a zone-radius input; made prop
  rotation/scale editable via a new `updateProp` write path; added
  drag-move dedupe + failure reconciliation.
- **`concord-frontend/app/lenses/world-creator/anomalies/page.tsx`** —
  `resolve()` now checks the response and surfaces a real error instead of
  silently no-op'ing on failure.
- **`concord-frontend/tests/world-creator-draft-editor.test.tsx`** — new,
  4 tests pinning the four `DraftEditor` fixes above.
- **`concord-frontend/tests/world-creator-anomalies-page.test.tsx`** —
  new, 2 tests pinning the resolve-failure-surfaces-error fix and the
  resolve-success-refetches path.
- **`docs/lens-specs/world-creator-capability-map.md`** — this file.

No backend files were changed — every field this pass wired was already
accepted, validated, and (for `prop-move`'s rotation/scale and `zone-add`'s
radius clamp) already behaviorally tested server-side. The defect was
entirely "the frontend sends less than the backend accepts," never "the
backend can't do this yet."

## Verification

- `cd concord-frontend && npx eslint components/world-creator/ app/lenses/world-creator/ tests/world-creator-draft-editor.test.tsx tests/world-creator-anomalies-page.test.tsx` → clean, exit 0 (0 errors, 0 warnings).
- `cd concord-frontend && npx tsc --noEmit -p .` → 0 errors touching any `world-creator` file (6 pre-existing, unrelated errors in `components/ethics/DecisionToolkit.tsx` + `components/events/EventOps.tsx` — confirmed via `grep -i world-creator` on the output, zero matches).
- `cd concord-frontend && npx vitest run tests/world-creator-draft-editor.test.tsx tests/world-creator-anomalies-page.test.tsx tests/world-creator-lens-states.test.tsx` → **12 pass / 0 fail** (4 new + 2 new + 6 pre-existing, all green).
- `cd server && node --test tests/world-creator-lens.test.js tests/world-creator-domain-parity.test.js tests/depth/world-creator-behavior.test.js` → **53 pass / 0 fail** (unchanged — no backend files touched; this run just re-confirms the pre-existing macro/authz suite the frontend fixes depend on is still green).
- `node scripts/verify-lens-backends.mjs` → `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged.
- `node scripts/grade-ux-polish.mjs --honest` → `world-creator` entry: `tier: "polished"`, `isGenericScaffold: false`, `hasMacroButtonWall: true` (the tool-palette buttons — a designed control surface, not the forbidden `UniversalActions`/`ManifestActionBar` scaffold pattern; `importsGenericTrio: false` confirms the page doesn't mount the generic trio), unchanged from pre-audit. `audit/` output reverted via `git checkout -- audit/` after the run per the no-committed-transient-artifacts rule.
