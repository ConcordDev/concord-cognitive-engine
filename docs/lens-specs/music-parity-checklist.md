# Music Lens — Apple Music Parity Checklist

**Reference app:** Apple Music (also cross-referenced against Spotify for
social/pro features).

**Parity statement (project owner):** _"the only difference should be catalog
size, nothing else."_ Every consumer-app capability must be a designed,
real-data feature over the `music` domain — not a generic button strip and not
a fabricated success. Catalog size is the only permitted gap.

**Architecture note:** the real streaming app lives in
`components/music/MusicStreamingSection.tsx` (a 6-tab hub — Library, New
Releases, Now Playing, Radio & DJ, Stats & Discover, Pro Suite), mounted from
`app/lenses/music/page.tsx:634`. The Pro Suite tab (`MusicParityPanel.tsx`)
carries the 17-feature Spotify-parity backlog. All UI below dispatches real
`music` macros via `lensRun`.

## This session's 7 scoped items

| # | Item | Disposition | Justification (file:line) |
|---|------|-------------|---------------------------|
| 1 | Retire generic "Music Analysis" strip duplicate | WIRED-FROM-UNSURFACED (retired dead UI) | Purpose-built `MusicActionPanel` (covers all 4 macros: bpmAnalyze/keyDetect/chordProgress/setlistPlan) is mounted at `app/lenses/music/page.tsx:2072`; deleted the raw 4-button strip + dead `handleAction`/`actionResult`/`isRunning`/`runAction` and the now-unused `useRunArtifact`/`Loader2` imports. |
| 2 | Collaborative playlist creation | WIRED-FROM-UNSURFACED | Backend `playlist-create` already accepts `collaborative` (`server/domains/music.js:400`); added a Collaborative checkbox threaded into the create call at `components/music/MusicLibraryPanel.tsx` `createPlaylist`. |
| 3 | Wire jam-sync (real-time playback position) | WIRED-FROM-UNSURFACED | `jam-sync` (`server/domains/music.js:1530`) had zero callers; added a 6s polling effect in `MusicParityPanel.tsx` SocialTab that pushes the host's live `now-playing` position and pulls synced jam state, plus a visible "● Synced" status line. |
| 4 | Queue: play-next + clear + reorder | WIRED-FROM-UNSURFACED | `queue-add`'s unused `next` flag (`server/domains/music.js:533`) now drives a "Play next" action in `MusicLibraryPanel.tsx`; "Clear queue" (`queue-clear`) + up/down reorder added to the queue UI in `MusicPlayerPanel.tsx`. No queue-reorder macro exists, so reorder rebuilds via `queue-clear` + ordered `queue-add` (no new backend macro invented). |
| 5 | Wire the 3 zero-caller macros | WIRED-FROM-UNSURFACED | `track-detail` (`music.js:358`) → clickable track row opens a detail modal in `MusicLibraryPanel.tsx`; `liked-songs` (`music.js:386`) → collapsible "Liked Songs" section in `MusicLibraryPanel.tsx`; `top-artists` (`music.js:606`) → "Top artists" section in `MusicStatsPanel.tsx`. |
| 6 | Honest-relabel device-transfer | HONEST-RELABEL | `device-transfer` (`server/domains/music.js:1274`) only flips a local `active` flag in the caller's own STATE — no cross-session/cross-browser handoff exists. Relabeled the EngineTab section "Cross-Device Handoff"→"Playback Devices", "Transfer"→"Set active", "● Playing here"→"● Active", with an in-code note in `MusicParityPanel.tsx` (`setActiveDevice`). No new transfer infra built (out of scope). |
| 7a | Surface `music.feed` (New Releases) | WIRED-FROM-UNSURFACED | `music.feed` (`server/domains/music.js:1779`, Apple marketing RSS → real top-album DTUs) had zero callers; added a "New Releases" tab (`MusicStreamingSection.tsx`) mounting new `MusicNewReleasesPanel.tsx`, which renders the ingested album DTUs (queried by `top-albums` tag) and ingests fresh via `feed`. Honest empty/error states — no fabricated data. |
| 7b | Honest-copy audio-quality labels | HONEST-RELABEL | `audio-settings-set`'s `quality` field (`server/domains/music.js:975`) is a stored preference with no bitrate/format enforcement. Softened the selector copy in `MusicRadioPanel.tsx:262` ("Audio quality"→"Preferred quality") + added an honest note that Concord doesn't itself decode/stream at a fixed fidelity. |

## Also found while working (not in the 7-item scope)

| Item | Disposition | Justification |
|------|-------------|---------------|
| Revenue dashboard uses hardcoded figures | DEFERRED-SCOPED-BUILD | `app/lenses/music/page.tsx` Revenue view renders fabricated totals ($15,840) + a hardcoded transaction list. Violates honest-by-construction; should be wired to the real `economy_ledger`/royalty-cascade surface in a follow-up rebuild unit. Not touched this session (out of the 7-item scope). |
| Home stat-card waveform bars use `Math.random()` in render | DEFERRED-SCOPED-BUILD | `page.tsx` Home decorative waveforms animate off `Math.random()` — purely ornamental (not presented as data), but the frontend fake-data detector may flag `Math.random` in a render path. Cosmetic; flagged for the full home-view rebuild. |
| SessionView clip grid uses hardcoded demo clips | DEFERRED-SCOPED-BUILD | `page.tsx` Session view passes a static `clips` map (drums/bass/keys demo). It's an Ableton-shape prototype with no session backend; belongs to a later Studio/DAW rebuild unit. |

## Coverage summary

- **Designed features surfaced this session:** 9 (4 analysis macros consolidated
  + collaborative playlists + jam-sync + queue play-next/clear/reorder +
  track-detail/liked-songs/top-artists + New Releases feed).
- **Honest relabels:** 2 (device "handoff", audio quality).
- **Dead UI retired:** 1 (generic Music Analysis strip).
- **Every new UI element dispatches a real `music` macro via `lensRun`** — no
  fabricated data, no fake success states.
