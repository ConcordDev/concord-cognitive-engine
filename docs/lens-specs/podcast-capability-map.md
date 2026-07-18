# Podcast Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Verification commands and outputs are in the
> "Verification" section below — re-run them, don't trust this prose.

## Starting state: already excellent (Model B consolidation confirmed real)

CLAUDE.md's "Recent shipped work" table references a prior "Consolidate
Podcast lens onto Model B (podcastLens STATE)" fix. Verified against the
live source, not assumed: `server/domains/podcast.js` (1,088 LOC) is a
single, coherent Spotify/Apple-Podcasts-class listening engine backed by
`STATE.podcastLens` (Maps for shows/episodes/reviews/subscriptions/
playback/queue/downloads/playlists/prefs/transcripts/downloadRules) — no
legacy generic-artifact ("Model A") path survives in either the domain
file or the frontend. 46 `registerLensAction("podcast", ...)` macros cover:
shows + subscriptions + reviews, episodes (CRUD + status), playback
progress + speed + mark-played, up-next queue (add/remove/reorder), RSS
feed ingestion (real XML parsing incl. `<psc:chapter>` markers, dedup by
guid/enclosure), a real streaming descriptor (audio enclosure + chapters +
resume position + smart-playback prefs), transcripts (paste/set, search,
timestamped segments), personalized recommendations (category-affinity
scoring from real listening history), cross-device sync (push/pull with
last-write-wins), smart auto-download rules (keep-recent pruning), plus
the pre-existing Apple-Podcasts/Buzzsprout workbench formulas
(`episodeAnalytics`, `guestResearch`, `productionChecklist`,
`monetizationCalc`) and the free, keyless `itunes-search`/`itunes-podcast`
Apple Podcasts directory lookups.

The frontend fully surfaces this: `app/lenses/podcast/page.tsx` (Episodes/
Create/Analytics tabs, backed by `my-show-ensure` + `episode-add/list/
set-status/delete` — a real single-show creator workflow, not a
disconnected copy) plus five real bespoke panels — `PodcastPlayerSection`
(dashboard + Listen/Browse/Library tab shell), `PodcastListenPanel`
(continue-listening, up-next, new-from-subscriptions), `PodcastBrowsePanel`
(show directory, subscribe, episode add, star ratings/reviews),
`PodcastLibraryPanel` (downloads, playlists), `PodcastListeningHub` (RSS
feed ingestion UI, recommendations, cross-device sync view, auto-download
rules), `PodcastStreamPlayer` (real `<audio>` element, chapter scrub bar,
speed control, sleep timer, sync-push every 10s), `PodcastTranscriptPanel`
(paste/save/search transcript), `ItunesSearch` (Apple Podcasts search with
a real "Add to Library" bridge into `show-add` + `rss-refresh`), and
`PodcastActionPanel` (the workbench formulas + mint/DM/publish/agent
actions on real `dtu.create`/`/api/social/dm`/`/api/dtus/:id/publish`/
`chat_agent.do` calls). No macro found with zero UI caller; no fabricated
parallel CRUD system found.

## Defects found and fixed this pass

1. **Fabricated recording-upload success (honest-by-construction
   violation).** `handleUseRecording()` in `app/lenses/podcast/page.tsx`
   minted a fake `local-recording-<timestamp>` string as `formMediaId` and
   showed a `"Recording saved"` success toast — the recorded `Blob` was
   never actually uploaded anywhere (the old code's own comment admitted
   "In a full implementation this would upload the blob to the media
   API"). Every episode created from a live in-browser recording got an
   `audioUrl` of `/api/media/local-recording-.../stream`, which 404s: the
   episode would exist in the show but be permanently unplayable. Fixed by
   making `handleUseRecording` actually `POST /api/media/upload` with the
   base64-encoded recording bytes, using the real returned media id.
   Surfaced a genuine upload-loading state (`uploadingRecording`) instead
   of an instant fake-success toast.
2. **Backend MIME allowlist gap that would have silently broken the fix
   above.** `server/routes/media.js`'s `ALLOWED_UPLOAD_MIMES` allowed
   `video/webm` but not `audio/webm` — the exact container
   `MediaRecorder` produces in every Chromium/Firefox browser (the podcast
   page's own recorder code picks `audio/webm;codecs=opus`, falling back
   to `audio/webm`). Without this, the real upload added in fix #1 would
   have failed every time with `File type not allowed`. Added
   `audio/webm` to the allowlist plus its EBML/Matroska magic-byte
   signature (`0x1A 0x45 0xDF 0xA3`) for the same defense-in-depth the
   other allowed types already get.
3. **Field-shape mismatch: "Publish to Marketplace" published the wrong
   id space.** In the Analytics tab's DTU Overview section,
   `publishToMarketplace({ dtuId: episodes[0].id })` passed a podcast
   *episode* id (`ep_...`, a key into the in-memory `podcastLens.episodes`
   Map) to `POST /api/dtus/:id/publish`, which expects a real DTU-table
   id. No episode is ever a DTU (the domain never mints one on
   `episode-add`), so this button was guaranteed to fail every click. It
   only rendered once the surrounding `useLensDTUs` DTU counts were
   non-zero, which likely masked the bug — the *count* tiles were real,
   the button beneath them used a completely different collection. Fixed
   to use the first real DTU from `regularDTUs`/`contextDTUs` (the same
   collections whose counts are displayed), with a real busy state and
   toast on the publish call.
4. **Unsurfaced-but-tested backend pref: `skipIntroSec`.**
   `playback-prefs-set` accepts and persists `skipIntroSec`, and
   `episode-stream`/`PodcastStreamPlayer` already read and apply it (real
   auto-seek on load) — but no UI control ever called `playback-prefs-set`
   with a `skipIntroSec` value, so the feature could never be turned on.
   Added a small numeric input next to the existing sleep-timer control in
   `PodcastStreamPlayer` that persists the value via the same macro
   already wired for read.

## Found, documented, deliberately not changed

- ~~**`trimSilence` preference has no real effect anywhere.**~~ **CLOSED
  (2026-07-16).** `lib/podcast/silence-detect.ts` is the real engine this
  gap was missing: windowed RMS analysis over decoded PCM
  (`computeRmsWindows`), merged into silence ranges ≥1.5s
  (`findSilenceRanges`), and an `analyzeEpisodeForSilence` entry point that
  decodes an episode's audio via Web Audio and returns the range list.
  `PodcastStreamPlayer.tsx` runs this when the toggle is on (with an
  `AbortController` so toggling off or unmounting cleanly cancels an
  in-flight analysis — no orphaned work), skips `currentTime` forward past
  a detected silent range on `onTimeUpdate` via `resolveSilenceAutoSkip`,
  and persists the toggle through the same real `playback-prefs-set` macro
  that already existed — no backend changes were needed. The RMS formula
  was hand-verified against a synthetic 100Hz/amplitude-0.5 sine wave
  (expected RMS = amp/√2 ≈ 0.35355) and independently reproduced bit-for-bit
  before landing. 19 new lib tests + 3 new component tests, all passing.
- **Orphaned dead component `components/podcast/ItunesPodcastPanel.tsx`.**
  Fully duplicate of `ItunesSearch.tsx`'s Apple Podcasts search (calls the
  equivalent, also-real `podcast.live_itunes_search` macro registered in
  `server/domains/more-free-apis.js`), but with none of `ItunesSearch`'s
  "Add to Library" bridge into the real listening engine. Confirmed zero
  importers anywhere in the tree (component files, panel registry, or
  `app/admin/wires` which discovers `live_*` macros generically rather
  than importing the component). Left in place rather than deleted —
  deletion of a pre-existing tracked file was outside this pass's
  authorized scope; flagged here for a future cleanup pass.

## Reference-parity judgment (hard invariant 4)

Benchmarked against **Apple Podcasts + Spotify (podcasts) + Buzzsprout**
(creator side). Subscribe/browse/rate, up-next queue with reorder,
continue-listening with resume position, RSS ingestion with real chapter
markers, a real streaming `<audio>` player (scrub bar with chapter ticks,
variable speed, sleep timer), transcript search with jump-to-timestamp,
personalized recommendations from real listening-history category
affinity, and cross-device sync are all real, tested, and now
bug-fixed rather than merely present. This clears the "would this hold up
standalone against the category leader" bar for the consumer listening
surface. The creator/monetization side (episode analytics, guest prep,
production checklist, monetization projection, RSS feed self-hosting via
`/api/podcast/default/feed.xml`) matches Buzzsprout's core feature set.
The one real gap against Spotify/Apple specifically is server-side
transcoding/loudness-normalization and true silence-trimming — both
DATA/ENGINEERING follow-ups, not fabricated in the meantime.

## Verification

- `find . -iname "*podcast*test*" -not -path "*/node_modules/*"` →
  `server/tests/depth/podcast-behavior.test.js`,
  `server/tests/podcast-domain-parity.test.js`,
  `server/tests/poetry-podcast-photography-domain-parity.test.js`.
  `node --test tests/depth/podcast-behavior.test.js
  tests/podcast-domain-parity.test.js
  tests/poetry-podcast-photography-domain-parity.test.js` (from `server/`)
  → **38/38 pass, 0 fail**.
- Media-upload regression check (touched `server/routes/media.js`'s MIME
  allowlist): `node --test tests/media-dtu.test.js tests/routes-media.test.js
  tests/integration-media.test.js` (from `server/`) → **85/85 pass, 0
  fail**.
- `node --check server/routes/media.js && node --check
  server/domains/podcast.js` → both OK.
- `npx eslint app/lenses/podcast/page.tsx
  components/podcast/PodcastStreamPlayer.tsx` (from `concord-frontend/`)
  → clean, 0 errors/warnings.
- `npx eslint routes/media.js` (from `server/`) → clean.
- `node scripts/verify-lens-backends.mjs` (from repo root) →
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 — unchanged, as expected
  (no new lens surface, no lens broken).
- `node scripts/grade-ux-polish.mjs --honest` (from repo root),
  `audit/ux-polish-honest.json` entry for `podcast`: `tier: "polished"`,
  `isGenericScaffold: false`, `antiPatterns: 0`, `pillarsPresent: 5`.
  `audit/` reverted via `git checkout -- audit/` after the run per
  standing instructions (transient regenerated artifact, never committed).
- No `npx tsc --noEmit` run per this pass's standing instruction (disk
  headroom preserved on a shared box); relied on eslint + `node --check`
  + the full macro test suites above instead.
