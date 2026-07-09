# Frontend Rebuild Program — "Lenses Become Real Apps"

> **🟢 STATUS (2026-07-09): Phases 0-2 shipped, Phase 3 Wave 1 6/10 shipped,
> Wave-1 test regressions fixed, Phase 0.5 (connection stability) shipped,
> Wave 0 (a/b/c) shipped.** The bar was raised the same day (see
> "Full-App-Parity amendment" below) — every lens from Wave 0 onward must
> also close a researched feature-parity checklist against a real
> best-in-class reference app, not just pass the structural rebuild loop.
> Wave 0a (music, the flagship proof unit — all 7 gaps closed), 0b
> (courtship finish-the-wire), and 0c (lfg/photos/quests verify-pass, found
> + fixed real gaps in photos and quests) are all shipped and independently
> re-verified — full frontend (550/550 files) + backend (26,796 tests) suite
> swept clean afterward, surfacing and fixing 2 more real a11y issues
> (keyboard-inaccessible modal backdrops in music + announcements) along the
> way. Wave 2 (55 scaffold lenses by archetype) is next. This is the live
> arc for the frontend. Sections below are the program spec; a per-phase status
> ledger is appended at the bottom as work ships.

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
