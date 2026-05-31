# Vael's Expedition IV (the long trek) — new classes: concurrency · realtime · dynamic-SQL · logic-correctness — Sun May 31 22:04:36 UTC 2026

## Verified CORRECT (honest negatives — the engine's math is sound)
- skill-progression `computeLevelFromExperience` matches doc `1+floor(sqrt(exp/2))` exactly; XP rates correct (cross_world 1.5x).
- royalty cascade: first-derivative 0.105 is INTENTIONAL (e2e asserts calculateGenerationalRate(1); 0.21 is a gen-0 anchor). Halving + 0.0005 floor + depth-50 + 0.30 cap all correct.
- wager payout = pot - ceil(pot*0.02): 2% fee, correct.

**#L1 (minor) — wager fee is regressive on tiny pots.** `fee = Math.ceil(pot*0.02)` floors at 1, so a
1+1=2cc pot pays a 1cc fee = 50% effective rate; 10cc pot = 10%. Only ~2% at pots ≥50. Cosmetic but
real for low-stakes duels.

## Wave 18 — identifier-injection via user-controlled SQL interpolation [HIGH / security]

**#L2 — Skill `resource_bar` is interpolated raw into an UPDATE column position (injection + crash).**
routes/worlds.js:2131 `const barType = skillData.resource_bar || 'stamina'` — taken verbatim from a
user/LLM-authored skill DTU's `data` JSON, NO whitelist — then passed to
`consumeResourceBar` → lib/combat/damage-calculator.js:258
`UPDATE player_resource_bars SET ${barType} = ${barType} - ?, updated_at=unixepoch() WHERE ...`.
better-sqlite3 does NOT parameterize identifiers, so:
  (a) CRASH: any resource_bar that isn't one of {hp,mana,stamina,bio_power,perception} → `no such
      column` → the skill is uncastable (note `health`/`stardust`-style names look valid but the
      column is `hp`).
  (b) INJECTION: a crafted resource_bar (e.g. `mana = 99999, stamina = 99999`) rewrites the SET
      clause → free-resource cheat / arbitrary column writes scoped to the caster. The value is
      attacker-controlled because players author skills. Fix: whitelist barType against the known
      column set before interpolation.

## Long-trek synthesis — what the deep interior actually holds
This expedition deliberately left the (already-mapped) schema-drift continent and probed the core:
**concurrency, money math, SQL injection, dynamic SQL, event contracts.** Result: the core is
overwhelmingly SOUND — with ONE serious exception.

NEW findings: #L1 (minor — wager `Math.ceil` fee regressive on tiny pots) and **#L2 (HIGH — SQL
identifier injection + crash via user-authored skill `resource_bar`).**

Honest negatives (each verified, NOT bugs — high-value because they bound the risk):
- Skill XP curve `1+floor(sqrt(exp/2))` exact; XP rates correct.
- Royalty cascade correct (first-derivative 0.105 is intentional per e2e; halving/floor/cap all right).
- Concurrency: synchronous better-sqlite3 in one process serializes check-then-write; no TOCTOU in the
  sampled economic paths.
- Dynamic `${filter}` SQL is parameterized (hardcoded clause + bound `?`); no injection there.
- `SET ${sets.join()}` builders (foundry, thread-manager, city-engine) use hardcoded column literals /
  fixed key sets — safe.
- recent/mine helper uses real columns (`creator_id`/`type` on dtus).
- Live event-shape validator: ZERO violations during the session (events that fired conform).

Bottom line: rounds 1-3 found a large but BOUNDED bug mass (one root cause: schema-rename drift + a
few wiring gaps). Round 4 confirms the engine's core logic, money, and concurrency are trustworthy —
so the single highest priority shifts from "count more drift" to "fix #L2 (injection) + ship the SQL
schema CI gate that retires the entire drift class."
