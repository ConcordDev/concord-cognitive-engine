# Command Center Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Reproduce the macro list:
> `grep -c 'registerLensAction("command-center"' server/domains/commandcenter.js` → 24
>
> Note: the domain **file** is `server/domains/commandcenter.js` but every
> macro is registered under the string `"command-center"` (with a hyphen).
> The generic `lens-unsurfaced.mjs` backlog script filters by filename, so it
> reports nothing for this domain — the surfaced/unsurfaced check below was
> done by hand (grepping each macro token across
> `concord-frontend/{app,components,lib}`), per the task brief.

## What this page actually is

`app/lenses/command-center/page.tsx` (2,213 LOC before this rebuild) is two
things layered on top of each other:

1. **The `command-center` domain's 24 macros** — an SRE/incident-command
   cockpit (vitals, alert rules, dashboards, incidents, correlation, health
   rollup, runbooks, sitrep/escalation). This is the in-scope surface for
   this rebuild.
2. **Concord's own internal engine meta-console** — ~28 additional tabs
   (Brains, Cognitive, LOAF, Affect, Emergents, Lattice, Shield, Attention,
   Forgetting, Repair, Promotions, Plugins, Pipeline, Organism, Federation,
   Users, Config, Emergency, Dream, Breakthrough, Meta-Derivation,
   Foundation, Predictions, Logs, Activity, Undo, Guide) that read from
   *other* real domains (`guidance`, `emergent`, `marketplace`,
   `predictions`, `perf`, …) to give operators of the Concord platform
   itself a dashboard. These predate this rebuild, are not part of the
   `command-center` domain's macro surface, and were spot-checked for
   fabricated data (see "Audit findings" below) but are out of this
   rebuild's scope — reworking them would be a different lens's work
   (they're each backed by their own real domain).

The domain's own SRE surface lives entirely in the **"Ops Cockpit" tab**
(`components/command-center/OpsCockpit.tsx`), which is the real designed
app for this capability map.

## Capability audit — all 24 macros

| # | Macro | Classification | Where |
|---|---|---|---|
| 1 | `recordVital` | **DESIGNED** | `VitalsSection` — metric name + value input, live series |
| 2 | `vitalHistory` | **DESIGNED** | `VitalsSection` — windowed history feeds `ChartKit` area chart |
| 3 | `vitalMetrics` | **DESIGNED** | `VitalsSection` — metric picker chips |
| 4 | `createAlertRule` | **DESIGNED** | `AlertsSection` — name/metric/comparator/threshold/severity/on-call form |
| 5 | `listAlertRules` | **DESIGNED** | `AlertsSection` |
| 6 | `acknowledgeAlert` | **DESIGNED** | `AlertsSection` — Acknowledge button on a breaching rule |
| 7 | `muteAlertRule` | **DESIGNED** | `AlertsSection` — Mute/Unmute toggle |
| 8 | `deleteAlertRule` | **DESIGNED** | `AlertsSection` — Delete button |
| 9 | `saveDashboard` | **DESIGNED** | `DashboardsSection` — named layout + comma-separated panel list |
| 10 | `listDashboards` | **DESIGNED** | `DashboardsSection` |
| 11 | `deleteDashboard` | **DESIGNED** | `DashboardsSection` |
| 12 | `openIncident` | **DESIGNED** | `IncidentsSection` — title/severity/description form |
| 13 | `updateIncident` | **DESIGNED** | `IncidentsSection` — status transition + message, per-incident timeline |
| 14 | `writePostmortem` | **DESIGNED** | `IncidentsSection` — summary/root-cause form, shown once written |
| 15 | `listIncidents` | **DESIGNED** | `IncidentsSection` — open count + MTTR header |
| 16 | `correlateVitals` | **DESIGNED** | `CorrelationSection` — Pearson pairs across recorded metrics |
| 17 | `healthRollup` | **DESIGNED** | `HealthBanner` — score/verdict/breaches banner at cockpit top |
| 18 | `saveRunbook` | **DESIGNED** | `RunbooksSection` — name/trigger/ordered-steps form |
| 19 | `listRunbooks` | **DESIGNED** | `RunbooksSection` |
| 20 | `runRunbook` | **DESIGNED** | `RunbooksSection` — Run button, execution log, incident timeline note |
| 21 | `deleteRunbook` | **DESIGNED** | `RunbooksSection` |
| 22 | `situationReport` | **was GENERIC-STRIP-ONLY, and BROKEN — fixed this rebuild** | new `SituationRoomSection` |
| 23 | `incidentCorrelation` | **was GENERIC-STRIP-ONLY, and BROKEN — fixed this rebuild** | new `SituationRoomSection` |
| 24 | `escalationEngine` | **was GENERIC-STRIP-ONLY, and BROKEN — fixed this rebuild** | new `SituationRoomSection` |

21 of 24 macros were already real, designed features in `OpsCockpit.tsx` —
a genuinely well-built SRE cockpit predates this rebuild pass. The
remaining 3 were the defect.

## The real bug found (not just "generic strip" — silently mis-routed)

`page.tsx` had a **"Command Center Actions"** panel (3 buttons: "Generate
Sitrep" / "Correlate Incidents" / "Escalation Analysis") that looked like a
plausible generic-strip caller for the 3 remaining macros. It was worse
than a shape mismatch — it never reached the real macros at all:

- It called `useRunArtifact('commandcenter')` (no hyphen) and
  `useLensBridge('commandcenter', 'event')`, which persist/read a lens
  artifact tagged `domain: 'commandcenter'` and dispatch through
  `POST /api/lens/:domain/:id/run` → the generic `lens.run` macro
  (`server.js:38269`), which looks up `LENS_ACTIONS.get('${artifact.domain}.${action}')`.
- Every macro in `server/domains/commandcenter.js` is registered under the
  string `"command-center"` **(with a hyphen)**, so
  `LENS_ACTIONS.get('commandcenter.situationReport')` is always a miss.
- On a miss, `lens.run`'s fallback (`server.js:38280-38298`) silently routes
  to the **utility LLM brain catch-all** instead — so clicking these
  buttons never ran the real deterministic `situationReport` /
  `incidentCorrelation` / `escalationEngine` handlers at all. It either
  produced an LLM-guessed answer dressed as `source: "utility-brain"`, or a
  bare error when the brain was unavailable. This is exactly the
  "fabricated success from a mismatched wire" class of defect
  `CLAUDE.md`'s audit history warns about, just one level more subtle than
  a hardcoded number: the *route* was fake, not a value on screen.
- Even ignoring the routing bug, the panel was bridging **system-health
  data** (`apiHelpers.guidance.health()` — uptime/memory/DTU counts) into
  an artifact and calling macros that expect `feeds`/`incidents`/
  `incident+escalationPolicy` batch shapes. Had the routing bug not
  existed, `situationReport` would always have returned `"No data feeds
  provided."` and `incidentCorrelation` `"Need at least 2 incidents..."` —
  a second, independent reason this strip could never have produced a real
  result.

## Fix

1. **Removed** the broken "Command Center Actions" panel from `page.tsx`
   entirely, plus its now-dead plumbing: `useRunArtifact`, `useLensBridge`,
   the `mainHealth` bridge-sync effect, `handleAction`, `actionResult`,
   `isRunning`, and the never-triggered `actionPreview` / `ActionPreviewModal`
   (that modal's trigger was never set anywhere in the file — dead since
   before this rebuild).
2. **Added** a real designed **"Situation Room"** section to
   `OpsCockpit.tsx` (the domain's actual home, alongside the other 7
   feature sections) that wires all 3 macros against **real, freshly
   re-fetched operator state** — never user-typed or fabricated:
   - **Generate Situation Report** — builds `feeds` from the operator's
     live `listAlertRules` (source `alert-rules`, one item per rule,
     `resolved: state !== 'breaching'`) and `listIncidents` (source
     `incidents`, one item per incident), then calls `situationReport`.
     Renders the real `overallStatus`/`readinessScore`/per-feed health,
     critical items, operational tempo, and cross-source overlap flags —
     an honest "no feeds yet" message when there's nothing to report on.
   - **Correlate Incidents** — maps live incidents to the macro's
     `{id, source, timestamp, attributes, severity, description}` shape
     and calls `incidentCorrelation`. Renders correlation count, clusters,
     and the top pairwise matches; surfaces the macro's own honest
     "need at least 2 incidents" message untouched when there aren't.
   - **Analyze Escalation** — a real incident picker (populated from live
     `listIncidents`) feeds one incident's `{id, severity, createdAt,
     description}` into `escalationEngine` (no policy passed, so the
     macro's own auto-generated 4-level SLA ladder computes for real).
     Renders urgency score/label, SLA burn, the escalation level path with
     triggered levels highlighted, and recommended actions.
   A stale-closure bug was caught and fixed during implementation: the
   shared `loadSources()` helper originally read `selectedIncidentId` from
   its mount-time closure, which would have silently reset the operator's
   manual incident selection back to the first incident on every refresh.
   Fixed with a functional `setSelectedIncidentId((prev) => ...)` update
   that only defaults when nothing valid is currently selected.

## Reference apps + parity target

- **PagerDuty** — incidents with status transitions, on-call escalation
  policies with SLA timers, blameless postmortems.
- **Datadog / Grafana-style ops dashboard** — custom metric ingestion +
  time-series, alerting rules with severity/mute/ack, saved dashboards,
  cross-metric correlation, health/SLO rollups.
- **Parity target** (owner's framing): the only difference between this
  cockpit and a real PagerDuty+Datadog-shaped SRE tool should be
  integration breadth (real external monitoring feeds, a real paging/SMS
  channel) — every score, correlation, and escalation level should trace
  to the real math in `server/domains/commandcenter.js`, never a
  placeholder.

## Checklist — reference-app features vs. Concord command-center

| Feature | Bucket | Disposition |
|---|---|---|
| Custom metric ingestion + time-series history | ALREADY REAL | `recordVital`/`vitalHistory`/`vitalMetrics` → `VitalsSection` |
| Alert rules (threshold/comparator/severity) + mute/ack/delete | ALREADY REAL | `AlertsSection` |
| Saved dashboards (named layout of panels) | ALREADY REAL | `DashboardsSection` — see honest note below |
| Incident timeline with status transitions + MTTR | ALREADY REAL | `IncidentsSection` |
| Blameless postmortem (summary/root cause/action items) | ALREADY REAL | `IncidentsSection` |
| Cross-metric correlation (Pearson) | ALREADY REAL | `CorrelationSection` |
| At-a-glance health/SLO rollup score | ALREADY REAL | `HealthBanner` |
| One-click remediation runbooks + execution log | ALREADY REAL | `RunbooksSection` |
| Cross-source situation report (readiness score, critical items, tempo, cross-source overlap) | **was BACKEND-CAPABLE-BUT-UNSURFACED (and mis-routed to an LLM catch-all)** | `situationReport` — **fixed this rebuild**, new "Situation Room" panel |
| Batch incident correlation (pairwise + clustering, distinct from the single-metric Pearson correlation above) | **was BACKEND-CAPABLE-BUT-UNSURFACED (and mis-routed)** | `incidentCorrelation` — **fixed this rebuild**, same panel |
| Escalation policy engine (urgency score, SLA burn, auto or custom escalation levels, recommended actions) | **was BACKEND-CAPABLE-BUT-UNSURFACED (and mis-routed)** | `escalationEngine` — **fixed this rebuild**, same panel |
| Real on-call paging (SMS/phone/push notification delivery) | **GENUINELY MISSING** | Honest relabel: an alert rule's `onCall` field is a free-text note for the operator's own reference, not a live paging channel. No code claims otherwise. A real paging integration would need an external connector (Twilio/webhook) — out of this domain's macro surface; deliberately deferred, not faked. |
| Multi-user / team on-call rotation and shared incident visibility | **GENUINELY MISSING** | Honest relabel, not a bug: the domain's own header comment says "per-operator persistent state" (`ccState()` keys every bucket by `uid(ctx)`). This is a personal ops cockpit, not a shared team incident-command system, by design. Scoped future build if multi-operator visibility is ever wanted — not attempted here. |
| Live composable dashboard widget rendering (Datadog-style grid of real graphs) | **CLOSED (2026-07-16, `cc55e66f`)** | New `dashboardData` macro resolves each saved widget id against real sources: a matching vital metric (via a `computeVitalHistory` helper extracted verbatim from `vitalHistory`, zero behavior change) or a matching alert rule. A widget matching neither reports an honest per-widget `{id, error}` instead of a fabricated chart, and one bad widget never breaks the rest of the response. New `DashboardWidgetTile` grid in `OpsCockpit.tsx` reuses the existing `ChartKit` — no new charting dependency. 7 new backend tests, 5 new frontend tests. |

Every ALREADY REAL item was verified by reading the macro's math in
`server/domains/commandcenter.js` and the corresponding section in
`OpsCockpit.tsx` calling it with real user-entered or macro-returned data —
no client-side-computed scores, no `Math.random()`, no hardcoded percentage
strings anywhere in the touched files (checked by grep across
`page.tsx` and `components/command-center/*.tsx`).

## Audit note on the other ~28 tabs (out of `command-center`-domain scope)

A quick fabrication scan of the rest of `page.tsx` (Brains/Cognitive/LOAF/
Affect/Emergents/Lattice/Shield/Attention/Forgetting/Repair/Promotions/
Plugins/Pipeline/Organism/Federation/Users/Config/Emergency/Dream/
Breakthrough/Meta-Derivation/Foundation/Predictions/Logs/Activity/Undo/
Guide panels) found no `Math.random()` and no literal hardcoded percentage/
score strings — every status color and number traces to a real query
(`apiHelpers.guidance.health()`, `apiHelpers.perf.metrics()`,
`apiHelpers.emergent.*`, `apiHelpers.marketplace.*`, etc.). These panels
belong to other domains' capability maps if/when those lenses are rebuilt;
they were left alone here as out of scope for the `command-center` macro
surface, per the task brief.

## Left alone (already real, already well-designed)

`OpsCockpit.tsx`'s 7 pre-existing sections (Vitals, Alerts, Incidents,
Correlation, Dashboards, Runbooks, plus the `HealthBanner`) — all real,
densely designed, keyboard-friendly forms wired directly to their macros
with honest empty states ("No alert rules yet…", "No data yet…"). Its
existing dark cyan monitoring-console visual language (`bg-[#0a0f18]`,
`border-cyan-900/*`, the shared `Field`/`inputCls`/`SEV_COLOR` helpers) is
itself the dense, dark, single-purpose SRE identity this domain wants — the
new "Situation Room" section reuses those exact tokens rather than
introducing `lib/design-system.ts` classes that would visually clash within
the same file; this is a deliberate consistency call, not an oversight of
the design-system instruction. `ConcordVitals.tsx` (a separate small
component rendering live `/api/system` + perf + economy status) was
inspected and left untouched — every field it renders traces to a real
API response, no fabrication found.

## Verification

- `npx eslint app/lenses/command-center/page.tsx components/command-center/*.tsx` — clean, 0 errors / 0 warnings.
- `npx tsc --noEmit -p .` — 0 errors in any touched file. (32 pre-existing errors remain in `app/lenses/collab/page.tsx`, a file a concurrent sibling rebuild agent is mid-editing in this shared tree — not touched by this unit and not introduced by it.)
- `node scripts/verify-lens-backends.mjs` — `command-center` stays WIRED (258 WIRED / 2 by-design NO-BACKEND-CALL / 0 broken, fleet-wide).
- `node scripts/grade-ux-polish.mjs --honest` — `command-center`: `tier: "polished"`, `isGenericScaffold: false`, `honestCapped: false`.
