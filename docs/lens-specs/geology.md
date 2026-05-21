# geology — Feature Gap vs USGS apps / Rockd

Category leader (2026): Rockd (field geology) + USGS Earthquakes. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `geology` domain — rockClassify, seismicRisk, mineralId, stratigraphicColumn, live USGS recent-earthquakes + seismic-hazard, observation/field-log CRUD, dashboard, feed; MapView, EarthquakeList, Wikipedia panel.

## Has (verified in code)
- Live USGS earthquake feed + USGS seismic-hazard lookup; earthquake list with map
- Rock-sample field log — name, rock type (igneous/sedimentary/metamorphic), mineral composition, location, coords, formation, age
- Rock classification, mineral identification, seismic-risk scoring, stratigraphic column builder
- Field observation CRUD with geolocation; map view; Wikipedia geology search

## Missing — buildable feature backlog
- [ ] `[M]` Geologic map overlay (bedrock/age layers on the map, like Rockd's Macrostrat)
- [ ] `[S]` Photo capture for rock samples with EXIF geotag
- [ ] `[M]` Strabo / structural measurements — strike/dip recording with a digital compass
- [ ] `[S]` Nearby-rock-units lookup at current GPS location
- [ ] `[S]` Checklist / collection — track minerals/rocks identified
- [ ] `[M]` Field-trip / outcrop sequencing with notes per stop

## Parity
~55% of Rockd's feature surface. Live USGS data, the field log, and classification helpers are solid, but it lacks the geologic-map overlay, structural measurement tools, and location-aware bedrock lookup that make Rockd a true field instrument.
