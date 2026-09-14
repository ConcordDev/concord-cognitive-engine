# FOR CURSOR — next pass

**Stress the game, not GitHub.** Local Mac repo is the safety net.

Read `bible/PLAYER_LIFE.md` first. AgentBody P0 already exists. Do not re-implement character:create.

## The bar

If you cannot waste an afternoon climbing, picking a fight, making up, and going home changed, you are not a native.

The Elder Scrolls half: body + other minds *and* a dangerous, findable world.

**Anything physical** is affordance classes (body, tool, place, other mind, clock, economy). Ship a class when it is *playable*, not when it is named in a bible. A named / wired / tested system is not an affordance. A player doing the thing and the world remembering it is.

## How we judge

- One walk that takes the player, **report-only**. The human picks the marquee collision. The agent is the cold stranger who says whether it landed.
- When Editor-step PASS and foot truth disagree, **foot wins**. Do not cite Step / `Stand` / ranged `dummy.Hit` as receive or kill.
- Protect RAM / Play (LeanPlay on ≤16GB). Thrash kills judgment.
- **One collision at a time:** receive → kill as fact → cascade notice. Parallel Ring work is bait.
- No tour until receive takes the walker. He walks; you report.

## Do not Ring-tour next

A 2026-09-14 +Z **position-step** to 222 kept `you=Hub` · `clock=Hub` and froze hour at 17.81 — execute_code never Ticked. A one-shot `CharacterController.Move` stuck at z≈−7 because Concordia stands on the origin +Z axis. `x=5.4` then walked into the Arena. `Stand(222)` is a warp. Do not cite it as receive.

**Present receive is the gate.** No Ring tour until a walk that takes him shows `LandLine` land·you·clock off Hub around ~220.

## This pass (code)

- Spawn `(11.2, 0, -12)` + `OnSunderingLane` so +Z misses Concordia **and** the Arena
- `WalkBearing` drives the same `cc.Move` path as WASD (world +Z = Sundering) — probe only, not his walk
- `LandLine` includes hungry / pack when those are true
- Road death: Hostile off, `SetActive(false)`, `KitBag.AddLoot("road-spoils")`, crate at feet
- `RoadWorld.NoticeKill` — nearest Watch (Kest) saw them fall; feed `road` + `gossip`
- LeanPlay: one far-lod per Tick, skip shot-grab hitch, `runInBackground` so Play actually ticks

## Cold-stranger report (not his walk)

Editor Play frames *did* SoftEnter at z≈159 (`land Fantasy · you Fantasy · clock Fantasy`, leave stamp). That outing had scars (pause, Arena then hill, ground-disable fall, WalkBearing overshoot that came home and overwrote the leave). Kill was `dummy.Hit` from ~123m — binding ran; melee did not.

Do not substitute that PASS for the next foot walk.

## Still TARGET until a walked session reports it

- Present receive **on foot** at ~160–220 (code is ready; his walk is the proof)
- Get hit on the road, then the kill/pack/Kest chain in **one** outing
- Delve as an afternoon
- Hail that can refuse / escalate / forgive
- NPC lives *inside* Presents
- Ring tour as native cities — after receive lands
- Agents without a puppet string
- Deeper wild
- Kernel ATS ticks → same body

Do not hijack dirty `server/lib/runtime/event-bus.js` to paper the cascade.

## Mac 16GB Play (when he asks for a probe)

1. Shed RAM then Play Hub Now. LeanPlay stays on.
2. Plaza: `LandLine` should be Hub. WASD +Z is the native walk. `WalkBearing(Vector3.forward, …)` is a probe on the same `cc.Move` path — stop before you overshoot Present and come home.
3. Around z≈160–220 expect `land Fantasy · you Fantasy · clock Fantasy` and *You left Hub for The Sundering.* that belongs to **this** outing.
4. Only then: walk up to Marrow, strike, toast `Marrow down`, pack has road spoils, Kest/feed saw it.

Do not drive play via Coplay MCP. Do not invent HP. Do not `Thread.Sleep` on `/unity-ws` from execute_code. Do not disable `ContinentGround`.
