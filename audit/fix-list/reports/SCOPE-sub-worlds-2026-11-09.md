# Sub-worlds scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/sub-worlds.js` (+ `server/lib/sub-world-starter-content.js`, `concord-frontend/app/lenses/sub-worlds/page.tsx`, `components/sub-worlds/*`). Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

Requested as READ-ONLY code scope check for the sub-worlds lens (criteria/sub-worlds.md style). Writes held until this answer — especially default-public spawn, discover/Enter of others' worlds, invite_editor, worlds-table mirror + starter NPCs, SaveAsDtu (FIX-xl-ws-001), and delete path.

**Slug confirmed:** `sub-worlds` (route `/lenses/sub-worlds`; domain macros `sub_worlds.*` underscore). Adjacent but separate: `world-creator`, `foundry`, `world`, `worldmodel`, `world-observatory`. Legacy singular `sub_world` macros in `server.js` (`spawn_from_forge`, `list`) write a **different** SQL `sub_worlds` table — frontend never calls them; do not exercise.

## Model — per-user creator platform + public discovery + worlds mirror

| Layer | UI | API path | Storage |
|-------|-----|----------|---------|
| **Spawn** | `SpawnPanel.tsx` | `POST /api/lens/run { domain:'sub_worlds', action:'spawn' }` | Per-user `STATE.subWorldsLens.worlds` Map (`userId → world[]`). Key `subWorldsLens` is in `LENS_STATE_KEYS` (`lens-state-persistence.js:210`) so snapshot survives restart. **Also** best-effort `INSERT INTO worlds` mirror (`:64–76`) + `seedSubWorldStarterContent` → modulators + 2 `world_npcs` (`:351`; `sub-world-starter-content.js`) |
| **My Worlds / Discover / Favorites** | `GalleryPanel.tsx` + `WorldCard.tsx` | `list`, `discover`, `my_favorites`, `favorite` | Owner list is private store (+ B15 bridge of own world-creator drafts + own unclaimed `worlds` rows). Discover unions **public** store worlds + public world-creator drafts + active `worlds` table rows |
| **Settings / status / archive** | `WorldSettingsPanel.tsx` | `update_settings`, `set_status`, `archive` (`hardDelete`) | Owner/editor gated; hardDelete splices STATE + `DELETE FROM worlds` (`:500–507`) — **does not** delete seeded `world_npcs` |
| **Enter / visit** | WorldCard Enter → `visit` then `travelHook.travel` → `/lenses/world` | `visit` | Increments visits / visitLog; returns `travel.destination_world_id` for real world-travel |
| **Co-editors** | Settings Invite | `invite_editor`, `remove_editor` | Owner-only; up to 20 editor user ids on the world |
| **In-place editor** | `WorldEditorPanel.tsx` | `editor_state`, `editor_add_block`, `editor_remove_block` | Blocks on owner world (cap 500); types terrain/spawn_point/prop/script/zone/light |
| **Analytics** | `WorldAnalyticsPanel.tsx` | `analytics` | Owner/editor read of visit timeline (UTC day buckets) |
| **Repos pulse** | `MetaverseRepos.tsx` | Client GitHub search + optional `SaveAsDtuButton` | External read; DTU mint if Save pressed |

### Shared runtime facts

- Domain registers **15** macros in `sub-worlds.js` (dual-bus LENS_ACTIONS + MACROS mirror, `:35–48`). Actor gate: `actor(ctx) = ctx?.actor?.userId || ctx?.userId || "anon"` (`:110`); writes wrapped with `guardAnonWrites` (`:22`).
- Store worlds are **owner-scoped** for create (`userWorlds(s, actor)`); `findWorld` scans all users by id for visit/favorite/settings. Strangers cannot `update_settings` / editor / archive without `canEdit` (owner or editors list) (`:142–145`).
- `sub_worlds` / `sub-worlds` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775`).
- `sub_worlds` is **NOT** in `FRONTEND_ARTIFACT_TYPES` — real CRUD does **not** go through generic `lens.create` / `_lensEmitDTU`.
- **FIX-xl-ws-001 / `_lensEmitDTU`:** domain macros do **not** call `_lensEmitDTU` or `realtimeEmit`. **Exception:** MetaverseRepos `SaveAsDtuButton` — prefer skip.
- **Default privacy on spawn is `public`** (`sub-worlds.js:321`; `SpawnPanel.tsx:15` form default `'public'`). Private is opt-in — QA **must** set `privacy: 'private'` or the create is discoverable.
- Caps: name ≥3 / max 120 (`clean` `:111`, spawn `:318–319`); description 1000; thumbnail 600; capacity 1–200 (`:331`); editors 20 (`:707`); blocks 500 (`:762`); discover limit default 60 (`:438`). `badNumericField` rejects non-finite / negative / >1e6 for capacity/limit (`:118–124`).
- Kinds: `physics_simulator` \| `research_zone` \| `concord_substrate`. Status: `active` \| `paused` \| `archived`.
- **No** portal / parent-world link / playtest / publish macros in this domain. "Publish" = privacy flip via `update_settings`. Playtest mint lives in **world-creator** (bridged into Discover/My Worlds when public / owned).
- B15 discovery union is **read-only** across populations — does not write into world-creator drafts.

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/sub-worlds/page.tsx:35–43` via `useLensCommand`:

| Tab label key | Actual bound keys | Action |
|---------------|-------------------|--------|
| `1` Discover | **`g d`** (chord) | setActive discover |
| `2` My Worlds | **`g m`** (chord) | setActive mine |
| `3` Favorites | `3` | setActive favorites |
| `4` Spawn | `4` | setActive spawn |
| `5` Repos | `5` | setActive repos |

Tab chrome still **displays** digits `1`–`5` (`VIEWS` `:22–28`; NorthStarFrame shows `t.keys`), but bindings for Discover/Mine were remapped to `g d` / `g m`. Digits `3`/`4`/`5` remain bare.

**RC1: PARTIAL — bare digits `3`/`4`/`5`; no bare letters.** `useLensCommand` skips INPUT / TEXTAREA / SELECT / `contentEditable` unless `global` (`hooks/useLensCommand.ts:43–49,147–154`). Spawn name / description / capacity and Settings fields use `<input>` / `<textarea>` / `<select>` — guard *should* hold. Still ticket if live typing of `3`/`4`/`5` (capacity, etc.) jumps tabs. Chords `g d` / `g m` are less likely to steal single keystrokes in a name field.

**RC2: NO** — `rg role="button"` over `app/lenses/sub-worlds/` + `components/sub-worlds/` is empty. Settings overlay is a plain fixed panel (`WorldSettingsPanel.tsx:112–113`), not `role="dialog"` / `role="button"`.

**Delete confirm: NO** — Archive and Delete call `archive(false|true)` with **no** `window.confirm` (`WorldSettingsPanel.tsx:69–80,246–258`). Pause/Resume likewise unconfirmed.

## Answers to the policy questions

### Per-user or shared?

- **Create/edit/delete of store worlds:** per-user under `subWorldsLens.worlds.get(userId)`.
- **Discover:** shared read of others' **public** worlds (plus public world-creator drafts + active `worlds` rows).
- **worlds mirror:** shared global `worlds` (+ `world_npcs` starter rows) so Enter/travel works.
- **Favorites:** per-user Set; favoriting a store world also bumps that world's `favoriteCount` (cross-user counter write).

### Is there a delete path? (creates KEEP_BLOCKED?)

**Yes for store worlds** — `archive` with `hardDelete: true` splices the owner array, clears visitLog, deletes the mirrored `worlds` row (`:500–507`). Soft archive sets status `archived` + mirrors status. Creates are **not** KEEP_BLOCKED for cleanup of the lens record **if** hardDelete is used.

**Residual:** `hardDelete` does **not** remove seeded `world_npcs` / modulator side-writes from `seedSubWorldStarterContent`. Lens + `worlds` row go away; NPC orphans may remain in SQL. Prefer hardDelete over soft-archive for QA; note residual if Enter was used (travel/session side effects outside this lens).

**No delete** for bridged world-creator drafts or foreign `worlds` rows from this UI — do not try to clean those here.

### Public / shared / multiplayer / join others?

1. **Default spawn = public** → appears in `discover` for everyone (`:406–408`). **BLOCKED** unless privacy forced to `private` before/at spawn.
2. **privacy public/unlisted** via settings → discovery exposure (unlisted still visible to owner/editors in discover filter `:407`). **BLOCKED** to set public/unlisted.
3. **Enter / visit** of **another user's** world → increments their visits + real travel into shared world engine. **BLOCKED-by-policy** (joining others' worlds).
4. **Enter own private QA world** → allowed as exercising own fixture (still hits travel/`worlds`); prefer after labelled private spawn; hardDelete afterward.
5. **invite_editor** → invites another user id as co-editor. **BLOCKED**.
6. **favorite** on others' public worlds → mutates their `favoriteCount`. **Prefer skip / BLOCKED** for others; favoriting **own** QA world then unfavoriting is OK.
7. **No `_lensEmitDTU` / global WS** on spawn/settings/editor.
8. **Parent link / portals:** **not implemented** as macros — nothing to test; do not invent IDs.

### Paid / GPU / generation?

**None** on `sub_worlds` macros. No billing, credit, LLM, agent-deploy, GPU, or code-exec. Starter content is deterministic presets + 2 NPCs. MetaverseRepos = public GitHub search (unauthenticated). SaveAsDtu = prefer skip (DTU / FIX-xl-ws-001). Stop if LensShell Ask shows a cost.

### Playtest / simulation / SaveAsDtu?

- **No playtest macro** here. Bridged world-creator drafts show `enterNote` until playtested in World Creator (`:269`, `:554–555`) — do **not** playtest from world-creator to "finish" a sub-worlds check (that mint is KEEP_BLOCKED per `SCOPE-world-creator-2026-11-09.md`).
- **Enter** = live travel into Concordia world lens (simulation/play). Own private only.
- **SaveAsDtu** only on MetaverseRepos — prefer skip.

## Misleading / adjacent CTAs

- **Spawn Sub-World** → real create; UI defaults **public** — looks like a private sandbox; is discoverable unless privacy flipped. **Must set private.**
- **Enter** on Discover cards → joins others' / public worlds via travel — **BLOCKED** for non-own.
- **Invite** co-editor — **BLOCKED**.
- **Archive** vs **Delete** — Archive soft-hides (status); Delete = hardDelete. Neither asks confirm.
- **Repos → Save as DTU** — prefer skip.
- LensShell Publish/share / Ask / Mint — standing rules.
- Bridged "Not yet playtested…" drafts — do not Playtest in world-creator to unblock Enter during this lens's QA.

## Verdict table — sub-worlds actions (user-visible)

| Action | Bucket | Delete / reverse | Side effects | Verdict |
|--------|--------|------------------|--------------|---------|
| **list / discover / my_favorites / analytics / editor_state** | read | n/a | Discover lists others' public; analytics own/edit only | **SAFE_READ** (discover browse only; do not Enter others) |
| **spawn privacy=private** (explicit) | **(a) SAFE private** | **Yes** hardDelete | Per-user map + worlds mirror + 2 starter NPCs; **no** `_lensEmitDTU` | **SAFE_PRIVATE_DELETABLE** (use hardDelete; note possible `world_npcs` orphans) |
| **spawn privacy=public\|unlisted** (UI default public) | **(d) discoverable** | hardDelete still works | Appears in discover / joinable | **BLOCKED-by-policy** |
| **update_settings** (name/desc/thumb/kind/capacity) on **own private** | **(a)** | hardDelete | Owner/editor; mirrors name to `worlds` | **SAFE_PRIVATE** |
| **update_settings privacy→public\|unlisted** | **(d)** | set back private | Discovery exposure | **BLOCKED-by-policy** |
| **set_status** active/paused own | **(a)** | toggle back | Owner/editor | **SAFE_PRIVATE** |
| **archive soft** own | **(e)** reversible-ish | set active (if still in list) | Sets archived + worlds status | **OK cleanup soft**; prefer hardDelete for QA |
| **archive hardDelete** own | **(e) destructive** own | n/a | Removes STATE + worlds row; **not** world_npcs | **OK as cleanup** (no confirm — careful) |
| **editor_add/remove_block** own private | **(a)** | remove / hardDelete | Cap 500 | **SAFE_PRIVATE** |
| **visit / Enter own private QA** | travel own | leave world lens | visit counters + real travel | **OK sparingly** on own private fixture |
| **visit / Enter others' / public** | **(d) join others** | n/a | Their visit counts + shared world | **BLOCKED-by-policy** |
| **favorite own** | **(a)** | unfavorite | Own Set + own counter | **SAFE_PRIVATE** |
| **favorite others'** | **(d)** cross-user counter | unfavorite | Bumps their `favoriteCount` | **BLOCKED / prefer skip** |
| **invite_editor / remove_editor** | **(d) invite** | remove_editor | Other user gains edit | **BLOCKED-by-policy** |
| **SaveAsDtu** (Repos) | private DTU default | DTU library delete if available | FIX-xl-ws-001 risk | **Prefer skip** |
| **Parent link / portals / playtest** | — | — | **No macros** | n/a |

### Paid / GPU / credits

**None found** on sub_worlds macros or Spawn/Settings/Editor panels. Stop if any cost UI appears on adjacent LensShell Ask.

## Private AND deletable (qualify for a single QA write)

| Qualify | Notes |
|---------|-------|
| **spawn with privacy=private** | Name `QA LT# sub-worlds 2026-11-09 <thing>` (≥3 chars). **Override** the public default in the privacy `<select>` before Spawn. Edit settings/blocks/pause on that world only → hard reload → **Delete** (hardDelete). **Preferred.** |
| **editor_add_block / editor_remove_block / set_status / update_settings (keep private) / analytics / favorite own** | Only against that own private QA world. |
| **list / discover browse / my_favorites read** | Read-only OK. |

## Keep BLOCKED / do not write

1. **Spawn (or flip) public / unlisted** — default UI is public (`SpawnPanel.tsx:15`; server `:321`); discover exposure.
2. **Enter / visit any non-own world** — joining others' worlds / shared travel (`GalleryPanel.tsx:89–109`).
3. **invite_editor** — invites (`WorldSettingsPanel.tsx:83–97`; domain `:695–711`).
4. **favorite others' worlds** — mutates their counters.
5. **SaveAsDtu** on MetaverseRepos — prefer skip (DTU / FIX-xl-ws-001).
6. **World-creator Playtest** to mint a bridged draft for Enter — KEEP_BLOCKED per world-creator scope.
7. LensShell Publish/share, emails, SMS, payments, agent deploy, paid Ask — standing rules.
8. Legacy `sub_world.*` SQL macros — out of scope; do not call.
9. Do **not** soft-archive and leave orphans — hardDelete the QA world when done.

## Validation / form test hints

- **spawn:** name required ≥3 after trim, max 120 (`:318–319`); client disables button when `form.name.trim().length < 3` (`SpawnPanel.tsx:106`) but server is source of truth; empty name never reaches ok; unknown kind → `physics_simulator`; unknown privacy → **`public`** (dangerous default); capacity clamped 1–200; `badNumericField` rejects NaN/Infinity/-1/1e308 capacity.
- **Client vs server privacy default:** client default `'public'`; server default `'public'` — aligned, both unsafe for QA. Client does **not** force private.
- **update_settings name:** short names (<3 after trim) → error (`:456–457`); description sliced 1000; invalid privacy/kind rejected.
- **invite_editor:** empty editorUserId rejected; cannot invite self; dup rejected; cap 20.
- **editor_add_block:** invalid type rejected; label defaults to type; cap 500.
- **RC1:** watch digits `3`/`4`/`5` in capacity / block coords while Spawn or Settings focused — should be input-guarded; ticket if tabs jump. `1`/`2` tab labels are chords `g d`/`g m` (less RC1 risk).
- **RC2:** not present.
- **Escape / focus:** Settings overlay has no Escape handler / no `role="dialog"` — page-level Escape may not close it; check live. No modal role=button steal.
- **Delete confirm absent** — easy to wipe; ticket as UX/a11y.
- Persistence: private spawn → hard reload → still in `list` (`subWorldsLens` snapshot). hardDelete → gone from list + worlds row.
- Mobile: Settings `max-h-[90vh]` scroll; gallery cards + bottom nav — check 390×844 overflow / Enter hit targets.
- Analytics timeline buckets use `toISOString().slice(0, 10)` (`:669–673`) — **UTC days**, not local (same class as Dreams timeline note).

## Gaps / notes

- Spawn mirrors into shared `worlds` immediately (unlike world-creator draft-only until Playtest) — even private spawns create a travel-capable row + starter NPCs.
- hardDelete cleans STATE + `worlds` but **not** `world_npcs` → residual SQL orphans possible after thorough Enter tests.
- No portal / parent-world linking surface despite product vocabulary elsewhere — capability absent in this domain.
- Discover B15 union can show world-creator public drafts and table worlds the tester did not create — browse only.
- Live not proven: whether production snapshot has prior public QA spawns on the shared test account; whether hardDelete leaves visible NPC orphans.

## Summary for tester

**OK for one QA call + delete** (title `QA LT# sub-worlds 2026-11-09 …`):
- **Spawn with privacy explicitly `private`** → optional settings tweak (keep private) → add/remove one editor block → analytics read → optional Enter **own** world → hard reload → **Delete** (hardDelete).
- Optional reads: discover browse, list, favorites list (do not favorite others).

**BLOCKED-by-policy:** public/unlisted spawn or privacy flip, Enter others' worlds, invite_editor, favorite others, SaveAsDtu (prefer), world-creator Playtest to unblock bridged Enter.

**No paid/GPU/credit actions** on this lens. **RC1: digits `3`/`4`/`5` (Discover/Mine are `g d`/`g m`).** **RC2 not present.** **Delete path exists (hardDelete, no confirm)** → private creates allowed (not KEEP_BLOCKED for lens cleanup). **Default spawn is public** → treat un-overridden Spawn as BLOCKED.

**World-creator overlap:** sibling builder; drafts bridge into Discover/My Worlds; do not Playtest there to feed this lens. Different store (`subWorldsLens` vs `worldCreatorLens`).

Code-only verdict; not live-proven.
