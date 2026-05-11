# Concord Cognitive Engine — Threat Model

Sprint 27 — formal STRIDE threat model.

**Last updated:** 2026-05-11
**Scope:** All subsystems in `server/`, `concord-frontend/`, `concord-mobile/`, including federation peers.
**Reviewers:** Maintainer (solo dev). Re-review trigger: any new external integration, any new auth surface, any change to the money path (marketplace, withdrawals, royalty cascade), any new federation primitive.

---

## What STRIDE is

Microsoft's mnemonic for the six classes of threat. Each subsystem below is analysed across all six:

| Letter | Threat | What it looks like |
|---|---|---|
| **S** | Spoofing | Attacker impersonates a legitimate user or service. |
| **T** | Tampering | Attacker modifies data in transit, at rest, or in memory. |
| **R** | Repudiation | Attacker performs an action and denies it; no audit trail proves them wrong. |
| **I** | Information disclosure | Attacker reads data they shouldn't (PII, secrets, private DTUs). |
| **D** | Denial of service | Attacker prevents legitimate users from using the system. |
| **E** | Elevation of privilege | Attacker gains capabilities beyond their role (user → admin, etc). |

Reference: Microsoft Threat Modeling Process, OWASP Threat Modeling Cheat Sheet, Shostack's *Threat Modeling: Designing for Security*.

---

## Trust boundaries

1. **Internet ↔ Express edge.** Public traffic terminates at the express server (`server/server.js`). Three-gate permission system (authMiddleware → runMacro publicReadDomains → Chicken2) is the canonical boundary.
2. **Application ↔ SQLite.** All persistent state in `server/data/concord.db`. The DB is in-process via `better-sqlite3`; no separate boundary, but file permissions matter for the boundary 4 case below.
3. **Application ↔ Ollama brains.** Five Ollama HTTP services on 11434-11438. Local-only by default. Brain calls go through `server/lib/llm-router.js`.
4. **Filesystem.** Artifacts stored under `./data/artifacts/{dtuId}/`. Skill imports under `./data/skill-imports/`. Anything reading user-supplied paths must use the containment helper from `routes/skills.js`.
5. **Federation peer ↔ Concord.** Federation traffic is bearer-token authed (`CONCORD_FEDERATION_TOKEN`). Inbound federated signals are tagged `federated_signal` and don't reach the personal-locker scope.
6. **Stripe ↔ Concord.** Token purchases go through Stripe; we never see card details. Webhook signature verified via `webhook-auth.js#verifyWebhook` HMAC.

---

## Subsystem-by-subsystem analysis

### 1. Authentication / session (auth-middleware, JWT cookie)

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| **S** | Forged JWT signing | `JWT_SECRET` env var; rotation policy documented; production requires secret >=32 chars. | Low — secret leakage risk; mitigated by env-only storage + secrets-scan gate. |
| **S** | Session fixation | Cookie is HttpOnly, SameSite=Lax, Secure in prod (`server/lib/auth.js` cookie opts). | Low. |
| **T** | Cookie tampering | JWT signed with HS256; verification fails on tamper. | Negligible. |
| **R** | "I didn't make that request" | Every mutation writes to `economy_ledger` / `audit_log` with user_id + timestamp. | Low — audit-log integrity hashing would tighten. (Backlog.) |
| **I** | Token reuse after logout | Cookie cleared on logout. Refresh token has 30d TTL. | Medium — no token revocation list. Trade-off: revocation list is a per-request DB read. (Accept.) |
| **D** | Brute-force password | Rate limiter (`express-rate-limit` configured). bcrypt for password hash. | Low. |
| **E** | Role escalation via cookie edit | Role embedded in signed JWT; cannot edit without secret. | Negligible. |

### 2. Three-Gate authorisation (Chicken2 / publicReadPaths / runMacro)

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| **S** | Bypass via crafted path | All three gates check independently. Unit tests pin the contract (`tests/three-gate.test.js`). | Negligible. |
| **E** | New route forgets a gate | `npm run check-route-auth` baseline + CI gate fails any new unauthenticated route without an explicit `// AUTH:` marker. | Low. |
| **I** | publicReadDomains too permissive | Manual review of additions; `npm run check-route-auth` flags drift. | Low. |

### 3. Marketplace / royalty cascade / wallet (money path)

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| **T** | Double-spend via race | All wallet mutations inside a `db.transaction` block. SQLite synchronous engine. | Low. |
| **T** | Replay attack on purchase | `refId` idempotency key — `event_reward:{eventId}:{userId}` style. Re-runs are no-ops. | Negligible. |
| **R** | "I never bought / I refunded" | Every credit/debit writes to `economy_ledger` with refId. | Low. |
| **D** | Sell → withdraw → refund exploit | 48-hour withdrawal hold (`server/economy/withdrawals.js#WITHDRAWAL_HOLD_HOURS = 48`); only credits older than 48h withdrawable. | Negligible (constitutional invariant). |
| **E** | Manipulate royalty ratios | Constants are hardcoded in `server/lib/creative-marketplace-constants.js`; cannot be changed via API. Test: `royalty-cascade.test.js` pins the math. | Negligible. |
| **I** | Citation without consent | `registerCitation` short-circuits with `citation_consent_not_granted` unless parent is public OR creator opted in OR buyer holds purchased license. | Negligible. |

### 4. DTU substrate (storage + consolidation)

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| **I** | Personal DTUs leak to NPCs / federation | `personal_dtus_never_leak` invariant: `scope='personal'` filtered in `social-npc-bridge.js`, `federation.js`, narrative-bridge. Test gate: `platinum-gdpr.test.js`. | Negligible. |
| **T** | Forge a DTU pack envelope | Each `.dtu` pack is hashed (SHA-256) at the envelope level; `validateEnvelope` detects tampering on import. | Low. |
| **D** | Memory exhaustion via uncapped consolidation | `CONCORD_MAX_SHADOWS=50000` cap. Memory-pressure watchdog (`server/lib/memory-pressure.js`). | Low. |

### 5. Federation / peer registry

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| **S** | Forged peer identity | `CONCORD_FEDERATION_TOKEN` bearer required when set. ActivityPub: webfinger lookup. | Medium — without HTTP signature, a bearer leak compromises the channel. (Backlog: HTTP signature requirement.) |
| **T** | Tampered DTU on import | Envelope hash verified before persistence. | Negligible. |
| **D** | Peer floods with junk | `CONCORD_LLM_QUEUE_DEPTH` cap; rate limiter on `/api/world/social-shadows`. | Low. |
| **E** | Federated peer mutates local state | Imports tagged `federated_signal`; do not reach personal-locker scope. | Negligible. |

### 6. Brain / LLM router (Ollama + chat)

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| **I** | Prompt injection exfiltrates secrets | Tier-3 platinum gate at `platinum-prompt-injection.test.js` (Sprint 30). Brain context never includes raw env vars or DB credentials. NPC secrets stripped at `narrative-bridge.js:184` + canary scan at `:220`. | Medium — novel injection classes are an arms race. Continuous gate. |
| **T** | Tool-use endpoint hijack via injection | `runMacro` enforces three-gate auth on each tool call. Macros are explicitly listed; nothing else routable. | Low. |
| **D** | LLM queue exhaustion | `CONCORD_LLM_QUEUE_DEPTH=1000` cap. Per-user dialogue cap `CONCORD_DIALOGUE_MAX_CONCURRENT=50`. | Low. |

### 7. SSRF surface (mcp-client, fetch-without-guard)

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| **S** | Internal-network reconnaissance | `validateSafeFetchUrl` checks private IPv4/IPv6 ranges + cloud metadata. `fetchWithPinnedIp` eliminates DNS rebinding. Sprint 18.1 closed remaining gaps in mcp-client. | Low. |
| **I** | Read cloud metadata (IMDS) | Explicit allowlist of CLOUD_METADATA_HOSTS rejected; IPv6 metadata also blocked. | Negligible. |

### 8. Path injection (file ops)

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| **I** | Traverse out of artifact dir | `containedPath` helper in `routes/skills.js`; `path.resolve` + `startsWith` containment. EMERGENT_ID_RE slug regex. | Negligible. |
| **T** | Symlink escape | `path.resolve` doesn't follow symlinks during validation. (Realpath check would be tighter — backlog.) | Low — server filesystem under our control. |

### 9. Prototype-pollution surface (dynamic property assignment)

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| **E** | `__proto__` / `constructor` key writes mutate Object.prototype | Sprint 18.1 added per-site guards: `Map` in webhook-auth; `Object.create(null)` in pipeline + nemesis; reserved-key Sets in mcp-server + sovereign; strict slug regex in sovereign set-config + toggle-job. | Negligible. |

### 10. Heartbeat / emergent loop

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| **D** | Crash in one module stops the tick | CLAUDE.md invariant: every heartbeat wraps in try/catch. `concord_heartbeat_skipped_total` Prom counter + ConcordHeartbeatOverrun alert. `platinum-chaos-heartbeat.test.js` enforces. | Low. |
| **T** | Tampered governor state | STATE held in memory; restart loads from persisted snapshot. Sovereign-only routes to mutate. | Low. |

### 11. Mobile app (concord-mobile)

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| **I** | API key leak from device storage | `expo-secure-store` (iOS Keychain / Android Keystore) on native; WebCrypto AES-GCM with non-extractable key in IndexedDB on web. | Low. |
| **S** | Replay of mobile session token | Same JWT model as web; HTTPS-only in prod. | Low. |
| **T** | MITM on local network (BLE/WiFi P2P discovery) | BLE pairing requires confirm; P2P doesn't carry credentials. | Medium — local-network adversary can see metadata. (Accept for offline-first design.) |

### 12. Webhook ingress (Stripe, GitHub, etc.)

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| **S** | Forged webhook | HMAC-SHA256 signature verification via `webhook-auth.js`. Per-domain secret. Open mode (no secret) requires explicit `CONCORD_WEBHOOK_ALLOW_OPEN=true`. | Negligible. |
| **T** | Replayed webhook | Stripe webhooks include `event.id`; idempotency key prevents double-processing. | Low. |
| **E** | Webhook handler runs as admin | Webhook handlers gated to specific domain logic; no admin-route exposure. | Negligible. |

### 13. Sovereign / debug endpoints (`/api/sovereign/*`)

| Threat | Vector | Mitigation | Residual risk |
|---|---|---|---|
| **E** | Anyone with auth can hit `/sovereign/eval` | `router.use(requireSovereign)` gates the entire `/sovereign` mount to SOVEREIGN_USERNAME or owner role only. | Negligible — single-user dev tool. |
| **I** | `eval` leaks STATE | `eval` runs in a `vm.runInNewContext` sandbox with 5s timeout. Output capped at 5KB. | Low (sovereign-only). |

---

## Risk acceptance log

| Risk | Severity | Owner | Decision | Re-evaluation trigger |
|---|---|---|---|---|
| No token revocation list (logout doesn't kill in-flight sessions) | Medium | Maintainer | Accept — single-user product; trade-off vs per-request DB read. | When multi-user roles ship with per-user role changes mid-session. |
| HTTP-signature for federation peers | Medium | Maintainer | Backlog — pin to ActivityPub spec adoption. | When 3+ peers federate in production. |
| Realpath check on path-containment | Low | Maintainer | Accept — server filesystem under our control; no untrusted symlinks. | When user-uploaded archives can include symlinks. |
| LLM novel prompt-injection class | Medium | Maintainer | Accept — continuous gate at `platinum-prompt-injection.test.js`. | Whenever the OWASP LLM Top 10 updates. |
| Local-network MITM on mobile discovery | Medium | Maintainer | Accept — offline-first design. Metadata-only exposure. | If credentials ever flow on the BLE/P2P channel. |

---

## STRIDE coverage matrix

| Subsystem | S | T | R | I | D | E | Notes |
|---|---|---|---|---|---|---|---|
| Authentication | ✅ | ✅ | ⚠️ | ✅ | ✅ | ✅ | Repudiation = audit-log integrity hashing on backlog |
| Three-Gate | ✅ | — | — | ✅ | — | ✅ | |
| Money path | — | ✅ | ✅ | ✅ | ✅ | ✅ | |
| DTU substrate | — | ✅ | — | ✅ | ✅ | — | |
| Federation | ⚠️ | ✅ | — | — | ✅ | ✅ | Spoofing = HTTP signature on backlog |
| LLM router | — | ✅ | — | ⚠️ | ✅ | — | I = prompt injection, continuous gate |
| SSRF | ✅ | — | — | ✅ | — | — | |
| Path injection | — | ⚠️ | — | ✅ | — | — | T = realpath on backlog |
| Prototype pollution | — | — | — | — | — | ✅ | |
| Heartbeat | — | ✅ | — | — | ✅ | — | |
| Mobile | ⚠️ | ✅ | — | ✅ | — | — | S = local-network MITM accept |
| Webhook | ✅ | ✅ | — | — | — | ✅ | |
| Sovereign endpoints | — | — | — | ✅ | — | ✅ | |

Legend: ✅ mitigated · ⚠️ partially mitigated (accepted risk or backlog) · — not applicable

---

## Re-review triggers

This document is re-reviewed when ANY of:

1. A new external integration ships (new federation peer, new OAuth provider, new payment processor).
2. A new auth surface lands (new role, new API key family, new session shape).
3. A new SSRF entry point lands (any new outbound `fetch` not routed through `validateSafeFetchUrl`).
4. The money path changes (royalty math, withdrawal flow, marketplace fee).
5. A new heartbeat module ships that interacts with user data.
6. OWASP Top 10 or OWASP LLM Top 10 updates.
7. A real incident occurs in production.

---

## References

- OWASP Threat Modeling Cheat Sheet — https://cheatsheetseries.owasp.org/cheatsheets/Threat_Modeling_Cheat_Sheet.html
- OWASP API Security Top 10 (2023)
- OWASP LLM Top 10 (2025)
- Microsoft STRIDE — https://learn.microsoft.com/en-us/azure/security/develop/threat-modeling-tool-threats
- *Threat Modeling: Designing for Security* — Adam Shostack
- NIST SP 800-154 (Guide to Data-Centric System Threat Modeling)
- SOC 2 Type II — Trust Services Criteria
