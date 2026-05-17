# UX Completeness Sprint — Handoff

Branch: `claude/audit-app-completeness-GwBlp` (pushed to origin)
Plan: `/root/.claude/plans/what-s-missing-to-be-humble-scott.md`
Date handed off: 2026-05-17

---

## What landed this session

Six commits implementing the foundation + first mechanical sweeps of the 10-dimension UX completeness sprint.

```
bad1c16 Phase 3/5: RecentMineCard + FirstRunTour mounted in all 232 lenses
03bb2a5 Phase 2 (bulk): recent_mine + list_mine across ~150 lens domains
478ff9f Phase 4 (codemod): mount DepthBadge in all 232 lens pages
89c1b34 Phase 2 (codemod): inject dataTier into all 208 manifest entries
3a6d942 Phase 2 (foundation): IntegrationRegistry + recent_mine helper
ab53b21 Phase 1: auto-save drafts + manifest extension + core hooks
```

Test totals: **99 passing / 0 failing** across the new Phase 1+2 contract tests + sampled existing tests (three-gate-consistency, lattice-orchestrator, embodied-pain-repair, combat-anti-cheat). The broader suite has not been re-run end-to-end this session — do so before merging.

### Per-dimension progress

| # | Dimension | Status | What landed |
|---|---|---|---|
| 1 | **Persistence (auto-save drafts)** | ✅ infra + hook | Migration 194, `drafts` domain (4 macros), `draft-gc-cycle` heartbeat, `useLensDraft<T>()` hook with debounced server write + localStorage mirror + pagehide flush. Codemod to wrap form inputs NOT yet written — per-lens hand-wiring needed (see "Next up"). |
| 2 | **Load-from-substrate** | ✅ infra | `useListMine` hook + `RecentMineCard` component ready. Codemod to mount the card in lenses NOT yet written — per-lens hand-mount needed. |
| 3 | **Cross-session list views** | ✅ all ~150 domains | `_recent-mine-bulk.js` registers `<domain>.recent_mine` + `<domain>.list_mine` against the universal `dtus` table for ~150 lens domains. `_recent-mine-helper.js` factory for bespoke artifact-table backers. Standard return shape `{ok, items, total}` pinned by Tier-2 tests. |
| 4 | **Bespoke widgets** | partial — DepthBadge mounted | DepthBadge live on all 232 lenses. Five unmounted rival shells (VSCodeShell, DocsShell, WalletShell, EHRShell, WhiteboardCanvas) still need to become PRIMARY surfaces (currently mounted via `RivalShapePreview` collapsible only). The 42 bare lenses still need hand-polish. |
| 5 | **Realtime push (`useTilePush`)** | hook exists, NOT mounted | `useTilePush` was already in panel-polish/. `useListMine` integrates socket revalidation via `watchEvents`. Codemod for per-lens tile flash-on-change NOT yet written. |
| 6 | **Multi-step workflows** | NOT started | `useLensSession` hook + per-domain `session_*` macros pending. |
| 7 | **Mobile responsiveness** | NOT started | `BottomSheet` + `SwipeNav` primitives + Tier-1 hero polish pending. |
| 8 | **Onboarding per lens** | ✅ infra + 9 hero scripts | `FirstRunTour` component mounted in all 232 lenses. 9 hero lens scripts authored (chat, code, wallet, marketplace, forge, message, world, pharmacy, studio). 199 lenses still need their `emptyState` + `firstRunGuide` copy authored — the tour is a safe no-op until each is written. |
| 9 | **Depth bar (real data)** | ✅ infra + visible | `IntegrationRegistry` declares tier + sources/paywallReason for >200 domains. `DepthBadge` mounted on every lens header showing Live / Real / Simulated / Demo. Free APIs registered in registry but not yet WIRED to lens UI (Phase 4 wire-up of NASA/USGS/NOAA/FDA/Wikipedia/etc. still pending). |
| 10 | **Cross-lens narrative** | NOT started | `ProvenanceTrail`, `LensFlowMap`, `DownstreamBadge`, `dtu_surface_log` migration 195 pending. Plan-file Phase 7. |

---

## File map (new files this session)

### Backend
- `server/migrations/194_lens_drafts.js` — drafts table (UPSERT keyed on user×lens×key, 256 KiB cap)
- `server/lib/draft-gc.js` — TTL sweep helper, env-tunable
- `server/emergent/draft-gc-cycle.js` — heartbeat `draft-gc-cycle` (frequency 480, ~2h)
- `server/domains/drafts.js` — 4 macros (save/load/list_mine/delete)
- `server/lib/integration-registry.js` — 4-tier registry for ~200 lenses
- `server/domains/_recent-mine-helper.js` — factory for bespoke-table backed recent_mine
- `server/domains/_dtu-recent-mine.js` — factory for DTU-table backed recent_mine
- `server/domains/_recent-mine-bulk.js` — bulk registration of ~150 domains
- `server/tests/drafts-domain.test.js` — Tier-2, 21 assertions
- `server/tests/integration-registry.test.js` — Tier-2, 11 assertions (honesty contract)
- `server/tests/recent-mine-helper.test.js` — Tier-2, 11 assertions
- `server/tests/dtu-recent-mine.test.js` — Tier-2, 7 assertions

### Frontend
- `concord-frontend/lib/lenses/manifest.ts` — schema extended (DataTier, emptyState, firstRunGuide, realtimeEvents, sessionTable), 208/208 entries tagged + 9 hero scripts authored
- `concord-frontend/hooks/useLensDraft.ts` — debounced auto-save hook
- `concord-frontend/hooks/useListMine.ts` — recent-list fetch + socket revalidation
- `concord-frontend/hooks/useDepthBadge.ts` — tier lookup
- `concord-frontend/components/lens/DepthBadge.tsx` — 4-state colour-coded chip
- `concord-frontend/components/lens/RecentMineCard.tsx` — drop-in recents card
- `concord-frontend/components/lens/FirstRunTour.tsx` — spotlight + coachmark + localStorage gate
- `concord-frontend/scripts/codemod-manifest-tiers.mjs` — injects `dataTier` from registry
- `concord-frontend/scripts/codemod-depth-badge.mjs` — mounts `<DepthBadge>`
- `concord-frontend/scripts/codemod-first-run-tour.mjs` — mounts `<FirstRunTour>`

### Modified
- `server/server.js` — registers `drafts` domain + `draft-gc-cycle` heartbeat + bulk `recent_mine` + `publicReadDomains` entry for `drafts` + broad gate-bypass for `recent_mine`/`list_mine`
- `concord-frontend/app/lenses/*/page.tsx` — 232 files; mount `<DepthBadge>` + `<FirstRunTour>`

### Ledgers (machine-readable codemod reports)
- `audit/codemod-reports/manifest-tiers-*.json` (208 injected)
- `audit/codemod-reports/depth-badge-*.json` (232 mounted)
- `audit/codemod-reports/first-run-tour-*.json` (232 mounted)

---

## Next up (in plan order)

### Highest leverage (do these first)

1. **Wrap form inputs with `useLensDraft`** — write `codemod-use-draft.mjs` that finds `useState<string>('')` bindings on textarea/input elements (heuristic: state name matches `text|prompt|input|body|content|description|notes`) and wraps with `useLensDraft(lensId, fieldName)`. Skip readonly viewer lenses <120 LOC.

2. **Mount `<RecentMineCard>` per lens** — codemod or hand-mount inside each lens's primary content column. The component is ready; just needs placement. ~30 hero lenses give visible "your recent X" surface immediately.

3. **Author `firstRunGuide` + `emptyState` for the remaining 199 lenses** — currently 9 of 208 manifest entries have tour copy. Each needs `{ headline, caption, firstActionLabel }` + 3–5 `{ caption, selector? }` steps. The tour-mount codemod is already idempotent — once copy is in the manifest, the tour fires automatically. Spreadsheet/LLM-assisted batch authoring with human review.

4. **Wire real free APIs declared in `integration-registry`** — registry lists NASA APOD, USGS, NOAA, FDA OpenFDA labels, OpenStreetMap Nominatim, Wikipedia REST, MathOverflow, GHSA, ProPublica, Pexels, MET Museum etc. as `REAL_FREE` sources, but `server/lib/feed-sources.js` only has 3 actually-fetching entries (Yahoo Finance, CoinGecko, World Bank). Add `feed-sources.js` rows for the rest + wire `useTilePush` events for the corresponding `<domain>:updated` socket emissions.

5. **Mount 5 unmounted rival shells as PRIMARY surfaces** (not just `RivalShapePreview` collapsibles):
   - `concord-frontend/app/lenses/code/page.tsx` → make `<VSCodeShell>` the main editor chrome
   - `concord-frontend/app/lenses/legal/page.tsx` → `<DocsShell>` as default workspace
   - `concord-frontend/app/lenses/crypto/page.tsx` → `<WalletShell>` for balance / tx history
   - `concord-frontend/app/lenses/healthcare/page.tsx` → `<EHRShell>` for patient view
   - `concord-frontend/app/lenses/whiteboard/page.tsx` → `<WhiteboardCanvas>` as default surface

### Then per plan-file phase order

6. **Phase 4 (rest)** — codemod-tile-push.mjs for `realtimeEvents` manifest field; extend `server/lib/event-shapes.js` with `<domain>:updated` for all 22 feed categories.

7. **Phase 5** — `useLensSession` hook + per-domain `session_*` macros for 11 backend session tables (`war_campaigns` → kingdoms, `reasoning_sessions` → research, `agent_marathon_sessions` → agents, `chat_sessions` → chat, `council_sessions` → council, `spectator_sessions` → spectator, etc.) + mobile primitives (`BottomSheet`, `SwipeNav`) + Tier-1 mobile polish for 20 hero lenses.

8. **Phase 6** — 42 bare lenses → ≥6/10 widget density. Hand work; 6 themed batches. Score gate via `concord-frontend/scripts/score-lens-density.ts` (new).

9. **Phase 7** — cross-lens narrative. Migration 195 `dtu_surface_log` + `ProvenanceTrail` / `LensFlowMap` / `DownstreamBadge` components + write-point insertions in `narrative-bridge.js`, `forge-marketplace.js`, etc. Time-gate launch 2–4 weeks after Phase 6 so users have generated DTU travel.

---

## Verification checklist before merge

- [ ] `cd server && npm test` (full suite — only sampled this session)
- [ ] `cd concord-frontend && npm run type-check` (last run: clean)
- [ ] `cd concord-frontend && npm run test:run`
- [ ] `cd server && node migrate.js --status` (should show 194 applied)
- [ ] Boot server with `CONCORD_NO_LISTEN=true NODE_ENV=test node server.js`; check the new `draft-gc-cycle` heartbeat appears
- [ ] Playwright smoke across the 232 lens routes (extend `concord-frontend/scripts/playwright-warmup.ts`)
- [ ] Manual: visit `/lenses/chat` as a fresh user → FirstRunTour fires → click Skip → reload → tour does NOT re-fire (localStorage gate works)
- [ ] Manual: visit any lens → DepthBadge chip visible in header → tooltip explains the tier honestly

---

## Risks / pitfalls for the next session

- **`recent_mine` macro return shape is contract.** If a per-domain author registers a bespoke `recent_mine` AFTER the bulk registration, they MUST return `{ ok: true, items: [...], total: number }`. The Tier-2 test `recent-mine-helper.test.js` will need to be extended to also pin per-domain overrides as they land.

- **`publicReadDomains` gate has a broad allow now** for any macro named `recent_mine`/`list_mine`. This is safe because each handler self-scopes by `ctx.actor.userId` (rejects anonymous), but if a future per-domain `recent_mine` forgets that check, it'll leak. Test for this when adding per-domain overrides.

- **`useLensDraft` doesn't debounce within the localStorage write** — every keystroke writes localStorage. If you wrap a high-frequency input (e.g., a 60Hz slider), throttle the `setValue` calls upstream.

- **`FirstRunTour` spotlight selector** is computed against `document.querySelector` once per step. If the target element re-renders between activation and step display, the spotlight will be stale until next resize/scroll. Consider IntersectionObserver if this becomes a real problem.

- **`integration-registry.js` honesty contract** has a CI gate: every DEMO must declare `paywallReason`. New lens domains added without registry entries will silently default to "no badge" (the manifest tier injection codemod will skip them). Re-run `node scripts/codemod-manifest-tiers.mjs --dry` after adding new lens manifests to catch gaps.

- **DepthBadge codemod is idempotent** but the injection point is heuristic — it lands after `<ManifestActionBar />` if present, else after `<LensShell>` opening. A future codemod that moves the action bar will need to keep the badge attached.

---

## Plan file

Full multi-phase plan at `/root/.claude/plans/what-s-missing-to-be-humble-scott.md` covers all 10 dimensions across 7 phases with file paths, scopes, test strategies, and verification steps. This handoff is the snapshot of where Phase 1 + parts of 2/3/4/5 stand; the plan file is the roadmap forward.

---

## Quick start for the next session

```bash
git checkout claude/audit-app-completeness-GwBlp
cd server && npm test 2>&1 | tail -10   # confirm clean baseline
cd ../concord-frontend && npm run type-check
# Read /root/.claude/plans/what-s-missing-to-be-humble-scott.md for the roadmap
# Read HANDOFF.md (this file) for current state
# Start with the "Next up" section above — items 1-5 are the highest leverage.
```
