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
- [ ] `[L]` Huddles — live audio/video calls in a channel (WebRTC)
- [ ] `[M]` File sharing & attachments — upload, preview, file browser per channel
- [ ] `[M]` Realtime typing indicators & live message delivery (currently macro-poll for workspace)
- [ ] `[M]` Slack-style workflow/bot integrations — slash commands, app messages
- [ ] `[S]` Rich message composer — formatting toolbar, code blocks, emoji picker
- [ ] `[M]` Notification preferences — per-channel mute, keyword alerts, do-not-disturb schedule
- [ ] `[S]` User profiles & directory within a workspace

## Parity
~60% of Slack's surface. Genuinely deep — channels, threads, reactions, labels, snooze, scheduled send, AI summaries, and real DM — but missing huddles, file sharing, full realtime delivery on the workspace path, and integrations that make Slack a hub.
