# Personas — capability map (Wave 3, Frontend Rebuild Program)

Audited 2026-07-10. **Reference app / category leader: Character.AI's
persona-authoring + conversational loop** (with a nod to a custom-GPT
builder for the versioning/publishing half). The bar: would this hold up
shipped standalone against Character.AI — author a character from scratch
(personality/voice/greeting/example-dialogue), talk to it live, publish it
to a browseable marketplace, rate + review, revise with version history —
not "good enough next to 259 siblings."

## The load-bearing finding: the CLAUDE.md Phase-Z note is STALE

`CLAUDE.md` still describes the personas lens as alias-resolved through a
`register("personas", …)` loop in `server.js` + "5 Z4 action stubs
(`get`, `stats`, `versions`, `publish`, `install`)" where "the rest return
`{ok:false, reason:'roadmap'}` so the lens renders 'coming soon' badges."
**That is no longer how the lens resolves at runtime.** Since Phase Z, a
full from-scratch persona domain shipped and is the live surface:

- **`server/domains/personas.js`** (18 macros, Character.AI-parity) is
  imported in `server/domains/index.js` (`import personas from './personas.js'`,
  in the exported array) and registered at boot via
  `domainModules.forEach(mod => mod(registerLensAction))`
  (`server.js:41742`). It registers into **`LENS_ACTIONS`**, not `MACROS`.
- `/api/lens/run` **prefers `LENS_ACTIONS` over `MACROS`**
  (`server.js:39592-39596`, `const lensHandler = LENS_ACTIONS.get(...)`
  checked before `MACROS.get(domain)?.get(action)`). So every real
  `personas.*` macro **wins** over both the `server.js:35948` shadow-alias
  loop (which copies the singular `persona.*` macros to `personas.*` in
  `MACROS`) **and** the 5 Z4 stubs (`server.js:35960-35994`). Those two are
  now **redundant dead `MACROS` entries** — dispatch never reaches them for
  the plural domain. (Left in place this pass: removing server.js code is
  out of scope for a frontend-rebuild pass and touching the 77k-line
  monolith to delete confirmed-dead-but-harmless registrations carries
  more risk than value; noted here so a future server pass can excise them.)

Net: the lens is genuinely functional front-to-back on the real domain.
The publish/install "coming soon" framing in CLAUDE.md is wrong — publish,
install, versions, rate, revise, chat are all real and were already wired.

## Backend surface — `server/domains/personas.js` (18 macros, all real)

Per-process store on `globalThis._concordSTATE._personas` (personas / chats
/ ratings Maps); no migration, no DB schema, no seed/mock data — every
returned value is real user input or deterministic computation.

- **Author (3):** `create` (name required; personality/voice/greeting/
  category/tags/exampleDialogue, deterministic SVG portrait from identity
  hash), `update` (author-only field edit), `revise` (author-only, snapshots
  prior version into `history[]`, bumps `version`, returns `installersNotified`).
- **Read (3):** `get` (author-or-published gate; returns full authored fields
  + reviews + `isAuthor`), `mine` (caller's own, sorted by `updatedAt`),
  `versions` (history + current, contentHash per entry).
- **Marketplace (4):** `browse` (query/tag/category filter + popular/recent/
  rating sort), `facets` (tag + category counts over published), `publish`
  (author-only toggle), `install` (published-only, bumps `installCount`).
- **Chat preview — Character.AI's core loop (3):** `chat_open` (greeting turn),
  `chat_send` (deterministic `composeReply` from the persona's own
  personality/voice/example-dialogue + user message; surfaces an exact
  authored response when the user echoes an example prompt), `chat_history`.
- **Ratings (2):** `rate` (published + not-own + 1–5 stars + optional review;
  idempotent per `(personaId, userId)`), `stats` (install/chat counts, rating
  distribution, version, `isAuthor`).
- **Delete + portrait (3):** `delete` (author-only), `regenerate_portrait`
  (author-only; accepts a `dataUri` upload < 200KB or reseeds the
  deterministic SVG).

Tests: `node --test server/tests/personas-lens-macros.test.js
server/tests/personas-domain-parity.test.js` → **49/49 pass, 0 fail**
(re-verified this pass; backend untouched).

## What was already real/wired (all DESIGNED)

- **`app/lenses/personas/page.tsx`** — DESIGNED. Four bespoke tabs (My
  Personas / Marketplace / Create / NPC Packaging), real loading/error/empty
  states, a fail-closed error card on `mine`. The NPC Packaging tab drives
  the *separate, real* `npc_persona` domain (package an existing NPC's
  grudges/schemes/schedule into a sellable DTU — untouched, correct).
- **`components/personas/PersonaEditor.tsx`** — DESIGNED. Bespoke structured
  authoring form (name/tagline/personality/voice-select/greeting/tags +
  repeatable example-dialogue rows + revision changelog), not a JSON-paste
  textarea. Wires create/update/revise with correct field shapes.
- **`components/personas/PersonaDetailPanel.tsx`** — DESIGNED. Full persona
  view: chat / stats (real `ChartKit` rating-distribution bar) / versions /
  reviews tabs; author actions (edit/publish/regen-portrait/upload-portrait),
  non-author install + rate. All 9 macro call shapes correct.
- **`components/personas/PersonaChat.tsx`** — DESIGNED. Live in-lens chat
  preview over chat_open + chat_send, optimistic user turn, typing indicator,
  reply-basis chip.
- **`components/personas/PersonaMarketplace.tsx`** — DESIGNED. Search + tag +
  category facets + sort over `browse`/`facets`, real four-UX-state handling.
- **`components/personas/CharacterStudio.tsx`** — DESIGNED. Real Wikipedia
  REST pulls for 8 historical figures as authoring reference + Save-as-DTU.

## The defect found + what changed

**Fabricated success on real backend failure — the envelope-unwrap bug**
(the single most serious class this program watches for; the same bug just
fixed in `kingdoms`, `poetry`, `photography`). **Every** mutation and read
handler across all five personas components + `page.tsx` checked only the
**outer transport `ok`** and never the **wrapped macro's own `result.ok`**.

Root cause, confirmed by reading the dispatcher: `/api/lens/run` answers
`{ ok: true, result: <macro return> }` and unwraps exactly one `.result`
layer via `_unwrapLensEnvelope` (`server.js:39499-39502` — peels only when
both `ok` and `result` are present). So:
- a **success** `{ok:true, result:{persona}}` → `r.data.result = {persona}`
  (no `ok` field on the payload), but
- a **failure** `{ok:false, error}` (no `result` key) passes through
  **unchanged** → `r.data.result = {ok:false, error}`.

Because `r.data.ok` (transport) is `true` for both, code like
`if (r.data?.ok) { flash('Rating submitted') }` fired a **success toast on a
rejected macro** — e.g. rating your own persona (`cannot_rate_own`),
installing an unpublished persona (`not_published`), publishing one you don't
own (`not_author`), a failed create/revise/delete, or an unauthenticated
`mine` (`no_actor`, which the "fail closed" comment claimed to surface but
did not — it rendered an empty library instead).

**Fix:** added `components/personas/persona-envelope.ts` — one correct
interpreter (`readEnvelope` / `runPersona`) that computes
`ok = transport.ok && result.ok !== false` and extracts the real
`error`/`reason`. It covers both the personas success shape (no inner `ok`)
and a passed-through `{ok:false}` failure, and also the bare-envelope
`npc_persona` shape (`{ok, ...}` with no `.result` wrapper). Rewired all
call sites:

- `page.tsx`: `mine` (now genuinely fail-closed), `delete`, and the two
  `npc_persona` mutations (`package`, `install`) + `list_for_user` read.
- `PersonaEditor.tsx`: `create`/`update`/`revise` save path.
- `PersonaDetailPanel.tsx`: `get`/`stats`/`versions` load + `publish`/
  `install`/`rate`/`regenerate_portrait`/upload — all 8 now report honest
  failure instead of a fake success toast.
- `PersonaMarketplace.tsx`: `browse`/`facets`.
- `PersonaChat.tsx`: `chat_open`/`chat_send`.

**Fluidity (fifth invariant) improvements, both honesty-bound:**
- `deletePersona` is now **optimistic** — the card drops in <100ms and, on a
  real macro failure, the row is **restored** and the reason surfaced (no
  silent swallow, no fake success).
- `chat_send` keeps its optimistic user turn but now **rolls it back** and
  restores the draft on failure, instead of leaving a message that never
  reached the persona.
- **Discoverable keyboard shortcuts** — the lens previously registered only a
  no-op `?` help command. Replaced with real `g m`/`g b`/`g c`/`g n` tab
  navigation registered via `useLensCommand` (so they surface in the ⌘K
  palette + help modal) **and** a visible `<kbd>` chip on each tab so the
  binding is findable without reading source (matches UI_QUALITY_RUBRIC §2).

## Investigated and honestly deferred

| Macro | Real capability | Disposition |
|---|---|---|
| `personas.chat_history` | Re-fetch a chat's full turn list by `chatId`. | Not surfaced — `chat_open` already returns the greeting turn and `chat_send` appends live; the in-lens preview keeps turns in component state, so there is no reload path that needs it. No UI gap; correctly latent. |
| `server.js` Z4 stubs (`publish`/`install` → `{ok:false, reason:'roadmap'}`) + shadow-alias loop | Dead `MACROS` entries shadowed by the real `LENS_ACTIONS` domain. | **Not a frontend gap** — the real macros already win. Excising the dead server.js code is a server-side cleanup deferred to a future server pass (out of scope for a frontend-rebuild pass; harmless in place). |

No capability was faked to fill a gap. Nothing in the lens is GENERIC-STRIP-ONLY
or UNSURFACED after this pass — all 18 real macros are reached through
DESIGNED, bespoke surfaces.

## Category-leadership caliber judgment (fourth invariant)

Against Character.AI specifically: the authoring form, live deterministic
chat preview, marketplace with facets, ratings + reviews with a real
distribution chart, and version history with changelogs together cover
Character.AI's core create→talk→publish→rate→revise loop at real quality —
and add versioning + provenance (contentHash) that Character.AI does not
expose. **The honest caliber gap vs. the leader** is that the chat reply is a
deterministic `composeReply` over authored fields rather than an LLM
completion (by design — honest-by-construction, no LLM guaranteed in tests).
That is the one place a side-by-side reads as "grounded but simpler than
Character.AI's model." Triaged as **ENGINEERING/DATA-SOURCING** for a future
gap-closure pass (route chat through the subconscious brain behind an opt-in
env flag, mirroring the existing `CONCORD_*_LLM` deterministic-fallback
pattern used across the codebase — never faking an LLM when one is absent).
Not built this pass: it is a backend behavioral addition beyond a
frontend-rebuild scope, and the deterministic path must remain the honest
fallback.

## Verification

- `node --test server/tests/personas-lens-macros.test.js
  server/tests/personas-domain-parity.test.js` → **49/49 pass, 0 fail**
  (backend untouched; re-verified green).
- `cd concord-frontend && npx eslint app/lenses/personas/page.tsx
  components/personas/*.tsx` → clean, 0 errors/warnings.
- `node scripts/verify-lens-backends.mjs` →
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 — personas WIRED.
- `node scripts/grade-ux-polish.mjs --honest` → personas entry:
  `tier: "polished"`, `isGenericScaffold: false`, `pillarsPresent: 5`,
  `hasAnimation: true` (`totalLoc: 1267`, `bespokeComponentLoc: 906`).
  `audit/` reverted after the run.
- `node --check server/domains/personas.js` — backend untouched this pass;
  not modified.

## Left alone, with reason

- `server/domains/personas.js` — no changes. All 18 macros already correct
  with real behavioral coverage; the defect was entirely frontend
  envelope-interpretation, never the backend.
- `CharacterStudio.tsx` — untouched. Already DESIGNED, real external API,
  honest states, no envelope bug (it uses `useQuery` over `fetch`, not
  `lensRun`).
- The `server.js` shadow-alias loop + Z4 stubs — left in place (dead but
  harmless; server-side removal deferred, see the deferred table above).
