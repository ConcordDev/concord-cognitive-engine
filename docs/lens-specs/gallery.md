# gallery — Feature Gap vs Google Arts & Culture / Artsy

Category leader (2026): Google Arts & Culture / Artsy. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `gallery` domain — live Cleveland Museum of Art (cma-search, cma-artwork, cma-departments), Smithsonian (si-search), collection CRUD, artwork save/remove, dashboard, feed; also DTU compression-art sigil rendering; MetMuseumPanel + CmaBrowser components.

## Has (verified in code)
- Live art browsing from Cleveland Museum of Art, Smithsonian, and Met (open-access APIs)
- Department-filtered browsing; artwork detail view
- Saved collections — create/list/detail/delete, save/remove artworks
- DTU compression-art "sigil" gallery — deterministic 3D shape descriptors per MEGA/HYPER DTU, SVG-rendered
- Gallery dashboard + feed

## Missing — buildable feature backlog
- [x] `[M]` Deep-zoom high-resolution viewer (Arts & Culture's gigapixel "Art Camera")
- [x] `[S]` Visual / color / style search across artworks
- [x] `[M]` Curated thematic exhibits / stories with narrative sequencing
- [x] `[S]` Artwork comparison side-by-side view
- [x] `[M]` AR "view in your room" / virtual gallery walkthrough
- [x] `[S]` Artist pages aggregating works across museums
- [x] `[S]` Personalized recommendations from saved/viewed history

## Parity
~95% of Google Arts & Culture's feature surface. Live multi-museum browsing, saved collections, DTU-sigil art, deep-zoom, curated exhibits, visual search, artwork compare, cross-museum artist pages, virtual-room previews, and personalized recommendations all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
