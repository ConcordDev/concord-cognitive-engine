# Kay — wake note (26 Aug 2026, ~8:50pm ET)

Dutch went to sleep. **Play was NOT captured.** Do not treat this as done.

## Play this first
1. Focus the already-open Unity 6.0.5.9f1 (`pid 13172`) on `/Users/dutch/Setup Guide In-Editor Tutorial`.
2. Wait for script compile (new plaza/creator scripts are on disk; the editor was App-Napped and never imported them).
3. Scene should be `Assets/Scenes/ConcordiaHub.unity` (already loaded at 8:42pm). Menu **Concordia → Play Hub Now** if it does not auto-play after compile.
4. Shots: runtime writes `/tmp/concordia-play.png` plus `-plaza` / `-frontier` / `-cyber`. Copy those next to this file.

Worker could not: AppleScript activate, screencapture, or a second editor. VS/Unity UDP Play (port 56174) is dead because `com.unity.ide.visualstudio` is not in the project. Game view logged `CAMetalLayer width=0` — the window was not presenting.

## What should happen on Play (code, unverified in-editor)
1. **First boot:** full-screen creator before walk. Body/face/hair/skin/eyes/outfit/walk/attitude. Live preview on a **modular person**, not Mixamo Soldier. ENTER THE COURT saves.
2. **Returning:** skip creator, load save.
3. **Hub:** runtime bronze plaza + dome + oculus god rays. Named arches: **FRONTIER** blue west (left from spawn looking at the monument), **CYBER** green east (right). All eight gates kept.
4. Idle+walk in all builds (procedural). Soldier.glb is not spawned as the hero.
5. Crowd: mixed modular citizens (wander/stall/sit) + named guests.
6. HUD: compass + DTU + bars. Gate name only when you look at it.

## Save path
`Application.persistentDataPath/concordia_appearance.json`  
PlayerPrefs `concordia.appearance.v1`

## Honest gaps vs the bronze-dome painting and SR2 floor
**Not Played, so these are code-level, not screenshot-level:**
- People are **primitive modular mannequins** (capsules/spheres). That will not beat SR2’s “you look like a person the first second.” Need an authored humanoid (CC0/UMA/metahuman) with clothes — not Soldier.
- Plaza is **runtime primitives + a few Kenney props**. Painting wants ornate multi-level bronze city, carved dome, crowds filling the floor. Ours will read large and bronze-colored, but still constructed. Density is ~20 NPCs, not a city-state.
- God rays are additive quads, not volumes. Portal swirls are particles on a cylinder, not cathedral glass.
- No walk-cycle polish, no voice audio, no civilian variety beyond tint/hair/outfit presets.
- If Play looks graybox or Kenney-toy: keep building. Do not ship.

## Scripts touched
New: `AppearanceStore`, `ModularPerson`, `CharacterCreator`, `HubPlaza`, `NpcLife`, `ConcordiaShot`  
Changed: `HubLook`, `WorldBuilder`, `ConcordiaGame`, `ConcordiaPlayer`, `ConcordiaHUD`, `MixamoAvatar` (Resources + procedural fallback), `CharacterGear`, `NpcWander`, `Canon`, `ConcordiaMenu`, `ConcordiaBoot`, `ChaseCamera`, `Footsteps`  
Mirrored under `concord-cognitive-engine/apps/concordia-living-world/unity-client` when the filename existed (new files copied too).
