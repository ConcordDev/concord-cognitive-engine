# Concordia Art Direction — Unity Web (photoreal), 2026-09-11

## Canonicity (owner decision, this date)

- **Unity is now the canonical World Lens web client.** It ships to the browser via
  `scripts/export-unity-web.mjs` (Unity 6, batchmode `Concordia.Editor.ConcordiaWebExport.Export`,
  output to `concord-frontend/public/unity-client/`, same serving shape as the Godot
  export) and talks to the server over `mountUnityGateway` (`server/lib/unity-bridge.js`,
  mounted in `server.js`) — both pieces are real and already built, not new
  infrastructure. `Assets/Plugins/WebGL/ConcordWs.jslib` and the Editor/WebGL split in
  `ConcordClient.cs`/`FreePacks.cs`/`HubKit.cs` show the project was already written with
  WebGL as a first-class target, not an afterthought.
- **Three.js's World Lens implementation (`concord-frontend/lib/world-lens/`,
  `components/world/`, `components/world-lens/`) is retired as canonical.** Its
  `ART_STYLE_GUIDE.md` stylized-BotW/Palworld mandate governed *only* that renderer
  (confirmed by grep — zero references outside those directories) and is retired with
  it; see the retirement note at the top of that file.
- **Godot (`world-lens-godot/`) becomes the presenter role** — its existing read-only
  spectator viewer (PR #875) is the lighter-weight, non-interactive way to view
  Concordia, alongside the full Unity client.
- **Nothing about the game's systems changes.** Quests, combat resolution, NPC AI, the
  economy, crafting — all of it lives server-side (`server/emergent/`, `server/domains/`,
  `server/lib/npc-*.js`, etc.) and is client-agnostic by construction. Retiring Three.js
  retires a *renderer*, not a system. This is the "systems are good, the web version with
  three.js ruined so much" read the owner gave, and it checks out structurally: nothing
  in the backend depends on which client is drawing the pixels.
- **Target shape:** Concordia reachable at the World Lens inside concord-os.org, same as
  every other lens, rendered by the Unity WebGL build, with Godot's spectator view as a
  secondary/lightweight path.

## The direction: photorealistic

This reverses `ART_DIRECTION_AUDIT.md`'s deliberate "photorealism is explicitly rejected"
call — that call was scoped to the Three.js/stylized-BotW/Palworld renderer, made for
reasons (avoid AAA-comparison traps, keep a small team's production fast) that applied to
*that* renderer. It does not bind Unity, and the owner has now made the opposite call for
Unity explicitly. Two things worth carrying forward from the old audit rather than
discarding outright:
- The "avoid AAA-comparison trap" risk is real for photoreal specifically — a photoreal
  target invites direct comparison to $200M productions in a way a stylized target
  doesn't. Mitigate with **art direction, not raw fidelity**: a coherent lighting/color
  language, a curated (not maximal) asset palette, and hero-asset polish concentrated
  where the camera actually spends time (NPC faces/hands, weapons, hero outfits) rather
  than spread thin.
- Rocketbox (the existing photoreal crowd-sim character pack already in the project,
  used by `ModularPerson.cs`'s authored-body path) is architecturally correct for a
  photoreal **Hub** — that world has textual grounding as modern/neutral. Its
  "polo shirt hero" problem is **not** a tinting bug. Live check (2026-09-12):
  Rocketbox bakes skin AND clothing into one continuous texture with no separate
  cloth UV region, so a multiplied `DyeCloth`/`ClothDye` tint would also discolor
  visible skin — a real dead end. The actual mechanism was that
  `ModularPerson.CastingWorld` was set per-world by `WorldBuilder` but never read
  by `LoadPersonPrefab`, so every world got the same Rocketbox civilian. Job 1
  shipped as a body-choice branch: Hub keeps Rocketbox; every other world prefers
  the already-in-project KayKit Knight (`FreePacks.Mesh("Knight")`), with an
  honest Rocketbox fallback if Knight is missing. Cyber/Crime may want a modern
  body too — that's a later per-world tuning pass, not a reason to tint skin.

## Acquisition-list audit

The pasted acquisition list was checked claim-by-claim before acting on it, per this
session's standing verification discipline. Two categories of finding:

### Confirmed wrong (fix before using the list as a planning input)

| Claim | Reality | Source |
|---|---|---|
| "9 worlds" | **10 worlds** — `Canon.cs`'s `WorldId` enum: Hub, Ruins, Tunya, Fantasy, Crime, Cyber, Frontier, Superhero, Crucible, **Sere**. `Sere` isn't even in the retired Three.js style guide's own 9-row saturation table — a real, separate discrepancy between the Three.js theme file and the Unity canon worth reconciling later, independent of this acquisition list. | `Canon.cs`, `ART_STYLE_GUIDE.md` |
| "200+ Hub buildings" | The code's own comment (`FreePacks.cs:884`) targets **100 buildings** (70 exterior / 20 fake-window / 10 playable interior) **per city**, not per-Hub — and `DressVocab`'s own comment states the Hub specifically "never calls this (Court is unpaved)," i.e. the Hub has ~zero buildings through this system. The "200+" figure doesn't match either the per-city target or the Hub specifically. | `FreePacks.cs`, `DressVocab.cs` |

### Spot-checked and confirmed real (4 of the ~20+ named packages/families checked so far)

| Package | Verdict |
|---|---|
| "Human Basic Motions FREE" — Kevin Iglesias | **Real**, live on the Asset Store, 15,865+ favorites — matches the doc's description (idle/locomotion/social anims, masculine+feminine, Avatar Masks). |
| "FREE Starter Pack — Sidekick Modular Characters by Synty" | **Real**, live on the Asset Store (`...-336970`) and on the Synty store directly — 50+ sci-fi/fantasy parts + 90+ modular human-base parts, matches the doc. |
| KHS Korean-heritage architecture packs | **Real family exists** — multiple live "KHS - Gyeongbokgung Palace" packs (Geunjeongjeon Hall, Sajeongjeon Hall, Gyeonghoeru, Mangyeongjeon) from Korea Heritage Service. Couldn't independently confirm the specific "Daejojeon"/"Changdeokgung" titles the doc named — those may be mislabeled Gyeongbokgung-family packages rather than fabricated; re-verify the exact title before buying if that specific building matters. |
| "Free Slavic Medieval Environment — Town Interior and Exterior" | **Real**, live on the Asset Store (EmacEArt), 220+ low-poly assets + a demo scene, matches the doc closely (title has drifted slightly across store listings — "Town Kit," "Village Free" — same publisher/family). |

**Not yet spot-checked** (the remaining ~16+ named packages across the doc's ~20 categories — terrain/nature, weapons, VFX, UI/icon packs, additional character packs, etc.): treat those as **unverified, not confirmed** until checked the same way. Given the 4/4 hit rate so far and 2 clean numeric errors caught, the doc reads as a genuine research pass with real citations, not fabrication — but "mostly real" isn't "fully verified," and a specific title/price/availability should be re-confirmed at time of purchase regardless, since Asset Store listings do get renamed, delisted, or repriced.

## Recommended next steps

1. **Weather-visuals binding SHIPPED** — `WorldClock.ApplyWeatherVisuals` now places rain/ash (snow VFX) and thickens fog from the live `Weather` string on Enter and on each kernel cycle. Build-time `PlaceWeather("rain"|"snow")` in DressSky/Accents was the leak: Crime rained forever and a "weather shifted" HUD line changed nothing on screen. Hub/Tunya/Fantasy fireflies stay as identity ambience, not weather. Remaining: visual confirm in Play mode (Hub is clear, so force `WorldClock.Weather = "rain"` or travel to Crime).
2. **Job 1 shipped** — `LoadPersonPrefab` now reads `CastingWorld` (Knight off-Hub, Rocketbox on Hub). Remaining: visually verify the Knight path in a non-Hub world (Hub Play-mode check already confirmed Rocketbox still renders there).
3. **Oversized-sword shipped** — `MakeSword` prefers `Sword16` (MYFG Weapon Pack Lite) over the chibi Kenney `weapon-sword` fallback. Live-verified: `sharedMesh` = Sword16, scale ~0.97. Floating NPCs were a spawn-frame false alarm — do not "fix" `Grounding.cs`.
4. **Reconcile the 9-vs-10 world list** between `Canon.cs` (`Sere` is the 10th) and the retired Three.js theme file, so no future doc repeats the stale "9 worlds" figure.
5. Before buying anything from the list, re-verify title/price/live-status directly on the Asset Store at purchase time (listings drift) — don't batch-buy off the pasted doc as-is.
