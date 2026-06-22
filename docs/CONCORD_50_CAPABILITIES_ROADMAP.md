# Plan — Concord "50 Capabilities" Program: audit + connective architecture (LRL as hub)

## Context

The user enumerated 50 desired capabilities across 9 categories (metacognition,
agentic, scientific, embodiment, synthetic worlds, economy, ethics/governance,
multimodal, infra) and asked to "make sure all this is in there and connected" +
audit + research best practices. A 3-agent codebase audit + 2026 best-practice
research is complete. **Decisive finding: ~70% already exists as real code; the job
is mostly CONNECTING (wiring dead code + making the just-shipped Literary Resonance
Lattice the cross-domain hub + adding 1–2 orchestrators), not building from scratch.**

User decisions: **(1) deliver the full 50-feature program as a roadmap doc** (audit
matrix + dependency order + effort tiers; most items stay specs, not execution-ready
steps); **(2) flagship = LRL as the cross-domain hub** — lead by making the Literary
Resonance Lattice the connective tissue between subsystems.

This doc is the map. Each tier names the existing files to reuse and the genuine gap.

---

## 🟢 Build progress (live — branch `claude/concord-50-capabilities`)

The connective core has been BUILT, not just specced. Each item below shipped with
a migration/lib/domain + offline tests, and the global gates stay green
(`check-doc-claims` 13/13, `schema-drift` 0 violations, detector ratchet PASS):

- **#21 Private R&D Engine (Tier-2 flagship) — DONE.** `domains/rnd.js` chains the
  previously-unreachable FEA solver + CAS + causal-closure + hypothesis engine with
  LRL grounding into one verifiable loop (`rnd.run`). Wires Tier-0 #16/#17/#18/#19.
  `emergent/hypothesis-cycle.js` gives the hypothesis engine a clock.
- **Tier-1 LRL-as-hub — DONE.** Unified resonance+citation graph for GraphView
  (#46/#35, `literary.resonance_graph`), narrative grounding (#30, `narrative-bridge`
  literary echo), resonance salience feeding consolidation (#8, `literary.salience`).
- **#5 Cognitive Fingerprint — DONE.** `lib/cognitive-fingerprint.js` +
  `metacog.fingerprint[_history]` + snapshot heartbeat (mig 339). Thinking-style
  profile from real activity only.
- **#3 Cognitive Replay — DONE.** `lib/cognitive-replay.js` + `metacog.replay` —
  grounded "thinking Wrapped" over real `agent_reasoning_traces`.
- **#10 Persistent Goal Decomposition — DONE.** `lib/goal-decomposition.js` +
  `domains/decomp.js` + mig 340. Durable subgoal tree; root mints a DTU; status
  rolls up as leaves complete.
- **#14 Long-Horizon Planner — DONE.** `lib/long-horizon-planner.js` +
  `domains/planner.js` + mig 341 + `plan-horizon-cycle` heartbeat. Time-phased
  milestones + contingencies on the goal tree.
- **#12 Shadow Reasoning Council — DONE.** `lib/shadow-council.js` + `reason.council`
  — five-voice deliberation that mints a citable `shadow_reasoning` DTU preserving
  the dissent a flat vote discards.
- **#36 Contribution Quests — DONE.** `lib/contribution-quests.js` +
  `domains/contrib.js` + mig 342. Completion MEASURED from real authored DTUs;
  reward mints through the earned-CC path, idempotent.
- **#43 Music Resonance (Tier-1 second corpus) — DONE.** `lib/music-resonance.js`
  + `domains/musicres.js` + mig 343. "Music as a literary corpus": ingest
  user-authored/PD/CC tracks (DTU per section + FTS5), hybrid-search them with the
  same BM25+dense pipeline as the literary lattice (honest `semantic` flag), and
  `musicres.bridge` cross-links a lyric to the public-domain passage it resonates
  with — making the LRL genuinely cross-domain (two corpora bridged).

**Remaining (specs in the tiers below):** #37 license revocation (economy-core,
needs care), #9 swarm orchestration, #20 invariant viz, #40 HDC/VSA upgrade, #41
governance sim, #45 style transfer, #49 holocron agent, #38 federated brain, #15
voice+affect fusion. Tier-5 hardware/external (#23/#29/#44/#27) stays deferred.

---

## Audit matrix — all 50 (verdict · file · wired? · LRL link)

Legend: ✅ EXISTS+wired · ⚙️ BUILT-but-DEAD/lib-only (wire-the-unwired win) · 🟡 PARTIAL · ❌ MISSING

**1. Metacognition**
1. Ghost Threads — ⚙️ `emergent/ghost-threads.js` (472L, `runGhostThread`/`surfaceInsight`, **0 server.js refs**). LRL's `lib/literary-resonance.js#computeResonanceForDtu` is the *live* superset — retire or merge.
2. Substrate Dreams 6-phase — ✅ `emergent/dream-cycle.js#runDreamCycle` (replay/consolidate/connect/predict/heal/compose).
3. Cognitive Replay — 🟡 mig 327 `agent_reasoning_traces` (records) + `lib/causal-closure.js`; no forward replayer/"Wrapped" view.
4. Selective Forgetting — ✅ `emergent/forgetting-engine.js` (retentionScore + 9 protection rules), heartbeat-wired.
5. Cognitive Fingerprint — 🟡 mig 326 `affect_trace_temperament`; no time-series bias/accuracy ledger.
6. Meta-Derivation — ✅ `emergent/meta-derivation.js` (1148L, `runMetaDerivationSession`), wired.
7. Dream-from-Real-Activity — ✅ `emergent/embodied-dream-cycle.js` + `lib/embodied/dream-engine.js#gatherFragments` (freq 80).
8. Consolidation Scheduler — ✅ `server.js:31290` + `economy/dtu-pipeline.js#compressToDMega/Hyper`. **Gap: keys on tier/lineage, NOT resonance — Tier-1 LRL upgrade.**

**2. Agentic**
9. ConKay Multi-Agent Swarms — 🟡 `domains/agents.js#swarmStatus/routeTask` (meta only); no real orchestration loop.
10. Persistent Goal Decomposition — 🟡 mig 171 `agent_marathon_sessions` + `emergent/agent-marathon-cycle.js` (state blob, no goal tree).
11. Initiative Engine v2 — ✅ `lib/initiative-engine.js` (1491L, 7 triggers, rate-limits, quiet hours), freq-60 heartbeat.
12. Shadow Reasoning Council — 🟡 `emergent/council-voices.js` (5 voices) + `reason.verify`; votes only, no shadow-reasoned DTU.
13. Skill Forge / Glyph Spells — ✅ `lib/glyph-spells.js#composeSpell` + `lib/forge-template-generator.js` (1579L), `/api/forge/*`.
14. Long-Horizon Planner — 🟡 `lib/embodied/forward-sim.js` (predictions ≥4h apart, not multi-day plans w/ contingencies).
15. ConKay Voice + Affect — 🟡 `lib/voice/voice-pipeline.js` (STT/TTS/VAD) + affect trace; not fused into ConKay persona.

**3. Scientific**
16. Causal-Closure Analyzer — ⚙️ `lib/causal-closure.js` (420L, ridge fit + residual; underfit/overfit ladder); lib-only.
17. Hypothesis Engine — ⚙️ `emergent/hypothesis-engine.js` (639L, proposed→testing→confirmed→rejected); ~no live path.
18. Residual Analysis — 🟡 inside `causal-closure.js`; not integrated with sim/FEA.
19. Experiment Simulator (Concordia) — ⚙️ `lib/simulation/fea-solver.js` (380L, Direct Stiffness 2D/3D) + `lib/compute/symbolic-math.js` (832L CAS); **0 driver/macro/lens**.
20. Invariant Geometry Mapper — 🟡 `emergent/atlas-invariants.js` (asserts+logs metrics); no visualization.
21. **Private R&D Engine — ❌ the orchestrator that unifies #16+#17+#19 CAS/FEA + grounded LLM + LRL. The moat. Tier-2 flagship build.**

**4. Embodiment**
22. Physical DTU Layer — ✅ `lib/embodied/signals.js` + mig 112–114 (`embodied_signal_log`, 7 channels), wired.
23. Signal Tomography / Mesh CT — ❌ no 3D voxel reconstruction.
24. Embodied Dream Cycle — ✅ (= #7).
25. Sensor Fusion Lens — ✅ `concord-mobile/src/foundation/sensors/sensor-manager.ts` (BLE/WiFi/GPS, privacy-first).
26. Action-to-DTU Bridge — ✅ `lib/gameplay-asset-bridge.js` → evo_assets → DTUs.
27. Robotics / Exo-suit — 🟡 `domains/robotics.js` (21 macros, in-memory only; no DTU genesis).

**5. Synthetic worlds**
28. WebXR Holodeck — ✅ `components/world-lens/ARPreview.tsx` + `EnterVRButton.tsx` (real immersive-ar, honest fallback).
29. Unreal 5 Bridge — ❌ (only the Three.js UnrealBloomPass; no engine bridge).
30. Narrative World Builder — 🟡 `lib/content-seeder.js` + `oracle-brain.js` + `narrative-bridge.js`; **LRL read-path exists but isn't fed back into quest/dialogue compose — Tier-1 LRL hook.**
31. NPC Consciousness — ✅ `lib/npc-autobiography.js` + `npc-asymmetry.js` (DTU memory + dream co-authorship).
32. Black Market / Faction Economy — ✅ `domains/black-market.js` + `lib/embodied/faction-strategy.js` (freq 200).

**6. Economy**
33. Concord Coin — ✅ `economy/balances.js` (CREDIT_ROW_PREDICATE) + `coin-service.js#mintCoins`.
34. P2P DTU Marketplace — ✅ `economy/creative-marketplace.js#purchaseWithRoyalties`.
35. Royalty Cascade Visualizer — 🟡 backend `economy/royalty-cascade.js` real; **no `/api/royalty/graph` → GraphView — Tier-1 viz hook (shares GraphView w/ #46).**
36. Contribution Quest — 🟡 `domains/bounties.js` + quest-engine; minimal wiring.
37. Licensed DTU Vaults — 🟡 `economy/license-tiers.js` (purchase ok) + `personal-locker` (AES-GCM); revocation missing.

**7. Ethics/governance**
38. 6th Brain / Federated Lattice — 🟡 5 brains `brain-config.js` + `emergent/cnet-federation.js` + mig 170 BYO; no consented federated model.
39. Refusal Field + Value-Drift — ✅ `lib/refusal-field.js` + `emergent/drift-monitor.js` + `agent-drift-watch-cycle.js` (mig 330).
40. HDC/VSA Ethics Hypervectors — 🟡 base-6 glyph algebra (`lib/refusal-algebra/operations.js`); not true HDC/VSA (see research → "Holographic Invariant Storage").
41. Governance Proposal Simulator — ❌ mig 138 schema only; no world-fork sandbox.
42. Shadow Ethics Council — 🟡 `emergent/council-session-cycle.js` runs; no policy-impact simulation.

**8. Multimodal**
43. Music Resonance Lens — 🟡 `domains/music.js` (101 macros) keyword-only; **no embeddings — reuse the LRL ingest/search pattern wholesale (Tier-1 LRL clone).**
44. Vision + Haptic — 🟡 Vision real (`lib/vision-inference.js`, LLaVA/Qwen-VL); Haptic ❌.
45. Style Transfer Across Domains — ❌.
46. Generative Art from DTU Resonance — 🟡 `components/atlas/GraphView.tsx` real; **doesn't ingest `literary_resonance_edges` yet — Tier-1 LRL hook.**

**9. Infra**
47. Mesh Federation v2 — 🟡 `emergent/cnet-federation.js` + `dtu-portability.js` (one-peer); multi-hop mesh not done.
48. Self-Auditing Expansion — ✅ 37 detectors `lib/detectors/*` + `run-detectors.js` + repair cortex.
49. Holocron / Personal Archive Agent — 🟡 `personal-locker` vault real; no gatekeeper persona agent.
50. Connector Agnostic Core — 🟡 `lib/connector-client.js#connectorFetch` (SSRF-guarded) + Gmail/Calendar real; Slack/Notion/GitHub/Sheets scaffolded.

**Tally:** ✅ ~20 · ⚙️ ~6 (cheap wins) · 🟡 ~17 · ❌ ~7.

---

## Connective architecture (the "essentially connected" thesis)

Four already-present spines carry everything; "connected" = routing the 50 through them:
1. **DTU lattice** (`dtus` + `createDTU` + embeddings + CRETI + MEGA/HYPER) — the universal substrate every feature mints into.
2. **LRL = the cross-domain hub** (just shipped): `literary_resonance_edges` + `computeResonanceForDtu` is the live, persisted, heartbeat-run cross-domain bridge. It generalizes Ghost Threads (#1) and is the join point for #8/#30/#43/#46.
3. **Heartbeat registry** (`registerHeartbeat`, try/catch, scope) — the autonomic layer that revives dead code (#1/#16/#17/#19) by giving it a clock.
4. **Council + reason.verify + brains** — the deliberation layer (#12/#21/#42) already multi-brain.

---

## Dependency-ordered tiers

### Tier 0 — Wire-the-unwired (days; pure reuse, highest ROI)
Give the 5 dead-but-real engines a clock/macro/lens (pattern: `emergent/lattice-orchestrator.js` "lazy-import + try/catch + return {ok,reason}"):
- Hypothesis Engine #17 + Causal-Closure #16 + Residual #18 → register heartbeat + `hypothesis.*`/`reason.*` macros.
- FEA + CAS #19 → `domains/rnd.js` macros (`fea.solve`, `cas.simplify`) + a minimal lens tab.
- Ghost Threads #1 → **retire in favor of LRL resonance** (or merge its surfacing UI onto `literary_resonance_edges`).

### Tier 1 — LRL as the cross-domain hub (FLAGSHIP)
Make the resonance substrate the connective tissue (all reuse `lib/literary-resonance.js` + `embeddings.js`):
- **#8 Consolidation ← resonance:** factor `literary_resonance_edges` score into MEGA/HYPER clustering salience (`dtu-pipeline.js`).
- **#30 Narrative ← resonance:** feed top resonant literary chunks into `narrative-bridge.js` quest/dialogue compose (the spec's "literary grounding for lore").
- **#46 Generative Art + #35 Royalty viz:** one `/api/resonance/graph` (+ `/api/royalty/graph`) endpoint composing `nodes/edges` from `literary_resonance_edges` ∪ `dtu_citations`, rendered by the existing `GraphView.tsx`.
- **#43 Music Resonance:** clone the LRL ingest/search pattern for an audio corpus (semantic + emotional embeddings) — the "music as a literary corpus" the user called out.
- **#11 Initiative ← resonance:** feed resonance topic-salience into `initiative-engine.js#gatherSignal`.

### Tier 2 — Private R&D Engine #21 (the moat)
An orchestrator (`lib/rnd-orchestrator.js` + `domains/rnd.js` + a lens) that runs one verifiable loop: **goal → hypothesis (#17) → LRL+DTU grounded retrieval → CAS/FEA compute (#19) → causal-closure/residual check (#16/#18) → grounded-LLM synthesis with provenance → new DTUs.** Reuses every Tier-0 engine; this is what "connects 6 features at once."

### Tier 3 — Complete the partials
Cognitive Fingerprint time-series #5; Goal-decomposition trees #10 (DTU subgoal graph); Swarm orchestration #9 (planner-executor/maker-checker — research); Shadow Ethics deliberation #42; remaining connectors #50 (Slack/Sheets/GitHub/Notion on `connectorFetch`); federated 6th brain #38; license revocation #37; contribution quests #36; long-horizon planner #14; ConKay voice+affect fusion #15.

### Tier 4 — New, higher-effort
Governance Proposal Simulator #41 (world-fork sandbox); Holocron gatekeeper agent #49; Style Transfer #45; HDC/VSA upgrade #40 (per "Holographic Invariant Storage" — VSA runtime safety contracts); Invariant Geometry Mapper #20 viz.

### Tier 5 — Hardware/external (defer/flag)
Signal Tomography #23, Unreal 5 bridge #29, Haptic #44, Robotics persistence #27 — out of scope until hardware/engine targets exist.

---

## Best practices (2026 research, folded per cluster)
- **Metacognition/memory:** validity-windows on facts (track became-true/superseded), single-pass hierarchical extraction + multi-signal retrieval; true self-improvement = assess→plan-to-learn→evaluate-the-learning. (Concord's dream/forgetting/meta-derivation already match this.)
- **Multi-agent:** dominant patterns = planner-executor, hierarchical-supervisor, maker-checker, pipeline, swarm; **orchestrator-worker ≈ 70% of production**; keep agents single-purpose, `max_loops` low (2–3), strong observability; swarm is *not* defensible for regulated domains. → use supervisor/maker-checker for #9/#21, not free swarm.
- **Neuro-symbolic/VSA (#40):** HDC/VSA = high-dim vectors + algebraic ops; "Holographic Invariant Storage" uses VSA for *runtime* safety contracts — the right upgrade path for Concord's glyph algebra + refusal field.
- **Causal/scientific (#16–21):** AI-Scientist / AI-Co-Scientist use multi-agent debate + evolution; residual analysis must test homoscedasticity/independence (robust SE) — matches `causal-closure.js`'s underfit/overfit ladder; aim for a closed-loop generative cycle.

## Reuse map (build on these)
Heartbeat wiring → `emergent/lattice-orchestrator.js`, `heartbeat-registry.js`. DTU mint → `economy/dtu-pipeline.js#createDTU`. Resonance/embeddings → `lib/literary-resonance.js`, `embeddings.js`. Graph UI → `components/atlas/GraphView.tsx`. Council/LLM → `reason.verify`, `prompt-registry.js`, `brain-config.js`. Connectors → `lib/connector-client.js#connectorFetch`. Lens add → `lens-registry.ts` + `lens-manifest.js` + `lens-features.js` (note: unique `lensNumber`, next free ≥129).

## Verification (per tier as built)
- Tier 0: each revived engine ticks (heartbeat counter) or responds to its macro; a `tests/<engine>-wire.test.js` round-trip.
- Tier 1: `runMacro('literary','resonance')` feeds consolidation/narrative; `/api/resonance/graph` returns nodes/edges; GraphView renders; music corpus search returns `semantic:true`.
- Tier 2: an end-to-end R&D run (goal → hypothesis → compute → closure-check → DTU) with provenance, pinned by `tests/rnd-orchestrator.test.js`.
- Global gates each push: `cd server && npm test`; detectors ratchet (0 new high/crit); `check-doc-claims`; `schema-drift --ci`; frontend `type-check` + `validate-routes`.

## Invariants / constraints
Heartbeats try/catch; migrations append-only; economy/royalty constants untouched; local-first, no telemetry; embeddings never block DTU creation; new deps need an ADR (`docs/adr/`); keep `lensNumber` unique; allowlist runtime/virtual tables in the schema-drift gate.

## Out of scope
No change to constitutional invariants, royalty math, or public-API contracts. Tier-5 hardware/external bridges deferred. Non-PD/user content stays behind the legal-lens consent path.
