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
- Average feature parity: **~86%**
- Total buildable features in the backlog (sum of all "Missing" items): **262**

| Parity band | Lenses |
|---|---|
| 80–100% (near-complete) | 199 |
| 60–79% (strong) | 36 |
| 40–59% (partial) | 0 |
| <40% (thin) | 0 |

## Per-lens (sorted weakest → strongest — the build priority order)

| Lens | Category leader | Parity | Buildable features missing |
|---|---|---:|---:|
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
| construction | Procore | ~85% | 0 |
| crisis-ops | Dataminr / Everbridge | ~85% | 0 |
| custom | Retool / Glide | ~85% | 0 |
| database | DBeaver / TablePlus | ~85% | 0 |
| disputes | marketplace dispute / ODR systems | ~85% | 0 |
| diy | Instructables / Sortly | ~85% | 0 |
| electrical | ServiceTitan (electrical) + NEC calc tools | ~85% | 0 |
| emergency-services | CAD dispatch systems | ~85% | 0 |
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
| admin | Datadog / Grafana | ~88% | 0 |
| alliance | Slack Connect / Discord | ~88% | 0 |
| artistry | Behance / ArtStation | ~88% | 0 |
| attention | Sunsama / Motion | ~88% | 0 |
| billing | Stripe Billing | ~88% | 0 |
| bio | Benchling / SnapGene | ~88% | 0 |
| carpentry | Houzz Pro / Buildertrend (trades) | ~88% | 0 |
| code-quality | SonarQube / CodeClimate | ~88% | 0 |
| cognitive-replay | Spotify Wrapped / RescueTime timeline | ~88% | 0 |
| commonsense | ConceptNet / Cyc | ~88% | 0 |
| consulting | Bonsai / Harvest | ~88% | 0 |
| creative | StudioBinder / Frame.io | ~88% | 0 |
| cri | data-quality scorecard tooling | ~88% | 0 |
| deities | in-game pantheon system (no consumer rival) | ~88% | 0 |
| docs | Notion / Confluence | ~88% | 0 |
| dreams | in-game dream-record system (no consumer rival) | ~88% | 0 |
| dtus | knowledge-base browser (internal) | ~88% | 0 |
| ethics | Ethical OS / decision-ethics tooling | ~88% | 0 |
| events | Eventbrite / Cvent | ~88% | 0 |
| expert-mode | Perplexity | ~88% | 0 |
| federation | Mastodon / ActivityPub admin | ~88% | 0 |
| forge | v0.dev / Bolt.new | ~88% | 0 |
| foundry | Roblox Studio / GameMaker | ~88% | 0 |
| game | Habitica / gamification platforms | ~88% | 0 |
| genesis | no direct rival (emergent-AI observatory) | ~88% | 0 |
| ghost-tracker | no direct rival (in-game mode) | ~88% | 0 |
| grounding | Ground News / fact-check tools | ~88% | 0 |
| home-improvement | Houzz / HomeZada | ~88% | 0 |
| hvac | ServiceTitan / Housecall Pro | ~88% | 0 |
| inference | Prolog / Drools rule engines | ~88% | 0 |
| ingest | Airbyte / Fivetran | ~88% | 0 |
| kingdoms | Crusader Kings III | ~88% | 0 |
| landscaping | iScape / LandscapePro | ~88% | 0 |
| lattice | Weights & Biases / fine-tuning consoles | ~88% | 0 |
| lock | concurrency-debugging tools (Java Flight Recorder / lock profilers) | ~88% | 0 |
| manufacturing | Tulip / Plex MES | ~88% | 0 |
| market | Crayon / Klue (competitive intelligence) | ~88% | 0 |
| marketing | HubSpot Marketing Hub | ~88% | 0 |
| materials | Granta MI / Materials Project | ~88% | 0 |
| mesh | Meshtastic / Briar | ~88% | 0 |
| metacognition | reflection / thinking-skills tools | ~88% | 0 |
| metalearning | learning-how-to-learn tools | ~88% | 0 |
| neuro | EEGLAB / MNE-Python | ~88% | 0 |
| nonprofit | Bloomerang / Givebutter | ~88% | 0 |
| offline | PouchDB/Dexie + Workbox | ~88% | 0 |
| ops | PagerDuty | ~88% | 0 |
| plumbing | ServiceTitan / Jobber | ~88% | 0 |
| privacy | OneTrust / Apple Privacy settings | ~88% | 0 |
| psyops | threat-intelligence / anomaly-detection console | ~88% | 0 |
| questmarket | Bountysource / gamified quest board | ~88% | 0 |
| resonance | cross-domain analogy / knowledge-graph tool | ~88% | 0 |
| schema | JSON Schema tooling / Hasura console | ~88% | 0 |
| services | Square Appointments / Vagaro | ~88% | 0 |
| sim | AnyLogic / Vensim | ~88% | 0 |
| sports | ESPN | ~88% | 0 |
| staking | Coinbase / Lido staking | ~88% | 0 |
| temporal | Prophet / Tableau time-series analysis | ~88% | 0 |
| tournaments | Challonge / Battlefy | ~88% | 0 |
| urban-planning | UrbanFootprint / Esri Urban | ~88% | 0 |
| vote | Polis / Decidim / Snapshot | ~88% | 0 |
| worldmodel | Palantir Foundry / digital-twin platforms | ~88% | 0 |
| affect | Daylio / Hume AI | ~90% | 0 |
| agents | OpenAI Assistants / CrewAI | ~90% | 0 |
| audit | Vanta / Drata | ~90% | 0 |
| bridge | (cross-world federation console) | ~90% | 0 |
| chem | ChemDraw / PubChem | ~90% | 0 |
| classroom | Google Classroom | ~90% | 0 |
| collab | Figma / Google Docs (real-time collaboration) | ~90% | 0 |
| command-center | Datadog / PagerDuty (ops cockpit) | ~90% | 0 |
| debug | Sentry / Datadog | ~90% | 0 |
| defense | Palantir Gotham (analog) | ~90% | 0 |
| desert | field-survey / arid-environment tooling | ~90% | 0 |
| entity | Palantir Foundry / knowledge-graph tools | ~90% | 0 |
| event-timeline | activity-feed / audit-log viewers | ~90% | 0 |
| experience | Maze / UserTesting | ~90% | 0 |
| global | Our World in Data / World Bank DataBank | ~90% | 0 |
| goddess | no direct rival (in-world ambient feed) | ~90% | 0 |
| hypothesis | JASP / GraphPad Prism | ~90% | 0 |
| integrations | Zapier | ~90% | 0 |
| invariant | TLA+ / formal-verification tools | ~90% | 0 |
| law-enforcement | Axon Records / Mark43 (RMS/CAD) | ~90% | 0 |
| legacy | SonarQube / CAST Imaging (legacy modernization) | ~90% | 0 |
| markets | Polymarket / Kalshi (prediction markets) | ~90% | 0 |
| masonry | Buildertrend / masonry estimating tools | ~90% | 0 |
| math | Wolfram Alpha | ~90% | 0 |
| meditation | Calm / Headspace | ~90% | 0 |
| mentorship | MentorcliQ / ADPList | ~90% | 0 |
| meta | Backstage / system-introspection tools | ~90% | 0 |
| mining | MineHub / Micromine | ~90% | 0 |
| ocean | Windy / MarineTraffic | ~90% | 0 |
| organ | ChartHop | ~90% | 0 |
| personas | Character.AI | ~90% | 0 |
| philosophy | Are.na / IEP | ~90% | 0 |
| photography | Adobe Lightroom | ~90% | 0 |
| physics | PhET / Algodoo | ~90% | 0 |
| quantum | IBM Quantum Composer | ~90% | 0 |
| queue | RabbitMQ / BullMQ dashboard | ~90% | 0 |
| reasoning | Rationale / argument-mapping tools | ~90% | 0 |
| saved | Twitter/X Bookmarks | ~90% | 0 |
| security | Splunk / a SOC console | ~90% | 0 |
| self | Apple Health / Gyroscope | ~90% | 0 |
| sentinel | CrowdStrike Falcon / threat console | ~90% | 0 |
| settings | OS/App Settings panels (macOS System Settings / Steam Settings) | ~90% | 0 |
| society | Our World in Data / Gapminder | ~90% | 0 |
| space | NASA Eyes / Stellarium / Flightradar-for-launches | ~90% | 0 |
| suffering | Productboard / pain-point analysis tools | ~90% | 0 |
| supplychain | SAP IBP / Anaplan | ~90% | 0 |
| system | Datadog / Grafana (observability) | ~90% | 0 |
| telecommunications | telecom planning suites (Atoll / iBwave) | ~90% | 0 |
| tick | Datadog / heartbeat monitors (Better Uptime) | ~90% | 0 |
| timeline | Facebook timeline | ~90% | 0 |
| tools | utility bundle (Perplexity + Babel REPL + DocuSign) | ~90% | 0 |
| understanding | Obsidian / RemNote (knowledge synthesis) | ~90% | 0 |
| veterinary | ezyVet / Provet Cloud | ~90% | 0 |
| welding | Jobber / contractor field-service (welding trade) | ~90% | 0 |
| wellness | Whoop / Calm / CBT apps | ~90% | 0 |
| analytics | Mixpanel / Amplitude | ~95% | 0 |
| animation | FlipaClip / Pencil2D | ~95% | 0 |
| astronomy | SkySafari / Stellarium | ~95% | 0 |
| atlas | Google Maps | ~95% | 0 |
| black-market | (in-game grey-market stall) | ~95% | 0 |
| board | Trello | ~95% | 0 |
| byo-keys | OpenRouter / LiteLLM key management | ~95% | 0 |
| cognition | (reasoning-substrate console) | ~95% | 0 |
| council | Loomio / Convene | ~95% | 0 |
| crafting | MMO crafting systems | ~95% | 0 |
| creative-writing | Scrivener | ~95% | 0 |
| creator | YouTube Studio / Patreon | ~95% | 0 |
| daily | Day One / Reflectly | ~95% | 0 |
| death-insurance | in-game inheritance pact (no consumer rival) | ~95% | 0 |
| debate | Kialo | ~95% | 0 |
| dx-platform | Sourcegraph Cody / GitHub Copilot platform | ~95% | 0 |
| eco | iNaturalist / JouleBug | ~95% | 0 |
| energy | Sense / Span Home | ~95% | 0 |
| environment | Persefoni / Watershed (carbon accounting) | ~95% | 0 |
| export | Google Takeout / Notion Export | ~95% | 0 |
| forecast | Weather apps (no direct rival) | ~95% | 0 |
| forestry | SilvAssist / forest-management software | ~95% | 0 |
| fork | GitHub (fork network / insights) | ~95% | 0 |
| forum | Reddit / Discourse | ~95% | 0 |
| gallery | Google Arts & Culture / Artsy | ~95% | 0 |
| geology | USGS apps / Rockd | ~95% | 0 |
| goals | Notion / Weekdone OKR | ~95% | 0 |
| history | TimelineJS / Wikipedia | ~95% | 0 |
| household | Cozi / Sweepy | ~95% | 0 |
| import | Flatfile / Airbyte (data import) | ~95% | 0 |
| law | Ironclad (contract lifecycle) | ~95% | 0 |
| legal | Clio (legal practice management) | ~95% | 0 |
| linguistics | Vocabulary.com / Datamuse | ~95% | 0 |
| logistics | Project44 / FourKites (supply-chain visibility) | ~95% | 0 |
| marketplace | Etsy (seller side) | ~95% | 0 |
| mental-health | Daylio / Finch / Wysa | ~95% | 0 |
| message | Slack | ~95% | 0 |
| music | Spotify (2026) | ~95% | 0 |
| news | Apple News / Ground News | ~95% | 0 |
| paper | Zotero / arXiv | ~95% | 0 |
| parenting | Huckleberry | ~95% | 0 |
| pharmacy | Medisafe / GoodRx | ~95% | 0 |
| podcast | Apple Podcasts / Spotify | ~95% | 0 |
| poetry | Poetry Foundation / poetry notebook | ~95% | 0 |
| productivity | Todoist | ~95% | 0 |
| reflection | Day One | ~95% | 0 |
| research | Obsidian / Elicit | ~95% | 0 |
| sandbox | a game combat-feel test scene | ~95% | 0 |
| science | LabArchives / GraphPad Prism | ~95% | 0 |
| sessions | a workflow / task-session manager | ~95% | 0 |
| srs | Anki | ~95% | 0 |
| thread | Typefully | ~95% | 0 |
| travel | Google Travel / TripIt | ~95% | 0 |
