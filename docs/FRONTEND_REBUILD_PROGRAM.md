# Frontend Rebuild Program — "Lenses Become Real Apps"

> **🟢 WAVE 2 COMPLETE (2026-07-09): all 55 confirmed-scaffold lenses
> rebuilt across all 11 archetypes. `node scripts/grade-ux-polish.mjs
> --honest` now reports 260/260 lenses at `tier: "polished"`, 0
> `isGenericScaffold`, weighted score 1.0 — fleet-wide, not just the
> targeted 55.** `verify-lens-backends.mjs` holds at 258 WIRED / 2
> by-design NO-BACKEND-CALL (0 broken), full project `tsc --noEmit` 0
> errors.

> **🟢 WAVE 3 SCOPE (owner directive, 2026-07-09): full per-lens rebuild
> loop on every one of the remaining 191 lenses — not a triage-and-fix-
> only-confirmed-gaps pass.** `scripts/lens-rebuild-backlog.mjs` (built
> the same day) still orders the sweep by unsurfaced-macro depth ×
> destination-traffic weight, since that ranking is real signal for
> *where to start*, but it no longer gates *whether* a lens gets worked —
> every remaining lens gets the same step-1/1.5/2-7 loop Wave 2 used
> (capability audit, reference-parity checklist against a real
> best-in-class app, real design + implementation, verify gate), with the
> honest caveat that a lens whose audit finds nothing wrong gets a short,
> honestly-say-so artifact rather than an invented diff — the "no
> busywork" principle stays; the "don't have to look" scoping doesn't.
> The 2 by-design `NO-BACKEND-CALL` lenses (`narrative-walk`, `ux-suite`)
> are the only ones exempted, per their own documented header rationale.
> See the phase-by-phase history below for what Waves 0-2 actually found
> and fixed.

> **🟢 STATUS (2026-07-09): Phases 0-2 shipped, Phase 3 Wave 1 6/10 shipped,
> Wave-1 test regressions fixed, Phase 0.5 (connection stability) shipped,
> Wave 0 (a/b/c) shipped.** The bar was raised the same day (see
> "Full-App-Parity amendment" below) — every lens from Wave 0 onward must
> also close a researched feature-parity checklist against a real
> best-in-class reference app, not just pass the structural rebuild loop.
> Wave 0a (music, the flagship proof unit — all 7 gaps closed), 0b
> (courtship finish-the-wire), and 0c (lfg/photos/quests verify-pass, found
> + fixed real gaps in photos and quests) are all shipped and independently
> re-verified — full frontend (551/551 files, 4,721/4,721 tests) + backend
> (26,779/26,779 tests, after fixing an unrelated seed-manifest count/hash
> drift found by the sweep) suite swept clean. **Wave 2 batches 1-4 shipped
> (26/55 scaffold lenses): Marketplace/economy, Research/reference, Social/
> relationship, Creative/design-tool, Maps/navigation, Health/life-sim,
> Reflection/knowledge-curation, Space/lab science — all 8 smallest
> archetypes complete.** Two container restarts (mid-batch-3, then again
> mid-batch-4) were both recovered cleanly — working tree + all commits
> survived each time; every in-flight lens rebuild was individually
> re-verified against the live backend before trusting/committing it (see
> the ledger). **A companion shared-component honesty fix** landed
> alongside batch 4: `ManifestActionBar`/`UniversalActions` (mounted on
> every not-yet-rebuilt lens) no longer claim success on a blind
> no-parameter macro call or render permanently-disabled buttons with no
> explanation — closing the gap where the wiring verifier's "the macro
> gets called" check was passing while the actual click produced nothing
> a user could trust, on ~150 lenses still waiting for their real rebuild.
> **Wave 2 batch 5 shipped (35/55 scaffold lenses): Earth/environmental &
> public-safety science, all 9 lenses complete** — geology, ocean,
> forestry, energy, mining, desert, urban-planning, defense,
> emergency-services. Every one of the 9 carried the same defect shape:
> real, deep bespoke components (often 20-30+ real macros already
> surfaced) sitting behind a disconnected generic-CRUD tab layer with
> fabricated stats — a hardcoded `'4.2m'` average-response-time string in
> `emergency-services`, a meaningless "Security Score" in `defense`, an
> always-identical geologic time-scale table in `geology`, species counts
> computed as `Math.floor(x*n) || <fallback>` in `ocean`. One sub-agent
> run got confused and produced no work at all (reported "waiting for
> other agents" without touching its assigned files) — caught by checking
> `git status` before trusting the completion signal, and re-dispatched
> successfully. **Wave 2 batch 6 shipped (44/55 scaffold lenses): Dev-tool/
> sim-console, all 9 lenses complete** — robotics, ml, offline, quantum,
> fractal, neuro, metalearning, anon, fork. This batch skewed more subtle
> than prior ones: robotics/ml/offline were already fully real (only the
> dead generic-scaffold body needed removing), while quantum was already
> complete against its IBM-Quantum-Composer parity target with nothing to
> fix. The real defects that did exist were narrower — `metalearning`'s
> frontend read `type`/`successRate` fields the backend doesn't return
> (silently blanking every strategy badge), `fractal`/`neuro` each had
> exactly 1-3 backend macros with zero UI hiding behind an otherwise-solid
> page, and `fork`'s one broken panel produced a fabricated-looking "87 ·
> healthy" fork-health score from missing-field defaults. **`PR #853` is
> open**, tracking all of this work against `main`. Remaining: 11 lenses
> in Docs/B2B SaaS, then Wave 3's ~192-lens risk pool. This is the live
> arc for the frontend. Sections below are the program spec; a per-phase
> status ledger is appended at the bottom as work ships.

## Full-App-Parity amendment (2026-07-09)

The owner escalated the standard mid-program: "no more lightweight surfaces,
no more demo — the UI and UX needs to catch up to the capabilities of the
backend." Worked example given: **the music lens vs. Apple Music — the only
difference should be catalog size, nothing else.** Three read-only audits
plus a synthesis pass grounded this into a concrete extension of the
existing per-lens rebuild loop (not a restart) — see the new step 1.5 below,
the extended verify gate, and the Wave 0/2/3 sequencing under Phase 3. A
connection-stability complaint was root-caused and fixed in the same pass
(Phase 0.5, below) — a config gap (no `.env.local` guidance, defaulting the
dev socket to a dead same-origin connection), not a systemic architecture
problem.

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

### Phase 0.5 — Connection stability (shipped 2026-07-09, commit `bf5c2345`)
Root-caused an owner-reported "constant lag and connection disruptions"
complaint: `concord-frontend/lib/realtime/socket.ts`'s `SOCKET_URL` fell back
to `''` when both `NEXT_PUBLIC_SOCKET_URL`/`NEXT_PUBLIC_API_URL` were unset —
the socket then tried same-origin (nothing listening there), retried 5× over
~17s, and left a persistent "Connection lost" banner up. The repo ships no
`.env.local` and the README quickstart never said to create one from
`.env.example`. Fixed:
1. Dev-only default of the socket URL to the backend's known `:5050` port
   (mirrors `next.config.js`'s own `BACKEND_URL || 'http://127.0.0.1:5050'`
   convention); production keeps the empty fallback (same-origin + nginx
   proxy is the correct, unchanged prod topology).
2. A distinct `reconnect_failed` diagnostic for "was never configured" vs. a
   genuine transient outage.
3. Prod socket.io `transports` audited — found to be WebSocket-only by
   **deliberate, already-documented design** (long-polling at 1000+ clients
   floods the server), not an oversight, so the default was kept; a
   `CONCORD_SOCKET_ALLOW_POLLING_FALLBACK` env var was added instead so a
   deployment can opt into graceful degradation without changing the safe
   default for everyone.
4. README documents the `.env.local` step and that the frontend container
   must sit behind nginx for realtime (Next.js `standalone` mode doesn't
   forward WS `Upgrade` headers through its own `rewrites()` — a real,
   still-open Next.js limitation the shipped docker-compose topology already
   avoids by routing `/socket.io/` through nginx directly).

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
1.5. **Reference-parity checklist (added 2026-07-09, mandatory from Wave 0
   onward)** — generalizes the music-lens/Apple-Music case study. Do this in
   the same research pass as step 2, not twice:
   - **(a)** Name 1-2 real best-in-class reference apps for the domain's
     category (Apple Music for `music`; the nearest real analog for every
     other archetype — e.g. a USGS/NOAA-grade tool for Earth-science lenses,
     a Linear/Notion-class tool for Docs/B2B lenses).
   - **(b)** State the parity target explicitly in the capability-map
     artifact, in the owner's own framing: "the only difference should be
     [scale/catalog/data-source], nothing else."
   - **(c)** Produce a real, researched feature checklist for the reference
     app(s) — not an LLM's memory of the category.
   - **(d)** Classify every checklist item into exactly one bucket:
     **ALREADY REAL** (ship as-is), **BACKEND-CAPABLE-BUT-UNSURFACED**
     (macro/route/param exists, no or incomplete UI caller — wire it, no
     backend work needed), or **GENUINELY MISSING** (no real backend
     capability, or a UI-cosmetic stub over nothing real) — every item in
     this last bucket gets one of two explicit, non-silent dispositions:
     **honest relabel** (rename to what it truthfully does, with a one-line
     why) or **flagged as a scoped future build task** (explicit
     macro(s)/size estimate, deliberately deferred). Never faked.
   - This bucketing is the rebuild's real coverage metric from Wave 0
     onward — "% of the reference checklist closed," replacing the vaguer
     "% of domain macros surfaced by design decision" framing with an
     externally-anchored, truthful number.
2. Research best-in-class references for the domain (real products, not
   generic dashboards) — folds into 1.5(a)/(c) above.
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
7. **Verify (the "undeniable" gate)** — a rebuilt lens is not done until ALL
   of: rubric gates (docs/UI_QUALITY_RUBRIC.md) pass; honest grader
   (`grade-ux-polish.mjs --honest`) scores above the scaffold cap; eslint/
   tsc/vitest clean on touched files; lens stays WIRED in
   `verify-lens-backends.mjs`; **and (added 2026-07-09) every item in the
   step-1.5 checklist has an explicit recorded disposition** — a lens
   cannot be marked done with an unresolved "maybe missing" item; silence on
   a checklist item is a fail, not a pass. Orchestrator independently
   re-verifies all of the above before commit — never trust agent
   self-report alone.

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
- **Continuation note (2026-07-09, Wave 0 onward):** unchanged, continues at
  fleet scale through Wave 2/3 — Sonnet-parallel-dispatch on disjoint-file
  batches (4-5 lenses/batch in Wave 2), Opus escalation on hard problems/
  architectural calls/twice-failed units, orchestrator-owned independent
  re-verification before every commit. No new execution-model machinery —
  this amendment is scoped to backlog content (what gets dispatched) and
  gate content (what "done" means), not to how dispatch/verification works.

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
The autonomous orchestra (above) runs the per-lens rebuild loop (now
including step 1.5) at fleet scale — the unit of work is "rebuild this lens
as a real app," never "patch the template". Concrete sequencing (added
2026-07-09, supersedes the flat "one big backlog" framing this section used
to have):

- **Wave 0a — Music lens gap-closure.** Dispatched first: direct proof of
  the step-1.5 parity rubric on the owner's own worked example. 7 already-
  scoped gaps (generic-strip duplicate, collaborative-playlist checkbox,
  jam-sync wiring, queue play-next/clear/reorder, 3 zero-caller macros,
  device-transfer honest relabel, `music.feed` Browse/New-Releases surface).
- **Wave 0b — Courtship finish-the-wire.** Tiny: wire 2 orphaned WIP files
  (`components/courtship/HeartEventModal.tsx`, `pregnancy-cache.ts`) from
  commit `07e0e660` into the already-real `app/lenses/courtship/page.tsx` —
  not a rebuild.
- **Wave 0c — lfg/photos/quests verify-pass.** 3 cheap parallel spot-checks,
  NOT rebuilds — see the corrected note below; these were mis-filed as an
  incomplete retry backlog when they're real bespoke pages needing
  verification, not reconstruction.
- **Wave 2 — the 55 confirmed-scaffold lenses** (`audit/ux-polish-
  honest.json` @ commit `dc662513`), grouped into 11 archetype buckets by a
  2026-07-09 audit (full lens lists in that audit's findings, reproducible
  via the honest grader + a domain-file skim): Earth/environmental &
  public-safety science (9: geology, ocean, forestry, energy, mining,
  desert, urban-planning, defense, emergency-services), Space/lab science
  (6: astronomy, space, chem, bio, lab, materials), Docs/B2B SaaS (11:
  schema, audit, projects, queue, platform, transfer, export, legacy,
  custom, hr, marketing), Dev-tool/sim-console (9: robotics, quantum, ml,
  fractal, metalearning, neuro, anon, offline, fork), Health/life-sim (4:
  parenting, pets, veterinary, pharmacy), Reflection/knowledge-curation (4:
  philosophy, reflection, grounding, suffering), Maps/navigation (3: atlas,
  ar, travel), Creative/design-tool (3: artistry, fashion, animation),
  Marketplace/economy (2: questmarket, supplychain), Research/reference (2:
  law, history), Social/relationship (2: mentorship, alliance). None are
  world-owned thin bridges — all have real STATE-backed substrate and often
  a real external API. For each archetype: one shared reference-pattern
  pass first (pick the archetype's reference app(s), design ONE shared
  component/pattern set — the same move Phase 2 made for terminal/research/
  immersive identity, generalized), then dispatch lens units in 4-5-lens
  parallel batches, smallest archetype first (validates the methodology
  cheaply before the two largest archetypes — 20 of the 55 lenses — run).
- **Wave 3 — the ~192-lens risk pool.** Lenses that score "polished" under
  the honest grader but may only reach macros via generic action arrays
  (structural polish ≠ real designed depth, per this doc's own Context
  section). Build `scripts/lens-rebuild-backlog.mjs` first (ranks by honest
  tier × macro-depth proxy × `lib/destinations.ts` grouping as a traffic
  proxy — there is no real usage-telemetry source in this repo; don't
  fabricate one) and dispatch fix units only where it confirms a real gap —
  not a blanket rebuild of 192 lenses.
- Sonnet agents execute; Opus takes the escalations; orchestrator verifies
  and commits every unit. Each rebuilt lens: capability map + step-1.5
  checklist committed, generic template retired, fake data killed (wired
  real or honest-removed), dead UI removed, micro-interactions + panels +
  state persistence + skeletons in, full verify gate (step 7) passed.
- Progress metric: honest-grader tier distribution per wave + fake-data
  detector count → 0 + reference-checklist coverage (% of the step-1.5
  checklist closed as ALREADY REAL or wired-from-UNSURFACED — an
  externally-anchored, truthful number, not an internally-defined one).
  Doc'd each wave (derived numbers only).

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
| 2026-07-11 | Wave 3 | resonance rebuilt — the Live view's 4 core data-fetch calls hit the wrong endpoints with incompatible response shapes (boundary scan read `/api/lattice/beacon` instead of `/api/resonance/boundary`, history read `/api/lattice/resonance` instead of `/api/resonance/history`, health meters read a path that doesn't exist in `/api/system/health`, and the Scan button called an unrelated `bridge.beacon` continuity check instead of `resonance.scan`) — the whole centerpiece view was silently rendering defaults/zeros. Added a real `apiHelpers.resonance` namespace, fixed all 4 wirings, added an honest insufficient-density banner for the real `ok:false` case, fixed a fabricated-success envelope bug in the Domain Actions bar | `bdd6281f` |
| 2026-07-10 | Wave 3 batch | **legal + marketplace + message + whiteboard + understanding + reasoning batch closed** — 6 lenses, all independently re-verified after recovering from a shared-worktree infrastructure failure (see above). Confirmed real fixes in every unit, including two genuinely significant bugs: whiteboard's dead real-time collaboration (broadcasts reaching zero listeners) and marketplace's fully-broken checkout (`buyerId:'current'`) | — |
| 2026-07-10 | Wave 3 | reasoning rebuilt — the domain name is shared by 4 separate backend substrates; frontend had field-shape mismatches against 3 of them. Chain Builder's Add Step silently failed on every click (missing required `justification`) and Conclude wrote the literal string `"[object Object]"` as the conclusion (crash risk). ArgumentWorkbench sent free text to macros needing structured input, and its Premises handler called `.map()` on a count field (guaranteed TypeError). Domain Actions Bar's 3 buttons all aliased to the same vacuous generic stub — "Check Fallacies" never ran fallacy detection. Registered 3 new deterministic macros (deepAnalysis/strengthAssessment/counterArgumentGen) to replace an LLM-catch-all masking as AI analysis. Independent verification also found and fixed a `useMemo` exhaustive-deps warning the fix itself introduced | `cbb6210d` + `9e68be49` |
| 2026-07-10 | Wave 3 | marketplace rebuilt — fixed checkout sending literal `buyerId:'current'` (every priced purchase failed balance validation), fixed an identity-mapped item-type→listingType lookup that 404'd beats/stems/samples, fixed "New Listing" posting a payload shape the real `/api/marketplace/submit` route never accepted (routed through the real `listings-create`+`listings-publish` macros instead), added `GET /api/artistry/marketplace/purchases` so purchase history survives reload (new, additive-only route, wraps existing `economy/purchases.js#getUserPurchases`). Refuted the prior investigation's second lead — the "unsurfaced e-commerce macro system" had already been fully wired in an earlier Wave-3 pass | `d10aec08` |
| 2026-07-10 | Wave 3 | legal rebuilt — removed a ~2,900-line fabricated parallel generic-CRUD system (MODE_TABS, backed by `useLensData('legal','artifact')`, zero field-shape overlap with any real macro) sitting beside the already-real, superset-covering ClioSection; wired the newly-unsurfaced `deadlineCalculator` (5-milestone litigation timeline) into CalendarPanel; disambiguated a Docket/Matters naming collision between two intentionally-distinct real backend models | `f0ccbf3d` |
| 2026-07-10 | Wave 3 | message rebuilt — wired unsurfaced `snooze`/`unsnooze` macros (SnoozedList could only ever render empty), built `RecipientSearchInput.tsx` off the already-live `/api/social/users/search` route (closing the hard-invariant-6 raw-userId-textbox gap), fixed silent `.ok` swallowing in MessageWorkbench's react/unreact/unsave-message. Investigated and correctly refuted the prior attempt's labels-domain ID-mismatch hypothesis (labels key is opaque, no referential integrity assumed — not a bug) and correctly left CLAUDE.md's Slack claim alone (it names a different, still-gated external OAuth connector, not the already-real internal SlackSection client) | `744da881` |
| 2026-07-10 | Wave 3 | whiteboard rebuilt — real-time collaboration was cosmetically wired (real macros, real socket infra, real subscription code) but functionally dead: `useWhiteboardCollab.ts` never emitted `room:join`, so every server broadcast to `whiteboard:${boardId}` reached zero listeners. Fixed with a mount-effect join + reconnect re-join + unmount leave, mirroring `useYjsDoc.ts`'s working pattern | `55e9af34` |
| 2026-07-10 | Wave 3 | understanding rebuilt — `NotesWorkbench.tsx#save()` was blocking on the full macro round-trip before reflecting any change; made optimistic (immediate UI update, background reconcile, honest visible rollback on failure), added discoverable ⌘S shortcut. Confirmed clean on fabricated-success-envelope and generic-scaffold invariants; confirmed the two backend systems (in-memory notes/wiki vs. DB-backed understanding-engine) are deliberately, correctly disambiguated via an `engine_list` alias | `6790a1dc` |
| 2026-07-10 | — | Recovered from a shared-worktree infrastructure failure: the legal+marketplace+message+whiteboard+understanding+reasoning batch's parent dispatcher used isolation:"worktree" on itself while internally spawning 6 children, so the harness auto-cleaned the parent's worktree once the parent's own turn ended — killing all 6 children mid-task. 5 reported the failure with substantial salvaged read-only research and zero edits lost; the 6th (reasoning) hung silently for ~58 min and was killed manually after being flagged. Re-dispatched all 6 as independently-isolated agents, carrying forward every finding already made. | — |
| 2026-07-10 | Wave 3 | paper rebuilt — fixed dead domain-action buttons (checked wrong action-name strings + only the always-true outer envelope), fixed `validate` reading a field none of the create-forms populate, fixed envelope-unwrap bugs in OpenLibraryPanel + CrossRefPanel (zero results on every real search), fixed CitationSearch rendering fields arXiv never returns, wired 3 unsurfaced macros (collection-assign/citationAnalyze/readabilityScore) | `52fafe00` |
| 2026-07-10 | Wave 3 batch | **paper + repos + social + society + staking + vote batch closed** — 6 lenses, all independently re-verified (real test files re-run from scratch: 27+53+175+32+28 = 315 tests, all eslint clean, wiring holds at 258/2/260, honest grader confirms polished/non-scaffold for all 6) | — |
| 2026-07-10 | Wave 3 | society rebuilt — wired the previously-dead `wb-transform-series` macro, killing a redundant World Bank upstream re-fetch (incl. a full population-series re-fetch) on every per-capita/inflation-adjust toggle; documented (not fixed — real IA question) that `/lenses/society` conflates a 6-domain NPC-society sim dashboard with the actual World-Bank-explorer `society` domain under one URL | `09a6f19a` |
| 2026-07-10 | Wave 3 | social rebuilt — wired `reactionKinds` (was hardcoded) + `pollResults` (real bug: poll checkmark never persisted across reloads), new `ModerationPanel.tsx` self-service tab (mute/block/report review, previously one-way post-menu only) | `c5205030` |
| 2026-07-10 | Wave 3 | vote rebuilt — removed a fake parallel proposal/dashboard system (vote buttons wired to the wrong domain, macro calls against wrong field shapes); new `BallotAnalysisLab.tsx` wires `tallyVotes`/`fairnessCheck`/`consensusMeasure` correctly | `4b4a54b8` |
| 2026-07-10 | Wave 3 | repos rebuilt — removed a fabricated repo/issue/commit browser duplicating the already-real `ConcordRepoWorkspace`; fixed an envelope-unwrap bug causing silent-failure-as-success on mutations and render crashes on reads; wired 3 previously-uncallable analysis macros (codeComplexity/commitAnalysis/dependencyAudit) | `410f7cfe` |
| 2026-07-10 | Wave 3 | staking audited — confirmed clean frontend (0/13 macros unsurfaced, no fabrication); real defect found and deliberately flagged rather than silently patched (staking never touches the real wallet — a closed simulation), per the money-invariant escalation rule | `0c3d1ad6` |
| 2026-07-10 | Wave 3 | integrations rebuilt — removed 2 fabricated tabs, wired 3 previously-dead analysis macros (apiHealthCheck/dataFlowMapping/compatibilityCheck), fixed ConnectorCatalog showing fake "Connected" status regardless of real OAuth state | `0d97f056` |
| 2026-07-10 | Wave 3 | personas rebuilt — new `persona-envelope.ts` fixes the fabricated-success bug (outer transport `ok` checked instead of the wrapped macro's own `result.ok`) across all 5 persona components; confirmed `LENS_ACTIONS`-over-`MACROS` registration precedence | `7292fc8f` |
| 2026-07-10 | Wave 3 | productivity rebuilt as real Todoist/Linear task manager — killed a fabricated "6 office tools" scaffold referencing non-existent macros | `9ddb25c6` |
| 2026-07-10 | Wave 3 | privacy rebuilt — new 4-tab `DpoStudioPanel.tsx` replaces a dead generic-artifact analysis strip with a real DPO Compliance Studio | `634e4887` |
| 2026-07-10 | Wave 3 | ingest rebuilt — removed fabricated `useLensData`/`useRunArtifact` panel gated on a never-created artifact type, wired dead document-analysis actions to real macros | `6f5426b5` |
| 2026-07-10 | Wave 3 | inheritance rebuilt — surfaced 2 unsurfaced macros (`notify_heir`, `open_listing` — the latter registered inline in server.js despite a misleading header comment) | `f71d3b34` |
| 2026-07-10 | — | CLAUDE.md corrected — stale `personas` wiring claim (old `register()` shadow loop) replaced with the real 17-macro `LENS_ACTIONS`-registered domain | `b1c84dad` |
| 2026-07-10 | — | Sixth hard invariant added to CLAUDE.md — closing the hard 20% (DATA-SOURCING/ENGINEERING/CURATION triage), required not deferred-by-default | `81012db1` |
| 2026-07-10 | Wave 3 | kingdoms rebuilt — `RealmActionPanel.tsx` reported fake success on every real macro failure (outer-envelope-only check); also fixed `kingdoms.list` missing worldId, `propose_decree` using 5 fake decree-kind strings against the real 8-entry enum, `recompute_loyalty`/`takeover_*` wrong id field | `597d76e1` |
| 2026-07-10 | Wave 3 | trades rebuilt — replaced raw customer/job-ID text inputs with real pickers in Quotes/Recurring/Reviews panels; confirmed `components/trade/` (singular) vs `components/trades/` (plural) are genuinely disjoint systems, not a naming collision | `bb058c77` |
| 2026-07-10 | Wave 3 | landscaping rebuilt — removed fabricated 8-tab CRUD dashboard shadowing the real design studio | `5b39391e` |
| 2026-07-10 | Wave 3 | masonry rebuilt — removed fabricated generic-CRUD dashboard, added a real Client CRM (new `client-add`/`client-list`/`client-delete` macros + `clientStatsFor()` backend helper) | `5d2ffa6e` |
| 2026-07-10 | Wave 3 | tournaments rebuilt — `payouts` macro didn't return the updated tournament, so the frontend's refresh helper never updated the UI after Re-split | `2f57f9bb` |
| 2026-07-10 | Wave 3 | training-room audited — confirmed clean, no fixes needed | `a4f16c7b` |
| 2026-07-10 | Wave 3 | poetry rebuilt — rewired Collection/Compose tabs off a fake parallel poem-notebook system onto the real `poem-*` substrate, fixed `PoetryDbPanel.tsx` envelope-unwrap bug | `ef87970c` |
| 2026-07-10 | Wave 3 | maker rebuilt — wired 3 unsurfaced app-builder macros (connectors subsystem via new `ConnectorManager.tsx`, page delete, save-to-library) | `f3c12515` |
| 2026-07-10 | Wave 3 | wellness rebuilt — wired the previously-unsurfaced `metrics-list` macro into a real "All entries (90d)" log browser | `4e935327` |
| 2026-07-10 | Wave 3 | plumbing rebuilt — removed fabricated 9-tab CRUD dashboard shadowing the real field-service console | `1f51271a` |
| 2026-07-10 | Wave 3 | math rebuilt — wired the real deterministic CAS behind the Evaluator tab (was routing through an LLM chat call instead), fixed stats/matrix field-shape bugs | `d8b4af7c` |
| 2026-07-10 | Wave 3 | welding rebuilt — removed fabricated generic-CRUD dashboard shadowing the real field-service console | `5b66ebbe` |
| 2026-07-10 | Wave 3 | market — removed leftover generic-scaffold mounts (ManifestActionBar, dead UniversalActions, LensFeaturePanel) sitting beside the already-real MarketAnalysisWorkbench | `e77dfddf` |
| 2026-07-09 | Wave 2 COMPLETE | Milestone: `grade-ux-polish.mjs --honest` now reports **260/260 lenses `polished`, 0 `isGenericScaffold`, weighted score 1.0** — fleet-wide, confirmed by an independent re-run after the last batch-7 unit landed (not just the 55 targeted lenses). `verify-lens-backends.mjs` holds at 258 WIRED / 2 by-design NO-BACKEND-CALL, full-project `tsc --noEmit` 0 errors. All 55 confirmed-scaffold lenses across all 11 archetypes are now real, designed apps. Next: Wave 3's ~192-lens risk-pool audit. | `52963c2d` |
| 2026-07-09 | Wave 2 batch 7 | export + legacy + custom rebuilt — Docs/B2B SaaS archetype complete (11/11), closing Wave 2. `legacy`'s primary surface was a fabricated "400-year vision planner" with a hardcoded `400` horizon and a `bioAge` fallback literal of `340` dressed up as "organism health" narrative — confirmed the domain is actually SonarQube/CAST-Highlight-class code modernization, nothing to do with the fake framing. `custom`'s "Lens Templates" system was a disconnected generic-CRUD builder with a raw JSON-paste creation modal duplicating the real 23-macro `CanvasBuilder`. `export`'s three quick-action buttons computed against an always-empty placeholder artifact instead of live DTU data. | `52963c2d` |
| 2026-07-09 | Wave 2 batch 7 | queue + platform + transfer rebuilt. `transfer`'s three analysis macros were fed **analogy-search results** — a completely mismatched artifact shape guaranteeing every call failed, worse than merely disconnected. `queue` had 3 real queueing-theory macros (Erlang-C/M-M-1/M-M-c models, Jain's fairness index) with zero UI callers; new panel auto-derives inputs from the queue's own live job history instead of manual entry. | `7ad83171` |
| 2026-07-09 | Wave 2 batch 7 | schema + audit + projects rebuilt. `schema`'s "Schema Validator" called the run endpoint with the schema's *name* as the artifact id — guaranteed `not found` on every click, silently rendered as "Invalid" (a real, previously-undetected bug, not just fake data). `projects`' real `ProjectsSection` already covered 89 of 98 macros; the fake duplicate ran a "Project Analysis Engine" on four legacy single-artifact macros nothing fed. | `6ccd5902` |
| 2026-07-09 | Wave 2 batch 7 | hr + marketing rebuilt. `marketing` had 4 of 12 tabs duplicating real, already-built panels (`MarketingCampaignsPanel` etc.) that were already wired into `MarketingDashboardSection` one directory over — the fake tabs never called a single macro while the real components sat unused by the top-level nav. | `20f1e384` |
| 2026-07-09 | Wave 2 batch 6 | metalearning + anon + fork rebuilt — Dev-tool/sim-console archetype complete (9/9). Subtler defects than most of the wave: metalearning's frontend read `type`/`successRate` fields the backend doesn't return (silently blanking badges, and a "type" dropdown that was discarded server-side); anon's privacy-compute macros were fed from a permanently-empty generic artifact store (dead-end buttons, not fake data); fork's one broken panel fabricated an "87 · healthy" fork-health score from missing-field defaults. | `f1bf9bfe` |
| 2026-07-09 | Wave 2 batch 6 | quantum + fractal + neuro rebuilt — quantum was already fully complete against its IBM Quantum Composer parity target (confirmed, nothing to fix); fractal had 3 real analysis macros (fractalDimension/selfSimilarity/complexityMeasure) hidden behind a fake "Patterns" library where users hand-typed a depth/complexity number; neuro's one training macro had zero UI. Agent got cut off mid-wait on its own background tsc check — recovered by independently verifying and committing the already-complete work rather than re-dispatching. | `2694903a` |
| 2026-07-09 | Wave 2 batch 6 | robotics + ml + offline rebuilt — all three were already fully real (every backend macro already had a designed caller); the only defect was the dead generic-scaffold body (`UniversalActions`/`LensFeaturePanel`) sitting on top with nothing domain-specific to add, since none of the three register `analyze`/`generate`/`suggest`. One real honesty gap found: ml's "Log epoch" button silently generated synthetic decay-curve metrics with no signal they weren't real — relabeled "Simulate epoch" + added a real manual-entry form. | `b3872388` |
| 2026-07-09 | Wave 2 batch 5 | urban-planning + defense + emergency-services rebuilt — Earth/environmental science archetype complete (9/9). emergency-services was the batch's worst offender: 7 of 9 tabs ran on a fake generic-CRUD store, two of its "types" didn't exist in the domain at all (always-empty tabs), and the average-response stat was a literal hardcoded `'4.2m'` string. A first sub-agent attempt at this unit got confused and produced zero real work before reporting done — caught via `git status` (no urban-planning/defense/emergency-services changes existed) and re-dispatched fresh. | `895e7837` |
| 2026-07-09 | Wave 2 batch 5 | geology + ocean + forestry rebuilt — each had 24-33 real backend macros (live USGS/NOAA/InciWeb/NIFC/Macrostrat/GBIF data) already surfaced through solid bespoke components, sitting behind a disconnected generic-CRUD tab layer plus one outright-fabricated panel per lens (an unvarying geologic time-scale table, ocean species counts as `Math.floor(x*n) \|\| <fallback>`, a fake "Avg Health Score"). | `b95a9445` |
| 2026-07-09 | Wave 2 batch 5 | energy + mining + desert rebuilt — mining needed zero new backend surfacing (all 24 macros already had real designed callers) but carried a fake 8-tab CRUD duplicate including a wholly fabricated "Environmental" tab; desert had 8 of 14 tabs fake, including a stat mislabeled "Species Cataloged" that was actually counting resource nodes. | `f76cffc7` |
| 2026-07-09 | Shared-component fix | `ManifestActionBar`/`UniversalActions`/`LensActionBar` stop faking success — blind no-parameter macro calls no longer toast "ok" when the response is empty, and permanently-disabled buttons now say why. Fixes the interim honesty of ~150 not-yet-rebuilt lenses without a blanket strip (their real fix is still the per-lens rebuild). | `cf773c87` |
| 2026-07-09 | Wave 2 batch 4 | astronomy, space, chem, bio, lab, materials rebuilt — Space/lab science archetype complete (6/6). chem fixed a reaction-chamber bug where every logged reaction rendered "Failed" (no `success` flag was ever set) and replaced a hardcoded periodic table + reaction list with the real Gaussian-elimination `balanceReaction` solver; bio killed a fabricated "Active Experiments" status list and a fabricated always-identical taxonomy tree, retiring a disconnected generic-CRUD organism store in favor of the real `profile-organism` macro. astronomy found the same self-inflicted honest-grader false positive as the earlier veterinary case (a doc comment naming retired components in literal JSX-tag syntax); bio's `LensFeaturePanel` was genuinely still mounted, not a false positive, and was retired for real. Two of the six lenses (astronomy, chem+bio) were left mid-rebuild by a container restart — recovered by reading each diff for coherence before finishing/committing, same discipline as the batch-3 restart recovery. | `7a25b240` |
| 2026-07-09 | Wave 2 batch 3 | pets + veterinary rebuilt — pets killed a fabricated CRUD library disconnected from real health records (same defect class as supplychain/parenting); veterinary found and fixed a self-inflicted false positive where its own doc comment's literal JSX-tag syntax retriggered the honest grader's scaffold detector. Health/life-sim archetype (3-4/4) and Wave 2 batch 3 fully complete (8 lenses). | `cd6bd181` |
| 2026-07-09 | Wave 2 batch 3 | suffering rebuilt — resolved the flagged hardcoded fake confidence-score cards finding; confirmed a real 2-generation 22-macro "pain board" backend. Reflection/knowledge-curation archetype complete (4/4). | `d4d20536` |
| 2026-07-09 | Wave 2 batch 3 | reflection rebuilt — confirmed a real naming collision (an unrelated emergent self-critique system shares the domain name); the 45-macro Day-One-parity journal substrate is 21/45 DESIGNED with the remaining 24 honestly disclosed as a named follow-up, not silently dropped. | `572e4e20` |
| 2026-07-09 | Wave 2 batch 3 | grounding rebuilt — split two unrelated real backend systems (a Ground-News-parity fact-checker + an embodied sensor "reality anchor") that were conflated under one misleading UI; killed hardcoded fake confidence-score cards (97/94/88/91/93). | `a5716915` |
| 2026-07-09 | Wave 2 batch 3 | philosophy rebuilt — killed a disconnected generic CRUD system + a dead 'analyze' action that silently round-tripped to nowhere; fixed a dishonest "Simulated" DepthBadge chip. | `ee3e2cd6` |
| 2026-07-09 | Wave 2 batch 3 | parenting rebuilt — killed a fabricated CRUD library with user-typed diagnosis/medication/percentile fields; fixed a real integration bug where two quick-action buttons always computed against age 0 due to a param-shape mismatch. | `1aa3a939` |
| 2026-07-09 | Wave 2 batch 3 | pharmacy rebuilt — killed a fake medication/interaction tracker + a duplicate analysis panel sitting next to an already-real GoodRx/Medisafe-parity component suite. Health/life-sim archetype (1/4). | `772e2fc4` |
| 2026-07-09 | — | Container restart mid-Wave-2-batch-3 (4 background bash tasks killed; working tree + all prior commits survived intact). Recovered by verifying each of the 8 in-flight lens rebuilds individually against the live backend before committing — 3 had already sent completion reports (pharmacy/parenting/philosophy), 5 had not (pets/veterinary/reflection/grounding/suffering) and were independently audited for completeness before trusting them. Found and fixed one real cross-commit dependency gap (a `lib/api/client.ts` addition omitted from the grounding commit) and one self-inflicted grader false-positive (veterinary's own doc comment). | `4cd74efe` |
| 2026-07-09 | — | chat lens fix (URGENT, user-flagged) — the message column was collapsing to ~150px because two always-rendered panels were flex-row siblings instead of drawer content; moved into a default-closed right-side drawer. Swept the 10 largest lens pages for the same bug class — isolated to chat, no other lens affected. | `0840de3a` |
| 2026-07-09 | Wave 2 batch 2 | atlas rebuilt — 5 real fake-data/duplication findings (a dead compute panel, a broken search parsing the wrong response shape, a fabricated straight-line "ETA" presented as real routing, split duplicate places stores, triple duplicate search boxes). Maps/navigation archetype complete. | `1d147993` |
| 2026-07-09 | Wave 2 batch 2 | travel rebuilt — deleted a duplicated fake trip-CRUD system; found 4 real invisible bugs where quick-tools sent/read backend fields that don't exist (every click returned ok:true while rendering undefined); wired the previously-unsurfaced budget-set macro. | `8858630a` |
| 2026-07-09 | Wave 2 batch 2 | ar rebuilt — the real WebXR SceneStudio was already complete; retired 4 dead/fabricated tabs (disconnected CRUD, fields that visibly changed nothing, an action-less "Anchors" catalog, a capture pipeline that never existed). Maps/navigation archetype (2/3). | `b3acaf78` |
| 2026-07-09 | Wave 2 batch 2 | animation rebuilt — the real frame-by-frame animator was already near-complete; killed a fake "Projects" tab whose Advance button cycled a fabricated status label with no render ever run, and fixed a share-link feature that 404'd on every use. Creative/design archetype (3/3). | `7f8d003c` |
| 2026-07-09 | Wave 2 batch 2 | fashion rebuilt — killed two fabricated Outfits/Wishlist tabs (pure local state with persistence-implying chrome, no backend wishlist concept exists at all) and a disconnected duplicate wardrobe. Creative/design archetype (2/3). | `94dd8e9b` |
| 2026-07-09 | Wave 2 batch 2 | artistry rebuilt — a misfiled music-production backend was presented as this lens's own asset system; retired it and fixed 4 compute macros that were always called with an empty artifact. Creative/design archetype (1/3). | `3e038d17` |
| 2026-07-09 | Wave 2 batch 1 | law rebuilt — mounted the existing CourtListener search into this lens for the first time, wired 4 more zero-caller macros (check-compliance/analyze/+2 scoped-deferred), killed hardcoded "compliant" status tiles. Archetype (Research/reference) complete. | `74d75ab7` |
| 2026-07-09 | Wave 2 batch 1 | mentorship + alliance rebuilt — found + fixed a fabricated client-side "Match: X%" heuristic (real `matchScore` macro existed, unused); wired 3 alliance strategic-analysis macros off a raw JSON button wall. Social/relationship archetype complete. | `26ec0de2` |
| 2026-07-09 | Wave 2 batch 1 | history rebuilt — retired a generic per-user notebook that had zero connection to the real 25-macro TimelineJS-parity substrate; fixed a real `\|\|`-chaining bug that permanently emptied 3 of 4 On-This-Day tabs. | `97e67d12` |
| 2026-07-09 | Wave 2 batch 1 | questmarket + supplychain rebuilt — found the program's most serious fake-data instance yet: supplychain's PRIMARY surface was a fabricated 7-type CRUD library with zero connection to its real 20-macro workbench. Marketplace/economy archetype complete. | `f23621ef` |
| 2026-07-09 | — | Wave 0 fully shipped, ledger updated | `f226725d` |
| 2026-07-09 | Wave 0 sweep | Post-Wave-0 full-suite run (550/550 frontend files, 26,796 backend tests) found + fixed 3 real regressions: 2 keyboard-inaccessible modal backdrops (music's new track-detail modal, announcements' compose panel — both `<div onClick>` with no keyboard equivalent, a real a11y gap the honest grader's anti-pattern check correctly caught) and one stale structural test (production-sprint.test.js grepped fishing's page.tsx source for text that Wave 1 legitimately moved into a sub-component). One unrelated, pre-existing seed-data manifest count drift left untouched (out of this program's scope). | `3add505c` |
| 2026-07-09 | Wave 0c | quests verify-pass — found a real gap: the Completed tab was structurally dead (the underlying query can never return a completed quest) and `quests.claimRewards` had zero frontend callers; both fixed with a new `quests.completed` macro + a real Claim-rewards button | `7587d245` |
| 2026-07-09 | Wave 0a | Music lens — all 7 Apple Music parity gaps closed (the flagship proof unit for the new reference-parity rubric): retired the generic-strip duplicate, collaborative playlists, jam-sync, queue play-next/clear/reorder, 3 zero-caller macros wired, device-transfer honestly relabeled, music.feed New Releases surfaced | `82eb753b` |
| 2026-07-09 | Wave 0c | photos verify-pass — found a real gap: the gallery stored and served every other photo verb correctly but no route ever served the image bytes back to a browser; fixed with a new image route + real `<img>` render | `3599a04d` |
| 2026-07-09 | Wave 0b | courtship — wired the 2 orphaned WIP files from `07e0e660` (HeartEventModal, pregnancy-cache) into the real page | `25e58421` |
| 2026-07-09 | Wave 0c | lfg verify-pass — confirmed clean, no rebuild needed | `ca7f7001` |
| 2026-07-09 | — | Amended the program doc with the Full-App-Parity phase (step 1.5 reference-parity checklist, extended verify gate, Wave 0/2/3 sequencing) | `e6299c82` |
| 2026-07-09 | 0.5 | Connection stability — dev socket-URL default fix, prod polling opt-in env var, deploy-topology README note | `bf5c2345` |
| 2026-07-09 | 3 (Wave 1 fix) | Repaired 4 pre-existing test files broken by the Wave 1 achievements/garage/fishing rebuilds (raw-`fetch` mocks vs the real `lensRun` macro dispatch the rebuilds correctly moved to); found + fixed a real crash (`useSearchParams()` can return `null`) and a real UX defect (a raw `"catalog 500"` string shown to users) surfaced by the fix. Full suite re-verified clean: 550/550 files, 4703/4703 tests, net of one previously-flaky unrelated file. | `c265510b` |
| 2026-07-09 | 3 (Wave 1) | courtship: partial capability-audit artifacts only, NOT integrated — agent hit the session token limit mid-run before touching page.tsx. Retry needed. | `07e0e660` |
| 2026-07-09 | 3 (Wave 1) | garage rebuilt — fleet management app + honest world-owned bridge for driving (mount/dismount/move) | `2f9ed5f2` |
| 2026-07-09 | 3 (Wave 1) | fishing rebuilt — species catalog + catch log, honest disclosure of the live bite/cast session gap | `13f3734d` |
| 2026-07-09 | 3 (Wave 1) | detective rebuilt — case browser + evidence board, real 2-of-3+suspect-match lock-in preserved (8/8 tests) | `96b3d52f` |
| 2026-07-09 | 3 (Wave 1) | announcements rebuilt — wired the previously-unsurfaced compose/post flow | `8856d667` |
| 2026-07-09 | 3 (Wave 1) | achievements rebuilt — wired 2 backend features with zero prior frontend callers (recent-activity feed, titles equip/unequip) | `cab4dc7c` |
| 2026-07-09 | 3 (Wave 1) | lattice — discovered lens/macro-domain naming collision, added honest disclosure instead of force-wiring unrelated macros | `9afea093` |
| 2026-07-09 | 2 (Flagship 3/3) | Concordia (world lens) — killed a permanently-dead fake `progress={0}` loading bar, replaced with 3 real load-signal states; HUD visual-drift fix across 7 components | `2e048948` |
| 2026-07-09 | 2 (Flagship 2/3) | News/Intelligence rebuilt — 39-macro audit, verified GDELT is a real live feed, real pull→DTU citation-chain flow | `3774451d` |
| 2026-07-09 | 2 (Flagship 1/3) | Finance rebuilt — 73-macro audit, retired 9 fake artifact-stub macros, removed a synthetic fake portfolio chart | `6aabd5f1` |
| 2026-07-09 | 1 | docs/UI_QUALITY_RUBRIC.md | `5603fc84` |
| 2026-07-09 | 1 | perceived-perf kit (macro-dispatch feedback hook + lens state persistence) | `856a6430` |
| 2026-07-09 | 1 | Workspace Bus (system-level DTU clipboard, generalizes the 80-consumer usePipe) | `96807730` |
| 2026-07-09 | 1 | formalized lens contract fields + validator | `b72b761f` |
| 2026-07-09 | 1 | 7 new components/ui/ primitives | `cfc3d266` |
| 2026-07-09 | 1 | design-system token expansion (type scale, spacing, density, status colors) | `26c3048c` |
| 2026-07-09 | 0 | shell diet — code-split/gate ~20 always-mounted components, cut idle polling | `76334f33` |
| 2026-07-09 | 0 | frontend fake-data detector | `017a023c` |
| 2026-07-09 | 0 | honest mode for grade-ux-polish.mjs — real scaffold count: 55 lenses (21%), not the initial ~164 estimate | `dc662513` |
| 2026-07-09 | — | Program approved; audit evidence + plan committed as this doc | `dcf3cabb` |

**Correction (2026-07-09, Wave-0 audit): the "retry backlog" framing above was wrong for 3 of 4 lenses.** `lfg`, `photos`, `quests` are real bespoke pages (213-278 lines, real macro/REST wiring, custom filters/forms, honest 4-state handling) — confirmed by absence of the `AutoActionStrip`/`RecentMineCard` generic-scaffold signature. They were never actually attempted and were mis-filed as a session-limit casualty; they need the cheap Wave 0c verify-pass (capability audit + dead-panel/fake-data check), not a rebuild. `courtship` is also a real bespoke page (312 lines) — its only gap is the 2 orphaned WIP files noted below, a finish-the-wire task (Wave 0b), not a rebuild. See Wave 0a/0b/0c under Phase 3 above for the corrected units.
