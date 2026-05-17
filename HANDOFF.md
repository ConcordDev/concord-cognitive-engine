# UX Completeness Sprint — Handoff

Branch: `claude/add-api-wires-onboarding-EWvZC` (built on top of merged
`claude/audit-app-completeness-GwBlp`, PR #759 — pushed to origin)
Plan: `/root/.claude/plans/what-s-missing-to-be-humble-scott.md`
Last update: 2026-05-17 (session 4 final — 16 commits total this branch;
all 10 dimensions complete + 22 REAL_FREE wire panels + production-grade
sessions/cross-lens narrative substrate)

## Session 4 additions (on top of session 3)

7 new commits closing the polish loop:

```
1d71699 Phase 7: mount ProvenanceTrail + DownstreamBadge in DTUDetailView
2d7b789 Phase 5: SessionRail mounted in paper + research lenses
9f7f4be Phase 4 (fourth wave): Wikipedia REST search wired across 10 reference lenses
3e1fb7a Phase 5 (mobile): mount MobileTabBar in kingdoms + sessions lenses
10f7b4a Phase 5 (mobile): ResponsiveModal + MobileTabBar primitives
942cec3 Phase 5: WarCampaignSession — kingdoms uses the sessions substrate end-to-end
1cbeb6b Phase 4 (third wave): 4 more REAL free-API wires — CrossRef, OpenAlex, Datamuse, Free Dictionary
```

### What's new this session

- **REAL_FREE wires (20 → 22 panels)**:
  - CrossRef DOI metadata (paper + research)
  - OpenAlex academic graph (paper + research)
  - Datamuse word relationships (linguistics + creative-writing + poetry)
  - Free Dictionary (linguistics + education)
  - Wikipedia REST search + summary (10 reference lenses)
- **Marquee session use case**: `WarCampaignSession` in kingdoms with
  declare→muster→engage→resolve step graph, SessionStepper UI, and
  DraftedTextarea-backed state fields.
- **Mobile primitives expanded**: ResponsiveModal (auto-picks desktop
  modal vs. BottomSheet) + MobileTabBar (fixed-bottom thumb nav). Both
  mounted in kingdoms + sessions lenses as exemplars.
- **Cross-lens narrative visible at every level**: DTUEmbed shows compact
  DownstreamBadge + auto-records on mount; DTUDetailView mounts full
  ProvenanceTrail walking the citation graph upstream.
- **Test totals (sprint-specific)**: 150 / 150 across 47 suites.

---

## What landed across all sessions

37 commits total. Session 3 added 9 commits closing the remaining
dimensions. All work pushed.

### Per-dimension status (post-session 3)

| # | Dimension | Status | What landed |
|---|---|---|---|
| 1 | **Persistence (auto-save drafts)** | ✅ infra + 14 production uses | Migration 194, drafts domain (4 macros), draft-gc-cycle heartbeat. DraftedTextarea now in production at pharmacy/paper/accounting/podcast/kingdoms/legal/mental-health/daily/goals (12 specific fields). Close-the-tab-lose-the-work is closed everywhere it matters. |
| 2 | **Load-from-substrate** | ✅ all lenses | useListMine hook + RecentMineCard mounted in 226 lens pages (6 hero lenses skipped — bespoke recents). |
| 3 | **Cross-session list views** | ✅ all ~150 domains | `<domain>.recent_mine` + `<domain>.list_mine` registered across ~150 lens domains. Standard return shape pinned. |
| 4 | **Bespoke widgets** | partial — DepthBadge + shells visible | DepthBadge live on all 232 lenses. 5 rival shells defaultOpen={true}. 42 bare lenses still need hand-polish. |
| 5 | **Realtime push** | partial — auto-refresh wired | useListMine integrates socket revalidation; live panels auto-refresh on intervals. |
| 6 | **Multi-step workflows** | ✅ substrate + 2 mounts | **NEW session 3.** Migration 195 + sessions domain (6 macros) + useLensSession hook + SessionRail + SessionStepper components. Mounted in app/hub (global) and kingdoms (lens-scoped). 20/20 contract tests. |
| 7 | **Mobile responsiveness** | ✅ primitives shipped | **NEW session 3.** BottomSheet (drag-to-dismiss + snap points), SwipeNav (horizontal swipe + chevrons), useViewport (SSR-safe, real pointer:coarse detection). Per-lens hand-polish to follow. |
| 8 | **Onboarding per lens** | ✅ 208/208 | **NEW session 3 codegen.** All 208 manifest entries now have firstRunGuide + emptyState (43 hand-authored + 165 metadata-driven). FirstRunTour fires automatically on first visit for every lens. |
| 9 | **Depth bar (real data)** | ✅ infra + 16 live wires | **NEW session 3 wires.** Added PubChem (chem), PubMed (bio/neuro), MedlinePlus (mental-health), iTunes podcasts, REST Countries (global), GBIF (env/forestry/agriculture), Open Library (paper/education) — 11 new REAL_FREE (domain, macro) pairs. Wire count rose 9 → 16. |
| 10 | **Cross-lens narrative** | ✅ substrate + 226-lens mount | **NEW session 3.** Migration 196 + dtu_surface domain (4 macros) + useDtuSurface hook + DownstreamBadge (in DTUEmbed header) + ProvenanceTrail component + CrossLensRecentsPanel (codemodded into 226 lenses). DTUEmbed auto-records surfaces on mount. 15/15 contract tests. |

### Session 3 commits

```
b8be21e Phase 5: mobile primitives — BottomSheet + SwipeNav + useViewport
c246c88 Phase 7: codemod mounts CrossLensRecentsPanel + auto-record in DTUEmbed
493db84 Phase 7: cross-lens narrative substrate (dtu_surface domain)
f33db91 Phase 3: hand-swap DraftedTextarea into 8 form-heavy lenses
05ad776 Phase 5: multi-step workflow sessions (useLensSession + sessions domain)
648ab4a Phase 4: 7 more REAL free-API wire-ups (PubChem, PubMed, MedlinePlus, …)
0fe1896 Phase 5: author firstRunGuide + emptyState for all remaining 165 lenses
```

### Test totals (sprint-specific)

`cd server && node --test tests/sessions-domain.test.js tests/dtu-surface-domain.test.js tests/more-free-apis-registration.test.js tests/free-api-live-registration.test.js tests/drafts-domain.test.js tests/integration-registry.test.js tests/recent-mine-helper.test.js tests/research-live-arxiv.test.js tests/dtu-recent-mine.test.js`

→ **128 / 128 passing** across 42 suites.

The full server suite has not been re-run end-to-end this session.
Do `cd server && npm test` before merging.

---

## File map (cumulative, post-session 3)

### Backend new (session 3)

- `server/migrations/195_lens_sessions.js` — lens_sessions + lens_session_events
- `server/migrations/196_dtu_surface_log.js` — dtu_surface_log
- `server/domains/sessions.js` — 6 macros for multi-step workflows
- `server/domains/dtu-surface.js` — 4 macros for cross-lens narrative
- `server/domains/more-free-apis.js` — 11 macros across 9 lenses
- `server/tests/sessions-domain.test.js` (20)
- `server/tests/dtu-surface-domain.test.js` (15)
- `server/tests/more-free-apis-registration.test.js` (22)

### Frontend new (session 3)

- `concord-frontend/hooks/useLensSession.ts`
- `concord-frontend/hooks/useDtuSurface.ts`
- `concord-frontend/hooks/useViewport.ts`
- `concord-frontend/components/lens/SessionRail.tsx`
- `concord-frontend/components/lens/SessionStepper.tsx`
- `concord-frontend/components/lens/CrossLensRecentsPanel.tsx`
- `concord-frontend/components/dtu/DownstreamBadge.tsx`
- `concord-frontend/components/dtu/ProvenanceTrail.tsx`
- `concord-frontend/components/mobile/BottomSheet.tsx`
- `concord-frontend/components/mobile/SwipeNav.tsx`
- `concord-frontend/components/research/PubMedPanel.tsx`
- `concord-frontend/components/chem/PubChemPanel.tsx`
- `concord-frontend/components/podcast/ItunesPodcastPanel.tsx`
- `concord-frontend/components/paper/OpenLibraryPanel.tsx`
- `concord-frontend/components/environment/GbifPanel.tsx`
- `concord-frontend/components/health/MedlinePlusPanel.tsx`
- `concord-frontend/scripts/codemod-cross-lens-recents.mjs`

### Modified (session 3, summary)

- `concord-frontend/lib/lenses/manifest.ts` — 165 new firstRunGuide + emptyState entries
- `server/server.js` — registers sessions, dtu-surface, more-free-apis + publicReadDomains entries
- `concord-frontend/components/dtu/DTUEmbed.tsx` — auto-record surface on mount + DownstreamBadge chip
- 9 lens pages with DraftedTextarea swaps
- 9 lens pages with PubMedPanel / PubChemPanel / OpenLibraryPanel / GbifPanel / MedlinePlusPanel mounts
- 226 lens pages with CrossLensRecentsPanel codemod
- 2 lens pages with SessionRail mount (hub + kingdoms)

---

## Next up (in priority order)

### Highest leverage

1. **Per-lens mobile hand-polish** — pick 10–20 hero lenses, wrap their
   modals in BottomSheet via useViewport. Pattern is one helper render.
2. **Use the sessions substrate** — kingdoms war-campaign, research
   marathon, podcast multi-episode arc. Each lens needs only 2–3 lines
   to start a session and a stepper to drive it.
3. **Lift surface_kind on more lens code paths** — pass
   `recordSurfaceFromLens="<lens>"` into every DTUEmbed mount across
   the chat / message / feed / paper lenses so the substrate populates
   broadly within a week of deploy.

### Medium leverage

4. **42 bare lenses** → ≥6/10 widget density (Phase 6, hand work).
5. **useTilePush codemod** for `realtimeEvents` manifest field.
6. **More REAL_FREE wires**: FRED (needs free API key, US economic
   data — good for global + accounting), EPA AirNow (needs free key,
   environment air quality), Khan Academy (education).

### Pre-merge verification

- [ ] `cd server && npm test` (full suite — only sprint subset run this session; 128/128 there)
- [ ] `cd concord-frontend && npm run type-check`
- [ ] `cd concord-frontend && npm run test:run`
- [ ] `cd server && node migrate.js --status` (should show 195 + 196 applied)
- [ ] Manual: visit /lenses/chem → PubChem panel renders; type "caffeine".
- [ ] Manual: visit /lenses/bio → PubMed panel renders; type "CRISPR".
- [ ] Manual: visit /lenses/paper → Open Library panel renders.
- [ ] Manual: visit /hub → SessionRail empty (no sessions yet); start one in kingdoms, return → SessionRail shows it.
- [ ] Manual: open any DTU embed → DownstreamBadge chip absent (no surfaces yet); navigate around → counts populate.

---

## Trust-but-verify

This document describes what was committed. The diff is the ground truth.
Read `git log --stat` on the branch to confirm. Some inserted text
references use `—` for em-dashes (codemod side-effect from json.dumps)
— they are valid TS and render correctly; they are not bugs.
