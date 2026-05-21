# artistry — Feature Gap vs Behance / ArtStation

Category leader (2026): Behance / ArtStation (creative portfolio + community). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/artistry.js` — macros `colorPaletteAnalysis`, `compositionScore`, `styleClassify`, `mediaInventory`; generic artifact store for artworks; Excalidraw canvas embed.

## Has (verified in code)
- Tabs: feed (chronological/discovery), assets, marketplace, studio, stats
- Artwork asset library with upload; Excalidraw whiteboard studio
- Marketplace surface for listing artwork with pricing
- Color-palette analysis, composition scoring, style classification
- WikimediaArt discovery panel (free public art); engagement stats (views/likes)

## Missing — buildable feature backlog
- [x] `[M]` Project pages (multi-image case studies with description, tools, process)
- [x] `[S]` Follow / followers graph and personalized feed
- [x] `[M]` Comments + appreciations + collections (save-to-board)
- [x] `[M]` Portfolio profile page with custom layout
- [x] `[S]` Tags / categories / search-by-discipline
- [x] `[M]` Job board / commission requests
- [x] `[S]` Behance-style "served sites" / curated galleries

## Parity
~88% of Behance's surface. Asset library, marketplace, and analysis tools are real, but the social-portfolio core — project case studies, follows, appreciations, profile pages — is thin.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
