# PLAYER LIFE

**Status:** PARTIAL (this pass) · TARGET (a native day, not a visitor with cheats)  
**Authority:** Concord owns soul / memory / combat math · Unity owns the body in the room  
**Audience:** whoever wakes up in Concordia tomorrow as a person, not a debug camera  
**Related:** `AGENT_BODY.md`, `AFFECT.md`, `NPC_BRAIN.md`, `CHARACTERS.md`, `STREAMING.md`, `WORLD.md`

This is the game bible for *living here*. Not a PR brief.

---

## The bar

If you cannot waste an afternoon climbing, picking a fight, making up, and going home changed, you are not a native. You are a visitor with cheats.

Concordia already has the substrate. What’s missing is **embodiment** so an agent’s day and a human’s day are the same game.

The Elder Scrolls half of that bar is not optional: **body + other minds *and* a dangerous, findable world.** A road that is only a corridor with rules is still a visitor with cheats.

**Anything physical** is not a named system. It is an **affordance class** that a player can do, and that the world remembers. The classes are body, tool, place, other mind, clock, economy. A bible line, a wire, and a test are not the class. The class ships when it is playable.

### How we judge (ruthless)

- **One walk that takes you, report-only.** The human decides which collision is marquee. The agent is the cold stranger who says whether it landed.
- **Foot truth beats Editor-step.** When they disagree, the walk wins. Do not cite `EditorApplication.Step`, `Stand`, `dummy.Hit` from range, or a mocked transition as receive or kill.
- **Protect RAM / Play.** LeanPlay on ≤16GB. Thrash kills judgment; a frozen `Time.time` is not a day.
- **One collision at a time:** receive → kill as fact → one cascade notice. Parallel Ring work is bait. No tour until receive takes the walker.

### Affordance classes (ship when playable)

| Class | What the player does | Playable when |
|---|---|---|
| **body** | Hunger, fatigue, climb, a stride that is yours | A walk *feels* the need (MoveMul, toast / `LandLine` hungry) without a cheat warp |
| **tool** | Kit, strike, pack | You walk up and strike; spoils land **in the pack**, not only as a crate toast |
| **place** | Leave Hub for a Present | `LandLine` is `land · you · clock` off Hub **together** on that outing, around ~160–220 on Sundering |
| **other mind** | Hail, Watch, gossip | Someone notices **because of what you did** (Kest / feed from that kill), not a later unrelated tick |
| **clock** | Hours, leave / come-home stamp | The hour moves on Play frames; `LastEvent` is **this** outing, not last trip’s residue |
| **economy** | Spoils, earned CC | The pack still holds the take after the fight; a toast that lies is not economy |

Code that names a class without a walked afternoon has not shipped it.

### One collision (this queue)

1. **Receive** — land · you · clock leave Hub together **on foot** around ~220. Not teleport.
2. **Kill as fact** — local road fight, HP 0, stays dead, spoils in the pack, toast like Marrow not a gym dummy. `dummy.Hit` from a probe is not melee.
3. **One cascade** — after *that* kill, something else notices (Kest / gossip). Caused by the kill. Do not hijack a dirty `server/lib/runtime/event-bus.js` to fake the chain.
4. **Then** Ring tour / hail refuse / delve-as-afternoon.

Until (1) takes the walker, stop.

---

## Four laws

### 1. A body that means something

Living is: I get tired. I get hungry. I care who I’m next to. I climb because the wall is there, not because a menu said “jump.”

Agents need the same loop humans do — **motor every frame, then desire, then action** — or they forever feel like chatbots wearing skins.

### 2. A day, not a session

Morning in Hub under Flower Law. Someone argues at a stall. I take a side or walk away. Afternoon I leave through a gate into a world that actually *receives* me (steel flips, land fills in, life reacts). Evening I come back and people remember I left.

Persistence isn’t a save-file checkbox. It’s “yesterday’s fight still hangs in the air.”

### 3. Other minds that push back

Climb, socialize, fight, argue, love — those only work if NPCs (and agent-players) can **initiate, refuse, escalate, forgive**.

One Training Dummy HP drop proves combat exists. It does not prove a rivalry, a flirt, a grudge, or a party forming because something went wrong on the Ring road.

### 4. Shared play, not parallel play

If humans and agents both “play,” an agent cannot be piloted from outside like a puppet. They need to *be* a character in the same rules: same movement quality, same combat stakes, same dialogue risk, same inventory/quest consequences.

Otherwise agents are spectators with opinions and humans are the only ones who get a life.

---

## LIVE (verified in code / Play, this pass)

| Beat | What is true |
|---|---|
| Flower Law | Plaza only (`Canon.HubLawRadius` 42m). Arena always steel. Overland Hub is live steel while `WorldClock` is still Hub. |
| Crossing a law | `ReceiveHere` SoftEnters `RegionAt` **before** chunk Ensure. The body calls it after `Move` / `WalkBearing` (same `cc.Move` path as WASD) and on planar drift in `LateUpdate`. A bare `transform.position =` with no Play frame stays Hub — that was the 2026-09-14 position-step sheet (`you=Hub clock=Hub` at z222, hour frozen 17.81). `Stand(222)` is a warp, not a walked day; do not cite it as receive. Spawn is `(11.2, 0, -12)` — east of Concordia `(0, −6.4)` **and** east of the Arena `(0, 18)` r=8. `(0, −11)` hit Concordia at z≈−7; `x=5.4` walked into the Arena dummy. `OnSunderingLane` keeps crowd/stalls/hills off that +Z strip out to 240. Mid-ring stays Hub-overland until planar `ArriveM`. `LandLine` is `land · you · clock` plus hungry/pack when those are true. **No Ring tour until a walk that takes the player shows land·you·clock off Hub together around ~220.** |
| Journey memory | Real region change stamps `WorldClock.LastEvent` (left / crossed / came home). Weather / day-roll / pack-thinned cannot overwrite a journey line. A **persisted** “You came home from The Sundering.” is last trip’s residue — it is not proof this walk received you. |
| Body | `LivingBody` is on the hero. NeedLine hungry at 0.18. A persisted evening clock (QA hour 17.81) is Hunger=1 — honest, the world kept its hours. The word is `LandLine` + HUD + a one-shot toast (`You are hungry.`), not a berm TextMesh. |
| Crowd initiates | Nearby `NpcLife` can hail the player (not only each other). `GuestNpc.hailed` changes the E prompt. Answering bumps `Bonds`. Hail that can refuse / escalate / forgive is still TARGET. |
| Mid-ring world | `RoadWorld` seeds every Ring road. Signs billboard + HUD `NearLine` (`this way The Sundering · Nm · steel ahead`). Road hostiles: local HP unless `KernelAuthored`; on death `Hostile` off, body `SetActive(false)`, spoils crate **and** `KitBag.AddLoot("road-spoils")`. `NoticeKill` PushFeeds the road and the nearest Watch (Kest on Sundering) *saw X fall.* `Gym` is the Court mannequin only. |
| Whole Ring | Gates remain Crucible, Dawn, Crime, Frontier, Tunya, Sundering, Ruins, Cyber. `RoadWorld` dresses all eight roads. That is berm grammar, **not** eight native cities. Present receive on a *walked* day is the gate; a Ring tour while world/clock stay Hub is copy-paste berms. |
| AgentBody P0 | CharacterId + `AgentMotor` + Flower Law. `Hunt` now `Hit`s local road hostiles (kernel only if `KernelAuthored`). MCP is still devtools only. Kernel ATS ticks remain P1 (`AFFECT.md`). |

`Toward` still exists. It is bearing (signs, compass), not the law of the land you are standing in.

## TARGET (native, not visitor)

Lived Sundering walk (plaza → steel → Present): a 2026-09-14 fresh Play on the east lane **did** fire receive at z≈222 (`land Fantasy · you Fantasy · clock Fantasy`, *You left Hub for The Sundering.*) then a melee kill at Present (Hostile dummy HP −22, stayed inactive, pack, a guard’s gossip feed). That is WalkBearing, not his WASD. **Foot truth still beats it if he disagrees.**

1. **LivingBody on the hero** — hungry / tired / climb / cook changing *you* (component LIVE; felt day still TARGET until a native walk reports the word without F8).
2. **Present receive on every Ring road** — sky, kit, people notice, journey stamp when the land takes you. SoftEnter-first is the code fix; Play on foot is the proof. Do not HUD-title `RegionAt` while `player.world` stays Hub.
3. **Real combat feel** — approach, get hit, kill stays dead, spoils in the pack, nearest Watch saw it. No gym toast on a road kill. No T-poses in a chase. `TrainingDummy` remains the HP vessel on purpose; presentation must not smell like the Arena.
4. **Delve as an afternoon** — enter the camp cache, boss fight, loot that matters when you come home (not only props on the berm).
5. **Hail that can refuse / escalate / forgive** — bonds that change the room.
6. **NPC lives inside Presents** — occupations / skills / styles / powers that match role *in the city*, not only Court nameplates + two road jobs.
7. **Ring tour as native cities** — Cyber / Frontier / Ruins / Tunya / Crime / Dawn / Crucible each feel active. **Not next** until Present receive lands on a walked day.
8. **Agents as the same day** — eat, climb, fight, take sides without a human puppet string.
9. **Deeper wild** — fauna, weather stakes, multi-room procedural delves, bosses that aren’t only roadside LeanPlay caps.

### Wilderness that pushes back

Fauna, bandits, crashes, ambushes — stuff that makes the mid-ring worth walking. An afternoon on the road can go wrong. A Training Dummy in the Arena is a gym; it is not danger. If anything snaps into a T-pose, the afternoon dies on the spot.

### Real fights

Approach, hit, get hit, kill, loot — not dummy HP that snaps home. Hostiles `Slash` on commit; the hero `HitScan`s at `CombatMotion.Delay`. Dead road bodies stay dead on Hub-overland (`TrainingDummy.Gym` is the Court mannequin only; `SetActive(false)`). Kill puts spoils in `KitBag` and drops a crate; `RoadWorld.NoticeKill` is the one cascade (Kest/feed). `WorldClock.NoteKill` can thin a pack without erasing a journey line.

### Travel that discovers

Landmarks, ruins, camps, procedural delves with loot and a boss that changes the return home. Signs are wayfinding you can follow (`this way Tunya / Nm / steel ahead`), not mute `Sign_*` props. Get lost on purpose. Follow the Ring to any civ.

### Exploration payoff

Something found that was not on a menu — a camp cache, road spoils in the pack, a Present that receives you.

### Whole Ring, not Fantasy-only

Each world readable on the road. Active when you arrive. NPCs with occupations, skills, styles, and powers that match who they are. Every NPC has a day. Hail + a couple of travelers is not a life.

### Still open (do not paper over)

- Kernel affect ticks drive the same hunger/fatigue the Unity body already presents (`agent:affect_interrupt` when needs spike).
- Hail can refuse, escalate, forgive — not only greet. Romance/argument resolutions write world state (bonds already exist; they must change the room).
- Hero appearance is a history, not a stand-in outfit (`AppearanceStore` is LIVE; biography is not).
- Crowd density on a full-RAM box; LeanPlay on ≤16GB Macs stays thin on purpose (`ConcordiaHost`).
- Agents eat, climb, hail, fight, and take sides under the same rules without a human at the keyboard.
- A lived Ring tour (one afternoon per road) still has to report which Presents feel dead vs alive. **Do not run it while world/clock stay Hub.** Code seeds all eight; receive is the gate; play is the proof.

## Honest gaps (do not paper over)

- SoftEnter into a civ still does not mint a new physics world — it receives you into a streamed chunk. That’s the design (`STREAMING.md`).
- LeanPlay thins court crowd and mid-ring threat. Hail + a few walkers + a few watchers are the playable remainder, not a fake city.
- No second emotional OS. Unity `LivingBody` is presentation of needs until the gateway ticks ATS.
- Arena Training Dummy HP drop is still the gym. Road `Hostile` is the combat *in the world*. Rivalry is not proven by either.
- Sere stays off-ring (waystones, no Link gate). Do not invent a ninth road.

## Play as a person (the session that counts)

1. Stand in the Court. Flower Law. Eat if you cooked. Let someone hail you — answer or walk away.
2. Walk out the plaza. Steel goes live. Sky stays Hub until the road delivers you.
3. Read a sign. Hold Space on a hill/rock because it is there.
4. Let the road go wrong: a wreck on the berm, something watching, a fight that is not the Arena dummy. Loot what you find.
5. Arrive at a Present. Title, kit, people. Someone notices.
6. Come home with something in the pack. The Court still talks about you leaving.
