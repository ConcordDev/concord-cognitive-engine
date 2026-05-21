# podcast — Feature Gap vs Apple Podcasts / Spotify

Category leader (2026): Apple Podcasts / Spotify (podcast listening + studio). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/podcast.js` — ~36 macros: iTunes directory search + lookup, show CRUD + subscribe, episode CRUD, playback tracking (update/mark-played/continue/speed), queue, downloads, playlists, ratings + reviews, new-episodes, listening stats, dashboard, plus episodeAnalytics/guestResearch/productionChecklist/monetizationCalc.

## Has (verified in code)
- Real Apple Podcasts directory search + podcast lookup via iTunes Search API (RSS feed URLs)
- Show subscribe/list/detail; episode list/detail; PodcastPlayerSection player
- Playback tracking: position update, mark-played, continue-listening, playback-speed set
- Up-next queue (add/remove/reorder), downloads (download/list/remove), playlists
- Show ratings + reviews; new-episodes detection; listening stats + dashboard
- Creator studio side: episode analytics, guest research, production checklist, monetization calculator; 3 tabs

## Missing — buildable feature backlog
- [ ] `[M]` RSS feed parsing + auto-refresh — actually ingest episodes from a subscribed show's RSS feed
- [ ] `[M]` Audio streaming player with chapters — stream the episode enclosure with chapter markers
- [ ] `[S]` Trim silence / skip intro / sleep timer — Apple Podcasts smart playback
- [ ] `[M]` Episode transcripts + search-in-transcript — generate or display transcripts
- [ ] `[S]` Personalized recommendations — suggest shows from listening history
- [ ] `[S]` Cross-device playback sync — resume position across sessions/devices
- [ ] `[S]` Smart download rules — auto-download new episodes of subscribed shows

## Parity
~55% of Apple Podcasts' feature surface. Real iTunes directory search plus a complete subscription/queue/playlist/playback substrate is strong, but it lacks RSS ingestion, a real streaming audio player with chapters, and transcripts.
