# MOVES

**Status:** PARTIAL (named arts fire a real hitscan / lunge / heal)  
**Authority:** Concord  
**Source:** `Canon.StyleDef` light/heavy/special/power; Unity `ConcordiaPlayer.TrySpecial`

## LIVE

Named arts: Palm, Flower-step, Ash cut, Unburial, Reed, Ward-blade, Switch, Pulse, Dust sprint, Mercy shock, Shard, Un-end, Invoice, etc.

LMB / F / G each call the world's `light` / `heavy` / `special`. G is no longer toast-only: it spends stamina, plays the slash, and runs a hitscan (plus the world's extra — heal, poise restore, curse fold, lunge, revive). Flower-law still kills the art as flowers. `SkillLedger` records the art name.

## TARGET

Moves are compositions (baseMotion + weapon + stance + timing + affinity). Concord simulates legality before accept. Emergent faction doctrine is a long-term target — never fake with announcements.

## Gap

No Move schema, no validation sim, no player-authored Ember Step.
