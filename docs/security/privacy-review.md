# Concord Privacy Review Checklist

Sprint 29 — formal privacy review.

**Last updated:** 2026-05-11
**Scope:** All systems handling user data (auth, marketplace, federation, DTU substrate, mobile, analytics).
**Reviewer:** Maintainer (solo dev).
**Re-review:** every quarter, or on any new data-collection point.

---

## Data inventory

For each category, we list: what's collected, why, where stored, retention, who can see it.

### 1. Account credentials

| Field | Why | Storage | Retention | Access |
|---|---|---|---|---|
| Email | Login + recovery | `users.email` (SQLite) | Until account deleted | User + maintainer (DB direct only) |
| Username | Display | `users.username` | Until renamed / deleted | Public on profile |
| Password hash | Auth | `users.password_hash` (bcrypt or argon2) | Until rotated | None (write-only verify) |
| JWT secret | Session signing | env var `JWT_SECRET` | Rotates manually | None |

### 2. Money path

| Field | Why | Storage | Retention | Access |
|---|---|---|---|---|
| Wallet balance (CC + sparks) | Spend/withdraw | `user_wallets` | Indefinite (financial record) | User; maintainer (audit) |
| Stripe customer id | Token purchases | `stripe_customers` | Indefinite | User; maintainer; Stripe |
| Ledger entries | Audit trail | `economy_ledger` | Indefinite (legal: 7y minimum) | User; maintainer |

### 3. DTU substrate

| Field | Why | Storage | Retention | Access |
|---|---|---|---|---|
| Personal DTUs | The user's thoughts | `dtus WHERE scope='personal'` | Until user deletes | User ONLY — `personal_dtus_never_leak` invariant |
| Public DTUs | Marketplace | `dtus WHERE scope='public'` | Until creator hides | Anyone (post-purchase if paid) |
| Citations | Royalty cascade | `dtu_citations` | Indefinite (royalty math) | User + downstream cited authors |

### 4. World / Concordia state

| Field | Why | Storage | Retention | Access |
|---|---|---|---|---|
| Player position | Realtime presence | `city_presence` (in-memory + persisted) | Active session + 7d | Other players in same world |
| Combat log | Game state | `damage_events` | 30d | Player + target |
| Chat history | Concordia dialogue | `npc_conversations` | 90d | Player |

### 5. Mobile-specific

| Field | Why | Storage | Retention | Access |
|---|---|---|---|---|
| API keys (BYO) | Bring-your-own-LLM | `expo-secure-store` / IndexedDB (encrypted) | Until rotated | Device-local only |
| Push token | Notifications | Server-side (`push_tokens`) | Until uninstall | Maintainer (sends notification) |
| BLE pairing data | Local peer discovery | Device only | Session | Adjacent device after consent |

### 6. Federation

| Field | Why | Storage | Retention | Access |
|---|---|---|---|---|
| Peer registry | Federation graph | `cri_instances` | While peer is reachable | Federation participants |
| Shadow DTUs | Cross-instance reads | `dtus WHERE meta_json LIKE '%federated_signal%'` | Same as parent | Federation participants |

---

## GDPR Article-by-Article compliance

| Article | What it requires | Concord status |
|---|---|---|
| **Art. 6** (Lawfulness) | Legal basis for processing | Contract (account) + Consent (analytics opt-in) |
| **Art. 7** (Consent) | Specific, informed, withdrawable | Consent UI on signup; `account.consent_revoke` macro |
| **Art. 15** (Right of access) | User can export their data | `exportUserCorpus` (DTU portability) — gated at `platinum-gdpr.test.js` |
| **Art. 17** (Right to erasure) | User can delete account + data | `user.delete` macro — cascades to wallet, DTUs, ledger (tombstoned for 7y audit retention) |
| **Art. 20** (Data portability) | Machine-readable export | `concord-dtu-pack/v1` envelope spec |
| **Art. 25** (Privacy by design) | Default-private | All new DTUs default `scope='personal'`; `personal_dtus_never_leak` invariant |
| **Art. 32** (Security) | Appropriate technical measures | Sprint 18 platinum gates (SAST, DAST, encryption-at-rest via SQLite, TLS via reverse proxy) |
| **Art. 33** (Breach notification) | Notify within 72h | Documented in `docs/security/incident-response.md` (TODO if not exists) |

---

## CCPA delta

California-specific deltas from GDPR baseline:

- ✅ Right to know (same as GDPR Art. 15)
- ✅ Right to delete (same as GDPR Art. 17, no 7y audit-retention exception under CCPA)
- ✅ Right to opt-out of sale — Concord doesn't sell user data; the marketplace is creator-driven only (royalty path)
- ✅ Non-discrimination — pricing identical for users who exercise rights

---

## Data minimisation audit

For each subsystem, we ask: do we collect more than we need?

| Subsystem | Field | Could we drop it? | Decision |
|---|---|---|---|
| Auth | Email | No — recovery requires it | Keep |
| Auth | Full name | Yes — display name suffices | **Drop** (already not collected) |
| Auth | IP address | Stored on login for rate-limiting | Keep, retention 30d |
| Marketplace | Stripe customer id | Required for refunds | Keep |
| World | Player position log | Used for anti-cheat; 7d retention | Keep with retention |
| Mobile | Device id | Required for push routing | Keep |
| Federation | Peer registry | Required for graph | Keep |

---

## Log scrubbing rules

Logs MUST NOT contain:

| Pattern | Why | Where enforced |
|---|---|---|
| Password (any form) | Catastrophic if leaked | `logger.js` redacts `password` key + sub-keys |
| JWT token | Session hijack | Same |
| API key (sk-, sk-ant-, AIza, xai-) | Account compromise on remote LLM | Same |
| Stripe secret | Money path compromise | Same |
| Full email of non-current-user | PII spillover | Logged only for actor in current request |
| Card number / CVV | PCI scope | Never seen — Stripe handles |
| Personal DTU content | personal_dtus_never_leak | DTU IDs only in logs, not body |

Test gate: `platinum-privacy-review.test.js` scans log-emit sites for these patterns.

---

## User-facing privacy commitments

These appear in the public privacy policy (`/legal/privacy`):

1. **We never sell user data.** Marketplace is creator-driven; royalties flow to creators, not Concord, beyond the documented 4% + 1.46% fees.
2. **Personal DTUs are private by default.** No federation, no NPC eavesdrop, no analytics — until you publish.
3. **You can export everything we have on you, anytime.** Self-service via `/api/user/export`.
4. **You can delete everything, anytime.** Self-service via `/api/user/delete`. We tombstone ledger entries for 7y for tax compliance; everything else is hard-deleted.
5. **We don't profile you for ads.** No behavioural advertising; no third-party tracking pixels.

---

## Backlog

| Item | Why | When |
|---|---|---|
| Audit-log integrity hashing | Prevent tamper of ledger | Before SOC 2 Type II |
| HSTS preload list submission | Browser-enforced HTTPS | After domain stabilises |
| Field-level encryption for `users.email` at rest | Defence-in-depth | When DB is on shared infra |
| Cookie-banner localisation | GDPR consent recognition in non-EN locales | When non-EN traffic >5% |
| DPA template for B2B tenants | Required for enterprise | When first B2B tenant signs |
