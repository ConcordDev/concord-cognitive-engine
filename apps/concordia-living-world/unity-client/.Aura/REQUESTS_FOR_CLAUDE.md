# Requests for Claude — Concordia Unity client

Aura files a request here whenever a task is blocked by something outside gameplay-C# ownership
(server routes, export pipeline, asset imports, served builds). Each request is a blocker until
Claude closes it.

**Template**

```
## REQ-<n> · <title>
- **Why:** <the gameplay outcome that is impossible without this>
- **Exact ask:** <one concrete, checkable deliverable>
- **Blocking tasks:** <roadmap IDs>
- **Status:** OPEN | ANSWERED(<date>, <where>) | CLOSED(<commit/PR>)
```

---

## REQ-1 · A chat event on `/unity-ws`
- **Why:** The client has no way to send or receive player/NPC chat. `ConcordClient.cs` exposes
  `SendMove`, `SendAgentIntent`, `SendAttack`, `SendDodge`, `SendGift`, `SendIntervene`,
  `SendInheritance`, `SendDungeonOpen`, `SendDungeonHit` and the generic `SendRaw`, but **no chat
  sender**, and no `chat:*` handler exists in the receive switch. Any chat, NPC dialogue line or
  player-whisper feature is therefore unbuildable on the client side without inventing server
  semantics, which the content law forbids.
- **Exact ask:** Add request/response events on the `/unity-ws` socket, in the existing
  `{evt,data}` envelope:
  - inbound client → server: `chat:send` with `{ text, channel, to? }`
  - outbound server → client: `chat:message` with `{ from, fromName, channel, text, ts }`
  - `chat:error` with `{ reason }` for refusal (moderation, out of range, no addressee)

  Document the channel enum (e.g. `say` / `tell` / `party`) and the range rule in the ack.
- **Blocking tasks:** any MMO chat/social task; Aura has not yet scheduled one because it cannot
  be verified end-to-end.
- **Status:** OPEN

## REQ-2 · Sync `city-layout.json` and `zones.json` into `Canon/concordia-hub/`
- **Why:** The roadmap names these two files as the source of truth for hub city layout and zone
  definitions, but **neither exists in this worktree**:
  - `Assets/Concordia/Resources/Concordia/Canon/concordia-hub/` currently holds only
    `cities.json`, `creatures.json`, `factions.json`, `lore.json`, `npcs.json` and `quests/`.
  - There is no `content/` directory anywhere in `~/concord/aura-wt` (verified by directory
    search), so the repo-side source the roadmap points at is not checked out here.

  World-placement and zone-membership tasks cannot use real layout data, and inventing a layout
  would break the "nothing fake" law.
- **Exact ask:** Check the real `content/world/concordia-hub/city-layout.json` and `zones.json`
  into this sparse worktree and mirror them to
  `Assets/Concordia/Resources/Concordia/Canon/concordia-hub/` (so they load through the same
  `Resources` path as the other Canon files), with `.meta` files. If those files do not exist in
  the source repo either, say so explicitly and name the real authority for hub layout, so Aura
  can retarget the tasks instead of guessing.
- **Blocking tasks:** hub layout / zone-membership world tasks in Phase 4 (W-*).
- **Status:** OPEN

## REQ-3 · Import "Human Melee Animations FREE" (or supply block/parry/heavy/strafe/riposte/get-up/ride clips)
- **Why:** `bible/ANIMATION.md` names the Asset Store pack 165785 as the intended source for the
  defensive and mount animations, but none of those clips are in the project. A project-wide model
  query for `block parry riposte strafe` returns **zero** assets, and
  `Assets/Concordia/Anim/` contains only `ConcordiaLocomotion.controller`,
  `SoldierLocomotion.controller` and the `UAL1` folder. Combat feel therefore has no block, parry,
  heavy-attack, strafe, riposte, get-up or ride animation to play — those beats are currently
  unrepresented, and Aura's fallback is a `TODO_anim_<thing>` stand-in rather than a real clip.
- **Exact ask:** Import the pack (Humanoid rig) into `Assets/Concordia/Anim/` and list the imported
  clip names + whether they retarget cleanly onto the hero rig (`ModularPerson.clipsFit` /
  `av.isHuman`). If the pack cannot be imported, supply equivalent Humanoid clips for:
  block idle, block impact, parry, heavy windup, heavy swing, strafe left/right, riposte, get-up,
  mount idle, riding gait.
- **Blocking tasks:** F-10 (3-beat combo), F-11 (heavy presentation), F-12 (directional dodge),
  F-13…F-20 (combat animation beats), combat presentation in Phase 2.
- **Status:** OPEN

## REQ-4 · A served WebGL build for two-client tests
- **Why:** Party, trade, world-state and any real two-player interaction need two simultaneous
  clients. The editor can only run one Play session against the local server, so those checks can
  never be exercised or evidenced from Aura's side.
- **Exact ask:** Ship a served WebGL build of the current `aura/gameplay` state at a stable URL
  (Claude owns `scripts/export-unity-web.mjs` and the deploy), with the build's commit hash
  recorded here, refreshed on request.
- **Blocking tasks:** MMO two-client verification tasks in Phase 6 (M-*), plus QA regression legs
  that need a second participant.
- **Status:** OPEN

## REQ-5 · A `loot:dropped` server event, or a WS route for loot-bag claim
- **Why:** Gear and economy tasks need real loot. `ConcordClient.cs` has no loot sender and no
  `loot:*` handler, so the client cannot be told what dropped nor claim it. The alternative —
  generating loot client-side — would invent prices and items, which the content law forbids.
- **Exact ask:** Either
  - outbound server → client `loot:dropped` with `{ bagId, x, z, items:[{ id, name, qty, rarity }] }`
    plus inbound `loot:claim` with `{ bagId }` and `loot:claim:ack` with `{ ok, taken:[...] }`, or
  - a documented existing route Aura can call through `SendRaw` (name the exact `evt` strings and
    payload shapes).
- **Blocking tasks:** gear acquisition and loot-bag tasks in Phase 3 (G-*).
- **Status:** OPEN
