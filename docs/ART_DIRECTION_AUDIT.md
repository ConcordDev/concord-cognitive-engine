# Art Direction Audit — what is authored, what is implemented, what actually reaches the screen

> Read-only audit, 2026-07-25, branch `claude/game-systems-audit-continuation-cobe3q`.
> Commissioned to answer three owner questions: (1) what the art/feel targets actually
> are, given "Bethesda-like" sits next to an explicitly anti-photoreal style guide;
> (2) whether the claim "every world, NPC, area and system has a specific authored
> styled design" holds; (3) where the shipped 3D client fails to honor the art
> direction it has already written down.
>
> **Method.** Every claim cites `file:line`. Three states are held apart throughout,
> because the gap between them is the entire finding:
> **AUTHORED** (content/constants exist) → **IMPLEMENTED** (code reads them) →
> **RENDERED** (it reaches a player's screen).
>
> **⚠ Concurrent work.** `world-lens-godot/world/art_style.gd` and
> `world-lens-godot/art_style.json` were written by another agent *during* this audit
> (mtime 15:03:34Z, ~1 minute before I read them; both still untracked per
> `git status --porcelain world-lens-godot/`). Findings are reported at both states —
> as they stood at HEAD, and as they stand with that in-flight work applied. That
> distinction is called out inline wherever it matters. I did not touch
> `world-lens-godot/VISUAL_QA.md` or `scripts/visual-qa.mjs` (owned by that agent).

---

## 1. What the targets actually are

**The owner's read is correct, and the documents confirm it rather than conflict.**

- **"Bethesda-like" is a DESIGN/FEEL target, not a render target.**
  `docs/DESIGN_NORTH_STAR.md:19` titles §1 "The Bethesda feel — curiosity, go-anywhere,
  emergent world, minimal-HUD/deep-menus". Its five pillars (`:21-27`) are go-anywhere
  fantasy, the compass discovery loop, minimal-HUD/deep-menus, Radiant-AI systemic
  emergence, and lived-in world + ownership. **The document never once mentions
  rendering, materials, shaders, or fidelity.** Its acceptance bars are behavioral —
  e.g. the B2 bar at `:32-33`: "Glance shows almost nothing (resource bars fade in on
  change + crosshair); depth lives in the Summon/Sanctum panels."
  `docs/OFFICIAL_PLAN.md:108` reinforces the same framing ("Concord Link = the missing
  **pause**").

- **The RENDER target is stylized BotW/Palworld, explicitly anti-photoreal.**
  `docs/ART_STYLE_GUIDE.md:1-9`: "Photoreal invites comparison to $200M productions; a
  stylized look *sets its own standard*… The reference is **BotW lighting + Palworld
  creature forms** — the *same rules* across all 9 worlds, a *different palette* per
  world." The four locked constants are tabled at `:18-21` and live in code at
  `concord-frontend/lib/world-lens/concordia-theme.ts:392-401`.

**Reconciled target statement:**
> Concordia targets **Bethesda's feel** (curiosity, go-anywhere, discovery loop,
> minimal HUD with depth in menus, Radiant-AI emergence, lived-in ownership) rendered
> in a **stylized BotW-lighting / Palworld-forms** language — coherence over fidelity,
> one shared visual rule-set across all worlds, differing only by palette and
> saturation. Photorealism is explicitly rejected. These are complementary axes, not
> a conflict.

### The one genuine documentary conflict — and it is inside the source-of-truth file

`concord-frontend/lib/world-lens/concordia-theme.ts:10-14` — the header of the very file
that holds the locked constants — states a *different, older* target:

```
 * Aesthetic target — Biomutant × BOTW × Skyrim cross:
 *   - Cel-shaded base with a 3-stop toon gradient (BOTW)
 *   - Saturated post-apoc palettes per biome (Biomutant)
 *   - Material grounding via PBR for the player + named NPCs (Skyrim)
```

That third line directly contradicts `docs/ART_STYLE_GUIDE.md:48-50` rule 4: "**The
grounded dial is global.** If a world feels too cartoon or too real, move
`GROUNDED_DIAL`, not one material — so the whole game moves together." Per-entity PBR
for "the player + named NPCs" is precisely the per-material escape hatch the locked
guide forbids. **This is a real conflict, stated plainly rather than smoothed over:**
the file's prose header and the file's own constants describe two different art
directions. The guide is the later, explicitly "locked" document
(`ART_STYLE_GUIDE.md:1`, `:52-55`), so it should win — but the header has never been
reconciled, and it is the text a developer opening `concordia-theme.ts` reads first.

Secondary, non-conflicting note: `docs/CONCORDIA_PLAN.md:1052-1053` already identifies
the fix as the project's **own #1 visual priority** — "**G1.1 ⭐ Commit a hard cel-shade
+ ink-outline art direction** uniformly to the primitive crowd… *Single biggest visual
win.*" §3 below shows G1.1 was only ever half-executed.

---

## 2. The real authored inventory

**Verdict: the claim is TRUE for worlds, PARTIALLY TRUE for factions, and FALSE for
NPCs and areas.** Answered per-axis, with counts.

### 2.1 Worlds — claim holds

10 world directories under `content/world/`. 9 carry a `meta.json` with theme /
tech_level / magic_level / biomes / skill_affinity and real hand-written prose;
`concordia-hub` is served by the root `content/world/_meta.json` instead.

| World | theme | tech / magic | biomes | NPCs | factions | lore |
|---|---|---|---|---:|---:|---:|
| concordia-hub | fantasy | pre-industrial / moderate | 4 | 16 (+36 root) | 5 (+8 root) | 15 (+27 root) |
| tunya | post-arrival pre-industrial | pre-industrial / rare-bloodline | 7 (dict schema) | 36 | 14 | 33 |
| cyber | cyberpunk | near_future / trace | 2 | 33 | 8 | 11 |
| crime | noir | modern / none | 2 | 30 | 8 | 10 |
| fantasy | fantasy | pre-industrial / abundant | 5 | 30 | 8 | 12 |
| superhero | modern | modern_high_tech / none | 2 | 30 | 8 | 11 |
| sovereign-ruins | post-collapse-archive | ruined-classical / fading | 2 | 31 | 8 | 10 |
| lattice-crucible | drift-dense-experimental | varied / high-and-unstable | 6 | 30 | 8 | 15 |
| concord-link-frontier | peer-mesh-frontier | scattered-modern / low | 4 | 30 | 8 | 14 |
| **sere** | late-extraction industrial | industrial / none | **10** | 34 | 11 | 9 |
| **TOTAL** | | | | **300** | **86** | **140** |

Supporting authored content: 115 quests across 33 files (`content/quests/` + in-world
`quests/` dirs), 44 achievements across 6 files, 40 festivals, and global template sets
at `content/world/` — `grudge_templates.json` (37), `desire_templates.json` (25),
`preoccupation_templates.json` (16).

Two content asymmetries worth recording:
- **Depth is uneven.** `tunya`, `sere` and `cyber` carry a much richer file set
  (calendar, apparel, industries, naming_conventions, diplomatic_graph; tunya adds
  `colors.json` + `dyes.json` + species/powers/professions). The other seven worlds
  have only `creatures.json` + `loops.json`.
- **74 of 300 NPCs carry `"generated": true`** (the `npcs-extra.json` files) — machine
  fill, not hand authoring. The hand-authored primary cast is ~226.

*Doc drift note:* `docs/COLD_START_STRATEGY.md:27` still cites "128 NPCs, 66 factions,
84 lore items". The measured figures are 300 / 86 / 140.

### 2.2 NPCs — claim does NOT hold for *styled* design

NPC authoring is prose, personality and schedule — **not visual design**. Field
frequency across all 300 NPCs (parsed, not eyeballed):

- `id`/`name`/`archetype`/`faction_id`/`daily_schedule`/`starting_sparks`: 300 each
- `narrative_context` 262 · `backstory` 176 · `personality_traits` 176 ·
  `appearance` **144** · `apparel` 121
- **Absent on all 300:** `portrait`, `model`, `mesh`, `sprite`, `texture`, `avatar`,
  `icon`, `image`, `color`, `palette`, `style`, `visual`, `face`, `height`.

So **48% of NPCs have any appearance field at all, and 0% have machine-consumable
visual design data.** Three files containing *primary named cast* — not filler — have
zero appearance authoring: `content/world/concord-link-frontier/npcs.json` (10),
`content/world/lattice-crucible/npcs.json` (11),
`content/world/sovereign-ruins/npcs.json` (13). The root Concordia cast of 36 has
appearance on 2.

Where `appearance` exists it takes two incompatible shapes: a structured dict
(`build`/`skin`/`hair`/`eyes`/`outfit`/`tells`) on only 20 NPCs, and a free prose
string on 124. Both are prose all the way down — no hex, no asset id, no rig. `apparel`
(121 NPCs) is the nearest thing to wardrobe data but is snake_case tokens
(`"robes_of_living_moss_bark_and_shadow_silk"`) with no colour, material or mesh
binding. The 124 prose strings are all unique, so what exists is genuinely
hand-authored — it is simply **not renderable**.

### 2.3 Factions — the one axis where styled design is real

**81 of 86 factions carry a `visual` object** — and this is the only genuinely styled,
machine-readable authoring in the content tree:

```json
"visual": {"primary_color":"#a06b22","secondary_color":"#291424","accent_color":"#528fe0",
 "architecture_style":"crystalline","preferred_weapon_archetypes":["scimitar","dagger","axe"],
 "preferred_armor_silhouette":"leather","sigil_path":"M0,-20 L20,0 L0,20 L-20,0 Z",
 "banner_sigil_id":"wildwood_circle_sigil","ornamentation_motifs":[]}
```

Validated at seed time by `server/lib/content-seeder.js:96-102` (hex-colour shape
check). Caveats, honestly:
- A large share is **generator output, not authored design**: cyber's Zero Collective
  and fantasy's Wildwood Circle share an identical diamond `sigil_path`, both have
  empty `ornamentation_motifs`, and crime's Ghost Network — a modern noir syndicate —
  is assigned `architecture_style: "organic"` with a medieval loadout
  (`halberd`/`bow`/`longsword`). The tunya and sere factions, by contrast, read as
  genuinely hand-authored (`"obsidian-spire"`, motifs `["ember_lattice","smelt_runes"]`).
- The 5 factions in `content/world/concordia-hub/factions.json` use a different schema
  entirely and have **no `visual` field**.

### 2.4 Areas — claim does NOT hold

**`content/world/concordia-hub/city-layout.json`: exactly 60 buildings, each with
exactly 9 fields** — `id, source, building_type, name, purpose, district_id, lens,
levels, position`. Scanned across all 60: **no** `color`, `material`, `facade`,
`style`, `height`, `footprint`, `mesh`, `model`, `texture`, `roof`, or architectural
style field. `levels` is a prose blurb per floor, not geometry; `position` is `{x, z}`
only — no y, rotation, or scale. A renderer must invent every visual property.

Districts do better: `server/lib/districts.js:109-156` authors 6 districts with a real
`palette` triple + `lightingTag` (`warm_day`, `market_bright`, `academy_dusk`,
`night_glow`, `overcast_soft`, `hazy_industrial`) + `elevationHint`. **See §3.5 — none
of it reaches the web renderer.**

### 2.5 Per-axis verdict

| Axis | Authored? | *Styled* design authored? | Verdict |
|---|---|---|---|
| Worlds (10) | ✅ 9 meta.json + root | ✅ theme/biomes/prose; palette+saturation in TS | **TRUE** (see §3.1 for `sere`) |
| NPCs (300) | ✅ rich prose/personality/schedule | ❌ 48% prose appearance, 0% renderable | **FALSE as "styled design"** |
| Factions (86) | ✅ | ⚠️ 81/86 have `visual`; much is generator-filled | **PARTIALLY TRUE** |
| Areas — hub buildings (60) | ✅ purpose/lens/position | ❌ zero visual fields | **FALSE** |
| Areas — districts (6) | ✅ | ✅ palette + lightingTag + elevation | **TRUE but unrendered** |
| Systems | ✅ extensive | n/a (not a visual axis) | out of scope |

The honest summary: **the world is deeply authored in prose, systems and identity;
it is thinly authored in anything a renderer can consume.** The claim is true about
*design* in the narrative sense and largely false about *styled design* in the visual
sense — with factions the single real exception.

---

## 3. Divergence — where the client does not honor its own art direction

This is the payoff section. The written art direction exists, is locked, is machine-
readable, and is unit-tested — **and almost none of it reaches pixels in either client.**

### 3.0 Headline: 4 of the 5 locked constants have ZERO render consumers

Reproduce by grepping `concord-frontend/` excluding `concordia-theme.ts` and `tests/`:

| Constant | `ART_STYLE_GUIDE.md` rule | Non-test render consumers |
|---|---|---:|
| `OUTLINE_WIDTH_M` (0.018) | "One outline thickness for **everything**" | **2** (avatars only) |
| `RAMP_BANDS` (3) | "Every toon ramp sampled at exactly 3 steps" | **0** |
| `GROUNDED_DIAL` (0.45) | "The grounded dial is global" | **0** |
| `OUTLINE_DARKEN` (0.35) | "Outline = shadow-band × this" | **0** |
| `WORLD_SATURATION` / `saturationForWorld()` | "albedo/light scales by `saturationForWorld(worldId)`" | **0** |

The only consumers of `RAMP_BANDS`, `GROUNDED_DIAL`, `OUTLINE_DARKEN` and
`WORLD_SATURATION` anywhere in the frontend are the assertions in
`concord-frontend/tests/art-style.test.ts:9-25`. **The per-world saturation table —
the mechanism the guide names as how "9 worlds read as 9 moods"
(`ART_STYLE_GUIDE.md:24-26`) — is authored, tested, and never applied to a single
pixel in the web client.**

`git log` shows `ART_STYLE_GUIDE.md`, the `ART_STYLE` constants and `cel-shade.ts` all
landed in the same merge (`b432684e`). The guide's own closing line predicted this
sequencing — "The guide + constants come first; the passes consume them"
(`ART_STYLE_GUIDE.md:53-55`). The guide came; only one pass ever consumed it.

### 3.1 `sere` has no art direction at all

`ART_STYLE_GUIDE.md:9` and `:26` both say "all 9 worlds", and `CANON_WORLD_THEMES`
(`concordia-theme.ts:371-381`) lists 9. There are **10** authored world directories.
`sere` — which `CLAUDE.md` calls "widely regarded as the best-written content in the
game", 34 NPCs, 11 factions, 10 biomes — has **no theme entry, no `toonGradient`, and
no `WORLD_SATURATION` row**, so `themeForWorldId()` (`concordia-theme.ts:359-365`)
falls it through to `DEFAULT_THEME_ID = 'neon-punk'` (`:383`) — a generic legacy
neon-noir palette, for a world whose theme is "late-extraction industrial".

### 3.2 The web client defaults to PBR — the opposite of the locked thesis

- `app/lenses/world/page.tsx:2243` — `useState<'pbr' | 'toon'>('pbr')`. The default
  render style is **PBR**. Stylized/toon is opt-in, behind a manual toggle at
  `:5202-5210`.
- `components/world-lens/BuildingRenderer3D.tsx:141` — `renderStyle = 'pbr'` default.

A locked, explicitly anti-photoreal art direction whose renderer defaults to PBR and
requires the player to click a button labelled "Toon" is not shipped art direction. It
is an opt-in preview of one.

### 3.3 Buildings can never be toon-shaded in the world lens, regardless of the toggle

The world-lens call site at `app/lenses/world/page.tsx:5220-5223`:

```tsx
<BuildingRenderer3D
  buildings={buildingRendererBuildings}
  viewMode="normal"
  buildingStyle={buildingStyleForWorld(worldIdForTheme)}
/>
```

It passes **neither `renderStyle` nor `toonGradient`**. Consequences:

1. The PBR/Toon toggle (`concordiaRenderStyle`) is threaded to `ConcordiaScene`
   (`:5159`) but **not** to `BuildingRenderer3D` — so flipping it to "Toon" leaves every
   building PBR. The toggle silently does not do what its label says for buildings.
2. Even if toon were enabled, `toonGradient` falls back to the hardcoded default
   `['#1a1a2e', '#3a3a5a', '#8888bb']` (`BuildingRenderer3D.tsx:142`) — a generic
   blue-grey matching **no** authored world. The per-world palettes at
   `concordia-theme.ts:200-347` never reach buildings.

`toonGradient=` appears at **zero** production call sites anywhere in the frontend.

### 3.4 The outline rule is violated in both directions

`ART_STYLE_GUIDE.md:18` — "One outline thickness for **everything** — characters,
props, buildings, creatures. Never per-asset."

- **Coverage:** `applyCelShade` is called from exactly two sites, both in
  `components/world-lens/AvatarSystem3D.tsx:1002` and `:1129-1130`. **Only avatars get
  an outline.** Buildings, props, trees, rocks and creatures get none — and render as
  `MeshStandardMaterial` (PBR), e.g. `lib/world-lens/resource-node-renderer.ts:246,
  263, 271, 285` and `lib/world-lens/creature-renderer.ts:107`. Rule 3 of the guide
  ("Forms follow Palworld… silhouette-first") has no renderer behind it.
- **Units:** the constant is documented in **metres** (`concordia-theme.ts:393-394`:
  "thickness in metres"), but is consumed as a **unitless uniform scale** —
  `outlineScale: 1 + ART_STYLE.OUTLINE_WIDTH_M * 3` → `1.054`, applied via
  `outline.scale.setScalar(outlineScale)` (`lib/world-lens/cel-shade.ts:97`). A
  scalar hull grow makes outline thickness **proportional to mesh size**: a 2 m avatar
  gets ~5 cm, a 20 m building would get ~50 cm. This is the exact per-asset drift the
  "one weight for everything" rule exists to prevent, produced by the code that cites
  the rule.
- **Palette:** avatar toon ramps use `toonRampBytes()` (`cel-shade.ts:19-29`), which
  builds a **grayscale** stepped ramp. The world's authored `toonGradient` colours are
  not used for avatars at all. `getToonGradientTexture` also caches globally
  (`:31-44`), so its `steps` argument is honoured only on first call.

### 3.5 Authored district palettes never reach the web renderer

`server/lib/districts.js:114-156` authors a real palette + `lightingTag` per district.
In the web client:
- `TerrainRenderer` receives `terrainDistricts`, which is
  `deriveTerrainZones(worldBuildings)` (`app/lenses/world/page.tsx:4817-4820`) —
  **derived from building rows, not from the authored districts table.**
- The only consumer of `lightingTag` in the entire frontend renders it as **text in a
  2D table cell**: `app/lenses/world-observatory/page.tsx:549`.

So district palette + lighting is AUTHORED and IMPLEMENTED server-side, and **not
RENDERED** in the 3D web client.

### 3.6 Faction visuals — the one path that completes, in the wrong shading language

Faction `visual` is genuinely consumed: `lib/world-lens/procedural-buildings.ts:248`
(`primary_color` → wall) and `:259-260` (`architecture_style` → silhouette bias),
`lib/world-lens/character-schema.ts:937-945` (NPC clothing), and
`components/world/FactionBanners.tsx:21-25` (SVG `sigil_path` rasterized to a banner).
This is the one authored→implemented→rendered chain that closes.

Two caveats: it renders through `MeshStandardMaterial` (PBR), not the locked toon
language; and the world-lens DTO that feeds `BuildingRenderer3D` —
`lib/world-lens/world-building-dto.ts:43-59` — **does not populate `faction_visual`**
(no match for it in that file, nor for `faction_visual` in
`app/lenses/world/page.tsx`). So faction-coloured buildings appear in the Foundry /
ConKay preview adapters but **not in the world lens itself**. Marked
**partially-verified**: what would settle it is running the world lens against a
seeded DB and inspecting a building material's colour.

### 3.7 Godot — the art spec is now readable, and still unreachable

**At HEAD (committed state), the Godot client honoured none of the art direction:**

- **Zero shader files.** `find world-lens-godot -type f` by extension: 64 `.gd`,
  64 `.uid`, 6 `.cfg`, 3 `.md`, 1 `.tscn`, 1 `.scn` — **no `.gdshader`, no `.tres`,
  no `.material`.**
- **Zero references** to `ART_STYLE`, `OUTLINE_WIDTH_M`, `RAMP_BANDS`,
  `GROUNDED_DIAL`, `OUTLINE_DARKEN`, `toonGradient`, `WORLD_SATURATION` or
  `CONCORDIA_THEMES` in any `.gd`/`.tscn`/`.godot` file.
- **Buildings spawn as untextured default-grey boxes with no material assigned at
  all** — `world/scene_bootstrap.gd:124-140` creates a `MeshInstance3D` + unit
  `BoxMesh` and sets a transform; there is no `material_override`, no albedo, no
  theme lookup. The file says so itself at `:11-12`: "Placeholder boxes are explicitly
  NOT a visual-quality claim."
- DTU props do get a material, but it is a hardcoded per-slot colour, not a world
  palette — `world/dtu_prop_renderer.gd:149-157` (`mat.albedo_color =
  DtuPropRenderer.slot_color(slot)`).
- **No `WorldEnvironment`, no `DirectionalLight3D`, no sky** anywhere in the committed
  tree; `scenes/boot.tscn` is a single `Node3D` with a script.
- **No UI layer at all** — no `CanvasLayer` or `Control` node anywhere.

**In-flight (uncommitted, written during this audit) — the gap is being closed, but
not yet at the render layer.** `scripts/gen-art-style-spec.mjs` now generates
`world-lens-godot/art_style.json` *from* `concordia-theme.ts` (with a `--check` drift
gate), and `world-lens-godot/world/art_style.gd` reads it: a real 3-band toon shader
with `bands` + `grounded_dial` uniforms (`art_style.gd:173-195`), HSV saturation
application (`:145-147`), `outline_color()` from shadow-band × `OUTLINE_DARKEN`
(`:162-168`), and per-world `Environment` + `DirectionalLight3D` construction
(`:239-274`). The generated spec carries all 12 themes and the full 9-entry
`worldSaturation` table. This is good, honest work — generated rather than hand-copied,
exactly as the guide demands.

**But the divergence persists, and the new file says so itself** at
`world/art_style.gd:23-25`:

> "It is NOT yet wired into `scene_bootstrap.gd`'s live spawn path."

*Corroborating evidence that the Godot render path had genuinely never been looked at:*
the same in-flight pass also fixed a basis-composition bug in `_spawn_node` —
`Basis().rotated(UP, r).scaled(s)` composes as `from_scale(s) * R` (Godot's `.scaled()`
applies along **parent** axes), so an 8×2 building at `rotationY = π/2` came out
re-stretched to 8 wide × 2 deep instead of 2 × 8: **the footprint of every rotated
building never rotated at all.** It was invisible to `gdparse`/`gdlint` and to every
unit test, and surfaced only once pixels were rendered and measured. A whole client
whose buildings were mis-oriented is the strongest possible confirmation that "compiles
and passes tests" was never evidence about what reaches the screen.

Verified independently (re-checked after that pass landed): the only caller of
`ArtStyle.*` anywhere in the Godot tree is
`world-lens-godot/tools/visual_probe.gd` (lines 207, 213, 222-232, 277, 295) — the
pixel-QA harness. **No gameplay renderer calls it.** `scene_bootstrap.gd:124-140` is
unchanged and still spawns material-less boxes. And `outline_width_m()`
(`art_style.gd:70-71`) is read by **nothing** — there is no inverted-hull, `grow`, or
`CULL_FRONT` geometry anywhere in the Godot client, so the outline half of the art
direction is still unimplemented there.

### 3.8 The two clients diverge from the spec in *opposite* directions

The sharpest structural finding: neither client implements the art direction, and they
fail at different halves of it — so there is no single reference implementation.

| Art-direction element | Web (React/Three) | Godot |
|---|---|---|
| Toon ramp, 3 bands | avatars only, **grayscale** ramp, band count hardcoded | shader exists w/ real `RAMP_BANDS`, **unreachable from spawn path** |
| Ink outline | avatars only, **proportional** not fixed-metre | colour computed, **no outline geometry at all** |
| `GROUNDED_DIAL` | **0 consumers** | shader uniform, unreachable |
| Per-world saturation | **0 consumers** | implemented, unreachable |
| Per-world `toonGradient` | never passed as a prop | implemented, unreachable |
| District palette / `lightingTag` | **not rendered** (2D table cell only) | parsed + altitude logic in `world/air_legibility.gd` |
| Faction `visual` | **rendered** (buildings/NPCs/banners), PBR | absent |
| Sky / sun / ambient | rendered (`SkyWeatherRenderer`, `sunDiskForWorld`) | in-flight, unreachable |
| Buildings | PBR boxes + procedural silhouettes | **untextured grey boxes** |

Note the inversion: **Godot has the district-palette logic the web client lacks
(`world/air_legibility.gd`), and the web client has the faction-visual and sky paths
Godot lacks.** The spec's own promise — "a small set of constants every render pass
reads, so styling never drifts per-component" (`ART_STYLE_GUIDE.md:11-13`) — is
currently inverted: styling has drifted per-*client*.

---

## 4. Bethesda-feel gaps

Judged against `docs/DESIGN_NORTH_STAR.md` §1's own five pillars.

### A. Compass discovery loop — **ABSENT, at the substrate level**

`DESIGN_NORTH_STAR.md:55-57` names this "**the retention hook (Track F2)**". It is the
one pillar with no substrate at all.

- **No compass exists.** The only `Compass` references in the frontend are a lucide tab
  icon (`app/lenses/world/page.tsx:16`), a presence-list activity icon
  (`components/world-lens/PlayerPresence.tsx:71`), and the isometric camera's
  NE/SE/SW/NW orbit buttons (`components/world-lens/ConcordiaScene.tsx:402-404`,
  `components/world-lens/CameraControls.tsx:176`). Tellingly,
  `components/world/concordia-hud/HUDContextProvider.tsx:129` documents *"Layer-1
  minimal HUD (HP/Compass/Quest)"* — **the compass in that comment does not exist.**
- **No discovered/undiscovered state exists in any of the 395 migrations.** The only
  `discover`-named tables are `secret_discoveries`
  (`server/migrations/154_secrets.js:41`) and `film_discovery_scores`
  (`server/migrations/021_film_studio.js:381`). There is no POI/landmark discovery
  table, no fog-of-war, no "found X of Y locations." **A compass HUD cannot be built
  on top of this** — there is nothing to mark as undiscovered.
- Every marker system present shows **already-known objectives or player-placed pins**:
  `server/lib/world-markers.js:9-12` (player-placed, 20/user, 1h TTL; migration
  `188_world_markers.js:8-19` has `placed_by`, no `discovered_by`);
  `components/world-lens/WorldMarkers.tsx:52` (quest/ally/enemy/ping/loot);
  `components/world/QuestWaypointBeacon.tsx:4-16` (a 3D light column at the **active**
  objective only). `components/world/QuestGuidanceHUD.tsx:6-13` is actively
  *anti*-discovery — it tells you where to go.
- The closest thing to the bar is `components/world-lens/LandmarkSpires.tsx:5-18`
  (Tsushima-style silhouette navigation, mounted at `page.tsx:5791`, backed by the real
  `worlds.anchors_for_world` macro at `server/domains/worlds.js:15`). But its own header
  notes no authored spire data exists, and it renders **all** named buildings —
  discovered or not — so it cannot pull a player toward the unknown, because nothing
  knows what is unknown.
- Godot has marker **math** and explicitly not the surface:
  `world/wayfinding_markers.gd:41-45` — "This produces the real DATA a wayfinding HUD
  would render… **not the HUD itself.**"

**One honesty flag surfaced here** (art-adjacent, worth recording):
`components/world/WorldEventBeacons.tsx:11-14` self-discloses that *"World events carry
no position in the backend today, so each event is anchored at a STABLE per-id position
(hashed into the district)"* — beacons for authored events point at **fabricated
coordinates**. Live gatherings do use real centroids (`:19-24`). The disclosure is
honest-by-construction in the comment, but a player cannot see the distinction.

**Verdict: ABSENT** — not authored, not implemented, nothing to render.
**Would settle it:** a `(user_id, poi_id, discovered_at)` table plus a bearing-sorted
HUD filtered to markers *not* in that set. Neither exists.

### B. Minimal HUD that fades on change — **THIN, and the sharpest contradiction**

**The bar is implemented correctly — in exactly one file.**
`components/world/concordia-hud/AmbientLayer.tsx` is a faithful reading of the B2 bar:
`HealthBar` returns null at `pct >= 80` (`:108`); `OxygenBadge` at `depth <= 4`
(`:119`); `PainBadge` at `pain <= 0` (`:132`); `RefusalBadge` below strength 6 (`:81`);
the whole layer unmounts in photo mode (`:30`). `components/concordia/StaminaWheel.tsx:42`
does the same (header at `:12-14`: *"Visible only when state != 'rest' OR value < max"*).
Caveat: these are **hard conditional unmounts, not fades** — instant pop-in, no opacity
transition on appearance (the only `transition-all` is the bar's width, `:112`).

**An idle-fade system was fully built and wired to zero consumers.**
`HUDContextProvider.tsx:122-131` builds idle detection implementing the "hide it if not
needed" rule, with a setter at `:242` and a driver at `:403-410`. Grepping `isIdle`
across `components/`, `app/`, `lib/`, `hooks/`, `store/` returns **5 hits, all inside
`HUDContextProvider.tsx` itself** (`:131, :220, :242, :403, :410`). **Zero HUD
components read it.** This is the exact same failure shape as the art constants in §3.0
— authored, implemented, tested into existence, and never connected to a render path.

**And it is drowned by always-on chrome.** `app/lenses/world/page.tsx` is **7,566 lines**
with **242 top-of-line JSX mounts**; ~145 of them are 2D HUD/panel/overlay surfaces
(after subtracting ~8 genuine 3D scene layers such as `TreeLayer`/`FootprintLayer`).
Only **16** sit behind a `SummonDrawer` — the "Summon" depth layer the B2 bar actually
sanctions. Unconditional surfaces include a **permanent top bar** (`HUDOverlay`, mounted
`page.tsx:5569`, rendering district name + mode + time + weather + player count +
notification bell, `components/world-lens/HUDOverlay.tsx:191-215`), a **permanent bottom
bar** (`StatusBar`, `page.tsx:7146`), `CurrencyHUD` (`:5385-5394`), `MapPingLayer`
(`:7186`), `DungeonHUD` (*"Always shows a 'Dungeons' launcher"*, `:7198-7202`), and
`QuestGuidanceHUD` whose own docstring says the "?" button is **"always on"**
(`components/world/QuestGuidanceHUD.tsx:8`).

The only escape is the **manual** `hudHidden` kill switch (`page.tsx:2066`, 26
occurrences, driven by the H-key / photo-mode `concordia:hide-hud` event at
`HUDContextProvider.tsx:139-152`). That is "the player turns the HUD off," not "the HUD
fades in on change."

**Verdict: THIN → bar violated.** "Glance shows almost nothing" is contradicted by a
persistent top bar and bottom bar before any other surface is counted.

### C. Radiant-AI NPC schedules — **REAL, end-to-end** (the strongest pillar)

The full chain verifies:

1. Deterministic 8-block day seeded by `sha1(npc_id + day_seed + preoccupation_signature)`
   — `server/lib/npc-routines.js:1-15`, `:39`.
2. **The schedule genuinely moves the NPC** — `:624-625` writes
   `UPDATE world_npcs SET current_location = ?` each advance, nudging
   `NUDGE_M_PER_TICK = 6` metres toward the block target (`:41`, `:614-623`).
3. **NPCs commute to their REAL assigned buildings**, not hashed points — `:543-556`
   resolves `world_npcs.home_building_id` / `npc_jobs.work_building_id` →
   `SELECT x, z FROM world_buildings`.
4. Needs decay drives goal selection over real POIs, and arrival satisfies them
   (`:530-533`, `:634-641`) — closing goal→walk→act→satisfy.
5. No statues: `idlePaceTarget` (`:546-552`) ambles an arrived NPC within 2.5 m.
6. Heartbeat live at `frequency: 5` — `server/server.js:1019-1027`, warm passes at
   boot+8s/+20s (`:34437-34439`).
7. Route joins it: `server/routes/worlds.js:856-880` LEFT JOINs `npc_routine_state`,
   returning `currentActivity` (`:900`) and position from `current_location` (`:896`).
8. Client polls every 10 s (`app/lenses/world/page.tsx:2907-2949`).
9. **Rendered three ways** — `NPCActivityTag` emoji above the head
   (`page.tsx:5355-5366`, `components/world/NPCActivityTag.tsx:27-36`, 12 m radius);
   NPC meshes **lerped** between polls so it reads as walking not teleporting
   (`components/world-lens/AvatarSystem3D.tsx:2380`, `:3200`); and activity→animation
   clip mapping (`lib/concordia/npc-activity-anim.ts:16-35`).

This also satisfies `DESIGN_NORTH_STAR.md:42-47`'s "surface as world-flavor, not a
debug feed" invariant.

**The one gap:** `sleep`, `rest`, `patrol`, `train`, `wander` map to a **null** animation
verb (`npc-activity-anim.ts:31-34`, "passive — locomotion/idle only"). So an NPC walks
home, the ☾ tag says "sleeping" — and the body stands upright and *slowly paces* in a
2.5 m circle, because `idlePaceTarget` applies to any arrived NPC regardless of activity
(`npc-routines.js:546`). A sleep/sit pose is the single highest-value fix to the
strongest pillar.

### D. Lived-in world + ownership — **THIN (split verdict)** — correcting an earlier read

My initial pass found no 3D ownership renderer; that was wrong, and the correction
matters:

- **Land claims ARE rendered in 3D.** `lib/world-lens/claim-boundary-renderer.ts:1-18`
  draws a ground ring of `radius_m` at `(anchor_x, anchor_z)` plus a centre banner pole,
  status-tinted, from real `land_claims` rows. It is genuinely mounted:
  `attach-world-renderers.ts:109`, called from the live scene at
  `components/world-lens/ConcordiaScene.tsx:1454-1457` — the same mount point that
  renders crops, resource nodes, creatures, vehicles, construction progress and corpses.
- **Player housing + furniture is 2D only.** `app/lenses/housing/page.tsx:10` states it
  outright: *"Per-coord furniture placement uses a 2D grid editor (top-down view of the
  room)."* Layout renders as HTML divs (`:540`); `components/world/BuildingInterior.tsx:212-214`
  renders `room.furniture` as a **text list**. No 3D house or furniture renderer exists.
  **Furniture a player places is invisible from inside the world** — the single clearest
  ownership gap.
- Interiors are procedural, not player-authored: `lib/world-lens/interior-decor.ts:1-27`
  is explicitly a *"SUBSTRATE FALLBACK"* (tavern→fireplace+table, forge→anvil+bellows),
  its header noting player-authored interiors *"override the procedural layout once they
  win marketplace canon"* — i.e. aspirational, not shipped.
- Lived-in signals that **do** render: `WorldSigns` (Dark-Souls-style player signs, 5
  kinds, B to place, socket fan-out — `components/world/WorldSigns.tsx:23-29`, mounted
  `page.tsx:5381`), `BuildingWearLayer` (`:5906`), `FootprintLayer` (`:6101`),
  `FactionBanners` (`:5914`), `TombsOverlay` (`:5875`), `CorpseMarkerOverlay` (`:6897`).

### E. Day/night + weather — **REAL**, with the sleep-pose gap

`SkyWeatherRenderer` mounted at `page.tsx:5229-5246` driven by the live socket world
clock (`worldPhaseForSky`, `:2217`; documented at `HUDContextProvider.tsx:149-152` as
socket-populated "so the visible sky / sun position / particle bias / star field actually
update"), threaded into `WaterRenderer` too (`:5258` — replacing a previously hardcoded
fixed-noon value), with a real per-world sun disk via `sunDiskForWorld(worldIdForTheme)`
(`:5245`). Weather type + intensity come from the `world:weather` socket event
(`:3873-3883`, sourced from `server/lib/weather.js`) mapped to six render modes
(`:5231-5239`) and also feeding `SoundscapeEngine` (`:5277`).

**NPCs go home: yes. NPCs sleep: no** — see §C's null-verb gap.

### Pillar scorecard

| Pillar | Verdict |
|---|---|
| 1. Go-anywhere world | **THIN** — mounted and traversable, but a hard-bounded 2 km × 2 km box |
| 2. Compass discovery loop | **ABSENT** — no compass, and no discovered/undiscovered state in 395 migrations |
| 3. Minimal HUD, fade-on-change | **THIN → violated** — correct in 1 file, idle-fade built with 0 consumers, ~145 surfaces + permanent top/bottom bars |
| 4. Radiant-AI schedules | **REAL** — simulated, moved, polled, lerped, tagged and animated (gap: no sleep pose) |
| 5. Lived-in + ownership | **THIN** — claims + signs + wear render in 3D; housing/furniture 2D only |

**Runtime caveat.** Everything in §4 is static code reading; the app was not run (another
agent holds the render harness). Mount sites, socket subscriptions and DB writes are all
present. What would settle §B definitively: a Playwright walk (the repo has
`playwright-walk.config.ts`) screenshotting at t=0 and counting visible chrome.

---

## 5. Ranked gap list — by leverage

Ordered by visible impact per unit of work. Items 1–3 are hours-to-days and change how
the entire game looks; they are the same "single biggest visual win" the project's own
plan already identified (`CONCORDIA_PLAN.md:1052-1053`).

**1. Thread `renderStyle` + `toonGradient` into the world-lens building call site.**
One prop pair at `app/lenses/world/page.tsx:5220-5223`. Today the PBR/Toon toggle
silently does nothing for buildings and every world gets the same hardcoded blue-grey
ramp. This is the highest visual-change-per-line edit in the codebase.

**2. Flip the render-style default from `pbr` to `toon`** (`page.tsx:2243`,
`BuildingRenderer3D.tsx:141`). A locked anti-photoreal art direction that ships PBR by
default is not shipped. This is a one-word change that makes the thesis the default
experience rather than an opt-in preview.

**3. Apply `applyCelShade` beyond avatars — buildings, props, trees, rocks, creatures.**
Exactly `ART_STYLE_GUIDE.md:41-43` rule 1 and `CONCORDIA_PLAN.md`'s G1.1 "applied
**uniformly**". Currently avatars are outlined and everything around them is PBR, which
reads worse than either style committed to fully — the "half-committed realism prototype
tell" the plan already diagnoses at `CONCORDIA_PLAN.md:1049-1051`.

**4. Wire `saturationForWorld()` into the render path.** Zero consumers today. This is
the guide's own named mechanism for "9 worlds read as 9 moods without becoming 9 art
styles" (`ART_STYLE_GUIDE.md:24-26`) and it currently changes nothing. Highest
identity-per-effort item after the toon switch.

**5. Wire Godot's new `ArtStyle` into `scene_bootstrap.gd`'s spawn path.** The reader,
generated spec, toon shader and environment builder now exist and are pixel-verified,
but the only caller is the QA probe (`art_style.gd:23-25` admits this). Until
`_spawn_node` (`scene_bootstrap.gd:124-140`) calls `make_toon_material(world_id)` and
`boot.gd` installs `make_environment()` + `make_sun()`, the Godot client renders
untextured grey boxes under no lighting.

**6. Consume the idle-fade that is already built.** `HUDContextProvider.tsx:122-131,
242, 403-410` implements idle detection with **zero consumers** — `isIdle` is read by no
HUD component. Wiring the existing ~145 always-on surfaces (starting with `HUDOverlay`'s
permanent top bar, `page.tsx:5569`, and `StatusBar`, `:7146`) to the flag that already
exists is the cheapest possible move toward the B2 bar. `AmbientLayer.tsx` already shows
the correct pattern; this is propagation, not invention.

**7. Give NPCs a sleep/sit pose.** `npc-activity-anim.ts:31-34` maps `sleep`/`rest` to a
null verb, so an NPC that has correctly walked home to its real `home_building_id` stands
upright and *paces* under a ☾ "sleeping" tag (`npc-routines.js:546`). This is a one-clip
fix to the strongest, most-expensive-to-build pillar — the highest feel-per-effort item
in the audit.

**8. Build the compass/discovery loop — substrate first.** The largest *feel* gap and the
named retention hook (`DESIGN_NORTH_STAR.md:55-57`). Note this is **not** a HUD task:
there is no discovered/undiscovered state anywhere in 395 migrations, so a compass has
nothing to mark. Order is (a) a `(user_id, poi_id, discovered_at)` table, (b) a bearing
HUD filtered to markers *not* in it, (c) reuse Godot's existing marker math
(`wayfinding_markers.gd`) and `LandmarkSpires.tsx` as the 3D half.

**9. Give `sere` a theme + saturation entry.** One `CONCORDIA_THEMES` entry + one
`WORLD_SATURATION` row (`concordia-theme.ts:136-348`, `:406-417`). The best-written
world in the game currently renders in a fallback neon-noir palette. Also correct
"9 worlds" → 10 in `ART_STYLE_GUIDE.md:9, :26`.

**10. Fix the outline unit bug.** `OUTLINE_WIDTH_M` is documented in metres and applied
as a proportional scalar (`cel-shade.ts:97`), so outline weight varies with mesh size —
the per-asset drift the rule forbids. Needs a screen-space or fixed-world-space outline,
not a hull `setScalar`.

**11. Reconcile the conflicting art-direction header** at `concordia-theme.ts:10-14`.
Its "PBR for the player + named NPCs" line contradicts the locked global-dial rule
(`ART_STYLE_GUIDE.md:48-50`) and sits directly above the constants it contradicts.

**12. Route authored district palettes into the terrain/building renderers.**
`server/lib/districts.js:114-156` authors 6 real palettes + lighting tags that today
reach only a 2D table cell (`world-observatory/page.tsx:549`); the web terrain instead
derives zones from building rows (`page.tsx:4817-4820`).

**13. Populate `faction_visual` in the world-lens building DTO**
(`lib/world-lens/world-building-dto.ts:43-59`). Faction colours + architecture styles
already render in the Foundry/ConKay adapters; the world lens itself does not feed them
in, so the one axis with genuinely styled authoring is invisible where it matters most.

**14. Add renderable visual data to NPC authoring.** 0 of 300 NPCs carry any
machine-consumable visual field, and 3 primary-cast files have no appearance authoring
at all. The cheapest honest step is deriving appearance from the *existing* faction
`visual` palette (already wired for clothing at `character-schema.ts:937-945`) rather
than authoring 300 records — then backfilling the 34 primary-cast NPCs by hand.

**15. Render player furniture in 3D.** Housing placement is a 2D top-down grid editor by
its own admission (`app/lenses/housing/page.tsx:10`), and `BuildingInterior.tsx:212-214`
renders furniture as a **text list** — so what a player places in their home is invisible
from inside the world. The land-claim renderer
(`lib/world-lens/claim-boundary-renderer.ts`, mounted via
`attach-world-renderers.ts:109`) is the working precedent to copy.

---

## Appendix — reproduction commands

```bash
# Locked constants and their consumers (expect: 4 of 5 return only the test file)
grep -rn "RAMP_BANDS\|GROUNDED_DIAL\|OUTLINE_DARKEN\|saturationForWorld" \
  concord-frontend/ --include=*.ts --include=*.tsx \
  | grep -v "lib/world-lens/concordia-theme.ts"

# toonGradient production call sites (expect: none)
grep -rn "toonGradient=" concord-frontend/ --include=*.tsx

# Godot shader files (expect: none at HEAD)
find world-lens-godot -name "*.gdshader" -o -name "*.tres" -o -name "*.material"

# Godot art-spec consumers (expect: only tools/visual_probe.gd)
grep -rn "ArtStyle\." --include=*.gd world-lens-godot/ | grep -v world/art_style.gd

# Godot outline geometry (expect: none)
grep -rn "outline_width_m\|CULL_FRONT\|grow" --include=*.gd world-lens-godot/

# Worlds without a theme entry (expect: sere)
for w in $(ls -d content/world/*/ | xargs -n1 basename); do
  grep -q "'$w'" concord-frontend/lib/world-lens/concordia-theme.ts || echo "$w: NO THEME"
done

# NPC visual-field census (expect: 144/300 appearance, 0 renderable)
python3 - <<'PY'
import json,glob,collections
c=collections.Counter(); n=0
for f in glob.glob('content/world/*/npcs*.json')+['content/world/npcs.json']:
    for o in json.load(open(f)):
        n+=1; c.update(o.keys())
print('npcs',n,'appearance',c['appearance'],
      'renderable',sum(c[k] for k in ('model','mesh','portrait','texture','color')))
PY

# Hub building visual fields (expect: 60 buildings, 9 fields, none visual)
python3 -c "import json;b=json.load(open('content/world/concordia-hub/city-layout.json'))['buildings'];print(len(b),sorted(b[0].keys()))"
```
