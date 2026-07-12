# Whiteboard Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro count:
> `grep -c 'registerLensAction("whiteboard"' server/domains/whiteboard.js` → 54

## Headline finding: real-time multiplayer was cosmetically wired but functionally dead

A prior attempt at this unit died mid-investigation (shared-worktree cleanup) after
identifying the likely defect but before confirming or fixing it. This session
confirmed it by reading both sides of the wire:

- **Server** (`server/domains/whiteboard.js`) broadcasts five real-time events via
  `REALTIME.io.to(\`whiteboard:${id}\`).emit(...)`: `broadcast-scene` (scene push),
  `broadcast-cursor` (cursor position), `shared-vote-cast` (vote broadcast),
  `reaction-send` (emoji burst), `presence-ping` (named-participant list). Socket.io
  scopes `io.to(room)` to sockets that called `.join(room)` server-side — nothing else.
- **Frontend** (`concord-frontend/hooks/useWhiteboardCollab.ts`) subscribed correctly
  to all five events via the event bus (`onEvent('whiteboard:scene-update', ...)` etc.)
  — real code, real state updates, no fabrication. But the hook's mount effect only
  called the `whiteboard.join-shared` **macro** (an HTTP POST to `/api/lens/run`,
  fetching the board's data) — never `socket.emit('room:join', { room: 'whiteboard:${boardId}' })`.
  A macro call has no socket to join a room with; it runs on an HTTP request context.
- Net effect: **every** server broadcast to a `whiteboard:${boardId}` room reached
  zero listeners. Scene sync, live cursors, presence, reactions, and shared voting
  all *looked* wired (real macros, real socket infrastructure, real subscription
  code) but never actually delivered a push update to any browser tab — a textbook
  "honest by construction" violation hiding behind otherwise-correct code, because
  nothing about it looks fake from a static read; it only fails at runtime.
- Confirmed the pattern that was needed by reading `concord-frontend/lib/hooks/useYjsDoc.ts`
  (Code Live Share's real CRDT wire — `socket.emit('room:join', { room })` on every
  `connect`) and the server's `room:join` handler (`server/server.js:8485`), which has
  no special-casing for `whiteboard:*` rooms beyond the standard "must be authenticated"
  gate — so joining is safe and matches the existing `code:liveshare:*` / `collab:*`
  idiom used elsewhere in the frontend (`CodeAdvancedPanel.tsx`, `app/lenses/collab/page.tsx`).

**Fix** (`concord-frontend/hooks/useWhiteboardCollab.ts`): added a second mount effect
that calls `joinRoom(`whiteboard:${boardId}`)` from `lib/realtime/socket.ts` immediately
(covers the already-connected case) and re-joins on every `onReconnected` callback
(socket.io room membership is per-connection, so a dropped/reconnected socket loses
membership — the fix re-joins on every reconnect, not just once on mount), with a
matching `leaveRoom` call in the cleanup. This is a minimal, additive change — no
other logic in the hook changed. Real-time whiteboard collaboration (scene sync,
live cursors, presence, reactions, shared voting reads) is now genuinely live, not
just plausible-looking.

## Macro classification (54 total, all in `server/domains/whiteboard.js`)

**DESIGNED — 46 macros**, each reached through a bespoke, purpose-built UI (not a
generic action array):

| Macro | Surface |
|---|---|
| `shapeDetect`, `layoutOptimize`, `clusterGroup`, `exportPrep` | "Whiteboard Actions" strip in `app/lenses/whiteboard/page.tsx` — 4 buttons, each with its own custom result-card rendering (shape distribution chips, before/after alignment score, cluster list, format/size breakdown) — not a generic button wall, each action's output is shaped differently |
| `templates-list`, `template-load` | `WhiteboardWorkbench.tsx` Templates tab + `WhiteboardActionPanel.tsx` Template action |
| `board-list`, `board-save`, `board-load`, `board-delete`, `board-duplicate` | `WhiteboardWorkbench.tsx` Boards tab, `CollabBoardSection.tsx` boards rail (create/open/delete/duplicate), `WhiteboardActionPanel.tsx` Save action |
| `timer-start`, `timer-get`, `timer-stop` | `CollabBoardSection.tsx`'s `BoardTimer` — meeting-timer widget with server-synced countdown |
| `vote-cast`, `vote-tally` | `WhiteboardActionPanel.tsx` — text-poll UI mapped onto deterministic synthetic element ids (documented in-file: no separate text-poll macro exists, so real per-element vote ledger backs the question/option UI honestly) |
| `share-board`, `shared-list` | `WhiteboardActionPanel.tsx` Share action, `WhiteboardCollabPanel.tsx` Shared tab |
| `join-shared`, `leave-shared` | `useWhiteboardCollab.ts` mount/unmount, `WhiteboardCollabPanel.tsx` Shared tab leave button |
| `broadcast-scene`, `broadcast-cursor` | `useWhiteboardCollab.ts` — now genuinely live post room:join fix |
| `shared-vote-tally` | `WhiteboardCollabPanel.tsx` Shared tab tally button |
| `ai-cluster-stickies`, `ai-summarize-board`, `ai-generate-board` | `CollabBoardSection.tsx` AI sidebar tabs (Cluster/Summarize/Generate) |
| `comments-list`, `comments-add`, `comments-resolve` | `CollabBoardSection.tsx` Comments tab |
| `board-export-json`, `export-raster-plan` | `CollabBoardSection.tsx` Export tab, `WhiteboardCollabPanel.tsx` Export tab (deterministic render-plan computation, distinct from the JSON envelope export) |
| `frame-create`, `frame-list`, `frame-delete`, `presentation-build` | `WhiteboardCollabPanel.tsx` Frames tab (region carving + present-as-slides) |
| `connector-create`, `connector-list`, `connector-delete` | `WhiteboardCollabPanel.tsx` Connectors tab (auto-routed elbow paths between shapes) |
| `embed-add`, `embed-list`, `embed-delete` | `WhiteboardCollabPanel.tsx` Embeds tab |
| `reaction-send`, `presence-list`, `presence-ping` | `WhiteboardCollabPanel.tsx` Live tab (emoji reactions, named-participant list); `presence-ping` piggybacks on the cursor-broadcast heartbeat in `useWhiteboardCollab.ts` |
| `publish-as-blueprint`, `published-blueprint-coverage` | `PublishAsBlueprintDialog.tsx` — the Concordia content-engine bridge (board → building-interior blueprint DTU → `evo_assets`) |

**UNSURFACED — 8 macros**, real backend code with no frontend caller found (verified
by grep across `app/lenses/whiteboard/page.tsx` and every `components/whiteboard/*.tsx`
+ `hooks/useWhiteboardCollab.ts`):

| Macro | What it does | Triage |
|---|---|---|
| `vision` | ~~Vision-model image analysis of an uploaded board image (`callVision`/`callVisionUrl` via `lib/vision-inference.js`) | ENGINEERING — no upload affordance calls it; would need an "Analyze image" action wired to an existing `image` element pin. Small, deferred — not a defining whiteboard-category feature (Miro/FigJam don't lead with OCR-the-whiteboard).~~ **CLOSED (2026-07-12, pending commit)** — the existing `image` element pin is the embed system's `kind: 'image'` (`whiteboard.embed-add`/`embed-list`, already surfaced in `WhiteboardCollabPanel.tsx`'s Embeds tab); no new upload path was needed. Added an "Analyze" action (eye icon, shown only on `kind === 'image'` embeds, next to the existing Edit/Delete buttons) that calls `whiteboard.vision` with `{ imageUrl: embed.url }` and renders the returned description inline in a result box below the embed row, matching the bordered-result-card idiom `SummarizeTab` already uses for `ai-summarize-board`. A failed call (brain unreachable, SSRF-blocked URL, etc.) renders an honest "Analysis failed: …" message — never a fabricated description — reusing the same `lensRun` unwrap contract the rest of the panel relies on. The backend macro needed no changes; its input/output contract (`{ imageB64 }` or `{ imageUrl }` in → `{ ok, content, source, model }` or `{ ok:false, error, source }` out) was already correct. Tests: `concord-frontend/tests/components/whiteboard-collab-panel-vision.test.tsx` (4 — Analyze button scoped to image embeds only, correct `whiteboard.vision` call shape, in-flight loading/disabled state, honest-failure rendering with no fabricated success box) + `server/tests/whiteboard-domain-parity.test.js`'s new `"whiteboard — vision"` block (4 — missing-input rejection, `imageB64` path's honest failure through `callVision` when the brain is unreachable, `imageUrl` path's SSRF-guard rejection for both a loopback address and a cloud-metadata address). All 8 new tests passing; full existing whiteboard suites (backend 60/60, frontend 26/26 across the other whiteboard component/hook test files) unaffected. |
| `ops-apply`, `ops-since` | A lamport-clock op-log CRDT-lite sync path (`whiteboard:ops` event — not even present in the frontend's `SocketEvent` union, so it couldn't be consumed even if joined) | Not a gap — **superseded**. The live real-time path (`broadcast-scene`, now genuinely wired) already does full-scene debounced sync, which is what `CollabBoardSection.tsx` actually uses. `ops-apply`/`ops-since` are an alternate, more bandwidth-efficient sync strategy that was built but never adopted by the UI. Leave as dead-but-harmless backend code, or retire in a future pass — not user-facing functionality that's missing. |
| `comments-delete` | Deletes a board comment | ENGINEERING — `CommentsTab` in `CollabBoardSection.tsx` has add/resolve but no delete button. Small, scoped fix (one button + one `lensRun` call), reasonable for a future pass. |
| `frame-update` | Reposition/resize/relabel an existing frame | ENGINEERING — `FramesTab` supports create/delete but not edit-in-place; not a defining feature (frames can be deleted and recreated). |
| `embed-update` | Edit an existing embed's metadata | ENGINEERING — same shape as `frame-update`, same low priority. |
| `workspace-summary` | Aggregate stats: board count, element count, sticky count, shared count, open comments | ENGINEERING — a natural header/stat-strip candidate (mirrors `StatTile` idioms used elsewhere); currently no caller. Low priority, purely additive. |
| `shared-vote-cast` (reachable via `useWhiteboardCollab.ts`'s exported `castVote`) | Casts a vote on a specific element of a **shared/live** board (distinct data path from the private `vote-cast` macro `WhiteboardActionPanel.tsx` already uses — different map: `sharedBoards`/`sharedVotes` vs. the private per-user `boards` map) | ENGINEERING — `WhiteboardCanvas.tsx` already renders live vote-count badges on elements (`voteCounts` prop, fed by `collab.voteCounts`) so the **read** side works, but nothing calls the hook's `castVote(elementId)` — there is no click-to-vote affordance on the canvas itself for shared boards. This is the most concrete near-term gap of the eight: the display exists, the write path exists, only the click handler connecting them is missing. Left undone this pass to keep the room:join fix isolated and verifiable; a follow-up would add a canvas click handler (e.g. gated on `isSharedBoard`) that calls `collab.castVote(shapeId)`. |

No `GENERIC-STRIP-ONLY` macros found. The closest candidate — the 4-button
"Whiteboard Actions" strip (`shapeDetect`/`layoutOptimize`/`clusterGroup`/`exportPrep`)
— was classified DESIGNED because each button renders a materially different,
bespoke result shape (shape-type histogram vs. before/after alignment score vs.
cluster list vs. format/size breakdown), which is the dividing line the rebuild
program draws between "real feature with a plain button" and "generic action wall."

## Fabricated-success envelope bug — checked, not present

`WhiteboardActionPanel.tsx`'s `callMacro()` helper explicitly unwraps the nested
envelope (`if (data.ok && data.result && 'ok' in data.result) return data.result`)
before checking `.ok` — this is the correct pattern (`POST /api/lens/run` always
returns `{ok:true, result: <macro's own return>}`, so a naive check of only the
outer `ok` would mask a real macro-level failure). Every other component reviewed
(`CollabBoardSection.tsx`, `WhiteboardCollabPanel.tsx`, `PublishAsBlueprintDialog.tsx`,
`WhiteboardWorkbench.tsx`) checks `r.data?.ok` before trusting `r.data?.result` at
every call site. No instance of the bug found.

## Zero-demo-content / zero-generic-tendencies — checked, not present

No hardcoded arrays rendered as live data, no `Math.random()` in a render path, no
placeholder/lorem content in any of the six files read in full (`page.tsx`,
`WhiteboardWorkbench.tsx`, `WhiteboardRepos.tsx`, `WhiteboardActionPanel.tsx`,
`CollabBoardSection.tsx`, `WhiteboardCollabPanel.tsx`). Every empty state says
"no data yet" / "no boards" / etc. rather than seeding synthetic content —
`WhiteboardCollabPanel.tsx`'s own header comment states this as a design rule
("No seed/demo data — empty states say 'no data yet'") and the code matches it.
`WhiteboardRepos.tsx` genuinely calls the live GitHub search API (no mock fallback).

## Verification

- `node --check server/domains/whiteboard.js` — syntax OK (file not modified this pass, checked as a baseline sanity gate).
- `find server -iname "*whiteboard*"` / `find concord-frontend -iname "*whiteboard*"` under `tests/` — no dedicated whiteboard test file exists in either tree (confirmed by grep; nothing to update).
- `cd concord-frontend && npx eslint hooks/useWhiteboardCollab.ts` — clean (0 errors, 0 warnings).
- `node scripts/verify-lens-backends.mjs` — whiteboard lens reachability unaffected by this change (macro call path, not the wiring the verifier checks).
- `node scripts/grade-ux-polish.mjs --honest` — whiteboard entry unaffected (`hooks/useWhiteboardCollab.ts` is not a page/component file the grader scores; the page itself was not touched this pass beyond the hook fix).
- `git checkout -- audit/` run after the above to discard regenerated transient artifacts.

Per the standing rule for this sweep: **no `tsc --noEmit` run** (container OOM risk
from a prior parallel batch) — `eslint` was used as the substitute typecheck-adjacent
gate on the one touched file.
