# Whiteboard scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/whiteboard.js` (+ `server/lib/whiteboard-board-artifacts.js`, `server/lib/vision-inference.js`, `server/server.js` whiteboard DTU macros ~59522–59720 + `room:join` ~11427, `concord-frontend/app/lenses/whiteboard/page.tsx`, `components/whiteboard/*`, `hooks/useWhiteboardCollab.ts`). Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

Requested as READ-ONLY code scope check for Lens Tester 4 after claiming `whiteboard` (criteria/whiteboard.md). Creates held until this answer — especially whether boards are per-user or collaborative, whether share link / invite / live multiplayer expose a board or cursor, and whether `_lensEmitDTU` (FIX-xl-ws-001) fires on create/edit.

## Model — two planes (private domain store + canvas DTU) + optional shared/live

| Layer | UI | API path | Storage |
|-------|-----|----------|---------|
| **Collab / Workbench boards (preferred QA)** | `CollabBoardSection.tsx` New board; `WhiteboardWorkbench.tsx` New board / templates / import | `POST /api/lens/run { domain:'whiteboard', action:'board-save' }` (+ load/list/delete/…) | Per-user `STATE.whiteboardLens.boards` Map (`userId → Map<id, board>`) — key `whiteboardLens` is in `LENS_STATE_KEYS` (`lens-state-persistence.js:58`) so snapshot survives restart. Soft-delete via `deletedAt` |
| **Main canvas Studio** | `WhiteboardStudio.tsx` “New board” → `WhiteboardCreateForm` | `POST /api/whiteboard` → `register("whiteboard","create")` (`server.js:59619–59639`) + autosave `PUT /api/whiteboard/:id` → `update` (`:59642–59656`). Mirrors into domain store via `board-save` with `origin:'canvas'` (`WhiteboardStudio.tsx:387–390`) | Owner-scoped DTU `machine.kind="whiteboard"` + catalog shadow lens artifact type `board` via `_wbAttachMirror` (`:59531–59561`). Visibility private |
| **Shared live multiplayer** | Collab → Shared tab (join by ID); ActionPanel Share / invite | `share-board`, `join-shared`, `leave-shared`, `broadcast-scene`, `broadcast-cursor`, `ops-apply`, `presence-ping`, `reaction-send`, `shared-vote-*` | `STATE.whiteboardLens.sharedBoards` + socket.io room `whiteboard:${id}` |
| **ACL grants (view/edit on private board)** | ActionPanel invite-by-name | `board-grant` / `board-revoke` / `board-access` / `board-shared-with-me` | Platform `artifact_grants` kind `whiteboard-board` (`whiteboard.js:229–257`, tests in `whiteboard-acl-sharing.test.js`) |
| **Analyze / AI / vision / export / blueprint** | Collab AI tabs; CollabPanel Export/Embeds Analyze; Workbench PublishAsBlueprint; Studio Export PNG/SVG; KeepMenu | `ai-cluster-stickies`, `ai-summarize-board`, `ai-generate-board`, `vision`, `export-raster-plan`, `board-export-json`, `publish-as-blueprint`, Keep mint | LLM / vision / evo_assets / client-side raster |

### Shared runtime facts

- Domain registers **~55** actions in `whiteboard.js` (loaded through `server/domains/index.js`). Actor gate: `wbActor(ctx) = ctx?.actor?.userId || ctx?.userId || "anon"` (`:228`); writes wrapped with `guardAnonWrites` (`:67`).
- **Per-user boards are the private workspace** (`:699–701`). `board-list` / `board-load` / `board-delete` are owner-scoped (plus ACL grantees via `findBoardForUser`, `:931–946`). Strangers get `"not found"` — pinned by `whiteboard-acl-sharing.test.js:64–69`.
- `whiteboard` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775` — forum/feed/marketplace/collab/thread/vote/alliance/global/news/questmarket only).
- `whiteboard` is **NOT** in `FRONTEND_ARTIFACT_TYPES` (`lens-artifact-types.js:21–63`). Studio lists shadows via `useLensData('whiteboard','board')` but **creates** go through `/api/whiteboard`, not generic `lens.create`. Domain `board-save` also bypasses generic create.
- **FIX-xl-ws-001 / `_lensEmitDTU`:** primary creates do **not** call `_lensEmitDTU`. Canvas create writes DTU + shadow directly (`_wbAttachMirror` → `STATE.lensArtifacts.set`, no exhaust emit). Domain `board-save` only mutates `whiteboardLens` + `saveWhiteboardState()`. **Exception paths that DO mint/publish DTUs:** ActionPanel Mint/Publish, KeepMenu keep, `publish-as-blueprint` (evo_assets) — treat those as separate BLOCKED/prefer-skip surfaces, not the normal board create.
- **Global WS side-effect on canvas autosave:** `register("whiteboard","update")` calls `realtimeEmit("whiteboard:updated", { whiteboardId, elementCount }, {})` with **empty scope** (`server.js:59655`). Empty scope falls through to `REALTIME.io.emit` — **global broadcast to every connected socket** (`:10930–10934`). Payload is metadata only (id + elementCount), not the scene, but board ids leak on every autosave. Domain `board-save` does **not** call this.
- Caps / limits: title sliced to 80 (`board-save:398`, `share-board:733`); board id must be safe path segment (`:374–376`); blueprint ≤ 5 MB (`:21`).
- Seeds: 6 built-in templates (`TEMPLATES` `:281–334`) — read-only scaffolds.

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/whiteboard/page.tsx:19–25` via `useLensCommand`:

| Key | Action |
|-----|--------|
| `?` | Lens help |
| `w` | **Open Whiteboard Workbench** |

**RC1: YES — bare-letter `w`.** Commands do not set `global`. `useLensCommand` skips INPUT / TEXTAREA / SELECT / `contentEditable` unless `global` (`hooks/useLensCommand.ts:43–49,147–154`). Studio text entry uses `<input>` / `<textarea>` overlays (`WhiteboardStudio.tsx:1632,1646`) — **not** contentEditable — so the guard *should* hold while typing board text. Still the same RCA class when the guard fails (as seen live on Services / Environment / Government).

**RC2: NO** in whiteboard-specific components — `rg role="button"` over `app/lenses/whiteboard/` + `components/whiteboard/` is empty. Dialogs are plain panels; Create form uses `type="button"`. (LensShell / shared chrome may still have its own patterns — out of this file set.)

**Delete confirm:** two-step inline confirm on Collab list (`CollabBoardSection.tsx:203–221`); Studio soft-deletes immediately then shows a 12s Undo window before `commitDeletedBoard` → DTU delete + `board-delete-permanent` (`WhiteboardStudio.tsx:396–418`, `boardOwner.ts:30–43`). Native `window.confirm` intentionally unused.

## Answers to the three specific questions

### Are boards per-user or collaborative?

**Both, by design.** Default creates (`board-save`, `/api/whiteboard` create) are **per-user / private**. Collaboration is opt-in via:
1. **`share-board`** — promotes a private board (or creates) into `sharedBoards` with a new `shared_*` id and participants Set (`whiteboard.js:717–751`).
2. **`board-grant`** — ACL view/edit on the **same** private board id without promoting (`:543–550`; ActionPanel invite-by-name).
3. Live room `whiteboard:${id}` for scene/cursor/ops/presence/reactions once shared (or once someone joins a shared id).

### Can a share link, invite, or live multiplayer/presence websocket expose a board or its cursor?

**Yes — several paths. All are BLOCKED-by-policy for QA.**

1. **Join-by-ID (share-link shaped):** `join-shared` on a real shared board **adds the caller as a participant with no invite check** (`:783` `wbParticipants(b).add(userId)`). UI explicitly offers “Shared board ID — join by ID” (`WhiteboardCollabPanel.tsx:774`). Anyone who knows/guesses the id can enter the live room and receive scene/cursor/vote broadcasts.
2. **ACL invite:** `board-grant` exposes the owner's private board to a named account at view or edit (`ActionPanel.tsx:154–165`). View-only can load; edit can save the owner's board (no fork) — pinned by ACL tests.
3. **Socket room gating gap:** `room:join` for `whiteboard:*` only requires authentication — **no participant/owner check** (`server.js:11427–11512`; special cases exist for `session:`, `org:`, `astronomy:session:` only). Any authenticated user who knows a boardId can join the socket room.
4. **Private-board mitigations (partial):** for the caller's own unshared board, `join-shared` / `broadcast-scene` / `broadcast-cursor` return quiet `{ shared: false }` (`:773–781,818–826,852–860`). Client sets `knownUnsharedRef` and **skips** scene/cursor/presence pushes (`useWhiteboardCollab.ts:152,334,371`). **Gap:** `broadcastOps` / `ops-apply` do **not** check `knownUnsharedRef` (`:357–367`) and `ops-apply` still emits `whiteboard:ops` to the room (`whiteboard.js:1390–1394`) for any board `findBoardForUser` resolves — so a private collab board's element ops can still fan out to anyone who joined the socket room.
5. **Canvas autosave global emit:** `whiteboard:updated` with boardId + elementCount goes to **all** sockets (see above). Metadata leak, not full scene.
6. **Presence / reactions** on shared boards emit live cursor + emoji to the room (`:1863–1910`).

**Do not** Share, invite/grant, join by ID, open Shared live boards, or leave a board shared.

### Is `_lensEmitDTU` (FIX-xl-ws-001) or any global broadcast fired on create/edit?

| Path | `_lensEmitDTU` | Other broadcast |
|------|----------------|-----------------|
| Domain `board-save` / `board-delete` / frames / comments / … | **No** | No global; shared-only room emits when in `sharedBoards` |
| Canvas `POST /api/whiteboard` create | **No** (direct DTU + shadow) | None on create |
| Canvas `PUT` update (autosave) | **No** | **Yes — global** `whiteboard:updated` (`server.js:59655` → `:10930`) |
| `ops-apply` / `broadcast-scene` / `broadcast-cursor` / `presence-ping` / `reaction-send` | **No** | Room `whiteboard:${id}` (shared required for scene/cursor; ops/presence/reaction gated only by `findBoardForUser`) |
| ActionPanel Mint / Publish / KeepMenu / `publish-as-blueprint` | Mint/publish create DTUs / evo assets (separate from FIX-xl-ws-001 exhaust, still public/shared-shaped) | n/a |

**Verdict for FIX-xl-ws-001:** does **not** apply to normal board create/edit. Prefer domain `board-save` boards for QA to also avoid the canvas global `whiteboard:updated` metadata leak; if testing the main canvas, expect that emit and delete the board when done.

## Misleading / adjacent CTAs

- FAB / “New board” (Studio) → real private DTU canvas — honest; blank title disabled in UI (`WhiteboardCreateForm.tsx:29`).
- Collab / Workbench “New board” → real private domain board — honest; **preferred QA create**.
- Share / invite / “Live session copy” / join-by-ID → collaborative exposure — **BLOCKED**.
- Publish as blueprint / ActionPanel Publish / DM / Agent Retro / Mint → public or outbound / agent — **BLOCKED** (Mint private DTU = prefer skip).
- AI Cluster / Summarize / Generate → included `ctx.llm.chat` with deterministic fallback — included AI OK; **stop if cost UI**; Generate creates a **new** board — delete after.
- Embed “Analyze” → `vision` → Cloudflare Workers AI or Ollama multimodal (`vision-inference.js:1–120`) — **GPU / external vision — BLOCKED**.
- Export PNG/SVG/PDF/JSON → client-side raster from server `export-raster-plan` + local Blob download; JSON via `board-export-json` — **SAFE local download** (no paid external export service in code).

## Verdict table — whiteboard actions (user-visible)

| Action | Bucket | Delete / reverse | Side effects | Verdict |
|--------|--------|------------------|--------------|---------|
| **board-list / board-load (own) / templates-list / template-load / workspace-summary / boards-trash-list / frame-list / connector-list / embed-list / comments-list / vote-tally / presence-list / ops-since / exportPrep / shapeDetect / layoutOptimize / clusterGroup** | read | n/a | Owner-or-grant visibility | **SAFE_READ** |
| **board-save** (Collab/Workbench New / edit) | **(a) SAFE private** | **Yes** soft `board-delete` → Undo → `board-delete-permanent` | Per-user map; **no** `_lensEmitDTU`; no global emit | **SAFE_PRIVATE_DELETABLE** |
| **Canvas create** (`/api/whiteboard`) | **(a)** | **Yes** soft delete + DTU delete | Private DTU + shadow; later edits global-emit metadata | **SAFE_PRIVATE_DELETABLE** (prefer domain board-save if avoiding global emit) |
| **Canvas update / domain board-save edits / frames / connectors / embeds / comments-add / vote-cast (private) / timer-*** | **(a)** | via board delete | Owner-scoped | **SAFE_PRIVATE** |
| **board-export-json / export-raster-plan → client PNG/SVG/PDF** | **(a)** local download | n/a | No paid/external export API in code | **SAFE_PRIVATE** |
| **ai-cluster-stickies / ai-summarize-board** on **own** board | **(a)** + optional included LLM | n/a | Deterministic fallback if no brain; `ctx.llm.chat` when present | **SAFE_PRIVATE** stop if cost UI |
| **ai-generate-board** | **(a)** creates new board | **Yes** delete the new board | May call LLM; always creates a board row | **SAFE_PRIVATE_DELETABLE** only if cleaned up; prefer skip if cost appears |
| **board-delete / board-restore / board-delete-permanent** | **(e) destructive** but own | restore while soft | Soft then permanent; permanent also clears frames/timers/votes/comments for id | **OK as cleanup** |
| **board-duplicate** | **(a)** | delete the copy | Owner-scoped copy | **SAFE_PRIVATE_DELETABLE** |
| **share-board / join-shared / leave-shared / broadcast-scene / broadcast-cursor / shared-vote-* / presence-ping on shared / reaction-send on shared** | **(d) collaborative / live** | leave / delete shared | Live room + participant set; join-by-ID open | **BLOCKED-by-policy** |
| **board-grant / board-revoke** | **(d) shared ACL** | revoke | Exposes private board to another user | **BLOCKED-by-policy** |
| **vision** | **(c) GPU / external vision** | n/a | CF Workers AI or Ollama multimodal | **BLOCKED-by-policy** |
| **publish-as-blueprint** | **(d) public marketplace-shaped** | no in-UI unpublish of evo asset | Writes disk + `evo_assets` blueprint; world interiors can pick it up | **BLOCKED-by-policy** |
| **ActionPanel Publish / DM** | **(d) public / outbound** | publish has 30s recall | Federated publish; DM to another user | **BLOCKED-by-policy** |
| **ActionPanel Mint / KeepMenu keep** | private DTU default | DTU library delete if available | Extra DTU mint alongside board | **Prefer skip** |
| **ActionPanel Agent Retro** (`chat_agent.do`) | **(c) agent** | n/a | Agent run maxTurns 3 | **BLOCKED-by-policy** |
| **ops-apply on private board** | **(a)** with room-emit caveat | n/a | Mutates own scene; still emits to socket room | Prefer avoid while room ungated; use ordinary board-save edits |

### Paid / GPU / credits

- **Vision (`whiteboard.vision`):** Cloudflare Workers AI (needs `CLOUDFLARE_API_TOKEN`) or Ollama multimodal — treat as **GPU / external**. **BLOCKED.**
- **AI cluster / summarize / generate:** included `ctx.llm.chat` with deterministic fallback — standing rule **included AI OK; stop if any cost UI appears**.
- **Exports:** local client raster + JSON Blob — **no paid export service** found.
- **No** billing hooks, credit burns, fine-tunes, or agent deploys on the core board-save surface. ActionPanel Agent is a separate agent deploy-shaped call — **BLOCKED**.

## Private AND deletable (qualify for a single QA write)

| Qualify | Notes |
|---------|-------|
| **board-save → private collab/workbench board** | Title `QA LT4 whiteboard 2026-11-09 <thing>` → New board (Collab or Workbench) → draw/edit → later two-step Delete (12s Undo) / ensure trash → permanent. **Preferred** (no global emit, no DTU). |
| **Canvas Studio create** | Same title via New board form (UI requires non-empty title) → draw → Delete with Undo window. Expect global `whiteboard:updated` metadata on autosave. |
| **board-load / board-list / templates / export JSON/PNG/SVG / comments on own / private votes / frames** | Read/write on own private board OK. |
| **ai-cluster / ai-summarize** on own | OK if no cost UI; prefer deterministic path. |

**Delete path exists** (soft + restore + permanent + canvas DTU delete) → creates are **not** KEEP_BLOCKED for cleanup reasons.

## Keep BLOCKED / do not write

1. **share-board / join-shared (join by ID) / Shared live room** — collaborative exposure (`whiteboard.js:717–785`; CollabPanel `:774`).
2. **board-grant / invite-by-name / ACL edit elevation** — shares private board (`:543–550`; ActionPanel `:154–165`).
3. **broadcast-cursor / presence / reactions / shared votes** on any shared board — live cursor exposure.
4. **vision / Analyze image** — GPU / CF Workers AI (`vision-inference.js`).
5. **publish-as-blueprint** — evo_assets / world interiors (`:1996–2101`).
6. **ActionPanel Publish, DM, Agent Retro** — public / outbound / agent (`WhiteboardActionPanel.tsx:330–380`).
7. **ActionPanel Mint / KeepMenu** — prefer skip (extra DTU).
8. LensShell Publish/share, emails, SMS, payments, paid Ask — standing rules.
9. Do **not** open other users' boards from “Shared with me”, paste shared ids, or leave QA boards shared.
10. Prefer **not** `ai-generate-board` unless you will delete the new board immediately and no cost UI appears.

## Validation / form test hints

- **Canvas create UI:** empty title disables Create (`WhiteboardCreateForm.tsx:29`); server `create` still defaults to `"Untitled Whiteboard"` if called raw (`server.js:59621`).
- **board-save title:** empty → `"Untitled board"`; max 80 chars (`whiteboard.js:398`). No other required fields. Unsafe `params.id` → rejected (`:374–376`).
- **board-delete:** only owner map; already-trashed → `"not found"` (`:450`). Permanent requires already in trash (`:492`).
- **share-board:** private id must exist for caller (`:729`); invited `userIds` optional.
- **join-shared:** open join on existing shared id (no ACL); private own id → `{ shared: false }`.
- **board-grant:** owner-only; self-grant refused; level must be `view`|`edit` (ACL tests `:72–78`).
- **ai-generate-board:** `prompt required` (`:1080`); kind enum brainstorm/retro/okr/user_journey/flowchart/swot.
- **vision:** needs `imageB64` or `imageUrl` (`:88`); non-image media → 415 via sniff.
- **export-raster-plan:** format png|svg|pdf; empty board returns `{ empty: true }` (`:1439–1440`).
- **reaction-send:** emoji must be in fixed palette (`:1861,1870`).
- **RC1:** when typing Create title / sticky / text overlays, watch bare `w` opening Workbench if focus guard fails. Canvas editors are INPUT/TEXTAREA (guarded), not contentEditable.
- **No RC2** on whiteboard modals.
- **Escape:** Studio clears selection on Escape (`WhiteboardStudio.tsx:1362`); editing textarea Escape cancels edit (`:1653`). Collab/share dialogs — check Escape closes (likely gap vs shared RCA).
- Persistence: create → hard reload → still in board-list / Studio list (`whiteboardLens` snapshot + DTU). Soft delete → trash list; Undo restores; after 12s permanent → gone.

## Gaps / notes

- Two element models: canvas “sketch” vs collab “Shape” — opening a canvas-origin board in Collab editor is refused with a note (`CollabBoardSection.tsx:153–158`).
- `ops-apply` room emit on private boards + ungated `whiteboard:*` socket join is a real exposure footgun even when scene/cursor are quiet-no-op’d.
- Canvas global `whiteboard:updated` is a metadata leak distinct from FIX-xl-ws-001.
- Comments on a board are stored per-board (shared across viewers of that board) (`:1171`) — only write comments on boards you will not share.
- Live not proven: whether production has `whiteboardLens` snapshot for the shared QA account; whether vision provider is CF vs Ollama; whether any prior shared QA boards already exist in `sharedBoards`.

## Summary for tester

**OK for one QA call + delete** (title `QA LT4 whiteboard 2026-11-09 …`):
- **Preferred:** Collab or Workbench **New board** → `board-save` private → draw shapes/stickies/text → save → reload → export JSON/PNG/SVG locally → two-step Delete (confirm permanent / wait Undo window).
- **Also OK:** Studio canvas create (private DTU) with same cleanup; expect global `whiteboard:updated` metadata on autosave.
- Optional: templates-list/load, workspace-summary, ai-cluster/summarize on own board (stop if cost).

**Boards are per-user by default; collaborative only after share/grant/join.** Share link / join-by-ID / ACL invite / live room **can** expose board content and cursors — **do not use**. **`_lensEmitDTU` does not fire** on normal create/edit; canvas update still **globally** emits `whiteboard:updated` metadata.

**BLOCKED-by-policy:** share-board, join-shared, board-grant/revoke, Shared live, vision, publish-as-blueprint, Publish, DM, Agent Retro; prefer-skip Mint/Keep.

**No paid export.** Vision = GPU/external (**BLOCKED**). AI text macros = included LLM OK / stop if cost. **RC1 bare-letter `w`** (form/contentEditable guarded; canvas uses input/textarea). **RC2 not present** in whiteboard components. **Delete path exists** → creates allowed (not KEEP_BLOCKED for cleanup).

Code-only verdict; not live-proven.
