# Spec-vs-Implementation Audit

Generated: 2026-05-29T17:37:43.608Z

Specs scanned: 234. Mismatches detected: 31.

## By category

- **STUB-WHERE-INTEGRATION-CLAIMED**: 19
- **CRUD-WHERE-WORKFLOW-CLAIMED**: 11
- **POLLING-WHERE-REALTIME-CLAIMED**: 1

## By lens

### code (6)

- `code.github-remote-status` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/code.js:1901`](../server/domains/code.js#L1901))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
- `code.liveshare-start` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/code.js:2115`](../server/domains/code.js#L2115))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
- `code.liveshare-join` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/code.js:2137`](../server/domains/code.js#L2137))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
- `code.liveshare-edit` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/code.js:2153`](../server/domains/code.js#L2153))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
- `code.liveshare-poll` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/code.js:2191`](../server/domains/code.js#L2191))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
- `code.liveshare-end` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/code.js:2210`](../server/domains/code.js#L2210))
  - Implement the integration with await fetch to the API OR downgrade spec prose.

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

### healthcare (4)

- `healthcare.telehealth-create` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/healthcare.js:1790`](../server/domains/healthcare.js#L1790))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
- `healthcare.telehealth-create` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/domains/healthcare.js:1790`](../server/domains/healthcare.js#L1790))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.
- `healthcare.visit-summary` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/healthcare.js:1684`](../server/domains/healthcare.js#L1684))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
- `healthcare.visit-summary` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/domains/healthcare.js:1684`](../server/domains/healthcare.js#L1684))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.

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

- `tools.web_search` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/server.js:11697`](../server/server.js#L11697))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.
- `legal.sign` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/server.js:24901`](../server/server.js#L24901))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.

### cognitive-replay (1)

- `chat.timeline` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/server.js:73030`](../server/server.js#L73030))
  - Implement the integration with await fetch to the API OR downgrade spec prose.

### collab (1)

- `collab.cursorUpdate` — **POLLING-WHERE-REALTIME-CLAIMED**  ([`server/domains/collab.js:482`](../server/domains/collab.js#L482))
  - Add realtimeEmit to the handler OR downgrade spec prose to describe polling explicitly.

### insurance (1)

- `insurance.quotes-compare` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/domains/insurance.js:296`](../server/domains/insurance.js#L296))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.

### observe (1)

- `observer.compose_report` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/server.js:74075`](../server/server.js#L74075))
  - Implement the integration with await fetch to the API OR downgrade spec prose.

### sentinel (1)

- `shield.threats` — **CRUD-WHERE-WORKFLOW-CLAIMED**  ([`server/server.js:23118`](../server/server.js#L23118))
  - Implement the multi-step workflow (orchestrate child macros via runMacro) OR downgrade spec prose.

### space (1)

- `space.launch-countdown` — **STUB-WHERE-INTEGRATION-CLAIMED**  ([`server/domains/space.js:431`](../server/domains/space.js#L431))
  - Implement the integration with await fetch to the API OR downgrade spec prose.
