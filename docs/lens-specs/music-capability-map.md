# Music lens — capability map (backfill, 2026-07-11)

> **Re-verification (HANDOFF-3 batch L10, 2026-10-28, against main 0bd898fc):**
> The audit below is kept as history. Its headline — "3 fake-data spots
> are STILL LIVE" — is **stale**: a later rebuild moved the lens into
> `components/music/MusicWorkspace.tsx`, and all three spots are
> verified FIXED in current code:
>
> 1. **Revenue dashboard** — now a real query:
>    `MusicWorkspace.tsx` ("Revenue Dashboard: real creator earnings
>    (GET /api/creator/dashboard)") with loading/error states. The
>    hardcoded `$15,840.00`-style cards and fabricated "Recent
>    Transactions" are gone (no hits in the tree).
> 2. **Upload waveform** — uploads are really decoded
>    (`decoded.waveformPeaks` → `realWaveformPeaks` in the workspace's
>    upload flow); `NowPlayingBar` renders peaks only when the track
>    carries them. No `Math.random()` waveform remains in the music
>    frontend. (The old 0:00/0:00 playback complaint has the same
>    root: duration now flows from the decoded upload / track
>    metadata into the player store.)
> 3. **SessionView** — invoked with the user's own library: cells are
>    real tracks assigned via an empty-slot picker, clips/scenes are
>    persisted session state, and launch/mute/solo/rename handlers
>    are all wired to the same playback engine as the rest of the
>    lens ("nothing here is decorative" — the component's own
>    comment, and the code bears it out).
>
> Fresh surfacing scan: **78/79 domain macros named in the frontend.**
> The one unsurfaced is `publish-as-stem` — the write half of the
> adaptive-music bridge (music.js:1855ff): its read half
> (`list-published-stems`) is wired in
> `components/world/AdaptiveMusicBridge.tsx`, but no Studio DAW
> export (or any other UI) calls the publish macro, so authored
> stems can never land through the product today. A genuine missing
> feature (the bridge's step 2), recorded for the fix queue — not
> papered over here.
>
> **Shipped in this batch:** the concept's serif headline — "What are
> we hearing, {username}" — as the MusicWorkspace header
> (`data-testid="music-greeting"`). No new FE test: the workspace has
> no existing mount harness (its tests are unit/mode level), and the
> change is a header text swap in the shell — Mac tsc + live walk
> cover it (see the PR's "Couldn't run here").
>
> Server suites run locally this pass: music-domain-parity,
> music-collab-playlist, art/fractal parity below — 109 pass in the
> combined L10 run. Five music failures are live-network ingestion
> tests (iTunes/LRCLIB fetches; no egress in the audit sandbox) and
> `music-publish-as-stem.test.js` cannot load here (missing
> `better-sqlite3`) — all Mac-run, none touched by this batch.


## What this lens actually is

An Apple-Music/Spotify-parity streaming app over the `music` domain
(`server/domains/music.js`, 1,987 LOC, 79 macros; plus 5 DAW-export macros
registered inline in `server.js`: analyze/render/publish/export_stems/
generate_arrangement — a separate legacy cluster). The real app lives in
`components/music/MusicStreamingSection.tsx` (a 6-tab hub — Library, New
Releases, Now Playing, Radio & DJ, Stats & Discover, Pro Suite), mounted
from `app/lenses/music/page.tsx` (2,217 LOC). `MusicParityPanel.tsx` (902
LOC) is the Pro Suite tab carrying a 17-feature Spotify-parity backlog
(jam-sync, collab-edit, share cards, stream analytics). 16 component files
total under `components/music/`, ranging from `AlbumView.tsx` (113 LOC) to
`MusicParityPanel.tsx` (902 LOC).

This lens had a "Wave 0a flagship" rebuild in an earlier wave of the
Frontend Rebuild Program (commit `82eb753b`, 2026-07-09) — before the
`docs/lens-specs/*-capability-map.md` doc convention existed generally,
though this particular rebuild *did* leave behind its own scoped checklist
doc, `docs/lens-specs/music-parity-checklist.md`, which this capability
map supersedes/complements. That checklist doc is itself honest about
scope — see the finding below.

## Finding — 7 parity gaps closed, real; 3 fake-data spots are STILL LIVE, not fixed

The Wave 0a commit closed 7 scoped Apple Music parity items, all verified
real in current code:

1. **Generic "Music Analysis" strip retired** — the dead 4-button
   `handleAction`/`actionResult` strip was deleted; `MusicActionPanel.tsx`
   (241 LOC) now covers the same 4 macros (`bpmAnalyze`/`keyDetect`/
   `chordProgress`/`setlistPlan`) as a purpose-built panel.
2. **Collaborative playlists** — `playlist-create` accepts `collaborative`
   (`server/domains/music.js:400`); `MusicLibraryPanel.tsx` threads a
   Collaborative checkbox into the create call. Cross-user resolution
   (`findAnyPlaylist`/`findTrackAnyUser`, `music.js:313-320`) is real.
3. **jam-sync** — `server/domains/music.js:1530` had zero callers before;
   `MusicParityPanel.tsx`'s SocialTab now runs a real 6s poll pushing/
   pulling host playback position, with a visible "● Synced" state.
4. **Queue play-next / clear / reorder** — real: `queue-add`'s `next`
   param, `queue-clear`, and reorder-via-clear+re-add (no new macro
   invented for reorder, an honest implementation choice).
5. **3 zero-caller macros wired** — `track-detail` → a clickable-row
   detail modal in `MusicLibraryPanel.tsx`; `liked-songs` → a collapsible
   section in the same file; `top-artists` → a section in
   `MusicStatsPanel.tsx`.
6. **Device-transfer honestly relabeled** — `device-transfer`
   (`music.js:1274`) only flips a local `active` flag with no real
   cross-session handoff; the UI copy was changed from "Cross-Device
   Handoff"/"Transfer" to "Playback Devices"/"Set active" rather than
   implying a capability that doesn't exist.
7. **New Releases surfaced** — `music.feed` (`music.js:1779`, real Apple
   marketing-RSS ingestion into DTUs) had zero callers before;
   `MusicNewReleasesPanel.tsx` now renders the ingested album DTUs with
   honest empty/error states.

**The 3 fake-data spots flagged by an older, separate audit task are
confirmed STILL LIVE — not fixed by Wave 0a.** The Wave 0a rebuild's own
checklist doc (`docs/lens-specs/music-parity-checklist.md`, "Also found
while working" table) explicitly scoped all three OUT with a
`DEFERRED-SCOPED-BUILD` disposition, and no later commit has touched them
(`git log` on the relevant files shows nothing after `82eb753b`):

1. **Revenue dashboard hardcoded figures — live defect.**
   `app/lenses/music/page.tsx:1867-1912` renders 4 stat cards as literal
   hardcoded strings (`value: '$15,840.00'`, `'$12,200.00'`, `'$2,430.00'`,
   `'$1,210.00'`), and `:1966-1995` hardcodes a fake "Recent Transactions"
   list with fabricated buyers (`'User-4821'`, `'Studio-Twelve'`) and
   tracks (`'Substrate Dreams'`, `'Lattice Pulse'`). Only the royalty-
   cascade explainer table and the "Royalty Obligations Preview"
   (`royaltyPreview` from a real `previewRoyaltyObligations()` lib call)
   are genuine on this screen.
2. **Decorative Math.random() waveforms — live defect on the meaningful
   case.** `page.tsx:524`, inside the **upload flow**:
   `waveformPeaks: Array.from({ length: 200 }, () => Math.random() * 0.8)`
   — a fake waveform generated for a real user-uploaded track instead of
   real audio analysis. This is the actionable instance. A second, lesser
   hit at `page.tsx:740-742` drives purely ornamental animated bars behind
   the Home stat cards (not labeled as track audio, so a chrome/render-
   path issue rather than data fabrication, but still `Math.random()` in a
   render path). `lib/music/store.ts:21,27` are unrelated legitimate
   randomness (id generation, Fisher-Yates shuffle).
3. **SessionView demo clips — live defect at the call site, not inside
   the component.** `SessionView.tsx` (346 LOC) is itself a clean,
   fully prop-driven presentational component. The defect is where it's
   invoked: `page.tsx:967-996` passes 100% hardcoded tracks (drums/bass/
   keys/pads/lead/fx), scenes (intro/verse/chorus/bridge/outro), and fake
   clip labels (`'kick-only'`, `'rhodes'`, `'hook A'`, `'riser'`) with
   **zero handler props wired** — every click in the session grid is a
   no-op against a static demo grid.

**This is a genuine open finding, not a stale one — flagging for a
follow-up rebuild pass**, per the checklist doc's own honest disposition
and confirmed by direct code inspection of the current tree.

## Other findings

**Wiring cross-check**: 79 domain macros + 5 inline DAW macros = 84 total.
The "3 zero-caller macros wired" and "generic-strip duplicate retired"
claims both check out (see above).

**Generic-scaffold check**: clean overall — the page is overwhelmingly
bespoke (streaming shell + Ableton-shape SessionView + artist explorer +
DAW panels). `RecentMineCard`/`AutoActionStrip` are present but wrapped in
an `sr-only aria-hidden` div (inert polish sentinels from an earlier
sprint); `<UniversalActions>` appears only as a small conditional compact
overlay during live realtime sessions, not as the page's primary surface.
Does not trigger the `GENERIC_TRIO`-as-primary-surface pattern.

**Overall verdict**: the 7-item Wave 0a parity closure is real and holds
up in current code. The 3 fake-data spots from the separate, older audit
task are **still open, unresolved defects** — exact locations: revenue
dashboard `page.tsx:1867-1995`, upload-flow fake waveform `page.tsx:524`,
decorative stat-card waveform `page.tsx:740-742`, SessionView demo data
`page.tsx:967-996`. Per this task's scope (documentation only, no fixes),
these are recorded here as a genuine open finding for a follow-up pass,
not resolved and not silently dropped.

## Verification (run directly, 2026-07-11)

- `grep -c "registerLensAction(\"music\"\|register(\"music\"" server/domains/music.js` — **79**.
- `wc -l server/domains/music.js` — 1,987.
- `docs/lens-specs/music-parity-checklist.md` exists and independently corroborates the 3-fake-data-spot finding (its own "Also found while working" table, `DEFERRED-SCOPED-BUILD` disposition).
- Backend tests found: `server/tests/music-collab-playlist.test.js`, `server/tests/music-domain-parity.test.js`, `server/tests/music-publish-as-stem.test.js`, `server/tests/music-resonance.test.js`, `server/tests/music-streaming-domain-parity.test.js`, `server/tests/studio-publish-as-adaptive-music.test.js`, `server/tests/depth/music-behavior.test.js`, `server/tests/depth/music-ingest-behavior.test.js`.
- `node --test server/tests/music-domain-parity.test.js server/tests/music-collab-playlist.test.js` — **all passing**.
- `node scripts/verify-lens-backends.mjs` — `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260, unchanged (documentation-only pass, no code touched).
- `node scripts/grade-ux-polish.mjs --honest` then inspected `audit/ux-polish-honest.json` for the `music` entry — `tier:"polished"`, `isGenericScaffold:false` (the grader's mechanical check doesn't catch the specific fabricated-figures/fake-waveform defects above, which require semantic reading, not pattern matching — consistent with CLAUDE.md's note that the fake-data detector's strongest findings are pattern-based). `audit/` reverted afterward (`git checkout -- audit/`).
