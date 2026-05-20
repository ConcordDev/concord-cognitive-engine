# message — Feature Completeness Spec

Rival app(s): Slack, Microsoft Teams (2026)
Sources:
- https://slack.com/ (channels, DMs, threads, reactions, pins, bookmarks, status/presence, scheduled send, saved items, search, huddles)
- https://www.microsoft.com/microsoft-teams (channels, activity feed, mentions)

The lens also bridges the social DM substrate (`/api/social/dm/*`) for
real person-to-person messaging; this spec covers the workspace
(Slack-shape) macro surface in `server/domains/message.js`.

## Features

### Channels & messages
- [x] Channels — create / list / archive (channel / DM / group-DM kinds) (macro: message.channels-*)
- [x] Channel bookmarks — add / list / remove (macro: message.bookmark-*)
- [x] Messages — send / list / edit / delete / mark-read (macro: message.messages-*)
- [x] Pinned messages — pin / unpin / list, channel-scoped (macro: message.pin-message / unpin-message / pins-list)
- [x] Threads — reply / list (macro: message.thread-reply / thread-list)
- [x] @mention fan-out into the activity feed (macro: message.activity-feed)
- [x] Reactions — react / unreact / reactions-for (macro: message.react / unreact / reactions-for)
- [x] Voice notes — register / list (macro: message.voice-register / voice-list)

### Inbox & focus
- [x] Saved (starred) items — save / unsave / list (macro: message.save-message / unsave-message / saved-list)
- [x] Labels — list / create / apply / remove / for-message (macro: message.labels-*)
- [x] Snooze a conversation — snooze / list / unsnooze (macro: message.snooze / snooze-list / unsnooze)
- [x] Scheduled send — schedule / list / cancel / flush-due (macro: message.schedule-*)
- [x] Inbox summary — channel / unread / mention / scheduled / snoozed counts (macro: message.inbox-summary)
- [x] Status & presence — set / get / clear, with auto-expiry (macro: message.status-set / status-get / status-clear)

### Search & AI
- [x] Index + keyword search across messages (macro: message.index-message / search-messages)
- [x] AI channel summary (macro: message.ai-summarize-channel)
- [x] AI smart replies (macro: message.ai-smart-reply)
- [x] AI action-item extraction (macro: message.ai-action-items)
- [x] AI natural-language message search (macro: message.ai-search-messages)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Huddles (live audio/video) | WebRTC media servers + signalling | the `voice` lens covers recorded voice; voice-note register/list lives here |
| Real cross-user delivery | the social DM substrate handles this | workspace macros are per-user STATE; social DM routes (`/api/social/dm/*`) carry real person-to-person delivery |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/message.js` clean. 48 macros
  (channels/messages + threads + reactions + inbox/focus + status + search/AI).
- 2026-05-20: Tests — `tests/message-domain-parity.test.js` 47/47 green
  (saved / channels / messages / threads / reactions / labels / snooze /
  schedule / AI / inbox-summary / pinned-messages pin-list-unpin + unknown-id
  reject / channel bookmarks add-list-remove / status set-get-clear per-user).
- 2026-05-20: Frontend — `MessageStream` gains a `ChannelExtrasBar` (bookmarks
  strip + pinned-messages popover) and a per-message Pin action;
  `SlackShell` mounts a `StatusControl` (emoji presets, presence, auto-clear)
  at the foot of the activity rail. `npx tsc --noEmit` exit 0.
