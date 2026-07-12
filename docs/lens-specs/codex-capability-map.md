# codex — capability map (Frontend Rebuild Program, Wave 3)

Reference apps: in-game lore compendiums/codices — **Destiny 2's Lore
Book** and **Hades' Codex** (browse/filter authored canon by chapter/world,
bookmark for later, cross-reference by related tag/character/faction).
Parity target: the only difference should be the size of the authored
canon, not missing browse/cross-reference affordances.

## Backend surface

`codex` has no domain of its own — it is a read-only lens over the `lore`
domain (`server/domains/lore.js`, `register("lore", "list"|"get"|"facets"|
"spine")`, all public-read; `hidden_truth` stripped server-side in
`lib/authored-lore.js`) plus a generic per-user artifact store
(`useLensData('codex','bookmark')`) for bookmarking. `node scripts/
lens-unsurfaced.mjs --lens codex` reports no registered macros for this
lens name (expected — the backing macros are registered under `lore`, not
`codex`).

## Audit finding: real reader, but 4 already-fetched fields sat unused

The page's four explicit UX states (loading/error/empty/populated), the
cosmology-spine header, the world/kind/search filters, and bookmarking were
all already real and correctly wired — no fabrication.

The gap: `lore.list` (`server/lib/authored-lore.js#publicEvent`) already
returns `significance`, `factions_involved`, `known_by`, and `tags` on
every event — but the expanded row only ever rendered `description`. The
rest of the data was fetched and sitting in the `events` array, unused.
This is the "backend-capable-but-unsurfaced" pattern in its cheapest
possible form: no new macro call needed, the fields were already on the
client.

Compared against the reference apps' checklist, the missing piece was
specifically the **cross-reference affordance** — Destiny 2's Lore Book and
Hades' Codex both let you jump from one entry to related entries sharing a
theme/character; this lens had tags in the data but nothing made them
interactive.

## What this rebuild changed

- Expanded row now also renders `significance` (styled as a pull-quote),
  `factions_involved`, and `known_by` when present — using data already in
  the fetched `LoreEvent`, no extra round-trip.
- `tags` are now rendered as clickable chips. Clicking one sets a
  client-side `activeTag` filter (no extra fetch — filters the
  already-fetched `events` array) that narrows the visible canon to every
  other entry sharing that tag, with an active-tag chip in the filter bar
  to clear it. This is the real "related entries" cross-reference the
  reference apps have.
- Empty-state and "Clear filters" logic updated to account for the new
  tag filter so a tag-narrowed empty result reads honestly (not as "the
  records are empty").

## Disposition ledger (step 1.5)

- **ALREADY REAL**: browse/filter (world, kind, free-text search) via
  `lore.list`; the Three Pillars cosmology header via `lore.spine`; facet
  population via `lore.facets`; per-user bookmarking via the generic
  artifact store; all four explicit UX states.
- **BACKEND-CAPABLE-BUT-UNSURFACED → now wired**: `significance` /
  `factions_involved` / `known_by` / `tags` fields (already returned by
  `lore.list`, now rendered); tag-based cross-reference (client-side filter
  over already-fetched data, no new macro).
- ~~**GENUINELY MISSING**: `lore.get` (single-event-by-id) remains
  unsurfaced — honest relabel: `lore.list` already returns the full event
  shape for every entry in the browsable set, so a dedicated per-id fetch
  has no distinct use case in this UI (no permalink/deep-link route exists
  to justify it). Flagged as a scoped future build task only if a
  shareable-permalink feature is ever prioritized (`/lenses/codex?id=...`
  resolving via `lore.get`).~~

  **CLOSED (2026-07-12, `9f7f4d8e`) — Wave 4 gap-closure.** Built the
  scoped permalink/deep-link feature exactly as flagged, ENGINEERING class
  (no external data dependency, no backend change needed — `lore.get` was
  already real and already returned the correct shape; verified by
  re-running `server/tests/codex-lens-macros.test.js`, 17/17 unchanged).
  `/lenses/codex?id=<loreId>` now resolves that one entry via `lore.get`
  and shows it in a dedicated detail dialog (`role="dialog"`, closable,
  independent of whatever browse filters are active — a shared link
  resolves even if the linked entry would be filtered out of the visible
  list). Every entry — plus the dialog itself — got a "Copy permalink"
  control (`navigator.clipboard.writeText`, mirroring the existing
  `cognitive-replay` lens's `SnapshotPanel` share pattern) so the link is
  actually producible, not just consumable; the URL param is read via
  `useSearchParams` and cleared via `router.replace` on close (the
  `next/navigation` idiom this codebase already uses in the `news` and
  `cognitive-replay` lenses, including the required `<Suspense>` wrapper
  around the `useSearchParams` consumer). No redesign of the browse UI —
  filters, spine header, bookmarking, and the inline expand/collapse rows
  are unchanged. `concord-frontend/app/lenses/codex/page.tsx`; tests in
  `concord-frontend/tests/codex-lens.test.tsx` (7 new cases: dialog
  resolves via `lore.get` with the id from the URL, an unresolved id shows
  an honest in-dialog error, closing calls `router.replace` to strip the
  param, the list-row and in-dialog "Copy permalink" controls both copy a
  URL containing the entry id) and a `next/navigation` mock added to
  `concord-frontend/tests/codex-lens-states.test.tsx` (required once the
  page started calling `useSearchParams`/`useRouter`/`usePathname` — its
  7 pre-existing state-gate tests are otherwise unchanged).

## Verification

- `npx eslint app/lenses/codex/page.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `node scripts/verify-lens-backends.mjs` — `codex` still `WIRED`.
- `node scripts/grade-ux-polish.mjs --honest` — `codex`: `tier: "polished"`, `isGenericScaffold: false`.
- `npx vitest run tests/codex-lens.test.tsx tests/codex-lens-states.test.tsx` — 18/18 passing (pre-existing behavior unchanged by the additive detail-view/tag-filter changes).

**2026-07-12 permalink/deep-link closure re-verification:**
- `npx eslint app/lenses/codex/page.tsx tests/codex-lens.test.tsx tests/codex-lens-states.test.tsx` — clean.
- `npx tsc --noEmit -p .` — 0 errors project-wide.
- `npx vitest run tests/codex-lens.test.tsx tests/codex-lens-states.test.tsx` — 23/23 passing: `codex-lens.test.tsx` 16 (11 pre-existing + 5 new: 3 deep-link-resolves/errors/close cases + 2 copy-permalink cases) + `codex-lens-states.test.tsx` 7 pre-existing (unchanged behavior; needed only a `next/navigation` mock addition since the page now calls `useSearchParams`/`useRouter`/`usePathname`).
- `NODE_ENV=test node --test server/tests/codex-lens-macros.test.js` — 17/17 passing, unchanged (`lore.get`'s contract needed no adjustment).
