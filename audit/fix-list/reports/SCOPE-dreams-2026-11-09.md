# Dreams scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/dreams.js` (+ `server/lib/embodied/dream-engine.js`, `server/lib/embodied/forward-sim.js`, `server/migrations/115_dreams.js`, `concord-frontend/app/lenses/dreams/page.tsx`, `components/dreams/{DreamReader,DreamLibrary,DreamPredictions}.tsx`). Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

Requested as READ-ONLY code scope check for Lens Tester 1 after claiming `dreams` (criteria/dreams.md). Creates held until this answer — especially whether writes are private to the QA account, publish/GPU/paid paths, `_lensEmitDTU` (FIX-xl-ws-001), and delete paths.

**Slug confirmed:** `dreams` (route `/lenses/dreams`; domain macros `dreams.*`). **Not** the system 6-phase dream-cycle (`SubstrateDreams` on home) and **not** the owner-only insight capture (`command-center` DreamPanel / `dream.capture`) — those are different substrates (`page.tsx:17–23`, capability map).

## Model — engine-composed dream records + member tag layer

| Layer | UI | API path | Storage |
|-------|-----|----------|---------|
| **Recent** | `page.tsx` tab `recent` | `lensRun('dreams','recent')` → `dreams.js:236–260` | SQLite `dreams` + hydrated `dtus` (`dream_dtu_id`); tags from per-user Map |
| **Search & Timeline** | `DreamLibrary.tsx` | `search` / `tags` / `timeline` / `busiest-night` → `dreams.js:399–598` | Same SQLite + `dreamTags` Map |
| **Reader** | `DreamReader.tsx` modal | `detail` / `interpret` / `tag` / `unpublish` → `dreams.js:278–396,336–357,601–619` | Owner-scoped load (`WHERE id=? AND user_id=?` `:98`); tags / interpretation cache in Maps |
| **What's ahead** | `DreamPredictions.tsx` | `predictions` → `dreams.js:262–275` | `forward_predictions` (Layer 10); optional `SaveAsDtuButton` |
| **Composition (no UI create)** | Heartbeat / offline pass | `tryComposeForUser` in `dream-engine.js:272+` | Inserts `dtus` + `dreams` row; **not** a lens create form |

### Shared runtime facts

- Domain registers **11** macros in `dreams.js:235–620` (recent, predictions, detail, publish, unpublish, reprice, tag, tags, search, timeline, interpret, busiest-night — publish/reprice still registered but **REFUSED**).
- Actor gate: every macro requires `ctx.actor.userId` (`no_actor` otherwise). Reads/writes are **owner-scoped** via `user_id` on `dreams` / Map keys.
- Dreams are **engine-authored**, not user-authored journals (`page.tsx:6–10`; Lead disposition 2026-11-01). There is **no** `dreams.create` / journal-entry write in the domain. Criteria language about "creating dream-journal entries" does **not** match the live product model — only **tagging** (and withdrawing a legacy listing) is a member write.
- `dreamTags` + `dreamInterpretations` live on `globalThis._concordSTATE` (`dreams.js:56–62`); both keys are in lens-state persistence (`lens-state-persistence.js:244,369–370`) so they survive restart.
- `dreams` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775`).
- `dreams` is **NOT** in `FRONTEND_ARTIFACT_TYPES` (`lens-artifact-types.js` — no `dreams` entry). Domain macros do **not** call `_lensEmitDTU`.
- **FIX-xl-ws-001 / `_lensEmitDTU`:** not on domain macros. **Exception:** `DreamPredictions` `SaveAsDtuButton` (`DreamPredictions.tsx:96–105`) — prefer skip (generic DTU mint → FIX-xl-ws-001 risk). Compose path uses `realtimeEmit("dream:composed", …, { userId })` scoped to owner (`dream-engine.js:371–385`) — not a global broadcast (that bug was fixed; code comment documents prior unscoped emit).
- Caps: tags ≤12, each ≤32 chars after trim/lower (`dreams.js:388–391`); recent limit 1–50; search limit 1–100; timeline 365 rows; busiest-night needs ≥2 distinct nights.
- `interpret` is **deterministic** template over fragment/summary counts (`interpretDream` `:167–231`) — **not** prose LLM reflection (claim withdrawn 2026-11-01). Cached per user/dream; `refresh:true` recomputes. Engine LLM compose is **server env** `CONCORD_DREAM_LLM=true` only (`dream-engine.js:19,275`) — not a user-facing paid/GPU button on this lens.

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/dreams/page.tsx:88–97` via `useLensCommand`:

| Key | Action |
|-----|--------|
| `1` | Recent tab |
| `2` | Search & Timeline tab |
| `n` | Read the latest dream (opens reader / else jumps to library) |

**RC1: YES — bare-letter `n` + digits `1`/`2`.** Same RCA class. `useLensCommand` skips INPUT / TEXTAREA / SELECT / `contentEditable` unless `global` (`hooks/useLensCommand.ts:43–49,147–154`). Dreams commands do **not** set `global`, so the guard *should* hold when focus is in the tag input — still ticket as RCA-class if live typing of letters/digits jumps tabs (as seen elsewhere). Tag field is the only text input (`DreamReader.tsx:242–247`).

**RC2: NO** — `rg role="button"` over `app/lenses/dreams/` + `components/dreams/` is empty. No modal backdrop Enter/Space close pattern.

**Escape / focus:** DreamReader is a fixed overlay (`DreamReader.tsx:137`) with Close button only (`:143–149`). **No Escape keydown handler, no `role="dialog"`, no focus trap.** Ticket missing Escape + dialog semantics if live-confirmed.

**Delete confirm: N/A** for dreams (no delete). Tag replace has no confirm. Unpublish has no confirm.

## Answers to the policy questions

### Which records are scoped to the creating account vs shared?

| Record | Scope | Shared with other users? |
|--------|-------|---------------------------|
| **Dream row** (`dreams`) | `user_id = caller` on every load | **Private.** `loadDream` requires matching `user_id` (`:94–99`). |
| **Dream DTU** (`dtus`, type `dream`) | Creator = player; default scope `personal` | Remains personal unless legacy `scope=public` / visibility marketplace (publish path now refused). |
| **Tags** (`dreamTags` Map) | Per `userId` → dreamId | **Private** to account; UI labels "your tags" / "shown only to you" (`DreamReader.tsx:238–239`). |
| **Interpretation cache** | Per `userId` | Private Map; deterministic recompute. |
| **Predictions** | Per `userId` via `getActivePredictions` | Private. |
| **System dream-cycle / owner capture** | Other substrates | **Not in this lens** — do not test here. |

### Can a fictional dream be created? Delete path?

**No user create.** Composition is engine-only (`tryComposeForUser`). There is **no** delete macro for `dreams` rows or dream DTUs. Tagging empty list clears tags (`tag` replaces full list — empty → `[]` stored). Unpublish only flips a **legacy public** dream back to personal.

### Is `_lensEmitDTU` (FIX-xl-ws-001) or any global broadcast fired?

**No** on domain macros. Prefer skip `SaveAsDtuButton` on predictions. Compose `realtimeEmit` is owner-scoped (`dream-engine.js:378–385`).

### Paid / GPU / generation?

**None** on user-facing dreams macros. `interpret` = pure compute. Engine LLM path is env-gated server compose, not a lens CTA. Stop if any cost UI appears on adjacent LensShell Ask. No credits/CC spend UI for tagging.

## Delete paths (creates KEEP_BLOCKED?)

| Type | Delete / reverse | Verdict |
|------|------------------|---------|
| **Dream record** | **No delete macro** | Cannot create via UI; if somehow present, residual — **KEEP_BLOCKED** for any invent-a-dream attempt |
| **Tags** | `tag` with `[]` / fewer tags replaces list | **Clearable** — preferred QA write |
| **Interpretation cache** | Overwritten on refresh; no user delete needed | OK |
| **Published listing (legacy)** | `unpublish` → scope personal | **OK as cleanup / narrowing** only if a dream already shows `scope === 'public'` |
| **Publish / reprice** | Server returns `marketplace_for_dreams_ruled_out` (`:329–333,:369–373`) | **BLOCKED** (also refused) |
| **SaveAsDtu (predictions)** | Library delete if available | Prefer skip |

## Misleading / adjacent CTAs

- Criteria "create dream-journal entries" — **product mismatch**; empty state says "Sleep generates dreams" (`page.tsx:139`). Do not expect a New Dream form.
- Marketplace / price badges in library for `scope=public` — listing is ruled out; only **Withdraw** if already listed (`DreamReader.tsx:260–280`).
- `SaveAsDtu` on predictions — looks harmless; FIX-xl-ws-001 risk → prefer skip.
- Owner capture / SubstrateDreams — different systems; out of scope.

## Verdict table — dreams actions (user-visible)

| Action | Bucket | Delete / reverse | Side effects | Verdict |
|--------|--------|------------------|--------------|---------|
| **recent / detail / predictions / tags / search / timeline / busiest-night** | read | n/a | Owner-scoped | **SAFE_READ** |
| **interpret / Re-summarise** | **(a)** compute + cache | cache overwrite | Deterministic; no LLM/GPU on this path | **SAFE_PRIVATE** (no fixture cleanup needed beyond optional ignore) |
| **tag → clear tags** (`QA-lt1-dreams-…` then `[]`) | **(a) SAFE private** | Yes (replace with `[]`) | Owner Map only | **SAFE_PRIVATE_DELETABLE** |
| **unpublish** (only if already public) | **(e)** narrow exposure | n/a | Flips DTU meta to personal | **OK as cleanup** if fixture already public; do not seek to publish first |
| **publish / reprice** | **(d)** marketplace | refused | Would set public + CC price if live | **BLOCKED** (refused server-side; do not probe to force) |
| **SaveAsDtu / LensShell Mint-Publish** | DTU / export | library delete if available | FIX-xl-ws-001 risk | **Prefer skip** |
| **Force engine compose / CONCORD_DREAM_LLM** | **(c)** if LLM env | no delete | Server/env only; not a lens button | **BLOCKED** (no UI; do not trigger agent/GPU jobs) |

### Paid / GPU / credits

**None found** on dreams lens CTAs. Interpret = deterministic. Publish refused (would have been CC marketplace). Stop if cost UI appears on Ask.

## Private AND deletable (qualify for a single QA write)

| Qualify | Notes |
|---------|-------|
| **tag on an existing own dream → clear** | Open a dream from Recent/Library → set tags including `qa-lt1-dreams-2026-11-09` → Save → reload → clear input → Save (empty). Preferred fixture. |
| **interpret** | Optional; no leftover beyond cache. |
| **All list/search/timeline/predictions reads** | OK. |
| **unpublish** | Only if UI already shows "Listed on the marketplace". |

If the QA account has **zero dreams**, there is **no allowed create** — report empty state honestly; do not attempt to mint via other lenses / agent / env.

## Keep BLOCKED / do not write

1. **Any attempt to create/compose a dream** from the lens or by triggering engine compose / paid LLM — no delete → **KEEP_BLOCKED** / no UI.
2. **publish / reprice** — marketplace ruled out; refused (`dreams.js:315–333,359–373`).
3. **SaveAsDtu** on predictions / LensShell Publish-share / Mint — prefer skip (FIX-xl-ws-001).
4. **Owner dream-capture / system dream-cycle** surfaces — wrong substrate.
5. Do **not** open other users' dream ids (owner check should 404; still don't enumerate).
6. Standing rules: no DMs, invites, payments, GPU jobs, agent deploys, repo/DB changes.

## Validation / form test hints

- **tag:** server keeps tags with `0 < length ≤ 32`, max 12, lowercased, deduped (`:388–391`). Try blank (clears), one tag >32 chars (dropped silently), 13+ tags (sliced to 12), punctuation/emoji, duplicate casing.
- **No title/create form** — criteria validation for "blank required names" N/A for create; apply to tag field only.
- **RC1:** with tag input focused, type letters including **`n`**, digits **`1`/`2`** — watch for tab steal / reader open. One confirming attempt if steal; cite RCA-form-hotkey-steal.
- **RC2:** not present.
- **Escape:** open reader → press Escape — expect fail (no handler) → ticket.
- Persistence: set tags → hard reload → still on card / detail; clear → gone.
- Mobile 390×844: teal FAB `bottom-8 right-8` (`page.tsx:56,187`) + bottom nav — expect crowding; reader full-screen overlay.
- Empty: "Sleep generates dreams. Come back tomorrow." when `recent` empty.
- publish button: should be absent; only Withdraw if `scope==='public'`.

## Gaps / notes

- Criteria vs product: hybrid maturity is a **read + annotate** surface over engine records, not a private dream journal CRUD app. Score create/delete criteria as **N/A / product gap**, not as a tester miss.
- No export of dream pack beyond optional SaveAsDtu / LensShell chrome.
- Live not proven: whether QA account has any dreams; whether any legacy public listings exist; whether `.light` theme is on (see RCA-contrast — will affect readability of `text-zinc-*` on `bg-[#111]`).

## Summary for tester

**OK for one QA call + cleanup** (tag prefix `qa-lt1-dreams-2026-11-09` / fixture language `QA LT1 dreams 2026-11-09 …` in notes):
- Reads: recent, open reader, search/timeline/tags cloud, predictions, interpret.
- Write: **Save tags** on one own dream → reload → **clear tags**.
- Optional: Withdraw if already marketplace-listed.

**BLOCKED / KEEP_BLOCKED:** create/compose dream; publish/reprice; SaveAsDtu/Mint (prefer); engine/LLM compose triggers; other substrates.

**No paid/GPU/credit actions** on this lens's CTAs. **RC1: bare `n` + digits `1`/`2` (inputs should be guarded).** **RC2 not present.** **No dream delete** — tagging is the only reversible member write.

Code-only verdict; not live-proven.
