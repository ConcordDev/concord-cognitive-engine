# Security scan triage — 2026-07-27

An external scan (Aikido) produced ~40 findings. This file records the
**determinations**, so the same noise isn't re-triaged from scratch next
quarter, and so the fixes have a written rationale.

Two rules governed the pass:

1. **Verify before fixing.** Several findings were wrong in one direction or
   the other, and two of the most serious problems were *not* in the report at
   all — they were found by opening the code a flagged item pointed at.
2. **Never fix by weakening a checker.** `scripts/autoloop/guard.mjs` protects
   the graders and detector baselines. Nothing here was resolved by
   re-baselining or loosening a rule.

---

## Real, fixed

| ID | Finding | Severity as found | Commit |
|----|---------|-------------------|--------|
| SEC-1 | **Authenticated RCE** in `domains/invariant.js` | Critical | `d54fd030` |
| SEC-2 | SSRF in `cooking.import-from-url` + `productivity.calendar-import-ics` | High | `296609be` |
| SEC-3 | Unguarded RBAC mutations | *Latent* (see below) | `be3b8033` |
| SEC-4 | Open redirect in the connector OAuth callback | High | `a58c22ac` |
| — | **Systemic SSRF**: `lib/external-fetch.js` (38 importers) | High | `48108fe1` |
| — | **SSRF** in `emergent/ingest-engine.js`, bypassable at any tier | High | `97fdc3d3` |
| — | Timing-unsafe secret comparison + `timingSafeEqual` throw-on-length | Medium | `2d11a73a` |
| — | Frontend document served without HSTS | Medium | `63fdf7d4` |

### SEC-1 was not in the report as an RCE

The scanner flagged `new Function` generically. Opening it showed
`validateExpressionAST` (an acorn allowlist) validated the *original*
expression while `new Function` compiled a **different** string — the output of
a regex pass that spliced resolved state values into the expression text via
`JSON.stringify`, which emits its own quotes. A value landing inside a string
literal broke out of it and became code.

Worth recording how it was confirmed: the first proof-of-concept asserted on
the expression's *return value* and read as "no bypass". The return value was
irrelevant — the payload had already executed. Only a **side-effect canary**
proved it. When testing for code execution, assert on the side effect.

### SEC-3 was over-stated in the report

Graded as live privilege escalation; it is not. `globalThis._assignRole` /
`_revokeRole` / `_getUserRole` / `_checkPermission` **do not exist anywhere in
the tree**, so those handlers optional-chain into no-ops, and
`STATE.rbacCustomRoles` is write-only — no authorization path reads it. A
self-authored `permissions: ["*"]` role granted nothing. Fixed anyway, because
wiring either helper later turns it into real privesc with no other change.

### SEC-4's "tokenKey leak" is not a leak

`resolveTokenKey` returns a *storage key name* (`"gmail"`, `"google"`, a
connector id), never a credential. The open redirect is the real issue.

### The two findings the scan missed entirely

- **`lib/external-fetch.js`** — imported by 38 files, documented as being for
  "free public APIs", used a bare `fetch()`. Two callers were live and
  **reflected** (response body returned to the caller):
  `import.fetchFromConnector` (`cfg.url` is `params.url` straight off the macro
  input) and `custom.bindingTest`. Fixed at the shared helper so all 38
  importers are covered.
- **`emergent/ingest-engine.js`** — guarded only by a *name* check, whose
  blocklist contains two `example.com` placeholders, and whose tier gate reads
  `req.body?.tier`. A caller could declare itself `sovereign` and skip every
  check. Fixed at the transport, so it holds for a spoofed tier.

---

## The most important CI finding — also not in the report

**The Trivy container CVE gate had never scanned anything.**
`.github/workflows/platinum-security.yml` gated every step on
`if [ -f Dockerfile ]` at the repo root. No root `Dockerfile` has ever existed
(the real ones are `server/` and `concord-frontend/`), so the job emitted
`::notice::No Dockerfile at repo root` and passed green on every run — while
its own comment described that step as "the actual CVE gate".

A gate whose skip path is indistinguishable from a pass is worse than no gate,
because it is counted as coverage. Fixed in `1a326dc6`. **Expect its first real
run to be red**; that is the gate working, not a regression.

The same class was found twice more: `constant-time` was tagged into no
blocking consumer, and `secret-leak` ran only under `code-quality`. See
`9f5fd71d`.

---

## False positives — do NOT "fix" these

Each was checked against the code, not assumed.

| Finding | Determination |
|---------|---------------|
| GitHub Actions **script injection** | All 50 `${{ }}` expressions across 24 workflows enumerated; **none** reference `event.*.title/body`, `comment.body`, `review.body`, or `head_ref`. Likely trigger was `deploy.yml` `username: ${{ github.actor }}` — a registry username field, not a `run:` body. |
| **`immer`** prototype pollution (CVE-2021-23436) | Advisory targets `<9.0.6`. Every copy here is `10.2.0` / `11.1.4`. |
| **`@ungap/structured-clone`** deserialize RCE | Advisory targets `<1.0.1`; installed is `1.3.0`. |
| **GitHub org IP allowlist** not enabled | `ConcordDev` is a **User** account, not an Organization. IP allow lists are an Org/Enterprise feature — not applicable. |
| **Secrets in `k8s/secrets.yaml`** | One commit in the file's entire history. All credential values are `CHANGE_ME…` placeholders or empty strings. The scanner matched a tracked `kind: Secret` manifest with base64-looking values without decoding them. |
| **Secret in `SensorDashboard.tsx`** | The flagged fingerprint appears only in an untracked, gitignored `concord.db` and in audit-snapshot commits (detector `sha256(...)` fingerprints). The historical value was a mock display-only key — nothing to rotate. |
| **HSTS missing** | *Partially* false: the API (Helmet) and nginx both set it correctly. Real only for the Next.js document layer, now fixed. |
| **Godot binary fetch unverified** | Already exemplary — `godot-client.yml` asserts the pin exists *before* fetching, then SHA-512 verifies. This is the model the k6 fix copied. |
| **Rust `Command::arg` injection** | Only spawn site is `process_supervisor.rs`; all inputs come from operator env vars with hardcoded defaults, selected via a fixed `match`. No shell interpolation, no `sh -c`. |
| **k8s images on `:latest`** | Moot: `deploy.yml` follows every `kubectl apply` with `kubectl set image ...:${IMAGE_TAG}` using the commit short-SHA. Pinning the manifests would be cosmetic and could break a pull. |

**On the repo being public:** `ConcordDev/concord-cognitive-engine` is public
and has two third-party forks (`netzkontrast`, `5mhyjt8mk8-cyber`). History
rewriting therefore cannot un-expose anything. If a real secret is ever
committed, **rotation is the only remedy** — which is why `secret-leak` was
promoted into the blocking gate.

---

## Known-open, deliberately not closed here

- **The security detector gate is RED** on one pre-existing `authz-coverage`
  high: `/api/welding/portal/` in `WRITE_AUTH_PUBLIC_PATHS`. It is a reviewed,
  intentional, end-to-end-tested bypass that was never baselined. It predates
  this branch (present on `origin/main`). Clearing it requires a deliberate
  BASELINE refresh, which is human-authorized by design — not something to do
  as a side effect of a triage pass.
- **`req.body?.tier`** in `routes/operations.js` — reading a privilege level
  off the request body is wrong on its own terms. Guarding the transport
  removed its security impact on the ingest path, but tier should come from the
  user record.
- **CSP at the Next.js layer** — nonces were removed because they broke inline
  scripts; a real Next CSP needs middleware nonce plumbing.
- **Dependency work** — `next` 15→16 and `uuid` 9→14 are majors needing
  individual verification; `@xenova/transformers` pins `onnxruntime-web` to
  exactly `1.14.0` and needs an `overrides` entry.
