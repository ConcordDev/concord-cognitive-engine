# MMO Systems — Operator Guide

This document covers the MMO-depth sprint (Phases U–X): mail, achievements,
titles, faction reputation, parties + LFG, world markers, auctions, quest
log, wardrobe, calendar, kill feed, disease engine, plague mechanics,
and immersive substrate (intoxication, mount riders, tracking).

## Phase U — MMO foundations

| Phase | Purpose | Routes / lens |
|-------|---------|---------------|
| U1    | Async mail with attachments + COD | `/api/mail/*`, `/lenses/mail` |
| U2    | Achievement engine + 38 authored unlocks | `/api/achievements/*`, `/lenses/achievements` |
| U3    | Titles wired (equip + display) | `/api/titles/*` |
| U4    | Faction reputation aggregate w/ cache | `/api/factions/*/reputation` |
| U5    | Parties + LFG matchmaking + raid groups | `/api/parties/*`, `/api/lfg/*`, `/lenses/lfg` |
| U6    | World markers (wire mig 188) | `/api/worlds/:worldId/markers` |

## Phase V — Discovery surfaces

| Phase | Purpose | Routes / lens |
|-------|---------|---------------|
| V1    | Auction house with anti-snipe | `/api/auctions/*`, `/lenses/auction` |
| V2    | Quest log lens + party share | `/lenses/quests` (uses U5 share helper) |
| V3    | Cosmetic wardrobe (slot-based outfits) | `/api/wardrobe/*` |
| V4    | Persistent calendar + RSVP | `/api/calendar/*`, `/lenses/calendar` |
| V5    | Kill feed | mounted in `/lenses/world` |

## Phase W — Disease engine

19 authored diseases across 4 tiers (common / uncommon / rare / mental).
Engine functions in `server/lib/disease-engine.js`:

- `contractDisease(db, userId, diseaseId, { severity, source, worldId })` — idempotent on re-contract (bumps severity); rejects if user has immunity.
- `tickDiseases(db, userId, { worldId })` — heartbeat. Advances severity per disease's `severityIncreasePerTick`. Mortality risk at severity > 0.7.
- `curePartial(db, userId, diseaseId, severityReduction)` — drops severity; below `DISEASE_RECOVERY_BELOW_SEVERITY = 0.02` → recovered + immunity granted.

Medical profession (`server/lib/medical-profession.js`):
- `diagnose(db, healerId, patientId)` — accuracy curve `0.5 + healerLevel × 0.05` capped at 0.95.
- `treatPatient(db, healerId, patientId, diseaseId, cureRecipeId)` — success `0.7 + skillLevel × 0.03` with valid recipe, else `0.4 + skillLevel × 0.03`. Failed treatment writes a negative `character_opinions` row.

Plague (`server/lib/plague-event.js`):
- Heartbeat `plague-watch` (freq 60, scope world). Declares plague when `getInfectionRatio(worldId) >= 0.15`. Inserts `quarantine_active` refusal field. Resolves when ratio drops below 7.5%.

### Authoring a new disease

Drop a JSON into `content/diseases/<tier>.json` (or a new file). Schema:

```json
{
  "id": "unique-slug",
  "name": "Display name",
  "symptoms": ["..."],
  "transmissionVector": "airborne | touch | foodborne | bloodborne | waterborne | noncontagious",
  "contagionRadiusM": 5,
  "mortalityRisk": 0.02,
  "severityHalfLifeHours": 48,
  "severityIncreasePerTick": 0.01,
  "endemicWorlds": ["tunya", "crime"],
  "cureRecipeIds": ["recipe_id_a", "recipe_id_b"]
}
```

Reload at server boot (`initDiseaseCatalog` runs idempotently). Endemic worlds use `"all"` for ubiquitous.

## Phase X — Immersive depth

### X2 — Intoxication

`player_intoxication` (migration 224) tracks blood_alcohol 0..1. Decay rate
~0.15/hour. `drink(db, userId, strength)` adds 0.1 × strength. Combat
accuracy modulated via `getCombatAccuracyMultiplier(bac)`:
- 0–0.1   → 1.00 (sober)
- 0.1–0.3 → 0.95 (buzzed)
- 0.3–0.6 → 0.80 (drunk)
- 0.6+    → 0.50 (stumbling)

Routes: `POST /api/intoxication/drink`, `GET /api/intoxication/me`.

### X5 — Riding double

`mount_riders` (migration 224) lets two players share a mount. Primary
rider steers; secondary contributes stamina. Schema:
```sql
mount_riders(mount_id PK, primary_user_id, secondary_user_id, mounted_at, passenger_joined_at)
```

### Other immersive bits

- `tracking_skill_xp` table — tracking-skill XP for footprint reveal mechanic.
- `letter_delivery_queue` — sealed letters delivered with deliberate delay (atmospheric variant of Phase U1 mail).

## Operational invariants

See CLAUDE.md "Key Invariants" → "MMO sprint invariants" for the
load-bearing contracts:
- Mail attachments transfer is single-transaction.
- Auctions extend by 60s on snipe.
- Achievement unlocks are idempotent on (user_id, achievement_id).
- Diseases never cross worlds.
- Faction reputation is cached, refreshed every ~15min.
- LFG cancels prior-open in same world.
- Party leadership transfers to earliest joiner on leader leave.

## Rollout switches

Each substantive feature ships behind an env flag so revert is instant:

| Flag | Default | What it controls |
|------|---------|------------------|
| `CONCORD_MAIL_ENABLED` | true | Mail expiry sweep |
| `CONCORD_LFG_ENABLED` | true | LFG expiry sweep |
| `CONCORD_AUCTION_HOUSE` | true | Auction settler heartbeat |
| `CONCORD_DISEASE_ENGINE` | true | Disease tick + plague watch heartbeats |
| `CONCORD_INTOXICATION` | true | Drink endpoint (gates the feature, not the table) |

Set to `false` (or `0`) to disable. The runtime check is per-heartbeat,
so flipping mid-session takes effect on the next tick.

## Verification

After deploying:
1. `npm test` — target ~22,000+ pass with the new phase tests.
2. `./scripts/preflight-production.sh` — should pass with all 5
   content/achievements/*.json and 4 content/diseases/*.json files
   parsing cleanly.
3. Manual: log in as User A, send mail to User B with a COD attachment.
   User B's friends panel surfaces the unread badge; claim flow
   debits B's wallet by COD amount, credits A.
4. Manual: create an auction with `buyoutCc`. Another user buys out.
   Settle fires `auction:settled` → seller gets 95% payout, ledger
   shows `auction_credit` row.
5. Manual: in `tunya`, contract `river-fever` on yourself via the
   admin endpoint. DiseaseStatusHUD shows the icon. Wait 5 ticks; the
   `disease-tick-cycle` heartbeat advances severity. Apply
   `river-fern_poultice` cure recipe; severity drops; below 0.02 →
   recovered + immunity row inserted.
6. Manual: post LFG as healer in tunya. Another user clicks invite.
   They get an auto-created party; you get a `party:invite-received`
   socket event; PartyPanel updates without refresh.
