# Goals Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("goals"' server/domains/goals.js
```
→ **10** macros in `server/domains/goals.js` (1,184 lines): `okrScoring`,
`goalDecomposition`, `progressForecast`, `alignmentTree`, `checkin`,
`teamGoal`, `templates`, `progressChart`, `reminder`, `dependencies`.

`node scripts/lens-unsurfaced.mjs --lens goals` → `0/10 macros never
referenced in the frontend` — but per the assignment's warning, this is
necessary, not sufficient: it only proves a macro name string appears
somewhere in the frontend tree, not that the call site can ever produce a
non-trivial result. Three of the ten (`okrScoring`, `goalDecomposition`,
`progressForecast`) were referenced through a call path that could never
succeed (see below).

**A second, disjoint macro cluster shares the `"goals"` domain string** —
confirmed by:
```
grep -n 'register("goals"' server/server.js
```
→ **12** macros registered inline (not via `registerLensAction`, and not in
`server/domains/goals.js` at all): `status`, `propose`, `evaluate`,
`approve`, `activate`, `progress`, `complete`, `abandon`, `list`, `get`,
`auto_propose`, `config` (server.js:12475-12760+, under a `// ===== GOAL
SYSTEM MACROS =====` header comment). This is a completely different
subsystem — Concord's own **self-directed agent goal governance loop**:
propose → evaluate (feasibility/alignment/value scoring against hard safety
invariants: `NO_NEGATIVE_VALENCE`, `NO_SELF_PRESERVATION`, `NO_HARM_
OBJECTIVES`, `FOUNDER_CONSENT_REQUIRED`, `BOUNDED_SCOPE`, `KNOWLEDGE_
ALIGNED`) → founder-approve (for high-priority/user-requested goals) →
activate → progress/complete/abandon, driven autonomously every governor
tick by `processGoalHeartbeat` (`server.js:34167`, confirmed wired: `grep -n
processGoalHeartbeat server/server.js` shows both the definition and the
governor-tick call site). Exposed via REST at `/api/goals*`
(`server/routes/domain.js:446-496`, 12 routes, one per macro) and via a
frontend client wrapper `apiHelpers.goals` (`concord-frontend/lib/api/
client.ts`). **Before this pass, every one of these 12 macros was
completely dark**: `grep -rn "api\.goals\." concord-frontend/ --include=
*.tsx --include=*.ts` (excluding the client.ts definition itself) returned
zero call sites. This is exactly the "macro cluster registered inline in
server.js, invisible to `lens-unsurfaced.mjs` because it only scans one
`server/domains/*.js` file" pattern called out in the assignment brief.

`grep -n 'registerLensAction("goals"' server/server.js` → empty (no
duplicate/legacy registrations outside the domain file for the
`registerLensAction`-style macros).

## Reference apps

- **OKR / goal-management software**: Lattice, Perdoo, Gtmhub/Quantive —
  alignment trees linking company→team→individual objectives, cadence
  check-ins with confidence ratings, dependency/blocker tracking, and
  scoring dashboards. The 10 `domains/goals.js` macros map onto this
  category closely (weighted confidence-adjusted KR scoring, critical-path
  decomposition, linear-regression forecasting, alignment tree, check-ins,
  team goals, templates+recurring, reminders, dependencies).
- **Gamified personal goal tracking**: Habitica — self-declared goals/
  habits/challenges with XP, levels, streaks, and badges. The "Goals" /
  "Challenges" / "Milestones" tabs target this category.
- **Agent self-governance**: no direct commercial analog (this is Concord's
  own verification-is-the-product framing) — the closest conceptual
  reference is an approval/audit-log UI for an autonomous system (e.g. a
  CI/CD deployment-approval gate), which is how `AgentAutonomyPanel` is
  designed: propose → evaluate → founder-approve, with a visible audit trail
  and safety-invariant badges.

Parity target: "the OKR analytics should be genuinely usable against a
Lattice/Perdoo checklist, the personal side should feel like a lightweight
Habitica, and the agent-goal system should be the only place in the app you
can watch Concord decide what to work on next and approve or reject it."

## Classification (before this pass)

**Mixed** — real, substantial backend, several genuinely broken/dead
call sites, one fully unsurfaced 12-macro cluster, and one confirmed
feature-breaking bug in "New Goal" creation.

1. **`components/goals/OKRWorkspace.tsx` (965 lines) — real, working.**
   Covers 7 of the 10 domain macros correctly (`alignmentTree`, `checkin`,
   `teamGoal`, `templates`, `progressChart`, `reminder`, `dependencies`),
   each with a proper per-macro form and real `lensRun('goals', ...)` calls.
   No changes made.

2. **Critical bug — "New Goal" silently created goals nobody could ever
   see.** `createGoalMutation` (old `app/lenses/goals/page.tsx:283-306`) ran
   `apiHelpers.goals.create(...)` (POST `/api/goals` → the agent system's
   `propose` macro) in a `try`, with `createGoalItem(...)` (the actual
   generic-artifact "goal" the visible Goals tab reads) only in the `catch`
   fallback. Since the agent-goal-system route works fine in any real
   deployment, the `try` always succeeded and the fallback that actually
   populates the visible list **never ran**. Every goal the user "created"
   became an invisible `PROPOSED` row in the completely separate agent
   governance system (with `type: "exploration"`, no category/subtasks/xp —
   fields the personal-goal UI model doesn't even have), while the "Goals"
   tab itself stayed empty. Confirmed by reading the two backend macros:
   `createGoalProposal` (server.js:64332) builds a `GOAL_STATES.PROPOSED`
   row keyed on `title/description/type/priority`, with no relationship to
   `useLensData('goals', 'goal', ...)`'s artifact store at all. **Fixed:**
   `createGoalMutation` now calls `createGoalItem` directly — no more
   misdirected try/catch. The agent system gets its own, correctly-labeled
   propose flow in the new `AgentAutonomyPanel`.

3. **Dead panel — "Goals Analytics Actions" (`okrScoring`/
   `goalDecomposition`/`progressForecast`).** The old panel
   (`page.tsx:1015-1200`, well-designed result rendering) ran these three
   macros via `useRunArtifact('goals').mutate({ id: goalItems[0]?.id,
   action, params: {} })` — i.e. against the **first personal "goal"
   artifact's `.data`**, which is `{title, description, category, progress,
   priority, targetDate, subtasks, xp, milestones, status}`. But
   `okrScoring` reads `artifact.data.objectives`, `goalDecomposition` reads
   `artifact.data.goals`, and `progressForecast` reads `artifact.data.
   history` — none of which the personal-goal artifact ever has. Every
   click was real (the macro genuinely ran), but returned `"No objectives
   provided."` / `"No goals provided."` / `"Need at least 2 historical data
   points for forecasting."` **forever**, regardless of what the user did in
   the Goals tab. Confirmed by reading `server/domains/goals.js:16-18`
   (`const objectives = artifact.data?.objectives || [];`), `:165`
   (`const goals = artifact.data?.goals || [];`), `:383`
   (`const history = artifact.data?.history || [];`). **Fixed:** replaced
   with `components/goals/GoalsAnalyticsTools.tsx` — three real ad-hoc
   calculator tools with dedicated input forms, calling `lensRun('goals',
   action, properlyShapedInput)` directly. `POST /api/lens/run` builds a
   **virtual** artifact whose `.data` **is** the input body (confirmed at
   `server.js:39566`: `const virtualArtifact = { id: null, domain, type:
   "domain_action", data: rest, meta: {} };`), so this needs no persisted
   artifact at all. The Forecast tool additionally pulls its `history` from
   real, already-persisted `checkin` data (op:'list', filtered by the
   user-entered `goalId`) instead of asking the user to retype numbers that
   already exist in the Check-ins tab.

4. **Dead tabs — Milestones and Achievements.** Both were separate
   generic-artifact types (`useLensData('goals', 'milestone', ...)` /
   `('goals', 'achievement', ...)`) with **zero backing macro** (no
   `domains/goals.js` handler and no heartbeat ever writes a `milestone` or
   `achievement` artifact) and **zero creation UI anywhere on the page** —
   confirmed by reading the full pre-rebuild file: only the "goal" type has
   a create form (`showCreate` + `createGoalItem`); `challengeItems` had
   only `update` destructured (no create); `milestoneItems`/
   `achievementItems` had no create at all. These tabs were permanently
   `"0 of 0"`, forever, in any real deployment. The category residue also
   gave it away as copy-paste leftover: `Achievement.category` was typed
   `'Production' | 'Social' | 'Sales' | 'Learning'` and `Goal.category` was
   `'Production' | 'Mixing' | 'Release' | 'Learning' | 'Collaboration'` —
   music-lens category names on a general-purpose goals lens. **Fixed:**
   Achievements tab removed outright. Milestones tab repurposed into a real
   completed-goal timeline (sorted by the goal artifact's own `updatedAt`)
   plus a small set of **deterministic badges** — each `unlocked: boolean`
   is a pure function of real counts already computed on the page
   (`goals.length`, `completedGoals.length`, category diversity, the real
   streak, `acceptedChallengeCount`) — never a fabricated unlock date or
   server-invented rarity tier.

5. **Structural bug — the real-time data panel only rendered on the
   Achievements tab.** The old JSX nested `{realtimeData && <RealtimeDataPanel
   .../>}` **inside** the `{activeTab === 'achievements' && (<div>...
   </div>)}` block (old `page.tsx:1082-1092`, closed by the achievements
   tab's own closing `</div>)}` two lines later) — so the live realtime
   panel only ever appeared while viewing the (permanently-empty)
   Achievements tab. **Fixed:** moved out to render unconditionally,
   regardless of active tab.

6. **Miswired header button — "Auto-Propose."** Called
   `apiHelpers.goals.autoPropose()` (the agent system's
   `generateAutoGoalProposals`, an entirely different feature from the
   user's personal goals) and invalidated query key `['goals']`, which
   matches nothing (`useLensData` keys are `['lens', 'goals', 'list', ...]`)
   — so even on success, nothing in the UI changed and no result was ever
   shown. **Fixed:** removed from the header; a correctly-labeled, result-
   displaying version ("Run autonomous proposal pass") now lives in
   `AgentAutonomyPanel`, the system it actually belongs to.

7. **Challenges tab had no creation path** (only `update`, no `create`
   destructured from `useLensData`) — same permanently-empty-forever defect
   as Milestones/Achievements, just without the category-name tell. **Fixed:**
   added a real creation form + a "Log progress" action (increments
   `progress` up to `target` via the existing `update` mutation), so
   Challenges is now a genuine self-declared streak/habit tracker.

## What changed

- **`concord-frontend/components/goals/AgentAutonomyPanel.tsx` (new)** —
  surfaces all 12 previously-dark agent-goal-governance macros: safety-
  invariant badges (real values from `status.invariants`), stats strip,
  config summary (respects the backend's own `readonly` flag for non-
  admin roles), state-filtered goal list with expand-to-detail (fetches
  full `evaluation`/`meta`/`deps` via `get` on demand, not eagerly for
  every row), and state-appropriate actions (Evaluate/Approve (founder)/
  Activate/+1 progress/Complete/Abandon) that surface the backend's own
  honest rejection messages (e.g. "Founder approval requires owner/admin
  role") rather than swallowing them. Manual propose form + a
  correctly-labeled, result-displaying "run autonomous proposal pass"
  button.
- **`concord-frontend/components/goals/GoalsAnalyticsTools.tsx` (new)** —
  three real ad-hoc calculators (OKR Scorecard, Decomposition Planner,
  Progress Forecast) with dedicated input forms, replacing the dead
  artifact-bound action panel. Reuses the original page's result-rendering
  design.
- **`concord-frontend/app/lenses/goals/page.tsx`** — fixed the goal-creation
  bug (item 2), removed the dead analytics panel and miswired auto-propose
  button, removed the Achievements tab and repurposed Milestones into a
  real derived timeline + deterministic badges (items 3-6), added a
  Challenges creation form + progress logging (item 7), fixed the
  realtime-panel tab-scoping bug (item 5), generalized `Goal.category` /
  `Challenge` fields off music-lens leftovers (Career/Health/Learning/
  Creative/Financial/Personal), added a real "Mark Complete" action (goals
  could previously never transition out of `status: 'active'` — the
  Completed filter, `completedThisMonth`, and `totalXp` stats were
  structurally dead), and replaced the hardcoded `const streakDays = 0`
  with a real streak computed from completion dates.
- **`concord-frontend/lib/api/client.ts`** — added `evaluate`/`approve`
  methods to `apiHelpers.goals` (routes existed server-side; the client
  wrapper was missing them) and widened `list`/`create`/`abandon`/`config`
  to accept the params the REST routes actually take.

## Left alone, with reason

- **The 7 already-working `OKRWorkspace` macros** (`alignmentTree`,
  `checkin`, `teamGoal`, `templates`, `progressChart`, `reminder`,
  `dependencies`) — no defect found; real forms, real `lensRun` calls, real
  empty states.
- **`components/goals/ProductivityFeed.tsx`** — a real Reddit API pull
  (r/getdisciplined etc.), honestly labeled, no fabrication.
- **The agent system's heartbeat-driven "simplified: random small
  progress"** (`processGoalHeartbeat`, server.js:64752-64764, comment:
  "Simulate progress based on goal type... In practice, this would hook
  into actual DTU creation/analysis events") — this is the *backend's own*
  honestly-labeled simplification for how an autonomously-activated agent
  goal nudges its progress between ticks (not user-facing fabricated data,
  and not something a frontend rebuild can fix without touching the
  `runMacro`/heartbeat wiring layer, which is out of scope per the
  program's "never rewrite the wiring layer" rule). Flagged here for
  visibility, not silently accepted as fine — a future backend pass could
  wire real per-goal-type progress signals (e.g. DTU count deltas for
  `knowledge_synthesis`, contradiction-load deltas for `clarification`)
  instead of `Math.random()`-driven nudges.
