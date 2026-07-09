# Frontend Rebuild Program — "Lenses Become Real Apps"

> **🟢 STATUS (2026-07-09): APPROVED — Phase 0 in progress.** This is the
> live arc for the frontend. Owner-approved plan (audit + web research
> completed 2026-07-09). Sections below are the program spec; a per-phase
> status ledger is appended at the bottom as work ships.

## Context

The owner's diagnosis, AUDITED AND CONFIRMED with code evidence (2026-07-09):
the backend (9,623 macros / 478 domains / real data, tested to a 0.688 honest
depth floor) far outpaced the frontend. The lenses are "lightweight surfaces":

- **164 of 260 lens pages (63%) are the identical generated scaffold**
  (ManifestActionBar + AutoActionStrip + RecentMineCard template) — one
  template with different macro names, surfacing backend depth as walls of
  auto-generated buttons instead of designed product UIs.
- **The quality gauge is saturated and blind**: `scripts/grade-ux-polish.mjs`
  grades ALL 260 lenses "polished" because the codemod inserted the structural
  signals it checks. Owner-observed reality (fake data, dead panels,
  fabricated successes — 10+ instances fixed this week alone) is invisible
  to it. Grader measures scaffold presence, not product quality.
- **Wiring is real, design is not** (measured across ALL 244 lens/domain
  pairs, 7,843 macros): median lens string-references 87% of its domain's
  macros — but largely through generic action arrays/button strips, which
  counts as "referenced" without being a designed feature. The problem is not
  unplumbed macros; it's that almost nothing is DESIGNED around them.
  Plus a genuinely dark tail: 6 lenses reference 0 of their domain's macros
  by name (fishing, garage, detective, lattice, achievements, announcements);
  courtship 8%, quests 25%, housing 30%, careers 38% (some are world-
  integrated by design — the per-lens capability audit separates
  "world-owned" from "dark"). So: rebuild the UI layer around the full
  capability surface; do NOT rewrite the wiring/macro layer — it works.

Mission: rebuild every lens as a real, high-density, domain-identity
application over the existing substrate — the frontend finally matching the
backend. Vibe-coded apps with 1% of Concord's depth currently out-feel it;
that inversion ends here.

User-locked: flagships = **Finance + News/Intelligence + Concordia**;
local-node bridge in scope, later phase.

## Architecture verdict (audited + researched — this part is settled)

- **ONE Next.js app.** Next.js App Router already code-splits all lenses
  (lens-registry is metadata-only; panel-registry enforces lazy thunks; 75
  files use next/dynamic; three.js never at shell level). Module federation is
  dead for App Router (nextjs-mf end-of-life —
  https://github.com/module-federation/core/issues/3153); Vercel multi-zones
  force hard page reloads between zones and their own guidance says pages
  visited together belong in one app (https://vercel.com/docs/microfrontends,
  https://nextjs.org/docs/app/guides/multi-zones). 260 separate apps has no
  industry precedent; packages/runtime-modules in one app is the pattern.
  Isolation = the lazy-thunk runtime-module pattern, generalized.
- **The real shared-perf layer is the shell**: ~25 always-mounted static
  components in components/shell/AppShell.tsx (31 static imports, zero
  dynamic()) + Providers.tsx extras (SoundSystem, AdaptiveComplexity,
  HiddenAssistance, SecretsDiscovery, GlobalMediaController) + 5 always-on
  pollers (Topbar ×3, SystemStatus 30s, ConnectionStatus 15s). Fixing this is
  an enabler for "instant" feel, not the headline.

## The Program

### Phase 0 — Honest measurement + shell diet (enabler, ~fast)
1. **Make the grader honest first** (CLAUDE.md §4 discipline: bidirectional
   fix + pinning tests, human-authorized): add `--honest` mode to
   grade-ux-polish.mjs that detects the generic-scaffold pattern (template
   trio present + low bespoke-component ratio + raw macro-button walls) and
   caps those lenses below "polished." Expected result: ~63% of lenses drop
   tiers — that number becomes the program's progress metric, wave over wave.
2. New **fake-data detector** (hardcoded arrays rendered as live data,
   Math.random in render paths, placeholder strings) in the detector suite —
   feeds rebuild backlogs; ratchets so rebuilt lenses can't regress.
3. Shell diet: dynamic-import/gate the always-mounted extras (CommandPalette
   on first Cmd+K; Onboarding/FirstWin gated on state; SessionSidebar on chat
   context; NowPlayingBar on playback; SoundSystem/AdaptiveComplexity/
   HiddenAssistance/SecretsDiscovery lazy or scoped to consumers);
   consolidate the 5 shell pollers onto useClientConfig cadences.
   Bundle-analyzer before/after recorded in audit/.

### Phase 1 — Platform primitives (what every rebuilt lens stands on)
1. **Design system, for real**: lib/design-system.ts is 150 lines and
   components/ui/ is EMPTY — this gap is genuine. Build the token set
   (type scale w/ JetBrains Mono hierarchy, spacing, density variables) +
   ui primitives: DataTable, StatTile, Skeleton, EmptyState, ErrorState,
   StatusDot, DensityToggle (Low/Med/High first-class). Written to be
   high-density-first (terminal-grade, not SaaS-minimal).
2. **Formal lens contract**: extend lens-registry entries with permissions,
   supportedSchemas (DTU kinds ingestible), macros, version — validated
   against verify-lens-backends.mjs output (derived, not asserted).
3. **DTU Clipboard / Workspace Bus**: generalize the proven PipingProvider
   (usePipe — already in 80 files) into a shell-level bus: DTU-native
   payloads w/ citation metadata, history + preview (reuse DTUEmbed/
   CitePicker), Cmd+Shift+V picker, drag-drop between lenses, per-lens
   polymorphic ingestDTU declared in the contract.
4. **Perceived-perf kit**: skeletons in ui/, macro-dispatch feedback hook on
   the existing macro:started/completed lifecycle, per-lens scroll/panel
   state persistence (localStorage).
5. **docs/UI_QUALITY_RUBRIC.md** — the checkable premium bar (density,
   micro-interactions, domain identity, perceived perf, craft) that the
   honest grader + rebuild gates enforce.

### The per-lens rebuild loop (used by Phases 2 + 3)
Every rebuild unit runs this gate sequence — step 1 is mandatory and is what
makes each lens a REAL app instead of a re-skinned template:
1. **Capability audit (full-depth enumeration)**: enumerate the domain's
   ENTIRE backend surface before designing anything — all registered macros
   (grep server/domains/<domain>.js + server.js inline registrations +
   registerLensAction), REST routes, realtime events it can subscribe to,
   panel-registry panels it can cross-mount, lens-manifest/lens-features
   entries, and connector/webhook feeds. Output: a capability map committed
   with the rebuild (derived-not-asserted). CRITICAL DISTINCTION the map
   must make (from the 244-pair audit): "referenced in a generic action
   array" ≠ "designed feature." Each macro gets classified: designed /
   generic-strip-only / unsurfaced / world-owned (lenses like fishing whose
   features correctly live in the world lens). The rebuild's coverage
   metric counts DESIGNED only — the map is the app's feature spec.
2. Research best-in-class references for the domain (real products, not
   generic dashboards).
3. Design the app around the FULL capability map: bespoke layout + panels on
   the ui primitives, domain identity, information density — macro depth
   surfaced deliberately (grouped workflows, inspector panels, keyboard
   commands), never as auto-generated button walls.
4. Implement — real data only ("no air"): every element traces to a macro/
   DTU/route; honest empty/connect states where substrate is missing.
5. Micro-interaction pass (mandatory, 3-5+ real interactions: macro feedback,
   DTU drag/cite, transitions, satisfying state changes).
6. Polish pass (typography, spacing, loading/empty/error states, a11y,
   density toggle).
7. Verify: rubric gates + honest grader + eslint/tsc/vitest + lens stays
   WIRED in verify-lens-backends.

### Execution model — autonomous orchestra
- **Orchestrator** (this session's model) owns backlogs, wave dispatch,
  review, verification, and commits — nothing merges on agent say-so alone
  (this week's lesson: agents stop early and over-report; every unit is
  independently re-verified before commit).
- **Sonnet agents** run standard rebuild units in parallel (disjoint-file
  batches, capability-audit prompt template with the honesty rules inline).
- **Opus escalation** for hard problems: the deep/complex lenses (code,
  world/Concordia, studio-class), architectural decisions, units a Sonnet
  agent fails twice, and grader/rubric changes (which also need human
  authorization per the guard).
- Salvage discipline, named-file staging, one-heavy-process-at-a-time, and
  guard protection all apply as in docs/DEPTH_FLEET_PLAN.md.

### Phase 2 — Flagship rebuilds (the design language, proven on 3)
Full rebuild per lens through the loop above (orchestrator-led, Opus-tier
attention — these set the reference patterns):
1. **Finance** — Bloomberg/terminal identity: dense dark monospace grids,
   real market data, price-event→DTU flow. Retires its generic strips.
2. **News/Intelligence** — research-tool identity: live feed (useRealtimeLens/
   RealtimeDataPanel exist), pull→DTU→remix with one-click cite + automatic
   source/timestamp metadata, citation-chain view, honest "Connect Sources"
   state where no connector is wired.
3. **Concordia** — immersive sim identity: entry/loading polish, HUD
   coherence, quality presets surfaced.
These three define the per-domain identity patterns (terminal / research /
immersive) the waves reuse.

### Phase 3 — The rebuild waves (all remaining ~257 lenses)
The autonomous orchestra (above) runs the per-lens rebuild loop at fleet
scale — the unit of work is "rebuild this lens as a real app," never "patch
the template":
- Backlog script ranks lenses by honest-grader tier × domain backend depth
  (macro count from the capability audit) × destination traffic. Grouped by
  destination (Finance-family, Create-family, World-family...) so waves
  share domain identity + components.
- Sonnet agents execute; Opus takes the escalations; orchestrator verifies
  and commits every unit. Each rebuilt lens: capability map committed,
  generic template retired, fake data killed (wired real or honest-removed),
  dead UI removed, micro-interactions + panels + state persistence +
  skeletons in, rubric gates passed.
- Progress metric: honest-grader tier distribution per wave + fake-data
  detector count → 0 + capability-coverage (% of domain macros surfaced by
  design decision, not accident). Doc'd each wave (derived numbers only).

### Phase 4 — Later-phase platform items
1. **Local-node ↔ cloud bridge**: dispatch client in lib/api/client.ts w/
   local-node health probe + opt-in routing; node indicator in SystemStatus.
2. Workspaces v2 (user-defined lens desktops) — extends destinations.
3. create-concord-lens scaffold emitting contract-compliant, rubric-passing
   lenses (so new lenses are born real apps, not scaffold).

## Explicitly rejected (audited/researched reasons)
- Turborepo 260-app split, module federation (dead on App Router),
  multi-zones for lenses (hard-nav breaks the OS feel + DTU clipboard).
- Blanket ssr:false (three.js already surgically isolated).
- Redis-backed UI state (localStorage suffices).
- Rewriting the macro/wiring layer — it's the part that verifiably works.

## Verification
- Phase 0: honest-grader pinning tests (catches scaffold, still passes a
  genuinely bespoke lens); bundle-analyzer deltas in audit/; AppShell vitest.
- Phase 1: unit tests for WorkspaceBus, contract validator, ui primitives.
- Phase 2: per-flagship gate checklist + live browser pass + npm run test:run.
- Phase 3: per-wave honest-tier distribution + detector ratchet + 256-WIRED.
- Program-wide: npm run check-doc-claims after doc updates; detector suite
  stays green (node scripts/run-detectors.js --diff --ci).

---

## Status ledger (append-only, newest first)

| Date | Phase | What shipped | Commit |
|---|---|---|---|
| 2026-07-09 | — | Program approved; audit evidence + plan committed as this doc | (this commit) |
