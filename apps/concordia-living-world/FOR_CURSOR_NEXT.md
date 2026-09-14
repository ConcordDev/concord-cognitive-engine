# FOR CURSOR — next pass

**Stress the game, not GitHub.** Local Mac repo is the safety net.

Read `bible/PLAYER_LIFE.md` first. AgentBody P0 already exists. Do not re-implement character:create.

## The bar

If you cannot waste an afternoon climbing, picking a fight, making up, and going home changed, you are not a native.

The Elder Scrolls half: body + other minds *and* a dangerous, findable world.

## This pass shipped (partial)

- `RegionAt` SoftEnter — mid-ring stays Hub-overland; civ receives you at Present (`LateUpdate`, not only ConcordiaGame)
- `LivingBody` MonoBehaviour on the hero — HUD hungry/tired, climb, cook; AgentMotor has its own meters
- Crowd hail + Ring-road travelers with jobs (`RoadWorld.RoleFor`, Sundering first)
- Combat feel: `CombatMotion` Pulse/Delay, walk≠run gait, dummy Hurt, delayed HitScan
- Mid-ring world: wrecks, watchers/bandits, roadside delves with loot + boss, signs as wayfinding (`RoadWorld`). Gym dummy does not revive road HP. Hostile `SetGait` so a fight does not T-pose.

## Still TARGET

- Kernel ATS ticks → same body (`AFFECT.md` P1 / `agent:affect_interrupt`)
- Hail that can refuse / escalate / forgive
- Hero as history, not a stand-in outfit
- Full-RAM crowd; LeanPlay on ≤16GB Macs stays thin on purpose
- Lived Ring tour (Cyber / Frontier / Ruins / Tunya / Crime / Dawn / Crucible) reporting which Presents feel dead vs alive — play proof, not a second seed pass
- Occupations/skills/styles readable off a native in each city, not only the road

## Mac 16GB Play

1. **Concordia → Shed RAM then Play Hub**, or `scripts/shed-ram-for-unity-qa.sh` then Play Hub Now.
2. `ConcordiaHost.LeanPlay` thins crowd/impostors/AgentBody auto-spawn. Mid-ring stays thin: `RoadWalkers` 2, `RoadThreats` 4, `RoadDelves` 2.
3. Play as a person: plaza Flower Law → steel on the road → wreck/fight/loot → arrive and be received → come home with something in the pack. Not a debug camera.

Do not drive play via Coplay MCP. Do not invent HP. Do not `Thread.Sleep` on `/unity-ws` from execute_code.
