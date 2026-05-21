# eco — Feature Gap vs iNaturalist / JouleBug

Category leader (2026): iNaturalist (species) + JouleBug (sustainability habits). Content fills via free public APIs (weather, AQI, species) + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `eco` domain macros — pure-compute (carbonFootprint, biodiversityIndex, sustainabilityScore) plus live data (weather-forecast, aqi-current) and substrate (climate-actions list/log/logged, species-identify, energy-estimate, biodiversity log/list/delete).

## Has (verified in code)
- Weather panel + radar; AQI panel (live air-quality API)
- Species identifier (vision-backed); biodiversity log with list/delete
- Climate-action catalog with logging + logged history
- Energy estimator; carbon footprint + sustainability + biodiversity-index AI scores
- ClimateActions component

## Missing — buildable feature backlog
- [ ] `[M]` Species observation feed — community sightings map like iNaturalist
- [ ] `[S]` Personal carbon-footprint history / trend chart
- [ ] `[M]` Sustainability challenges/streaks — JouleBug-style gamified habits
- [ ] `[S]` Geotagged biodiversity entries plotted on a map
- [ ] `[S]` Species ID confidence + suggested-alternatives list
- [ ] `[S]` Local environmental alerts (air quality, pollen, UV) by saved location

## Parity
~55% of an iNaturalist+JouleBug composite. Strong live weather/AQI, species ID, and climate-action logging; missing the observation feed/map, footprint trends, and gamified challenges.
