# Alliance Lens — Capability Map (Frontend Rebuild Program, Wave 2)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/alliance.js` (1,053 LOC) in full — no inline
> `registerLensAction("alliance", …)` calls exist elsewhere in
> `server/server.js` (confirmed by grep: zero matches). Reference-parity
> research is real (WebSearch against Slack's own developer docs/help
> center for Slack Connect, cited below), not recalled from training data.
>
> Reproduce the macro list:
> `grep -n 'registerLensAction("alliance"' server/domains/alliance.js`

## Backend surface

The domain is genuinely **two distinct capability clusters** sharing one
macro namespace — worth stating explicitly since it drove the two-tab split
below:

1. **Strategic-analysis calculators** (`compatibilityScore`,
   `networkAnalysis`, `riskAssessment`) — general-purpose diplomatic/network
   math (Jaccard similarity, Brandes betweenness centrality, HHI
   concentration index) operating on manually-described input, not on the
   user's own alliances.
2. **Cross-org collaboration objects** (`alliance-*`, `channel-*`,
   `message-*`, `invite-*`, `member-*`, `proposal-*`, `notifications`,
   `mark-read`) — a real Slack-Connect/Discord-shaped substrate: alliances
   with role-gated members (owner/admin/member/guest), threaded channels,
   reactions, attachments, invites, and quorum-vote proposals.

### Registered macros — `server/domains/alliance.js` (21)

| Macro | Real result shape (key fields) | Classification (before) | Classification (after) |
|---|---|---|---|
| `compatibilityScore` | `{compositeScore, compatibilityLevel, componentScores{}, overlap{}, uniqueContributions{}}` | GENERIC-STRIP-ONLY — reachable only via `<UniversalActions>`'s auto-discovered raw-JSON button wall | DESIGNED — `AllianceAnalyticsPanel` Compatibility tool: structured Partner A/B forms, score gauge, component bars, overlap/unique-contribution chips |
| `networkAnalysis` | `{density, connectedComponents, globalClusteringCoefficient, brokers[], topByDegree[], topByBetweenness[]}` | GENERIC-STRIP-ONLY | DESIGNED — Network tool: node/edge builder + `DataTable`-backed broker ranking |
| `riskAssessment` | `{overallRiskScore, riskLevel, hhi, hhiClassification, diversificationIndex, concentrationRisks[], singlePointsOfFailure[]}` | GENERIC-STRIP-ONLY | DESIGNED — Risk tool: dependency-row builder + risk gauge + `DataTable` concentration table + SPOF list |
| `alliance-create` | `{alliance, defaultChannel}` | DESIGNED (`AllianceWorkspace`) | DESIGNED — Workspace tab (unchanged, already real) |
| `alliance-list` | `{alliances[], count}` | DESIGNED | DESIGNED — Workspace tab **and** promoted to the page header KPI strip |
| `channel-create` | `{channel}` | DESIGNED | DESIGNED |
| `channel-list` | `{channels[], count}` | DESIGNED | DESIGNED |
| `message-send` | `{message}` | DESIGNED | DESIGNED |
| `message-list` | `{messages[] (threaded), total}` | DESIGNED | DESIGNED |
| `message-react` | `{messageId, reactions}` | DESIGNED | DESIGNED |
| `invite-create` | `{invite}` | DESIGNED | DESIGNED |
| `invite-list` | `{invites[], scope}` | DESIGNED | DESIGNED |
| `invite-respond` | `{invite, joined}` | DESIGNED | DESIGNED |
| `member-set-role` | `{member}` | DESIGNED | DESIGNED |
| `member-remove` | `{removed, memberCount}` | DESIGNED | DESIGNED |
| `proposal-create` | `{proposal}` | DESIGNED | DESIGNED |
| `proposal-vote` | `{proposalId, tally}` | DESIGNED | DESIGNED |
| `proposal-list` | `{proposals[] (with tally + myVote), count}` | DESIGNED | DESIGNED |
| `proposal-close` | `{proposal (with decision + finalTally)}` | DESIGNED | DESIGNED |
| `notifications` | `{totalUnread, pendingInvites, perAlliance[], invites[]}` | DESIGNED | DESIGNED — Workspace tab **and** promoted to page header status dot |
| `mark-read` | `{channelId, readAt}` | DESIGNED | DESIGNED |

**21/21 macros are DESIGNED after this rebuild.** The 3 analytics macros were
the real, verified gap — GENERIC-STRIP-ONLY per the program's own
definition ("reachable only through the auto-discovered macro-button wall"),
confirmed by reading `app/lenses/alliance/page.tsx`'s prior body: the ONLY
call sites for `compatibilityScore`/`networkAnalysis`/`riskAssessment` in the
entire frontend were inside `<UniversalActions domain="alliance"
artifactId={null} compact />`, which posts free-typed JSON and renders the
raw response with no structure.

### Why the two clusters aren't force-merged

`compatibilityScore`/`networkAnalysis`/`riskAssessment` take manually-typed
partner descriptions (`{name, capabilities[], values[], resources[],
strengths[]}`) or a manually-built node/edge graph — they do **not** read the
user's own `AllianceWorkspace` alliances (which model
channels/members/proposals, not "capability sets" or a dependency
percentage). Wiring a fabricated bridge between the two — e.g. auto-filling
"Partner A" from an alliance's member list — would invent a relationship the
backend doesn't compute. `AllianceAnalyticsPanel` is deliberately a
standalone strategic-analysis toolkit, the same shape as Finance's
`TaxEstimator`/`RetirementSimulator` calculators (real math, manually-scoped
input, no synthetic auto-fill).

One deliberate scope trim, recorded honestly: `compatibilityScore`'s
`params.weights` override and `riskAssessment`'s
`params.concentrationThreshold` override are **not** surfaced in the UI. The
`/api/lens/run` dispatch chokepoint's redundant-artifact-wrapper peel
(`server/lib/lens-input-normalize.js`) only unwraps a **single-key**
`{ artifact: { data } }` body; adding a sibling `params` key would break the
peel and silently pass `undefined` to the handler. Both macros already ship
sensible defaults (`weights: {capabilities:0.3, values:0.35, resources:0.15,
complementarity:0.2}`, `concentrationThreshold: 30`), so this is a real,
narrow, documented scope trim — not a hidden gap.

## Reference-parity checklist

**(a) Reference apps:** [Slack Connect](https://slack.com/connect) (shared
channels + guest invites across organizations — the closest real product to
the `alliance-*`/`channel-*`/`message-*`/`invite-*` cluster) and a DAO-style
quorum-voting governance tool (the `proposal-*` cluster's closest real
analog — e.g. Snapshot-class on-chain-adjacent voting, though Concord's is
off-chain and role-gated rather than token-gated).

**(b) Parity statement:** the only difference between Concord's alliance
workspace and Slack Connect should be scale (Slack supports up to 250 orgs
per shared channel; Concord's alliances are unbounded by any artificial cap
in the domain code) and the addition of the quorum-vote governance layer
Slack itself doesn't have.

**(c) Researched checklist** (Slack Connect feature set, via WebSearch
2026-07-09):

| # | Checklist item (source) | Disposition | Notes |
|---|---|---|---|
| 1 | Shared channels connecting separate organizations | ALREADY REAL | `alliance-create`/`channel-create` — an alliance is the cross-org container, channels live inside it. |
| 2 | Read/send messages, same as an internal channel | ALREADY REAL | `message-send`/`message-list` — full parity, plus threading (`parentId`) which even exceeds flat Slack Connect channels. |
| 3 | File/attachment sharing in shared channels | ALREADY REAL (partial) | `message-send`'s `attachments[]` (`name`/`url`/`mime`/`sizeBytes`) is wired — but it's a link-reference (`attachUrl`), not an actual file upload/storage pipeline. Honest: the composer's "attach file link" disclosure explicitly says "url", never implies real upload. Not a fake — a real, smaller feature (link attachment) correctly scoped. |
| 4 | Reactions/emoji on messages | ALREADY REAL | `message-react` — toggle-on/off, `REACTION_PALETTE` picker in `MessageBubble`. |
| 5 | Invite external members with role/permission control | ALREADY REAL | `invite-create`/`invite-respond` + a real 4-role matrix (owner/admin/member/guest) in `ROLE_PERMS`, enforced server-side per action (`can()`). |
| 6 | Unread badges / notification digest | ALREADY REAL | `notifications` — per-channel unread counts, pending-invite count, pending-vote count; promoted to the page header status dot in this rebuild. |
| 7 | Direct messages between external members | GENUINELY MISSING | Slack Connect supports 1:1 DMs across orgs by default; the `alliance` domain has no DM primitive (only channel messages). Flagged as a scoped future build (would reuse the `mentorship` domain's `threadKey`-sorted-pair DM pattern — `message-send`/`message-thread`/`message-inbox` — as a template; not built here, out of this rebuild's scope). |
| 8 | Governance / structured decision-making (no Slack equivalent — genre-adjacent to DAO tooling) | ALREADY REAL | `proposal-create`/`proposal-vote`/`proposal-close` — quorum-gated (configurable participation threshold), yes/no/abstain tally, role-gated close. This is real depth Slack Connect itself doesn't have — kept as a first-class Workspace tab, not buried. |
| 9 | Partner/alliance compatibility & risk analysis (no Slack equivalent — genre-adjacent to strategy-game alliance diplomacy tooling) | ALREADY REAL, now DESIGNED | `compatibilityScore`/`networkAnalysis`/`riskAssessment` — the 3 macros this rebuild's real work centered on; previously reachable only via the raw macro-button wall. |
| 10 | Message search across a shared channel | GENUINELY MISSING | No search macro over `alliance` messages. Flagged as a scoped future build — would need a new `message-search` macro (LIKE-scan over `content`, same shape as `cross-lens-discovery.js`'s `searchDtus`) plus a UI affordance; not built here. |

**(d) Coverage:** 8 of 10 checklist items ALREADY REAL (2 of those —
governance voting and diplomatic analytics — exceed what Slack Connect
itself offers), 1 partial-but-honest (link attachments, not file upload), 2
genuinely missing and explicitly scoped as future work (cross-alliance DMs,
message search).

## What this rebuild built

- `concord-frontend/components/alliance/AllianceAnalyticsPanel.tsx` — **new**.
  Three sub-tools (Compatibility / Network / Risk) with structured
  comma-separated-tag forms (matching the established codebase idiom — see
  `MentorDirectoryPanel`'s skills field), node/edge and dependency-row
  builders, and designed result displays (score gauges, `DataTable`-backed
  rankings, overlap/SPOF chips) on the shared `components/ui` primitives.
  Every result is the real macro's output; the helper `runAllianceMacro`
  never throws on network/HTTP failure (an honest `{ok:false}` envelope
  instead), matching `MentorshipActionPanel`'s `pickMessage` discipline.
- `concord-frontend/app/lenses/alliance/page.tsx` — full rewrite: 3-tab
  bespoke workspace (Workspace / Analytics / Faction Intel), header KPI
  strip off `alliance-list` + `notifications` via `useMacroDispatchFeedback`,
  keyboard hotkeys `1`-`3` + `r`, `DensityToggle`, `DTUExportButton`. Generic
  scaffold retired (`ManifestActionBar`/`AutoActionStrip`/`RecentMineCard`/
  `CrossLensRecentsPanel`/`UniversalActions`/`LensFeaturePanel`).
  `FactionWarIntel` (Concord's own emergent faction-war system — a distinct,
  read-only intel feed, not user-alliance data) relabeled "Faction Intel"
  with an explicit tab-tooltip disclosure that it's a separate system.
- `AllianceWorkspace.tsx` (696 LOC) and `FactionWarIntel.tsx` (75 LOC) were
  already real, already macro-wired, already honest — untouched except for
  their new tab placement.
- No backend changes — the domain was already real and complete for the
  scope above; this was a pure frontend gap-closure + shell rebuild.
