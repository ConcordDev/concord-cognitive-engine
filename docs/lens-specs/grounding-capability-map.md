# Grounding Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. This unit's sub-agent was mid-rebuild when a
> container restart interrupted the session before it could write this
> artifact or send a completion report; the code changes were already
> complete and coherent on disk. This document was written by the
> orchestrator post-restart, independently re-verifying every claim below
> against the live backend and the actual committed diff (not copied from
> the sub-agent's un-sent report).
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("grounding"' server/domains/grounding.js`
> Reproduce the reality-anchor system:
> `grep -n "ensureGroundingEngine" server/server.js`

## Two distinct real backend systems share the `grounding` domain name

This is the load-bearing finding, and it's genuinely real (independently
confirmed, not taken on faith):

1. **Fact-Check Workbench** — `server/domains/grounding.js`, 12 macros
   registered via `registerLensAction("grounding", ...)`: `factCheck`,
   `sourceCredibility`, `claimDecomposition`, `aggregateEvidence`,
   `confidenceRating`, `sourceBias`, `recordCheck`, `auditTrail`,
   `trendingClaims`, `factCheckCard`, `linkRebuttal`, `rebuttalsFor`. A
   Ground-News-parity claim/source/bias/confidence analysis + audit-trail +
   trending-claims substrate, dispatched through the standard
   `POST /api/lens/run` macro channel.
2. **Reality Anchor** — `server/server.js` (`ensureGroundingEngine`, ~line
   66623, first called ~13452), a separately-registered embodied
   "reality-anchoring" system reached over flat `/api/grounding/*` REST
   routes (NOT the macro dispatcher): sensor registry/readings, DTU-to-
   real-world grounding, calendar linking, and a consent-gated
   propose/approve action workflow.

These are unrelated systems that happen to share a name — the previous page
conflated them under one "Fact Verification" UI. The rebuild keeps them as
two clearly separated destinations (Fact-Check Workbench / Reality Anchor)
plus a third (Community Pulse — `MindfulnessFeed`, pre-existing and
unchanged).

## Macro coverage — verified by direct grep against the current code

### Fact-Check Workbench (12/12 macros DESIGNED)

| Macro | Wired in | Verified via |
|---|---|---|
| `factCheck` | `ClaimVerificationPanel.tsx` | `lensRun('grounding', 'factCheck', ...)` |
| `sourceCredibility` | `ClaimVerificationPanel.tsx` | `lensRun('grounding', 'sourceCredibility', ...)` |
| `claimDecomposition` | `ClaimVerificationPanel.tsx` | `lensRun('grounding', 'claimDecomposition', ...)` |
| `auditTrail` | `FactGroundingWorkbench.tsx` | `lensRun('grounding', 'auditTrail', ...)` |
| `rebuttalsFor` | `FactGroundingWorkbench.tsx` | `lensRun('grounding', 'rebuttalsFor', ...)` |
| `aggregateEvidence` | `FactGroundingWorkbench.tsx` | `lensRun('grounding', 'aggregateEvidence', ...)` |
| `confidenceRating` | `FactGroundingWorkbench.tsx` | `lensRun('grounding', 'confidenceRating', ...)` |
| `recordCheck` | `FactGroundingWorkbench.tsx` | `lensRun('grounding', 'recordCheck', ...)` |
| `factCheckCard` | `FactGroundingWorkbench.tsx` | `lensRun('grounding', 'factCheckCard', ...)` |
| `sourceBias` | `FactGroundingWorkbench.tsx` | `lensRun('grounding', 'sourceBias', ...)` |
| `trendingClaims` | `FactGroundingWorkbench.tsx` | `lensRun('grounding', 'trendingClaims', ...)` |
| `linkRebuttal` | `FactGroundingWorkbench.tsx` | `lensRun('grounding', 'linkRebuttal', ...)` |

`ClaimVerificationPanel.tsx` was extended (not newly created) as part of
this rebuild — its diff shows the panel growing from a narrower surface to
cover the full claim-check flow feeding into `FactGroundingWorkbench`
(pre-existing, unchanged) for the audit/evidence/trending features.

### Reality Anchor (all `apiHelpers.grounding.*` REST endpoints DESIGNED)

New `SensorGroundingPanel.tsx` wires every endpoint added to
`lib/api/client.ts`'s `apiHelpers.grounding` block this session: `sensors`,
`registerSensor`, `readings`, `addReading`, `context`, `status`, `ground`,
`linkCalendar`, `proposeAction`, `approveAction`, `actions.pending`. The
client-helper diff added `registerSensor`, `linkCalendar`, `proposeAction`,
`approveAction`, and extended `ground()` to accept richer params — all
newly-surfaced capability that previously had no frontend caller.

## What was fixed (fake-data finding)

The previous page rendered six "Source Verification Status Cards" with
**hardcoded confidence numbers** (97/94/88/91/93/…) and hardcoded
"Last check: 30s ago"-style freshness text — literal values written directly
in JSX, not derived from any query, state, or timestamp. This is a
textbook fabricated-success-state violation of CLAUDE.md's honest-by-
construction rule (and exactly the class of defect the "Zero demo content"
invariant was written to name). Removed entirely; every number on the
rebuilt page traces to a live macro/REST response.

## Reference-parity note

The Fact-Check Workbench's real reference bar is **Ground News**
(the multi-source bias/confidence aggregation shape the backend's own
macro set already mirrors — `aggregateEvidence` + `sourceBias` +
`confidenceRating` + `trendingClaims` map directly onto Ground News's core
loop). Coverage: all 12 real macros are DESIGNED; no GENUINELY-MISSING
items were identified in this pass (this capability map was written from
verified code state post-restart, not from an original WebSearch research
pass the interrupted sub-agent may have run — if a future audit wants a
full researched consumer-app checklist against Ground News specifically,
that's a reasonable follow-up, not a blocking gap for this rebuild).

## Verification

- `npx eslint app/lenses/grounding/page.tsx components/grounding/ClaimVerificationPanel.tsx components/grounding/SensorGroundingPanel.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide (post-restart, no concurrent load).
- No existing grounding-lens test file (confirmed by grep) — nothing to update.
- Manual grep confirms 0 `<div onClick>` without `role`/`tabIndex`/`onKeyDown` in the touched files.
