# World-creator scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/world-creator.js` (+ `server/routes/worlds.js` POST `/`, `server/lib/world-seeder.js`, `concord-frontend/app/lenses/world-creator/page.tsx`, `app/lenses/world-creator/anomalies/page.tsx`, `components/world-creator/*`). Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

Requested as READ-ONLY code scope check for Lens Tester 2 after claiming `world-creator` (criteria/world-creator.md). Creates held until this answer — especially paid/GPU, publish/discover, playtest mint into `worlds` / concordia-hub-shaped spawning, `_lensEmitDTU` (FIX-xl-ws-001), and delete path.

**Slug confirmed:** `world-creator` (route `/lenses/world-creator`; domain macros `world-creator.*`). Adjacent but separate: `foundry`, `world`, `worldmodel`, `sub-worlds`, `world-observatory`.

## Model — private draft authoring + optional mint into shared `worlds`

| Layer | UI | API path | Storage |
|-------|-----|----------|---------|
| **Draft gallery / templates** | `DraftGallery.tsx` Blank draft / template cards / Your drafts / Discover | `POST /api/lens/run { domain:'world-creator', action:'draft-create'\|'draft-list'\|'templates'\|'discover' }` | Per-user `STATE.worldCreatorLens.drafts` Map (`userId → draft[]`) — key `worldCreatorLens` is in `LENS_STATE_KEYS` (`lens-state-persistence.js:213`) so snapshot survives restart |
| **Scene editor** | `DraftEditor.tsx` + `SceneCanvas.tsx` (props / spawns / zones / NPCs / factions) | `prop-*`, `spawn-*`, `zone-*`, `npc-*`, `faction-*`, `draft-update`, `draft-get` | Same owner-scoped draft array |
| **Biome / climate preview** | `BiomePreview.tsx` + biome tab | `biomes`, `biome-preview` | Pure compute from static `BIOMES` table — **no GPU / image gen** |
| **Publish / privacy** | Publish tab visibility buttons | `draft-publish` | Mutates draft `visibility` (`private`\|`unlisted`\|`public`); public drafts appear in `discover` across creators |
| **Playtest mint** | ▶ Playtest button | `playtest-check` then **`POST /api/worlds`** (`DraftEditor.tsx:182–207`; `worlds.js:222–254`) | Inserts live `worlds` row (`world-<uuid>`), seeds content, founding grace, **native emergent spawn**; links `publishedWorldId` on draft |
| **Inspiration** | Inspiration tab (feature-flagged) | Reddit fetch + optional `SaveAsDtuButton` | External read; DTU mint if Save pressed |
| **Anomalies subpage** | `/lenses/world-creator/anomalies` | `GET /api/anomalies/public`, `GET/POST /api/anomalies/world/:id…` | Platform anomaly tables; resolve/dismiss gated by world ownership |

### Shared runtime facts

- Domain registers **23** macros in `world-creator.js` (loaded through `server/domains/index.js`). Actor gate: `aid(ctx) = ctx?.actor?.userId || ctx?.userId || "anon"` (`:37`); writes wrapped with `guardAnonWrites` (`:18`).
- Drafts are **owner-scoped** (`findDraft` only searches `s.drafts.get(userId)`, `:161–163`). Strangers cannot load/update/delete another user's draft via these macros.
- `world-creator` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775`).
- `world-creator` is **NOT** in `FRONTEND_ARTIFACT_TYPES` (`lens-artifact-types.js:21–63`) — real CRUD does **not** go through generic `lens.create` / `_lensEmitDTU`. Anomalies page's `useArtifacts('world-creator', { type:'view-event' })` is unused / voided (`anomalies/page.tsx:38–40`).
- **FIX-xl-ws-001 / `_lensEmitDTU`:** domain macros do **not** call `_lensEmitDTU` or `realtimeEmit`. **Exception:** Inspiration `SaveAsDtuButton` and any LensShell Mint/Publish are separate DTU paths — prefer skip.
- Default `universeType` on create is **`"concordia-hub"`** (`world-creator.js:243`). Playtest posts that as `universe_type` on a **new** `worlds` row (`playtest-check` worldPayload `:643–649`) — it does **not** mutate the shared hub row itself, but the type label and the shared-table insert are still (d)-class for QA.
- Caps: name 64 / ≥3 (`:224–225`); description 500; props 500; spawns 32; zones 48; NPCs 200; factions 24; rules clamped 0.5–1.5 (`:154–159`); prop coords ±250.
- Seeds: 8 in-code templates (`TEMPLATES` `:56–145`); 8 biomes (`BIOMES` `:45–54`). No disk `content/` write from draft macros.

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/world-creator/page.tsx:41–51` via `useLensCommand`:

| Key | Action |
|-----|--------|
| `Escape` | Back to drafts / clear editingDraft |
| `1` | Drafts view |
| `2` | Inspiration view (when community Reddit flag on) |

**RC1: PARTIAL — digits `1`/`2`, no bare letters.** Unlike Foundry (`n`) / Environment Field Ops, there is **no** bare-letter `useLensCommand` binding. Digits can still steal when typing numbers (zone radius, NPC level, prop rotation, terrain seed) if the form-field guard fails. `useLensCommand` skips INPUT / TEXTAREA / SELECT / `contentEditable` unless `global` (`hooks/useLensCommand.ts:43–49,147–154`). Create-name / NPC-name / description use `<input>` / `<textarea>` — guard *should* hold. Still ticket as RCA-class if live typing of digits jumps tabs.

**RC2: NO** in world-creator components — `rg role="button"` over `app/lenses/world-creator/` + `components/world-creator/` is empty. NPC place panel is `role="dialog"` with Escape cancel (`DraftEditor.tsx:579`). Enter in NPC name submits the form intentionally (`:590`) — not RC2.

**Delete confirm: YES** for drafts — `window.confirm('Delete this draft? This cannot be undone.')` then `draft-delete` (`DraftEditor.tsx:457–465`). Entity Delete (prop/spawn/zone/npc) has **no** confirm (`:333–336`).

## Answers to the policy questions

### Is there a delete path? (creates KEEP_BLOCKED?)

**Yes for drafts** — `draft-delete` hard-splices the owner draft (`world-creator.js:309–318`) with UI confirm. Creates are **not** KEEP_BLOCKED for cleanup reasons.

**No for playtest-minted worlds** — `draft-delete` does **not** delete the linked `worlds` row / seeded content / emergent. There is no world-creator UI to unpublish or DELETE `/api/worlds/:id` after Playtest. → **Playtest creates are KEEP_BLOCKED**.

### Does playtest / publish spawn into shared worlds (concordia-hub) or broadcast?

1. **Playtest** → `POST /api/worlds` inserts a new `worlds` row, `seedWorldContent`, founding grace, `spawnWorldNativeEmergent` (`worlds.js:227–253`). Shared global table; playable via World lens. Default `universe_type: "concordia-hub"` is a **type label** on the new row, not an edit of the hub — still **BLOCKED-by-policy** (shared mint / residual orphan).
2. **`draft-publish` visibility `public`/`unlisted`** → public drafts listed by `discover` to all creators (`:592–613`). **BLOCKED.** `private` only flips a flag on the owner draft — OK if never playtested.
3. **No `_lensEmitDTU` / global WS** on draft create/edit.
4. **Discover** is read of others' **public** drafts — SAFE_READ browse only; do not open/edit others' content.

### Paid / GPU / generation?

**None** on the world-creator macro surface. `biome-preview` is deterministic climate math (`:188–216`). Terrain fields are numeric seed/roughness/waterLevel — **not** GPU terrain generation. No billing, credit, LLM, agent-deploy, or code-exec macros in `world-creator.js`. Inspiration SaveAsDtu = prefer skip (DTU / FIX-xl-ws-001).

## Overlap with Foundry (`SCOPE-foundry-2026-11-09.md`)

| | **world-creator** | **foundry** |
|--|-------------------|-------------|
| Draft store | `worldCreatorLens.drafts` (LENS_STATE snapshot) | SQLite `foundry_worlds` |
| Authoring focus | Top-down scene (props, spawns, zones, NPCs, factions, biome, rule modulators) | Systems / worldspec / blueprints / multiplayer config |
| Private create | `draft-create` — **SAFE + deletable** | `foundry.create` draft — **SAFE + deletable** |
| Mint into `worlds` | **Playtest** → permanent `POST /api/worlds` (no preview status) | **publish** → `worlds` status=`active`; **preview/playtest** → status=`preview` + end/2h sweep |
| Marketplace / rate / collab | discover (read public drafts only) | marketplace, rate, track_play, collab_add — more (d) surface |
| Hotkeys | Digits `1`/`2` + Escape (no bare letter) | Bare-letter `n` + digits `1`/`2`/`3` |
| Delete confirm | Draft: yes (`window.confirm`); entities: no | Draft: **none** |

**Do not** treat a Foundry draft and a world-creator draft as the same object. Do not Playtest here to "preview" the way Foundry preview works — cleanup is worse (no preview_end).

## Misleading / adjacent CTAs

- **Blank draft / template card** → real private `draft-create` — honest; **preferred QA create**.
- **▶ Playtest** → mints a real `worlds` row and navigates to World lens — looks like a sandbox; is a shared-table mint — **BLOCKED / KEEP_BLOCKED**.
- **Visibility Public / Unlisted** → discovery listing — **BLOCKED**.
- **Discover / Browse** → read-only public drafts — OK to browse; do not interact beyond search.
- **Check world anomalies** CTA → anomalies subpage; resolve/dismiss mutate platform anomaly rows — **prefer skip** (and only ever against an owned QA world you somehow already have; do not invent world IDs).
- **Inspiration Save as DTU** → prefer skip.
- LensShell Publish/share / Ask / Mint — standing rules.

## Verdict table — world-creator actions (user-visible)

| Action | Bucket | Delete / reverse | Side effects | Verdict |
|--------|--------|------------------|--------------|---------|
| **templates / biomes / biome-preview / draft-list / draft-get** | read | n/a | Owner-scoped or static catalog | **SAFE_READ** |
| **discover** | read of **others' public** drafts | n/a | Lists `visibility==='public'` across creators | **SAFE_READ** (browse only) |
| **draft-create** (Blank / template) | **(a) SAFE private** | **Yes** `draft-delete` + confirm | Per-user map; default visibility `private`; default `universeType` `concordia-hub` (label only); **no** `_lensEmitDTU` | **SAFE_PRIVATE_DELETABLE** |
| **draft-update** (name/desc/biome/rules/terrain) | **(a)** | via draft delete | Owner draft patch | **SAFE_PRIVATE** |
| **prop-place/move/remove, spawn-*, zone-*, npc-*, faction-*** | **(a)** | entity remove / draft delete | Owner draft only | **SAFE_PRIVATE** |
| **playtest-check** (Run check only) | read/compute | n/a | No persist; returns readiness + worldPayload | **SAFE_READ** |
| **▶ Playtest** (`POST /api/worlds` + draft-publish link) | **(d) shared `worlds` mint** + residual | draft-delete does **not** remove world | Seeds DB, founding grace, native emergent; opens World lens | **KEEP_BLOCKED / BLOCKED-by-policy** |
| **draft-publish visibility=private** (flag only, no Playtest) | **(a)** | flip again / delete draft | Owner flag only | **SAFE_PRIVATE** |
| **draft-publish visibility=unlisted\|public** | **(d) discoverable** | set back to private | Appears in `discover` when public | **BLOCKED-by-policy** |
| **draft-delete** | **(e) destructive** but own | n/a | Hard delete draft; leaves any minted `worlds` row | **OK as cleanup** of own QA draft (confirm present) |
| **Anomalies public log** | read | n/a | Aggregates only | **SAFE_READ** |
| **Anomalies load/resolve/dismiss** | **(d)/(e)** platform write | no undo of resolve | Needs owned worldId; mutates shared anomaly status | **Prefer skip / BLOCKED** unless cleaning a prior forbidden mint |
| **SaveAsDtu** (Inspiration) | private DTU default | DTU library delete if available | Generic DTU mint → **FIX-xl-ws-001** risk | **Prefer skip** |
| **Export** | — | — | **No export UI/macro found** | n/a (criteria said no export — nothing to exercise) |

### Paid / GPU / credits

**None found** on world-creator macros or DraftEditor/Gallery. Biome preview = math. Terrain = sliders. No Workers AI / Ollama / LLM. Stop if any cost UI appears on adjacent LensShell Ask.

## Private AND deletable (qualify for a single QA write)

| Qualify | Notes |
|---------|-------|
| **draft-create → private draft** | Name `QA LT2 world-creator 2026-11-09 <thing>` (≥3 chars) → Blank draft or template → edit scene/biome/rules → reload → **Delete draft** (confirm). **Preferred.** |
| **prop/spawn/zone/npc/faction + draft-update + biome-preview + playtest-check** | Only against that own QA draft. Delete draft when done. |
| **templates / biomes / draft-list / discover browse** | Read-only OK. |

## Keep BLOCKED / do not write

1. **▶ Playtest** — mints live `worlds` row + seed + emergent; no in-lens delete (`DraftEditor.tsx:182–207`; `worlds.js:222–254`).
2. **Visibility Public / Unlisted** — discovery exposure (`draft-publish` `:571–588`; `discover` `:592–613`).
3. **SaveAsDtu** on Inspiration — prefer skip (DTU / FIX-xl-ws-001).
4. **Anomalies resolve/dismiss** — prefer skip; never type non-QA / other users' world IDs.
5. LensShell Publish/share, emails, SMS, payments, agent deploy, paid Ask — standing rules.
6. Do **not** playtest "just to see" and rely on draft-delete — the world row remains.
7. Do **not** set `universeType` / playtest into anything meant to join or alter shared hub play (default label is already `concordia-hub`).

## Validation / form test hints

- **draft-create:** name required ≥3 after trim, max 64 (`:224–225`); empty UI name becomes `"Untitled world"` (`DraftGallery.tsx:76`) which passes ≥3; template id must be known or ignored; unknown biome falls back to `temperate_forest` on create (`:226`).
- **draft-update name:** short names (<3) silently ignored (`:290`) — good validation gap to ticket if UI allows saving 1–2 char renames.
- **description:** sliced to 500 (`:291`); NPC backstory max 600 (`:493`; UI `maxLength={600}`).
- **biome-preview:** unknown biome → `unknown biome: …` (`:192`); weatherIntensity clamped 0.5–1.5; fuzz contract allows Infinity coercion — check live clamp.
- **prop-place:** unknown kind rejected; limit 500 (`:327–329`).
- **zone-add:** kind enum `safe|hazard|social|combat|quest|neutral`; radius 5–250 (`:432–440`).
- **npc-place:** name required; archetype enum; level 1–100 (`:485–495`).
- **faction-add:** name required; limit 24 (`:539–541`).
- **draft-publish:** visibility must be `private|unlisted|public`; non-private needs ≥1 spawn (`:576–581`).
- **playtest-check:** issues if no spawn or name <3; warnings for empty props/NPCs/zones (`:622–631`).
- **RC1:** when typing create name (letters OK — no bare-letter binds) watch **digits** in radius/level/rotation/seed for tab jumps to Drafts/Inspiration.
- **RC2:** not present; Escape closes NPC dialog and backing out of editor (page-level Escape also clears editingDraft — may feel abrupt while in a nested dialog).
- **Escape / focus:** NPC dialog Escape = cancel; page Escape = leave editor entirely — check which wins when dialog open.
- Persistence: create → hard reload → still in draft-list (`worldCreatorLens` snapshot). Delete → gone from list.
- Mobile: canvas + inspector grid (`lg:grid-cols`) — expect cramped layout / clipped tabs worth checking at 390×844.

## Gaps / notes

- Playtest mint has **no preview status / preview_end / 2h sweep** (unlike Foundry) — orphans are permanent until a separate worlds delete path is used (none in this lens UI).
- `draft-delete` after a forbidden Playtest leaves `worlds` + seed + emergent behind — leftover risk if anyone already playtested on the shared QA account.
- `universeType` is not exposed as an editor control in DraftEditor UI (only shown on discover cards) — always defaults to `concordia-hub` unless API-passed.
- Two "publish" words: draft visibility publish ≠ Foundry publish ≠ `/api/foundry/world/publish`.
- No export path to test (criteria exclusion matches code absence).
- Live not proven: whether production has `worldCreatorLens` snapshot for the QA account; whether any prior playtest-minted QA worlds already exist in `worlds`.

## Summary for tester

**OK for one QA call + delete** (title `QA LT2 world-creator 2026-11-09 …`):
- **Blank draft or template** → place prop/spawn/zone/NPC/faction → tweak biome + rules + terrain → biome-preview → **Run check** (playtest-check only) → hard reload → **Delete draft** (confirm).
- Optional reads: templates, biomes, discover browse, anomalies public log.

**BLOCKED-by-policy / KEEP_BLOCKED:** ▶ Playtest (`POST /api/worlds`), visibility Public/Unlisted, SaveAsDtu (prefer), anomalies resolve/dismiss (prefer).

**No paid/GPU/credit actions** on this lens authoring surface. Biome preview is free deterministic math. **RC1: digits `1`/`2` only (no bare letters).** **RC2 not present.** **Delete path exists for drafts** → creates allowed (not KEEP_BLOCKED for cleanup). **Playtest mint has no delete** → KEEP_BLOCKED.

**Foundry overlap:** sibling builder; different draft store; Foundry preview is cleaner to reverse than world-creator Playtest — do not cross-wire QA fixtures.

Code-only verdict; not live-proven.
