# global — Feature Gap vs Our World in Data / World Bank DataBank

Category leader (2026): Our World in Data / World Bank DataBank. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `global` domain — crossDomainSearch, aggregateDashboard, correlationMatrix; CountryAtlas + WorldBankPanel components (live World Bank indicators).

## Has (verified in code)
- Country atlas — browse countries with regional indices + trends (6 world regions)
- Live World Bank indicator panel
- Cross-domain search across data sources with diversity scoring
- Aggregate dashboard combining multiple data domains
- Correlation matrix between indicators; paginated country list

## Missing — buildable feature backlog
- [x] `[M]` Interactive choropleth world map colored by any indicator
- [x] `[M]` Time-series charts per indicator with year slider
- [x] `[S]` Country comparison view — side-by-side multiple countries
- [x] `[M]` Scatter / bubble explorer (one indicator vs another, animated over time)
- [x] `[S]` Indicator search across the full World Bank catalog
- [x] `[S]` Data download / embed / shareable chart links
- [x] `[S]` Country profile pages aggregating all indicators

## Parity
Full data-exploration surface shipped. The `global` domain exposes live World Bank
macros — `choropleth`, `indicatorTimeseries`, `compareCountries`, `scatterExplorer`,
`searchIndicators`, `countryProfile` — plus per-user `saveView`/`listViews`/`deleteView`
for shareable chart links. The lens `Data Explorer` tab (`components/global/DataExplorer.tsx`
with `IndicatorPicker` + `CountryPicker`) drives all six tools with a choropleth map,
year-slider time series, multi-country comparison, animated scatter explorer, full-catalog
indicator search, and country-profile pages.

_Full backlog implemented 2026-05-21 — backend macros + wired UI + domain-parity tests._
