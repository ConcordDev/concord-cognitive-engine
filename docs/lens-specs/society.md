# society — Feature Gap vs Our World in Data / Gapminder

Category leader (2026): Our World in Data / Gapminder. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `society` domain (4 macros: `wb-indicator`, `wb-country`, `wb-compare`, `wb-common-indicators`) hitting the live World Bank Open Data API; plus NPC-society macro domains (culture, entity_economy, autonomy, conflict, teaching, persona).

## Has (verified in code)
- Live World Bank API: single indicator time series, country profile, multi-country compare, alias table (~1,400 indicators reachable)
- WorldBankExplorer UI panel
- Six NPC-society tabs (culture traditions, entity economy w/ Gini, autonomy refusals, disputes, mentorships, personas)
- AgentBuilder for authoring NPC agents; SocietyActionPanel

## Missing — buildable feature backlog
- [ ] `[M]` Interactive charting — line/bar/scatter visualisation of WB series; page only lists raw rows
- [ ] `[L]` Animated bubble chart (Gapminder's signature) — GDP vs life-expectancy over time
- [ ] `[M]` World choropleth map for any indicator
- [ ] `[S]` Indicator search/browse across the full 1,400-indicator catalog
- [ ] `[M]` Country detail dashboard — many indicators for one country on one screen
- [ ] `[S]` Data export (CSV/PNG) and shareable chart permalinks
- [ ] `[M]` Region/income-group aggregates and rankings
- [ ] `[S]` Per-capita / inflation-adjusted toggles on metrics

## Parity
~40% of Our World in Data. Backend data access is genuinely strong (live WB API, compare, aliases) but the lens shows raw rows — no charts, maps, or visual exploration that define the category leader.
