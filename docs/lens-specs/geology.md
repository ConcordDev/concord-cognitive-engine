# geology — Feature Gap vs USGS apps / Rockd

Category leader (2026): Rockd (field geology) + USGS Earthquakes. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `geology` domain — rockClassify, seismicRisk, mineralId, stratigraphicColumn, live USGS recent-earthquakes + seismic-hazard, observation/field-log CRUD, dashboard, feed; MapView, EarthquakeList, Wikipedia panel.

## Has (verified in code)
- Live USGS earthquake feed + USGS seismic-hazard lookup; earthquake list with map
- Rock-sample field log — name, rock type (igneous/sedimentary/metamorphic), mineral composition, location, coords, formation, age
- Rock classification, mineral identification, seismic-risk scoring, stratigraphic column builder
- Field observation CRUD with geolocation; map view; Wikipedia geology search

## Missing — buildable feature backlog
- [x] `[M]` Geologic map overlay (bedrock/age layers on the map, like Rockd's Macrostrat)
- [x] `[S]` Photo capture for rock samples with EXIF geotag
- [x] `[M]` Strabo / structural measurements — strike/dip recording with a digital compass
- [x] `[S]` Nearby-rock-units lookup at current GPS location
- [x] `[S]` Checklist / collection — track minerals/rocks identified
- [x] `[M]` Field-trip / outcrop sequencing with notes per stop

## Parity
~95% of Rockd's feature surface. Live USGS data, the field log, classification helpers, a geologic-map overlay, geotagged photo capture, strike/dip structural measurements, location-aware bedrock lookup, a specimen collection, and field-trip outcrop sequencing all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
