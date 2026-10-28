# Board Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> **Re-verified 2026-10-28 (HANDOFF-3 Workstream B, batch L2).** Every
> row re-checked against main 4c964675. Changes since the Wave 3 edition:
>
> - The macro count is **36** today (one fewer than the 37 recorded
>   below) and **all 36 are surfaced** in the frontend — the
>   `board-dashboard` gap this map flagged was wired by Wave 3 itself
>   (summary strip in BoardWorkspace) and is verified present.
> - **The three-UI problem is resolved.** `KanbanBoard.tsx` no longer
>   exists; `app/lenses/board/page.tsx` is a thin shell (114 LOC) with
>   a single `active` union — board | timeline | table (TasksPanel
>   modes over live tasks) | workspace (BoardWorkspace, Trello-parity)
>   | bgg (BggHotList) — one app, complementary surfaces, no duplicate
>   kanban implementations.
> - **Keep→DTU exists**: `BoardKeepMenu` (mounted in BoardWorkspace)
>   builds a report from the real board, creates a private DTU, reads
>   it back to confirm the id, then drafts into Thread — covered by
>   `server/tests/board-keep.test.js` and
>   `concord-frontend/tests/board-keep-menu.test.tsx` /
>   `board-card-keep.test.tsx`.
> - Drag-and-drop card/task moves are implemented in both surfaces
>   (BoardWorkspace cards, BoardLanes tasks) over `card-move`.
> - Server suites verified locally: board-lens-macros 26/26,
>   board-kanban-domain-parity 9/9, board-domain-parity 32/32.
>   `tests/depth/board-behavior.test.js` boots the real server — Mac.
> - This pass adds the one concept element still missing: the approved
>   Board concept's serif greeting ("What's next, Ramaj") now heads
>   the workspace empty state, addressed to the signed-in user via
>   `useAuth`, pinned by a new case in
>   `concord-frontend/tests/board-lens-states.test.tsx`.
>
> **2026 competitor delta (Trello / Linear):** boards/lists/cards,
> checklists, due dates + calendar view, labels, collaborators,
> attachments, comments, card covers, custom fields, Butler-style
> automations (`automation-*`, `card-move-auto`), dashboard aggregate
> — all real. Linear-side analytics: WSJF prioritization
> (`cardPrioritization`), cycle/lead + WIP over-limit detection
> (`workflowAnalysis`), seeded Monte Carlo burndown
> (`burndownForecast`) — all real, all computed server-side, none
> fabricated. Out of scope: BGG is a discovery widget riding the same
> page, not a parity surface; no row of the Trello/Linear core is
> missing.

Reproduce the macro list:
`grep -c 'registerLensAction("board"' server/domains/board.js` → 36 (2026-10-28)

## Reference apps

**Trello** (kanban core — confirmed: `server/domains/board.js:2` self-labels
"board/kanban management"; every macro builds `boards → columns → cards`
with labels, due dates, checklists, comments, attachments, automations,
collaborators, custom fields) plus **BoardGameGeek** as a bolt-on discovery
widget (`BggHotList.tsx`). The backend is 100% Trello-shape kanban — there is
no BGG logic anywhere server-side; BGG only exists as one live-data frontend
widget on the same page.

## Audit finding: real, no fabrication — one genuine unsurfaced macro

All 37 macros are real (`Map`-backed server state, persisted, `try/catch`-
wrapped, finite-number hardened against `Infinity`/`"1e999"` poisoning): 3
analytics macros (`workflowAnalysis`, `cardPrioritization`,
`burndownForecast` — cycle/lead time, WIP, WSJF scoring, seeded Monte Carlo
forecasts), 9 kanban-CRUD macros, and 22 "backlog parity" macros (comments,
attachments, activity feed, calendar view, card covers, automation rules,
labels, collaborators, custom fields).

The frontend page actually contains **three separate board UIs**: (1) a
bespoke personal task-kanban derived from live tasks via
`buildBoardActionParams` (no fabricated data — comment confirms), (2)
`BoardWorkspace` — the real Trello-parity workspace ("No seed/mock data —
every card and column is real user input"), and (3) `KanbanBoard` — an
older, simpler, also-real implementation of the same macros (functionally
redundant with `BoardWorkspace`; a consolidation opportunity, not a defect).
`CardDetailModal`/`BoardSettingsPanel` call real macros exclusively.

**`BggHotList.tsx` is real, not fabricated** — it fetches
`boardgamegeek.com/xmlapi2/hot?type=boardgame` directly and parses the
returned XML; no hardcoded top-10 list, no fake vote counts.

`usesGenericBody`/`hasMacroButtonWall` fire from `<UniversalActions>`/
`<LensFeaturePanel>`/`<AutoActionStrip>` mounts, but `importsGenericTrio` is
`false` (no `ManifestActionBar`) and the page is 2079 LOC with 4 bespoke
components totaling 1834 LOC — confirmed false-positive, not scaffold.

`node scripts/lens-unsurfaced.mjs --lens board`:
```
board: 1/36 macros never referenced in the frontend
  board-dashboard
```
`board-dashboard` (real, tested in `server/tests/depth/board-behavior.test.js`
and `board-kanban-domain-parity.test.js`) returns a cross-board summary
(`{boards, totalCards, overdue, withChecklists}`) but had no UI home — a
genuine gap: a natural "all-boards" header stat block was never wired.

## What this rebuild changed

`concord-frontend/components/board/BoardWorkspace.tsx`:
- Added a **cross-board summary strip** (Boards / Total cards / Overdue /
  With checklists) directly under the workspace header, fetched via
  `boardMacro('board-dashboard')` and re-pulled whenever the board list
  changes shape (create/delete). This is a real aggregate over every board
  the user owns, not derived from the single open board — it's the exact
  gap `lens-unsurfaced.mjs` flagged.

**Not changed (documented, not actioned):** `KanbanBoard.tsx` and
`BoardWorkspace.tsx` remain two independent, real, macro-backed
implementations of the same kanban surface. Consolidating them is a
worthwhile follow-up but is not a fabrication/wiring defect, and touching
the older component risked destabilizing a working, tested surface outside
this pass's scope — left as a recommendation for a future dedicated unit.

## Verification

- `npx eslint components/board/BoardWorkspace.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `board` stays `WIRED`.
- `node scripts/grade-ux-polish.mjs --honest` — `board`: `tier: "polished"`, `isGenericScaffold: false`.
