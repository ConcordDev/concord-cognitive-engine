# Connectors — Go-Live Checklist (Track C)

This is the operator runbook for taking the external connectors (Google
Calendar / Gmail, Slack) from "built + unit-tested" to "actually calling the
provider on a user's behalf." The code is complete; what remains is secrets,
a redirect-URI registration, and (for a public launch) Google verification.

## What's already built (code, not aspiration)

- **Token store / refresh / egress** — `server/lib/connector-tokens.js`
  (AES-256-GCM at rest, refresh rotation, honest reason codes),
  `server/lib/connector-client.js` (SSRF-guarded `connectorFetch`,
  `writeGoogleCalendarEvent`, `writeGmailMessage`), migration
  `331_connector_oauth_tokens`.
- **Authorize + callback** — `server/routes/connector-oauth.js`
  (`GET /api/oauth/:provider/authorize` + `.../authorize/callback`), mounted in
  `server.js`. Uses the authorization-code flow with `access_type=offline` +
  `prompt=consent` (guarantees a refresh token), a CSRF `state`, least-privilege
  scopes, and incremental authorization.
- **Entry points** — `calendar.accounts-connect-google` and `gmail.connect`
  macros return the authorize URL the frontend redirects to; ingest connectors
  (Sheets/Gmail/Slack/GitHub) advertise their own authorize URL.

## Steps to go live

1. **Create the OAuth client** in the
   [Google Cloud console](https://console.cloud.google.com/apis/credentials)
   (or reuse the sign-in client). Enable the **Google Calendar API** and **Gmail
   API**.
2. **Register the redirect URI** under "Authorized redirect URIs":
   `https://YOUR_DOMAIN/api/oauth/google/authorize/callback`
   (and `.../api/oauth/slack/authorize/callback` for Slack).
3. **Set secrets** (see `.env.example`):
   - `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`
   - `CONCORD_CONNECTOR_TOKEN_KEY` (32+ bytes — encrypts tokens at rest)
   - `CONNECTOR_OAUTH_REDIRECT_BASE` (when behind a proxy; else derived from the
     request host) and `FRONTEND_URL`
   - `SLACK_CLIENT_ID` / `SLACK_CLIENT_SECRET` (for Slack)
4. **Scopes** (least-privilege, already wired): Calendar →
   `calendar.events`; Gmail → `gmail.send`; Sheets → `spreadsheets.readonly`;
   Slack → `chat:write,channels:read`.
5. **Test it** — sign in as a real user, run `calendar.accounts-connect-google`
   (or click connect in the ingest lens), complete consent, then run
   `calendar.accounts-push-event` and confirm an event lands on the test
   calendar. A row should appear in `connector_oauth_tokens`.

## The verification gate (public launch only)

Google classifies Calendar and Gmail scopes as **sensitive / restricted**:

- **Testing mode** works immediately for up to **100 test users** added to the
  OAuth consent screen — no verification needed. Use this to dogfood.
- A **public** launch requires:
  - OAuth **consent-screen verification** (Google reviews the app + scope
    justifications), and
  - for Gmail's restricted scope, an annual **CASA** (Cloud Application Security
    Assessment, OWASP ASVS-based) — typically a few hundred to a few thousand
    USD/year depending on tier.

Until verification, keep connectors behind the test-user allowlist. The code
path is identical for test and verified users — only the consent screen's reach
changes.

## Fan-out

Adding a new Google data connector is small: a least-privilege scope, a
`connector_id` token key in `CONNECTOR_TOKEN_KEY`
(`routes/connector-oauth.js`), an egress helper in `connector-client.js`, and a
thin push macro. Non-Google providers add a `PROVIDERS` adapter entry
(`authUrl` / `tokenUrl` / `parseToken`) — Slack is the reference.
