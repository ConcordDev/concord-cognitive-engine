# music — Feature Completeness Spec

Rival app(s): Spotify, Apple Music (2026)
Sources:
- https://www.spotify.com/ (library, playlists, queue, AI DJ, Blend, Smart Shuffle, sleep timer, radio, lyrics, Wrapped, audio settings)
- https://music.apple.com/ (library, playlists, listening stats, lossless/audio quality)
- https://musicbrainz.org/ (authoritative open metadata DB — artists, releases, ISRC)

The DAW / production side of music lives in the separate `studio` lens
(Ableton shadow); long-form spoken audio lives in `podcast`. This lens
is the **streaming + library + discovery** experience.

## Features

### Library
- [x] Add a track — title / artist / album / genre / duration (macro: music.track-add)
- [x] List + search + filter library by genre / artist / liked / query (macro: music.track-list)
- [x] Track detail (macro: music.track-detail)
- [x] Delete a track — also removes it from every playlist (macro: music.track-delete)
- [x] Like / unlike a track (macro: music.track-like)
- [x] Liked Songs view (macro: music.liked-songs)

### Playlists
- [x] Create a playlist — name / description / collaborative flag (macro: music.playlist-create)
- [x] List playlists with track count + total duration (macro: music.playlist-list)
- [x] Add / remove a track to a playlist (macro: music.playlist-add-track)
- [x] Playlist detail with resolved tracks + duration (macro: music.playlist-detail)
- [x] Reorder tracks within a playlist (macro: music.playlist-reorder)
- [x] Delete a playlist (macro: music.playlist-delete)

### Playback & queue
- [x] Play a track — increments play count, records history, sets now-playing (macro: music.play-track)
- [x] Scrub / report playback progress (macro: music.playback-progress)
- [x] Now-playing state (macro: music.now-playing)
- [x] Queue — add (with play-next), list, clear (macro: music.queue-*)
- [x] Timed + plain-text lyrics — set / get, active-line highlight in the player (macro: music.track-lyrics-set / track-lyrics-get)

### Discovery & AI
- [x] AI DJ — Smart Shuffle: weighted mix of liked / familiar / fresh tracks with a DJ intro line (macro: music.smart-shuffle)
- [x] Radio — seed a continuous station by track / artist / genre (macro: music.radio-start / radio-status)
- [x] Daily Mix — genre-affinity discovery excluding recently played (macro: music.daily-mix)
- [x] Recommendations — seed-based or taste-profile ranking (macro: music.recommend)
- [x] Blend — round-robin merge of liked + most-played (or chosen playlists) into a shared playlist (macro: music.blend)
- [x] Browse by genre hub (macro: music.genre-hub)

### Listening insights
- [x] Recently played — deduped, newest-first (macro: music.recently-played)
- [x] Top tracks + top artists ranked by play count (macro: music.top-tracks / top-artists)
- [x] Listening stats — total plays, minutes/hours, by-genre split (macro: music.listening-stats)
- [x] Wrapped — per-year recap with top tracks + artists + minutes (macro: music.wrapped)
- [x] Music dashboard — aggregate library / liked / playlist / play counts (macro: music.music-dashboard)

### Artists
- [x] Follow / unfollow artists (macro: music.artist-follow)
- [x] Followed-artist list with library track counts (macro: music.artist-list)
- [x] Real MusicBrainz artist search (macro: music.mb-search-artist)
- [x] Artist releases — albums / EPs / singles by MBID (macro: music.mb-artist-releases)
- [x] ISRC recording lookup (macro: music.mb-lookup-by-isrc)

### Settings
- [x] Audio settings — crossfade, gapless, normalize, mono, quality (low/normal/high/lossless) (macro: music.audio-settings-get / audio-settings-set)
- [x] Sleep timer — set / get countdown / cancel (macro: music.sleep-timer-set / sleep-timer-get / sleep-timer-cancel)

### Music theory tools (Concord-native extras)
- [x] BPM analysis from beat timestamps (macro: music.bpmAnalyze)
- [x] Krumhansl-Schmuckler key detection (macro: music.keyDetect)
- [x] Chord progression matching (macro: music.chordProgress)
- [x] Energy-curve setlist planner (macro: music.setlistPlan)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Stream real licensed audio | record-label licensing + a streaming CDN | full per-user library / playlist / queue / playback ledger; play-count + history drive Daily Mix, AI DJ, Radio, Wrapped |
| Cross-user Blend with a friend | a second authenticated user's library in the same call | single-user Blend round-robins the user's own taste sources (liked + most-played, or chosen playlists) into a shared playlist |
| Connect / cast to external devices | hardware + a device-discovery protocol | audio settings (crossfade / gapless / quality) persisted per user |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/music.js` clean. 49 macros
  (theory + MusicBrainz + streaming library + discovery/AI + insights + settings).
- 2026-05-20: Tests — `tests/music-streaming-domain-parity.test.js` +
  `tests/music-domain-parity.test.js` 34/34 green (library / playlists /
  playback+queue / artists+stats / discovery / lyrics synced+plain /
  radio seed-weighting / smart-shuffle queue+DJ line / sleep-timer lifecycle /
  blend round-robin / recommend seed ranking / genre-hub / audio-settings
  defaults+clamping).
- 2026-05-20: Frontend — `MusicStreamingSection` 4-tab shell (Library /
  Now Playing / Radio & DJ / Stats & Discover); new `MusicRadioPanel`
  surfaces AI DJ, seeded Radio, Sleep Timer, Blend, genre browse, audio
  settings; `MusicPlayerPanel` renders synced lyrics with active-line
  highlight. `npx tsc --noEmit` exit 0.
