# photography — Feature Gap vs Adobe Lightroom

Category leader (2026): Adobe Lightroom (photo catalog + RAW develop). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/photography.js` — ~36 macros: photo/album/shoot CRUD, develop + export presets, pick/reject flags, edit tracking, LLaVA photo vision, exposure calc, composition analysis, gear recommend, print size, dashboard, Art Institute archive feed.

## Has (verified in code)
- Photo catalog: photos, albums, shoots, develop presets, export presets; pick/reject flag workflow
- 6 tabs (gallery/upload/capture/collections/editing/stats); webcam capture, file upload
- In-browser non-destructive edit: brightness/contrast/saturation/exposure sliders (CSS filter)
- EXIF metadata display panel; LLaVA AI vision photo analysis
- Exposure calculator (reciprocity), composition analysis, gear recommendation, print-size calculator
- PexelsBrowser stock-photo search; Art Institute photo-archive live feed; top-camera/lens dashboard stats

## Missing — buildable feature backlog
- [ ] `[L]` RAW file develop pipeline — true non-destructive RAW decode with tone curve + white balance
- [ ] `[M]` Histogram + tone curve editor — live histogram and per-channel curve adjustment
- [ ] `[M]` Local adjustments / masking — brush, gradient, AI subject-select masks
- [ ] `[S]` Star rating + color label filtering — full Lightroom-style cull workflow
- [ ] `[S]` Keyword/face tagging + smart collections — auto-organize by metadata
- [ ] `[M]` Preset sync + apply-to-batch — copy develop settings across many photos
- [ ] `[S]` Lens correction / geometry — distortion, vignette, perspective fixes

## Parity
~50% of Lightroom's feature surface. The catalog model (albums/shoots/presets/picks) plus real slider editing and EXIF/AI-vision is a solid base, but it lacks RAW develop, histogram/curves, and masking — the non-destructive editing core of Lightroom.
