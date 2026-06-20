# ADR 008: Transactional email via nodemailer

| Field      | Value                                                  |
|------------|--------------------------------------------------------|
| Status     | Accepted                                               |
| Date       | 2026-06-20                                             |
| Authors    | Production deploy-readiness pass                        |
| Supersedes | N/A                                                    |
| Scope      | server runtime dependency                               |

## Context

`server/lib/email-service.js` already implements the full transactional-email
surface (password reset, email verification, purchase/commission notifications)
behind a provider-agnostic SMTP transport. It was written to lazy-import
`nodemailer`, but **`nodemailer` was never declared as a dependency** — so the
dynamic `import("nodemailer")` always threw, every send fell through to the
console-log fallback, and **no email ever left the server**. The practical
effect: a user who forgot their password received no reset link and was locked
out permanently; email verification and the seller-eligibility gate were also
dead.

This was a launch blocker (account recovery is non-optional for a real product),
surfaced during the production deploy-readiness audit.

## Decision

Add `nodemailer` (`^6.10.1`) as a **server runtime dependency** and rely on the
existing `email-service.js` wiring (no code rewrite — the dynamic import simply
now resolves). The operator points it at any SMTP relay via the documented
`SMTP_HOST`/`SMTP_PORT`/`SMTP_USER`/`SMTP_PASS`/`SMTP_FROM` env vars
(SendGrid / AWS SES / Postmark / Mailgun all work); `preflight-production.sh`
warns when SMTP is unconfigured.

## Why not a smaller solution

- **Hand-rolled SMTP over a raw socket**: SMTP + STARTTLS/TLS, auth (LOGIN/PLAIN/
  XOAUTH2), MIME multipart, and connection pooling are exactly the error-prone
  surface a battle-tested library exists to cover. Re-implementing it would be
  more code and more risk for zero benefit.
- **A hosted-API SDK (SendGrid/Postmark/Resend)**: would lock the platform to one
  vendor and add a heavier dependency. `nodemailer` keeps the transport
  provider-agnostic (any SMTP relay), consistent with the local-first /
  sovereign-by-design posture (ADR 003) — the operator chooses the relay.
- **`node:` builtins**: there is no first-party SMTP client in Node core.

## Consequences

- One well-maintained, widely-audited runtime dependency is added to the server.
- Email stays dormant + zero-cost until `SMTP_HOST` is set; the build is
  byte-identical when unset, so dev/test/offline runs are unaffected.
- `email-service.js` keeps its console-log fallback, so a missing/broken SMTP
  config degrades gracefully instead of crashing a send path.
