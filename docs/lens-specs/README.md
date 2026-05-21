# Lens Feature-Gap Index

Honest per-lens feature-parity audit against each category's top 2026 app.
Generated from the individual `docs/lens-specs/*.md` files (each written by
reading the actual lens page + backend code).

**Scoring bar:** functional feature parity only. Content volume is excluded —
every lens fills its catalog/data via free public APIs + user uploads by
design. Licensed content is the *only* acknowledged structural gap; every
item in every "Missing" backlog is a buildable feature (no licensing walls).

## Aggregate

- Lenses audited: **235**
- Average feature parity: **~59%**
- Total buildable features in the backlog (sum of all "Missing" items): **1381**

| Parity band | Lenses |
|---|---|
| 80–100% (near-complete) | 41 |
| 60–79% (strong) | 59 |
| 40–59% (partial) | 133 |
| <40% (thin) | 0 |

## Per-lens (sorted weakest → strongest — the build priority order)

| Lens | Category leader | Parity | Buildable features missing |
|---|---|---:|---:|
| personas | Character.AI | ~?% | 0 |
| quantum | IBM Quantum Composer | ~?% | 0 |
| hypothesis | JASP / GraphPad Prism | ~40% | 7 |
| integrations | Zapier | ~40% | 8 |
| invariant | TLA+ / formal-verification tools | ~40% | 6 |
| law-enforcement | Axon Records / Mark43 (RMS/CAD) | ~40% | 7 |
| legacy | SonarQube / CAST Imaging (legacy modernization) | ~40% | 7 |
| markets | Polymarket / Kalshi (prediction markets) | ~40% | 8 |
| masonry | Buildertrend / masonry estimating tools | ~40% | 8 |
| math | Wolfram Alpha | ~40% | 8 |
| mentorship | MentorcliQ / ADPList | ~40% | 8 |
| meta | Backstage / system-introspection tools | ~40% | 7 |
| mining | MineHub / Micromine | ~40% | 8 |
| organ | ChartHop | ~40% | 7 |
| queue | RabbitMQ / BullMQ dashboard | ~40% | 7 |
| saved | Twitter/X Bookmarks | ~40% | 7 |
| sentinel | CrowdStrike Falcon / threat console | ~40% | 7 |
| society | Our World in Data / Gapminder | ~40% | 8 |
| suffering | Productboard / pain-point analysis tools | ~40% | 8 |
| telecommunications | telecom planning suites (Atoll / iBwave) | ~40% | 8 |
| temporal | Prophet / Tableau time-series analysis | ~40% | 8 |
| tournaments | Challonge / Battlefy | ~40% | 8 |
| urban-planning | UrbanFootprint / Esri Urban | ~40% | 8 |
| vote | Polis / Decidim / Snapshot | ~40% | 8 |
| worldmodel | Palantir Foundry / digital-twin platforms | ~40% | 8 |
| attention | Sunsama / Motion | ~42% | 7 |
| carpentry | Houzz Pro / Buildertrend (trades) | ~42% | 7 |
| collab | Figma / Google Docs (real-time collaboration) | ~44% | 7 |
| alliance | Slack Connect / Discord | ~45% | 7 |
| artistry | Behance / ArtStation | ~45% | 7 |
| billing | Stripe Billing | ~45% | 7 |
| code-quality | SonarQube / CodeClimate | ~45% | 7 |
| construction | Procore | ~45% | 8 |
| database | DBeaver / TablePlus | ~45% | 7 |
| disputes | marketplace dispute / ODR systems | ~45% | 7 |
| diy | Instructables / Sortly | ~45% | 7 |
| electrical | ServiceTitan (electrical) + NEC calc tools | ~45% | 7 |
| emergency-services | CAD dispatch systems | ~45% | 7 |
| ethics | Ethical OS / decision-ethics tooling | ~45% | 6 |
| expert-mode | Perplexity | ~45% | 7 |
| ghost-tracker | no direct rival (in-game mode) | ~45% | 6 |
| grounding | Ground News / fact-check tools | ~45% | 7 |
| home-improvement | Houzz / HomeZada | ~45% | 7 |
| hvac | ServiceTitan / Housecall Pro | ~45% | 7 |
| inference | Prolog / Drools rule engines | ~45% | 7 |
| ingest | Airbyte / Fivetran | ~45% | 7 |
| lattice | Weights & Biases / fine-tuning consoles | ~45% | 8 |
| lock | concurrency-debugging tools (Java Flight Recorder / lock profilers) | ~45% | 6 |
| manufacturing | Tulip / Plex MES | ~45% | 8 |
| market | Crayon / Klue (competitive intelligence) | ~45% | 7 |
| mesh | Meshtastic / Briar | ~45% | 8 |
| metacognition | reflection / thinking-skills tools | ~45% | 7 |
| metalearning | learning-how-to-learn tools | ~45% | 7 |
| nonprofit | Bloomerang / Givebutter | ~45% | 8 |
| offline | PouchDB/Dexie + Workbox | ~45% | 6 |
| plumbing | ServiceTitan / Jobber | ~45% | 7 |
| privacy | OneTrust / Apple Privacy settings | ~45% | 7 |
| resonance | cross-domain analogy / knowledge-graph tool | ~45% | 7 |
| services | Square Appointments / Vagaro | ~45% | 7 |
| sim | AnyLogic / Vensim | ~45% | 8 |
| sports | ESPN | ~45% | 9 |
| staking | Coinbase / Lido staking | ~45% | 8 |
| supplychain | SAP IBP / Anaplan | ~45% | 8 |
| system | Datadog / Grafana (observability) | ~45% | 8 |
| tick | Datadog / heartbeat monitors (Better Uptime) | ~45% | 7 |
| timeline | Facebook timeline | ~45% | 8 |
| veterinary | ezyVet / Provet Cloud | ~45% | 8 |
| welding | Jobber / contractor field-service (welding trade) | ~45% | 8 |
| bio | Benchling / SnapGene | ~48% | 7 |
| cognitive-replay | Spotify Wrapped / RescueTime timeline | ~48% | 7 |
| admin | Datadog / Grafana | ~50% | 7 |
| bridge | (cross-world federation console) | ~50% | 6 |
| chem | ChemDraw / PubChem | ~50% | 7 |
| commonsense | ConceptNet / Cyc | ~50% | 7 |
| consulting | Bonsai / Harvest | ~50% | 8 |
| creative | StudioBinder / Frame.io | ~50% | 7 |
| cri | data-quality scorecard tooling | ~50% | 6 |
| deities | in-game pantheon system (no consumer rival) | ~50% | 6 |
| docs | Notion / Confluence | ~50% | 8 |
| dreams | in-game dream-record system (no consumer rival) | ~50% | 6 |
| dtus | knowledge-base browser (internal) | ~50% | 7 |
| events | Eventbrite / Cvent | ~50% | 7 |
| federation | Mastodon / ActivityPub admin | ~50% | 7 |
| forge | v0.dev / Bolt.new | ~50% | 7 |
| foundry | Roblox Studio / GameMaker | ~50% | 7 |
| game | Habitica / gamification platforms | ~50% | 7 |
| genesis | no direct rival (emergent-AI observatory) | ~50% | 6 |
| global | Our World in Data / World Bank DataBank | ~50% | 7 |
| kingdoms | Crusader Kings III | ~50% | 7 |
| landscaping | iScape / LandscapePro | ~50% | 8 |
| marketing | HubSpot Marketing Hub | ~50% | 8 |
| materials | Granta MI / Materials Project | ~50% | 7 |
| meditation | Calm / Headspace | ~50% | 7 |
| ocean | Windy / MarineTraffic | ~50% | 7 |
| philosophy | Are.na / IEP | ~50% | 7 |
| photography | Adobe Lightroom | ~50% | 7 |
| physics | PhET / Algodoo | ~50% | 7 |
| reasoning | Rationale / argument-mapping tools | ~50% | 7 |
| security | Splunk / a SOC console | ~50% | 7 |
| self | Apple Health / Gyroscope | ~50% | 7 |
| space | NASA Eyes / Stellarium / Flightradar-for-launches | ~50% | 8 |
| understanding | Obsidian / RemNote (knowledge synthesis) | ~50% | 8 |
| command-center | Datadog / PagerDuty (ops cockpit) | ~52% | 7 |
| affect | Daylio / Hume AI | ~55% | 7 |
| astronomy | SkySafari / Stellarium | ~55% | 7 |
| daily | Day One / Reflectly | ~55% | 7 |
| debate | Kialo | ~55% | 7 |
| dx-platform | Sourcegraph Cody / GitHub Copilot platform | ~55% | 7 |
| eco | iNaturalist / JouleBug | ~55% | 6 |
| energy | Sense / Span Home | ~55% | 7 |
| export | Google Takeout / Notion Export | ~55% | 7 |
| forestry | SilvAssist / forest-management software | ~55% | 6 |
| fork | GitHub (fork network / insights) | ~55% | 6 |
| gallery | Google Arts & Culture / Artsy | ~55% | 7 |
| geology | USGS apps / Rockd | ~55% | 6 |
| goddess | no direct rival (in-world ambient feed) | ~55% | 6 |
| history | TimelineJS / Wikipedia | ~55% | 7 |
| import | Flatfile / Airbyte (data import) | ~55% | 7 |
| law | Ironclad (contract lifecycle) | ~55% | 7 |
| linguistics | Vocabulary.com / Datamuse | ~55% | 7 |
| logistics | Project44 / FourKites (supply-chain visibility) | ~55% | 7 |
| marketplace | Etsy (seller side) | ~55% | 8 |
| music | Spotify (2026) | ~55% | 17 |
| news | Apple News / Ground News | ~55% | 7 |
| podcast | Apple Podcasts / Spotify | ~55% | 7 |
| poetry | Poetry Foundation / poetry notebook | ~55% | 7 |
| science | LabArchives / GraphPad Prism | ~55% | 7 |
| sessions | a workflow / task-session manager | ~55% | 7 |
| srs | Anki | ~55% | 9 |
| thread | Typefully | ~55% | 7 |
| travel | Google Travel / TripIt | ~55% | 8 |
| analytics | Mixpanel / Amplitude | ~58% | 7 |
| atlas | Google Maps | ~58% | 7 |
| board | Trello | ~58% | 8 |
| byo-keys | OpenRouter / LiteLLM key management | ~58% | 6 |
| animation | FlipaClip / Pencil2D | ~60% | 7 |
| black-market | (in-game grey-market stall) | ~60% | 6 |
| cognition | (reasoning-substrate console) | ~60% | 6 |
| council | Loomio / Convene | ~60% | 6 |
| crafting | MMO crafting systems | ~60% | 7 |
| creative-writing | Scrivener | ~60% | 7 |
| creator | YouTube Studio / Patreon | ~60% | 7 |
| death-insurance | in-game inheritance pact (no consumer rival) | ~60% | 6 |
| environment | Persefoni / Watershed (carbon accounting) | ~60% | 6 |
| forecast | Weather apps (no direct rival) | ~60% | 6 |
| forum | Reddit / Discourse | ~60% | 7 |
| goals | Notion / Weekdone OKR | ~60% | 7 |
| household | Cozi / Sweepy | ~60% | 7 |
| legal | Clio (legal practice management) | ~60% | 7 |
| mental-health | Daylio / Finch / Wysa | ~60% | 8 |
| message | Slack | ~60% | 7 |
| paper | Zotero / arXiv | ~60% | 7 |
| parenting | Huckleberry | ~60% | 7 |
| pharmacy | Medisafe / GoodRx | ~60% | 7 |
| productivity | Todoist | ~60% | 7 |
| reflection | Day One | ~60% | 7 |
| research | Obsidian / Elicit | ~60% | 7 |
| sandbox | a game combat-feel test scene | ~60% | 6 |
| social | Instagram / X (Twitter) | ~60% | 9 |
| studio | Ableton Live | ~60% | 8 |
| trades | ServiceTitan / Jobber | ~60% | 8 |
| voice | Otter.ai | ~60% | 7 |
| wallet | PayPal / Venmo | ~60% | 8 |
| aviation | ForeFlight | ~62% | 7 |
| all | App Launcher / Command Palette | ~65% | 5 |
| answers | Stack Overflow | ~65% | 7 |
| fashion | Whering / Stylebook | ~65% | 7 |
| fitness | Strava / Garmin Connect | ~65% | 7 |
| government | civic portals (Accela / USA.gov) | ~65% | 7 |
| hr | Workday / Bamboo HR | ~65% | 7 |
| insurance | Applied Epic / EZLynx (agency management) | ~65% | 7 |
| pets | 11pets / Pawprint | ~65% | 7 |
| realestate | Zillow | ~65% | 7 |
| whiteboard | Miro / FigJam | ~65% | 7 |
| world | a 3D open-world game (Roblox / Genshin Impact) | ~65% | 8 |
| art | Procreate / Krita | ~68% | 7 |
| automotive | CARFAX Car Care / Drivvo | ~68% | 7 |
| chat | ChatGPT | ~68% | 7 |
| agriculture | Climate FieldView | ~70% | 7 |
| crypto | Coinbase | ~70% | 7 |
| education | Khan Academy / Coursera | ~70% | 6 |
| feed | X (Twitter) / Threads | ~70% | 7 |
| film-studios | StudioBinder / Final Cut Pro | ~70% | 7 |
| finance | Monarch Money / Empower | ~70% | 7 |
| game-design | GameMaker / Tiled + GDD tools | ~70% | 7 |
| graph | Obsidian (graph view) / Kumu | ~70% | 7 |
| healthcare | Epic MyChart / Epic EHR | ~70% | 7 |
| root | a programmer's calculator | ~70% | 6 |
| calendar | Google Calendar | ~72% | 7 |
| code | Cursor / VS Code | ~72% | 7 |
| cooking | Paprika / Samsung Food | ~75% | 7 |
| food | Paprika / Yelp / MyFitnessPal | ~75% | 7 |
| retail | Shopify | ~75% | 7 |
| accounting | QuickBooks Online | ~78% | 8 |
| projects | Linear / Asana | ~80% | 7 |
| anon | Signal | ~85% | 0 |
| app-maker | Bubble / Glide | ~85% | 0 |
| ar | Adobe Aero / Niantic Studio | ~85% | 0 |
| bounties | Gitcoin / HackerOne bounties | ~85% | 0 |
| crisis-ops | Dataminr / Everbridge | ~85% | 0 |
| custom | Retool / Glide | ~85% | 0 |
| engineering | Fusion 360 / SimScale | ~85% | 0 |
| expedition-journal | in-game world-progress tracker (no consumer rival) | ~85% | 0 |
| fractal | Mandelbulber / fractal generators | ~85% | 0 |
| inheritance | Trust & Will / estate-planning apps | ~85% | 0 |
| lab | Benchling / LabArchives (ELN/LIMS) | ~85% | 0 |
| maker | Retool / Bubble (no-code app builder) | ~85% | 0 |
| ml | Hugging Face | ~85% | 0 |
| observe | Datadog | ~85% | 0 |
| platform | Vercel / Heroku dashboard | ~85% | 0 |
| repos | GitHub | ~85% | 0 |
| robotics | ROS / robot simulation tools | ~85% | 0 |
| sponsorship | Patreon | ~85% | 0 |
| sub-worlds | Roblox / Rec Room (user-spawned worlds) | ~85% | 0 |
| sync | iCloud / Dropbox / Syncthing | ~85% | 0 |
| transfer | Fivetran / Airbyte (data migration / ETL) | ~85% | 0 |
| ux-suite | Storybook / a component directory | ~85% | 0 |
| world-creator | Roblox Studio / Core / Unreal Editor | ~85% | 0 |
| neuro | EEGLAB / MNE-Python | ~88% | 0 |
| ops | PagerDuty | ~88% | 0 |
| psyops | threat-intelligence / anomaly-detection console | ~88% | 0 |
| questmarket | Bountysource / gamified quest board | ~88% | 0 |
| schema | JSON Schema tooling / Hasura console | ~88% | 0 |
| agents | OpenAI Assistants / CrewAI | ~90% | 0 |
| audit | Vanta / Drata | ~90% | 0 |
| classroom | Google Classroom | ~90% | 0 |
| debug | Sentry / Datadog | ~90% | 0 |
| defense | Palantir Gotham (analog) | ~90% | 0 |
| desert | field-survey / arid-environment tooling | ~90% | 0 |
| entity | Palantir Foundry / knowledge-graph tools | ~90% | 0 |
| event-timeline | activity-feed / audit-log viewers | ~90% | 0 |
| experience | Maze / UserTesting | ~90% | 0 |
| settings | OS/App Settings panels (macOS System Settings / Steam Settings) | ~90% | 0 |
| tools | utility bundle (Perplexity + Babel REPL + DocuSign) | ~90% | 0 |
| wellness | Whoop / Calm / CBT apps | ~90% | 0 |
