# news — Feature Gap vs Apple News / Ground News

Category leader (2026): Apple News (personalized reader) + Ground News (bias comparison). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/news.js` — ~29 macros: biasDetection, eventExtraction, narrativeTracking, GDELT headlines, daily-briefing, article CRUD/search, channel follow, topic follow, feed, today-digest, recommended, trending, article save/read/react, reading history/stats, interests, news-dashboard.

## Has (verified in code)
- Live news feed — GDELT global news articles → DTUs, headlines, GDELT explorer
- Personalization — channel follow, topic follow, interests, recommended, today-digest, trending
- Reading experience — save articles, mark read, reading history + stats, react to articles
- Briefings — AI daily briefing, news briefing component
- Analysis — bias detection, event extraction, narrative tracking across articles
- For-you / following / saved / today panels, news reader section, article cards

## Missing — buildable feature backlog
- [x] `[M]` Bias-spectrum comparison — show the same story across left/center/right sources side by side (Ground News core)
- [x] `[M]` Story clustering — group articles covering the same event into one story
- [x] `[S]` Audio / read-aloud mode for articles
- [x] `[M]` Push notifications — breaking-news and followed-topic alerts
- [x] `[S]` Offline reading / save-for-later sync
- [x] `[M]` Source transparency — ownership, factuality rating, blindspot detection
- [x] `[S]` Personalized digest scheduling — choose delivery time/cadence

## Parity
~95% of the Apple News + Ground News surface. Personalization, reading tracking, briefings, bias/narrative analysis, side-by-side bias-spectrum comparison, story clustering, audio read-aloud mode, push alerts, offline reading, source transparency, and personalized digest scheduling all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
