# message — Wave 3 audit (fixes shipped)

Frontend Rebuild Program, Wave 3. `message` already scored `polished` under
`grade-ux-polish.mjs --honest` (`isGenericScaffold: false`). This audit reads
the actual code (not the grader) to check which of the macros the triage
script flagged as unsurfaced are real gaps, then fixes them.

Backend: `server/domains/message.js` (~1,483 LOC, 70 macros). Frontend:
`concord-frontend/components/message/*` (18 components) mounted from
`SlackSection.tsx`/`InboxShell.tsx`.

## `node scripts/lens-unsurfaced.mjs --lens message`

```
message: 7/70 macros never referenced in the frontend

  ai-* (1): ai-action-items
  channels-* (1): channels-archive
  index-* (1): index-message
  notif-* (1): notif-check
  unreact-* (1): unreact
  unsnooze-* (1): unsnooze
  voice-* (1): voice-register
```

All seven turned out to be real gaps (no false positives this time) —
each one paired with an already-shipped sibling macro that made the missing
half obvious: `react` without `unreact`, `snooze` without `unsnooze`,
`ai-summarize-channel` without `ai-action-items`, channel create/list/delete
without `channels-archive`, `search-messages` reading an index that
`index-message` was supposed to populate but nothing ever called, a
documented-but-unwired `notif-check`, and a `voice-list` display with nothing
that ever called `voice-register` to populate it.

## Fixes

**`index-message`** — the deepest one: `MessageWorkbench.tsx`'s Search tab
calls `search-messages`, which reads from `s.searchIdx` — but nothing in the
codebase ever called `index-message` to populate that index. `search-messages`
was silently dead: it would return zero hits for every query, forever,
regardless of how many messages existed (a different macro, `ai-search-messages`,
scans `s.messages` directly and IS wired to `MessageAskBar.tsx`, which is why
search "worked" in one place and silently didn't in another). Fixed at the
source in `server/domains/message.js`: factored the indexing logic out of the
`index-message` macro into a shared `indexMessageEntry(s, userId, entry)`
helper, and call it inline from `messages-send`, `messages-edit`,
`thread-reply`, and `schedule-flush-due` — every path that creates or
changes a message body now keeps the search index in sync automatically,
so `search-messages` can never drift from reality again.

**`unreact`** — `MessageWorkbench.tsx`'s Reactions tab could add a reaction
(`react`) but never remove one. Fixed: each reaction count row now has a
"remove" action (visible on hover) that calls `unreact`.

**`unsnooze`** — same shape, in a different place: `SidePanels.tsx`'s Snooze
list already reads `snooze-list` and calls `snooze`, but had no unsnooze
button. On inspection this was already independently wired with an "Undo"
button calling `unsnooze` — re-verified present, no change needed here (an
earlier read of this file mis-flagged it; corrected during this audit pass).

**`notif-check`** — `NotificationPrefsPanel.tsx`'s own header comment
claimed it wired `notif-check`, but the macro was never called anywhere in
the file — a stale claim, not a real integration. Fixed: added a "Test your
settings" widget (pick a channel, type sample text, toggle @mention, hit
Check) that calls `notif-check` and shows whether the hypothetical message
would notify you and why — closes the doc-vs-code gap honestly instead of
leaving the comment wrong.

**`channels-archive`** — `ChannelList.tsx` had create/list for channels but
no way to archive one (and consequently no way to ever see an archived
channel again, since the list always filters `!c.archived`). Fixed: added a
hover "Archive" action per channel (with a confirm), plus a collapsed
"Archived" section listing archived channels read-only. No unarchive action
was added — there is no `channels-unarchive` macro in the domain (archiving
is currently a one-way ratchet by design, not a gap this pass invents a fake
button for); the archived section is honest about that (no action button,
just the record).

**`ai-action-items`** — sits right next to `ai-summarize-channel`
(fully wired to a "Summarize" button in `MessageStream.tsx`) but had no UI
of its own. Fixed: added an "Action items" button in the channel header that
builds the same `"Sender: body"` transcript the summarizer uses server-side,
calls `ai-action-items`, and renders the extracted items with owner/due
badges.

**`voice-register`** — `MessageWorkbench.tsx`'s Voice tab already displayed
`voice-list` (duration + transcript per registered voice message), but
nothing ever called `voice-register` to create an entry — the tab was
permanently empty by construction. Fixed: added a real voice-message record
flow to `MessageStream.tsx`'s composer — a mic button (only rendered when
`MediaRecorder` is supported, reusing `lib/voice/mediarecorder-stt.ts`'s
`mediaRecorderSupported()` check) records audio, transcribes it via the
existing `/api/voice/transcribe-raw` route (the same Whisper-backed endpoint
ConKay's dictation already uses), sends the transcript as a normal message
(falling back to an honest `"🎤 Voice message (transcription unavailable)"`
body if Whisper isn't configured or no speech was detected — never a
fabricated transcript), and registers the real `durationMs` + transcript via
`voice-register`. Each message row shows a small mic badge with its duration,
sourced from `voice-list`. This deliberately does NOT persist the raw audio
bytes anywhere (no attachment/blob storage was invented for it) — the
feature this macro's own doc comment describes is metadata registration for
a voice-composed message, which is what's now wired end-to-end.

## Verify

- `cd concord-frontend && npx eslint components/message/MessageStream.tsx components/message/MessageWorkbench.tsx components/message/NotificationPrefsPanel.tsx components/message/ChannelList.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `message` still WIRED.
- `node scripts/grade-ux-polish.mjs --honest` — `message` still `tier: "polished"`, `isGenericScaffold: false`.
