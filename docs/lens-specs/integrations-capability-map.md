# Integrations — capability map (Wave 3, Frontend Rebuild Program)

Audited + rebuilt 2026-07-10.

**Reference app (category leader): Zapier** — specifically its *My Apps /
Connected Accounts* page (connector catalog + OAuth-linked accounts) and its
*Zap editor + Task History* (multi-step trigger → action workflows with filters,
paths, formatters, code steps, and per-run replay). The integration-analysis
tools (API health, data-flow mapping, semver compatibility) have no single
category leader; they read as a lightweight Postman/DataDog-style diagnostics
bench bolted onto the automation hub.

## Backend surface

**Domain file: `server/domains/integrations.js` — 27 macros, all real, no
shadowing** (`grep -c 'registerLensAction("integrations"' server/domains/integrations.js`
→ 27; `grep -n 'register("integrations"\|registerLensAction("integrations"' server/server.js`
→ **no inline/shadowing registration in server.js**, so the domain file is the
sole registrant).

State lives per-user under `globalThis._concordSTATE.integrationsLens`
(`zaps` / `connections` / `runs` / `webhookMeta` Maps). Handlers never throw —
every path returns `{ ok, result?/error? }`.

Grouped:
- **Analytical, stateless (3):** `apiHealthCheck` (latency percentiles p50–p99,
  error-rate, availability, throughput, health score), `dataFlowMapping` (flow
  graph, in/out-degree, bottleneck ratio, BFS throughput paths, protocol
  summary), `compatibilityCheck` (semver parse/compare, breaking-change
  detection, migration-effort scoring + estimated hours). These read
  `artifact.data.{endpoints|flows|apis}` — reachable via
  `lensRun('integrations', <macro>, { endpoints|flows|apis })` since
  `/api/lens/run` makes the virtual artifact's `.data` the input body directly.
- **Connector catalog + connections (4):** `connectorCatalog` (9 SaaS apps —
  slack/gmail/github/notion/google_sheets/stripe/airtable/discord/concord_dtu,
  each with pre-built triggers + actions + scopes), `connectApp`,
  `connectionList`, `disconnectApp`.
- **Zap workflow builder (4):** `zapSave`, `zapList`, `zapDelete`, `zapToggle`.
- **Step primitives (5):** `evalCondition` (safe no-eval clause grammar),
  `previewFieldMap` (`$.path`/literal projection), `runFormatter` (14 ops),
  `formatterOps` (op catalog), `runCodeStep` (concat/sum/len/upper/lower over
  the data bag).
- **Run engine (3):** `zapRun` (executes the step graph, records a trace),
  `runHistory`, `retryRun` (replay).
- **Scheduling (3):** `scheduleSet` (interval/daily/weekly/poll), `scheduleClear`,
  `dueSchedules`.
- **Webhooks (5):** `webhookTest` (records a signed test-fire; returns
  `ok:false` when no URL — honest), `webhookActivate`, `webhookDeliveries`,
  `webhookRetry` (exponential backoff), `verifyWebhookSignature`.

**Honesty note (this is a connector lens — the tempting place to fake
"Connected"):** `connectApp` is honest by construction. It does **not** mint a
credential-looking token. `credentialStored` is derived from the
`connector_oauth_tokens` store (migration 331), populated only by a real,
completed OAuth flow; `needsOauth` is `true` for any oauth2 connector without a
stored token. The real egress chokepoint (`server/lib/connector-client.js`,
SSRF-guarded `connectorFetch`) refuses when no credential exists. Per
`CLAUDE.md` / `docs/CONNECTORS_GO_LIVE.md`, only **Gmail + Google Calendar** are
real two-way today (and only once a Google OAuth client is configured); the rest
of the catalog is a selectable connector list awaiting its OAuth wiring.

Verification: `node --test server/tests/depth/integrations-behavior.test.js
server/tests/integrations-domain-parity.test.js server/tests/connector-oauth.test.js
server/tests/connector-read-paths.test.js` → **49/49 pass, 0 fail** (this pass).

## Defects found & fixed (this rebuild)

1. **Fabricated `automations` tab (DEFECT c — parallel generic-CRUD).**
   `useLensData('integrations', 'automation', { noSeed:true })` drove a whole
   second automation builder (`AutomationBuilderPanel`) + list + "Run" button
   against a generic artifact "type" with **no backing macro**. It duplicated
   the real Zap/Workflows substrate (`zapSave`/`zapList`/`zapRun`/scheduling),
   and its "Run" called `apiHelpers.lens.run('integrations', <artifactId>, …)`
   with the artifact id as the action name — a no-op that matched no macro.
   **Removed.** The real workflow surface (`WorkflowsPanel` → 11 real macros
   incl. scheduling + run history + replay) is the single home for automations.

2. **Fabricated `services` tab (DEFECT c).** `useLensData('integrations',
   'integration', { noSeed:true })` rendered hardcoded vscode/obsidian/notion
   service cards from artifacts that are never created (no backing macro, always
   empty). **Removed.** The real "integration tooling" browse is
   `IntegrationsRepos` (live GitHub search API), which stays mounted.

3. **3 DEAD deep analytical macros (DEFECT a — unsurfaced capability).** The
   "Integration Analysis" panel wired `apiHealthCheck`/`dataFlowMapping`/
   `compatibilityCheck` through `useRunArtifact` + `actionItems[0]` — where
   `actionItems` came from the same fabricated `integration` artifact type
   (`noSeed`, no macro), so `actionItems[0]` never existed and every analysis
   button was permanently disabled ("Create an integration artifact to run
   analysis actions"). Three genuinely deep engines (percentile latency
   analysis, flow-graph bottleneck detection, semver migration scoring) were
   **100% unreachable**. **Fixed:** new `components/integrations/AnalysisPanel.tsx`
   — a real diagnostics bench with bespoke structured row-editors (endpoints +
   samples; flows; APIs + field-changes — no raw JSON-paste) that call the
   macros directly via `lensRun('integrations', <macro>, { endpoints|flows|apis })`
   and render the full result (health scores, bottleneck ratios, throughput
   paths, migration effort).

4. **Honesty violation in `ConnectorCatalog` (DEFECT d — faked "Connected").**
   The card showed a green "Connected" badge for any connection record,
   ignoring the backend's `credentialStored`/`needsOauth` flags. For every
   oauth2 connector without a real token (i.e. all of them today) this
   overstated the truth. **Fixed:** the badge now reads green "Connected" only
   when `credentialStored === true`; otherwise an amber "Needs auth"
   (`ShieldAlert`) with a tooltip explaining the real egress path refuses until
   OAuth completes. The connect button reads "Select" (not "Connect") for oauth2
   connectors, the linked-accounts strip colours by credential status, and an
   explanatory line states the intent honestly.

5. **Stats row read fabricated data (DEFECT d).** "Connected" and "Active Syncs"
   summed the two never-populated artifact types (always 0). **Fixed:** the four
   tiles now read real data — Linked apps (`connectionList`), OAuth-authorized
   (`connectionList` filtered by `credentialStored`), Active workflows
   (`zapList` filtered by `enabled`), Webhooks (REST count).

6. **Generic-scaffold regression avoided.** After removing the fabricated tabs
   the page dropped below the grader's bespoke-page threshold while still
   mounting the generic `<LensFeaturePanel>` capabilities dump + the generic
   trio, which flipped `grade-ux-polish --honest` to `isGenericScaffold:true` /
   tier `functional`. **Fixed** by removing the redundant `<LensFeaturePanel>`
   (the page now has four real feature tabs) and the `<AutoActionStrip>`
   macro-button strip — clearing `usesGenericBody`, `hasMacroButtonWall`, and
   `importsGenericTrio`. Back to tier `polished` / `isGenericScaffold:false`.

## What was already real/wired (kept)

- **`WorkflowsPanel.tsx`** — DESIGNED. Real Zap list/run/toggle/delete + inline
  scheduling (`scheduleSet`/`scheduleClear`) + run history with replay
  (`runHistory`/`retryRun`) + a `TimelineView` run-trace. Correct `r.data.ok` /
  `r.data.result` unwrapping throughout (lensRun unwraps every `{ok,result}`
  envelope, so the inner macro `ok:false` is honestly reflected).
- **`WorkflowBuilder.tsx`** — DESIGNED. Bespoke multi-step trigger→action
  builder (action/filter/path/formatter/code/delay step kinds) → `zapSave`.
- **`StepTester.tsx`** — DESIGNED. Live tester for `previewFieldMap` /
  `evalCondition` / `runFormatter` / `runCodeStep` against sample JSON.
- **`ConnectorCatalog.tsx`** — DESIGNED (honesty fix applied). Catalog browse
  with category/search filters, per-app triggers/actions/scopes, connect/
  disconnect.
- **Webhooks tab (in `page.tsx`)** — DESIGNED. REST list/register/deactivate +
  the macro-backed test-fire (`webhookTest`, honest `ok:false` on no URL),
  signed delivery log (`webhookDeliveries`), backoff retry (`webhookRetry`),
  and an external-ingest URL helper.
- **`IntegrationsRepos.tsx`** — DESIGNED. Live GitHub search API (topic:api/
  webhook/oauth/sdk/mcp/zapier), honest error state, Save-as-DTU export.

## Fluidity / keyboard

`useLensCommand` registers Z/C/W/A tab shortcuts; each tab button now shows a
`kbd` chip + `title` so the shortcuts are **discoverable**, not just functional.
Mutating actions (connect, run, toggle, retry) show immediate busy spinners and
reconcile against the real macro response — no optimistic *success* is ever
shown before the backend confirms (which would violate honest-by-construction on
a connector surface).

## Genuinely missing (deferred — triaged per the sixth hard invariant)

- **Real OAuth connect flow for the catalog connectors (ENGINEERING +
  DATA-SOURCING).** Today `connectApp` records a *selection*; all six marquee
  connectors — Gmail, Calendar, Slack, Sheets, GitHub, Notion — now have real
  two-way egress readers on the connector-agnostic `connectorFetch` core (built +
  contract-tested), each live only once its OAuth client credentials are
  configured (`docs/CONNECTORS_GO_LIVE.md`).
  The UI is now honest about this gap (amber "Needs auth" rather than a fake
  "Connected") rather than papering over it. Closing it = wiring each
  provider's OAuth client + token exchange into `connector-tokens.js` — out of
  scope for a frontend rebuild pass, correctly surfaced as an honest
  pending-auth state.
- **`dueSchedules` surfacing (ENGINEERING, minor).** The schedule *setter*
  (`scheduleSet`) is fully surfaced in `WorkflowsPanel`; the `dueSchedules`
  poll helper (for a "N due now" indicator) is a governor/poll utility and is
  not yet shown in the UI. Low value; deferred.
- **`verifyWebhookSignature` surfacing (ENGINEERING, minor).** Useful for an
  inbound-signature verification widget; currently unsurfaced. The signed
  test-fire + delivery log + retry are the primary webhook surfaces. Deferred.
