# whiteboard — Wave 3 audit (fixes shipped)

Frontend Rebuild Program, Wave 3. `whiteboard` already scored `polished`
under `grade-ux-polish.mjs --honest` (`isGenericScaffold: false`). This audit
reads the actual code (not the grader) to check which macros the triage
script flagged as unsurfaced are real gaps vs. detector blind spots, then
fixes what's confirmed real — including two pre-existing honesty defects
found while tracing the "shared board" feature end-to-end.

Backend: `server/domains/whiteboard.js` (~1,755 LOC, 54 macros). Frontend:
`concord-frontend/app/lenses/whiteboard/page.tsx` mounts `CollabBoardSection`
(the real canvas + boards workbench), `WhiteboardCollabPanel` (frames /
connectors / embeds / export / live collaboration), and `WhiteboardActionPanel`
("session workbench" — save / vote / share / mint / publish / agent-retro).

## `node scripts/lens-unsurfaced.mjs --lens whiteboard`

```
whiteboard: 13/54 macros never referenced in the frontend

  shared-* (3): shared-list, shared-vote-cast, shared-vote-tally
  broadcast-* (2): broadcast-cursor, broadcast-scene
  ops-* (2): ops-apply, ops-since
  comments-* (1): comments-delete
  embed-* (1): embed-update
  frame-* (1): frame-update
  join-* (1): join-shared
  leave-* (1): leave-shared
  workspace-* (1): workspace-summary
```

## Classification

### (b) False positive — detector blind spot, no change needed

**`join-shared`, `leave-shared`, `broadcast-scene`, `broadcast-cursor`,
`shared-vote-cast`** — all five are called, as literal string actions, from
`concord-frontend/hooks/useWhiteboardCollab.ts` (join on mount / leave on
unmount / debounced scene broadcast / rate-limited cursor push / vote cast).
`scripts/lens-unsurfaced.mjs`'s `surfaced()` check only greps
`app`, `components`, `lib` (`scripts/lens-unsurfaced.mjs:51`) — it never
scans `hooks/`, so every macro called exclusively from a hook is a structural
false negative in the triage script itself, not a real gap. `useWhiteboardCollab`
is wired into `CollabBoardSection.tsx` (`const collab = useWhiteboardCollab(...)`)
and drives real-time cursors/scene-sync/votes for every open board.

### (a) Real gap — fixed this pass

**`shared-list`** — no UI ever listed the shared boards a user participates
in. `join-shared`/`leave-shared`/`broadcast-*` all operate on a shared board
*by id*, but nothing surfaced which ids exist for you to open. Fixed: added
a **Shared** tab to `WhiteboardCollabPanel.tsx` (`SharedTab`) that calls
`shared-list`, renders each board (title, participant count, element count,
last-updated) with **Open** (wires into a new `openSharedBoard()` in
`CollabBoardSection.tsx` that sets the canvas's `activeId` to the shared
board's id — `useWhiteboardCollab`'s existing join-on-mount effect then
populates the scene automatically), **Leave** (`leave-shared`), and a
**vote-tally** toggle (see next item). The tab is reachable even with no
board open (the common case when *browsing* boards shared with you).

**`shared-vote-tally`** — same story: `shared-vote-cast` fires from the live
canvas voting UI, but nothing ever read the aggregate tally back except by
inference from realtime `whiteboard:vote-cast` events on a board you have
open. Fixed: the new Shared tab's per-board tally toggle calls
`shared-vote-tally` directly and renders the per-element vote counts —
useful specifically *before* opening a board, to see if it's worth joining.

### Two honesty defects found while tracing `share-board` (not in the
original unsurfaced list — `share-board` itself IS called from
`WhiteboardActionPanel.tsx`, so the triage script correctly didn't flag it —
but making the real gaps above usable required checking whether *sharing*
a board actually worked, and it didn't)

**Backend — `share-board` silently discarded `userIds`.** The macro accepted
a `userIds` param in its call site but never read it — a user typing names
into "Share with (comma-separated user ids)" got a `sharedWith` count
fabricated client-side from `users.length` (the field doesn't exist in the
real response) while nobody was actually granted access; the named
recipients would never see the board show up anywhere. Fixed in
`server/domains/whiteboard.js#share-board`: `userIds` are now added directly
to `participants` (so they show up immediately in *their* `shared-list`,
without needing a separate join step), and the macro returns a real
`sharedWith` count.

**Frontend — `WhiteboardActionPanel.tsx`'s save/share/template/vote calls
used the wrong param names and the wrong result-object paths, so most of the
panel silently didn't do what it claimed:**
- `actSave` sent `{ name, snapshot }` to `board-save`, which reads `{ id, title, scene }` — neither key exists on the other side. Every "Save" therefore persisted an empty `"Untitled board"` (defaults kicked in) while reading a nonexistent `r.result.boardId` back, so the button reported **"save failed" on every click even though it silently succeeded with the wrong content**.
- `actShare` sent `{ boardId }` instead of `{ id }` — `share-board` read `params.id` as `undefined`, so it never promoted the user's actual board; it created a fresh empty "Untitled shared board" every time.
- `actTemplate` sent `{ templateId }` instead of `{ id }` and read `r.result.board` instead of `r.result.template` — template loading never worked (silently fell through to the error branch).
- `actVote`/`actTally` assumed a "question + free-text options" poll macro that doesn't exist — `vote-cast`/`vote-tally` are per-canvas-*element* (a sticky note gets votes), keyed by `{ boardId, elementId }`. The UI's question/options model is real product intent (a lightweight session poll) but had no backing macro to call correctly.
- The `boards` list rendered `{b.name}` (always `undefined`) — `board-list` returns `title`, not `name`.

Fixed all five: corrected param names and result paths for save/share/template;
for vote/tally, mapped each typed option onto a deterministic synthetic
`elementId` (`optionElementId(question, option)`, a stable hash) so the real
per-user vote ledger backs a working question-with-named-options poll without
inventing a new macro — `vote-tally`'s full per-board result is filtered down
to just the current question's option ids and re-aggregated into
`{ totalVotes, winner, optionTallies }` client-side. `shareResult` no longer
carries a fabricated `shareUrl` (no deep-link route exists to open a shared
board from a URL yet); it now shows the real shared board id and points the
user at the new **Collab → Shared** tab instead of a link that would go
nowhere.

## Verify

- `cd concord-frontend && npx eslint components/whiteboard/CollabBoardSection.tsx components/whiteboard/WhiteboardCollabPanel.tsx components/whiteboard/WhiteboardActionPanel.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `whiteboard` still WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `whiteboard` still `tier: "polished"`, `isGenericScaffold: false`.
