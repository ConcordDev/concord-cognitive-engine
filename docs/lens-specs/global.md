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
- [ ] `[M]` Interactive choropleth world map colored by any indicator
- [ ] `[M]` Time-series charts per indicator with year slider
- [ ] `[S]` Country comparison view — side-by-side multiple countries
- [ ] `[M]` Scatter / bubble explorer (one indicator vs another, animated over time)
- [ ] `[S]` Indicator search across the full World Bank catalog
- [ ] `[S]` Data download / embed / shareable chart links
- [ ] `[S]` Country profile pages aggregating all indicators

## Parity
~50% of Our World in Data's feature surface. Live World Bank data, cross-domain search, and a correlation matrix are real, but it lacks the interactive choropleth map, time-series charts, and the scatter/comparison explorers that are the heart of a data-exploration site.
