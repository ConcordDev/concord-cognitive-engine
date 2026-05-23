# Stub Upgrade Backlog

> **What this is.** A triage list of user-visible macros that the depth
> grader (`scripts/grade-macro-depth.mjs`) classifies as `tier=stub` AND
> `frontendUse=true` — meaning a real lens UI calls them, and the
> implementation behind that UI is trivial. Upgrading these moves the
> codebase from "everything has a name" to "everything is real."
>
> Regenerate with:
> ```sh
> node scripts/grade-macro-depth.mjs
> jq -r '.macros[] | select(.tier=="stub" and .frontendUse)' audit/macro-depth.json
> ```
>
> Stub = combined LOC ≤ 25 (handler body + one level of same-file helper
> recursion) AND no state touch AND no external I/O. See `CLAUDE.md`
> "Macro depth distribution" for the full tier definitions.

## Aggregate at HEAD `21c8f34` (2026-05-23)

- **Total stubs:** 1,153 (13.7% of 8,442 macros)
- **User-visible stubs** (frontend calls them): **185**
- **The rest** (968 stubs): called only by internal automation / tests / dead — lower priority

## Top 30 user-visible stubs (sorted by LOC; near-threshold ones are easiest wins)

| Macro | LOC | File | Likely upgrade |
|---|---:|---|---|
| `physics.constants` | 24 | `server/domains/physics.js` | If it returns a hardcoded constants table, that's already correct — just add a test reference to bump to functional. No real upgrade needed; the tier is a measurement artifact. |
| `byo_keys.set_budget` | 23 | `server/domains/byo-keys.js` | Add state persistence (write to `STATE.byoBudget` or a DB row) so the budget actually enforces; currently looks like a hand-off without storage. |
| `neuro.deleteRecording` | 23 | `server/domains/neuro.js` | Add DB delete + cascade to recording artifacts. Try/catch around the delete. |
| `app-maker.marketUnpublish` | 22 | `server/domains/appmaker.js` | Mirror the publish flow — flip `published` flag in DB, emit `marketplace:listing-removed` realtime event. |
| `app-maker.questNodeDelete` | 22 | `server/domains/appmaker.js` | Graph integrity: cascade to edges that referenced the deleted node, then persist. |
| `cognitive-replay.event` | 22 | `server/domains/cognitive-replay.js` | Append to a replay log table + emit a socket event for live replay viewers. |
| `forge.restoreVersion` | 22 | `server/domains/forge.js` | Touches state (the template versions table) — add the actual restore path + test. Real upgrade: copy version blob into the head row + bump version counter. |
| `voice_chat.leave_room` | 22 | `server/domains/voice-chat.js` | Remove user from room presence Set, emit `voice:participant-left`, decrement room count. Currently looks like it returns OK without cleanup. |
| `app-maker.questGraphDelete` | 21 | `server/domains/appmaker.js` | Cascade-delete pattern as `questNodeDelete`. |
| `appearance.load_for_user` | 21 | `server/domains/appearance.js` | Query DB for user's avatar appearance row + return. Currently returns a default shape regardless of user. |
| `byo_keys.set_fallback` | 21 | `server/domains/byo-keys.js` | Same as set_budget — state persistence + cascade to brain-router config. |
| `crafting.grid_delete` | 21 | `server/domains/crafting.js` | DB delete + emit `crafting:grid-deleted`. |
| `crafting.queue_list` | 21 | `server/domains/crafting.js` | Query `crafting_queue` table by user; currently looks like it returns the in-memory cache only. |
| `crafting.queue_remove` | 21 | `server/domains/crafting.js` | DB delete + queue-position renumbering for survivors. |
| `global.deleteView` | 21 | `server/server.js` | Delete a saved view; cascade to shared-view references. |
| `integrations.evalCondition` | 21 | `server/domains/integrations.js` | Currently evaluates a single condition against a fixed scope — extend to support the full expression grammar the integrations editor exposes. |
| `app-maker.marketBrowse` | 20 | `server/domains/appmaker.js` | Real marketplace browse: filter + paginate + creator info join. |
| `app-maker.questEdgeDelete` | 20 | `server/domains/appmaker.js` | Edge delete + verify no node is left orphaned. |
| `chat_agent.do` | 20 | `server/domains/chat-agent.js` | This is the synchronous wrapper around `chat_agent` — the real work is in `/api/chat-agent/stream` (now properly mounted after `7e83685`). Consider removing or wiring to the stream path. |
| `db.migrate` | 20 | `server/server.js` | Wraps the migration runner — admin-only macro, low priority (the migration runner itself is production-grade and runs at boot). |
| `art.art-prompt` | 13 | `server/domains/art.js` | Returns a hardcoded prompt template. Upgrade: LLM-driven prompt composition with user context. |
| `art.color-mix` | 18 | `server/domains/art.js` | Pure RGB math — defensible as-is; add a test ref to bump to functional. |
| `art.pattern-kinds` | 11 | `server/domains/art.js` | Returns a hardcoded enum. Defensible; just a catalog. |
| `astronomy.catalog-list` | 10 | `server/domains/astronomy.js` | Hardcoded catalog enum; defensible. |
| `meditation.session-types` | <15 | `server/domains/meditation.js` | Catalog enum; defensible. |
| `quest.template-list` | <15 | `server/domains/quest.js` | Catalog enum; should hydrate from `content/quests/` directory. |
| `reflection.list` | <15 | `server/domains/reflection.js` | Should query `reflections` table by user; currently returns empty. |
| `schemes.list` | <15 | `server/domains/schemes.js` | Should query `npc_schemes` (migration 155); currently returns empty. |
| `temporal.*` | <15 each | `server/domains/temporal.js` | Temporal lens macros need binding to the actual time-travel substrate. |
| `thread.*` | <15 each | `server/domains/thread.js` | Conversation-thread macros. |

## How to upgrade a stub

For each entry:

1. Read the current handler — confirm it's actually shallow (the grader's heuristics aren't perfect; some stubs are *correct* hardcoded catalogs that just need a test reference to bump to functional).
2. If shallow: add the missing work (DB write, state mutation, cascade, realtime emit, error handling). Match the depth of sibling macros in the same domain.
3. Add a test in `server/tests/<domain>-domain-parity.test.js` that exercises the macro with a real input and asserts on the output shape.
4. Re-run `node scripts/grade-macro-depth.mjs` — the tier should bump to `functional` or `production-grade` automatically.
5. Update `CLAUDE.md`'s "Macro depth distribution" table from the new totals (or regenerate via the cited command).

## What "stub" doesn't mean

- **Doesn't mean broken.** A stub that returns `{ ok: true, result: hardcoded }` works — it just doesn't do much.
- **Doesn't mean useless.** Many stubs are pure catalogs (e.g. `astronomy.catalog-list`) that are correct by being trivial. The tier is a depth measurement, not a quality verdict.
- **Doesn't mean shipped is a lie.** A feature can ship `[x]` while its macro is at stub tier — the lens UI works, the call succeeds. The honest claim is "shipped, depth: stub" — the spec language gloss "front-to-back" is what overstates.

## What the 968 non-user-visible stubs are

Stubs that no frontend code calls. Often:
- Catalog enums called only by internal automation.
- Delegations the grader can't fully trace (the work lives in an imported module).
- Genuinely dead macros nobody uses.

Lower priority than user-visible ones. A separate audit pass can decide which are deletable.
