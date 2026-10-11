# anon — Feature Gap vs Signal

Category leader (2026): Signal (private messaging). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/anon.js` — privacy macros `anonymize`, `privacyRisk`, `differentialPrivacy` + pseudonymous messaging (`identity`, `rotateIdentity`, `safetyNumber`, `verifyPeer`, `startConversation`, `listConversations`, `sendMessage`, `readConversation`, `setDisappearing`, `sweepEphemeral`, `directory`). Frontend `AnonMessenger.tsx` + TorNetworkStatus panel.

Messages are X25519 + AES-256-GCM sealed, but the default is **not** end-to-end encryption. Concord generates both keypairs, stores the private keys, and `sendMessage` receives plaintext before sealing. The lens copy says Concord can technically read these messages. There is no E2E badge on that path.

## Has (verified in code)
- Anonymous identity with rotate (alias regeneration), public-key display
- Send message with recipient ID, ephemeral/self-destruct toggle
- Anonymity-level meter (low/medium/high), session timer
- Privacy compute: k-anonymity, privacy-risk attack models, differential privacy (epsilon budget)
- Received-messages inbox with hide/show toggle

## Missing — buildable feature backlog
- [x] `[L]` Server-sealed envelopes — X25519 ECDH + AES-256-GCM. Plaintext is not written into the stored record, but Concord receives it on send and holds the private keys, so Concord can read it. UI copy states that.
- [x] `[L]` Optional device keys — `CONCORD_ANON_CLIENT_E2E=1` on the server and `NEXT_PUBLIC_CONCORD_ANON_CLIENT_E2E=1` on the client. The browser generates the X25519 key with WebCrypto, the private key stays in localStorage, and send posts ciphertext envelopes only. Identities that already exist are not replaced, so older conversations keep opening. The words "end-to-end" appear only for a thread where every member's key is client-held.
- [x] `[M]` Real-time message delivery (socket) — `sendMessage`/`startConversation` emit `anon:message`/`anon:conversation-created` to per-user rooms; frontend listens via `useSocket`
- [x] `[M]` Verified key exchange / safety-number comparison — 12-group deterministic safety numbers + `verifyPeer` (`safetyNumber`/`verifyPeer` macros, safety-number modal)
- [x] `[S]` Ephemeral timer enforcement server-side — `sweepConversation` purges expired messages on read + `sweepEphemeral` macro
- [x] `[M]` Group conversations — `startConversation` accepts multiple `peerAnonIds`; per-recipient envelopes
- [x] `[S]` Disappearing-message default per conversation — `setDisappearing` macro + per-conversation `disappearDefaultSec`
- [x] `[S]` Sealed-sender / metadata minimization — `sealedSender` param strips `fromAnonId` from stored + wire records

## Parity
Pseudonymous messaging with group conversations, safety numbers, sealed sender, disappearing messages, server-side ephemeral sweeping, and socket delivery — plus k-anonymity, re-identification risk, and differential privacy. Encryption at rest is real. End-to-end encryption is not the default: Concord can read server-held threads. Device-held keys are the flagged path above, and they do not migrate an existing identity.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
