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

### Z. The lens-runtime framework (what lets 260 lenses share one substrate)
226. **Offline-first substrate mirror** — `lib/offline-first/{offline-queue,substrate-cache,db}.ts` + `hooks/useOfflineFirst.ts`. A typed offline action-queue with a sync indicator + a *full substrate cache in IndexedDB* — the app keeps working offline and reconciles on reconnect.
227. **useYjsDoc — Yjs CRDT bound to Socket.IO rooms** — `lib/useYjsDoc.ts`. A drop-in real-time co-editing primitive any lens can use.
228. **Declarative lens runtime contract** — `lib/manifest.ts` + `lib/domain-schemas.ts` (per-lens typed entity models) + `lib/automation-bindings.ts` (per-lens trigger→macro). A framework that makes 260 lenses configuration, not 260 bespoke apps.
229. **Universal lens-hook suite** — `hooks/useLens*.ts`. useLensState (auto-save/restore), useLensDraft (debounced autosave), useLensRealtime (typed lens-scoped sockets), useLensGrounding (a lens's *own* grounding DTUs), useLensIdentity (per-lens CSS-var theming), useLensSession (multi-step workflows), useTilePush (realtime cache-invalidation), useRealtimeRefresh (emit-on-change + slow-poll backstop).
230. **Headless-domain probe registry** — `lib/headless-probes.ts`. Synthetic-journey self-testing across lenses.
231. **Console/controller play for a web app** — `hooks/{useGamepad,useConsolePing}.ts`. Standard Gamepad API + device-class detection.
232. **WebRTC spatial voice + VAD + cross-browser STT** — `hooks/useWorldVoice.ts`, `lib/voice/{vad,mediarecorder-stt}.ts`. Positional voice in the world + a Web-Speech fallback for ConKay.
233. **Avatar renderer reads scars + worker-driven gait** — `hooks/{useAvatarScars,useAvatarAnimator}.ts`. The body's history (scars/drift) drives the shader; gait is computed off-thread in a worker.
234. **Global media layer controllable from any lens** — `hooks/useGlobalMedia.ts`. One media surface, addressable everywhere.

### AA. More compute / data / workflow domains
235. **Derivatives + global-markets engine** — `domains/markets.js`. Options/futures companion to the equity `market` lens.
236. **Healthcare clinical helpers** — `domains/healthcare.js`. Drug-interaction checks, protocol matching, patient summaries.
237. **Quantified-self unified health ledger** — `domains/self.js`. Shadows wearable/health data into one personal ledger.
238. **Privacy/consent management (OneTrust shape)** — `domains/privacy.js`. Consent records + data-privacy controls as substrate.
239. **Audit / compliance trail + risk scoring** — `domains/audit.js`.
240. **Multi-step workflow sessions** — `domains/sessions.js` + `hooks/useLensSession.ts`. Resumable multi-step flows across any lens.
241. **Integration bridge (connection health + data mapping)** — `domains/bridge.js`.
242. **Kanban workflow analytics** — `domains/board.js`. Burndown + card prioritization math.
243. **Mortgage / amortization finance math** — `domains/realestate.js`. Real loan amortization formulas.

### AB. MMO / competitive / social-sim substrate (the schema ledger)
244. **Elo matchmaking + persistent arena queue** — `migrations/{054_player_ratings,055_arena_queue}.js`. Real Elo + a queue that survives restarts.
245. **Player-organized tournaments** — `migrations/103_tournaments.js`. Bracketed competitive PvP scenes.
246. **Spectator betting + emergent broadcast** — `migrations/162_spectator_betting.js`. Watch + wager on live emergent events.
247. **Auction house + EVE-style buy orders** — `migrations/{220_auction_house,227_auction_buy_orders}.js`. Time-bound bidding, buy-now, *and* standing buy-orders with snipe-extension.
248. **Epidemiology sim** — `migrations/{223_disease_immunity_and_diagnose,228_disease_realism}.js` + `lib/disease-engine.js`. Vector-based contagion, immunity ledger, diagnose-skill XP, world plague thresholds.
249. **WoW-style async player mail** — `migrations/215_player_mail.js`. Survives logout; COD + attachment transfer in one transaction.
250. **Achievement catalog + seasonal gating** — `migrations/{216_achievement_catalog,236_achievement_season}.js`. Stamped with season/year at unlock.
251. **Faction reputation cache + equipped titles** — `migrations/{217_user_active_title,218_player_faction_rep_cache}.js`.
252. **Party LFG matchmaking + raid variant** — `migrations/219_party_lfg.js`.
253. **Multi-step crafting chains** — `migrations/180_multi_step_crafts.js`. Recipe trees, not single-step crafts.
254. **Generational aging + player dynasty** — `migrations/181_aging_dynasty.js`. Characters age; lineage persists.
255. **Culture/faith friction + marriage** — `migrations/182_culture_marriage.js`. Cross-culture tension as a mechanic.
256. **Crime depth (gangs/rackets/heists/bounties)** — `migrations/209_crime_depth.js`.
257. **Climbing routes + Stardew-style farm plots** — `migrations/{244_climbing_routes,247_farm_plots}.js`.
258. **Tunyan jobs + ration entitlements** — `migrations/179_tunyan_jobs.js`. A planned-economy labor catalog.
259. **Cross-world population migration** — `migrations/168_population_migration.js`. NPCs move between worlds.
260. **Skill atrophy** — `lib/skill-atrophy.js` (mig 087). Unused skills decay over time.

### AC. Self-describing codebase & infra primitives
261. **Codebase-as-DTUs** — `migrations/125_code_artifact_kind.js`. Routes / migrations / modules / macros / economy systems are themselves minted as DTUs — the system represents its own source inside its own knowledge substrate.
262. **Brain want-engine** — `migrations/009_brain_want_engine.js`. The brain models *wants* that drive autonomous activity.
263. **Ledger idempotency keys** — `migrations/004_ledger_idempotency.js`. Every money mutation is idempotent by refId (no double-spend on retry).
264. **External messaging adapters** — `migrations/056_messaging_adapters.js`. Bind external channels (SMS/Discord/etc.) + message log + user-platform linking.
265. **Learning verification substrate** — `migrations/010_learning_verification.js`. Proof that learning actually occurred.

### AD. Game-system engines (each a real, self-contained mechanic)
266. **Full Mahjong engine** — `lib/mahjong/*`. Seeded wall, 4 seats, 3 NPC discard AIs, genuine 14-tile decomposition for 9 yaku (not a checkbox).
267. **Combat subsystem suite** — `lib/combat/*`. damage-calculator, executions, faction-war, flow-recorder (combat *replay*), telegraph-peril, boss-phases, match-chronicle, loadout.
268. **Skill mastery tiers** — `lib/skills/skill-mastery.js`. novice→grandmaster progression with VFX scaling per tier.
269. **Programming-puzzle VM** — `lib/programming-puzzle.js`. A real register VM that runs submitted programs against test cases, cycle-capped against infinite loops.
270. **Hacking terminal puzzle** — `lib/hacking.js`. Filesystem-tree terminal with a server-private solution path (no leak).
271. **Detective deduction board** — `lib/detective.js`. 2-of-3 lock-in (suspect+weapon+motive) with persistent arrest records.
272. **Roguelite meta-progression** — `lib/roguelite.js`. Hades-style gem bank that advances even on a wipe.
273. **Extraction-shooter mode** — `lib/extraction.js`. Loot-or-lose with corpse-drop on death.
274. **Theme-park tycoon** — `lib/theme-park.js`. Appeal/satisfaction compounding with visits.
275. **Factory automation** — `lib/factory.js`. Belts + crafters on a per-land-claim grid (no global tile grid).
276. **Brawl 1v1 (Sifu profile)** — `lib/brawl.js`. Purpose-built fist-combat profile, in-memory ephemeral.
277. **Restaurant Diner-Dash management** — `lib/restaurant.js`. Time-pressure tipping curve.
278. **Anthropic-skills adapter** — `lib/skills/anthropic-skills-adapter.js`. Import Claude/Anthropic skills as in-world agent skills.

### AE. Self-verification infrastructure (beyond detectors + cartographer)
279. **verify-brain-wiring** — `scripts/verify-brain-wiring.mjs`. "Are all five brains wired to their Ollamas?"
280. **verify-prod-flags** — `scripts/verify-prod-flags.mjs`. Boot-time asserter that prod is in the intended security posture.
281. **verify-resource-allocation** — `scripts/verify-resource-allocation.mjs`. "Will the brains + Concordia's slice actually FIT on the one Blackwell GPU?"
282. **audit-wiring (built-but-not-wired)** — `scripts/audit-wiring.js`. Finds engines that exist but were never put on a clock/route.
283. **cross-branch cartographer audit** — `scripts/cross-branch-audit.js`. Cartographs *every* Claude branch on origin to surface unmerged novelty.
284. **synthetic-journey probe runner** — `scripts/synthetic-journey-probe.mjs`. Drives synthetic user journeys end-to-end.
285. **check-doc-claims** — re-runs every numeric claim's reproduction command and fails on drift (keeps the docs honest).
286. **grade-macro-depth (honest + generous)** — `scripts/grade-macro-depth.mjs`. Behavioral-coverage grader with an explicit anti-gaming `--honest` mode.

### AF. Remaining substrate surfaces
287. **Foundation Market — physical-layer marketplace** — `lib/foundation-market.js`. Trade in signal-layer/physical goods.
288. **World Organizations** — `lib/world-organizations.js`. Guilds, parties, mentorship, recruitment as one graph.
289. **Oracle Engine — multi-phase world-narrative reasoning** — `lib/oracle-engine.js` + `narrative-bridge.js`. Enriches LLM narration with authored canon, structurally omitting NPC secrets.
290. **World-event auto-scheduler** — `lib/world-event-scheduler.js`. Generates recurring world events on cadence.

### AG. Frontend-experience novelties + the custom model
291. **Agent-disclosure badge** — `components/.../AgentDisclosureBadge.tsx`. A hard AI-disclosure chip rendered *wherever* an autonomous agent appears (the visible half of the disclosure substrate).
292. **Drift Moodboard** — `components/.../DriftMoodboard.tsx`. Listens for `world:drift-alert` and renders the corpus's *contradictions as a visual moodboard* — epistemic drift turned into ambient art.
293. **"The System" — diegetic push status layer** — `components/.../SystemFeed.tsx`. A Solo-Leveling-style in-world status surface driven by real backend events.
294. **Generative-adaptive music score bridge** — `components/.../AdaptiveScoreBridge.tsx`. The soundtrack reacts to play, generatively.
295. **Emergent event feed (20-channel)** — `components/world/EmergentEventFeed.tsx`. Surfaces 20 normally-silent simulation channels (deaths, dreams, drift, faction war…) as a filterable feed.
296. **World-anchored 3D damage/impact billboards** — `components/.../{DamageBillboard,ImpactMomentumBridge}.tsx`. 3D-projected numbers + the bone-momentum impact model surfaced to the client.
297. **Village gossip feed** — `components/.../VillageGossipFeed.tsx`. Emergent NPC gossip surfaced to the player.
298. **City creator-streaming + live co-presence** — `lib/city-streaming.js`, `city-presence.js`. Spatial-chunked live presence + a creator broadcast layer.
299. **BYO router** — `lib/byo-router.js`. Per-call routing between the local brains and a user's own external API keys (per-slot override).
300. **Custom "concord-conscious" model** — `lib/brain-config.js`. A persona-fine-tuned conscious brain (its Modelfile SYSTEM carries the voice), distinct from the 4 stock models — the platform ships its own model, not just prompts.

---

### AH. The professional pure-compute domain layer (real formulas, not LLM-guessed)
> A standout in aggregate: Concord ships deterministic, profession-grade calculators for *dozens* of fields. The notable standouts:
301. **Real double-entry accounting** — `domains/accounting.js`. Trial balance, P&L, invoice aging, budget variance, rent roll.
302. **NEC electrical code calculation suite** — `domains/electrical.js`. National Electrical Code calcs (ServiceTitan-shape).
303. **Aircraft weight & balance** — `domains/aviation.js`. Loading stations (pilot/copilot/fuel) → CG envelope — real flight-planning math.
304. **Trade calculators** — `domains/{carpentry,construction,plumbing,hvac,masonry,welding,diy,homeimprovement,landscaping}.js`. Board-foot, takeoff + schedule critical-path, pipe sizing, joint strength — contractor-grade.
305. **Earth-science calculators** — `domains/{geology,forestry,mining,energy,agriculture,environment,ocean}.js`. Rock classification, timber volume, ore-grade + blast design, solar estimate, crop rotation, wave/salinity.
306. **k-anonymity / re-identification risk** — `domains/anon.js`. Real privacy math, not a toggle.
307. **Multi-framework ethical evaluation** — `domains/ethics.js`. Evaluates a dilemma across several ethical frameworks + stakeholder analysis.
308. **Music-theory + audio analysis** — `domains/music.js`. BPM + key detection via signal analysis, harmony.
309. **Poetry + linguistics analysis** — `domains/{poetry,linguistics}.js`. Meter/rhyme-scheme/form + readability/morphology.
310. **Clinical compute** — `domains/{pharmacy,emergencyservices,mentalhealth,healthcare}.js`. Dosage, triage/dispatch, mood tracking, drug interactions.
311. **Legal compute** — `domains/law.js`. Case analysis, statute lookup, deadline calculation.
312. **Research compute** — `domains/research.js`. Citation-network analysis + methodology scoring.
313. **No-code Custom Lens Builder** — `domains/custom.js`. Users compose their *own* lenses (schema/template/validation) — the platform is self-extending by end-users.
314. **No-code Foundry game-builder** — `domains/foundry.js`. Build whole game-worlds without code.
315. **Q&A + bounty platforms** — `domains/{answers,bounties}.js`. Stack-Overflow + Gitcoin/HackerOne parity backends.
316. **Legacy-system tech-debt computation** — `domains/legacy.js`. Quantifies technical debt.
317. **Day-One-parity journaling + quantified productivity** — `domains/daily.js`.
318. **Commonsense plausibility reasoning** — `domains/commonsense.js`. Plausibility checks (the "would this actually happen?" layer).
319. **Orbital mechanics / astrodynamics** — `domains/space.js`. Orbit calc, delta-V budgets, launch windows.
320. **Urban planning compute** — `domains/urbanplanning.js`. Zoning, walkability, density, traffic models.
321. **Telecom network planning** — `domains/telecommunications.js`. Link-budget / coverage calculators.
322. **Veterinary clinical calculators** — `domains/veterinary.js`. Triage, weight-based dosing.
323. **Voice stack** — `domains/{voice,voice-tts}.js`. Transcript analysis + speaker diarization + ElevenLabs-backed TTS.
324. **Extended real free-data wires** — `domains/{society,wikipedia-search,scholarly-apis,civic-data-apis}.js`. World Bank societal indicators, Wikipedia full-text, academic APIs — more genuine public sources.
325. **Critical-path / Gantt temporal analysis** — `domains/timeline.js`. Real CPM scheduling.
326. **Engineering Standards Library** — `domains/standards.js`. Codified standards lookup surface.

---

## How this inventory was built (and how to extend it)

Method: a full-tree sweep — mining the leading `//`/`/** */` header comment of every
file under `server/{emergent,lib,domains,routes,workers,governance,scripts}`,
`server/migrations`, and `concord-frontend/{lib,hooks,components}`, plus targeted
greps for distinctive algorithm/mechanism keywords. To extend: re-run a header sweep
over any region not yet exhausted (the ~250 remaining domains + 690 tables each carry
a long tail of 1–2 distinctive macros/columns), dedupe against the entries above, and
append a new lettered group. The realistic ceiling if exhaustively enumerated is
**~325–375**; this doc captures the load-bearing majority.

## Count & honest caveat

**~326 distinct entries** across 34 groups — vs the cartographer's curated ~20. The
gap is deliberate: `NOVEL.md` lists the *headline* primitives; this doc captures the
breadth, including the supporting mechanisms and the couplings.

Caveat (same as the header): "novel" = distinctive/unusual or distinctively-composed,
grounded in the cited file. It is not a claim of global-first invention for each item,
and a handful (e.g. the Foundation signal-layer, some emergent-civilization systems)
are **research-grade / aspirational** — built and wired, but not all battle-tested
against the physical world. Read each against its source file before quoting it
externally. The conservative, defensible framing remains: *the invention is the
combination × depth × the couplings between systems*, not any single checkbox.

