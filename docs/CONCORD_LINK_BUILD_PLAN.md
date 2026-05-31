# The Concord Link — Build Plan (execution)

Companion to the Concord Link spec. The spec is the *design*; this is the
*code-verified, phased execution*. Every reuse claim below was checked against the
working tree first.

**Kill-switch:** `CONCORD_LINK_SYSTEM` (default off until parity with today's
scattered HUD is proven; today's HUD is the fallback when off — byte-for-byte).

---

## Context

The player-facing systems (status, skills, inventory, effects, environment, codex)
are real but **scattered and headless** — resource bars in one component, effects
in another, the Layer-7 environment substrate read by *nothing* player-facing. The
Link unifies them into one diegetic shell narrated in Concord's voice: it **is**
the HUD (glance), the menu (summon), and a private workshop (sanctum). The build
is **wiring + skinning existing substrate, not inventing systems** — which is why
this is a frontend plan riding on a backend that the audits have been hardening.

---

## Verified reuse (the substrate exists)

| Spec claim | Verified |
|---|---|
| Layer-7 environment signals | ✅ `server/lib/embodied/signals.js#signalsForWorld` |
| Layer-7.5 skill×env potency | ✅ `server/lib/embodied/skill-environment.js#elementalEnvBoost` |
| Cross-world potency | ✅ `server/lib/cross-world-effectiveness.js#effectivenessMultiplier` |
| Refusal-field tonal driver | ✅ `server/lib/refusal-field.js#computeFieldComposition` (`isCompoundRefusal` ≥6) |
| Concord voice | ✅ `server/lib/prompt-registry.js` `BRAIN_IDENTITY.conscious` |
| Zone danger tier | ✅ `server/lib/world-zones.js#combatRuleFor` (hub → `combatAllowed:false, reason:'concordant_law'`) |
| Instance-only time | ✅ `concord-frontend/lib/concordia/use-time-scale.ts#setTimeScale` (PhotoMode/party-combat only) |
| Resource bars / effects / inventory | ✅ `player_resource_bars`, `user_active_effects`, `player_inventory` |

## Dependency status — the spec's blocking audit bugs

The spec correctly flags that its data-bearing panes need the schema-drift fixes.
Status after this session's repair pass:

| Dep | Pane it gates | Status |
|---|---|---|
| #V2 `world_visits.entered_at` | Environment (dive/visit reads) | ✅ **fixed** (schema-drift batch 5) |
| `refusal_field`→`refusal_fields` (#V13) | NPC-bleed / tonal redaction | ✅ **fixed** (schema-drift batch 1) |
| `npc_relations` (#V14) | NPC-bleed (spouse/kin) | ✅ **table created** (migration 315) |
| cross-world effectiveness wrong modulator key (#14) | Environment cross-world potency | ⚠ **open** — logic bug in `cross-world-effectiveness.js` (reads `skill_affinity` instead of `skill_effectiveness_rules`); NOT a schema-drift, tracked separately |
| #11 ghost-fleet dead macros | Codex (quest/agents reads) | ⚠ **open** — Gate B logs it; fix is the registration race |

→ **The Glance/Summon/Status/Inventory/Effects/Sanctum/Tonal slices are unblocked
now.** Only the Environment-cross-world readout and the NPC-bleed Codex reads wait
on the two open items above.

---

## The one non-negotiable invariant: NO global time manipulation

Concordia is a shared real-time world. **SUMMON must never alter the global tick.**
Time-scale ≠ 1 is permitted ONLY inside a single-occupant instance (Sanctum) or a
`party_combat_sessions` instance — the rule the engine already encodes. The opener
stays live and vulnerable in the shared world (Dead-Space / WoW-bag rule); safety
comes from *where you stand* (`combatRuleFor` zone tier), not from pausing.

---

## Build order (each slice behind `CONCORD_LINK_SYSTEM`, tested)

1. **Glance = HUD.** Re-home the existing resource bars + notifications into
   `components/world/concord-link/LinkGlanceLayer.tsx` with the glyph-frame chrome
   + idle motion. **No behavior change — pure re-skin + diegetic justification.**
2. **Summon shell + Status/Inventory/Effects panes** (`LinkShell.tsx` + mode state
   machine). Client overlay; world keeps ticking; avatar vulnerable. Reads
   `player_resource_bars` / `player_inventory` / `user_active_effects`.
3. **Environment pane** — `lib/concord-link/environment-affinity.ts` cross-refs
   `signalsForWorld` × skill affinities (`elementalEnvBoost`) + cross-world
   potency. *Wait on the cross-world-effectiveness key fix for the potency row.*
4. **Forge pane** — mount the Move Builder + `glyph-spells`/`skill-evolution`/
   `skill-fusion`. (Depends on the move-system plan.)
5. **Sanctum instance** — personal-instance entry reusing the party-combat instance
   + `setTimeScale` (the ONLY place calm/slow is real).
6. **Tonal skin** — `link-tone.ts`: warm (high `concordia_alignment`) / cold
   (default) / redacted (`isCompoundRefusal` ≥6), driven by alignment + refusal-field.
7. **NPC-bleed** — surface scheme-overhear / nemesis / hooks through the Link
   grammar. (Depends on #11 + the now-created `npc_relations`/`authored_npcs`.)
8. **Onboarding boot** — the Lamplighter + Concord first-boot sequence; wires into
   `FirstWinWizard` / `onboarding.json` / `/api/onboarding/*`.

Phases 1–2 + 5–6 are unblocked today; 3 and 7 ride on the two open audit items.

---

## Verification
- **No-pause (critical):** a regression test asserts SUMMON calls no global
  time-scale/world-pause; the heartbeat keeps ticking; the opener can take damage
  with the Link open. **Instance-only:** time-scale ≠ 1 is asserted to occur only
  on the Sanctum/party-instance path, never the shared-world path.
- **Glance = sole persistent layer:** with the kill-switch on, audit the render
  tree — no non-diegetic UI outside the Link glance.
- **Pane data parity:** each pane returns the same data as today's scattered
  surface (Status == old stats; Inventory == `player_inventory`; …).
- **Environment correctness:** affinity readout matches `elementalEnvBoost` for the
  cell's live signals; cross-world potency matches `effectivenessMultiplier`.
- **Tonal skin:** refusal ≥6 → redaction; high Concordia favor → warm; else cold.
- **Kill-switch off → today's behaviour, byte-for-byte.**

**Sandbox note:** this is a browser-rendered UI; true runtime verification needs a
browser (chromium is blocked here — see playtest #F2). Headless-verifiable parts:
the `environment-affinity` cross-reference (unit-test against `elementalEnvBoost`),
the tonal-state state machine (pure, test against alignment+refusal inputs), and
the no-pause invariant (assert the shared-world path never calls `setTimeScale`).
