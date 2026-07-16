# Thread Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## What "thread" actually is (verified from source, not assumed)

CLAUDE.md flags `agent_threads`/`agent_thread_checkpoints` (agent
reasoning-marathon sessions) and "Agent marathon sessions" as candidate
meanings for a lens named "thread." Neither applies here — grep confirms zero
references from this lens to those tables or to `server/lib/thread-manager.js`.
The real backend surface (`server/domains/thread.js`, 300+ lines) is a
**Typefully/Buffer-shape long-form social-thread composer**: drafts that
auto-split into numbered posts, a schedule queue, multi-platform account
connections, AI hook/rewrite assist, CTA/numbering styles, media attachments,
and publish + engagement analytics. Separately, five more macros registered
inline in `server/server.js` (`// === Thread ===`, ~line 41055) implement a
**branching/merging conversation-lineage tree** (`thread.branch`,
`thread.merge`, `thread.summarize`, `thread.detect_consensus`,
`thread.extract_decisions`) operating on a lens artifact's `data.nodes` array
— this is the backend for the page's own stated framing, "Branching
conversation threads with lineage tracking." Category leaders: **Typefully**
(composer half) and a generic **branching-discussion / decision-thread** tool
(lineage half, closer to a lightweight Roam/GitHub-review-thread shape than
any single named product).

## Backend surface

```
grep -c 'registerLensAction("thread"' server/domains/thread.js server/server.js
```
→ **37** `thread.*` action registrations total: 31 in `server/domains/thread.js`
(4 message-analysis macros — `threadAnalyze`/`sentimentMap`/
`participantStats`/`topicExtract` — plus 27 Typefully-composer macros:
`split-preview`, `thread-draft`/`draft-list`/`draft-detail`/`draft-update`/
`draft-delete`/`draft-schedule`/`draft-publish`, `queue-list`, `best-time`,
`thread-dashboard`, `account-connect`/`account-list`/`account-update`/
`account-disconnect`, `cta-templates`, `restyle-preview`, `media-attach`/
`media-list`/`media-reorder`/`media-remove`, `ai-suggest-hook`, `ai-rewrite`,
`publish-to-account`, `engagement-sync`, `engagement-report`,
`queue-calendar`) + 6 in `server/server.js` (lineage tree: `branch`, `merge`,
`summarize`, `detect_consensus`, `extract_decisions`, and **`delete_node`,
added this pass**).

Two different storage models coexist under the same domain string, by design:
- **Composer macros** are keyed by `ctx.actor.userId` against an in-memory
  `globalThis._concordSTATE.threadLens` map (drafts/accounts/published are
  per-user lists, no artifact `id` involved) — reached via `POST /api/lens/run`
  (`lensRun()` client helper), which builds a *virtual* artifact and never
  touches `STATE.lensArtifacts`.
- **Lineage macros** mutate a real, persisted lens artifact's `data.nodes`
  in place (`STATE.lensArtifacts.get(id)`) — reached via
  `POST /api/lens/:domain/:id/run` (`useRunArtifact()` client hook), which
  loads the artifact by id first. Calling a lineage macro through `lensRun()`
  (as the composer macros correctly do) would silently operate on a
  `data: null` virtual artifact and never persist — the two calling
  conventions are not interchangeable, and this file's history shows the
  frontend previously called the lineage macros through neither convention
  at all (see below).

## Frontend surface (before this pass)

`concord-frontend/app/lenses/thread/page.tsx` (835 lines) plus
`concord-frontend/components/thread/{ThreadComposer,ThreadStudio,ThreadFeed,
ThreadNodeActions}.tsx`.

- **`ThreadComposer.tsx`**, **`ThreadStudio.tsx`** (6-tab: Accounts/Media/
  Calendar/AI Assist/Style/Analytics), and **`ThreadFeed.tsx`** (real HN
  Algolia thread pulse) already correctly and honestly surfaced 26 of the
  27 composer macros via `lensRun()` (the 27th, `queue-list`, is redundant
  with `queue-calendar` — see the classification table below). No defects
  found in any of the three — confirmed by full read; unchanged this pass.
- **`ThreadNodeActions.tsx`** (a prior pass's fix, per its own header
  comment) already replaced an older "mock 'Forking node...' toast" with
  real `dtu.create`-backed Pin/Branch-as-DTU/DM/Publish/Synthesize actions.
  Real, unchanged this pass — but distinct from (and a complement to, not a
  substitute for) the lineage tree's own branch/merge.
- **The top ~700 lines of `page.tsx`** — the tree/timeline/linear "Thread
  Lens" view itself — was the defect. See below.

## The defects found

### 1. The "branching conversation" tree was built from the wrong data
source and could structurally never branch

`threads` was derived from `apiHelpers.eventsLog.list({ type: 'chat' })`
(recent chat conversations) mapped into a `Thread`/`ThreadNode` shape whose
`rootNode.children` was hardcoded to `[]` at construction (`app/lenses/
thread/page.tsx:143-151`, prior version). Every piece of tree-rendering
machinery — `expandedNodes`, `toggleNode`, indentation by `depth`,
parent/child counts in the details panel — operated over a tree that could
never have more than one node, no matter what the user did. Chat
conversations have no relationship to `thread.branch`/`merge`'s
`data.nodes` model; bridging them into `'thread'/'conversation'` artifacts
via `useLensBridge.syncList` created decoy artifacts that the real lineage
macros never touched either.

### 2. Fork / Merge / Delete were 100% client-only, fabricated-success toasts

- Header "Fork thread" → `useUIStore.getState().addToast({message:'Fork
  thread'})`, no backend call.
- Header "Merge branches" → same pattern, no backend call. `thread.merge`
  (real, validates `branchIds`, writes a real merge node) was never invoked
  anywhere in the file.
- Per-row "Fork" button → `addToast({message:'Forking node...'})`, no
  backend call. `thread.branch` (real) was never invoked anywhere in the file.
- Details-panel "Delete" → `setSelectedNode(null)` (clears local React
  state only) + `addToast({message:'Node removed'})` — nothing was ever
  deleted. No `thread.delete_node` macro existed to call (added this pass).
- "Link" (deep-link copy) copied `?node=<id>` to the clipboard, but the page
  never read that query parameter on load — visiting the copied link did
  nothing.

Each of these presents a definite, styled success confirmation for an
action that provably did not happen server-side — the exact
"fabricated-success" shape CLAUDE.md's honest-by-construction invariant
prohibits, compounded by the fact that the *real* backend actions
(`branch`/`merge`) already existed and were simply never called.

### 3. Field-shape mismatch left 4 real macros permanently non-functional

`threadAnalyze`/`sentimentMap`/`participantStats`/`topicExtract` all read
`artifact.data?.messages || artifact.data?.posts`. The page called them via
`runThreadAction.mutateAsync({ id: threadItems[0]?.id, action })` against
artifacts whose `data` only ever held `{ title, data: <Thread object> }`
from the chat-conversation bridge (defect 1) — no `.messages`/`.posts` field
ever existed on any artifact the page created. Every click therefore
returned the macro's built-in placeholder (`"Provide messages to analyze
the thread."`) — visually indistinguishable from success, silently useless.
Additionally, the action always targeted `threadItems[0]?.id` (the first
item in an unrelated `useLensData` list) regardless of which thread the
user had selected in the UI.

### 4. Fabricated-success envelope bug (the documented pattern from
`persona-envelope.ts`)

`handleThreadAction` checked only the outer `res.ok` from `useRunArtifact`.
`/api/lens/:domain/:id/run` (`register("lens","run",...)` in server.js)
**always** returns `{ ok: true, result: <handler's own return> }` regardless
of whether the handler itself failed — so a real `thread.merge` validation
rejection (`{ok:false, error:"branchIds required"}`) or the new
`thread.delete_node`'s `{ok:false, error:"node not found"}` would have read
as success under the pre-existing check pattern once those macros were
wired up.

## What changed

### Backend

- **`server/domains/thread.js`** — `threadAnalyze`/`sentimentMap`/
  `participantStats`/`topicExtract` now derive their `messages` array via a
  shared `messagesFromArtifact()` helper that falls back to mapping
  `data.nodes` (the real lineage-tree shape: `{authorId, content,
  createdAt}`) into the message shape these macros expect, in addition to
  the pre-existing `data.messages`/`data.posts` fallbacks. Additive only —
  any caller that already supplies `.messages`/`.posts` is unaffected
  (pinned by `tests/thread-domain-parity.test.js`'s existing
  `threadAnalyze handles input` case, still green).
- **`server/server.js`** — added `registerLensAction("thread",
  "delete_node", ...)`, mirroring the existing `branch`/`merge` mutation
  pattern exactly: validates `nodeId`, removes the node **and any
  descendants** (so the tree never keeps an orphaned `parentNodeId`
  reference), persists via `saveStateDebounced()`, returns
  `{ok:false, error}` on a missing/invalid id.

### Frontend — `app/lenses/thread/page.tsx` rebuilt against the real
lineage macros

- Removed the fake chat-conversation-derived `threads`/`ThreadNode` model,
  `useLensBridge`, and the unrelated `apiHelpers.cognitive.status()` call
  that the page's loading/error gate was (incorrectly) keyed on.
- Threads are now real `useLensData<ThreadArtifactData>('thread',
  'conversation')` artifacts; the tree is built from each artifact's real
  `data.nodes` via `buildForest()` (groups by `parentNodeId`, supports
  multiple independent root messages — a real forest, not a single
  synthetic root).
- **New Thread** creates a real artifact (`data: { nodes: [] }`) and selects
  it immediately.
- **Reply / Fork** (per-row button, node-details button, `R` shortcut) opens
  a real inline composer that calls `thread.branch` with
  `{ parentNodeId, content }`, then refetches and reloads
  `thread.summarize`.
- **Merge** — each row has a real multi-select checkbox; a header "Merge N
  selected" button appears at 2+ selections and calls `thread.merge` with
  the selected node ids.
- **Delete** (node-details panel) calls the new `thread.delete_node` and
  shows the real remaining-node count; a per-thread delete icon in the
  sidebar calls the existing `useLensData` `remove(id)` (whole-artifact
  delete, was previously unreachable from the UI at all).
- **Link** now round-trips: the page reads `?node=<id>` on mount and
  resolves which thread owns it before selecting.
- Header stats (message/branch/merge/participant counts) come from a real
  `thread.summarize` call on selection change, not a client-fabricated
  `branchCount: 1` constant.
- All mutation call sites go through a shared `macroSucceeded()` helper
  that checks the *inner* handler `ok`, not just the outer envelope's
  always-`true` `ok` (closes defect 4).
- Bottom "Thread Analysis" panel: fixed to target the actually-selected
  thread (`selectedThreadId`, not `threadItems[0]?.id`); added two more
  previously-unsurfaced real macros, **Detect Consensus** and **Extract
  Decisions**, with dedicated result rendering.
- Sidebar "Search threads" now genuinely filters the thread list (it
  previously filtered node content but was labeled and positioned as a
  thread-list search); a separate "Filter messages" input was added inside
  the content pane for node-level filtering (applies to timeline/linear
  views).
- Added `useLensCommand` shortcuts `N` (new thread), `R` (reply to
  selected/root), `Escape` (close reply/details) alongside the pre-existing
  `/` (focus thread search) — all form-tag-guarded by the existing hook
  convention so they don't fire while typing.

## Macro → UI classification (37 macros)

**DESIGNED** — 36/37 after this pass (was 26/37 before — the composer half
was already fully covered; the 10-macro lineage/analysis half was almost
entirely unsurfaced or mis-wired):

| Macro group | Count | Where |
|---|---:|---|
| `draft-list`, `thread-dashboard`, `best-time`, `split-preview`, `draft-detail`, `thread-draft`, `draft-update`, `draft-delete`, `draft-schedule`, `draft-publish` | 10 | `ThreadComposer.tsx` (pre-existing, real) |
| `account-connect/-list/-update/-disconnect`, `media-attach/-list/-reorder/-remove`, `queue-calendar`, `ai-suggest-hook`, `ai-rewrite`, `cta-templates`, `restyle-preview`, `publish-to-account`, `engagement-sync`, `engagement-report` (`draft-list` also called here, already counted above) | 16 | `ThreadStudio.tsx` (pre-existing, real) |
| `threadAnalyze`, `sentimentMap`, `participantStats`, `topicExtract` | 4 | `page.tsx` bottom panel (**field-shape mismatch fixed this pass**) |
| `branch`, `merge` | 2 | `page.tsx` tree view (**newly wired this pass — were UNSURFACED**) |
| `summarize` | 1 | `page.tsx` header stats (**newly wired this pass — was UNSURFACED**) |
| `detect_consensus`, `extract_decisions` | 2 | `page.tsx` bottom panel (**newly wired this pass — were UNSURFACED**) |
| `delete_node` | 1 | `page.tsx` node-details delete (**new macro, added this pass**) |

**UNSURFACED** — 1/37: `queue-list` (returns the same "drafts with
`status='scheduled'`" data that `queue-calendar` already renders as a
week/month grid and `draft-list({status:'scheduled'})` could filter to — no
frontend caller uses it, pre-existing and unrelated to this pass's defects).
Not wired: a second, redundant flat-list rendering of data the calendar view
already covers isn't a capability gap, so this is left as an honest,
low-priority note rather than new UI. (10 + 16 with 1 shared = 26 composer
macros wired pre-existing, 27th (`queue-list`) unsurfaced, 4 analysis + 6
lineage = 10 newly-fixed/wired this pass, total 26 + 10 = 36 DESIGNED.)

## Investigated and honestly deferred

- ~~**No cross-artifact "duplicate this thread" / clone feature.**~~ **CLOSED
  (2026-07-16, `09ee34bd`)** — new `thread.thread-clone` macro, modeled on
  the `thread-draft`/`draft-delete` per-user CRUD pattern. Deep-copies
  content/platform/posts explicitly (not a shallow spread) so independence
  is true by construction; media gets newly minted `med_` ids rather than
  sharing the source's, matching the only other media-creating path
  (`media-attach`) in the file. The clone always resets to draft status
  with no schedule regardless of the source's status — Typefully's actual
  "duplicate" use case is edit-and-repost, not silently re-publishing.
  `ThreadComposer.tsx` gets a Duplicate button beside the existing Delete.
  21 new backend tests, 4 new frontend tests. The prior fake header had a
  "Fork thread" button; it's gone (superseded by real per-node
  `thread.branch`, which forks *from a specific message*, `ThreadNodeActions`'s
  DTU-backed "Branch DTU", which forks *into a new standalone DTU*, and now
  `thread-clone`, which duplicates the *entire thread* as a new artifact).
- **`thread.branch` accepts empty `content`** (defaults to `""`) — the
  frontend already disables Post while the composer is empty, so this is a
  backend leniency, not a reachable UI gap. Left unchanged rather than
  touching validation logic outside this pass's defect list.
- **`useAuth()`-resolved `user.id` is used only for "You" labeling and
  linear-view left/right alignment** — a real author id is always what's
  stored server-side (`ctx.actor?.userId || "anon"` in `branch`,
  `ctx.actor?.userId || "system"` in `merge`); the UI never invents an
  author.

## Verification

```
node --check server/server.js server/domains/thread.js
# → OK

cd server && node --test tests/thread-domain-parity.test.js
# → 32/32 pass, 0 fail

cd concord-frontend && npx eslint app/lenses/thread/page.tsx
# → clean, 0 errors/warnings

node scripts/verify-lens-backends.mjs
# → {"WIRED":258,"NO-BACKEND-CALL":2} total 260 (thread: WIRED)

node scripts/grade-ux-polish.mjs --honest
# → audit/ux-polish-honest.json["thread"]: tier "polished",
#   isGenericScaffold: false, bespokeRatio 0.527, pillarsPresent 5/5,
#   antiPatterns 0
# (audit/ reverted with `git checkout -- audit/` after grading — shared tree)
```
