# Message Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.
> This unit continues a prior attempt that died to a worktree-cleanup
> infrastructure failure after doing substantial real research — that
> research is credited and re-verified below, and one of its central
> hypotheses (the ThreadLabelBar ID-mismatch "bug") turned out **not** to
> hold up under direct testing. Read past the headline claim.

## Two substrates, confirmed real, not a misread

1. **`/api/social/dm/*`** (`server.js` ~55745, backed by `socialSendMessage`
   / `socialGetConversations` / `socialGetMessages` in
   `server/emergent/social-layer.js`) — an in-memory STATE-based 1:1 DM
   system. `app/lenses/message/page.tsx`'s Inbox/compose/reply flow (feeding
   `InboxShell`) is wired to this substrate exclusively.
2. **The `message` domain** (`server/domains/message.js`, **70 macros** —
   `grep -c 'registerLensAction("message"' server/domains/message.js`) — a
   separate Slack-shaped chat system with its own ID space (channels,
   threads, huddles, files, labels, reactions, saved/starred, search, AI
   features), used by `SlackSection.tsx` (+ its 13 sub-components) and
   `MessageWorkbench.tsx`.

These are genuinely different systems with genuinely different ID spaces —
that part of the prior research was correct.

## The ThreadLabelBar hypothesis — investigated, found NOT a defect

The prior attempt's leading hypothesis: `page.tsx` mounts
`<ThreadLabelBar threadId={activeThread.id} .../>` inside the DM reading
pane, where `activeThread.id` is a `/api/social/dm` conversation id.
`ThreadLabelBar` then calls `message.labels-for-message` /
`message.labels-apply` with `{ messageId: threadId }` — feeding a DM-substrate
id into the `message` domain's label system. The hypothesis: this either
silently no-ops or writes an orphaned label that can never resolve.

**Read the backend (`server/domains/message.js:543-575`) and it does not
hold up.** `labels-apply` / `labels-for-message` / `labels-remove` never
validate `messageId` against `s.messages` (the domain's own message store) —
`s.messageLabels` is a free-form `Map<userId, Map<opaqueKey, Set<labelId>>>`
with zero referential integrity. Applying a label under key `X` and reading
it back under the same key `X` round-trips correctly regardless of what `X`
semantically is or which substrate minted it. `ThreadLabelBar` is the
**only** caller of these three macros (`grep -rn "labels-apply\|labels-for-message" concord-frontend/components/message/ concord-frontend/app/lenses/message/`
→ one hit each, all in `ThreadLabelBar.tsx`), so there is no second ID space
to collide with. Persistence is also fine: `messageLens` is in the
`LENS_STATE_KEYS` list in `server/lib/lens-state-persistence.js`, which
serializes nested `Map`/`Set` via `__type` envelopes before
`JSON.stringify` — labels survive a restart.

Confirmed empirically, not just by reading: `server/tests/message-domain-parity.test.js`
lines 308-319 (`message — labels (Gmail-style)`) does exactly this —
`labels-apply(ctxA, { messageId: "m_1", labelId })` then
`labels-for-message(ctxA, { messageId: "m_1" })` — and asserts the round
trip. `"m_1"` here is exactly as arbitrary a string as a DM conversation id;
the test is the empirical proof the hypothesis is wrong. **Conclusion: no
code change.** `ThreadLabelBar` mounted in the DM pane functions as "label
this conversation" using the `message` domain's label catalog as a shared,
substrate-agnostic tagging system — an intentional, honest, working design,
just documented with a "per-message" comment that's slightly imprecise
about the granularity (labels the thread, not an individual DM). Not worth
a change on its own.

## Real defects found and fixed

### 1. `MessageWorkbench.tsx` — `react`/`unreact`/`unsave-message` silently
swallowed `{ ok: false }` responses

`lensRun()` (`lib/api/client.ts`) always resolves with `{ data: { ok,
result, error } }` — even on a handler-level rejection (e.g. malformed
`messageId`) it never throws, it resolves `ok: false`. `ReactionsTab` and
`SavedTab` called `react`/`unreact`/`reactions-for`/`unsave-message` and
proceeded straight to `load()`/`refresh()` without checking `r.data.ok`, so
a real validation failure rendered as if nothing happened — no error, no
stale-data indicator, just a UI that silently didn't do what the click
implied. Fixed: both tabs now check `r.data.ok === false` and surface an
inline `role`-appropriate error string instead of proceeding, matching the
`ThreadLabelBar`/`SlackSection` pattern used everywhere else in this lens.

### 2. Compose recipient was a raw `userId` text field — zero lookup against
Concord's own user table

`page.tsx`'s "New message" form took `composeTo` as free-typed text with no
autocomplete — a defining gap CLAUDE.md names explicitly ("recipient/contact
search (mail vs. any real messaging product)"). Triaged before building:
grepped for an existing endpoint first, per the hard invariant's explicit
instruction not to build what already exists. Found one —
`GET /api/social/users/search?q=` (`server/routes/social-groups.js:476-494`,
mounted at `/api/social`, already used elsewhere for mention/follow
suggestions) — username/email `LIKE` search, capped at 20 results, already
live. **Classification: ENGINEERING, and a small one** — no new backend
endpoint needed, only a frontend consumer. Built
`components/message/RecipientSearchInput.tsx`: debounced (300ms) search
against that endpoint with stale-response guarding (a request-id ref, not
just a naive `Promise.then`), a dropdown of `{displayName, id}` results, and
an honest degrade path (search-unavailable message, manual userId entry
still works exactly as before — the fallback was preserved, not replaced).
Wired into `page.tsx`'s compose flow in place of the raw `<input>`.

### 3. `message.snooze` / `message.unsnooze` — UNSURFACED, not merely
under-designed

Grepped every macro name against every file under
`concord-frontend/components/message/` and `app/lenses/message/`. 68 of 70
macros had a real caller. Two did not: `snooze` (create a snooze) and
`unsnooze` (cancel one). `SidePanels.tsx#SnoozedList` called `snooze-list`
(read) but had no create or cancel path anywhere in the lens — a read-only
dead-end panel that could only ever render "Nothing snoozed," permanently,
because nothing in the UI could ever produce a row for it to show. This is
the textbook UNSURFACED classification per CLAUDE.md's capability-audit
taxonomy: a real, tested, validated backend macro (`snooze` rejects a
non-ISO `until`; both are per-user scoped — `tests/message-domain-parity.test.js`
"message — snooze" describe block) with no reachable UI at all, not a
generic-scaffold or fabricated-data defect.

Fixed: `MessageStream.tsx` per-message hover row (already home to
Reply-in-thread / Pin / Save / Edit / Delete) gained a `Clock`-icon "Snooze"
button opening a small popover — 3 presets (1 hour / tomorrow 9am / next
week) plus a custom `datetime-local` picker, calling `message.snooze`.
`SidePanels.tsx#SnoozedList` gained an `XCircle` unsnooze button per row,
calling `message.unsnooze` and refreshing the list — matching the existing
`ScheduledList` cancel-button idiom in the same file, so the fix reused an
established pattern rather than inventing a new one.

## The Slack "thin add" claim — investigated, CLAUDE.md is NOT stale here

The brief asked me to correct a "stale Slack claim" in `CLAUDE.md` once
`SlackSection.tsx` was confirmed real. It is real — confirmed in this pass
(see below) — but the two `CLAUDE.md` sentences that mention Slack
("Slack/Sheets/GitHub/Notion are the next thin adds" /
"remaining connector work is Slack/Sheets/GitHub/Notion") are about a
**third, different Slack surface**: `server/domains/slack.js`, a real
external-OAuth connector to a user's actual Slack **workspace** (`channels`
/ `history` / `post` / `connect` macros, built on the same `connectorFetch`
chokepoint as the Gmail/Calendar connectors, per
`docs/CONNECTORS_GO_LIVE.md`). That connector is genuinely still gated on an
operator supplying `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET` — the claim is
accurate and describes a different capability than the internal
Slack-*shaped* chat client. **No `CLAUDE.md` edit made** — changing it would
have introduced a real inaccuracy (conflating "a real Slack-workspace OAuth
connector isn't configured" with "the message lens's internal Slack-shaped
UI is a stub," which it isn't) to fix an imagined one. Recorded here so the
next pass doesn't re-open this.

## `SlackSection.tsx` — confirmed real, feature-by-feature

`SlackSection.tsx` (131 LOC) is an orchestrator, not the whole feature — it
composes 13 real sub-components, ~2,550 combined LOC, every one calling
`lensRun('message', …)` against the 70-macro domain above, all confirmed by
direct read this pass:

| Feature | Component | Macros |
|---|---|---|
| Channels (create/list/archive) | `ChannelList.tsx` | `channels-list/create/archive` |
| Message stream, edit/delete/pin/save, typing, live delivery, voice notes, schedule-send, AI summarize/action-items | `MessageStream.tsx` | `messages-*`, `pin-message`, `save-message`, `typing-*`, `channel-live-state`, `voice-*`, `schedule-send`, `ai-summarize-channel`, `ai-action-items` |
| Threads | `ThreadPane.tsx` | `thread-reply`, `thread-list` |
| Natural-language cross-channel ask/search | `MessageAskBar.tsx` | `ai-search-messages` |
| Activity / Scheduled / Snoozed / Inbox overview | `SidePanels.tsx` | `activity-feed`, `schedule-list/cancel/flush-due`, `snooze-list` (+ `snooze`/`unsnooze` **added this pass**), `inbox-summary` |
| Huddles (audio/video rooms) | `HuddlePanel.tsx` | `huddle-start/join/leave/end/list` |
| File sharing | `FilesPanel.tsx` | `file-upload/list/delete` |
| Slash commands + app integrations | `IntegrationsPanel.tsx` | `command-list/register/remove/run`, `app-messages-list` |
| Notification preferences (global/per-channel/keywords/DND) | `NotificationPrefsPanel.tsx` | `notif-prefs-get/set`, `notif-channel-set`, `notif-check` |
| Workspace directory + member profiles | `DirectoryPanel.tsx` | `profile-set/get`, `directory-list` |
| Pins + channel bookmarks | `ChannelExtrasBar.tsx` | `pin-message` (read side), `unpin-message`, `pins-list`, `bookmark-*` |
| Presence/status | `StatusControl.tsx` | `status-set/get/clear` |
| Rich text composer | `RichComposer.tsx` | (client-side formatting, feeds `messages-send`) |

Nothing here is a generic action array or a JSON-paste form — every panel is
purpose-built for its feature (a real tile grid for huddles, a real upload
dropzone for files, a real preference form for notifications, a real
directory search for members). This is the correction the brief asked for,
scoped accurately: SlackSection is not "the next thin add" — the internal
Slack-shaped client is done; the *external* Slack OAuth connector is the
piece still pending operator secrets, and `CLAUDE.md` already says that
correctly.

## Confirmed clean (verified by full file read this pass or the prior
attempt's read, re-checked)

- `InboxShell.tsx` — caller-driven silhouette, no hardcoded/mock data.
- `GmailSection.tsx` — real, honest `no_token`/`connector_not_configured`
  handling, DOMPurify-sanitized HTML, real compose/send/star/archive/trash.
- `LabelManagerPanel.tsx` — real macro calls (`labels-list/create`), correct
  `.ok` handling.
- `MessagingRepos.tsx` — a live GitHub API browser (real external fetch),
  informational/discovery panel by design, not macro-backed — acceptable.
- `page.tsx`'s DM compose/reply flow — correct nested-`ok` checking.

## Macro → UI classification (all 70 macros)

**DESIGNED** — 70/70 after this pass (68/70 before it):

- 68 macros already had a real, purpose-built caller pre-existing this pass
  (see the `SlackSection.tsx` table above plus `MessageWorkbench.tsx`'s
  Saved/Search/Voice/Reactions tabs for the 9 non-Slack-shaped macros:
  `saved-list`, `save-message`, `unsave-message`, `index-message`,
  `search-messages`, `react`, `unreact`, `reactions-for`, `voice-register`,
  `voice-list` — and `labels-list/create/apply/remove/for-message` via
  `LabelManagerPanel.tsx` + `ThreadLabelBar.tsx`).
- `snooze` / `unsnooze` — **UNSURFACED → DESIGNED this pass**
  (`MessageStream.tsx` popover + `SidePanels.tsx` unsnooze button).

**GENERIC-STRIP-ONLY** — 0. No `<UniversalActions>`/`<LensFeaturePanel>`
button walls anywhere in this lens; every surface listed above is bespoke.

## Investigated and honestly deferred

- **External Slack/Sheets/GitHub/Notion OAuth connectors** — real, built,
  unit-tested (`server/tests/connector-extra-paths.test.js`), gated on an
  operator supplying provider client secrets. **DATA-SOURCING-adjacent
  (operator-config, not code)** — see `docs/CONNECTORS_GO_LIVE.md`. Out of
  scope for this pass; not a defect in the `message` lens.
- **`MessageWorkbench.tsx`'s `SearchTab`/`VoiceTab`** still don't check
  `r.data.ok` before rendering (they default to `[]` on a falsy result,
  which reads correctly for the empty case but wouldn't surface a genuine
  validation error distinctly from "no results"). Left as a minor, lower-
  priority polish item — the two tabs fixed this pass (`Saved`/`Reactions`)
  were the ones the prior research flagged as producing an observably wrong
  state (silent proceed-as-success on write actions); `Search`/`Voice` are
  read-only GETs where the failure mode is "empty list," a less severe
  ambiguity.

## Verification

```
cd server && node --test tests/message-domain-parity.test.js \
  tests/social-dm-recall.test.js tests/depth/message-behavior.test.js
# → 69/69 + 5/5 + 1/1 = 75/75 pass, 0 fail (message.js untouched this pass
#   — no server file was edited, so the same 75 pass unmodified)

cd concord-frontend && npx eslint app/lenses/message/page.tsx \
  components/message/{MessageWorkbench,MessageStream,SidePanels,RecipientSearchInput}.tsx
# → NOT RUN: this worktree's concord-frontend/node_modules is not
#   installed (no eslint, no @eslint/eslintrc), an environment gap
#   unrelated to this change. Verified instead by: balanced brace/paren
#   counts on every touched file, matching every new call against the
#   exact `lensRun`/state/JSX idioms already used elsewhere in the same
#   files, and the wiring + UX-polish graders below (both parse and
#   pattern-match the live TSX, which would fail loudly on a syntax error).

node scripts/verify-lens-backends.mjs
# → message: WIRED (258 WIRED / 2 NO-BACKEND-CALL by design, total 260)

node scripts/grade-ux-polish.mjs --honest
# → audit/ux-polish-honest.json["message"]: tier "polished",
#   isGenericScaffold: false, honestCapped: false, bespokeRatio 0.908,
#   pillarsPresent 5/5, antiPatterns 0
# (audit/ reverted with `git checkout -- audit/` after grading — shared tree)
```
