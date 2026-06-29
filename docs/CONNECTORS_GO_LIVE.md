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
   - `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (for GitHub)
   - `NOTION_CLIENT_ID` / `NOTION_CLIENT_SECRET` (for Notion)
4. **Scopes** (least-privilege, already wired): Calendar →
   `calendar.events`; Gmail → `gmail.send`; Sheets → `spreadsheets`;
   Slack → `channels:read,channels:history,chat:write`; GitHub → `repo`;
   Notion → capabilities (read/update/insert content) are configured **on the
   integration** in Notion's console, not requested per-call.

### The four marquee connectors (Slack / Sheets / GitHub / Notion)

All four are built on the same `connectorFetch` chokepoint and unit-tested with
an injected fetch (`server/tests/connector-extra-paths.test.js`). Each exposes
`<domain>.connect` returning the real authorize URL; macros fail honestly with
`no_token` until an operator completes the steps below. Domains/macros:

- **Slack** (`domains/slack.js`): `channels` / `history` / `post` / `connect`.
  OAuth app at <https://api.slack.com/apps>; redirect
  `.../api/oauth/slack/authorize/callback`. User-token scopes above.
- **Sheets** (`domains/sheets.js`): `read` / `append` / `connect`. Reuses the
  Google client; enable the **Google Sheets API**. `spreadsheets` scope is
  needed for the two-way `append`.
- **GitHub** (`domains/github.js`): `repos` / `issues` / `issue-create` /
  `connect`. OAuth app at <https://github.com/settings/developers>; redirect
  `.../api/oauth/github/authorize/callback`. Tokens don't expire (no refresh).
- **Notion** (`domains/notion.js`): `search` / `get` / `append` / `connect`.
  Public integration at <https://www.notion.so/my-integrations>; redirect
  `.../api/oauth/notion/authorize/callback`. Notion's token exchange is
  non-standard (HTTP Basic auth + JSON body) — handled by the provider's
  `buildTokenRequest` in `routes/connector-oauth.js`.
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
