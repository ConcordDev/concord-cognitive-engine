# Film Studios Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'registerLensAction("film-studios"' server/domains/filmstudios.js
```
→ **97** macros in `server/domains/filmstudios.js` (1,700 lines, one of the
larger domain files in the codebase) — the file name (`filmstudios.js`, no
hyphen) doesn't match the registered domain string (`film-studios`,
hyphenated) or the lens directory name, which is why
`node scripts/lens-unsurfaced.mjs --lens film-studios` reports "No
registered macros found" (its `--lens` filter matches by filename stem:
`files.filter(f => f === 'film-studios.js')`, which never matches
`filmstudios.js`). Verified manually instead — extracted all 97 action names
via grep, then checked each against the frontend with the same loose
token-match the script itself uses. This is a **StudioBinder + DaVinci
Resolve + Frame.io 2026-parity** production suite: projects, screenplay
scenes + industry breakdown tagging, shot lists, stripboard scheduling +
call sheets + Day-Out-of-Days, budget, cast & crew, an edit timeline with
real timecode (multi-track, ripple-delete, trim, multicam), timecoded
review (versions + notes), festival submissions, and a watch-party sync
layer.

## Reference apps

**StudioBinder** (breakdown, scheduling, call sheets, DOOD) + **DaVinci
Resolve** (multi-track timeline, timecode, multicam grouping, proxy/full
quality) + **Frame.io** (versioned review with timecoded notes).

## Classification (before this pass)

**Overwhelmingly strong — the best-covered lens in this wave by macro
count.** Read all of `app/lenses/film-studios/page.tsx` (888 lines) and all
12 `components/film-studios/Fs*.tsx` panels (3,630 lines total).
`grep -n "Math.random\|MOCK\|mock\|fake\|Lorem\|lorem"` → zero hits.
**90 of 97 macros (93%) were already genuinely wired** to real forms with
real results before this pass — no generic artifact-store detour anywhere
in the lens, no dead button walls. Of the 7 originally unsurfaced:

1. **3 were genuinely, correctly redundant** (not defects — the panel
   already fetches a strict superset from a different macro):
   - `clip-list` (flat, un-timecoded clip list) is subsumed by `cut-list`
     (per-track grouped, running-timecode-computed clip list) —
     `FsEditPanel` already renders from `cut-list`.
   - `breakdown-summary` (category → count) is subsumed by
     `element-list-report` (category → named elements → scene list) —
     `FsScreenplayPanel` already renders from `element-list-report`.
   - `shoot-day-list` (flat day list) is subsumed by `stripboard` (day list
     with assigned scenes + page count, spread from the same day record) —
     `FsSchedulePanel` already renders from `stripboard`.
   Confirmed by reading each pair of handlers side-by-side in
   `server/domains/filmstudios.js` — the "redundant" macro's fields are a
   strict subset of the one actually used.
2. **4 were genuine, real gaps** — real backend capability with no UI path:
   - `location-update` — locations could be created and deleted in
     `FsProductionPanel`, but never edited (a typo meant delete-and-recreate).
   - `scene-update` — scenes could be created and deleted in
     `FsScriptPanel`, but never edited (int/ext, location, time-of-day,
     page count, description all permanently fixed at creation).
   - `clip-set-media` — `FsMediaPanel` (register source media + build
     multicam angle groups) and `FsEditPanel` (build a timecoded timeline
     of freeform-named clips) were two disconnected islands; nothing linked
     a timeline clip to its actual registered source media, so the "which
     file is this cut actually pointing at" question — the whole point of
     an NLE media-link — was unanswerable from the UI.
   - `vision` (LLaVA still-image analysis, domain-scoped prompt: "describe
     scene composition, lighting, cinematographic technique, mood, and
     narrative elements") — real, registered, tested at the backend
     (`server/tests/film-studios-lens-macros.test.js`), never called
     anywhere in the frontend.

## What changed

- **`concord-frontend/components/film-studios/FsProductionPanel.tsx`** —
  added inline edit mode per location row (pencil icon → name/address/
  contact fields + save/cancel), wired to `location-update`.
- **`concord-frontend/components/film-studios/FsScriptPanel.tsx`** — added
  an edit form inside a scene's expanded detail view (int/ext, location,
  time-of-day, page-eighths, description + save), wired to `scene-update`.
- **`concord-frontend/components/film-studios/FsEditPanel.tsx`** — now
  fetches the project's registered media (`media-list`) and adds a "Source
  media" dropdown to each clip's expanded edit controls, wired to
  `clip-set-media` (which also carries an optional `mcamAngle`). To make the
  current link visible without a second round-trip, `cut-list`'s per-clip
  output was extended (in `server/domains/filmstudios.js`) to include the
  `mediaId`/`mcamAngle` fields the clip record already stored internally —
  an additive, backward-compatible change (existing tests assert specific
  fields present, not the absence of others; re-run clean).
- **`concord-frontend/components/film-studios/FsMediaPanel.tsx`** — added
  an "Analyze" action on image-kind media with a source URL, calling
  `vision` and rendering the real LLaVA description inline, with an honest
  degrade message ("Analysis unavailable: …") when the vision brain isn't
  reachable rather than a silent failure or fabricated description.
- **`server/tests/filmstudios-domain-parity.test.js`** — `location-update`
  had zero test coverage before this pass; added 2 tests (edits in place
  without creating a duplicate row, preserves untouched fields; fails
  honestly on an unknown id). Added a 3rd test pinning the new `cut-list`
  `mediaId`/`mcamAngle` exposure end-to-end (link → visible in cut-list →
  unlink → cleared in cut-list) — the contract the new `FsEditPanel` UI
  now depends on.

## Verification

- `cd concord-frontend && npx eslint components/film-studios/FsProductionPanel.tsx components/film-studios/FsScriptPanel.tsx components/film-studios/FsEditPanel.tsx components/film-studios/FsMediaPanel.tsx` — clean, exit 0.
- `cd concord-frontend && npx tsc --noEmit -p .` filtered to `film-studios/` — 0 errors (one pre-fix type mismatch on the vision-result error shape found and fixed during this pass).
- Manual re-grep of all 7 originally-unsurfaced macro names: `location-update`, `scene-update`, `clip-set-media`, `vision` now surfaced; `breakdown-summary`, `clip-list`, `shoot-day-list` remain unsurfaced by design (documented above, verified redundant by reading the handler pairs).
- `node scripts/verify-lens-backends.mjs` → unaffected, `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260.
- `cd server && node --test tests/filmstudios-domain-parity.test.js tests/film-studios-lens-macros.test.js` → `65 pass / 0 fail` (was 62; +3 new tests, 0 regressions from the additive `cut-list` field change).
- Did not touch any of the other 8 frontend panel files
  (`FilmStackFeed.tsx`, `FilmStudioSection.tsx`, `FsBudgetTeamPanel.tsx`,
  `FsDistributionPanel.tsx`, `FsReviewPanel.tsx`, `FsShotsPanel.tsx`,
  `FsScreenplayPanel.tsx`, `FsWatchPartyPanel.tsx`) or `page.tsx` — no gap
  found in any of them after checking their macro coverage.

## 2026-11-20 — The Production Office redesign

The lens is now one app, `components/film-studios/office/Office.tsx` (page.tsx re-exports it), following `docs/LENS_REDESIGN_PLAYBOOK.md`. What changed:

- **Real footage.** Uploads go up as the request body (`POST /api/media/upload-raw`) and become footage through `media-register {platformMediaId}`, keeping the file's real duration and frames. The Next proxy's default 10 MB body cut (which truncated every larger film) is raised to the backend's 200 MB raw cap (`next.config.js` `proxyClientMaxBodySize`), and nginx gets a matching `location = /api/media/upload-raw` (the general 25M limit stays for JSON).
- **A cut you can watch.** `cut-list` now gives each clip its stream, kind, source in-point and timeline seconds; the program monitor plays V1 clip by clip and marks clips with no footage.
- **Review on real picture.** Versions point at an uploaded export or a sequence; notes carry the exact timecode and jump the picture there.
- **Screenings.** Codes are `FILM-` + 8 hex characters; `party-join` joins by code; `party-sync` is host-only; chat authors are the signed-in person, never a typed name. A version screening lets its guests stream the host's private cut while it runs (`screeningUserIds` on the media, removed when the party is deleted).
- **Release and sell.** `film-release-create/list/get/buy/update/withdraw/party` (`server/domains/film-releases.js`): free or priced in CC through the marketplace (95% to the filmmaker), preview 15–90 s enforced by the stream, a poster from an uploaded image. `canAccessMediaDTU` now honours licences, so a buyer keeps a film after it is withdrawn.
- **Folded / removed.** `FsReviewPanel` and `FsWatchPartyPanel` are replaced by the Screening room; `FilmDeskPanel` and `FilmStudioSection` (never mounted) are deleted. `FilmStackFeed` (video.stackexchange.com Q&A) is mounted in the Cutting room as "Craft questions". `FsMediaPanel` (now in the Cutting room) and `FsProductionPanel` (now on The board) are restyled to the office.
- **Tests.** `server/tests/depth/film-releases-behavior.test.js` (footage, cut playback fields, versions, parties incl. stream access at the access rule, priced/free releases, money); `concord-frontend/tests/film-studios-office.test.tsx` (14 tests across the rooms and cinema).
- **Browser drive (real files, three people).** The monitor played the 12 s clip then switched to the 8 s clip at the 5 s cut. A note pinned at 00:00:21:12. A guest joined by code and stayed within 0.2 s of the host, with no controls; the guest's own `party-sync` was refused. A 3 CC film sold: the fan went 10 → 7 and the maker 0 → 2.85. Non-buyers got 3.4 MB of the 17 MB file, and the player stopped at exactly 30.0 s; the buyer got all 17 MB. A stranger was refused from the buyer's screening. No sideways scroll at phone width.
