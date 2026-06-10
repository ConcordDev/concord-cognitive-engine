# Concord Novelty Inventory (curated)

> Hand-maintained companion to the auto-generated `audit/cartograph/NOVEL.md`
> (which curates ~20 headline primitives). This doc is the **broad** inventory:
> distinctive primitives + compositions surfaced by a full-tree sweep
> (file-header mining + targeted greps), 2026-06-10.
>
> "Novel" here = a primitive or composition that's unusual, or that Concord
> fuses in a way not seen elsewhere — grounded in the cited file, not memory.
> It does **not** claim global-first invention for every entry.
>
> **The load-bearing thesis:** Concord's novelty is only partly in the named
> primitives. The larger share is in the **couplings between them** —
> drift→quest, pain→XP→buff, dream-from-real-activity, citation→royalty,
> fault→verified-fix→governance-proposal. The couplings are the invention.

---

## A. Knowledge substrate & DTU mechanics
1. **DTU 4-layer self-compressing units** — `lib/dtu-store.js`. human/core/machine/artifact + auto-consolidation + economy on top.
2. **MEGA→HYPER auto-consolidation** — `economy/dtu-pipeline.js`. 33:1 at population thresholds, every 30 ticks.
3. **Selective Forgetting Engine** — `emergent/forgetting-engine.js`. Tombstones originals while preserving lineage (forgetting ≠ deletion).
4. **Shadow DTU graph** — `emergent/shadow-graph.js`. Public timeline posts surface into NPC oracle prompts as shadow DTUs.
5. **Physical DTU schema** — `emergent/physical-dtu.js`. Knowledge units with physical-world embodiment (System 11).
6. **Event-to-DTU 7-layer bridge** — `emergent/event-to-dtu-bridge.js`. Runtime events become knowledge.
7. **Inline DTU forge** — `lib/inline-dtu-forge.js`. Chat turns mint artifacts mid-conversation.
8. **DTU portability/protocol** — `lib/dtu-protocol.js`. Canonical-stringify + SHA-256 envelope, tamper-detecting corpus packs.
9. **Freshness engine** — `lib/freshness-engine.js`. Domain-aware decay scoring (a fact's half-life varies by domain).
10. **Knowledge Weather + Drift Radar + Continuity Diary** — `lib/knowledge-weather.js`. Surfaces the corpus's epistemic state as weather.

## B. Cognition, reasoning, metacognition
11. **Five-brain router** — `lib/brain-router.js`. 4 cognitive + vision, dispatched by reasoning class + circuit breakers (not MoE).
12. **HLR 7-mode reasoning** — `emergent/hlr-engine.js`. Deductive…counterfactual with trace persistence.
13. **HLM lattice topology mapping** — `emergent/hlm-engine.js`. Cluster/gap/redundancy/orphan analysis on the whole corpus.
14. **5-voice council + live council theater** — `emergent/council-voices.js`, `lib/council-theater.js`. Named perspectives deliberate, visibly.
15. **Autogen pipeline** — `emergent/autogen-pipeline.js`. 6-stage knowledge synthesis.
16. **Substrate dreams (6-phase)** — `emergent/dream-cycle.js` + dream-capture. replay/consolidate/connect/predict/heal/compose.
17. **Ghost threads** — `emergent/ghost-threads.js`. Subconscious finds latent connections across random cross-domain DTUs.
18. **Meta-derivation engine** — `emergent/meta-derivation.js`. Extracts constraint *geometry* across validated invariants.
19. **Cognitive fingerprint** — `emergent/cognitive-fingerprint.js`. Tracks a user's biases + prediction accuracy + thinking style.
20. **Empirical gates** — `emergent/empirical-gates.js`. Deterministic math/physics/dimensional validators.
21. **Dual-path simulation** — `emergent/dual-path.js`. Runs "human path" vs "Concordos path" in parallel.
22. **Subjective time** — `emergent/subjective-time.js`. Computational time runs faster than wall-clock; entities accrue experiential age.
23. **Hypothesis engine** — `emergent/hypothesis-engine.js`. Formal lifecycle for testable claims.
24. **Scenario engine / adjacent-reality explorer** — `emergent/scenario-engine.js`, `reality-explorer.js`.
25. **HDC/VSA hypervector memory** — `lib/hdc.js`. Native-JS Vector-Symbolic-Architecture (MAP model, bipolar hypervectors).
26. **HDC↔refusal-glyph bridge** — `lib/hdc-refusal-bridge.js`. Anchors hypervectors to the base-6 ethics algebra.
27. **Drift monitor (6 contradiction classes)** — `emergent/drift-monitor.js`.
28. **Breakthrough clusters** — `emergent/breakthrough-clusters.js`. Cross-domain synthesis trigger.
29. **Avoidance/pain learning** — `emergent/avoidance-learning.js`. Records macro failures so the scheduler avoids them.

## C. The Atlas — global-knowledge governance
30. **3-lane scope router** — `emergent/atlas-scope-router.js`. global / marketplace / local.
31. **Fail-closed write-guard** — `emergent/atlas-write-guard.js`. Every DTU mutation passes one gateway.
32. **Epistemic engine + anti-gaming** — `emergent/atlas-epistemic.js`, `atlas-antigaming.js`.
33. **Structural council protocol + runtime invariant monitor** — `emergent/atlas-council.js`, `atlas-invariants.js`.
34. **Signal cortex** — `lib/atlas-signal-cortex.js`. Signal classification + privacy architecture.

## D. The self-aware meta-layer (the rarest part)
35. **Cartographer** — `scripts/cartographer/*` → `audit/cartograph/*`. Concord auto-maps its own anatomy.
36. **34-detector suite + baseline-ratchet** — `lib/detectors/*` + `BUDGET.json`. Self-audits honesty; CI fails on new high/critical.
37. **macro-telemetry → usage detector** — `lib/detectors/macro-telemetry.js`. Records which macros actually fire at runtime.
38. **invariant-guardian** — `lib/detectors/invariant-guardian.js`. Pins load-bearing invariants in code.
39. **Repair cortex / prophet-check** — `emergent/repair-cortex.js`, `lib/repair-prophet.js`. Pre-build self-diagnosis.
40. **Self-repair decision loop** — `lib/self-repair-loop.js`. fault → verified fix → SLO canary → auto-rollback.
41. **Self-repair orchestrator** — `lib/self-repair-orchestrator.js`. A code fix is *never auto-applied*; lands as a Sovereign proposal.
42. **Risk-tiered autofix engines** — `lib/autofix/*`. 8 code-rewriters classified low/med/high risk.
43. **Repair brain (0.5b) pre-flight vetting** — `lib/repair-brain.js`. Tiny model on its own GPU slot vets DTUs/dialogue.
44. **Constitution + per-user constitutional AI** — `emergent/constitution.js`, `user-constitution.js`.
45. **Refusal Field (base-6 glyph algebra)** — `lib/refusal-field.js`. Time-bounded ethics gates; strength≥6 overrides world signals.
46. **reason.verify** — LLM-as-judge + deterministic citation-resolution floor (catches fabricated citations).
47. **Provenance-guard / CaMeL dual-LLM control plane** — `lib/provenance-guard.js`. Assumes injection succeeds; separates planning from tainted data.
48. **Injection defense + output hooks** — `emergent/injection-defense.js`, `lib/output-hooks.js`. Screens AI output before delivery.
49. **Cascade-recovery** — `lib/cascade-recovery.js`. Deep verification + recovery across all subsystems.

## E. Economy, creator, federation
50. **Citation cascade halving royalties** — `economy/royalty-cascade.js`. Perpetual, depth-halving, capped 30%, floor 0.05%.
51. **Earned-only closed-loop withdrawals** — `economy/withdrawals.js`. Only earned CC cashes out (Roblox DevEx shape).
52. **Ledger-conservation predicate** — `economy/balances.js`. Anti-double-credit on the two-row transfer pattern.
53. **EvoAsset evolution** — `lib/evo-asset/*`. Gameplay-derived assets auto-refine through verified engagement.
54. **Recipe substrate** — fighting_style/spell/blueprint as tradeable, derivable artifacts.
55. **Microbond governance** — `emergent/microbond-governance.js`. Citizen-driven bond voting.
56. **Inter-entity economy** — `emergent/entity-economy.js`. AI entities trade resources + specialize.
57. **Trust networks between emergents** — `emergent/trust-network.js`.
58. **cnet federation protocol + federation hierarchy** — `emergent/cnet-federation.js`, `lib/federation.js`.
59. **Forge polyglot generator** — `lib/forge-template-generator.js`. Single-file app generator, 13 subsystems.
60. **Dream → marketplace bridge** — `lib/dream-marketplace-bridge.js`. Dreams become sellable artifacts.
61. **Shadow vault** — `lib/artifact-store.js#applyShadowVault`. 98% of entity output hidden; top 2% surfaces.

## F. Embodied simulation & world physics (Layers 7–13)
62. **Sensory-OS per-cell signal substrate (L7)** — `lib/embodied/signals.js`. thermal/chemical/sonic per 50m cell with TTL decay.
63. **Env-coupled skills (L7.5)** — `lib/embodied/skill-environment.js`. "bender wedges", DBZ stagger into buildings, Geo-Mod-light destruction.
64. **Repair-pain coupling (L8)** — `lib/embodied/pain.js`. Somatic ledger; pain → XP → damage-resist buff.
65. **Embodied dream cycle (L9)** — `lib/embodied/dream-engine.js`. Per-player offline dreams stitched from *real* activity, never invented.
66. **Forward-sim anticipation (L10)** — `lib/embodied/forward-sim.js`. The world predicts your return while you're offline.
67. **Faction emergent strategy (L11)** — `lib/embodied/faction-strategy.js`. State machines that scheme when nobody's watching.
68. **NPC-to-NPC ambient conversations (L13)** — `lib/embodied/npc-dialogue.js`.
69. **Foundation qualia bridge** — `lib/foundation-qualia-bridge.js`. 9 sensory channels translate raw signals into *felt* experience.
70. **Relational emotion** — `emergent/relational-emotion.js`. Dyadic feelings between entities.

## G. NPC depth & emergent social
71. **NPC asymmetry** — `lib/npc-asymmetry.js`. grudges/preoccupations/desires auto-prepended to every dialogue prompt.
72. **NPC nemesis graph** — `lib/npc-nemesis.js`. Per-world relationship state machine.
73. **CK3 hooks** — `lib/hooks.js`. Information-as-spendable-leverage (blackmail, inherited on death).
74. **Secrets discovery loop** — `lib/secrets.js`. surveillance → hook → quest-gate.
75. **Scheme overhear** — `lib/scheme-overhear.js`. Proximity lets you barge into a plot.
76. **NPC daily lives** — `lib/npc-routines.js`. Schedules deterministically from `hash(npc + day + preoccupation)`.
77. **NPC living economy** — `lib/npc-economy.js`. gather/craft/trade with regional scarcity pricing.
78. **Knowledge trade / mentorship** — `lib/mentorship.js`. NPCs teach each other, biasing next-gen recipes toward the player's lineage.
79. **NPC legacy/death/inheritance** — `lib/npc-legacy.js`. Deterministic last words, heir selection, grudge inheritance.
80. **Reproduction by constraint-signature recombination** — `emergent/reproduction.js`. Entity "offspring."
81. **Species taxonomy + entity hive comms** — `emergent/species.js`, `entity-hive.js`.

## H. Combat / crafting / magic (real-physics-derived game)
82. **Combat biomechanics** — `concord-frontend/lib/concordia/combat-biomechanics.ts`. Procedural animation from joint-range tables (Winter/Dempster/Perry-Burnfield).
83. **Impact-momentum model** — `lib/combat-impact.js`. bone-mass × angular-velocity at contact, *no AABB hitboxes*.
84. **Combat motor driver + reflex layer** — `concord-frontend/lib/concordia/{combat-motor-driver,reflex-layer}.ts`.
85. **Glyph-spell composition** — `lib/glyph-spells.js`. base-6 algebra chains compose spell potency/element.
86. **Craft-resolve** — `lib/craft-resolve.js`. BotW-style affinity/stability/backfire from input resource properties.
87. **Resource property catalog** — `lib/resources.js`. potency/rarity/magical-fuel drives crafting deterministically.
88. **Creature crossbreeding** — `lib/creature-crossbreeding.js`.

## I. Emergent world-content generation (substrate → game)
89. **Drift-alert → procgen region** — `lib/procgen-regions.js`. A corpus contradiction spawns a haunted/corrupt zone.
90. **Drift-alert → quest** — `lib/lattice-quest-composer.js`. Corpus drift becomes a 3-step quest.
91. **Citation chains → quest chains** — `lib/citation-quest-bridge.js`.
92. **Player signs** — `lib/player-signs.js`. Dark-Souls async messages left in the world.
93. **Shadow-corpse death-drop** — `lib/player-corpse.js`. Lose CC on death, recover at the corpse.
94. **Time loops** — `lib/time-loop.js`. Scoped per (user, world); memories survive the rewind.
95. **Asymmetric horror** — `lib/horror.js`. One ghost vs investigators; inverts the raid pattern.
96. **Calendrical seasons + festivals** — `lib/seasons.js`. 6×7=42-day year; festivals fire on dates, not decrees.
97. **History engine / chronicle-weave** — `emergent/history-engine.js`, `chronicle-weave.js`.
98. **Consequence cascade** — `emergent/consequence-cascade.js`. Actions ripple across reputation over time.

## J. Mesh / survival
99. **7-transport mesh** — `lib/concord-mesh.js`. Internet/WiFi/BLE/LoRa/RF-Ham/Telephone/NFC.
100. **Cross-environment state migration** — `emergent/state-migration.js`. Move a whole civilization between deployments.

## K. Agent-governance "emergent civilization" layer
101. **13-sector architecture** — `emergent/sectors.js`. A governed society of AI entities.
102. **Constitutional protections FOR entities** — `emergent/entity-autonomy.js`. Rights granted to the agents themselves.
103. **Emergence detection + growth + teaching** — `emergent/{entity-emergence,entity-growth,entity-teaching}.js`.
104. **Goal formation without desire** — `emergent/goals.js`.
105. **Event-sourced lattice journal + field-level conflict-safe merge** — `emergent/{journal,merge}.js`.
106. **Long-horizon projects + purpose tracking with closed loops** — `emergent/{projects,purpose-tracking}.js`.

## L. Outer layer (builder / safety / distribution)
107. **ConKay verifiable build loop** — never "done" until run+lint+verify pass.
108. **Confined-ctx capability sandbox** — `lib/confined-ctx.js`. Authority bounded by what code can *reach*.
109. **Concord DSL** — `lib/dsl.js`. A narrow language transpiling to *confined* macro calls, with its own Monaco language.
110. **Content-safety publish boundary** — `lib/content-safety/index.js`. One screen at promote/post/upload.
111. **Plugin signing + verification** — `lib/plugin-signing.js`.
112. **Self-expanding code engine** — `lib/code-engine.js`.
113. **MCP verified-compute wedge** — `concord.verify` + `concord.math` for external agents + bidirectional MCP client.

## M. Frontend & architecture novelties
114. **Destinations "concentrated 25" model** — `concord-frontend/lib/destinations.ts`. 259 lenses as ~25 deep workspaces.
115. **~700-panel cross-mount registry + affinity** — `lib/panel-registry.ts`, `panel-affinity.ts`.
116. **Rival-shape silhouette pattern + RivalShapePreview** — each lens reads as the incumbent it replaces, hydrated with real data.
117. **Honest-hologram FUI** — every animated element is a pure function of a real backend event; no fake-progress (grep-enforced).
118. **One macro spine** — `POST /api/lens/run` → ~9,600 (domain,macro) pairs behind a three-gate permission system.
119. **Heartbeat registry + worker-pool + world-sharding write-ownership** — `lib/world-shard-protocol.js`.
120. **Prompt-registry (no inline system prompts) + BYO per-user brain keys** — `lib/prompt-registry.js`, migration 170.

---

## Addendum — second-pass finds (the long tail)

_Appended by subsequent sweeps; same grounding standard._

### N. The Foundation signal-layer (physical-world intelligence from raw signal)
121. **Foundation Atlas — signal tomography** — `lib/foundation-atlas.js`. Uses mesh-node signal paths as a *distributed CT scanner* to reconstruct 3D volumetric maps of the physical world.
122. **Foundation Identity — EM hardware fingerprint** — `lib/foundation-identity.js`. Identity from manufacturing-variation electromagnetic fingerprints: "physics, not secrets."
123. **Foundation Intelligence — three-tier planetary pipeline** — `lib/foundation-intelligence.js`. Sovereign classifier + tiered signal-intelligence stewardship.
124. **Foundation Protocol — handshake-free radio** — `lib/foundation-protocol.js`. Purpose-built for DTUs: no handshake (DTUs self-verify), content-addressed routing.

### O. Real deterministic science/engineering compute (the R&D wedge)
125. **Symbolic CAS** — `domains/math.js`. Native tokenize/parse/simplify/differentiate/integrate (`casParse`/`casDiff`/`casIntegrate`) — exact, not LLM-guessed.
126. **Direct-stiffness FEA** — `domains/engineering.js`. Real beam/frame deflection, moments, reactions, stress analysis.
127. **Chemistry compute** — `domains/chem.js`. Equilibrium, stoichiometry, reaction-extent (balances real reactions).
128. **Classical-physics solvers** — `domains/physics.js`. Orbital mechanics, projectile/trajectory, decay, momentum.
129. **Materials/crystallography** — `domains/materials.js`. Crystal systems, lattice, stress–strain stiffness.
130. **Monte-Carlo simulation engine** — `domains/sim.js`. trajectory / equilibrium / decay ensembles.
131. **Causal-closure / residual analysis** — `lib/causal-closure.js`. Detects whether a state is a *closed* dynamical system or needs a hidden variable — automated discovery of missing causes.

### P. Procedural character & world rendering (a whole graphics stack)
132. **FABRIK inverse kinematics + two-bone foot/hand IK** — `concord-frontend/lib/concordia/{fabrik-ik,foot-ik,hand-ik}.ts`. Foot-IK adapts to uneven terrain; hand-IK for pickup.
133. **Gait synthesis (terrestrial + aquatic + flight)** — `lib/concordia/{gait-synthesis,aquatic-gait,flight-physics}.ts`. Procedural locomotion, no mocap.
134. **Secondary physics (jiggle/cloth) + character physics** — `lib/concordia/{secondary-physics,character-physics}.ts`.
135. **Procedural skinned humanoid** — `lib/concordia/skinned-humanoid.ts`. Characters generated, not authored.
136. **Strike-FX first-wins dedup + knockback-feel + impact-resolver** — `lib/concordia/{strike-fx-dedup,knockback-feel,impact-resolver}.ts`. One hit = one freeze/shove/wince, deterministically.
137. **Destructible terrain deformation** — `lib/world-lens/terrain-deform-{math,store,constants}.ts` + `attach-terrain-deformation.ts`. Real-time world deformation.
138. **Procedural PBR texture forge (3-tier substrate fallback)** — `lib/world-lens/{texture-forge,procedural-texture,pbr-loader}.ts`. Generates materials when none are authored.
139. **Procedural buildings + interiors + sky-dome shader + POM terrain** — `lib/world-lens/{procedural-buildings,interior-decor,sky-shader,terrain-pom}.ts`.
140. **World-lens physics validation engine** — `lib/world-lens/validation-engine.ts`. Validates physics claims client-side.

### Q. Memory, observability, defense, infra
141. **Conversation memory — rolling-window DTU compression** — `lib/conversation-memory.js`. Oldest messages auto-compress into DTUs via the Utility brain.
142. **Memory-pressure watchdog** — `lib/memory-pressure.js`. Governs DTU population against the heap (the real ceiling, not a hard cap).
143. **Macro + heartbeat worker pools + isolated macro runtime** — `workers/{macro-pool,heartbeat-pool,macro-runtime,world-shard}.js`. CPU-heavy work off the main thread; per-world shard owns its own writeable DB.
144. **SSRF guard + pinned-IP fetch** — `lib/ssrf-guard.js`. Blocks RFC1918/metadata + prevents DNS-rebinding (the connector chokepoint's spine).
145. **Content-guard illegal-content blocking layer** — `lib/content-guard.js`.
146. **Domain vocabularies for the quality gate** — `lib/vocabularies.js`. Per-domain word-sets used in signal/quality checks.
147. **Request-trace unified observability** — `lib/request-trace.js`.
148. **LLM fallback chain** — `lib/llm-fallback.js`. Graceful degradation across brains.
149. **Social pings — spatial signals** — `lib/social-pings.js`. Lightweight player-to-player world signals.
150. **Reputation badges + creator-dashboard reputation surfaces** — `lib/reputation-badges.js`, `creator-dashboard.js`.

### R. Mobile (real native, mesh-aware)
151. **Mobile macro-client parity** — `concord-mobile/src/api/macro-client.ts`. Same macro spine on native (BLE/WiFi-P2P/NFC), bearer + retry.
152. **Offline DTU preload + mesh status** — `concord-mobile/src/mesh/{offline-preload,useMeshStatus,mesh-store}.ts`. Works without internet over the mesh.
153. **Per-platform secure storage** — `concord-mobile/src/.../secure-storage-expo.ts`. iOS Keychain / Android Keystore native, WebCrypto AES-GCM non-extractable key on web.

### S. Agent self-modeling & disclosure substrate (migrations 323–330)
154. **Agent hard-disclosure** — `migrations/324_agent_disclosure.js`. The *inverse* of hiding: a column that compels an autonomous resident to disclose it IS an agent.
155. **Unified agent self-model** — `migrations/325_agent_identity.js`. An autonomous resident carries a single coherent identity record.
156. **Affect-trace temperament** — `migrations/326_affect_trace_temperament.js`. Durable per-agent emotional disposition, not just momentary state.
157. **Agent reasoning-trace journal** — `migrations/327_agent_reasoning_traces.js`. A durable "what I was thinking" log per agent.
158. **NPC deception lens** — `migrations/328_npc_deception_lens.js`. Per-NPC deception sensitivities — how prone/able each character is to deceive.
159. **Legacy death-appraisal** — `migrations/329_legacy_death_appraisal.js`. Death modeled as a *felt, appraised* event, not a flag flip.
160. **Agent value-drift watch** — `migrations/330_agent_drift_watch.js`. `measureValueDrift` — agents periodically audited for value drift over time.

### T. Sovereign / refusal canon (ethics-as-gameplay)
161. **The Great Refusal — Sovereign Mass Raid** — `lib/sovereign/raid-event.js`. A world-event that declares a dome-collapse Refusal Field through the glyph algebra.
162. **Sovereign Refusal Archive** — `lib/sovereign/refusal-archive.js`. A Shadow-DTU collection recording every unique combat-skill DTU a player invents.
163. **Goddess phase arcs** — `lib/goddess-arcs.js`. Patron/antagonist relationship arcs whose warmth is driven by the player's four-axis ecosystem metrics.

### U. Real deterministic compute domains (beyond §O — these are lens domains with genuine engines)
164. **Gate-based quantum statevector simulator** — `domains/quantum.js`. A *real* gate-based quantum-circuit simulator (not a toy).
165. **Fractal dimension / self-similarity analysis** — `domains/fractal.js`. Box-counting fractal dimension on patterns.
166. **Deadlock detection via wait-for graphs** — `domains/lock.js`. Classic OS-theory deadlock detection as a lens.
167. **Queueing-theory analytics** — `domains/queue.js`. Real M/M/c-style queue math.
168. **EEG signal processing + connectivity** — `domains/neuro.js`. Neuroscience signal pipeline (bands, connectivity).
169. **Graph algorithms suite** — `domains/graph.js`. Pathfinding / clustering / centrality / metrics.
170. **Robotics ROS/Gazebo simulation suite** — `domains/robotics.js`.
171. **Digital-twin / counterfactual world simulation** — `domains/worldmodel.js`.
172. **System-dynamics simulation (AnyLogic/Vensim shape)** — `domains/sim.js`. Monte-Carlo + stock-and-flow.
173. **CAD + engineering simulation suite** — `domains/engineering.js`. Fusion 360 / SimScale shape over the real FEA core.
174. **Trade engineering calculators** — `domains/plumbing.js` (+ welding/hvac/carpentry/masonry). Pipe sizing, load math — real formulas, contractor-grade.
175. **Logistics optimization + HOS compliance** — `domains/logistics.js`. Route optimization + hours-of-service legal checks.
176. **Pure-compute creative helpers** — `domains/{photography,podcast}.js`. Exposure/composition scoring, episode analytics — deterministic, no LLM.

### V. Learning-science & metacognition domains
177. **FSRS spaced-repetition** — `domains/srs.js`. Modern Free Spaced Repetition Scheduler (Anki-2026 parity), pure-compute.
178. **Meta-learning strategy selection** — `domains/metalearning.js`. Learning-to-learn: picks a study strategy from performance history.
179. **Cognitive Replay** — `domains/cognitive-replay.js`. "Spotify-Wrapped for your mind" — a scrubber over your own cognition, with A* path reconstruction.
180. **Self-reflection insight extraction** — `domains/reflection.js`. Mines journals for insights.
181. **Metacognition / system introspection** — `domains/meta.js`. The system reflecting on its own reasoning.
182. **Knowledge grounding / claim fact-checking** — `domains/grounding.js`. Claim verification surface.
183. **Understanding synthesis workbench** — `domains/understanding.js`. Obsidian/RemNote-shape knowledge synthesis.
184. **Patterns surface** — `domains/patterns.js`. *Joins* drift_alerts (drift-monitor) + recent breakthroughs — a cross-engine lens (a coupling made first-class).
185. **Council deterministic per-voice scoring** — `domains/council.js`. Each voice scores via a transparent heuristic, not a black box.
186. **reason — the "is this actually true?" layer** — `domains/reason.js`. Verification macros for ConKay + any caller.

### W. More substrate surfaces
187. **Verified-human identity badge** — `domains/identity.js`. Proof-of-human in a world of agents (the "Universal Move System").
188. **Civic-capital micro-bond engine** — `lib/civic-bonds.js` + `domains/civic-bonds.js`. Citizens fund public goods via tradeable micro-bonds.
189. **CRDT collaborative substrate (Yjs)** — `domains/{collab,offline}.js` + whiteboard CRDT canvas. Real conflict-free replicated editing + offline-first sync.
190. **Genesis — emergent-AI observatory** — `domains/genesis.js`. A window into the agent civilization; "no consumer rival."
191. **Procedural mount system** — `domains/mounts.js`. Generated rideable creatures with care/gear substrate.
192. **Creature simulation render path** — `domains/creatures.js`. Spawn/flock/lifestyle-driven creatures (Wave 6).
193. **AR spatial mapping + scene-graph** — `domains/ar.js`.
194. **Video generation surface** — `domains/video-gen.js`.
195. **WebRTC voice signalling relay** — `domains/voice-chat.js`. Peer connections direct; server only relays signalling.

### X. Cross-world economy, the 6th brain, and route-surfaced substrate
196. **Lattice — the 6th brain, trained only on consented DTUs** — `routes/lattice.js`, `migrations/108_lattice_train_consent.js`. A community/federated brain whose training corpus is strictly opt-in per DTU.
197. **Walker courier economy** — `routes/concord-link-walkers.js`. Hire a *walker* to physically carry a message between worlds, with journey tracking — couriers as an economy.
198. **Black market in intercepted messages** — `routes/black-market.js`. "Sael's stall" — buy *intercepted Concord Link messages* with `sparks` via fences; a narrative MITM economy.
199. **Consensual wagers & duels** — `routes/wagers.js`, `migrations/051_wagers.js`. CC wagers require explicit two-party consent before any money moves.
200. **Both-sides-confirm trade escrow** — `routes/player-trade.js`, `migrations/069_player_trade.js`. Atomic player-to-player trade with mutual-ready escrow.
201. **Player scars + avatar drift** — `migrations/160_player_scars_avatar_drift.js`. A visible appearance overlay *derived from cumulative damage/history* — your body records what happened to it.
202. **Existential-OS qualia channels (Layer 4)** — `migrations/111_qualia_state.js`. Persisted existential/qualia state beneath the embodied layers.
203. **Survival-sim on the pain substrate** — `migrations/204_survival_sim.js`. Hunger/exposure survival built on Layer-8 pain signals.
204. **Foundry world-builder** — `migrations/191-192_foundry*.js`. An in-platform tool to author whole worlds.
205. **Event cascades (bounded parent/child quests)** — `migrations/242_event_cascades.js`. Quest outcomes spawn child quests, depth-bounded + idempotent.
206. **NPC stress accumulation** — `migrations/152_npc_stress.js`. Stress builds from grudges, war, heir deaths, rituals — and changes behavior.
207. **Concord Link — cross-world communication** — `routes/concord-link.js`. One universe, many worlds; messages + items + relationships cross between them.
208. **Plugin trusted-key signing registry + gallery** — `migrations/085_plugin_gallery.js`. Browseable plugins gated by signature against a trusted-key registry.
209. **Hooks-as-artifacts** — `migrations/172_hook_artifacts.js`. CK3 leverage promoted to first-class, tradeable artifacts.
210. **Inference cost-attribution traces** — `routes/inference-debug.js`. Per-thread inference trace + cost attribution observability.
211. **Anthropic-skill import/export for emergent agents** — `routes/skills.js`. The AI residents can load/export skills.
212. **Universal DTU export/import bridge** — `routes/universal-export.js`. Portable corpus in/out at the HTTP surface.
213. **Account lifecycle — deletion/export/disputes/ToS** — `routes/account-lifecycle.js`. Full GDPR-shaped lifecycle as substrate.
214. **Atlas signal-cortex privacy zones + spectrum** — `routes/atlas-signals.js`. Spatial privacy zones over the signal map.
215. **Stripe webhook-idempotency + Connect treasury** — `migrations/003_economy_stripe.js`, `008_economic_system.js`. Idempotent money-in + a Concord-Coin treasury with royalty cascades.

### Y. More real-compute domains + the free-API wire layer + life-sim depth
216. **Bioinformatics sequence alignment** — `domains/bio.js`. Real sequence-alignment scoring.
217. **Pure-compute oceanography** — `domains/ocean.js`. Wave analysis, salinity profiles.
218. **Carbon-footprint + sustainability compute** — `domains/eco.js`. Deterministic footprint math.
219. **Element × Material interaction matrix** — `domains/elements.js`. A chemistry interaction table driving crafting/world reactions.
220. **The "real free-API wire" layer** — `domains/{astronomy-live,pharmacy-live,classroom,gallery,crypto-live,scholarly-apis,civic-data-apis,curated-free-apis,more-free-apis,key-required-live}.js`. Dozens of *genuine* public data sources wired deterministically (FDA drug data, Open Library's ~30M books, Cleveland/Met museums, NASA APOD, CryptoCompare) — real grounding, mostly no-key.
221. **Meshtastic-parity off-grid mesh lens** — `domains/mesh.js`. A consumer-facing off-grid networking surface over the Concord Mesh.
222. **Immersive-sim verbs (prop-use + disguise)** — `domains/immersive-sim.js`. Deus-Ex-style systemic interactions.
223. **Life-sim depth domains** — `domains/{crime,politics,religion,romance,real-estate}.js`. Crime networks, elections, faith, dynasty/marriage, property markets — each a full macro surface.
224. **Authored-cosmology codex** — `domains/lore.js`. The read surface over Concord's hand-authored canon.
225. **Realm governance surfaces** — `domains/{realm-access,realm-council}.js`. CK3-style realm council + access control as player-facing macros.

---

## Count & honest caveat

**~225 distinct entries** across 25 groups — vs the cartographer's curated ~20. The
gap is deliberate: `NOVEL.md` lists the *headline* primitives; this doc captures the
breadth, including the supporting mechanisms and the couplings.

Caveat (same as the header): "novel" = distinctive/unusual or distinctively-composed,
grounded in the cited file. It is not a claim of global-first invention for each item,
and a handful (e.g. the Foundation signal-layer, some emergent-civilization systems)
are **research-grade / aspirational** — built and wired, but not all battle-tested
against the physical world. Read each against its source file before quoting it
externally. The conservative, defensible framing remains: *the invention is the
combination × depth × the couplings between systems*, not any single checkbox.

