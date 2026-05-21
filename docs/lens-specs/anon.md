# anon — Feature Gap vs Signal

Category leader (2026): Signal (private messaging). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/anon.js` (377 LOC) — `runArtifact` actions `anonymize`, `privacyRisk`, `differentialPrivacy`; generic artifact store for messages + identities; TorNetworkStatus panel.

## Has (verified in code)
- Anonymous identity with rotate (alias regeneration), public-key display
- Send message with recipient ID, ephemeral/self-destruct toggle
- Anonymity-level meter (low/medium/high), session timer
- Privacy compute: k-anonymity, privacy-risk attack models, differential privacy (epsilon budget)
- Received-messages inbox with hide/show toggle

## Missing — buildable feature backlog
- [ ] `[L]` Actual end-to-end encryption — messages stored as plain artifact data despite "E2E" label
- [ ] `[M]` Real-time message delivery (socket) instead of artifact polling
- [ ] `[M]` Verified key exchange / safety-number comparison
- [ ] `[S]` Ephemeral timer enforcement server-side (expiresAt set but not swept)
- [ ] `[M]` Group conversations
- [ ] `[S]` Disappearing-message default per conversation
- [ ] `[S]` Sealed-sender / metadata minimization

## Parity
~35% of Signal's surface. The privacy-analytics tools are real and unusual, but the headline claim — E2E encrypted messaging — is not implemented; messages are stored in cleartext in the artifact store.
