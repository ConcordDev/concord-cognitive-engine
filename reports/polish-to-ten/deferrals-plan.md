# Polish-to-Ten — Deferrals Plan

## Context

The master polish-to-ten branch shipped 21 phases and projects to ~8.5 across all seven audit dimensions. 13 deferrals were called out — ranging from half-day wiring to 1-2 week subsystems. This plan sequences them by **leverage**, **risk**, and **dependency**, so a follow-up effort can pick them up in priority order without re-deriving the analysis.

Total estimated effort across all 13: ~6 working weeks if done sequentially. Several can run in parallel.

---

## Recommended sequencing

### Tier 1 — Quick wins (≤ 1 day each, ship before re-audit)

These deliver disproportionate player-felt value for the time. Do them all before re-running the audit framework, since most of them are visible at first session and can lift the projected 8.5 directly to 9 on their respective dimensions.

| # | Deferral | Effort | Why first |
|---|---|---|---|
| 1 | DoF on dialogue + ACES tone mapping | ~half day | One ShaderPass + one renderer line; visible improvement everywhere |
| 2 | Mesh-collider profile (Phase 11 follow-up) | ~half day | Closes the only unimplemented branch in `colliderProfile` |
| 3 | Level-up / DTU-validated GameJuice triggers | ~half day | Unlocks two more loop closures via existing infrastructure |
| 4 | Wall-impact secondary damage + dust particles | 1 day | Closes the Phase 6 environmental knockback story |
| 5 | Settings UI for quality preset | 1 day | The presets exist; players can't reach them today |
| 6 | VAD auto-barge-in | 1 day | Phase 16 left this hook; minimal AudioWorklet |
| 7 | Inventory drag-drop picker UI | 1 day | Phase 8 trade window stub — gates real player testing of trade |
| 8 | Admin review UI for inventory anomalies | 1 day | Phase 10 detection without UI is detection-without-action |
| 9 | Quest variety per-user history bias | 1 day | Phase 19 retention boost; cheap to ship |

**Total Tier 1: ~7 days**, parallelizable down to ~3 days with two engineers.

### Tier 2 — Focused projects (2-3 days each)

| # | Deferral | Effort | Why second |
|---|---|---|---|
| 10 | Bone-physics ragdoll (Phase 5b) | 2-3 days | Replaces procedural collapse; visible only on death which is uncommon |
| 11 | Piper TTS migration in NPCDialogue (Phase 16b) | 2-3 days | Big quality jump for NPC voices; needs TTS backend already wired |

**Total Tier 2: ~5 days**.

### Tier 3 — Subsystem builds (week+ each)

| # | Deferral | Effort | Why last |
|---|---|---|---|
| 12 | Faction event scheduler + seasonal content | ~1 week + content authoring | Substantial; benefits compound over weeks of player retention |
| 13 | Full chunk streaming (Phase 12b) | 1-2 weeks | Migration of 30+ mesh-spawn sites; only matters at world scale we don't have yet |

**Total Tier 3: ~3 weeks**.

---

## Per-deferral mini-plans

### Tier 1 — Quick wins

#### 1. DoF + ACES tone mapping

**Scope:** One ShaderPass for depth-of-field on dialogue, one line for tone mapping.

**Key files:**
- `concord-frontend/components/world-lens/ConcordiaScene.tsx:329` (renderer config) — add `renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0`
- `concord-frontend/components/world-lens/ConcordiaScene.tsx:340-380` (post chain) — add a DoF ShaderPass with depth-texture sampling. Activate when `cinematicMode` flag (already exists in CameraControls.tsx) is set.

**Approach:** ACES is one line; DoF is a standard fragment shader using `getViewZ` + circle-of-confusion blur. Toggle the DoF pass `enabled` flag based on a `cinematicModeRef`.

**Risk:** Low. Tone mapping changes the look of every existing screenshot — flag for review before merging. DoF can be made low enough strength to be subtle.

**Verification:** Open dialogue → scene background blurs softly. Disable cinematic mode → DoF off.

#### 2. Mesh-collider profile

**Scope:** Implement the `'mesh'` case in `physicsWorld.syncFromScene`'s collider-profile switch. Currently falls back to box.

**Key files:**
- `concord-frontend/lib/world-lens/physics-world.ts` — add `_registerTrimeshFromObject` that walks the BufferGeometry, extracts positions + indices, calls `RAPIER.ColliderDesc.trimesh(vertices, indices)`.

**Approach:** Iterate Object3D's geometry; convert position attribute + index attribute to flat `Float32Array` and `Uint32Array`. Trimesh colliders are static-only (fits the use case — terrain features beyond the heightfield, large rocks, complex walls).

**Risk:** Trimesh colliders are heavy; perf-test with 50+ before merging. Cap at e.g. 5k triangles per collider.

**Verification:** Tag a complex mesh `colliderProfile: 'mesh'`, walk into it, confirm collision matches mesh shape (not AABB).

#### 3. Level-up / DTU-validated GameJuice triggers

**Scope:** Wire two existing GameJuice triggers (`milestone`, `validate-pass`) to fire on existing realtime events.

**Key files:**
- `concord-frontend/lib/realtime/socket.ts` — `quality:approved` event already in the union.
- `server/lib/world-progression.js` — `awardXP` already returns `rankUp: true` when crossing a tier; add a callback hook so a callsite can opt into emitting via `emitToUser`.
- New: a small `LevelUpListener` component mounted near `GameJuice` that subscribes to `level:up` and `quality:approved`, dispatches the corresponding game-juice trigger.

**Approach:**
1. Add `attachXPEmitter(emitToUser)` to world-progression.js that, when set, fires `level:up` with `{ newRank, xpAwarded }` whenever `awardXP` returns `rankUp`.
2. Wire from `server.js` next to where `recordDailyLogin` is wrapped (Phase 19 wired `daily:login_recorded` similarly).
3. Frontend: extend QuestLog or add a new generic listener component that subscribes to both events and dispatches `concordia:game-juice` with `trigger: 'milestone'` (level-up) or `trigger: 'validate-pass'` (DTU validated).

**Risk:** Low. All infrastructure exists.

**Verification:** Cross a rank threshold via test data → fanfare-short SFX + visual; trigger a `quality:approved` server-side → ascending-chime SFX.

#### 4. Wall-impact secondary damage + dust particles

**Scope:** When a knocked-back NPC hits a wall during the Phase 6 offset tween, fire a secondary hit-reaction + spawn dust.

**Key files:**
- `concord-frontend/lib/world-lens/physics-world.ts` — add `world.contactPair(coll1, coll2)` callback registration.
- `concord-frontend/components/world-lens/AvatarSystem3D.tsx` — knockback step tween checks for collision contact, fires `concordia:hit-reaction` with `severity: 'heavy'` if hit.
- `concord-frontend/components/world-lens/ParticleEffects.tsx` — add a `dust` particle type (gray puff, ~1s lifetime, 8-12 particles).

**Approach:** During the knockback step loop, after each position increment, query `world.contactPair` between the avatar's collider and any nearby wall colliders. On contact: fire reaction + dispatch `concordia:particle-effect` with `{ type: 'dust', position: contactPoint }`.

**Risk:** Medium. Rapier contact queries every step for every knocked NPC could be perf-heavy. Cap to 1 contact-check per knockback (the first impact).

**Verification:** Knock an NPC into a wall → second flinch animation fires; dust puff at the impact point.

#### 5. Settings UI for quality preset

**Scope:** New page in the existing settings lens that lets the player switch low / medium / high / ultra and persists.

**Key files:**
- `concord-frontend/app/lenses/settings/` — likely already has a settings layout to extend.
- New `concord-frontend/components/settings/QualityPresetSelector.tsx`.
- `concord-frontend/store/ui.ts` or similar — persist selection to localStorage + sync to a `useQualityPreset` hook.

**Approach:** Selector with 4 buttons. On change, write to `useUIStore` + localStorage. ConcordiaScene reads the store on mount; reload (or hot-swap) the renderer with the new shadowMapSize / bloom intensity / SSGI on/off.

**Risk:** Hot-swapping shadows mid-session may cause a frame stutter — easier to refresh the page on change. Document.

**Verification:** Switch preset → page refreshes → bloom intensity / shadow resolution visibly changes.

#### 6. VAD auto-barge-in

**Scope:** AudioWorklet energy-threshold processor that detects player speech during NPC dialogue and dispatches `concordia:dialogue-barge-in`.

**Key files:**
- New `concord-frontend/lib/voice/vad.ts` — AudioWorklet processor + main-thread loader.
- `concord-frontend/components/world/NPCDialogue.tsx` — when `isTalking` becomes true, request mic access (or read existing mic stream), feed it to VAD; dispatch barge-in on detection.

**Approach:** Standard energy-threshold VAD: RMS of last 256-sample window; if RMS > threshold for 200ms continuous, fire. Threshold calibrated on first 500ms of mic stream (silence baseline + 12dB).

**Risk:** Medium. Requires `getUserMedia` permission flow with consent UI. False positives during background noise. Make it a settings toggle.

**Verification:** Open dialogue → speak in real-life → NPC stops mid-sentence.

#### 7. Inventory drag-drop picker UI

**Scope:** Component for the trade window's editable pane that lets players drag items from their inventory into the offer.

**Key files:**
- `concord-frontend/components/trade/TradeWindow.tsx` — already has the placeholder slot.
- New `concord-frontend/components/inventory/InventoryItemPicker.tsx` — fetches `/api/world/inventory` (assumed exists; verify), renders a grid of items, supports drag-drop into a target.
- `concord-frontend/components/trade/OfferPane.tsx` (extract from TradeWindow) — drop target.

**Approach:** Use HTML5 drag-and-drop API (no external lib). Hover state on the offer pane; on drop, call `submitOffer(next)` with the dragged item appended.

**Risk:** Low. Standard pattern.

**Verification:** Drag an item from inventory into "Your offer" → quantity updates, server confirms via /offer endpoint.

#### 8. Admin review UI for inventory anomalies

**Scope:** Page that lists open `inventory_anomaly_queue` rows + buttons to mark resolved / dismissed.

**Key files:**
- New `server/routes/admin-anomalies.js` — `GET /api/admin/anomalies?status=open`, `POST /:id/resolve`, `POST /:id/dismiss`. Auth gated to admin role.
- New `concord-frontend/app/lenses/admin/anomalies/page.tsx` — list view with filters by kind.

**Approach:** Mirror the existing audit_log pattern. Admin role check via existing auth middleware.

**Risk:** Low.

**Verification:** Trigger a negative-quantity anomaly → it appears in the admin page → resolve it → status changes.

#### 9. Quest variety per-user history bias

**Scope:** Track which quest types each user has seen; bias `quest-emergence` away from repeated types.

**Key files:**
- New migration: `user_quest_seen` table — `(user_id, quest_type, count, last_seen_at)` composite PK.
- `server/lib/quest-emergence.js` — extend `detectQuestOpportunities` to read seen-counts and weight new quest generation toward unseen types.

**Approach:** Each generated quest increments `count` for `(recipientUserId, quest.type_or_archetype)`. New generation samples archetype with weights inversely proportional to count.

**Risk:** Low. Pure additive logic.

**Verification:** Same user sees diverse quest archetypes over a session instead of 5 "find the engineer" in a row.

---

### Tier 2 — Focused projects

#### 10. Bone-physics ragdoll (Phase 5b)

**Scope:** Replace the procedural death-collapse with a real 16-bone Rapier dynamic-rigidbody chain with `ImpulseJoint` constraints.

**Key files:**
- `concord-frontend/components/world-lens/AvatarSystem3D.tsx` — `handleDeathCollapse` body swap. Window-event interface (`concordia:death-collapse`) stays the same so callsites don't change.
- `concord-frontend/lib/combat/ragdoll.ts` (new) — `Ragdoll` class that wraps the bone chain.

**Approach:**
1. On death, walk the avatar's existing skeleton (camelCase bones: hips, spine, chest, head, leftUpperArm, etc.) and create one dynamic RigidBody + capsule collider per bone, sized from the bone's local-space length.
2. Connect parent-child bones with `ImpulseJoint` — spherical for shoulders/hips/neck, hinge for elbows/knees, with ROM tuned per joint (45° for hinges, 90° for spherical).
3. Per-frame: copy each rigidbody transform back to the corresponding skeleton bone before render.
4. Apply impact impulse on `chest` bone from the killing-blow direction.
5. After 8s settle: 2s opacity fade, then dispose all bodies + colliders + joints.

**Performance:** 16 bodies × 8s × max 8 ragdolls = 128 active bodies max. Rapier can handle this; perf-test on mid-spec.

**Risk:** Medium. Joint limit pops can cause jitter; ROM tuning is tedious. Cap fallbacks: if any bone can't be sized (geometry missing), fall back to procedural collapse for that NPC.

**Verification:** Each death ragdoll falls differently based on the killing-blow direction. Bodies pile on each other when multiple die nearby. No jitter at rest.

#### 11. Piper TTS migration in NPCDialogue (Phase 16b)

**Scope:** Replace `SpeechSynthesisUtterance` with streaming Piper audio fetched from the existing `/api/voice/tts` macro.

**Key files:**
- `concord-frontend/components/world/NPCDialogue.tsx:359-405` — `speak()` callback rewrite.
- New `concord-frontend/lib/voice/piper-stream.ts` — fetches TTS audio buffer, decodes, queues, plays through SoundscapeEngine's master gain (so dialogue ducking from Phase 16 still works).
- `concord-frontend/lib/voice/mouth-sync.ts` (new) — derives mouth-open intensity from audio buffer time + amplitude envelope (for the existing mouth animation polling).

**Approach:**
1. New `playPiperTTS(text, voiceProfile)` async function: POSTs to `/api/voice/tts` with `{ text, voice }`, gets WAV/MP3 base64, decodes via `audioContext.decodeAudioData`, plays through the soundscape master gain. Returns a playback handle with `cancel()` and `onEnded`.
2. NPCDialogue's `speak` tries Piper first; falls back to Web Speech API on failure (network / no Piper bin / etc).
3. Mouth-anim polling: instead of `speechSynthesis.speaking`, sample the audio source's `playbackTime` and map to mouth-open via amplitude envelope precomputed on decode.
4. Cancellation: dialogue-barge-in event already wired in Phase 16; just call `playbackHandle.cancel()` instead of `speechSynthesis.cancel()`.

**Risk:** Medium. Network latency before first audio = perceived lag (Piper is fast but not zero). Cache common voice lines client-side. Fallback to Web Speech if latency > 500ms.

**Verification:** NPC speaks with Piper-quality voice; mouth animation syncs to actual amplitude; barge-in cuts the audio cleanly.

---

### Tier 3 — Subsystem builds

#### 12. Faction event scheduler + seasonal content

**Scope:** Server-side scheduler that rolls authored faction events into the world on a cadence; in-world surfacing.

**Key files:**
- `content/world/faction-events/` — new directory for authored event templates (JSON/YAML files: title, faction, prerequisites, rewards, lifetime).
- New `server/lib/faction-event-scheduler.js` — every Nth tick (e.g. 200th = ~50min at default cadence), rolls candidate events from the templates that match current world state, schedules ones whose prereqs satisfy.
- New migration: `faction_events_scheduled` — id, template_id, faction_id, world_id, started_at, ends_at, status enum.
- Frontend: new `concord-frontend/components/concordia/events/FactionEventBanner.tsx` — surfaces active events in the player's current district.
- WebSocket: `'faction:event_started'`, `'faction:event_ended'` events.

**Approach:**
1. Template format: `{ id, title, faction, prerequisites: { reputation: {...}, season: 'winter', ... }, rewards: {...}, durationHours: 2 }`.
2. Scheduler queries active worlds + factions, evaluates prereqs, picks 1-3 candidates, inserts into scheduled table.
3. Heartbeat tick fires `faction:event_started` to all users in affected worlds; ending tick fires `faction:event_ended` and processes rewards.
4. Seasonal content rides the same pipeline — each season is a `season_winter`, `season_harvest` tag on templates.

**Content authoring:** ~10-20 events per season is a reasonable seed. Substantial but bounded — author one season fully, ship, iterate.

**Risk:** Medium. Templates need careful prereq design or events won't fire when expected. Live-content tooling (creator marketplace, governance proposal) might be a better long-term path than authored JSON.

**Verification:** Schedule a faction event with low prereqs → event fires within 50min → all users in affected worlds see banner → rewards distribute on event end.

#### 13. Full chunk streaming (Phase 12b)

**Scope:** Load and unload mesh assets based on player distance from chunks; the actual streaming subsystem the LOD utility was a stepping-stone toward.

**Key files:**
- New `concord-frontend/lib/world-lens/chunk-manager.ts` — chunk lifecycle, async asset loader, distance-check tick.
- New `content/world/chunks/<world>/<x>_<z>.json` — chunk asset manifests (mesh paths, building positions, NPC spawns, vegetation seeds).
- Migration: `world_chunk_state` server-side table tracking which chunks are loaded for which user (for spatial-presence broadcast efficiency).
- Mass migration: 30+ mesh-spawn callsites across `ConcordiaScene`, vegetation system, NPC spawning, IsometricEngine, etc. — each opts into chunk-bound loading by tagging `userData.chunk = '<x>_<z>'`.
- Hook into Phase 11's `physicsWorld.removeBuildingCollider` for collider unload.

**Approach:**
1. Define chunk grid (64m × 64m).
2. Per-frame check: which chunks are within ±3 chunks of player position.
3. For each chunk transitioning into range: async-fetch its manifest, instantiate meshes, register colliders via Phase 11 sync, add to scene.
4. For each chunk transitioning out of range: remove meshes from scene, unregister colliders, dispose geometries/materials.
5. Pre-fetch one chunk further than the load radius to hide loading hitches.

**Risk:** High. Touches a lot of code. Careful migration of each spawn site to opt into chunk-bound loading. Potential for memory leaks if disposal is imperfect.

**Verification:** Walk continuously across 10 chunks; memory usage stable; frame rate doesn't dip during chunk transitions; building colliders register/unregister correctly.

---

## Parallelization plan

**Wave 1 (Tier 1 — single sprint):**
- Engineer A: deferrals 1, 2, 3, 4 (all rendering / animation)
- Engineer B: deferrals 5, 6, 7, 8, 9 (UI / data)

**Wave 2 (Tier 2 — single sprint):**
- Engineer A: deferral 10 (ragdoll)
- Engineer B: deferral 11 (Piper migration)

**Wave 3 (Tier 3 — separate phases):**
- Faction events as a focused 1-2 week project (depends on content authoring availability)
- Chunk streaming as a separate 2-3 week project

---

## Re-evaluate after Wave 1

Before committing to Tier 2-3 work, run the audit framework on the Wave 1 result. The 9 Tier 1 deferrals could plausibly bring projected dimension ratings to ≥9 across the board. If they do, Tier 2-3 become "nice to have" rather than "needed for the rating."

Stop conditions for Wave 1:
- If a Tier 1 deferral exposes a deeper bug, stop and document instead of patching past it
- If two Tier 1 deferrals interact unexpectedly (e.g. settings UI conflicting with quality-preset reload), defer the simpler one and revisit
- If audit re-rating after Wave 1 shows ≥9 across the board, Tier 2-3 graduate to "post-launch backlog" rather than "polish-to-ten remainder"

---

## Open questions before execution

1. **TTS quality bar for Piper migration:** Web Speech API is browser-default voices — usable but generic. Is the project willing to spin up Piper at scale (each TTS request hits the local Piper binary; concurrent dialogue with 50+ players means meaningful CPU)? If not, Web Speech API stays.

2. **Faction event content authoring:** is there a creator pipeline for content that should produce these events organically (governance proposals → world events?), or is hand-authoring the path?

3. **Chunk streaming threshold:** at what world scale does this matter? A small Concordia city of 100m × 100m doesn't need streaming. A full kilometer-scale district would. Pin a target before starting the migration.

4. **Settings UI scope creep:** quality preset is the bare minimum. Once a settings page exists, audio volume sliders, accessibility toggles, language, etc. all want a home there. Decide if this deferral lands a focused page or kicks off a broader settings refactor.

5. **Admin role infrastructure:** the admin anomaly UI needs an admin role check. Confirm it exists; if not, a small role-management addition is a prerequisite.
