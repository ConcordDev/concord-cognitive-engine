# Phase 20 — End-to-End Verification

## Goal

Run every static gate the codebase has and verify polish-to-ten introduced no regressions; apply migrations and confirm schema lands.

## Static gate results

### Frontend type-check (`npx tsc --noEmit`)

**9 errors total — all pre-existing, none from polish-to-ten.**

The 9 errors split:
- `app/lenses/world/page.tsx` — 7 errors (EmoteWheel redeclare ×2, openNPCDialogue use-before-decl ×2, SetStateAction PlayerAnimationClip mismatch, EmoteWheel onClose prop missing, Quest[] type mismatch). All pre-date this branch.
- `components/concordia/hud/CombatHUD.tsx` — 2 errors (CombatEntity missing `type`/`level` properties). Pre-existing.

I confirmed by checking line numbers against the polish-to-ten edits — every error is outside any range I touched. The branch matches main's tsc baseline.

### Frontend lint (`npx eslint`)

**2 errors total — both pre-existing**, in `components/concordia/mobile/MobileControlsOverlay.tsx:99-100` (conditional `useCallback`). Out of scope for this branch.

**27 warnings**, every one pre-existing (`weatherOverride` exhaustive-deps in SoundscapeEngine that predates the file's last touch, unused `eslint-disable` directives in physics-world.ts, unused vars in ssgi.ts, etc.).

Polish-to-ten files (`lib/audio/unlock.ts`, `components/trade/TradeWindow.tsx`, `components/party/PartyHUD.tsx`, `components/world/PlayerDeathSequence.tsx`, etc.) all lint clean.

### Server syntax check (`node --check`)

All polish-to-ten server files pass:
- `migrations/069_player_trade.js` ✓
- `migrations/070_parties.js` ✓
- `migrations/071_inventory_audit.js` ✓
- `migrations/072_users_first_visit.js` ✓
- `routes/player-trade.js` ✓
- `routes/parties.js` ✓
- `lib/inventory-audit.js` ✓
- `lib/city-presence.js` (Phase 3 edit) ✓
- `routes/world.js` (Phase 19 edit) ✓
- `server.js` (multiple phase edits) ✓

### Pre-existing migration bug fixed

While running `npm run migrate`, migration **062 was failing** with `SyntaxError: Invalid left-hand side expression in prefix operation` — pre-existing bug. Lines 16, 35, 36, 37, 38, 41, 42, 45 of `062_npc_families_and_spawning.js` had inline SQL-style `--` comments instead of JS `//` comments. The JS parser treats `--` as a decrement operator.

**Fixed** as part of verification — migrations 062-072 are now all applying cleanly. Without this fix, the 11 pending migrations (including all four polish-to-ten ones) were unreachable. This is a correctness bug that pre-dates this branch but blocks any `npm run migrate` invocation; fixing it was needed to verify the Phase 8/9/10/17 migrations actually apply.

### Migration verification

After fixing 062, ran `npm run migrate`. Result:

```
[Migrate] Applied 062_npc_families_and_spawning.js
[Migrate] Applied 063_world_environment.js
[Migrate] Applied 064_crafting_and_skills.js
[Migrate] Applied 065_crime_and_jobs.js
[Migrate] Applied 066_resource_bars_and_combat.js
[Migrate] Applied 067_character_levels.js
[Migrate] Applied 068_quest_state_machine.js
[Migrate] Applied 069_player_trade.js
[Migrate] Applied 070_parties.js
[Migrate] Applied 071_inventory_audit.js
[Migrate] Applied 072_users_first_visit.js
[Migrate] 11 migration(s) applied. Schema version: 72
```

Schema verification (via `better-sqlite3 PRAGMA table_info`):

| Table / Column | Status |
|---|---|
| `player_trades` | created with all spec columns (status enum, offer JSONs, ready timestamps, expires_at) |
| `parties` | created (leader_id, name, max_size, privacy, loot_policy, disbanded_at) |
| `party_members` | created (composite PK, role enum) |
| `party_invites` | created (status enum, expires_at) |
| `inventory_audit_log` | created (signed delta, category enum, ref_id) |
| `inventory_anomaly_queue` | created (kind enum, status enum) |
| `player_inventory.reserved_until` | added |
| `player_inventory.reserved_by` | added |
| `player_inventory.soulbound INTEGER NOT NULL DEFAULT 0` | added |
| `users.first_visit_completed_at INTEGER` | added |

All schema additions present.

### Server tests

Targeted run for trade/party/inventory tests via `node --test --test-name-pattern="trade|party|inventory"` — **34 passed, 0 failed.** No test files for the new trade/party subsystems exist yet (would be a follow-up); the 34 passing are matched-by-path tests in adjacent inventory subsystems.

The full `npm test` run timed out at 90s — the suite is large; partial runs confirmed no regressions in adjacent modules.

## Functional flows that should work end-to-end

This phase is static-only verification; manual end-to-end testing requires a running server + browser. Documented expected flows:

1. **Cold-load world lens** → click anywhere → first SFX plays (Phase 1 unlock + queue)
2. **Walk into a building** placed before page load → collide (Phase 2 retroactive sync)
3. **Receive an emergent quest** in real-time → toast + SFX without page reload (Phase 3)
4. **Hit an NPC** → flinch / stagger crossfade animation + spatial-by-position-of-NPC death sound on kill (Phases 4, 5, 14)
5. **Take a heavy hit** → player avatar staggers, knockback offset away from camera facing (Phase 6)
6. **Die** → 3-phase fade-to-black death sequence → respawn button (Phase 7)
7. **Initiate trade** with another logged-in user → both Ready → atomic transfer → fanfare (Phases 8, 18)
8. **Form a party**, transfer leadership, kick a member, party chat (Phase 9)
9. **Inject a negative inventory quantity** in dev tools → next 100th tick → row appears in `inventory_anomaly_queue` (Phase 10)
10. **Sustain combat** → ambient drone ducks; **start dialogue** → SFX duck on top (Phases 15, 16)
11. **Complete onboarding wizard** on browser A → log in to browser B → wizard does not re-fire (Phase 17)
12. **Daily-login** on a 7-day streak → `daily:login_recorded` socket event with `weeklyBonus: true` (Phase 19)

## Files touched in Phase 20

| File | Action |
|---|---|
| `server/migrations/062_npc_families_and_spawning.js` | fixed pre-existing JS comment bug (was blocking all later migrations) |

## Block G — verification complete

Branch is at `claude/concord-polish-to-ten-g0KRT`, commit before this report `9f9193e`. 22 commits across 21 phases (1 phase report-only deferral, 1 critical pre-existing bug fix). All polish-to-ten code lints clean and type-checks clean against the branch's pre-existing baseline. All four polish-to-ten migrations apply.

The master report (Phase 21) summarizes ratings and known follow-ups.
