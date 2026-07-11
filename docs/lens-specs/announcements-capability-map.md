# Announcements lens — capability map (backfill, 2026-07-11)

## What this lens actually is

An operator/roadmap announcements board — feed + filter tabs + a roadmap
rail + a compose flow — over the real `announcements` domain
(`server/domains/announcements.js`, 91 LOC, 3 macros). Publishing is
admin-only, enforced server-side in two independent places: the macro
handler (`announcements.post`, checks `ctx.actor.role`) and the REST mirror
`POST /api/announcements` (`server.js:52528-52544`, `requireAuth()` +
`role !== "admin"` → 403). Reads (`GET /api/announcements`) are public. A
heartbeat (`announcement-broadcaster`, freq 60, scope global, per
CLAUDE.md) dequeues unbroadcast rows and emits `concord:announcement` for
realtime refresh; kill-switch `CONCORD_ANNOUNCEMENTS_ENABLED=0`.

This lens was rebuilt in an earlier wave of the Frontend Rebuild Program
(commit `8856d667`, "feat(announcements): rebuild... wire the compose/post
flow", Phase 3 Wave 1, 2026-07-09) — before the
`docs/lens-specs/*-capability-map.md` doc convention existed. This doc
backfills that gap against the current code.

**Frontend:**
- `concord-frontend/app/lenses/announcements/page.tsx` — 278 LOC. Feed +
  filter tabs + roadmap rail + compose button; loading/error/empty/
  populated states; deep-link (`?id=`) resolution with fallback to
  `announcements.get`.
- `concord-frontend/components/announcements/AnnouncementCard.tsx` (84 LOC)
  — feed entry with collapse/expand for long bodies, copy-link, highlight
  ring.
- `concord-frontend/components/announcements/ComposePanel.tsx` (207 LOC) —
  the compose modal: kind selector, title, markdown body, optional expiry,
  optional DTU attachment id; posts directly to `POST /api/announcements`;
  surfaces real backend rejection reasons rather than pre-gating client-side.
- `concord-frontend/components/announcements/RoadmapRail.tsx` (43 LOC) —
  sidebar list of `kind='roadmap'` items.
- `kind-meta.ts` (11 LOC) + `types.ts` (53 LOC) — supporting.

**Backend macro registrations** (`server/domains/announcements.js`):
`announcements.list` (:43, public read), `announcements.get` (:58, public
read, single item — deep-link fallback only, no dedicated REST GET/:id),
`announcements.post` (:76, admin-gated in-handler, delegates to
`server/lib/announcements.js#publishAnnouncement` — validates `kind`
against `VALID_KINDS`, trims/caps title 200 / body 8000 chars, rejects
empty).

## Findings — verify pass, no defect

**Admin authz — genuinely enforced server-side, not client-side theater.**
This project has had a recurring bug class where an admin UI *looks*
gated but the backend macro has no real server-side role check (see the
`security` and `repair-telemetry` capability-map docs from the same audit
wave for two prior real instances). Checked specifically for it here:
`ComposePanel` deliberately does **not** pre-check role client-side (per
its own header comment — "attempt, then degrade honestly"), so the entire
enforcement burden sits on the backend — and the backend does enforce it,
independently, on both the macro path and the REST path. Backed by
`server/tests/announcements-domain-macros.test.js` (non-admin/anon caller
→ `admin_only`, verified via row-count that nothing was written).

**Wiring cross-check**: all 3 macros have a real caller. `list` → the
page's initial fetch + realtime refetch on `concord:announcement`. `get` →
deep-link fallback via `lensRun`. `post` → `ComposePanel` via REST POST
(same underlying `publishAnnouncement` function the macro calls). Zero
orphan macros — the domain only has 3 total.

**Compose/post flow — real, verified end to end.** `ComposePanel`
(kind/title/body/expiry/DTU-attachment form) → `POST /api/announcements` →
`publishAnnouncement` → `INSERT INTO announcements` → `{ok:true,id}` →
page highlights + toasts + refetches. This is the flow the historical
changelog entry describes as "previously unsurfaced" — confirmed real via
the rebuild commit diff, which added `ComposePanel.tsx` as literally the
first UI for `announcements.post`.

**Fabricated data**: none found. The only `grep` hits for
`Math.random`/`mock`/`fake`/`lorem`/`placeholder` are legitimate HTML
`placeholder=` input-hint attributes and a SQL `placeholders` variable name
(parameterized-query `?` list) — no fake data in any render path.

**Generic-scaffold check**: clean — no `<UniversalActions>`,
`<LensFeaturePanel>`, or `ManifestActionBar`/`AutoActionStrip`/
`RecentMineCard` trio in any announcements file. All 4 components are
bespoke.

**Historical-claim verification**: confirmed via commit `8856d667`, whose
message states the exact capability-audit finding CLAUDE.md's ledger
summarizes ("`announcements.post` ... was UNSURFACED — no way to create an
announcement existed in the UI"). Diff: 6 files, +602/-85, adding the 4 new
components and rewiring `page.tsx`.

**Overall verdict**: fully wired, no defect. All 3 macros are DESIGNED
(not generic), admin authz is real and server-side on both the macro and
REST paths, the compose/post flow is real and tested, and no fabricated
data exists anywhere in the lens.

## Verification (run directly, 2026-07-11)

- `grep -n "registerLensAction(\"announcements\"\|register(\"announcements\"" server/domains/announcements.js server/server.js` — 3 macros registered at `server/domains/announcements.js:43,58,76`; none registered inline in `server.js`.
- `wc -l server/domains/announcements.js` — 91.
- Backend tests found: `server/tests/announcements-domain-macros.test.js` (180 LOC — admin-gate, validation, list/kind-filter, dequeue-broadcast), `server/tests/announcements.test.js` (lib-level `publishAnnouncement`/list coverage).
- `node --test server/tests/announcements-domain-macros.test.js` — **all passing**, including the admin-gate rejection cases.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged (documentation-only pass, no code touched).
- `node scripts/grade-ux-polish.mjs --honest` then inspected `audit/ux-polish-honest.json` for the `announcements` entry — `tier:"polished"`, `isGenericScaffold:false`. `audit/` reverted afterward (`git checkout -- audit/`).
