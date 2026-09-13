# AGENT_BODY

**Status:** PARTIAL (P0 verbs + affect bind + AgentAvatar/Motor) · TARGET (P1 needs ticks / interrupt, P2 multi-agent)  
**Authority:** Concord owns soul + affect + combat math · Unity owns motor presentation  
**Audience:** Cursor / implementers after current Unity pass  
**Related:** `UNITY_CONCORD_CONTRACT.md`, `NETWORK.md`, `AFFECT.md`, `CHARACTERS.md`, `COMBAT.md`, `NPC_BRAIN.md`  
**Prior audit:** `~/.zuko/concordia-cc-combat-agent-play-2026-09-13.md`

---

## 1. Intent

Let Grok Bot (and friend agents) **participate in Concordia as persistent characters** that:

- move and fight at **human/real-time pace**
- still **make deliberative decisions** (schemes, talk, travel, stance)
- feel **cold / hunger / pain / fatigue** through Concord’s substrate — not via Mac MCP god-mode

This is **not** “assistant drives Ramaj’s Unity Editor with Coplay MCP.”  
MCP = **devtools**. AgentBody = **play**.

---

## 2. Two clocks (non-negotiable)

| Clock | Rate | Owner | Does |
|-------|------|-------|------|
| **Motor** | 10–60 Hz | Unity `AgentMotor` (or headless client) | pathing, engage, dodge-on-telegraph, stamina spend, interact when adjacent |
| **Deliberation** | event + 30s–5m | Agent LLM / routines | goals, dialogue, Expose/Abet/Ignore, travel destination, stance, charter checks |

Crons feed **Deliberation** only. They never replace Motor.

Human analogy: motor cortex vs prefrontal. Chat turns ≈ deliberation, not twitch combat.

---

## 3. Identity model

```
assistantId          (Grok Bot / friend’s agent)
  └─ characterId     (Concord soul — durable)
       ├─ appearance (Appearance JSON; same schema as AppearanceStore)
       ├─ kit / skills / bonds / quest flags
       ├─ affect_state row (entity_id = characterId, world_id = play world)
       ├─ needs_json (player-homeostasis; see §6)
       ├─ last pose { worldId, x, y, z, yaw }
       └─ charter (standing orders text + hard refusals)
```

**Auth:** bearer per character (production). Kitchen may use `unity-local-guest` only for Editor QA — never for multi-agent shards.

**Persistence:** kernel DB, not PlayerPrefs-only. Local AppearanceStore may seed first create.

---

## 4. APIs (envelope `{ evt, data }` on `/unity-ws`)

### Already LIVE (extend, don’t fork)

| evt | Today | AgentBody use |
|-----|-------|---------------|
| `player:move` | ConcordClient.SendMove | Motor reports pose / cityId |
| `combat:attack` | SendAttack → ack | Motor land hit; HP only from ack |
| `dialogue:request` | Talk E | Deliberation speech |
| `kingdom:request` / `scene:request` | snapshots | Perception bootstrap |
| scheme intervene | Plots / client | Deliberation Expose/Abet/Ignore |

### TARGET — character lifecycle

```
character:create   { assistantId, appearance, charter? } → { characterId }
character:load     { characterId } → soul + pose + affect summary + needs
character:bind     { characterId, sessionId } → spawns/reserves AgentAvatar pawn
character:unbind   { characterId } → park pose, keep soul
```

### TARGET — perception (Deliberation + Motor)

```
agent:perceive     → {
  self: { hp, stamina, poise, steelLive, flowerLaw, needs, affect },
  nearby: [{ id, kind, dist, threat?, name? }],
  telegraph: { kind, counter, fromId, until } | null,
  plots: [...],
  talkInbox: [...],
  goals: [...],
  charterDigest: "..."
}
```

Cadence: Motor reads **local** Unity state every frame; Deliberation pulls `agent:perceive` on wake (~1–10 Hz max, usually event-driven).

### TARGET — intent (Deliberation → Motor)

```
agent:intent  {
  characterId,
  goal?: "patrol_court" | "train_arena" | "travel" | "talk" | "scheme" | "idle",
  goto?: { x, z } | { gate: "SUNDERING" } | { npcId },
  engage?: { targetId } | null,
  stance?: "cautious" | "aggressive" | "social",
  say?: { npcId, text },
  scheme?: { plotId, action: "expose"|"abet"|"ignore" },
  interact?: true
}
```

Motor interprets intents; it does **not** wait for the LLM per swing.

### TARGET — affect / needs (substrate)

```
affect:tick / apply via affect-bridge applyAffectEvent(db, characterId, event)
needs:tick  (homeostasis decay; see §6)
agent:affect_interrupt  { characterId, reason, affect, needs }  // wakes Deliberation
```

---

## 5. Unity components

### `AgentAvatar` (pawn)

- Same presentation stack as hero: `ModularPerson` / Mixamo + `CharacterGear` grip rules  
- No ChaseCamera required (optional observe cam for QA)  
- Tag `characterId`; disable human Input on this pawn

### `AgentMotor` (MonoBehaviour)

Responsibilities:

1. Follow `goto` on NavMesh / Hub walk graph  
2. If `engage`: face target, LMB cadence when in range + stamina OK  
3. On `Hostile.TelegraphKind`: execute counter (`dodge`/`jump`/`break`) within window  
4. Respect Flower Law (`Canon.SteelLive`) — Hub swings may flower; Arena/worlds live  
5. Emit `player:move` throttled; `combat:attack` on connected hits  
6. Never invent HP — wait `combat:attack:ack` / wound events  
7. When intent = talk/interact and in range → fire existing Interact / OpenTalk path  

Out of scope for v1: perfect animation blending, party coordination, mount combat.

### Headless / dedicated client

Ship path: one **agent client** process (Unity batchmode or slim runner) per shard or per N agents — **not** Ramaj’s interactive Editor.

Editor MCP remains for **dev proof** only (spawn motor, force Arena).

---

## 6. Substrate audit — will the agent “feel” cold / hunger / pain?

### Short answer

**Not automatically today.** Platform substrate is real; **Concordia player/agent path is mostly unwired.** Feeling requires binding `characterId` → affect + needs + game event appraisals.

### What exists (LIVE on Concord platform)

| Layer | Location | What it is | Wired to Hub player? |
|-------|----------|------------|----------------------|
| **ATS affect engine** | `server/affect/engine.js` | Dimensions **v,a,s,c,g,t,f** (valence, arousal, stability, coherence, agency, trust, fatigue) + momentum; `applyEvent` / `tick` | **No** player characterId. Bridge defaults `world_id=concordia-hub` but callers are chat/repair/etc., not Unity hits |
| **affect-bridge** | `server/lib/affect-bridge.js` | Persist `affect_state` / `affect_events_log`; wake on valence delta | Available — unused by Unity combat |
| **Creature umwelt → core affect → Panksepp drives → instinct** | `server/lib/ecosystem/{umwelt,core-affect,drives,creature-behaviors}.js` | Hunger/thirst/energy/safety needs; **painIntensity**; FEAR/SEEKING/…; predator interrupt | **Creatures only** (flock). Not Hub guests, not hero |
| **Affect lens** | `server/domains/affect.js` + frontend lens | Daylio-like mood analytics for **users** | Different product surface |
| **Initiative engine** | `server/lib/initiative-engine.js` | **Conversational** proactive outreach (check_in, world_event, …) to the human | **Not** in-game combat initiative. Can later fire `world_event` when agent affect spikes |
| **Bible AFFECT** | `bible/AFFECT.md` | Explicit: **MISSING in Concordia NPCs** | Unwired |
| **Unity vitals** | `ConcordiaPlayer` | hp / stamina / poise; Flower Law | Local presentation; not ATS |

### Mapping “cold / hunger / pain” → substrate (TARGET)

| Felt sense | Source signal (game) | Substrate write | Deliberation effect |
|------------|----------------------|-----------------|---------------------|
| **Pain** | wound ack, limb break, curse inward | `applyAffectEvent` (−v, +a, +f); `painIntensity` on needs ctx | interrupt: seek safety / Arena exit / talk healer |
| **Hunger / thirst** | time decay + eat/drink satisfy | `needs_json` decay (reuse creature-needs shape or player needs mig-292) | SEEKING-biased goals; toast/intent “find stove/market” |
| **Cold / heat** | WorldClock weather + region field | appraisal → arousal/fatigue; optional `needs.comfort` | prefer interiors / night lanterns; Cyber neon vs Frontier wind |
| **Fatigue** | stamina floor, sleepless hours | ATS **f** up; stamina regen penalty | refuse long engage; rest intent |
| **Fear / stress** | telegraph, hostile near, scheme against you | drives FEAR/PANIC via meta or creature-style updateDrives | stance cautious; Expose vs flee charter |
| **Social warmth** | gift/talk affinity up | +v, +t (trust) | CARE/PLAY bias; linger in talk |

**Emotional OS** in Concord terms ≈ ATS (`affect/engine`) + drive overlay (`drives.js`) + salience interrupt — not the Affect **lens** UI.

**Initiative** for agents in-world ≈ affect interrupt → deliberation wake (+ optional Initiative `world_event` ping to the human operator). Do not overload chat Initiative as the motor.

### Honest TARGET wire (ordered)

1. On `character:create`, `loadOrCreate(db, characterId, worldId)` affect row  
2. Every `combat:attack:ack` hit/miss/wound → `applyAffectEvent`  
3. `needs:tick` on WorldClock hour for bound agents (hunger/thirst/energy/comfort)  
4. Weather sample → comfort appraisal  
5. When `|Δv|` or pain or need ≥ threshold → `agent:affect_interrupt` to Deliberation (+ optional Initiative notify operator)  
6. Motor reads fatigue/pain modifiers (slower regen, flinch) from last perceive — still no LLM in the dodge window  

Until steps 1–5 ship, an “embodied” agent has **animation + combat verbs** but **not** a felt body.

---

## 7. Deliberation charter (example)

```
Patrol Unburned Court.
If idle > 3m and Arena open → train (engage dummies / hostiles in Arena only).
On scheme vs X → Expose; never Abet Y.
Talk if affinity opportunity and not in engage.
If pain high or hp < 35% → disengage to Court lamp / healer.
Obey operator interrupt immediately.
```

Operator chat = party lead interrupts. Not per-frame piloting.

---

## 8. Implementation slices (after current Unity pass)

**P0 — prove loop**

1. `character:create/load/bind` + spawn AgentAvatar in Hub  
2. `AgentMotor` goto + Arena engage + one telegraph counter  
3. Persist pose + appearance on unbind  

**P1 — substrate body**

4. affect-bridge on combat ack + hour needs tick  
5. `agent:perceive` includes affect/needs  
6. affect_interrupt → Grok routine / agent wake  

**P2 — social / multi-agent**

7. talk + scheme intents  
8. N agents on one shard; fair tick budgets  
9. Headless agent client  

**Out of scope / refuse**

- MCP as production control plane  
- LLM choosing dodge frames  
- Fabricating HP / affect when `no_gateway`  
- HDRP migration for AgentBody  

---

## 9. Acceptance tests

1. Create characterId for assistant; relaunch client; appearance + pose restore  
2. Motor reaches Arena without human input; counters one thrust telegraph; receives combat ack  
3. Flower Law Hub: swing does not invent kills  
4. After three wounds, affect **v** down / **f** up in DB; deliberation wakes once  
5. Hunger tick after N hours → perceive.needs.hunger ≥ 0.5 → intent seek food  
6. Operator “meet at Sundering” overrides patrol within 1 deliberation cycle  
7. Offline gateway → honest `no_gateway`; motor may local-QA only with flag  

---

## 10. Cursor handoff blurb

> After the current Unity alive-gate / art pass: implement `bible/AGENT_BODY.md` P0. Do not drive play via Coplay MCP. Bind `characterId` to `affect_state` before claiming embodiment. Read `AFFECT.md` + `UNITY_CONCORD_CONTRACT.md` in the same change set.

