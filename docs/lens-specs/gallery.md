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
- [ ] `[M]` Deep-zoom high-resolution viewer (Arts & Culture's gigapixel "Art Camera")
- [ ] `[S]` Visual / color / style search across artworks
- [ ] `[M]` Curated thematic exhibits / stories with narrative sequencing
- [ ] `[S]` Artwork comparison side-by-side view
- [ ] `[M]` AR "view in your room" / virtual gallery walkthrough
- [ ] `[S]` Artist pages aggregating works across museums
- [ ] `[S]` Personalized recommendations from saved/viewed history

## Parity
~55% of Google Arts & Culture's feature surface. Live multi-museum browsing + saved collections + the novel DTU-sigil art is genuine, but it lacks deep-zoom, curated exhibits, visual search, and the immersive AR/virtual-gallery features that distinguish Arts & Culture.
