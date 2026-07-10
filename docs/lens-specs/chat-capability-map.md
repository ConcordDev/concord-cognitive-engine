# Chat Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> **Handle with care note (owner directive honored):** `chat` is the
> highest-traffic lens in Concord and had an urgent layout regression fixed
> earlier this same session (commit `0840de3a` — two extra flex-row
> siblings were stealing ~550px from the message column). This lens was
> read in full before any change was made, and the audit below is scoped
> to genuine, narrow, low-risk fixes on top of that fix — not a
> second-guess or a rewrite of the page's structure.
>
> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/chat.js` (1456 LOC) in full — the entire backend
> surface for this lens (no inline registrations elsewhere; confirmed via
> grep). `app/lenses/chat/page.tsx` is 4595 LOC; `components/chat/` adds
> ~12,400 more LOC across ~38 files (`bespokeComponentLoc: 12398`,
> `maxBespokeComponentLoc: 1307` per `grade-ux-polish.mjs --honest`) — this
> is genuinely one of the deepest, most bespoke lenses in the app.
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("chat"' server/domains/chat.js`

## Backend surface — 45 macros, all real

`STATE.chatLens`-backed: assistants (custom system-prompt personas),
projects, saved prompt library, thread search index, conversation
branches, canvas (collaborative document mode), code execution + history,
image generation + history, memory (long-term facts), scheduled prompts,
share links, and participant/topic analysis for group threads.

| Macro group | Real effect | Surfaced |
|---|---|---|
| `assistant-create`/`delete`/`update`, `assistants-list` | custom persona/system-prompt profiles | DESIGNED |
| `project-create`/`delete`/`update`, `projects-list` | conversation projects/folders | DESIGNED (`ProjectsPanel.tsx`) |
| `project-get` | single-project detail fetch | **UNSURFACED** — redundant, not a gap (see notes) | 
| `prompt-create`/`delete`/`update`, `prompts-list` | saved prompt library (slash-command templates) | DESIGNED |
| `thread-index` | write a thread's title/snippet/timestamp into the server-side search index | **UNSURFACED — the write-half of a real feature was entirely missing** | **FIXED THIS SESSION** |
| `threads-search` | search the index `thread-index` populates | DESIGNED (`ThreadSearchOverlay.tsx`) — but always returned "0 threads indexed" | Now actually returns real hits |
| `branches-list`/`branch-delete` | list/delete forked conversation branches | **UNSURFACED** | Still unsurfaced — genuine scoped gap (see checklist) |
| `branch-fork` | fork a conversation at a message into a real server-persisted branch | **UNSURFACED — the consuming component (`BranchForkButton.tsx`) exists, is tested, but is never mounted anywhere** | Still unsurfaced this session — see checklist item 4 |
| `canvas-create`/`get`/`update`/`revert`/`delete`, `canvas-list` | collaborative canvas/document mode | DESIGNED |
| `code-run`, `code-history` | in-thread code execution + history | DESIGNED |
| `image-generate`, `image-history`, `image-delete` | in-thread image generation | DESIGNED |
| `memory-add`/`update`/`delete`, `memory-list` | long-term memory facts | DESIGNED |
| `scheduled-create`/`cancel`, `scheduled-list` | scheduled/recurring prompts | DESIGNED |
| `share-create`/`revoke`, `share-list` | public share-link generation | DESIGNED (`ChatStudioPanel.tsx`'s ShareTab) |
| `share-view` | resolve a share token to the shared conversation | **UNSURFACED — the share URL the UI generates and lets you copy pointed at no route in the app** | **FIXED THIS SESSION** |
| `voice-get`/`voice-update` | voice settings | DESIGNED |
| `participantAnalysis`, `topicDetection` | group-thread participant/topic analysis | DESIGNED |

**41 of 45 macros are DESIGNED.** 4 remain unsurfaced after this session:
`project-get` (redundant — `projects-list` already returns full records,
no UI needs a single-item re-fetch), `branches-list`/`branch-delete`
(genuine scoped gap, see below), and `branch-fork` (component exists,
tested, but orphaned — genuine scoped gap, see below).

## 1.5 Reference-parity checklist

**(a) Reference apps:** [Claude.ai](https://claude.ai) and
[ChatGPT](https://chatgpt.com) — both explicitly named in the codebase's
own comments (`handleExportMarkdown` mirrors "the Claude.ai / ChatGPT
behaviour," `handleBranchFromMessage` mirrors "Claude.ai's edit-rewind /
ChatGPT's 'fork from here'").

| # | Checklist item | Disposition |
|---|---|---|
| 1 | Conversation list, message thread, composer, streaming responses | ALREADY REAL | Core layout (just re-verified sound post-`0840de3a`) |
| 2 | ⌘K / "Search chats" finds real past conversations | **GENUINE DEFECT → FIXED THIS SESSION** | See below — the most-discoverable search entry point was silently broken for every user |
| 3 | Export/copy a transcript (Markdown, JSON, clipboard) | ALREADY REAL | `handleExportMarkdown`/`handleCopyTranscript` |
| 4 | Fork/branch a conversation from any message | ALREADY REAL (client-only) + GENUINELY MISSING (server-backed) | `handleBranchFromMessage` works today (creates a real, localStorage-persisted new conversation) — not fabricated, just device-local. The *separate*, real, server-persisted `branch-fork`/`branches-list`/`branch-delete` macros have a fully-built, tested `BranchForkButton.tsx` component that is **never mounted anywhere in the app** — an orphaned, unreachable feature. Left unwired this session: reconciling it with the already-working client-side branch flow is a design decision (do they coexist as "local branch" vs. "cloud/synced branch," or does one replace the other?) that deserves its own scoped pass, not a quick insert into an already-just-stabilized 4595-line page |
| 5 | Custom assistants/personas | ALREADY REAL | `assistant-*` |
| 6 | Saved prompt library / slash commands | ALREADY REAL | `prompt-*` |
| 7 | Projects/folders to organize conversations | ALREADY REAL | `project-*`/`ProjectsPanel.tsx` |
| 8 | Public share links that actually resolve when opened | **GENUINE DEFECT → FIXED THIS SESSION** | See below — same defect class as the animation lens's previously-fixed dead share link |
| 9 | In-thread code execution, image generation, collaborative canvas | ALREADY REAL | `code-run`, `image-generate`, `canvas-*` |
| 10 | Long-term memory | ALREADY REAL | `memory-*` |
| 11 | Scheduled/recurring prompts | ALREADY REAL | `scheduled-*` |
| 12 | Voice settings, group-thread participant/topic analysis | ALREADY REAL | `voice-*`, `participantAnalysis`, `topicDetection` |

**Coverage summary:** 10 of 12 checklist items already real (this is a
deep, mature lens). 2 real defects found and fixed this session (search,
share links). 1 item is a hybrid: the user-facing behavior already works
(client-side branching), but a parallel real backend feature sits fully
orphaned — named honestly as a scoped future decision rather than forced
into this pass.

## 2. What this rebuild changed

**Fixed ⌘K "Search chats" — it always reported zero results.**
`ThreadSearchOverlay.tsx` (bound to ⌘K and the "Search chats" menu item —
the primary, most-discoverable search entry point) calls the real
`chat.threads-search` macro and honestly renders "N threads indexed" — but
nothing in the entire codebase ever called `chat.thread-index` to
populate that index. Every search, for every user, silently returned
empty. (Note: a *separate*, already-working "global search" — bound to a
different, less-discoverable trigger — scans `localStorage`-persisted
messages directly and was never broken; this is why the defect went
unnoticed. That search's existence doesn't fix ⌘K's.) Fixed by adding a
2-second-debounced effect (alongside the existing message-persistence
effect) that calls `chat.thread-index` with the current thread's id,
title, latest-message snippet, and timestamp whenever the active
conversation's messages change — best-effort (a failed index write is
silently non-fatal; search staying briefly stale is preferable to
blocking the chat UI on it).

**Fixed the share-link 404.** `ChatStudioPanel.tsx`'s `ShareTab` creates
real share links (`chat.share-create`) and lets the user copy a real URL
(`/share/chat/{token}`) with a working "copied!" confirmation — implying
the link works. No route in the entire app rendered `/share/chat/[token]`,
so every copied link 404'd. Built `app/share/chat/[token]/page.tsx`,
mirroring the exact, already-shipped pattern from
`/share/animation/[token]` (see that lens's capability map for the
precedent): calls `chat.share-view`, renders the shared messages, shows an
honest "sign in to view" state for a logged-out visitor (`share-view` is
not in `server.js`'s `publicReadDomains` allowlist — widening that is a
permission-system change, deliberately not done here), and an honest error
for an invalid/revoked token.

**Audited and deliberately left alone:** the recent layout fix
(`0840de3a`) was re-verified intact — the message column owns full width,
the "Analysis & features" drawer pattern is sound, no regression
introduced by this session's two additions (both are `useEffect`s and a
new standalone route, zero layout changes). `BranchForkButton.tsx` was
found orphaned but is explicitly NOT wired this session (see checklist
item 4) — mounting it without first deciding how it relates to the
already-working client-side branch flow risks presenting the user with
two competing, confusing "fork" actions in an already load-bearing page.

## Files touched

- `concord-frontend/app/lenses/chat/page.tsx` — added the `thread-index`
  sync effect (debounced, best-effort)
- `concord-frontend/app/share/chat/[token]/page.tsx` — new public(-for-
  signed-in-users) share viewer for `chat.share-view`
- `concord-frontend/tests/chat-share-page.test.tsx` — new test pinning the
  share page's 3 honest states (sign-in prompt / real content / invalid
  token error)
- No backend changes — `server/domains/chat.js` was already complete
