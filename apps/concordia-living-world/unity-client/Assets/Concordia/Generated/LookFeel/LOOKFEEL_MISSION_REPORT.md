# Lookfeel mission report

**STATUS: COMPLETE**

Text only. No concept images, no mesh, no pack download, no process killed. Existing native-bible catalogs and the prior 215 aura rows were kept. New rows were appended.

## Counts

| Set | Count |
| --- | ---: |
| Worlds on `MAP_MASTER.json` | 10 |
| Links | 31 |
| Named sites | 47 |
| Hub districts | 8 |
| Style boards | 10 |
| Geography briefs | 10 |
| `env_` prompts | 70 |
| `arch_` prompts | 36 |
| `flora_` prompts | 33 |
| Prompt rows added to `PROMPTS_INDEX.json` | 139 |
| `PROMPTS_INDEX.json` total | 354 |

Batches: `B18_lookfeel_env` (70), `B19_lookfeel_arch` (36), `B20_lookfeel_flora` (33). Volume batches B12–B17 were already used, so this pack starts at B18.

## Files

| Path | Role |
| --- | --- |
| `MAP_MASTER.md` | Human atlas |
| `MAP_MASTER.json` | Worlds, links, districts, sites |
| `MAP_ASCII.txt` | One-plane diagram and mermaid |
| `GATE_AND_ROAD_TABLE.md` | Eight spokes and the Sere waystone |
| `styles/STYLE_<WorldId>.md` | Ten boards |
| `styles/STYLE_INDEX.json` | Palette and kit index |
| `styles/GLOBAL_LOOK_RULES.md` | Shared PBR floor |
| `geography/GEO_<WorldId>.md` | Ten briefs, Tunya countries included |
| `geography/GEOGRAPHY_INDEX.json` | Machine index |
| `prompts/ENV_PROMPTS.json` | Environment concepts |
| `prompts/ARCH_HERO_PROMPTS.json` | Kit heroes |
| `prompts/FLORA_PROMPTS.json` | Biome plants |
| `FEEL_UI_CHROME.md` | Parchment and steel |
| `FEEL_LIGHTING.md` | Day, night, SoftEnter grades |
| `FEEL_AUDIO_VISUAL_CUES.md` | Spoil, gossip, threat shapes |
| `PIPELINE_FEED.md` | What organic renders next |
| `LOOKFEEL_MISSION_REPORT.md` | This file |

Primary: `~/.zuko/lookfeel/`  
Mirror: `Assets/Concordia/Generated/LookFeel/`

## Map contract

Hub at origin. Canon Ring 400 km, authored. Present scale 0.55 m/km. Sere at 1.35 × ring on Crime's angle + 0.35 rad, no Link. Spoke discs 110 km and the Sere disc 80 km are design-intent, labeled, so the march between neighbors is 86.1 km and the Crime–Sere water gap is about 24 km. Flower Law remains 42 Hub-local metres. Pinewood Crossing remains (62, −28).

## Next for the organic batch runner

Concept only, `aura_prompt` verbatim, explicit triangle budgets from `PIPELINE_FEED.md`. Do not use `conceptPrompt()`'s creature wrapper on these ids.

1. Ten SoftEnter architecture heroes (one per world), batch B19.
2. The matching B18 landmarks, including the urn, the milepost, the waystone, and the furnace stack.
3. One B20 plant per world.
4. Approve two or three seeds against the 100 m checklist before any mesh.

`budgetFor()` will mis-label these as fauna until that function grows a branch. Pass the budget in the call.
