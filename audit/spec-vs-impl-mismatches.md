# Spec-vs-Implementation Audit

Generated: 2026-05-23T23:44:35.633Z

Specs scanned: 234. Mismatches detected: 21.

## By category

- **STUB-WHERE-INTEGRATION-CLAIMED**: 12
- **CRUD-WHERE-WORKFLOW-CLAIMED**: 9

## By lens

### offline (6)

- `offline.swManifest` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/offline.js:591`](../server/domains/offline.js#L591))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
- `offline.mergeResolve` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/offline.js:559`](../server/domains/offline.js#L559))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
- `offline.replicationPush` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/offline.js:409`](../server/domains/offline.js#L409))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
- `offline.syncCheckpoint` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/offline.js:493`](../server/domains/offline.js#L493))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
- `offline.backoffSchedule` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/offline.js:517`](../server/domains/offline.js#L517))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
- `offline.replicationPull` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/offline.js:379`](../server/domains/offline.js#L379))
  - Implement the integration with await fetch to the API OR downgrade spec prose.

### ingest (4)

- `ingest.getWebhookEndpoint` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/ingest.js:660`](../server/domains/ingest.js#L660))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
- `ingest.getWebhookEndpoint` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/domains/ingest.js:660`](../server/domains/ingest.js#L660))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.
- `ingest.listWebhookRecords` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/ingest.js:721`](../server/domains/ingest.js#L721))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
- `ingest.listWebhookRecords` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/domains/ingest.js:721`](../server/domains/ingest.js#L721))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.

### sessions (3)

- `sessions.list_mine` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/domains/sessions.js:263`](../server/domains/sessions.js#L263))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.
- `sessions.get` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/domains/sessions.js:219`](../server/domains/sessions.js#L219))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.
- `sessions.close` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/domains/sessions.js:301`](../server/domains/sessions.js#L301))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.

### tools (2)

- `tools.web_search` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/server.js:11041`](../server/server.js#L11041))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.
- `legal.sign` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/server.js:24201`](../server/server.js#L24201))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.

### code (1)

- `code.github-remote-status` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/code.js:1901`](../server/domains/code.js#L1901))
  - Implement the integration with await fetch to the API OR downgrade spec prose.

### cognitive-replay (1)

- `chat.timeline` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/server.js:69576`](../server/server.js#L69576))
  - Implement the integration with await fetch to the API OR downgrade spec prose.

### insurance (1)

- `insurance.quotes-compare` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/domains/insurance.js:296`](../server/domains/insurance.js#L296))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.

### observe (1)

- `observer.compose_report` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/server.js:70621`](../server/server.js#L70621))
  - Implement the integration with await fetch to the API OR downgrade spec prose.

### sentinel (1)

- `shield.threats` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/server.js:22451`](../server/server.js#L22451))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.

### space (1)

- `space.launch-countdown` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/space.js:431`](../server/domains/space.js#L431))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
