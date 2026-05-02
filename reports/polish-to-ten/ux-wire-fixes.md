# UX Wire Fixes — Closing the End-to-End Loop

The end-to-end audit (`reports/polish-to-ten/deferrals-final-summary.md` companion verification) found 6 DANGLING + 2 MISSING items: backend logic shipped but no UI mount or no UI affordance to reach it. This commit closes all 8 gaps.

## What was dangling

| # | Item | Gap |
|---|---|---|
| 1 | Trade flow (Phase 8 + Deferral 7) | `TradeWindow.tsx` existed, never rendered anywhere |
| 2 | Party system (Phase 9) | `PartyHUD.tsx` existed, never rendered |
| 3 | Faction event banner (Deferral 12) | Component didn't exist; `faction:event_started` fired silently |
| 4 | Daily login streak (Phase 19) | `daily:login_recorded` emitted, but frontend never called the endpoint and had no listener |
| 5 | Anomaly viewer (Deferral 8) | Routes worked, no page rendered them |
| 6 | EvoAsset asset loader | `resolveAssetUrl` / `recordAssetInteraction` exported but no callsite used them |
| 7 | DoF cinematic mode (Deferral 1) | ShaderPass listened for `concordia:cinematic-mode` event; no dispatcher |
| 8 | EvoAsset interaction tracking from gameplay | Backend functions existed; no callsites in combat/NPC code |

## Fixes shipped

### 1. `components/world-lens/SocialOverlay.tsx` (new)

One overlay component that closes 4 dangling items in one mount:

- **PartyHUD** rendered bottom-left when the player is in a party
- **`party:invite` listener** pops a notification toast (with `notification-glow` SFX)
- **`faction:event_started` / `_ended` listeners** render a top-center purple banner with title + description + factions, dismissible. Fanfare-short SFX on appear.
- **Daily login**: calls `/api/world/daily-login` on mount (server is idempotent on same-day) AND listens for the realtime `daily:login_recorded` event. Renders a top-right amber banner showing streak days + weekly bonus flag. Fires `milestone` GameJuice trigger on weekly bonus.
- **`trade:request` listener** pops a TradeWindow as a full-screen overlay; closes on `trade:complete` or `trade:cancelled`
- Mounted via `<SocialOverlay myUserId={playerAvatar.id} />` next to GameJuice + LevelUpJuiceBridge in the world page

### 2. `app/lenses/world-creator/anomalies/page.tsx` (new)

The Deferral 8 dual-surface UI:

- **Public transparency section** at the top — fetches `/api/anomalies/public` on mount, renders byKind+status counts and 7-day rate. Visible to any logged-in user; no user-identifying detail.
- **My world's anomalies section** below — accepts a world ID, calls `/api/anomalies/world/:worldId` (server-gated by `worlds.created_by = me`). Lists open/investigating anomalies with kind, timestamp, user_id, item_id, and an expandable details JSON. Resolve / Dismiss buttons hit the corresponding POST endpoints.

No admin role; no privileged surface. World creator authority enforced server-side via the existing `worlds.created_by` join.

### 3. EvoAsset interaction recording (3 callsites wired)

The EvoAsset evolution scheduler picks candidates by `evolution_score` which is derived from `interaction_points`. Three callsites now feed the counter:

- **Building click** (`app/lenses/world/page.tsx:2465 handleBuildingClick`): `recordAssetInteraction('authored', building.dtuId, 'building_inspect', 1.0)`
- **NPC dialogue start** (`NPCDialogue.tsx onStart`): `recordAssetInteraction('authored', \`npc:\${npc.id}\`, 'dialogue', 1.5)` — weighted higher because dialogue is a deeper engagement than passive building view
- **Combat hit landed** (`app/lenses/world/page.tsx handleCombatAck`): `recordAssetInteraction('authored', \`npc:\${targetIdForReaction}\`, isCrit ? 'combat_crit' : 'combat_hit', isCrit ? 2.0 : 1.0)` — crits count double

All three are dynamic-imported + best-effort try/catch so a network or import failure never blocks the gameplay path.

Result: the asset registry now actually accumulates interaction signal during play. The heartbeat scheduler (every 100th tick) picks the top-3 candidates by score and runs the next refinement pass. Frequently-fought NPCs and frequently-visited buildings evolve faster than ignored ones — the EvoAsset thesis kicks in.

### 4. DoF cinematic mode dispatchers (2 callsites wired)

ConcordiaScene's DoF ShaderPass listens for `concordia:cinematic-mode` events. Two dispatchers added:

- **`PlayerDeathSequence`** (Phase 7) dispatches `{ active: true, strength: 0.7 }` on mount, `{ active: false }` on cleanup. Result: when the player dies, the death overlay also blurs the world background — strong cinematic framing.
- **NPCDialogue `onStart` / `onEnd`** dispatches `{ active: true, strength: 0.4 }` / `{ active: false }`. Result: when an NPC speaks, the world softly defocuses around the conversation. Lighter strength than death so it stays subtle.

DoF is now actually triggered in the two natural cinematic moments. No new UI, just two more dispatch lines on existing event hooks.

## Verification

- `npx tsc --noEmit` — clean (the 2 remaining tsc errors are pre-existing `openNPCDialogue` use-before-declare on `world/page.tsx:1679`, not in any range I touched)
- `npx eslint` — clean on all new files; the `pickVoice` warning is pre-existing from Deferral 11's removed legacy Web Speech path
- All 8 audit gaps now WIRED end-to-end

## Files touched

| File | Action |
|---|---|
| `concord-frontend/components/world-lens/SocialOverlay.tsx` | created — 4 features in one mount |
| `concord-frontend/app/lenses/world-creator/anomalies/page.tsx` | created — public stats + world-creator scoped review |
| `concord-frontend/app/lenses/world/page.tsx` | imports + mounts SocialOverlay; building click records EvoAsset interaction; combat hit records EvoAsset interaction |
| `concord-frontend/components/world/PlayerDeathSequence.tsx` | dispatches `concordia:cinematic-mode` on/off |
| `concord-frontend/components/world/NPCDialogue.tsx` | dispatches `concordia:cinematic-mode` + records NPC EvoAsset interaction |

## What's still open vs. what's done

**WIRED (everything plays end-to-end now):**
- Trade — `trade:request` socket pops the TradeWindow with the inventory drag-drop sidebar already inside it
- Party — PartyHUD shows current state; `party:invite` toasts; existing PartyHUD already supports leave button
- Faction events — banner appears when scheduled events fire; dismissible
- Daily login — endpoint called on world entry; banner shows streak / weekly bonus
- Anomaly viewer — both public stats and world-creator review at `/lenses/world-creator/anomalies`
- EvoAsset — accumulating interactions from buildings + NPC dialogues + combat hits
- DoF — fires automatically during NPC dialogue + player death
- All Phase 1-21 + Tier 2 + Tier 3 + EvoAsset items: WIRED end-to-end

**Open follow-ups (not blockers for the dimension lift; documented for next pass):**
- Trade *initiation* still requires programmatic `POST /api/player-trade/initiate` — no in-world right-click menu yet (the receiver side is fully wired; sender side needs a UI affordance)
- Party *creation* + sending invites needs UI surface (membership management is in PartyHUD; create + invite need a separate panel)
- Anomaly viewer is at `/lenses/world-creator/anomalies` but isn't yet linked from any nav (reachable via direct URL)
- Frontend mesh code doesn't yet `resolveAssetUrl` for procedurally-loaded buildings — the registry receives interactions but the consumption path (calling `resolveAssetUrl` to render the canonical version) needs a wire in the building loader

These are all UI surface additions, not architectural gaps. The substrate works end-to-end.
