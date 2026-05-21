# anon — Feature Gap vs Signal

Category leader (2026): Signal (private messaging). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/anon.js` — privacy macros `anonymize`, `privacyRisk`, `differentialPrivacy` + a real E2E messaging substrate (`identity`, `rotateIdentity`, `safetyNumber`, `verifyPeer`, `startConversation`, `listConversations`, `sendMessage`, `readConversation`, `setDisappearing`, `sweepEphemeral`, `directory`). Frontend `AnonMessenger.tsx` + TorNetworkStatus panel.

## Has (verified in code)
- Anonymous identity with rotate (alias regeneration), public-key display
- Send message with recipient ID, ephemeral/self-destruct toggle
- Anonymity-level meter (low/medium/high), session timer
- Privacy compute: k-anonymity, privacy-risk attack models, differential privacy (epsilon budget)
- Received-messages inbox with hide/show toggle

## Missing — buildable feature backlog
- [x] `[L]` Actual end-to-end encryption — X25519 ECDH + AES-256-GCM sealed envelopes; plaintext never stored (`sealEnvelope`/`openEnvelope`)
- [x] `[M]` Real-time message delivery (socket) — `sendMessage`/`startConversation` emit `anon:message`/`anon:conversation-created` to per-user rooms; frontend listens via `useSocket`
- [x] `[M]` Verified key exchange / safety-number comparison — 12-group deterministic safety numbers + `verifyPeer` (`safetyNumber`/`verifyPeer` macros, safety-number modal)
- [x] `[S]` Ephemeral timer enforcement server-side — `sweepConversation` purges expired messages on read + `sweepEphemeral` macro
- [x] `[M]` Group conversations — `startConversation` accepts multiple `peerAnonIds`; per-recipient envelopes
- [x] `[S]` Disappearing-message default per conversation — `setDisappearing` macro + per-conversation `disappearDefaultSec`
- [x] `[S]` Sealed-sender / metadata minimization — `sealedSender` param strips `fromAnonId` from stored + wire records

## Parity
~85% of Signal's surface. Real X25519 + AES-256-GCM end-to-end encrypted pseudonymous messaging with group conversations, verified safety numbers, sealed sender, disappearing messages, server-side ephemeral sweeping, and socket real-time delivery — plus the unusual privacy-analytics tools (k-anonymity, re-identification risk, differential privacy).

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
