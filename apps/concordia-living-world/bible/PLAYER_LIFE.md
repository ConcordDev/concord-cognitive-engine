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
| Crossing a law | `ContinentStream.LateUpdate` SoftEnters `MegaworldMap.RegionAt`, not `Toward`. Mid-ring stays Hub-overland (steel on, sky still Court) until you are inside `ArriveM` of a civilization Present. Then sky, kit, title, and nearby `NpcLife` actually receive you. ConcordiaGame still Ticks; it no longer skips the land because the creator overlay is open. |
| Journey memory | Real region change stamps `WorldClock.LastEvent` (left / crossed / came home). Weather / day-roll / pack-thinned cannot overwrite a journey line. Talk still appends “They heard: …”. Hub return toasts that line when someone is near. |
| Body | `LivingBody` MonoBehaviour on the hero (and a separate instance on `AgentMotor`). Hunger + fatigue from the same hour rate as `WorldClock` (`dt * 0.08`). Morning without food starts hungry (`SyncToClock`). Sprint costs fatigue. Climb (hold Space against a wall collider) costs fatigue + stamina. Speed falls when hungry/tired. Words on the HUD after the vitals panel (“hungry” / “tired”), not fabricated stats. `CookStation.Use` eats a real gathered meal into that body. |
| Crowd initiates | Nearby `NpcLife` can hail the player (not only each other). `GuestNpc.hailed` changes the E prompt. Answering bumps `Bonds`. |
| Mid-ring world | `RoadWorld` seeds every Ring road: berm signs that read as wayfinding (`this way The Sundering · Nm · steel ahead`), a wreck on the berm, a watcher or bandit that uses `Hostile` + real HP (gym dummy does **not** revive them), and LeanPlay-capped roadside delves with a chest and a boss. Travelers are named roles (Iron Warden, Scout, Grove merchant, …) on Sundering first, not generic “Traveler” on Cyber/Ruins only. LeanPlay stays thin (`RoadWalkers` 2, `RoadThreats` 4, `RoadDelves` 2). Not invented towns. |
| Whole Ring | Gates remain Crucible, Dawn, Crime, Frontier, Tunya, Sundering, Ruins, Cyber. `RoadWorld` dresses all eight roads. Present receive is LIVE. “Alive city with occupations inside each Present” is still TARGET for a Ring tour to verify — destinations exist; native-feeling streets are not claimed from a Fantasy-only walk. |
| AgentBody P0 | CharacterId + `AgentMotor` + Flower Law. MCP is still devtools only. Kernel ATS ticks remain P1 (`AFFECT.md`). |

`Toward` still exists. It is bearing (signs, compass), not the law of the land you are standing in.

## TARGET (native, not visitor)

### Wilderness that pushes back

Fauna, bandits, crashes, ambushes — stuff that makes the mid-ring worth walking. An afternoon on the road can go wrong. A Training Dummy in the Arena is a gym; it is not danger. If anything snaps into a T-pose, the afternoon dies on the spot.

### Real fights

Approach, hit, get hit, kill, loot — not dummy HP that snaps home. Hostiles `Slash` on commit; the hero `HitScan`s at `CombatMotion.Delay`. Dead road bodies stay dead on Hub-overland (`TrainingDummy.Gym` is the Court mannequin only). Kill drops spoils you can take; `WorldClock.NoteKill` can thin a pack without erasing a journey line.

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
- A lived Ring tour (one afternoon per road) still has to report which Presents feel dead vs alive. Code seeds all eight; play is the proof.

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
