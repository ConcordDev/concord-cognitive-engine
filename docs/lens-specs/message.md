# message — Feature Gap vs Slack

Category leader (2026): Slack (team messaging). The lens also bridges the social DM substrate for real person-to-person delivery. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/message.js` (~48 macros: channels, messages, threads, reactions, labels, snooze, schedule, status, search, AI) + REST `/api/social/dm/*` for cross-user DM.

## Has (verified in code)
- Channels — create/list/archive (channel/DM/group-DM kinds), bookmarks, pinned messages
- Messages — send/list/edit/delete/mark-read; threads (reply/list); reactions; voice notes
- Inbox & focus — saved items, labels, snooze, scheduled send, inbox summary, status & presence
- Search — index + keyword search; AI channel summary, smart replies, action-item extraction, NL search
- Real cross-user DM via `/api/social/dm/*` (conversations, send, read)
- InboxShell / SlackShell rival-shape UI, MessageStream, ChannelExtrasBar, StatusControl

## Missing — buildable feature backlog
- [x] `[L]` Huddles — live audio/video calls in a channel (WebRTC)
- [x] `[M]` File sharing & attachments — upload, preview, file browser per channel
- [x] `[M]` Realtime typing indicators & live message delivery (currently macro-poll for workspace)
- [x] `[M]` Slack-style workflow/bot integrations — slash commands, app messages
- [x] `[S]` Rich message composer — formatting toolbar, code blocks, emoji picker
- [x] `[M]` Notification preferences — per-channel mute, keyword alerts, do-not-disturb schedule
- [x] `[S]` User profiles & directory within a workspace

## Parity
~95% of Slack's surface. Channels, threads, reactions, labels, snooze, scheduled send, AI summaries, real DM plus audio/video huddles, file sharing, live typing/delivery state, slash-command integrations, per-channel notification preferences, a member directory, and a rich composer all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
