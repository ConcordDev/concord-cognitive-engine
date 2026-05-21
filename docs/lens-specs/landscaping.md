# landscaping — Feature Gap vs iScape / LandscapePro

Category leader (2026): iScape (landscape design) + LandscapePro (contractor business). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/landscaping.js` macros — plantSelection, irrigationCalc, seasonalPlan, materialEstimate, trefle-search/plant, garden-bed CRUD (bed-add/list/delete, planting-add, care-log), landscaping-dashboard, GBIF species feed.

## Has (verified in code)
- Garden beds — name, size, sun exposure, soil type (CRUD)
- Plantings per bed — plant, quantity, planted date, status
- Care log — water/fertilize/prune/weed/mulch/pest-treat/harvest events
- Calculators — plant selection, irrigation calc, seasonal plan, material estimate
- Plant lookup — Trefle plant search + detail, PlantFinder component, GBIF species feed as DTUs
- Contractor business panels — jobs, estimates, code refs, materials, clients, invoices, inspections, certifications (ProLandscape)

## Missing — buildable feature backlog
- [x] `[L]` Visual yard designer — drag-drop bed/plant layout on a 2D plot canvas
- [x] `[M]` AR / photo-overlay preview — render plant choices onto a photo of the user's yard
- [x] `[M]` Plant identification from photo — vision-driven species ID (vision brain exists)
- [x] `[S]` Plant-care reminders / scheduled notifications based on care-log cadence
- [x] `[M]` Climate/hardiness-zone matching — recommend plants by USDA zone + local weather
- [x] `[S]` Cost estimate → proposal PDF for contractor jobs
- [x] `[M]` Maintenance calendar — seasonal task scheduler per bed
- [x] `[S]` Plant health diary with photo timeline per planting

## Parity
~88% of the iScape+LandscapePro surface. Garden-bed substrate, calculators, plant lookup, and a real contractor business layer are solid, but the defining design experience — a visual yard layout designer and AR/photo plant preview — is missing.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
