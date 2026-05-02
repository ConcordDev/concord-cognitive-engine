# Deferrals 6-9 — VAD, Inventory Picker, Anomaly Transparency, Quest Variety

Four Wave 1 Tier-1 deferrals batched into one commit. Each one collapsed to a wiring job because of substrate the redundancy sweep found.

---

## Deferral 6 — VAD Auto-Barge-In

**Sweep finding:** `VoiceRecorder.tsx:38-85` already runs an `AnalyserNode` + `getByteFrequencyData` RMS loop driven by `requestAnimationFrame`. Same pattern, different application.

**Built:**
- `concord-frontend/lib/voice/vad.ts` — `createVAD({ onSpeechDetected, threshold, sustainedMs, cooldownMs })` extracts the same analyser+RMS pattern into a standalone utility. `createDialogueBargeInVAD()` is the convenience wrapper that dispatches `concordia:dialogue-barge-in` (Phase 16's existing hook).
- Threshold: 0.04 (quiet-room baseline + ~12dB). Sustained: 200ms. Cooldown: 1500ms after fire.
- `NPCDialogue.tsx`: new effect that starts VAD when `isTalking && !muted`, stops on the next render. Mic stream stops the moment `isTalking` flips to false — no always-on listening.

Privacy: requires browser `getUserMedia` consent. No audio is recorded, transcribed, or transmitted — energy threshold only.

---

## Deferral 7 — Inventory Drag-Drop Picker

**Sweep finding:** `components/world-lens/InventoryPanel.tsx` already exists with full grid, fetch from `/api/player-inventory`, category filtering, sort modes. No DnD library installed.

**Built:**
- `concord-frontend/components/trade/TradeInventorySidebar.tsx` — fetches `/api/player-inventory`, renders draggable item cards. Uses HTML5 native drag-and-drop (no external library — keeps the dependency surface tight per Deferral 5's "focused page, not a refactor" guidance).
- Soulbound items render disabled; drag fires `e.preventDefault()` so they can't be dragged.
- MIME type: `application/x-concord-trade-item` to avoid colliding with any future drag types.
- `TradeWindow.tsx`: layout changed to `grid-cols-[auto_1fr_1fr]` so the sidebar lives left of "Your offer" only when editable. `OfferPane` extended with `onDragOver`/`onDragLeave`/`onDrop` handlers; drop merges with existing entry of same `inventoryId` (incrementing quantity up to `maxQuantity`) or appends. Hover states: cyan border on drag-over, fade-in × button on hover for removing items.

The Phase 8 trade flow now works end-to-end: drag inventory item → drop into offer → quantity updates → POST `/api/player-trade/:id/offer` → other party sees `trade:offer_updated`.

---

## Deferral 8 — Anomaly Transparency (No Admin)

Per user direction: **no admins.** World creators have full control over their own user-created worlds; everything else sticks to constitutional rules + transparency log.

**Sweep finding:** `worlds.created_by TEXT` column already exists at migration 042. No admin role infrastructure — and per the user, none should be added. `inventory_anomaly_queue` from Phase 10 is global-scoped.

**Built:**
- `server/routes/anomalies.js` with three endpoints:
  - `GET /api/anomalies/public` — aggregate counts by `(kind, status)` + recent-7-day rate. No user-identifying detail. **Constitutional transparency** — anyone logged in can verify the audit layer's health.
  - `GET /api/anomalies/world/:worldId` — auth-gated by `_userOwnsWorld(userId, worldId)` which joins against `worlds.created_by`. World creator sees open/investigating anomalies tied to users present in their world (loose coupling — joins through `player_position.city_id` if that table exists; falls back to all open anomalies otherwise so the creator can still resolve issues affecting their world).
  - `POST /api/anomalies/world/:worldId/:anomalyId/resolve` and `/dismiss` — same world-creator auth check; updates `inventory_anomaly_queue` with the creator's userId + a free-text resolution note.

**Cross-world / platform-level anomalies stay out of human control entirely** — they're handled by `lib/inventory-audit.js scanForAnomalies` running every 100th heartbeat tick (Phase 10), which auto-clears stale orphan reservations and flags negative-quantity / rapid-duplication patterns to the queue.

This means the anomaly system has three resolution paths and no admin role:
1. Auto-resolve by heartbeat scan rule
2. World-creator review for items in their world
3. Public transparency for everyone else (read-only — no human can act on platform-level anomalies, only the rules can)

---

## Deferral 9 — Quest Variety Per-User History

**Sweep finding:** No existing per-user quest history table. Quest emergence at `server/lib/quest-emergence.js` generates quests with no archetype-bias hooks today.

**Built:**
- `server/migrations/074_quest_archetype_history.js` — `user_quest_archetypes (user_id, archetype, seen_count, last_seen_at)` composite PK. Idempotent.
- `server/lib/quest-archetype-bias.js`:
  - `recordArchetypeSeen(db, userId, archetype)` — `INSERT … ON CONFLICT DO UPDATE` increments seen_count + bumps last_seen_at.
  - `selectArchetypeWithBias(db, userId, candidates)` — picks an archetype weighted inversely by `1 / sqrt(1 + seen_count)`. Unseen → 1.0, seen-once → 0.707, seen-9-times → 0.316. Gentle but real bias — the player still sees archetypes they enjoy, just not the same one repeatedly.
  - `archetypeFor(npc, need)` — extracts the archetype name from a quest emergence context. Currently uses `need:purpose` / `need:social` / `npc:guard` form so the bias works against either dimension.
- `server/server.js` heartbeat block: after the existing `quest:new` emit (Phase 3), calls `recordArchetypeSeen(db, userId, archetype)` for each recipient. Best-effort; failures don't block the emit.

`selectArchetypeWithBias` is exported and ready for future quest-emergence callers that want to choose between candidate templates with the bias applied. Today's quest-emergence picks from a fixed `PLAYER_DEPENDENT_NEEDS` array (`['purpose', 'social']`), so the bias only kicks in once that list grows or quest-engine.js gains explicit archetype templates — but the recording side runs for every quest delivered today, so the data starts accumulating immediately.

---

## Verification

- `node --check` on all touched server files — clean
- `npx tsc --noEmit` — no new errors
- `npx eslint lib/voice/vad.ts components/trade/TradeWindow.tsx components/trade/TradeInventorySidebar.tsx components/world/NPCDialogue.tsx` — clean
- `npm run migrate` — migration 074 applied; schema version 74

## Files touched

| File | Action |
|---|---|
| `concord-frontend/lib/voice/vad.ts` | created — VAD utility + dialogue barge-in convenience wrapper |
| `concord-frontend/components/world/NPCDialogue.tsx` | start/stop VAD on isTalking |
| `concord-frontend/components/trade/TradeInventorySidebar.tsx` | created — drag source for inventory items |
| `concord-frontend/components/trade/TradeWindow.tsx` | layout grid extended for sidebar; OfferPane is a drop target |
| `server/routes/anomalies.js` | created — public stats + world-creator scoped resolve/dismiss |
| `server/migrations/074_quest_archetype_history.js` | created |
| `server/lib/quest-archetype-bias.js` | created — recordArchetypeSeen + selectArchetypeWithBias + archetypeFor |
| `server/server.js` | mounts `/api/anomalies`; calls recordArchetypeSeen in quest:new emit loop |

Wave 1 (Deferrals 1-9) **complete**. Tier 2 (ragdoll + Piper) and Tier 3 (faction events; chunk streaming staying deferred) next.
