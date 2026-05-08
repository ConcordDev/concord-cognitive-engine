// server/scripts/cartographer/novelty-tags.js
//
// Hand-curated list of Concord-unique substrate inventions. These are
// the things that don't exist anywhere else and form the moat. Cartographer
// uses this list to seed NOVEL.md candidates; the file itself is committed
// prose (humans curate post-seed).
//
// Tag levels:
//   high   — fully unique to Concord (no prior art at scale)
//   medium — Concord composition of partially-known primitives in a way
//            that's distinctive

export const NOVELTY_TAGS = [
  // ── Foundational substrate ──────────────────────────────────────────────
  { moduleId: "dtu-store",
    file: "server/lib/dtu-store.js",
    tag: "high",
    title: "DTU substrate (4-layer self-compressing knowledge units)",
    reason: "No other system combines (a) 4-layer human/core/machine/artifact shape, (b) auto MEGA→HYPER consolidation at population thresholds, (c) citation-cascade royalty economy on top." },

  { moduleId: "refusal-field",
    file: "server/lib/refusal-field.js",
    tag: "high",
    title: "Refusal Field (base-6 glyph algebra for ethics)",
    reason: "Time-bounded gates over death/harvest/hostility/consequence/numbers/dome/win, composed via base-6 glyph algebra. Strength≥6 = compound refusal that overrides world signals." },

  { moduleId: "royalty-cascade",
    file: "server/economy/royalty-cascade.js",
    tag: "high",
    title: "Citation cascade with halving royalties",
    reason: "Perpetual royalty with depth-aware decay (initial 21%, halving every 2 hops, floor 0.05%). Cascade cap 30% of sale, seller keeps ≥64.54%." },

  // ── Cognition layer ────────────────────────────────────────────────────
  { moduleId: "brain-router",
    file: "server/lib/brain-router.js",
    tag: "high",
    title: "Five-brain LLM router (4 cognitive + LLaVA vision)",
    reason: "Conscious / Subconscious / Utility / Repair / Vision routed by domain priority + circuit breakers + queue depth. Distinct from MoE — these are full models, hot-swappable, dispatched by reasoning class." },

  { moduleId: "hlr-engine",
    file: "server/emergent/hlr-engine.js",
    tag: "high",
    title: "HLR — 7-mode reasoning engine",
    reason: "Deductive / inductive / abductive / adversarial / analogical / temporal / counterfactual reasoning surfaced as a unified `runHLR(input)` macro with reasoning-trace persistence." },

  { moduleId: "hlm-engine",
    file: "server/emergent/hlm-engine.js",
    tag: "high",
    title: "HLM — lattice topology mapping",
    reason: "Cluster analysis, gap analysis, redundancy detection, orphan rescue, freshness check across the entire DTU corpus on a 20-min interval." },

  { moduleId: "drift-monitor",
    file: "server/emergent/drift-monitor.js",
    tag: "high",
    title: "Drift monitor (6 contradiction classes)",
    reason: "Goodharting / memetic_drift / capability_creep / self_reference / echo_chamber / metric_divergence detection on the corpus." },

  { moduleId: "breakthrough-clusters",
    file: "server/emergent/breakthrough-clusters.js",
    tag: "high",
    title: "Cross-domain synthesis (breakthrough clusters)",
    reason: "Research clusters that pull DTUs across domain boundaries and produce synthesis candidates with provenance." },

  // ── World / experiential ──────────────────────────────────────────────
  { moduleId: "embodied-signal",
    file: "server/lib/embodied/signals.js",
    tag: "high",
    title: "Embodied signal substrate (Layer 7)",
    reason: "Per-cell sensory-OS readings (thermal, chemical, sight, sonic, tactile_force) as world physics. Recency-weighted folding; bidirectional skill ↔ environment coupling in Layer 7.5." },

  { moduleId: "skill-environment",
    file: "server/lib/embodied/skill-environment.js",
    tag: "high",
    title: "Env-coupled skills (bender wedges, DBZ stagger, Geo-Mod-light)",
    reason: "Frost stronger in cold cells; fire weaker in storms; physical-aligned harvest yield 1.5× from stone; high-magnitude hits project targets into buildings → stagger + structural stress. Pokemon types are static lookup tables; nobody else does live bidirectional environment-power coupling." },

  { moduleId: "embodied-pain",
    file: "server/lib/embodied/pain.js",
    tag: "high",
    title: "Repair-pain coupling (Layer 8)",
    reason: "Asymmetric somatic ledger keyed by user×region×source. Combat hits → endurance/strength/agility/vitality/focus XP via region taxonomy + damage_resist buff via repair-cycle heartbeat." },

  { moduleId: "embodied-dream",
    file: "server/lib/embodied/dream-engine.js",
    tag: "high",
    title: "Embodied dream cycle (Layer 9)",
    reason: "Per-player offline dream-composition from 12h activity window. Distinct from system-level 6-phase substrate dream cycle (which runs on the global DTU corpus). Two layers of dreaming." },

  { moduleId: "forward-sim",
    file: "server/lib/embodied/forward-sim.js",
    tag: "high",
    title: "Subconscious forward-sim anticipation (Layer 10)",
    reason: "Per-user speculative predictions with confidence + realisation tracking. The world thinks about you while you're offline." },

  { moduleId: "faction-strategy",
    file: "server/lib/embodied/faction-strategy.js",
    tag: "high",
    title: "Faction emergent strategy state machine (Layer 11)",
    reason: "Deterministic 6-stance state machine + relations + 8 move types. Factions act when nobody's watching." },

  { moduleId: "lattice-orchestrator",
    file: "server/emergent/lattice-orchestrator.js",
    tag: "medium",
    title: "Wire-the-unwired pattern",
    reason: "Lazy-import + try/catch + return `{ ok, reason }` template. Activates dormant emergent modules without modifying them." },

  // ── Substrate pieces of broader interest ─────────────────────────────
  { moduleId: "concord-mesh",
    file: "server/lib/concord-mesh.js",
    tag: "high",
    title: "7-transport mesh network",
    reason: "Internet/WiFi/BLE/LoRa/RF-Ham/Telephone/NFC routing for DTU frames. Federation primitive that survives infrastructure collapse." },

  { moduleId: "cnet-federation",
    file: "server/emergent/cnet-federation.js",
    tag: "high",
    title: "Concord-net federation protocol",
    reason: "Peer-discovery + DTU-flow protocol with consent flags + subscription routing. Federated cognition without centralized control." },

  { moduleId: "council-voices",
    file: "server/emergent/council-voices.js",
    tag: "medium",
    title: "5-voice council (skeptic / socratic / opposer / idealist / pragmatist)",
    reason: "Multi-voice deliberation surfaced as DTU promotion gate. Closer to Mahoney's deliberative ensembles than to LLM debate." },

  { moduleId: "evo-asset",
    file: "server/lib/evo-asset/registry.js",
    tag: "high",
    title: "EvoAsset evolution",
    reason: "Gameplay-derived assets (creatures, tools, skills, drops, species) auto-refine through engagement with verified promotion." },

  { moduleId: "concordant-web",
    file: "server/lib/content-seeder.js",
    tag: "medium",
    title: "Concordant Web (cross-world authored canon)",
    reason: "8 cross-world major characters + 3 factions + Concordant Law + Sovereign Refusal Archive. Authored substrate that worlds inherit." },
];
