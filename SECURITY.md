# Security Policy -- Concord Cognitive Engine

This document describes the security architecture, threat model, hardening practices,
and vulnerability disclosure process for the Concord Cognitive Engine.
It is intended for operators, contributors, and security researchers.

---

## Table of Contents

1. [Reporting Vulnerabilities](#reporting-vulnerabilities)
2. [Supported Versions](#supported-versions)
3. [Authentication and Authorization](#authentication-and-authorization)
4. [Token Lifecycle](#token-lifecycle)
5. [OAuth Integration](#oauth-integration)
6. [Middleware and Transport Security](#middleware-and-transport-security)
7. [Input Sanitization](#input-sanitization)
8. [Rate Limiting](#rate-limiting)
9. [Concord Shield -- Threat Detection](#concord-shield----threat-detection)
10. [Concord Mesh -- Transport Security](#concord-mesh----transport-security)
11. [Content Moderation](#content-moderation)
12. [Economy Security](#economy-security)
13. [GRC Invariants -- Output Safety](#grc-invariants----output-safety)
14. [Privacy Zones](#privacy-zones)
15. [LLM Security Considerations](#llm-security-considerations)
16. [Infrastructure and Container Hardening](#infrastructure-and-container-hardening)
17. [Data Security and Encryption](#data-security-and-encryption)
18. [Unsafe Surfaces Registry](#unsafe-surfaces-registry)
19. [Environment Security](#environment-security)
20. [Dependency Security](#dependency-security)
21. [Ethos Invariants](#ethos-invariants)
22. [Compliance Considerations](#compliance-considerations)
23. [Incident Response](#incident-response)

---

## Reporting Vulnerabilities

**Do not file public GitHub issues for security vulnerabilities.**

If you discover a security vulnerability in Concord, please report it through
responsible disclosure:

| Detail              | Value                                                                 |
|---------------------|-----------------------------------------------------------------------|
| **Email**           | [security@concord-os.org](mailto:security@concord-os.org)            |
| **Initial Response**| Within 48 hours of receipt                                            |
| **Assessment**      | Full severity assessment within 7 calendar days                       |
| **Disclosure**      | Coordinated disclosure after patch is available                       |

When reporting, please include:

- A clear description of the vulnerability and its potential impact.
- Detailed steps to reproduce, including environment details.
- Any proof-of-concept code or screenshots.
- Your preferred attribution name (if you wish to be credited).

We will acknowledge receipt within 48 hours, provide an initial severity assessment
within 7 days, and work with you on a coordinated disclosure timeline. We will not
pursue legal action against researchers acting in good faith.

---

## Supported Versions

| Version | Status    | Security Updates |
|---------|-----------|------------------|
| 5.x.x  | Current   | Yes              |
| 4.x.x  | Supported | Critical fixes   |
| < 4.0   | EOL       | No               |

Only the current major release receives full security patches.
The previous major release receives critical-severity fixes only.

---

## Authentication and Authorization

Concord supports four authentication modes, configured via `AUTH_MODE`:

| Mode       | Description                                   | Use Case                          |
|------------|-----------------------------------------------|-----------------------------------|
| `public`   | No authentication required                    | Local development, air-gapped     |
| `apikey`   | API key in `Authorization` header             | Service-to-service communication  |
| `jwt`      | JWT bearer tokens with refresh token rotation | Programmatic and browser access   |
| `hybrid`   | JWT + API key + cookie support (default)      | Production deployments            |

### Authentication Methods by Client Type

| Method           | Client Type        | Security Level | XSS Protected |
|------------------|--------------------|----------------|---------------|
| HttpOnly Cookies | Browser clients    | Highest        | Yes           |
| JWT Bearer Token | Programmatic APIs  | High           | No (token in code) |
| API Key          | Service-to-service | High           | N/A           |

### Password Hashing

- Algorithm: bcryptjs
- Default rounds: 12 (configurable via `BCRYPT_ROUNDS`)
- Registration is rejected if the bcrypt module is unavailable, preventing plaintext storage

### Role-Based Access Control

The first registered user is automatically assigned the `owner` role with wildcard
(`*`) scopes. Subsequent users receive the `member` role with `read` and `write`
scopes. Privileged operations check for `admin`, `owner`, or `founder` roles, or
the `economy:admin` scope.

### Founder Secret

Administrative operations in the economy subsystem accept a `FOUNDER_SECRET` header
as an operational backdoor. This comparison uses `crypto.timingSafeEqual` to prevent
timing side-channel attacks.

---

## Token Lifecycle

### Access Tokens (JWT)

| Property        | Value                              |
|-----------------|------------------------------------|
| Algorithm       | HS256                              |
| Default Expiry  | 15 minutes (access) / 7 days (configurable via `JWT_EXPIRES_IN`) |
| Secret Length   | Minimum 32 characters in production |
| Signing Secret  | `JWT_SECRET` environment variable  |

### Refresh Tokens

| Property          | Value                                          |
|-------------------|------------------------------------------------|
| Default Expiry    | 7 days (configurable via `REFRESH_TOKEN_EXPIRES`) |
| Storage           | HttpOnly cookie (`SameSite=Strict`, `Secure`)  |
| Rotation          | New refresh token issued on each use           |
| Family Tracking   | Tokens belong to families; reuse invalidates the entire family |

### Cookie Security Attributes

All authentication cookies are set with the following attributes:

```
HttpOnly:  true     (inaccessible to JavaScript)
Secure:    true     (HTTPS only, in production)
SameSite:  Strict   (no cross-site transmission)
```

### Token Blacklist

Revoked tokens are tracked across three layers for defense in depth:

1. **In-memory Set** -- immediate invalidation, no I/O latency
2. **SQLite** -- persistent across restarts
3. **Redis** -- shared across instances (when federation is enabled)

### Token Family Reuse Detection

Refresh tokens are organized into families. If a refresh token that has already
been rotated is presented again (indicating theft and replay), the entire token
family is invalidated, forcing the legitimate user to re-authenticate and locking
out the attacker.

---

## OAuth Integration

### Supported Providers

| Provider    | Protocol      | Client Secret Type | CSRF Protection            |
|-------------|---------------|--------------------|----------------------------|
| Google      | OAuth 2.0     | Shared secret      | Random `state` parameter   |
| Apple       | Sign In with Apple | ES256 JWT     | Random `state` parameter   |

### Security Measures

- **State parameter**: A 32-byte cryptographically random hex string is generated
  per authorization request and validated on callback to prevent CSRF.
- **Apple client secret**: Generated as a short-lived ES256 JWT signed with the
  Apple private key, not stored as a static string.
- **Provider availability**: OAuth routes are only mounted when the corresponding
  environment variables are configured. Unconfigured providers return 404.
- **No external OAuth libraries**: Token exchange uses Node.js built-in `fetch`
  (Node 18+) to minimize supply-chain risk.

---

## Middleware and Transport Security

### Security Headers (Helmet.js + nginx + Next.js)

Headers are set at THREE layers, and which one a browser actually sees depends on
the deployment topology -- this distinction matters and was previously glossed:

- **Express API** (`server/middleware/index.js`, Helmet) -- covers `/api/*`.
- **nginx** (`nginx/conf.d/default.conf`) -- covers everything, *when nginx is in
  the path*.
- **Next.js** (`concord-frontend/next.config.js` `headers()`) -- covers the HTML
  document. On the Cloudflare-tunnel topology root traffic goes straight to the
  Next server on `127.0.0.1:3000`, so **nginx and the API may both be bypassed for
  the document itself**. HSTS was missing at this layer until 2026-07-27; the
  header table below describes the API/nginx layers, and the Next layer now sets
  HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and
  `Permissions-Policy` to match.

One honest exception: **CSP is not set at the Next.js layer.** Per-request nonces
were removed there because they blocked Next.js inline scripts, and a real Next CSP
needs middleware nonce plumbing. The CSP row below applies to the API/nginx layers.

All API responses include the following headers, enforced at both the application
layer (Helmet.js) and the reverse proxy layer (nginx):

| Header                    | Value                                    | Purpose                           |
|---------------------------|------------------------------------------|-----------------------------------|
| `Content-Security-Policy` | Per-request nonce for scripts; `'self'` base | XSS prevention                |
| `Strict-Transport-Security` | `max-age=31536000; includeSubDomains; preload` | Force HTTPS              |
| `X-Frame-Options`        | `SAMEORIGIN`                              | Clickjacking prevention           |
| `X-Content-Type-Options`  | `nosniff`                                | MIME-sniffing prevention          |
| `X-XSS-Protection`       | `1; mode=block`                           | Legacy XSS filter                 |
| `Referrer-Policy`        | `strict-origin-when-cross-origin`         | Referrer leakage prevention       |
| `Permissions-Policy`     | `camera=(), microphone=(), geolocation=()` | Feature restriction             |

### Content Security Policy Details

- **Script nonce**: A 16-byte random nonce is generated per request via
  `crypto.randomBytes(16)` and injected into the CSP `script-src` directive.
- **Production mode**: `unsafe-eval` is removed; only nonce-authenticated and
  `unsafe-inline` scripts are allowed.
- **Development mode**: `unsafe-eval` is permitted for hot-reload tooling.
- **Frame sources**: Blocked (`frame-src 'none'`).
- **Object sources**: Blocked (`object-src 'none'`).
- **Form actions**: Restricted to `'self'`.

### CORS

- In production, `ALLOWED_ORIGINS` must be explicitly set. Wildcard origins are
  not permitted.
- `credentials: true` is enabled for cookie-based authentication.
- The `connect-src` CSP directive is dynamically populated from `ALLOWED_ORIGINS`.

### CSRF Protection

State-changing requests (`POST`, `PUT`, `DELETE`, `PATCH`) require a valid CSRF token
using the double-submit cookie pattern:

```
Cookie:  _csrf=<token>
Header:  X-CSRF-Token: <token>
```

The server validates that the header value matches the cookie value. The frontend
API client handles this automatically.

### Body Size Limits

Per-endpoint body size limits prevent denial-of-service via oversized payloads:

| Endpoint Category | Maximum Body Size |
|-------------------|-------------------|
| Chat              | 256 KB            |
| Auth (register)   | 16 KB             |
| Auth (login)      | 4 KB              |
| Default           | 10 MB             |
| nginx upload      | 25 MB             |

### Additional Middleware

- **Request ID**: Every request receives a unique identifier for tracing.
- **Request timeout**: Configurable per-request timeout to prevent hung connections.
- **Compression**: gzip compression at the application and nginx layers.
- **Idempotency**: Write operations support idempotency keys to prevent duplicate effects.

---

## Input Sanitization

All user input is sanitized before processing. The sanitization middleware detects
and blocks the following attack vectors:

### XSS Prevention

```
Blocked patterns:
  <script>...</script>
  Event handlers: onclick=, onerror=, onload=
  Protocol handlers: javascript:
  Data URIs: data:*;base64
```

### SQL Injection Detection

```
Logged and monitored patterns:
  UNION SELECT, INSERT INTO, DROP TABLE
  DELETE FROM, UPDATE SET, EXECUTE
```

Note: Concord uses parameterized queries (prepared statements) via better-sqlite3
as the primary SQL injection defense. The sanitization layer provides
defense-in-depth logging and alerting.

### Prototype Pollution Prevention

```
Blocked keys in request bodies:
  __proto__, constructor, prototype
```

---

## Rate Limiting

Rate limiting is enforced at multiple layers:

### Application Layer

| Endpoint Type     | Limit       | Window   |
|-------------------|-------------|----------|
| Authentication    | 10 requests | 1 minute |
| API (general)     | 100 requests| 1 minute |
| Economy transfers | 30 transactions | 1 minute (per user) |

### nginx Layer

| Zone     | Rate    | Burst |
|----------|---------|-------|
| API      | 10 r/s  | 20    |
| General  | 30 r/s  | --    |

The nginx rate limiting operates independently of the application layer,
providing defense against attacks that bypass the application.

---

## Concord Shield -- Threat Detection

Concord Shield is a three-layer security architecture that orchestrates open-source
security tools and feeds all findings into the DTU lattice.

### Architecture: Scan, Analyze, Fortify

```
  Incoming Data
       |
       v
  [ SCAN ] -----> ClamAV (malware), YARA-X (patterns)
       |
       v
  [ ANALYZE ] --> Suricata (network IDS), Snort (IPS), Zeek (behavioral)
       |
       v
  [ FORTIFY ] --> OpenVAS (vulnerabilities), Wazuh (SIEM/host monitoring)
       |
       v
  Threat DTU --> Pain Memory (never pruned)
```

### Integrated Security Tools

| Tool       | Function                      | Integration Mode |
|------------|-------------------------------|------------------|
| ClamAV     | Malware scanning              | clamd daemon     |
| YARA-X     | Pattern matching/classification | Rule engine    |
| Suricata   | Network intrusion detection   | Real-time IDS    |
| Snort      | Intrusion prevention          | IPS mode         |
| OpenVAS    | Vulnerability scanning        | Scheduled scans  |
| Wazuh      | Host monitoring and SIEM      | Agent-based      |
| Zeek       | Behavioral network analysis   | Passive monitor  |

### Scan Modes

| Mode            | Trigger                  | Tools Engaged              |
|-----------------|--------------------------|----------------------------|
| Passive         | Always-on                | Suricata, Zeek             |
| Active          | File ingestion           | ClamAV scans all files     |
| Scheduled       | Periodic timer           | OpenVAS vulnerability scan |
| On-demand       | User request via chat    | Full tool sweep            |
| User-initiated  | File/URL/hash submission | Targeted analysis          |

### Threat Memory and Collective Immunity

- Every detection is stored as a **threat DTU** tagged with `pain_memory`.
- Pain memory DTUs are **never pruned** by the forgetting engine.
- Threat signatures propagate to all users in one heartbeat tick, providing
  **collective immunity**: a threat detected for one user instantly protects all users.
- Meta-derivation runs cross-threat pattern discovery across all threat DTUs.

### Shield Design Rules

1. **Additive only** -- Shield never modifies existing systems.
2. **Silent failure** -- Shield itself never crashes the platform.
3. **Every detection is a DTU** -- full audit trail.
4. **Pain integration** -- every threat becomes pain memory, never pruned.
5. **Collective immunity** -- one detection protects all users.
6. **All through chat** -- no separate security UI.

---

## Concord Mesh -- Transport Security

Concord Mesh provides infrastructure-independent DTU transmission across seven
transport layers, each with distinct security characteristics.

### Transport Layers

| Layer          | Protocol          | Range       | Bandwidth | Requires Infrastructure |
|----------------|-------------------|-------------|-----------|------------------------|
| Internet       | HTTPS/WSS over TCP| Global      | High      | Yes                    |
| WiFi Direct    | mDNS + direct TCP | ~100m       | High      | No                     |
| Bluetooth/BLE  | RFCOMM/GATT       | ~10-30m     | Medium    | No                     |
| LoRa           | LoRa modulation   | 2-15km/hop  | Very Low  | No                     |
| RF/Ham Packet  | AX.25/JS8Call     | Regional    | Very Low  | No                     |
| Telephone      | V.92 modem        | Global      | Low       | Yes                    |
| NFC            | NDEF              | ~4cm        | Tap       | No                     |

### DTU Transport Security Properties

- **Self-verifying**: Every DTU carries a SHA-256 content hash in its 48-byte header.
  Recipients verify integrity without relying on TLS or channel security.
- **Self-contained**: DTUs require no server lookup, no session state, and arrive
  complete. No man-in-the-middle can inject partial state.
- **Store-and-forward**: DTUs survive disconnected operation. No persistent connection
  is required. The DTU waits for the next available channel.
- **Automatic routing**: The mesh selects the optimal transport path. Users never
  manually pick channels, reducing misconfiguration risk.
- **Adaptive failover**: If a channel drops, the next available channel picks up
  instantly with no data loss.

---

## Content Moderation

### Report Categories

The moderation system supports ten report categories:

| Category        | Description                              |
|-----------------|------------------------------------------|
| `spam`          | Unsolicited or repetitive content        |
| `harassment`    | Targeted abuse or bullying               |
| `hate_speech`   | Content promoting hatred of groups       |
| `violence`      | Graphic violence or threats              |
| `sexual_content`| Explicit sexual material                 |
| `misinformation`| Verifiably false claims                  |
| `copyright`     | Intellectual property infringement       |
| `impersonation` | Pretending to be another person/entity   |
| `self_harm`     | Content promoting self-harm or suicide   |
| `other`         | Reports not fitting other categories     |

### Moderation Workflow

```
  User Report / Auto-Flag
         |
         v
  [ Pending ] --> [ Reviewing ] --> [ Resolved ]
                       |                  |
                       v                  v
                 [ Escalated ]     [ Dismissed ]
```

### Enforcement Actions

1. **Flag** -- mark content for review
2. **Warn** -- issue a warning to the user
3. **Restrict** -- limit content visibility
4. **Remove** -- remove content (preserving original for restoration)
5. **Suspend** -- suspend user account
6. **Restore** -- restore previously removed content

### Strike System

Repeated violations escalate through a strike system: warnings progress to
temporary suspensions and, for persistent violations, permanent action.

### Auto-Flagging

Content is automatically flagged via keyword pattern matching and pattern detection.
Auto-flagged content enters the moderation queue with the source recorded as
`auto_keyword` or `auto_pattern`.

### Audit Trail

Every moderation action produces an audit log entry. Content is never silently
removed. Every action has a paper trail, and removed content can be restored.

---

## Economy Security

The Concord economy handles token transfers, purchases, and marketplace transactions
with financial-grade safety guarantees.

### Atomic Transfers

All transfers execute inside a single SQLite transaction. If any step fails,
nothing commits. There is no partial state:

```
BEGIN TRANSACTION
  1. Validate sender balance (inside transaction to prevent race conditions)
  2. Compute fee
  3. Create debit record (sender)
  4. Create credit record (recipient)
  5. Create fee record (platform)
COMMIT   (all-or-nothing)
```

### Race Condition Prevention

Balance validation occurs **inside** the SQLite transaction, not before it. This
prevents time-of-check-to-time-of-use (TOCTOU) race conditions where concurrent
requests could overdraft an account.

### Transfer Guards

| Guard                 | Description                                          |
|-----------------------|------------------------------------------------------|
| Amount validation     | Positive numbers only, checked before transaction    |
| Balance validation    | Verified inside transaction (prevents races)         |
| Self-transfer block   | Users cannot transfer to themselves                  |
| Rate limiting         | 30 transactions per user per minute                  |
| Idempotency           | Duplicate `refId` returns the original result        |
| Founder secret        | Timing-safe comparison via `crypto.timingSafeEqual`  |

### Audit Trail

Every economy action is logged to the `audit_log` table with the following fields:

| Field         | Description                          |
|---------------|--------------------------------------|
| `action`      | Operation type (e.g., `transfer`, `token_purchase`) |
| `userId`      | Acting user ID                       |
| `amount`      | Transaction amount                   |
| `txId`        | Ledger transaction or batch ID       |
| `ip`          | Client IP address                    |
| `userAgent`   | Client user-agent string             |
| `requestId`   | X-Request-ID header for tracing      |
| `timestamp`   | ISO 8601 timestamp                   |

Audit entries are written to both the SQLite database (persistent) and console
(real-time monitoring).

---

## GRC Invariants -- Output Safety

The Governance, Risk, and Compliance (GRC) module enforces seven core invariants
on all system outputs before they reach users.

### Core Invariants

| Invariant                  | Purpose                                                |
|----------------------------|--------------------------------------------------------|
| `NoNegativeValence`        | Prevents outputs with negative emotional charge        |
| `RealityGateBeforeEffects` | Verifies payload stays inside the lattice reality      |
| `NoUnlabeledAssumptions`   | Ensures all assumptions are explicitly labeled         |
| `NoSaaSMinimizeRegression` | Prevents minimizing or SaaS-ifying user intent         |
| `FounderOverrideAllowed`   | Preserves founder override capability                  |
| `NoSystemJargon`           | Removes internal terminology from user-facing output   |
| `GroundingCheck`           | Validates outputs are grounded in source material      |

### Auto-Repair Pipeline

When an invariant check fails, the GRC module attempts automatic repair:

1. The payload is analyzed to identify the violation.
2. A repair is attempted that preserves the semantic intent.
3. If repair succeeds, the output continues with a repair annotation.
4. If repair fails, the output is blocked and the failure is logged.

Repairs follow strict rules: no new claims are introduced, semantic intent is
preserved, and content is never sanitized to the point of uselessness.

### Forbidden Pattern Removal

System jargon patterns (e.g., references to DTUs, substrates, lattices, macros,
Ollama, brain cortex) are automatically removed from user-facing output to prevent
information leakage about internal architecture.

---

## Privacy Zones

The Atlas Signal Cortex implements a four-tier privacy architecture with
absolute guarantees at the highest level.

### Privacy Tiers

| Tier          | Zone Types                         | Interior Data | Override Possible |
|---------------|------------------------------------|---------------|-------------------|
| `ABSOLUTE`    | Residential, medical, religious    | Never created | No                |
| `RESTRICTED`  | Government, military               | Exterior only | No (sovereign limited) |
| `CONTROLLED`  | Commercial, industrial             | Limited access | Research tier only |
| `OPEN`        | Undeveloped, geology, water, public| Full access   | N/A               |

### Absolute Zone Guarantee

Interior data for `ABSOLUTE` zones is **never generated**. The reconstruction
algorithm skips the interior volume entirely. There is nothing to reveal, filter,
or hide -- the data does not exist.

### Universal Tracking Suppression

The following are suppressed at **every** privacy tier, including sovereign:

- **Personal presence detection** -- no person-tracking at any level.
- **Vehicle tracking** -- no vehicle identification or tracking at any level.

These suppressions cannot be overridden by any role, configuration, or API call.

---

## LLM Security Considerations

### Prompt Injection

When using LLM features (chat, forge, dream), the following mitigations are in place:

| Risk                  | Mitigation                                              |
|-----------------------|---------------------------------------------------------|
| Direct injection      | Input sanitization before LLM processing                |
| Indirect injection    | Output validation before storage                        |
| Data exfiltration     | Sandboxed execution; LLM-generated code never runs directly |
| Abuse via volume      | Rate limiting on all LLM endpoints                      |
| Audit gap             | All LLM interactions are logged                         |

### Cloud LLM Opt-In (Two-Level Consent)

Cloud LLM features require explicit opt-in at two independent levels:

1. **Environment level**: `CLOUD_LLM_ENABLED=true` must be set.
2. **Session level**: The user must explicitly enable cloud LLM per session.

No data is sent to external LLM APIs without both levels of consent.

### Local LLM Alternative

For maximum data sovereignty, Concord supports local LLM via Ollama:

```bash
OLLAMA_HOST=http://localhost:11434
OLLAMA_MODEL=llama3.2
LLM_ENABLED=true
CLOUD_LLM_ENABLED=false
```

In this configuration, no data leaves the host machine.

---

## Infrastructure and Container Hardening

### Docker Security

| Measure                  | Implementation                                    |
|--------------------------|---------------------------------------------------|
| Non-root execution       | Containers run as UID 1001 (`concord` user)       |
| No privilege escalation  | `security_opt: no-new-privileges:true` on **all 16** compose services (was 3 of 16 before 2026-07-27) |
| Capability drop          | `cap_drop: [ALL]` on 14 services. **nginx and certbot are excluded on purpose** -- nginx binds :80/:443 and certbot rewrites cert ownership; both need a tested `cap_add` set. The exclusion and its reason are recorded inline in `docker-compose.yml`. |
| Base-image pinning       | Both Dockerfiles pin `node:20-bookworm-slim` by SHA256 digest; compose services pin concrete versions (no `:latest`, no untagged). Kept current by the `docker` Dependabot ecosystem -- pinning without that would trade drift for silent staleness. |
| Read-only root FS        | **Not applied.** Every remaining service writes somewhere (model blobs, TSDB, dashboards, RDB snapshots, collections); it needs a per-service tmpfs audit. Stated rather than implied. |
| tmpfs with restrictions  | `/tmp` mounted as `tmpfs` with `noexec,nosuid`    |
| Production-only deps     | `npm ci --omit=dev` excludes dev dependencies     |
| Build-time tests         | Docker build fails if any test fails              |
| Log rotation             | JSON file driver, max 50MB per file, 3 files max  |

### TLS Configuration (nginx)

| Setting               | Value                                                      |
|-----------------------|------------------------------------------------------------|
| Protocols             | TLSv1.2, TLSv1.3                                          |
| Cipher suites         | ECDHE-ECDSA-AES128-GCM-SHA256, ECDHE-RSA-AES128-GCM-SHA256, ECDHE-ECDSA-AES256-GCM-SHA384, ECDHE-RSA-AES256-GCM-SHA384 |
| HSTS                  | `max-age=31536000; includeSubDomains; preload`             |
| Session tickets       | Disabled (`ssl_session_tickets off`)                       |
| HTTP redirect         | All HTTP (port 80) traffic 301-redirected to HTTPS         |
| Server preference     | `ssl_prefer_server_ciphers off` (client selects best mutual cipher) |

### nginx Security

- Rate limiting at the reverse proxy layer (independent of application).
- Security headers applied at the nginx level as well as the application level.
- Let's Encrypt ACME challenge path exposed for automated certificate renewal.
- `client_max_body_size` aligned with backend limits.

---

## Data Security and Encryption

### Encryption

| Layer         | Method                                             |
|---------------|----------------------------------------------------|
| In transit    | TLS 1.2+ enforced via nginx                        |
| At rest       | Recommended: encrypted filesystem for `DATA_DIR`   |
| Passwords     | bcrypt with 12 rounds (configurable)               |
| JWT signing   | HS256 with minimum 32-character secret             |

### Data Isolation

- Each user's DTUs are isolated by `ownerId`.
- Permission system controls read, write, and delete access.
- Global DTUs require council approval.

### Backup Security

```bash
# Backups stored in DATA_DIR/backups
# Restrict permissions to the owning process user only
chmod 700 /data/backups
```

---

## Unsafe Surfaces Registry

The following capabilities expose attack surface beyond standard CRUD operations.
Each is **disabled by default** in production unless explicitly enabled.

| Surface            | Environment Gate         | Default   | Risk         | Notes                                                  |
|--------------------|--------------------------|-----------|--------------|--------------------------------------------------------|
| Terminal/sandbox   | `ENABLE_TERMINAL_EXEC`   | `false`   | **Critical** | Spawns `bash -c <cmd>` in entity workspace. Council-gated for medium+ risk. Only enable on air-gapped instances. |
| Federation         | `FEDERATION_ENABLED`     | `false`   | Medium       | Redis pub/sub between instances. Opens cross-instance DTU sync.     |
| Whisper STT        | `WHISPER_CPP_BIN`        | Empty     | Low          | Spawns whisper binary on audio files. Path must be pre-configured.  |
| Piper TTS          | `PIPER_BIN`              | Empty     | Low          | Spawns piper binary for speech synthesis. Path must be pre-configured. |
| Image generation   | `SD_URL` / `COMFYUI_URL` | Empty     | Low          | HTTP calls to local Stable Diffusion.                               |

### Verifying Capabilities at Runtime

```bash
curl -s http://localhost:5050/api/status | jq '.infrastructure.capabilities'
```

Returns:

```json
{
  "sqlite": true,
  "jwt": true,
  "bcrypt": true,
  "ollama": true,
  "exec": false,
  "federation": false,
  "whisper": false,
  "piper": false,
  "imagegen": false
}
```

---

## Environment Security

### Required Production Settings

The following must be set before deploying to production:

```bash
JWT_SECRET=<minimum 32 characters, 64+ recommended>
ADMIN_PASSWORD=<minimum 12 characters>
NODE_ENV=production
ALLOWED_ORIGINS=https://your-domain.com
```

### Secrets Management

**Never commit secrets to version control.**

| Approach                    | Suitability              |
|-----------------------------|--------------------------|
| Kubernetes Secrets / AWS SSM | Production orchestration |
| `.env` file with `chmod 600` | Single-server deployment |
| HashiCorp Vault / AWS Secrets Manager | Enterprise environments |

### Audit Logging

Security-relevant events are logged to the `audit_log` table:

- Authentication attempts (success and failure)
- Authorization failures
- Rate limit triggers
- Input sanitization triggers (potential attack attempts)
- Admin actions
- Economy transactions

Access audit logs via `/api/auth/audit-log` (admin-only endpoint).

---

## Dependency Security

### Audit Schedule

| Frequency   | Action                                          |
|-------------|-------------------------------------------------|
| Every PR    | `npm audit` runs in CI                          |
| Weekly      | Manual review of high and critical vulnerabilities |
| Within 48h  | Security patches applied for critical CVEs      |

### Optional Native Dependencies

Optional dependencies with native code (`better-sqlite3`, `@xenova/transformers`) are:

- Only installed when explicitly needed.
- Compiled in isolated Docker build stages.
- Not required for core functionality (the system falls back gracefully).

---

## Ethos Invariants

These security-relevant principles are **immutable** and enforced at runtime.
They cannot be changed by configuration, environment variables, or API calls:

```
NO_TELEMETRY           The system never phones home.
NO_SECRET_MONITORING   No hidden tracking or monitoring.
NO_USER_PROFILING      No behavioral analysis or profiling.
CLOUD_LLM_OPT_IN_ONLY Explicit two-level consent required for cloud LLM.
```

---

## Compliance Considerations

Concord's architecture supports compliance with common regulatory frameworks:

| Framework | Supported Features                                              |
|-----------|-----------------------------------------------------------------|
| GDPR      | Data isolation by user, export capability, deletion support, no profiling |
| SOC 2     | Audit logging, access controls, encryption, incident response   |
| HIPAA     | Configurable for healthcare use (consult your compliance team)  |

---

## Incident Response

### If You Suspect a Breach

1. **Isolate** -- Disconnect affected systems from the network immediately.
2. **Preserve** -- Capture logs, database snapshots, and system state before any changes.
3. **Rotate** -- Change all secrets: `JWT_SECRET`, `FOUNDER_SECRET`, `SESSION_SECRET`, API keys, and database credentials.
4. **Notify** -- Report to the security team at [security@concord-os.org](mailto:security@concord-os.org).
5. **Analyze** -- Review audit logs (`/api/auth/audit-log`), economy audit entries, and nginx access logs to determine scope.
6. **Remediate** -- Apply patches, update dependencies, and harden configurations based on findings.
7. **Communicate** -- Notify affected users per your disclosure obligations.

### Production Hardening Checklist

Before deploying to production, verify the following:

- [ ] `ENABLE_TERMINAL_EXEC` is absent or set to `false`
- [ ] `JWT_SECRET` is at least 32 characters (64+ recommended)
- [ ] `ADMIN_PASSWORD` is at least 12 characters
- [ ] `ALLOWED_ORIGINS` is explicitly set (no wildcards)
- [ ] `NODE_ENV` is set to `production`
- [ ] `GRAFANA_USER` and `GRAFANA_PASSWORD` are explicitly set (no defaults)
- [ ] nginx security headers verified via `curl -I https://your-domain.com`
- [ ] `/api/status` confirms `"exec": false`
- [ ] `npm audit` shows no high or critical findings
- [ ] Grafana bound to localhost or behind VPN
- [ ] TLS certificate is valid and HSTS is active
- [ ] Backup directory permissions set to `700`
- [ ] Log rotation is configured

---

*This document is maintained alongside the codebase. If you identify inaccuracies
or have suggestions for improvement, please submit a pull request or contact
[security@concord-os.org](mailto:security@concord-os.org).*
