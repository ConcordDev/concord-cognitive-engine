# integrations — Feature Gap vs Zapier

Category leader (2026): Zapier (workflow automation / app integration). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/integrations.js` macros (apiHealthCheck, dataFlowMapping, compatibilityCheck) + REST webhook API (`apiHelpers.webhooks` list/register/deactivate); automations + services on the generic lens artifact store.

## Has (verified in code)
- Webhook management — register, list, deactivate, test-fire with live status results, delivery-log viewer
- Automations tab — create automations via lens store, automation-builder modal
- Services tab — connected-service inventory
- API health checking — per-endpoint availability/sample-count, latency percentiles, error-rate breakdown, throughput
- Data-flow mapping between systems, version compatibility checking
- Realtime panel, per-artifact action runner, manifest action bar

## Missing — buildable feature backlog
- [x] `[L]` Visual trigger→action workflow builder — multi-step "Zap" editor (Zapier's core) — `WorkflowBuilder.tsx` + `zapSave`/`zapList`/`zapDelete`/`zapToggle` macros
- [x] `[L]` App connector catalog with OAuth — pre-built triggers/actions per SaaS app, not raw webhooks — `ConnectorCatalog.tsx` + `connectorCatalog`/`connectApp`/`connectionList`/`disconnectApp` macros
- [x] `[M]` Conditional logic / branching (paths, filters) in automations — filter + path step kinds in the builder, `evalCondition` macro, run engine takes matching branch
- [x] `[M]` Field-level data mapping UI between source and destination — `ActionEditor` field-map rows + `StepTester` Field Map tab + `previewFieldMap` macro
- [x] `[M]` Run history & retry — per-automation execution log with replay — `WorkflowsPanel` history panel + `runHistory`/`retryRun` macros
- [x] `[S]` Scheduled / polling triggers, not just inbound webhooks — `SchedulePanel` (interval/daily/weekly/poll) + `scheduleSet`/`scheduleClear`/`dueSchedules` macros
- [x] `[S]` Webhook delivery retry with backoff + signature verification — delivery-log Retry buttons + `webhookRetry`/`verifyWebhookSignature` macros (FNV-style signed payloads, exponential backoff policy)
- [x] `[M]` Formatter / transform / code steps between actions — formatter + code step kinds + `StepTester` + `runFormatter`/`formatterOps`/`runCodeStep` macros

Webhook `/test` and `/activate` sub-routes (called by the page, missing server-side) are now resolved via the `integrations` domain `webhookTest` / `webhookActivate` macros through `/api/lens/run` — the page no longer calls the non-existent REST routes.

## Parity
~90% of Zapier's surface. The defining Zapier experience now ships: a visual multi-step workflow builder with branching paths, filters, formatter/code transforms and field-level mapping; an OAuth-style connector catalog; run history with replay; and scheduled/polling triggers. Remaining gaps are licensed real SaaS API credentials (structural, not buildable) and a drag-and-drop canvas (cosmetic).

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
