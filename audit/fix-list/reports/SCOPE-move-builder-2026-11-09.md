# Move-builder scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/move-builder.js` (+ `server/lib/move-descriptor.js`, `concord-frontend/app/lenses/move-builder/page.tsx`, `components/move-builder/*`, `lib/concordia/move-budget.ts`). Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

Requested as READ-ONLY code scope check for the Concord live lens audit (Move Builder / `move-builder` slug). Adjacent legacy `components/concordia/SystemMoveBuilder.tsx` (glyph_spells mint) is **not** wired into this lens page.

## Model — compose preview + mint move_recipe DTU + library

| Layer | UI | API path | Storage |
|-------|-----|----------|---------|
| **Compose** | `ComposePanel.tsx` (name / element / kind / aspect steppers + live preview) | `POST /api/lens/run { domain:'move-builder', name:'catalog'\|'compose'\|'mint' }` via `lensRun` | catalog/compose: **no write**; mint: SQLite `dtus` row `type='move_recipe'` |
| **Your moves (library)** | `MintedMovesPanel.tsx` (list + expand → get) | `move-builder.list` / `move-builder.get` | Same `dtus` store; **creator/owner scoped** |
| **Shell** | `page.tsx` + `NorthStarFrame` tabs Compose / Your moves | n/a (tab state only) | — |
| **Legacy (NOT this lens)** | `SystemMoveBuilder.tsx` | `glyph_spells.mint` | Different path — **out of move-builder QA scope** |

### Shared runtime facts

- Macro surface is **exactly five** registered macros (`move-builder.js:135–325`): `compose`, `mint`, `list`, `get`, `catalog`. No `delete`, `update`, `export`, `publish`, `share`, or marketplace macros.
- Dispatch is MACROS/`register()` → `/api/lens/run` dual-registry **macro** branch (`server.js:33210–33211`, `:51655+`). Activity only via `_recordLensActivity` (`:14659–14670`) — **does not** call `_lensEmitDTU`. Mint itself is a raw `INSERT INTO dtus` (`move-builder.js:208–217`), not `dtu.create` / generic `lens.create`.
- Therefore **FIX-xl-ws-001 does not apply** to `move-builder.mint` (no WS `dtu:created` title/tags emit on this path). Confirm live if a separate DTU-store write-through ever adds one; code path here is clean.
- `move-builder` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775`).
- `move-builder` is **NOT** in `FRONTEND_ARTIFACT_TYPES` (`lens-artifact-types.js`) — page does **not** use `useLensData` / generic `/api/lens/move-builder` CRUD.
- Public-read allowlist lists `compose` / `catalog` / `list` / `get` only; **`mint` is gated** (`server.js:15247` comment: "mint (writes a DTU) is gated").
- Owner scoping: `list` filters `creator_id = userId` (`:244–248`); `get` returns `not_owner` if `row.owner !== userId` (`:291–292`). Tests pin no cross-user leakage (`move-builder-domain-macros.test.js` "list/get are owner-scoped").
- Default `worldId` on mint is `"concordia-hub"` (`:185`) — only stamps `meta.nativeWorld` via `stampMoveMeta` (`move-descriptor.js:70–78`). **Does not** publish into a shared world table or marketplace.
- Manifest declares `exports: ['json']` (`manifest.ts:201`) but **no export UI** exists in `ComposePanel` / `MintedMovesPanel` / `page.tsx`.
- Integration registry: `move-builder` / `move_builder` tier `REAL_LIVE` — "minted moves are move_recipe DTUs in the canonical dtus store" (`integration-registry.js:72–73`).
- No credit / billing / GPU / training / agent-deploy / code-execution / LLM calls in `move-builder.js` or `components/move-builder/` (grep clean). Compose/catalog are pure deterministic.

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/move-builder/page.tsx:19–38` via `useLensCommand`:

| Key | Action |
|-----|--------|
| `c` | Compose tab |
| `l` | Your moves (library) tab |

**RC1: YES — bare-letter `c` and `l`.** Typing the move name (or any focused field if the form-tag guard fails) can switch tabs mid-compose. `useLensCommand` skips form fields unless `global` (`hooks/useLensCommand.ts:43–49,147–154`) — still the same RCA class when the guard fails / focus is not on the INPUT.

**RC2: NO** in move-builder-specific components — `rg role="button"` over `app/lenses/move-builder` + `components/move-builder/` is empty. Compose is an **inline form**, not a New modal. No backdrop Enter/Space close pattern.

### Form-close on input/change (Sim / Services wider trigger)

Move-builder has **no New modal**, so a fill-driven modal close **cannot** occur here.

For the shared class (Sim / Services closing New on `browser_fill_form`):

- **Confirmed keyboard mechanism (RC2):** Services editor backdrop + panel both use `role="button"` + Enter/Space → `.click()` (`ServicesDeskPanel.tsx:1177–1179`). Panel `onKeyDown` does **not** `stopPropagation`, so Space/Enter bubbles to the backdrop → `setShowEditor(false)`. That is the known close path for keystrokes.
- **Programmatic fill without keydowns:** RCA still lists this as a **Gap** (`RCA-form-hotkey-steal-2026-11-09.md:188,197`) — no second `input`/`change` listener was found in shared `useLensCommand` (`hooks/useLensCommand.ts` is keydown/`useHotkeys` only). No `onChange`→close wiring in move-builder either (`ComposePanel.tsx:111–113` only `setName`). If live fill still closes elsewhere, the mechanism is **not** in this lens's code and remains unlocated in shared binders from this read.

## Misleading CTA

`page.tsx:53`: CTA **Compose a new move** (library tab only) → `go('compose')`. Correctly switches to the compose surface; does **not** mint. Not the "Open a case / Log a site" no-op class.

## Verdict table — user-visible actions

| Action | Bucket | Delete / reverse | Side effects | Verdict |
|--------|--------|------------------|--------------|---------|
| **catalog** | read-only | n/a | Option lists (skill kinds / elements / aspects / defaultBudget) | **SAFE_READ** |
| **compose** | compute preview | n/a | Pure; no persist (`:142–154`) | **SAFE_READ** |
| **list** | read own | n/a | Creator-scoped move_recipe rows | **SAFE_READ** |
| **get** (expand detail) | read own | n/a | Owner gate; `not_owner` / `not_found` | **SAFE_READ** |
| **Mint move** (`mint`) | **(a) SAFE private** content | **NO** domain delete; **NO** Trash UI | Inserts `dtus` `type='move_recipe'`, `creator_id=userId`; stamps motion + `nativeWorld`; **no** `_lensEmitDTU` | **KEEP_BLOCKED** — private but **not deletable** from this lens (same genus as Environment suppliers/projects/RECs) |
| Aspect +/− / element / kind / name edits | client state | abandon | Triggers re-`compose` only | **SAFE** (no write until Mint) |
| Tab Compose / Your moves / hotkeys `c`/`l` | nav | n/a | Local React state | **SAFE** (watch RC1 while typing name) |
| Retry (catalog / list / get errors) | read retry | n/a | Re-fetches | **SAFE_READ** |
| Manifest `exports:['json']` | declared only | — | **No UI** in this lens | N/A — nothing to click |
| LensShell Publish/share / paid Ask / agent | standing | — | Platform chrome | **BLOCKED-by-policy** if reached |
| **SystemMoveBuilder** `glyph_spells.mint` | adjacent | — | Not mounted by `page.tsx` | **Out of scope** — do not drive |

### Paid / GPU / credits

**None found** on the move-builder macro or UI surface. No billing, GPU, fine-tune, agent-deploy, or LLM in `move-builder.js` / `components/move-builder/`.

### Public / shared / notify-others

**None** on this surface. Mint is owner-private DTU; list/get refuse other users. No publish / share / collab / rate / marketplace macros. Default `concordia-hub` `nativeWorld` is metadata only.

## Private AND deletable (qualify for a single QA write)

| Qualify | Notes |
|---------|-------|
| **(none for writes)** | Mint is private but **not** deletable in-lens. |
| **catalog / compose / list / get** | Read-only OK anytime. |

If policy later allows a single orphan QA mint: title `QA LTn move-builder 2026-11-09 <thing>`, leave residue noted in findings, and do **not** chase cleanup via DTU library/`dtu.delete` during this lens pass (separate surface; CompareMergePanel hard-delete is irreversible and out of scope).

## Keep BLOCKED / do not write

1. **Mint move** — creates a durable `move_recipe` DTU with **no** `move-builder.delete` and **no** Trash/Delete control in `MintedMovesPanel` / `ComposePanel` (`move-builder.js` registers only compose/mint/list/get/catalog; UI has expand/detail only).
2. LensShell Publish/share, emails, SMS, payments, agent deploy, paid Ask — standing rules.
3. Do **not** open / drive `SystemMoveBuilder` / `glyph_spells.mint` as a substitute.
4. Do **not** use platform `dtu.delete` / CompareMerge "Delete the duplicate" to "clean up" mid-audit unless a separate approved DTU-library pass says so (irreversible; not this lens's UI).

## Validation / form test hints

- **mint name**: required trim; empty → `missing_name` (`:167–168`). Contract declares `maxLength: 120` (`move-builder.mint.json`) but the **handler does not enforce a max** — only `String(…).trim()`; worth probing a long name.
- **budget_overspent**: mint refuses and writes **zero** rows (`:181–183`; test pins count unchanged). UI disables Mint when `overspent` (`ComposePanel.tsx:60–63,170`).
- **UI aspect clamp** 0–7 (`:56–57`) vs server floors any finite non-negative allocation until budget check — steppers cannot exceed 7 from UI.
- **Default alloc** `{ power:2, speed:1, area:1, efficiency:1, control:0 }` = 5/6 spent (`types.ts:28`) — under budget, mintable once named.
- **skillKind** unknown → normalize to `"spell"` (`:109–112`); compose still `ok` if budget legal.
- **element** unknown → `deriveMotion` keeps element string lowercased; effect falls back to kind default (`move-descriptor.js:52–53`).
- **skillLevel** poisoned (NaN / negative / >1e6) → `invalid_skillLevel` before write (`:34–40,170–171`). UI hardcodes `skillLevel=1` (`ComposePanel.tsx:19`) — no control to abuse unless API-called.
- **allocation** poisoned numeric → `invalid_allocation_<aspect>` (`:44–46,172–173`).
- **get**: `missing_moveId` / `not_found` / `not_owner` (`:281–292`). UI Retry on detail error (`MintedMovesPanel.tsx:101–104`).
- **list limit**: clamp 1–200; bad → `invalid_limit` (`:237–239`). UI always sends `{}`.
- **RC1**: while typing Name, watch for accidental `c` → stay on Compose / `l` → jump to library (losing unsaved name/alloc until remount resets — ComposePanel local state unmounts when switching away).
- **No RC2** / no modal — Space/Enter in the name field do **not** submit (Mint is `type="button"` `onClick`, not a form `onSubmit`) (`ComposePanel.tsx:170`).

## Gaps / notes

- **Delete gap (primary):** mint is the only write and has no reverse on this lens — treat as KEEP_BLOCKED for write audit parity with Environment non-deletable private rows.
- **Export gap:** manifest advertises JSON export; no button / macro to exercise it here.
- **No update** of an existing move_recipe from this lens (mint always inserts a new id `move:<userId>:<uuid8>` — `:186`).
- ComposePanel unmounts on tab switch → local draft (name/alloc) discarded client-side without a server write (aggravated by RC1 `l`).
- Legacy `SystemMoveBuilder` still calls `glyph_spells.mint` with a different skill-kind vocabulary (`strike`/`projectile`/…) — not the move-builder catalog; do not confuse during live QA.
- Live not proven: existing `move_recipe` rows for the shared QA account; whether any DTU-store hook broadcasts raw INSERTs despite no `_lensEmitDTU` in this file.

## Summary for tester

**OK to exercise (reads only):** open Compose → catalog loads → change element/kind/aspects and confirm Preview updates via `compose`; open Your moves → list; expand a pre-existing own move → `get` detail + Retry on failure. Watch **RC1** `c`/`l` while typing.

**BLOCKED-by-policy / do not write:** **Mint move** (no delete). LensShell publish/share/paid/agent. Do not drive SystemMoveBuilder.

**No paid/GPU/credit actions.** **RC1 bare-letter `c`/`l`.** **RC2 not present** (no modals). **No in-lens delete or export UI.** Mint path skips FIX-xl-ws-001 (`_lensEmitDTU`).

Code-only verdict; not live-proven.
