# gallery — Feature Completeness Spec

Rival app(s): Google Arts & Culture, museum collection apps (2026)
Sources:
- https://openaccess-api.clevelandart.org/ (Cleveland Museum of Art Open Access — ~32k public-domain works)
- https://api.si.edu/openaccess/ (Smithsonian Open Access — ~5M records, 19 museums)
- Google Arts & Culture (browse + personal galleries/favorites)

## Features

### Museum browsing (live)
- [x] Cleveland Museum of Art search + artwork detail + departments (macro: gallery.cma-search / cma-artwork / cma-departments)
- [x] Smithsonian Open Access search (macro: gallery.si-search)

### Saved collections (museum favorites)
- [x] Collections — auto-seeded Favorites, create / list / delete, per-user (macro: gallery.collection-create / collection-list / collection-delete)
- [x] Collection detail with its artworks (macro: gallery.collection-detail)
- [x] Save an artwork to a collection — dedupe by refId (macro: gallery.artwork-save)
- [x] Remove an artwork (macro: gallery.artwork-remove)
- [x] Gallery dashboard — collections, saved artworks, museums, distinct artists (macro: gallery.gallery-dashboard)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Personal photo library | a blob store + EXIF pipeline | `gallery` is a museum/art-collection browser; saved collections curate public-domain works |
| AR "Art Projector" / Art Selfie | device camera + ML models | the `ar` lens carries AR; gallery focuses on browse + curation |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/gallery.js` clean. 10 macros
  (4 live museum APIs + 6 saved-collection substrate).
- 2026-05-20: Tests — `tests/gallery-domain-parity.test.js` 8/8 green
  (collections auto-seed Favorites + per-user scope + create/delete /
  artwork-save + dedupe + titleless reject / named-collection save+remove /
  dashboard by-museum + artist count).
- 2026-05-20: Frontend — new `SavedCollections` (collection list + artwork
  grid with covers) mounted in the gallery lens page. `npx tsc --noEmit` exit 0.
