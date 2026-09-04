# VISUAL

**Status:** LIVE (owned My Assets imported into this `unity-client`) · Kenney is last fallback  
**Authority:** Unity (presentation) — culture keys come from `WorldId`, never invented place names  
**Source:** `DressVocab` in `FreePacks.cs`, `CityTown` in `RealmFill.cs`, `BuildingInterior.cs`

## LIVE

`DressVocab` maps each Refusal world to a culture kit:

| WorldId | Culture | Dressing |
|---|---|---|
| Hub | court | Unpaved Court. No town dump. |
| Tunya / Fantasy / Frontier | grove | Houses, trees, crops / palms. Fantasy + Ruins also get a fort rim. |
| Ruins | ash | Crypt / remnant stems. |
| Crime / Sere | street | Shop / warehouse / dumpster. |
| Cyber / Superhero | grid | Lab / skyline stems. |
| Crucible | drift | Crystal / tower stems. |

Resolution order: imported My Assets (`Assets/Store/`, `Assets/AssetStore/`, `Assets/FreeAssets/`, or any other top-level `Assets/<Pack Name>/`) → **store exact** → **store fuzzy** (`house.002` satisfies `House`) → HubKit Kenney → primitive. A Kenney exact name no longer beats a store fuzzy match. A missing pack never blanks a town.

**Wired spawn paths** (owned stem first, Kenney last):

| Surface | Uses |
|---|---|
| Realm towns (`CityTown` / `KeepRing` / `EdgeFlora` / `StreetDress`) | `DressVocab.Kit` / House / Tree / Wall / Tower / Cart / Crate |
| Hub arena + eight embassies | `Wall` / `Column` / `Tower` / `House` / `Weapon`. Frontier embassy stays road-only. Court stays unpaved. |
| Realm training dummy | `HumanDummy_M White` then Kenney skeleton |
| Guest / faction weapons | `Sword01` / `TH_Sword03` / `Shield03` / `Axe01`. Spear / staff / wand / dagger / mace stay Kenney. |
| Sky when HDR is missing | BOXOPHOBIC Day/Night/Blend or `Skybox_Daytime` / `Skybox_Sunset` |
| Rain / fireflies | RainMaker `RainPrefab` or `vfx_Rain_01` / `FireFlies` |
| Grove extras | `lb_sparrow` on Tunya / Fantasy only — not the live fauna path |

**My Assets ≠ this project.** Package Manager's My Assets page is the account catalog. This project now has imported pack folders (Mega Fantasy Props, Barking_Dog modular kit, Fantasy Forest, BOXOPHOBIC skybox, Kevin Iglesias dummy + motions, ExplosiveLLC mecanim, UnityTechnologies particles, GabrielAguiar VFX, living birds, EasyRoads3D, SUIMONO, MYFG weapons, Starter Assets reference, Convai SDK, and the rest of the owned set that fit on disk). Concordia → Asset Store → Dump visual audit writes `/tmp/concordia-visual.txt` with `indexed=` / `store=` / each imported folder. Listed-but-truncated downloads (Demo City, Big Oak, Sound FX) stay pending until a complete `.unitypackage` lands.

Do **not** commit pack binaries. `Assets/Store/.gitignore` and the pack folders stay local.

Interior LOD (Tunya hitch budget):

- city index 0 — four playable `BuildingInterior.Open` rooms
- cities 1–3 — `FakeWindows` glow quads, no playable mesh
- cities 4+ — exterior only

Dump: `/tmp/concordia-visual.txt` on `CityTown.BuildAll` and **Concordia → Asset Store → Dump visual audit**.

Hub Court stays unpaved. Plaques still refuse invented names. Starter Assets / Kinematic / 3rd Person are reference only — they do not replace Concordia's controller. SUIMONO is imported, not the live water path. Convai is the talk presentation layer; Concord 2B (`qwen3.5:2b` via `dialogue:request`) is the conversation provider.

## Owned stack (this account — imported here)

| Role | Pack | Store id | In this project |
|---|---|---|---|
| Fantasy houses / towers / props | Mega Fantasy Props Pack | 87811 | PRESENT |
| Modular rooms / walls | 3D Free Modular Kit | 85732 | PRESENT (`Barking_Dog`) |
| Forest trees / grass | Fantasy Forest Environment Free Demo | 35361 | PRESENT |
| Skybox + lowpoly fir | FREE Skybox Extended Shader | 107400 | PRESENT (`BOXOPHOBIC`) |
| Human dummy + locomotion | Human Character Dummy + Human Basic Motions FREE | 178395 / 154271 | PRESENT (`Kevin Iglesias`) |
| RPG mecanim clips | RPG Character Mecanim Animation Pack FREE | 65284 | PRESENT (`ExplosiveLLC`) |
| Particle fx | Particle Pack \| Starter Assets | 127325 | PRESENT (`UnityTechnologies`) |
| Combat VFX | Free Quick Effects Vol. 1 | 304424 | PRESENT (`GabrielAguiarProductions`) |
| Birds | Living Birds | 15649 | PRESENT |
| Roads | EasyRoads3D Free v3 | 987 | PRESENT |
| Water (imported, not live path) | SUIMONO Water System | 4387 | PRESENT |
| Weapons | MYFG - Weapon Pack Lite | 14360 | PRESENT |
| Controller reference | Starter Assets: Character Controllers \| URP | 267961 | PRESENT — do not replace Concordia |
| Big oak | Big Oak Tree FREE | 279431 | pending (truncated download) |
| Demo city (do not vendor) | Demo City By Versatile Studio | 269772 | pending (truncated download) |
| Sound fx | Free Sound Effects Pack Starter | 155776 | pending (truncated download) |

Not on this account (do not claim): Slavic Medieval Village 167010, Distant Lands, Robot Kyle, Point Grass, MapMagic, Fake Interiors, Sci-Fi Lab.

Editor: **Concordia → Asset Store → Open My Assets**. Downloads require a signed-in Package Manager. Import into this `unity-client` project. The dump is the authority for PRESENT vs pending.

## TARGET

`KINGDOM + BIOME + CULTURE` (from authored WorldId / staple / ecology) dresses roads, stone, farms, vegetation, markets, walls, clutter, occupations. A toxic/industrial world uses the grid vocabulary, not the grove kit. Concordia never becomes visually dependent on a single store pack.

## Gap

Combat clip graph is still incomplete until Human Basic Motions is **wired** (imported ≠ wired). No owned wheat / palm / hedge / dumpster / crypt / gravestone / crystal / sci-fi lab — those stay Kenney. Point Grass is not owned. Truncated cache files (Demo City, Big Oak, Sound FX) need a re-download when disk has room. Remaining owned-but-not-yet-cached packs (Tree Collection, Ultimate Nature, Outdoor Ground, Stylized PBR, URP Terrain sample, Meta XR, AnyRPG, …) stay in My Assets until the next import pass. SUIMONO stays imported, not the live water path. Starter Assets stay reference-only. Convai's conversation provider is Concord 2B.
