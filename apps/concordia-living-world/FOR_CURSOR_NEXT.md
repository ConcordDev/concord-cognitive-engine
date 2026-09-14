# FOR CURSOR — next pass

**Stress the game, not GitHub.** Local Mac repo is the safety net.

Read `bible/PLAYER_LIFE.md` first. AgentBody P0 already exists. Do not re-implement character:create.

## The bar

If you cannot waste an afternoon climbing, picking a fight, making up, and going home changed, you are not a native.

## This pass shipped (partial)

- `RegionAt` SoftEnter — mid-ring stays Hub-overland; civ receives you at Present
- `LivingBody` hunger/fatigue/climb for hero + AgentMotor (separate meters)
- Crowd hail + Ring-road travelers (`ConcordiaHost.RoadWalkers`)

## Still TARGET

- Kernel ATS ticks → same body (`AFFECT.md` P1 / `agent:affect_interrupt`)
- Hail that can refuse / escalate / forgive
- Hero as history, not a stand-in outfit
- Full-RAM crowd; LeanPlay on ≤16GB Macs stays thin on purpose

## Mac 16GB Play

1. **Concordia → Shed RAM then Play Hub**, or `scripts/shed-ram-for-unity-qa.sh` then Play Hub Now.
2. `ConcordiaHost.LeanPlay` thins crowd/impostors/AgentBody auto-spawn.
3. Play as a person: plaza Flower Law → steel on the road → arrive and be received → hail or climb → cook/eat. Not a debug camera.

Do not drive play via Coplay MCP. Do not invent HP. Do not `Thread.Sleep` on `/unity-ws` from execute_code.
