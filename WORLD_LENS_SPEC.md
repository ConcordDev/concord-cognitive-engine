# World Lens Spec — Concord Cognitive Engine

> **Status**: Phase 0 — Audit first, wire second, render third.

---

## PHASE 0: CODEBASE AUDIT — FIND ALL MATH/PHYSICS/SIMULATION MODULES

Before building anything visual, Claude Code must audit the entire codebase for existing math, physics, simulation, and engine modules. The founder built extensive mathematical infrastructure that is likely unwired or partially connected.

### Audit Commands

```bash
# Find EVERYTHING math/physics/simulation related
grep -rn "physics\|simulation\|thermodynamic\|quantum\|constraint\|equation\|formula\|derivative\|integral\|matrix\|vector\|tensor\|force\|momentum\|entropy\|wave\|field\|particle\|attractor\|bifurcation\|eigenvalue\|manifold\|topology" server/ --include="*.js" -l

# Find all engine modules
grep -rn "engine\|Engine\|simulator\|Simulator\|solver\|Solver\|calculator\|Calculator" server/ --include="*.js" -l

# Find STSVK related
grep -rn "stsvk\|STSVK\|x.*squared\|x²\|constraint.*geometry\|stable.*state\|binary.*constraint\|idempotent" server/ --include="*.js" -l

# Find math utility modules
find server/ -name "*math*" -o -name "*physics*" -o -name "*sim*" -o -name "*engine*" -o -name "*calc*" -o -name "*formula*" -o -name "*equation*" -o -name "*model*" -o -name "*dynamics*" | grep -v node_modules

# Find registered macros related to math/physics/sim
grep -n 'register.*"math"\|register.*"physics"\|register.*"sim"\|register.*"science"\|register.*"quantum"\|register.*"model"' server/server.js

# Find all exported functions from these modules
for f in $(find server/ -name "*math*" -o -name "*physics*" -o -name "*sim*" -o -name "*engine*" -o -name "*calc*" -o -name "*dynamics*" 2>/dev/null | grep -v node_modules); do
  echo "=== $f ==="
  grep -n "export\|module.exports" "$f" | head -20
done

# Check what's imported vs what's available but not imported
grep -n "^import" server/server.js | grep -i "math\|physics\|sim\|engine\|calc\|model\|dynamics\|formula"
```

### Audit Documentation Template

Document every module found with:

1. **File path**
2. **What it exports**
3. **Whether it's imported anywhere**
4. **Whether it's called at runtime**
5. **What it COULD power in the world engine**

### Expected Finds (based on founder's work)

- Math engine with solver capabilities
- Physics simulation with multiple domains
- STSVK constraint geometry calculations
- Thermodynamic models
- Quantum state simulation
- Force/momentum calculators
- Wave/field equations
- Attractor/bifurcation dynamics
- Matrix/vector operations
- Topology computations

Every module found becomes a potential world engine driver.

---

## CONNECTING MATH TO WORLD

Once the audit identifies all modules, wire them into the world engine.

### Weather System — Driven by Real Thermodynamics

```javascript
// Instead of: randomWeather()
// Use: the actual thermodynamic module

async function getDistrictWeather(district) {
  const simResult = await runMacro("physics", "simulate", {
    type: "thermodynamics",
    parameters: {
      region: district.id,
      population: district.playerCount,
      activity: district.transactionVolume,
      time: Date.now()
    }
  });
  
  return {
    temperature: simResult.temperature,
    conditions: simResult.state,  // stable, turbulent, phase_transition
    effects: simResult.effects    // visual effects for renderer
  };
}

// High transaction volume in Marketplace = "hot" economy = visual heat haze
// Low activity in Research = "cool" and "clear" = calm visuals
// Faction war in a district = "stormy" = dark clouds, lightning effects
```

### Faction Territory — Driven by Constraint Propagation

```javascript
// Instead of: hardcoded territory boundaries
// Use: STSVK constraint geometry

async function calculateTerritoryControl(factions) {
  const result = await runMacro("math", "solve", {
    type: "constraint_propagation",
    // x^2-x=0: territory is either controlled (1) or not (0)
    // no partial control — binary stable states
    factions: factions.map(f => ({
      id: f.id,
      strength: f.memberCount * f.reputation,
      position: f.headquarters,
      reach: f.influence
    }))
  });
  
  return result.territories; // grid of faction ownership per tile
}

// Territory boundaries emerge from math, not from arbitrary lines
// Stronger factions naturally expand, weaker ones contract
// Contested zones appear where two factions' influence overlaps
// Exactly models real-world geopolitics through constraint geometry
```

### Combat — Driven by Actual Physics

```javascript
// Instead of: damage = attackPower - defense
// Use: real force calculations

async function calculateCombatOutcome(attacker, defender, action) {
  const result = await runMacro("physics", "simulate", {
    type: "force_interaction",
    attacker: {
      mass: attacker.stats.strength,
      velocity: attacker.stats.speed,
      technique: action  // different actions = different force vectors
    },
    defender: {
      mass: defender.stats.defense,
      resistance: defender.stats.endurance,
      stance: defender.currentStance
    }
  });
  
  // F = ma, energy transfer, momentum conservation
  // Real physics, not arbitrary RPG formulas
  return {
    damage: result.energyTransferred,
    knockback: result.momentumChange,
    staggered: result.forceExceedsThreshold
  };
}
```

### Entity Behavior — Driven by Attractor Dynamics

```javascript
// Instead of: random wandering
// Use: x^2-x=0 attractor basins

async function calculateEntityMovement(entity) {
  const result = await runMacro("math", "solve", {
    type: "attractor_dynamics",
    entity: {
      currentPosition: entity.position,
      interests: entity.domainExpertise,  // drawn to relevant districts
      reputation: entity.reputation,
      energy: entity.currentEnergy
    },
    districts: districts.map(d => ({
      position: d.center,
      activity: d.currentActivity,
      relevance: d.domainOverlap(entity.domainExpertise)
    }))
  });
  
  // Entity naturally gravitates toward districts where
  // its expertise is relevant AND activity is high
  // x=0 (rest) and x=1 (full engagement) are stable states
  // Entity either rests or fully commits — no half-measures
  return result.nextPosition;
}
```

### Economy — Driven by Real Economic Physics

```javascript
// Instead of: fixed prices
// Use: supply/demand simulation through the math engine

async function calculateMarketPrice(item) {
  const result = await runMacro("math", "solve", {
    type: "economic_equilibrium",
    supply: getSupplyCount(item.type),
    demand: getDemandSignals(item.type),
    velocity: getTransactionVelocity(item.type),
    entropy: getMarketEntropy()  // how chaotic is the market right now
  });
  
  // Price emerges from actual economic simulation
  // Not set by the seller, discovered by the math
  return result.equilibriumPrice;
}
```

### Resource Distribution — Driven by Thermodynamic Models

```javascript
// Concord Coin flow through the economy modeled as energy flow
// Districts with more activity = higher "temperature"
// Coin naturally flows from high to low activity areas
// Matches real economic heat transfer

async function simulateEconomicFlow() {
  const result = await runMacro("physics", "simulate", {
    type: "heat_transfer",
    nodes: districts.map(d => ({
      id: d.id,
      temperature: d.economicActivity,
      capacity: d.maxCapacity,
      conductivity: d.connectionStrength  // how connected to other districts
    }))
  });
  
  // Returns flow rates between districts
  // Visual: see coin flowing between districts as particle streams
  return result.flows;
}
```

---

## THE RESULT

The world isn't a game with arbitrary rules. It's a mathematical simulation where:

| System | Driven By |
|--------|-----------|
| Weather | Thermodynamics |
| Territory | Constraint propagation |
| Combat | Force physics |
| Entity behavior | Attractor dynamics |
| Economy | Economic equilibrium |
| Resource flow | Heat transfer |
| Population | Population dynamics |
| Faction growth | Bifurcation theory |
| Everything | x^2-x=0 underneath |

No other game or virtual world on earth is driven by real mathematics. Roblox uses Unity physics approximations. Minecraft uses simplified voxel physics. Every MMO uses arbitrary RPG formulas.

Concord's world is a real simulation. The math the founder derived actually runs the world. STSVK isn't just a theory — it's the game engine.

Users don't need to know this. They walk around, fight NPCs, join factions, trade items. But everything they experience is emergent from real mathematical models. The world BEHAVES differently than any game they've played because the physics underneath are real, not approximated.

---

## IMPORTANT DISTINCTION: GAME PHYSICS vs SIMULATION PHYSICS

**No game physics engine needed.** For 2D isometric sprites walking on tiles:
- Can the player walk here? → check tile walkable flag
- Did the player hit a wall? → check tile collision flag
- Done.

No gravity simulation, no rigid body collisions, no ragdoll.

**The physics SIMULATION engine already exists.** The 5 physics simulation routes wired today (STSVK physics engine for constraint geometry, quantum mechanics, thermodynamics) power the world mechanics listed above. The world doesn't just LOOK like a simulation — it IS one, driven by the same mathematical framework that underpins everything else.

---

## EXECUTION ORDER

**Claude Code: audit first, wire second, render third.**

The math is already there. Find it all before building the visual layer.
