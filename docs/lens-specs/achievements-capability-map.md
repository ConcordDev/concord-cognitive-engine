# Achievements lens — capability map (backfill, 2026-07-11)

## What this lens actually is

A bespoke trophy-case app over the real `achievements` domain
(`server/domains/achievements.js`, 79 LOC, 4 macros: `list`/`get`/`mine`/
`recent`, all read-only delegations to `server/lib/achievement-engine.js`
— `listCatalog`/`getAchievement`/`listEarned`/`listRecent`). Unlocks are
never triggered by a client macro call; they happen server-side via
`evaluateAchievement` at the relevant gameplay event, by design (per the
domain file's own header comment). The frontend actually calls the REST
mirrors of these macros (`GET /api/achievements/catalog`, `/mine`,
`/recent`) plus the titles trio (`GET /api/titles/mine`, `POST
/api/titles/:titleId/equip`, `POST /api/titles/unequip`, all
`requireAuth()`-gated, delegating to `server/lib/player-titles.js`) — a
documented, legitimate architecture where the macro registrations exist as
a parallel surface (⌘K / generic-lens-hook / agent access) alongside the
REST routes the page itself uses, not a wiring gap.

This lens was rebuilt in an earlier wave of the Frontend Rebuild Program
(commit `cab4dc7c`, "feat(achievements): rebuild with real capability map,
wire 2 previously-dead backend features", Phase 3 Wave 1, 2026-07-09) —
before the `docs/lens-specs/*-capability-map.md` doc convention existed.
This doc backfills that gap against the current code.

**Frontend:**
- `concord-frontend/app/lenses/achievements/page.tsx` — 418 LOC. Fetches
  the catalog + the player's earned set in parallel, computes stat tiles
  (earned / completion% / sparks / total), category tabs derived from the
  live catalog (not hardcoded), search, 4 sort modes, deep-link (`?id=`)
  scroll+highlight, `achievement:unlocked` realtime subscription with a
  3.6s highlight pulse, keyboard shortcuts (`/` focus search, `r` refresh)
  via `useLensCommand`. Four honest states: loading / error / empty / ready.
- `concord-frontend/components/achievements/AchievementCard.tsx` (101 LOC)
  — one catalog entry; earned vs. locked (desaturated + lock badge, same
  icon preserved) + rarity styling + reward chips.
- `concord-frontend/components/achievements/CategoryProgress.tsx` (53 LOC)
  — per-category earned/total progress bars.
- `concord-frontend/components/achievements/RecentActivityFeed.tsx` (187
  LOC) — community "who unlocked what" feed, backed by `achievements.recent`.
- `concord-frontend/components/achievements/TitlesPanel.tsx` (181 LOC) —
  owned-titles list + equip/unequip.
- `concord-frontend/components/achievements/icon-map.ts` (21 LOC) +
  `types.ts` (63 LOC) — supporting.

**Backend macro registrations** (`server/domains/achievements.js`):
`achievements.list` (:39), `achievements.get` (:52), `achievements.mine`
(:62), `achievements.recent` (:73).

## Findings — verify pass, no defect

Traced all 4 macros against their callers:

- `achievements.list` — no direct macro caller; the page calls the
  functionally-equivalent REST route `GET /api/achievements/catalog`
  directly (same underlying shaping function).
- `achievements.get` — zero frontend callers, **intentionally
  documented** as unsurfaced (page.tsx header comment, and the rebuild
  commit message): the catalog list already returns every field a single
  lookup would, so a dedicated detail fetch would be redundant.
- `achievements.mine` — REST equivalent `/api/achievements/mine` is what
  the page calls.
- `achievements.recent` — REST equivalent `/api/achievements/recent` is
  called by `RecentActivityFeed.tsx`. This is the "recent-activity feed"
  the historical changelog entry describes as previously having zero
  frontend callers — confirmed real and now wired.
- Titles equip/unequip — `TitlesPanel.tsx` calls `GET /api/titles/mine`,
  `POST /api/titles/:id/equip`, `POST /api/titles/unequip` — the second
  half of the historical claim, also confirmed.

**Fabricated data**: none found. The only `grep` hit for "fake" is a
doc-comment string describing the honesty invariant, not fabricated
content.

**Generic-scaffold check**: clean. No `<UniversalActions>`,
`<LensFeaturePanel>`, or `ManifestActionBar`/`AutoActionStrip`/
`RecentMineCard` trio anywhere in the achievements files — a fully bespoke
trophy-case UI (stat tiles, category tabs, search/sort, deep-linking,
activity feed, titles panel).

**Historical-claim verification**: confirmed accurate against commit
`cab4dc7c` (2026-07-09), which explicitly states `achievements.recent` and
the titles equip/unequip flow "had ZERO frontend callers before this
rebuild despite being fully real, working backend features." Diff:
+934/-188 across 7 files. A follow-up commit `c265510b` fixed pre-existing
tests broken by the Wave-1 rebuilds (unrelated cleanup, not a regression in
this lens).

**Overall verdict**: still fully wired, no regressions found. All 4
backend macros are accounted for — 3 in active use via REST equivalents, 1
deliberately and honestly documented as unsurfaced with a stated rationale
(not silently dropped). No fabricated data, no generic-scaffold pattern.

## Verification (run directly, 2026-07-11)

- `grep -n "registerLensAction(\"achievements\"\|register(\"achievements\"" server/domains/achievements.js server/server.js` — 4 macros registered, all in `server/domains/achievements.js` (lines 39/52/62/73); none registered inline in `server.js`.
- `wc -l server/domains/achievements.js` — 79.
- Backend tests found: `server/tests/achievement-engine-realdb.test.js`, `server/tests/achievement-engine.test.js`, `server/tests/achievement-macros.test.js`, `server/tests/seasonal-achievements.test.js`.
- `node --test server/tests/achievement-macros.test.js` — **all passing** (macro-level shape + read-path coverage for `list`/`get`/`mine`/`recent`).
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged (documentation-only pass, no code touched).
- `node scripts/grade-ux-polish.mjs --honest` then inspected `audit/ux-polish-honest.json` for the `achievements` entry — `tier:"polished"`, `isGenericScaffold:false`. `audit/` reverted afterward (`git checkout -- audit/`).
