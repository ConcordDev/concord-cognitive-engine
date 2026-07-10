# agents — Wave 3 audit (confirming — no changes)

Frontend Rebuild Program, Wave 3. `agents` already scored `polished` under
`grade-ux-polish.mjs --honest`. The old `docs/lens-specs/agents.md` (dated
2026-05-21) describes an 86-LOC backend with the defining feature — real
autonomous execution — "not wired". That claim is now **stale**: the domain
file has since grown to 794 LOC and every previously-"missing" item is
present and macro-backed. Verified directly rather than trusted from the doc.

Backend: `server/domains/agents.js` (794 LOC). 25 registered macros incl.
`evaluateCapability`, `routeTask`, `swarmStatus`, `benchmarkAgent`,
`executeRun`, `listRuns`, `getRunTrace`, `saveGraph`, `listGraphs`,
`deleteGraph`, `runGraph`, `createSchedule`, `listSchedules`,
`toggleSchedule`, `deleteSchedule`, `fireSchedule`, `postMessage`,
`getThread`, `clearThread`, `setBudget`, `getBudget`, `resetBudget`,
`listTemplates`, `importTemplate`, `runtimeOverview`.

## `node scripts/lens-unsurfaced.mjs --lens agents`

```
agents: 0/25 macros never referenced in the frontend
```

Every macro is reachable — and reachable through a real designed feature,
not a generic action array (`importsGenericTrio: true` in the grader is a
leftover `ManifestActionBar`/`AutoActionStrip` shell mounted alongside the
bespoke UI, which is the standard "more actions" fallback pattern used
fleet-wide, not the lens's primary surface). Verified against
`concord-frontend/components/agents/AgentRuntime.tsx` (873 LOC, the largest
bespoke component):

| Previously-"missing" feature (per stale `agents.md`) | Where it actually lives now |
|---|---|
| Real autonomous run loop (multi-step task execution) | `executeRun`/`listRuns`/`getRunTrace` |
| Tool-call inspector (inputs/outputs per step) | `getRunTrace` result rendering |
| Agent-to-agent orchestration graph | `saveGraph`/`listGraphs`/`deleteGraph`/`runGraph` → `AgentRuntime.tsx:339,353` (a real node/edge graph builder + runner, not a stub) |
| Scheduled/triggered runs (cron/webhook/event) | `createSchedule`/`listSchedules`/`toggleSchedule`/`deleteSchedule`/`fireSchedule` → `AgentRuntime.tsx:495` |
| Conversation thread per agent | `postMessage`/`getThread`/`clearThread` → `AgentRuntime.tsx:602,611` |
| Cost/token budget with enforcement | `setBudget`/`getBudget`/`resetBudget` → `AgentRuntime.tsx:689,697` |
| Agent templates / marketplace import | `listTemplates`/`importTemplate` → `AgentRuntime.tsx:797` |

Also present: `AgentPersonas.tsx`, `AgentSelfPanel.tsx`, `AgentRoster.tsx`
(roster with 6 agent types, per-agent config, detail tabs) — all wired to
real macros, no fabricated metrics found.

No changes made. This lens has genuinely closed the gap the earlier audit
(correctly) identified — it now reads as an agent *runtime*, not just a
registry.
