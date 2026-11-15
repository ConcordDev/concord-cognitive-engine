# Personas scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/personas.js` (+ `server/lib/npc-persona.js`, `server/server.js` npc_persona macros, `concord-frontend/app/lenses/personas/page.tsx`, `components/personas/*`, `components/personas/persona-envelope.ts`). Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

Requested as READ-ONLY code scope check for Lens Tester 1 after claiming `personas` (criteria/personas.md). Creates held until this answer — especially whether a `QA LT1 personas 2026-11-09 …` persona is private / publish / GPU / paid.

## Model — conversational authoring macros + legacy NPC DTU packaging

| Layer | UI | API path | Storage |
|-------|-----|----------|---------|
| **My Personas / Create / Detail / Chat / Marketplace** | `page.tsx` tabs `mine` / `create` / `browse` + `PersonaEditor` / `PersonaDetailPanel` / `PersonaChat` / `PersonaMarketplace` | `POST /api/lens/run { domain:'personas', name }` via `runPersona` → `lensRun` (`persona-envelope.ts:49–53`) | Process Maps on `globalThis._concordSTATE._personas` (`personas` / `chats` / `ratings`) — key `_personas` is in `LENS_STATE_KEYS` (`lens-state-persistence.js:224`) so snapshot survives restart. **No SQL table / no migration** for this plane (`personas.js:13–18`) |
| **Character Studio (Wikipedia reference)** | `CharacterStudio.tsx` under Create tab | Public Wikipedia REST read + optional `SaveAsDtuButton` | External wiki; DTU mint if Save pressed |
| **NPC Packaging (legacy, parallel)** | `page.tsx` tab `npc` | `lensRun('npc_persona', 'package'\|'install'\|'list_for_user')` → `server.js:93542–93578` → `lib/npc-persona.js` | SQLite `dtus` (type=`npc_persona`) + `npc_persona_packages`; install inserts `world_npcs` (+ grudges/schemes/…) into a live world |

### Shared runtime facts

- Primary surface is **macro-only** via `/api/lens/run`. Domain registers **17** actions in `personas.js` (loaded through `server/domains/index.js:258,569`). Actor gate: `actorId(ctx) = ctx?.actor?.userId || ctx?.userId` on every write (`:46–48`).
- Creates start **`published: false`** (`:236`). Unpublished rows are **author-only** on `get` / `chat_open` / `versions` (`:303–305,417–418,601–602`). `browse` / `facets` skip unpublished (`:377,399`).
- `personas` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775` — forum/feed/marketplace/collab/thread/vote/alliance/global/news/questmarket only).
- `personas` is **NOT** in `FRONTEND_ARTIFACT_TYPES` (`lens-artifact-types.js:21–64`). The page does **not** call `useLensData` / generic `lens.create`. Real CRUD does **not** go through `_lensEmitDTU` → **FIX-xl-ws-001 does not apply** to `personas.create` / `update` / `delete`.
- Caps: 500 personas per author, 1000 chats per user, 200 turns per chat, 30 history revisions (`:25–26,15–16,211,424,461,272`).
- Portrait = deterministic SVG data-URI from identity hash (`generatePortrait`, `:57–71`) or optional uploaded `data:image/…` under 200k (`:624–626`). **No** external image service / GPU / image-gen.
- `voice` is a **style enum string** (`warm|formal|playful|terse|wise|mysterious` in UI — `PersonaEditor.tsx:34`), max 24 chars — **not** voice-clone / TTS / training.
- `chat_send` may call `ctx.llm.chat` (`composeReply`, `:163–189`, slot `"conscious"`, maxTokens 400) when no authored example matches. Standing rule: **included AI OK; stop if any cost UI appears**. Example-dialogue matches return without the model (`basis: "example_dialogue"`).
- `revise` returns `installersNotified: p.installCount` (`:588`) — a **count field only**; no email/SMS/push send in this file. UI copy still says "notifies installers" (`PersonaEditor.tsx:204`). Treating revise-on-**published** as public content mutation anyway (marketplace readers see new fields immediately).
- Legacy MACROS shadows under `personas.*` / `persona.*` exist in `server.js` (~46824–46991) but `/api/lens/run` prefers `LENS_ACTIONS` — frontend traffic hits `domains/personas.js`.
- Seeds: none. Library starts empty for a fresh author (`personas.js:17–18`).

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/personas/page.tsx:149–155` via `useLensCommand`:

| Key | Action |
|-----|--------|
| `g m` | My Personas tab |
| `g b` | Marketplace tab |
| `g c` | Create tab + open editor (`setCreating(true)`) |
| `g n` | NPC Packaging tab |
| `n` | **New persona** (jump Create + open editor) |

**RC1: YES — bare-letter `n`.** Chorded `g m` / `g b` / `g c` / `g n` are lower risk than bare letters but still registered. `useLensCommand` skips form fields unless `global` (`hooks/useLensCommand.ts:43–49,147–154`) — Personas commands do not set `global`, so they *should* be guarded; still the same RCA class when the guard fails (as seen live on Services / Environment).

**RC2: NO** in Personas-specific components — `rg role="button"` over `app/lenses/personas/` + `components/personas/` is empty. No modal backdrop Enter/Space close pattern. (LensShell / shared chrome may still have its own patterns — out of this file set.)

**Delete confirm: NONE.** `page.tsx:99–113,264–267` — Delete button calls `personas.delete` immediately (optimistic UI drop; restore on failure). **No** `window.confirm`, no two-click arm. Server also has **no** published gate on delete (`personas.js:341–351`) — published rows can be hard-deleted (unlike Foundry drafts-only).

**Publish arm:** two-click for publish only (`PersonaDetailPanel.tsx:71–88,200–213`); Unpublish stays one click.

## Misleading / adjacent CTAs

- FAB **New persona** / hotkey `n` / Create tab → opens `PersonaEditor` (real create on Save) — honest.
- Create-tab **CharacterStudio** SaveAsDtu → private DTU mint of Wikipedia text (prefer skip / FIX-xl-ws-001 class).
- NPC tab **Package** / **Install** → DTU mint + world spawn (BLOCKED below).
- Marketplace **Install** increments shared `installCount` on someone else's published persona (BLOCKED).
- Detail **Remix** = `personas.create` fork under the remixer (`PersonaDetailPanel.tsx:91–109`) — private draft; OK only if cleaned up with delete.

## Verdict table — personas macros (user-visible)

| Action | Bucket | Delete / reverse | Side effects | Verdict |
|--------|--------|------------------|--------------|---------|
| **mine / get (own) / facets / browse / stats / versions / chat_history** | read | n/a | Author-or-published visibility; browse lists **all** published | **SAFE_READ** |
| **create** (Editor Save on new) | **(a) SAFE private** | **Yes** `delete` | Inserts draft `published:false`; author-scoped; **no** `_lensEmitDTU` | **SAFE_PRIVATE_DELETABLE** |
| **update** (Editor Save on unpublished) | **(a)** | via later delete | Owner field patch + version history snapshot | **SAFE_PRIVATE** |
| **regenerate_portrait** (regen SVG or upload data-URI) | **(a)** | overwrite / delete persona | Deterministic SVG or stored data-URI; no GPU | **SAFE_PRIVATE** |
| **chat_open / chat_send** on **own unpublished** | **(a)** + optional included LLM | chats orphan on persona delete (no chat_delete macro) | First send bumps `persona.chatCount`; LLM only if no example match | **SAFE_PRIVATE** prefer example-dialogue path; stop if cost UI; leave ≥1 authored example so send can avoid model |
| **delete** | **(e) destructive** but own | n/a | Hard-deletes persona row; **does not** clear chats/ratings Maps (orphans keyed by personaId) | **OK as cleanup** of own QA; **no confirm**; prefer delete even if briefly published |
| **publish / unpublish** | **(d) PUBLIC marketplace** | unpublish or delete | Flips `published`; browseable by any signed-in user via `browse` | **BLOCKED-by-policy** |
| **revise** (Editor "Publish revision" when published + changelog) | **(d) public content + notify framing** | further revise / unpublish / delete | Mutates live marketplace fields; returns `installersNotified` count (no real outbound send in code) | **BLOCKED-by-policy** on published; use **update** only while draft |
| **rate** | **(d) shared/public** | overwrite own rating only | Shared `ratings` Map; visible in aggregates / reviews | **BLOCKED-by-policy** |
| **install** (marketplace / detail) | **(d) shared analytics** | no decrement | Increments shared `installCount` on another author's published persona | **BLOCKED-by-policy** |
| **Remix** (detail, non-author) | **(a)** create fork | **Yes** delete the remix | Seeds new private persona from published source | **SAFE_PRIVATE_DELETABLE** only if you immediately own+delete; prefer skip (needs a published source that isn't yours) |
| **SaveAsDtu** (CharacterStudio) | private DTU default | DTU library delete if available | Defaults `licenseScopes=['private']` (`SaveAsDtuButton.tsx:169`); generic DTU mint → **FIX-xl-ws-001** risk | **Prefer skip** / KEEP_BLOCKED if WS title leak unacceptable |
| **npc_persona.package** | **(d)+(b-adjacent)** DTU mint | no in-UI delete of DTU | Inserts `dtus` type=`npc_persona` + `npc_persona_packages`; macro note "Currency: CC via royalty cascade" (`server.js:93552`) — royalty **not** wired in `installPersona` yet (`npc-persona.js:85–93`) but still a marketplace-shaped DTU | **BLOCKED-by-policy** |
| **npc_persona.install** | **(d) world mutation** | no in-UI reverse | Spawns `world_npcs` (+ related rows) into `worldId` (default `concordia-hub`) | **BLOCKED-by-policy** |
| **npc_persona.list_for_user** | read own packages | n/a | Author-scoped SQL | **SAFE_READ** |

### Paid / GPU / credits

**None found** on the conversational `personas.*` macro surface. No billing hooks, GPU jobs, fine-tunes, voice-clone, image-gen, agent deploys, or code-execution macros in `personas.js` / `components/personas/`. Portrait is SVG/upload; voice is a style label; chat uses included `ctx.llm.chat` only. **Stop if any cost UI appears** on chat_send.

Adjacent **npc_persona.package** is CC/royalty-cascade *shaped* (macro note) even though install royalty is deliberately unwired — keep **BLOCKED**. Do not treat it as a free private write.

## Private AND deletable (qualify for a single QA write)

| Qualify | Notes |
|---------|-------|
| **personas.create → draft** | Create tab / FAB / `n`: name `QA LT1 personas 2026-11-09 <thing>` → Create persona → later **Delete** on My Personas card (no confirm). Stays private until Publish. |
| **update / regenerate_portrait / chat_open+chat_send** | Only against that own unpublished QA draft. Prefer ≥1 example-dialogue pair so chat_send can hit `example_dialogue` without the model. |
| **mine / get / stats / versions / browse / facets** | Read-only OK (browse sees others' published — inspection only). |
| **npc_persona.list_for_user** | Read-only OK. |

**Delete path exists** → creates are **not** KEEP_BLOCKED for cleanup reasons. Orphan chats/ratings remain after delete (no cascade) but the persona itself is removed from `mine` / marketplace.

## Keep BLOCKED / do not write

1. **Publish / Unpublish** — marketplace visibility (`personas.js:355–365`; Detail Publish arm `:71–88`).
2. **revise on a published persona** — live public field mutation + installer-notify framing (`:542–591`; Editor `:80–82`).
3. **rate** — shared ratings (`:478–495`).
4. **install** (personas.install) — shared installCount (`:526–538`; Marketplace button `:178–192`).
5. **npc_persona.package / install** — DTU mint + world spawn (`server.js:93542–93564`; `npc-persona.js:46–152`).
6. **SaveAsDtu** on CharacterStudio — prefer skip (DTU / FIX-xl-ws-001).
7. LensShell Publish/share, emails, SMS, payments, agent deploy, paid Ask — standing rules.
8. Do **not** publish QA personas, rate/install others' personas, enter real third-party NPC ids into Package, or install into shared worlds (`concordia-hub`).
9. Prefer **not** Remix unless you will delete the fork immediately (still creates a new row).

## Validation / form test hints

- **create**: `name` required → `name_required` (`:205–206`); empty name disabled in UI (`PersonaEditor.tsx:69,222`). No server max on name length (unlike tagline). Cap → `persona_cap` at 500 (`:211`).
- **tagline** sliced 140; **personality** 2000; **greeting** 600; **voice** 24; **category** 32 (`:218–222`).
- **tags** via `normTags`: lowercase, strip non `[a-z0-9 -]`, length 2–24, max 8 (`:73–84`). Comma-joined editor string is flattened.
- **exampleDialogue**: need both prompt+response; max 12; prompt 300 / response 1000 (`:224–231`).
- **update / delete / regenerate_portrait / publish / revise**: `not_author` if another user's id (`:258,348,361,548,621`).
- **get / chat_open / versions** on unpublished foreign → `not_visible`.
- **publish**: boolean toggle; no validation gate on completeness (empty personality still publishable).
- **rate**: requires published; `cannot_rate_own`; stars clamped 1–5; review max 600 (`:484–490`).
- **install**: `not_published` if draft (`:532`).
- **chat_send**: `empty_message`; message sliced 1000; errors `model_unavailable` / `model_timeout` / `model_returned_nothing` when LLM path fails (`:447–450,168,185–188`).
- **regenerate_portrait**: upload must `startsWith("data:image/")` and length `< 200000` else falls back to SVG regen (`:624–629`).
- **RC1**: when typing the create Name / Tagline / Personality fields, watch for accidental bare `n` jumping to Create/editor (especially if focus guard fails).
- **No RC2** on Personas modals; Enter in chat input intentionally sends (`PersonaChat.tsx:153`).
- **No export** control in this lens (no CSV/JSON download UI or macro).
- Persistence: create → hard reload → still in `mine` (LENS_STATE snapshot). Delete → gone from `mine`.

## Gaps / notes

- Delete does **not** cascade-remove `chats` or `ratings` for that personaId (`delete` only `store().personas.delete`, `:349`). Orphans persist in process Maps until restart/manual clear — not user-visible without the persona, but store hygiene is imperfect.
- No `chat_delete` macro — "New chat" opens another chat (`PersonaChat.tsx:72–76`) and prior chats remain server-side until process recycle.
- `installersNotified` is **not** a real outbound notify; still treat published revise as public.
- Two planes: conversational `personas.*` (in-memory Maps) vs NPC `npc_persona.*` (SQLite DTU + world). Criteria "private personas" maps to the conversational plane.
- Legacy `STATE.customPersonas` / MACROS `personas.get|stats` are a **different** store (agent/prompt personas) — not what the lens UI drives via `runPersona`.
- Live not proven: whether `_personas` snapshot is present on production for the shared QA account; whether `ctx.llm.chat` is enabled for personaRoleplay; whether any prior published QA personas already exist in the shared Map.

## Summary for tester

**OK for one QA call + delete** (title `QA LT1 personas 2026-11-09 …`): create draft persona; update fields / regenerate portrait / open chat + send (prefer example-dialogue hit); read mine/get/stats/versions/browse/facets. **Delete the draft when done** (My Personas → Delete; no confirm). Created personas are **private to the author** until Publish — **not** visible to other users, **not** broadcast via `_lensEmitDTU`.

**BLOCKED-by-policy:** Publish/Unpublish, revise-on-published, rate, personas.install, npc_persona.package, npc_persona.install, SaveAsDtu (prefer).

**No paid/GPU/credit/voice-clone/image-gen/agent-deploy** on the conversational surface. Chat may use **included** LLM — stop if cost appears. **RC1 bare-letter `n` (+ chords g m/b/c/n).** **RC2 not present** in Personas components. Deletes have **no confirm**. Delete path **exists** → creates are allowed (not KEEP_BLOCKED for cleanup).

Code-only verdict; not live-proven.
