# photography — Feature Completeness Spec

Rival app(s): Adobe Lightroom, Capture One, Photo Mechanic (2026)
Sources:
- https://api.artic.edu/docs/ — Art Institute of Chicago open API (free, no key)

## Features

### Catalog substrate
- [x] Photos, albums, develop presets, shoots, export presets
- [x] Pick/reject flagging, edit tracking, top-camera / top-lens dashboard
- (36 macros)

### Live data & feed
- [x] Live photo-archive feed — Art Institute of Chicago photography artworks ingested as DTUs (macro: photography.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| RAW decoding / non-destructive edit pipeline | a native imaging engine | develop-preset records + edit metadata |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (Art Institute of Chicago → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` photography feed green (asserts image URL); `tests/photography-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="photography"` mounted in the lens page.
