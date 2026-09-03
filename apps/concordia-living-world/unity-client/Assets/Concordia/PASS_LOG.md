# Concordia Unity pass log — 2026-08-28

## This pass (animations / smoothness / density / roads / kingdoms)

- Primitive gait: smoothed speed, complementary knees, foot roll, spine counter-twist, landing squat, hit wince. Sit eases. Sword carry unchanged.
- Player: coyote jump 0.14s, softer accel, skinWidth 0.08, landing callback, hit flinch.
- Camera: slower follow, LookRotation slerp, gentler collision (1.7m min).
- NPCs/hostiles: accelerate instead of snapping velocity.
- Interact prompts: cached 4 Hz instead of FindObjects every frame.
- Realms: denser Kenney rings; roads from arrival to every faction camp and kingdom; Tunya 12 authored countries as walled keeps (Dinye, Aekon, Asbir, Nil, Sangree, Vessine Crash Island, …); other worlds get faction keeps. Hub: longer gate roads + ring road at r=20.
- Flower-law still Hub-only. Live steel in other worlds unchanged.

## Honest remainder

- Creature meshes remain Kenney stand-ins with authored names.
- Quest boards are readable authored text, not the server quest engine.
- Kingdoms use authored names/descriptions; capitals in JSON are (0,0) so placement is a ring, not those coords.

Stop Play, compile, Play, walk a gate.

## Store packs on disk (honest)

Imported into this Hub project (not a second mystery folder):
- Unity Get Started: `Assets/Prefabs` (PlayerRobot, Stairs, Wall_Light L/R, Collectible_Star, Moving_Platform), `Assets/Materials` repeating tiles, `Assets/Skyboxes`, `Assets/VFX`, `Assets/Audio`, TimmyRobot + StarterAssets Armature, Inter font.
- UPM: Cinemachine 3.1.6, glTFast, characters-animation / worldbuilding feature sets (tools, not meshes).
- Kenney CC0 kits under `Assets/Concordia/Models/kenney-free`.
- **No Synty / POLYGON / My Assets 3D pack is in this project's Assets.** If those live in another Unity project, Import them here.

Wired this pass: Cinemachine Orbital Follow chase + Hard Look At + Deoccluder; Get Started lights on every Hub gate; stairs / hollow crates / Timmy+PlayerRobot in Cyber+Crucible; quest stars; plaza floor uses store Moon + Runes tiles.

## GOTY presentation pass

- Per-world cinematic grade (ACES bloom/vignette/grain/temp/fog). Hub golden hour, Ruins ash, Tunya grove, Fantasy dusk, Crime night, Cyber magenta, Frontier heat, Dawn sunrise, Crucible teal.
- HUD: Inter, letterbox, thin bars, film arrival card on world enter.
- Kingdoms use Kenney castle towers + gates instead of cubes. Horizons: cliffs, palms, skylines from the real kits.
- Rim lights on the Unburned Court. Combat camera punch.
