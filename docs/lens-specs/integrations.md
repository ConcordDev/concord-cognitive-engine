# integrations — Feature Gap vs Zapier

Category leader (2026): Zapier (workflow automation / app integration). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/integrations.js` registerLensAction macros (apiHealthCheck, dataFlowMapping, compatibilityCheck).

## Has (verified in code)
- API health checking — latency percentiles (p50/75/90/95/99), error-rate breakdown (4xx/5xx), throughput, availability scoring per endpoint
- Data-flow mapping between systems
- Version compatibility checking
- Connected-integrations panel UI

## Missing — buildable feature backlog
- [ ] `[L]` Trigger→action workflow builder ("Zap") — visual multi-step automation editor
- [ ] `[L]` App connector library with OAuth — pre-built integrations to common SaaS
- [ ] `[M]` Webhook listener + dispatcher so external events can trigger flows
- [ ] `[M]` Run history / execution logs per workflow with replay
- [ ] `[M]` Conditional logic, filters, and field-mapping between steps
- [ ] `[S]` Scheduled triggers (polling / cron) for non-webhook sources
- [ ] `[M]` Multi-step data transformation (formatter / code step)

## Parity
~30% of Zapier's surface. It is an API-observability panel (health, latency, compatibility), not an automation platform — missing the trigger/action workflow engine, connector library, and run history that are the entire point of Zapier.
