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
- [ ] `[L]` Visual trigger→action workflow builder — multi-step "Zap" editor (Zapier's core)
- [ ] `[L]` App connector catalog with OAuth — pre-built triggers/actions per SaaS app, not raw webhooks
- [ ] `[M]` Conditional logic / branching (paths, filters) in automations
- [ ] `[M]` Field-level data mapping UI between source and destination
- [ ] `[M]` Run history & retry — per-automation execution log with replay
- [ ] `[S]` Scheduled / polling triggers, not just inbound webhooks
- [ ] `[S]` Webhook delivery retry with backoff + signature verification
- [ ] `[M]` Formatter / transform / code steps between actions

## Parity
~40% of Zapier's surface. Webhook plumbing, automations, and health monitoring are real, but the defining Zapier experience — a visual multi-step workflow builder with a connector catalog and branching — is absent.
