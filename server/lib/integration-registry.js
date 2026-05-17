// server/lib/integration-registry.js
//
// Phase 2 of the 10-dimension UX completeness sprint.
//
// One source of truth for "what data is this lens actually showing the
// user?" Wires manifest.dataTier (Phase 1) → DepthBadge chip → user can
// trust whether they're looking at:
//
//   REAL_LIVE     real, polled live from an external source OR the user's
//                 own live substrate (their wallet balance, their DTUs,
//                 their chat history, the running Concordia simulation).
//
//   REAL_FREE     real but static / open-access dataset (Wikipedia, OSM,
//                 NASA APOD, NOAA archive, MET Museum, USGS catalog,
//                 FDA OpenFDA labels). Wire-ready in Phase 4.
//
//   SIM_GRADE_A   high-fidelity simulation, grounded against a domain
//                 schema. NOT pretending to be real industry data. Useful
//                 working surface; the user can compose against it and
//                 mint DTUs that are about the simulation.
//
//   DEMO          synthetic. The lens is a working surface but the domain
//                 requires paywalled / industry-licensed feeds we
//                 haven't wired (formulary, MLS, EHR, FAA NOTAMs, Westlaw,
//                 FCC spectrum auctions, Bloomberg Terminal, etc.). Each
//                 DEMO entry MUST carry a `paywallReason`.
//
// The honesty contract:
//   - A REAL_LIVE entry MUST point at a working external source or
//     the user's own substrate (not LLM output).
//   - A REAL_FREE entry MUST point at a free open API that is either
//     already wired (server/lib/feed-sources.js) or queued for Phase 4
//     wire-up. NEVER use REAL_FREE for "we'll someday wire this".
//   - A SIM_GRADE_A entry SHOULD declare the schema it grounds against
//     so authors can find the substrate definition.
//   - A DEMO entry MUST declare paywallReason. Without it we'd be
//     hiding the gap.
//
// Tests:
//   server/tests/integration-registry.test.js asserts:
//     - every manifest lens has a registry entry
//     - no DEMO lens claims a real-API source
//     - every DEMO lens declares paywallReason
//     - every REAL_FREE lens's `sources` list is non-empty

export const TIER = Object.freeze({
  REAL_LIVE:   "REAL_LIVE",
  REAL_FREE:   "REAL_FREE",
  SIM_GRADE_A: "SIM_GRADE_A",
  DEMO:        "DEMO",
});

/**
 * Per-lens integration declarations.
 *
 * Shape:
 *   {
 *     tier: TIER,
 *     sources?: string[],          // identifiers from feed-sources.js or external API names
 *     paywallReason?: string,      // REQUIRED for DEMO; explains what real data the domain needs
 *     groundedSchema?: string,     // SIM_GRADE_A may declare its schema substrate
 *     liveFromSubstrate?: boolean, // REAL_LIVE that reads user's own substrate, not external API
 *     note?: string,
 *   }
 */
export const REGISTRY = Object.freeze({
  // ───────────────────────────────────────────────────────────────────────────
  // REAL_LIVE — user's own substrate or live external feed (already wired).
  // ───────────────────────────────────────────────────────────────────────────
  chat:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real conversations + real 4-brain LLM" },
  message:       { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real inbox / Concord-Link messages" },
  wallet:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real Concord Coin balance + ledger" },
  marketplace:   { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real DTU listings + royalty cascade" },
  feed:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real timeline aggregator" },
  dtus:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "the user's actual DTU substrate" },
  code:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, sources: ["github.api"], note: "GitHub repo fetch + own code DTUs" },
  studio:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real DAW sessions + soundscape" },
  world:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "live Concordia simulation state" },
  finance:       { tier: TIER.REAL_LIVE, sources: ["finance-yahoo-sp500", "finance-yahoo-nasdaq", "finance-yahoo-dow", "finance-coingecko-top10", "finance-fred-rates"], note: "live tickers" },
  trades:        { tier: TIER.REAL_LIVE, sources: ["finance-yahoo-sp500", "finance-coingecko-top10"], note: "live tickers" },
  markets:       { tier: TIER.REAL_LIVE, sources: ["finance-yahoo-sp500", "finance-coingecko-top10"], note: "live tickers" },
  market:        { tier: TIER.REAL_LIVE, sources: ["finance-yahoo-sp500", "finance-coingecko-top10"], note: "live tickers" },
  crypto:        { tier: TIER.REAL_LIVE, sources: ["finance-coingecko-top10"], note: "live crypto prices" },
  news:          { tier: TIER.REAL_LIVE, sources: ["news-reuters-top", "news-bbc-world", "news-npr-top", "news-techcrunch", "news-arstechnica", "news-hackernews"], note: "live RSS aggregation" },
  sports:        { tier: TIER.REAL_LIVE, sources: ["sports-espn-top"], note: "live ESPN RSS" },
  weather:       { tier: TIER.REAL_LIVE, sources: ["weather-open-meteo-current", "weather-noaa-alerts"], note: "live weather + NOAA alerts" },
  goddess:       { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real Concordia ecosystem signals" },
  collab:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real collaboration sessions" },
  council:       { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real governance votes" },
  hub:           { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real hub home" },
  analytics:     { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real per-user analytics" },
  events:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real world-event scheduler" },
  event_timeline: { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real event firehose" },
  "event-timeline": { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real event firehose" },
  voice:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real voice session turns" },
  graph:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real DTU graph" },
  graphs:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real DTU graph view" },
  search:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real cross-lens discovery" },
  notifications: { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real notifications" },
  daily:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real daily ritual" },
  forecast:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real forward-sim engine output" },
  expert_mode:   { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real cited answers from global DTU pull" },
  "expert-mode": { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real cited answers from global DTU pull" },
  council_sessions: { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real council sessions" },
  agents:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real agent threads + marathons" },
  forge:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real generated apps" },
  questmarket:   { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real quest market" },
  kingdoms:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real war_campaigns substrate" },
  alliance:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real alliances" },
  federation:    { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real federation peers" },
  mesh:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real mesh network" },
  bridge:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real cross-world bridges" },
  inheritance:   { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real npc_legacies substrate" },
  legacy:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real legacy substrate" },
  dreams:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real dream engine output" },
  meta:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real meta-cognition" },
  metacognition: { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real meta-cognition" },
  metalearning:  { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real meta-learning" },
  reasoning:     { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real reasoning_sessions" },
  reflection:    { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real reflection logs" },
  attention:     { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real attention allocation" },
  affect:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real affect state" },
  inference:     { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real inference traces" },
  temporal:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real temporal index" },
  worldmodel:    { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real world model" },
  goals:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real goals" },
  atlas:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, sources: ["openstreetmap.nominatim"], note: "real atlas signals + OSM lookups" },
  lattice:       { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real lattice substrate" },
  resonance:     { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real resonance signal" },
  emergent:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real emergent simulation" },
  personas:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real persona substrate" },
  schemes:       { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real npc_schemes" },
  ux_suite:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real UX suite" },
  "ux-suite":    { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real UX suite" },
  hypothesis:    { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real hypothesis substrate" },
  paper:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real paper authoring substrate" },
  research:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real reasoning_sessions" },
  experience:    { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real experience log" },
  understanding: { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real understanding evolution" },
  cognition:     { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real cognition trace" },
  cognitive_replay: { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real cognitive replay" },
  "cognitive-replay": { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real cognitive replay" },
  cri:           { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real cri (concord regional intelligence)" },
  brain:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real brain status" },
  byo_keys:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real per-user BYO API keys" },
  "byo-keys":    { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real per-user BYO API keys" },
  settings:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real user settings" },
  audit:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real audit log" },
  admin:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real admin surface" },
  system:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real system status" },
  ops:           { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real ops dashboards" },
  observe:       { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real observability" },
  command_center: { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real command center" },
  "command-center": { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real command center" },
  dx_platform:   { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real DX platform" },
  "dx-platform": { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real DX platform" },
  platform:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real platform status" },
  schema:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real schema registry" },
  database:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real database introspection" },
  jobs:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real queue stats" },
  queue:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real queue stats" },
  tick:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real heartbeat counter" },
  heartbeat:     { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real heartbeat counter" },
  privacy:       { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real privacy settings" },
  invariant:     { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real invariant violations log" },
  sentinel:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real sentinel monitor" },
  lock:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real lockfile / mutex view" },
  security:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real security audit" },
  shield:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real Concord Shield" },
  sync:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real sync state" },
  offline:       { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real offline queue" },
  integrations:  { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real integration registry" },
  ingest:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real ingest queue" },
  import:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real import staging" },
  export:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real export jobs" },
  transfer:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real transfer log" },
  custom:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real custom lens authoring" },
  ml:            { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real ML training jobs" },
  reflection_logs: { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real reflection logs" },
  webhooks:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real webhook registry" },
  webhooks_metrics: { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real webhook metrics" },
  thread:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real chat thread" },
  threads:       { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real chat threads" },
  timeline:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real timeline" },
  projects:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real projects" },
  productivity:  { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real productivity tracker" },
  srs:           { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real spaced repetition deck" },
  goals_v2:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real goals" },

  // ───────────────────────────────────────────────────────────────────────────
  // REAL_FREE — free open APIs. Wired or queued for Phase 4 wire-up.
  // ───────────────────────────────────────────────────────────────────────────
  astronomy:    { tier: TIER.REAL_FREE, sources: ["nasa.apod", "esa.openapi", "space-x.rss"], note: "NASA APOD + ESA + SpaceX RSS" },
  space:        { tier: TIER.REAL_FREE, sources: ["nasa.apod", "esa.openapi"], note: "NASA + ESA open data" },
  math:         { tier: TIER.REAL_FREE, sources: ["wolfram.openalpha", "mathoverflow.api"], note: "Wolfram + MathOverflow" },
  physics:      { tier: TIER.REAL_FREE, sources: ["arxiv.api", "wikipedia.physics"], note: "arXiv + Wikipedia" },
  chem:         { tier: TIER.REAL_FREE, sources: ["pubchem.api", "wikipedia.chemistry"], note: "PubChem + Wikipedia" },
  bio:          { tier: TIER.REAL_FREE, sources: ["ncbi.eutils", "wikipedia.biology"], note: "NCBI + Wikipedia" },
  geology:      { tier: TIER.REAL_FREE, sources: ["usgs.earthquakes", "usgs.volcanoes"], note: "USGS quake + volcano feeds" },
  ocean:        { tier: TIER.REAL_FREE, sources: ["noaa.tides", "noaa.buoys"], note: "NOAA tides + buoys" },
  environment:  { tier: TIER.REAL_FREE, sources: ["noaa.weather", "epa.airnow"], note: "NOAA + EPA AirNow" },
  eco:          { tier: TIER.REAL_FREE, sources: ["noaa.climate", "epa.airnow"], note: "NOAA climate + EPA" },
  agriculture:  { tier: TIER.REAL_FREE, sources: ["usda.nass", "usda.fooddata"], note: "USDA NASS + FoodData Central" },
  food:         { tier: TIER.REAL_FREE, sources: ["usda.fooddata", "wikipedia.cuisine"], note: "USDA FoodData + Wikipedia" },
  cooking:      { tier: TIER.REAL_FREE, sources: ["usda.fooddata"], note: "USDA FoodData" },
  pharmacy:     { tier: TIER.REAL_FREE, sources: ["fda.openfda.labels", "fda.openfda.adverse"], paywallReason: "formulary + drug interaction databases (FirstDataBank ~$5k/mo, RxNorm partial)", note: "OpenFDA labels + adverse events; full formulary requires paid license" },
  travel:       { tier: TIER.REAL_FREE, sources: ["openstreetmap.nominatim", "wikipedia.geo"], note: "OSM + Wikipedia geo" },
  history:      { tier: TIER.REAL_FREE, sources: ["wikipedia.api", "met-museum.api"], note: "Wikipedia + MET Museum" },
  art:          { tier: TIER.REAL_FREE, sources: ["met-museum.api", "wikipedia.art"], note: "MET Museum + Wikipedia" },
  gallery:      { tier: TIER.REAL_FREE, sources: ["met-museum.api"], note: "MET Museum + Pexels" },
  photography:  { tier: TIER.REAL_FREE, sources: ["pexels.api", "wikipedia.photography"], note: "Pexels API" },
  music:        { tier: TIER.REAL_FREE, sources: ["music-soundcloud-charts", "wikipedia.music"], note: "SoundCloud + Wikipedia" },
  podcast:      { tier: TIER.REAL_FREE, sources: ["itunes.podcast.search"], note: "iTunes podcast search" },
  philosophy:   { tier: TIER.REAL_FREE, sources: ["plato.stanford.api", "wikipedia.philosophy"], note: "Stanford Encyclopedia + Wikipedia" },
  linguistics:  { tier: TIER.REAL_FREE, sources: ["wiktionary.api", "wikipedia.linguistics"], note: "Wiktionary + Wikipedia" },
  forestry:     { tier: TIER.REAL_FREE, sources: ["usda.forest"], note: "USDA Forest Service" },
  pets:         { tier: TIER.REAL_FREE, sources: ["petfinder.api"], note: "PetFinder API" },
  veterinary:   { tier: TIER.REAL_FREE, sources: ["wikipedia.veterinary"], note: "Wikipedia veterinary" },
  nonprofit:    { tier: TIER.REAL_FREE, sources: ["propublica.nonprofits"], note: "ProPublica Nonprofit Explorer" },
  government:   { tier: TIER.REAL_FREE, sources: ["data.gov", "propublica.congress"], note: "data.gov + ProPublica Congress" },
  energy:        { tier: TIER.REAL_FREE, sources: ["eia.api"], note: "EIA energy data" },
  transportation: { tier: TIER.REAL_FREE, sources: ["dot.bts"], note: "DOT BTS" },
  global:        { tier: TIER.REAL_FREE, sources: ["finance-fred-rates", "worldbank.api"], note: "World Bank + FRED" },
  market_eco:    { tier: TIER.REAL_FREE, sources: ["worldbank.api"], note: "World Bank macro" },
  fashion:       { tier: TIER.REAL_FREE, sources: ["pexels.api", "wikipedia.fashion"], note: "Pexels + Wikipedia" },
  film_studios:  { tier: TIER.REAL_FREE, sources: ["wikipedia.film", "tmdb.api"], note: "Wikipedia + TMDB free tier" },
  "film-studios": { tier: TIER.REAL_FREE, sources: ["wikipedia.film", "tmdb.api"], note: "Wikipedia + TMDB free tier" },
  galaxy:        { tier: TIER.REAL_FREE, sources: ["nasa.apod"], note: "NASA" },
  desert:        { tier: TIER.REAL_FREE, sources: ["usgs.geological"], note: "USGS geological" },
  fitness:       { tier: TIER.REAL_FREE, sources: ["usda.fooddata"], note: "USDA macros" },
  wellness:      { tier: TIER.REAL_FREE, sources: ["wikipedia.wellness", "nih.medlineplus"], note: "MedlinePlus + Wikipedia" },
  mental_health: { tier: TIER.REAL_FREE, sources: ["nih.medlineplus"], note: "MedlinePlus" },
  "mental-health": { tier: TIER.REAL_FREE, sources: ["nih.medlineplus"], note: "MedlinePlus" },
  meditation:    { tier: TIER.REAL_FREE, sources: ["wikipedia.meditation"], note: "Wikipedia" },
  household:     { tier: TIER.REAL_FREE, sources: ["wikipedia.household"], note: "Wikipedia" },
  parenting:     { tier: TIER.REAL_FREE, sources: ["aap.api", "wikipedia.parenting"], note: "AAP guidelines + Wikipedia" },
  retail:        { tier: TIER.REAL_FREE, sources: ["wikipedia.retail"], note: "Wikipedia retail trends" },
  education:     { tier: TIER.REAL_FREE, sources: ["wikipedia.education", "khan-academy.api"], note: "Khan Academy + Wikipedia" },
  classroom:     { tier: TIER.REAL_FREE, sources: ["wikipedia.education"], note: "Wikipedia" },
  mentorship:    { tier: TIER.REAL_FREE, sources: ["wikipedia.mentorship"], note: "Wikipedia" },
  emergency_services: { tier: TIER.REAL_FREE, sources: ["fema.api"], note: "FEMA open data" },
  "emergency-services": { tier: TIER.REAL_FREE, sources: ["fema.api"], note: "FEMA open data" },
  "law-enforcement": { tier: TIER.REAL_FREE, sources: ["fbi.crime"], note: "FBI Crime Data Explorer" },
  law_enforcement: { tier: TIER.REAL_FREE, sources: ["fbi.crime"], note: "FBI Crime Data Explorer" },
  ar:            { tier: TIER.REAL_FREE, sources: ["wikipedia.ar"], note: "Wikipedia AR" },
  robotics:      { tier: TIER.REAL_FREE, sources: ["arxiv.robotics"], note: "arXiv robotics" },
  quantum:       { tier: TIER.REAL_FREE, sources: ["arxiv.quant-ph"], note: "arXiv quant-ph" },
  neuro:         { tier: TIER.REAL_FREE, sources: ["ncbi.pubmed", "openneuro.api"], note: "PubMed + OpenNeuro" },

  // ───────────────────────────────────────────────────────────────────────────
  // SIM_GRADE_A — high-fidelity simulation against a domain schema. Useful
  // working surface; users can compose against it. NOT real-world live data.
  // ───────────────────────────────────────────────────────────────────────────
  debate:        { tier: TIER.SIM_GRADE_A, groundedSchema: "council/debate", note: "council debate simulation" },
  ethics:        { tier: TIER.SIM_GRADE_A, groundedSchema: "ethics/dilemma", note: "ethics simulation" },
  philosophy:    { tier: TIER.SIM_GRADE_A, groundedSchema: "philosophy/argument" },
  creative:      { tier: TIER.SIM_GRADE_A, groundedSchema: "creative/recipe" },
  "creative-writing": { tier: TIER.SIM_GRADE_A, groundedSchema: "creative/text" },
  creative_writing: { tier: TIER.SIM_GRADE_A, groundedSchema: "creative/text" },
  poetry:        { tier: TIER.SIM_GRADE_A, groundedSchema: "creative/poem" },
  creator:       { tier: TIER.SIM_GRADE_A, groundedSchema: "creator/manifest" },
  fork:          { tier: TIER.SIM_GRADE_A, groundedSchema: "branch/fork" },
  fractal:       { tier: TIER.SIM_GRADE_A, groundedSchema: "fractal/explore" },
  game:          { tier: TIER.SIM_GRADE_A, groundedSchema: "game/session" },
  "game-design": { tier: TIER.SIM_GRADE_A, groundedSchema: "game/design" },
  game_design:   { tier: TIER.SIM_GRADE_A, groundedSchema: "game/design" },
  genesis:       { tier: TIER.SIM_GRADE_A, groundedSchema: "world/genesis" },
  foundry:       { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real foundry-built apps" },
  "world-creator": { tier: TIER.SIM_GRADE_A, groundedSchema: "world/spec" },
  world_creator: { tier: TIER.SIM_GRADE_A, groundedSchema: "world/spec" },
  "world-creator/anomalies": { tier: TIER.SIM_GRADE_A, groundedSchema: "world/anomaly" },
  "sub-worlds":  { tier: TIER.SIM_GRADE_A, groundedSchema: "world/sub" },
  sub_worlds:    { tier: TIER.SIM_GRADE_A, groundedSchema: "world/sub" },
  sim:           { tier: TIER.SIM_GRADE_A, groundedSchema: "world/sim" },
  sandbox:       { tier: TIER.SIM_GRADE_A, groundedSchema: "sandbox/spec" },
  expedition_journal: { tier: TIER.SIM_GRADE_A, groundedSchema: "expedition/journal" },
  "expedition-journal": { tier: TIER.SIM_GRADE_A, groundedSchema: "expedition/journal" },
  ghost_tracker: { tier: TIER.SIM_GRADE_A, groundedSchema: "ghost/track" },
  "ghost-tracker": { tier: TIER.SIM_GRADE_A, groundedSchema: "ghost/track" },
  deities:       { tier: TIER.SIM_GRADE_A, groundedSchema: "deities/pantheon" },
  crisis_ops:    { tier: TIER.SIM_GRADE_A, groundedSchema: "crisis/incident" },
  "crisis-ops":  { tier: TIER.SIM_GRADE_A, groundedSchema: "crisis/incident" },
  psyops:        { tier: TIER.SIM_GRADE_A, groundedSchema: "psyops/campaign" },
  black_market:  { tier: TIER.SIM_GRADE_A, groundedSchema: "marketplace/black" },
  "black-market": { tier: TIER.SIM_GRADE_A, groundedSchema: "marketplace/black" },
  staking:       { tier: TIER.SIM_GRADE_A, groundedSchema: "stake/pool" },
  sponsorship:   { tier: TIER.SIM_GRADE_A, groundedSchema: "sponsor/deal" },
  bounties:      { tier: TIER.SIM_GRADE_A, groundedSchema: "bounty/listing" },
  tournaments:   { tier: TIER.SIM_GRADE_A, groundedSchema: "tournament/bracket" },
  disputes:      { tier: TIER.SIM_GRADE_A, groundedSchema: "dispute/case" },
  hr:            { tier: TIER.SIM_GRADE_A, groundedSchema: "hr/policy" },
  consulting:    { tier: TIER.SIM_GRADE_A, groundedSchema: "consult/engagement" },
  marketing:     { tier: TIER.SIM_GRADE_A, groundedSchema: "marketing/campaign" },
  accounting:    { tier: TIER.SIM_GRADE_A, groundedSchema: "accounting/coa" },
  billing:       { tier: TIER.SIM_GRADE_A, groundedSchema: "billing/invoice" },
  calendar:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real per-user calendar" },
  cri_2:         { tier: TIER.SIM_GRADE_A, groundedSchema: "cri/regional" },
  debug:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real debug telemetry" },
  diy:           { tier: TIER.SIM_GRADE_A, groundedSchema: "diy/project" },
  home_improvement: { tier: TIER.SIM_GRADE_A, groundedSchema: "diy/project" },
  "home-improvement": { tier: TIER.SIM_GRADE_A, groundedSchema: "diy/project" },
  carpentry:     { tier: TIER.SIM_GRADE_A, groundedSchema: "trade/carpentry" },
  electrical:    { tier: TIER.SIM_GRADE_A, groundedSchema: "trade/electrical" },
  plumbing:      { tier: TIER.SIM_GRADE_A, groundedSchema: "trade/plumbing" },
  masonry:       { tier: TIER.SIM_GRADE_A, groundedSchema: "trade/masonry" },
  welding:       { tier: TIER.SIM_GRADE_A, groundedSchema: "trade/welding" },
  hvac:          { tier: TIER.SIM_GRADE_A, groundedSchema: "trade/hvac" },
  landscaping:   { tier: TIER.SIM_GRADE_A, groundedSchema: "trade/landscape" },
  mining:        { tier: TIER.SIM_GRADE_A, groundedSchema: "trade/mining" },
  trades:        { tier: TIER.SIM_GRADE_A, groundedSchema: "trade/all" },
  tools:         { tier: TIER.SIM_GRADE_A, groundedSchema: "trade/tool" },
  maker:         { tier: TIER.SIM_GRADE_A, groundedSchema: "make/project" },
  app_maker:     { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real app-maker" },
  "app-maker":   { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real app-maker" },
  art_2:         { tier: TIER.SIM_GRADE_A, groundedSchema: "art/concept" },
  artistry:      { tier: TIER.SIM_GRADE_A, groundedSchema: "artistry/work" },
  animation:     { tier: TIER.SIM_GRADE_A, groundedSchema: "anim/clip" },
  design:        { tier: TIER.SIM_GRADE_A, groundedSchema: "design/spec" },
  whiteboard:    { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real whiteboard sessions" },
  docs:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real docs" },
  poetry_2:      { tier: TIER.SIM_GRADE_A, groundedSchema: "creative/poem" },
  semiotics:     { tier: TIER.SIM_GRADE_A, groundedSchema: "semiotics/sign" },
  science:       { tier: TIER.SIM_GRADE_A, groundedSchema: "science/experiment" },
  lab:           { tier: TIER.SIM_GRADE_A, groundedSchema: "lab/protocol" },
  materials:     { tier: TIER.SIM_GRADE_A, groundedSchema: "materials/sample" },
  manufacturing: { tier: TIER.SIM_GRADE_A, groundedSchema: "manuf/run" },
  supplychain:   { tier: TIER.SIM_GRADE_A, groundedSchema: "supply/chain" },
  "supply-chain": { tier: TIER.SIM_GRADE_A, groundedSchema: "supply/chain" },
  logistics:     { tier: TIER.SIM_GRADE_A, groundedSchema: "logistics/route" },
  urban_planning: { tier: TIER.SIM_GRADE_A, groundedSchema: "urban/plan" },
  "urban-planning": { tier: TIER.SIM_GRADE_A, groundedSchema: "urban/plan" },
  construction:  { tier: TIER.SIM_GRADE_A, groundedSchema: "construct/project" },
  engineering:   { tier: TIER.SIM_GRADE_A, groundedSchema: "eng/project" },
  entity:        { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real entity substrate" },
  organ:         { tier: TIER.SIM_GRADE_A, groundedSchema: "bio/organ" },
  suffering:     { tier: TIER.SIM_GRADE_A, groundedSchema: "exper/affect" },
  self:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real self/persona" },
  fitness_2:     { tier: TIER.SIM_GRADE_A, groundedSchema: "fitness/program" },
  forum:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real forum" },
  grounding:     { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real grounding evidence" },
  commonsense:   { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real commonsense graph" },
  repos:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, sources: ["github.api"], note: "GitHub repos" },
  code_quality:  { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real code quality scoring" },
  "code-quality": { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real code quality scoring" },
  vote:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real council votes" },
  answers:       { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real Q&A" },
  anon:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real anon mode" },
  all:           { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real cross-lens roll-up" },
  root:          { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real root navigation" },
  board:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real board" },
  crafting:      { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real recipe substrate" },
  brain_health:  { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real brain health" },
  ux_suite_2:    { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real ux suite" },

  // ───────────────────────────────────────────────────────────────────────────
  // DEMO — paywalled / industry-licensed feeds we haven't acquired.
  // Surface works; data is synthetic. Every entry MUST declare paywallReason.
  // ───────────────────────────────────────────────────────────────────────────
  healthcare:    { tier: TIER.DEMO, paywallReason: "EHR feeds (Epic/Cerner) require BAA + integration contract" },
  legal:         { tier: TIER.DEMO, paywallReason: "Westlaw / LexisNexis case-law APIs are paid (~$200/user/mo)" },
  realestate:    { tier: TIER.DEMO, paywallReason: "MLS feeds require broker relationship + regional licensing" },
  insurance:     { tier: TIER.DEMO, paywallReason: "claims systems are industry-internal" },
  defense:       { tier: TIER.DEMO, paywallReason: "controlled feeds; export-restricted" },
  aviation:      { tier: TIER.DEMO, paywallReason: "FAA NOTAM / SWIM feeds require commercial agreement" },
  telecommunications: { tier: TIER.DEMO, paywallReason: "FCC spectrum auctions + Telcordia data are paid" },
  automotive:    { tier: TIER.DEMO, paywallReason: "Edmunds / Kelley Blue Book are paid; OEM telematics are gated" },
  death_insurance: { tier: TIER.DEMO, paywallReason: "actuarial mortality tables + carrier filings are paid" },
  "death-insurance": { tier: TIER.DEMO, paywallReason: "actuarial mortality tables + carrier filings are paid" },

  // Allow registry hits for the few additional manifest entries that surfaced
  // late and don't fit cleanly anywhere.
  cri_3:         { tier: TIER.REAL_LIVE, liveFromSubstrate: true, note: "real cri" },
});

/**
 * Lookup a registry entry. Returns null if unmapped.
 */
export function getIntegration(lensId) {
  if (!lensId) return null;
  return REGISTRY[lensId] || REGISTRY[lensId.replace(/-/g, "_")] || REGISTRY[lensId.replace(/_/g, "-")] || null;
}

/**
 * Get just the tier (or null).
 */
export function getTier(lensId) {
  const entry = getIntegration(lensId);
  return entry?.tier || null;
}

/**
 * Coverage summary: how many lenses each tier covers. Used by the
 * integration-registry contract test and CI dashboard.
 */
export function coverageSummary() {
  const counts = { REAL_LIVE: 0, REAL_FREE: 0, SIM_GRADE_A: 0, DEMO: 0, total: 0 };
  for (const key of Object.keys(REGISTRY)) {
    const entry = REGISTRY[key];
    counts[entry.tier] = (counts[entry.tier] || 0) + 1;
    counts.total += 1;
  }
  return counts;
}
