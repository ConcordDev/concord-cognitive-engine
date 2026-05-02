# The Concord Link — Cross-World Communication Substrate

The user dropped a complete spec for a cross-world communication system that maps directly to the cross-world plumbing the previous commit identified as missing. This commit ships the substrate.

## What landed

### Migration 076 — 4 tables

| Table | Purpose |
|---|---|
| `concord_link_messages` | Append-only audit log. Every message ever sent: sender + kind, receiver + kind, source_world, dest_world, message_type (text/voice/data/dream/physical/broadcast/echo), payload, encryption_level, cost_paid, emotional_weight, status (sent/delivered/corrupted/lost/intercepted), corruption_note, link_walker_id, timestamps |
| `concord_link_anchors` | Per-world access points. id, world_id, name, access_method, description, location, controlled_by_faction, stability |
| `concord_link_walkers` | Emergent NPCs whose role is physical message delivery between worlds. status enum (available/in_transit/on_contract/lost/dead), reputation, current_world |
| `concord_link_shadow_burn` | Per-sender Shadow Burn rate-limit tracking. messages_today, burn_severity, cooldown_until |

### `lib/concord-link.js`

Pure-function core + DB-touching helpers:

- `computeMessageCost({ messageType, sourceWorld, destWorld, encryption })` — base cost matrix from the user spec (text=1, voice=5, data=10, dream=2, echo=8, physical=100, broadcast=500), 30% same-world discount, 2x for high encryption / 4x for shadow encryption.
- `rollCorruption({ encryption, emotionalWeight, veilStability })` — base chance (none=8%, basic=4%, high=1%, shadow=0.1%) × weight factor × stability inverse, capped at 50%.
- `applyShadowBurn(db, senderId)` — daily message counter; over 50/day triggers severity-1 cooldown (30s × severity²); severity caps at 5; daily reset decays severity by 1.
- `sendMessage(db, opts, deps)` — full send flow: shadow-burn gate → cost compute → corruption roll → DB insert → realtime push to recipient if online (via Phase 8's `emitToUser`) → notify Elias's NPC if `emotionalWeight ≥ 0.7` (his power can sense high-charge messages in the Veil per the spec).
- `listInbox(db, receiverId)`, `markRead(db, messageId, readerId)`, `listAnchorsForWorld(db, worldId)`, `seedAnchorsFromWorldMeta(db, meta)`.

### `routes/concord-link.js`

- `GET /api/concord-link/anchors/:worldId` — public, no auth
- `GET /api/concord-link/cost?messageType=&sourceWorld=&destWorld=&encryption=` — preview before sending
- `POST /api/concord-link/send` — auth'd send (returns 429 with cooldownRemaining on shadow burn)
- `GET /api/concord-link/inbox` — auth'd inbox listing
- `POST /api/concord-link/:id/read` — auth'd read marker
- `GET /api/concord-link/shadow-burn/me` — auth'd burn-state introspection

### Anchor data per world (15 total)

Authored in each world's `meta.json` under `concord_link.anchors`. Each world ships 3 anchors with realistic access methods + faction control + stability ratings.

| World | Anchors | Notable |
|---|---|---|
| Concordia (hub) | The Council Chamber Resonance Stone, The Founding Archive Terminal, The Market Well | Original Compact-bound anchor at stability 1.0; archive controlled by Scholars' Guild |
| Superhero | Kane Tower Comm Array, The Phantom Node, Public Neural Clinic Implant | Two Luminary-controlled anchors; one Elias unconsciously seeded during the 72-hour awakening |
| Fantasy | The Voss Estate Mirror, The Listening Oak, The Dream Pool | Seraphine's mirror at 1.0 stability; the oak remembers every blood-rune ever inscribed |
| Crime | The Iron Rose Kitchen Radio, Ghost Chip Dispensary, Maria's Tattoo Parlor | Mama's radio is shortwave, Jax's chips are shadow-encrypted, tattoo signals are passive Veil receivers |
| Cyber | Mainframe Root Node, The Blackout Dead-Drop, The Glitch Chapel | Kael's node lets him read all traffic through it; Nyx's dead-drop is offline-first specifically because Kael can't see it |

### Frontend

- `realtime/socket.ts` — added `'concord-link:message'` to the SocketEvent union. When a sent message has a player recipient who's online, they receive the realtime event in their open tabs.

### Wiring

- `server.js` mounts `/api/concord-link`
- `content-seeder.js` extended to call `seedAnchorsFromWorldMeta(db, meta)` for each world that declares `concord_link.anchors` — Concordia + 4 sub-worlds = 15 anchors persisted at boot
- `seedContent()` signature now `({ db } = {})` — boot callsite updated to pass `db`

## Smoke test

```
[concordia ] The Council Chamber Resonance Stone (resonance_stones, stability 1)
[concordia ] The Founding Archive Terminal (founding_archive_terminals, stability 0.95)
[concordia ] The Market Well (the_veil_directly, stability 0.85)
[crime     ] The Iron Rose Kitchen Radio (hidden_radio_frequencies, stability 0.95)
[crime     ] Ghost Chip Dispensary (ghost_chips, stability 0.8)
[crime     ] Maria's Tattoo Parlor (tattoo_signals, stability 0.7)
[cyber     ] Mainframe Root Node (neural_jack, stability 1)
[cyber     ] The Blackout Dead-Drop (dark_web_nodes, stability 0.9)
[cyber     ] The Glitch Chapel (glitch_networks, stability 0.55)
[fantasy   ] The Voss Estate Mirror (enchanted_mirrors, stability 1)
[fantasy   ] The Listening Oak (blood_runes, stability 0.95)
[fantasy   ] The Dream Pool (dream_messages, stability 0.7)
[superhero ] Kane Tower Comm Array (holographic_drone_relays, stability 1)
[superhero ] The Phantom Node (shadow_reasoning_resonance, stability 0.9)
[superhero ] Public Neural Clinic Implant (neural_implants, stability 0.8)

Cost matrix (fantasy → cyber, shadow encryption):
  text       4
  voice      20
  data       40
  physical   400
  broadcast  2000

Test send: Thorne (fantasy) → Nyx (cyber), shadow-encrypted
  payload: "Wolves and walls. The wolf lives because the wall remembers it."
  result: { ok: true, status: 'delivered', cost: 4, corrupted: false }

Nyx's inbox top:
  fantasy→cyber [text/delivered] from thorne_blackroot: Wolves and walls. The wolf lives because...
```

The cross-world relationship Thorne ↔ Nyx that was authored in the previous commit is now a **functional communication channel.** Thorne's riddle-message about wolves and walls actually arrived in Nyx's inbox.

## What's wired vs what's open

**WIRED end-to-end:**
- Anchor points per world, faction-controlled, with stability ratings
- Cost calculation including encryption + same-world discount
- Shadow Burn rate-limit with cooldown and daily decay
- Corruption roll (rare for shadow-encrypted, common for unencrypted high-emotional-weight messages)
- DB persistence with full audit trail
- Realtime delivery for player recipients online
- The Enforcer's awareness hook (deps.notifyEnforcer fires when emotionalWeight ≥ 0.7)
- Frontend SocketEvent union extended

**Of the 4 sub-options the user offered to add next:**

1. **Player-facing version** — UI surface (inbox panel + compose modal + anchor map). Substrate is ready; this is a focused UI day.
2. **Specific anchor points per world** — DONE in this commit; 15 anchors across 5 worlds with full descriptions, access methods, faction control, and stability. User can extend any world's `concord_link.anchors` array in its `meta.json` to add more.
3. **Sample Link Walker NPCs with personalities** — `concord_link_walkers` table is ready; need 2-4 authored Walker NPCs per the user's spec (rare, highly respected, can step through the Veil, can become recurring companions).
4. **Black market for stolen / corrupted messages** — substrate's `status='intercepted'` enum is ready; need a route + UI for buying/selling intercepted messages, plus an interception mechanic that flags some messages mid-transit.

Tell me which decoration to add next and I'll ship it. Each of 1, 3, 4 is roughly half a day of focused work on top of what's now in.

## Cross-world communication graph after this commit

Thorne ↔ Nyx (philosophical kinship, riddle exchange) — **active channel**
Seraphine ↔ Mama (annual letters, called each other "cousin") — **active channel**
Vesper ↔ Mama (transactional intel back-channel) — **active channel**
Vesper ↔ Kael (former corporate sponsor turned threat-funder) — **active channel**
Seraphine ↔ Kael (4-day in-person consultation, ongoing intel back-channel) — **active channel**
Elias ↔ Nyx (encrypted resistance correspondence via Concordia hub dead-drop) — **active channel**
Jax ↔ Vesper (one-way, blood target tracking) — **passive surveillance**
Kael → Elias (twice-attempted "exchange of perspectives," no response) — **half-open channel**

Each one is now a real DB-backed communication path. The substrate has caught up to the lore.
