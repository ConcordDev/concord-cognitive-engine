# Full-Scale RPG Research & Concord/Concordia Audit

**Date:** 2026-09-22
**Scope:** (A) what the industry means by "a modern full-scale single-player open-world RPG," sourced; (B) a read-only, evidence-based audit of Concord Cognitive Engine's backend + the Concordia Unity client against that bar; (C) this synthesis.
**Method:** Two independent research passes (web research, and direct codebase reading — grep/read/tests, no code changes) were run in parallel, then cross-referenced by hand for this document. Full raw outputs are preserved at `~/.zuko/_scratch_research_partA.md` (429 lines, 81 sources) and `~/.zuko/_scratch_audit_partB.md` (984 lines) if you want the unabridged version of either half.

---

## 1. Executive Answer

A full-scale single-player open-world RPG is a game that gives players a large, continuously-traversable world with real structural agency over what to do and in what order, layers systemic simulation (economy, factions, NPC schedules, reactive world-state) on top of authored content so the world behaves when unobserved, and wraps all of that in classic RPG pillars — a persistent build, branching choice-with-consequence, and long-form progression. Shipping one, historically, has taken somewhere in the 100s-of-people / 3.5–5-year range (Witcher 3: ~240 core / ~1,500 total, 3.5 years; Cyberpunk 2077: 50→500+, ~4–5 years) — or, absent that scale of team, purpose-built tooling that multiplies a smaller team's throughput.

Concord/Concordia today is a genuinely engineered **early vertical slice**, not yet an alpha, with an unusual amount of honest self-instrumentation. The parts that are real are *very* real: `ContinentStream`'s LOD-streaming/`SoftEnter` travel system is automated-test-proven and well-architected; the melee combat core (`HitResolver`/`ActionRunner`/`Hostile`) is a genuine frame-data fighting-game-style engine with an explicit "resolution computed first, animation reads the result" discipline; procedural settlement generation is tested; and — most notably — there is one real, instrumented, working "living-world" loop: kill an NPC → the world marks it dead → a nearby NPC gossips about it → the Hub remembers it on return. That loop is Concord's actual differentiator, proven, not vaporware.

But it is narrow, not yet a template. Almost everything else a full-scale RPG needs is SCAFFOLD or ABSENT in the Unity client specifically (the backend is much deeper — see §4/§9): progression is a VFX-path lookup table wearing the name "SkillLattice"; factions/reputation is one decaying float per world; a ~9,000-LOC crafting/gunsmithing/vehicle/fabrication system is wired into the input path but has zero discoverable content that would ever trigger it; animation coverage is self-audited at 0% for magic, firearms, bosses, creatures, and social/daily/work verbs, 10% for combat, 23% for locomotion; there is no accessibility, no localization, no mount-riding code behind the one mount prefab that exists, and no companion/party system beyond a read-only HUD number. And the single most load-bearing fact discovered in this audit is operational, not architectural: **the entire Unity working tree — including everything just described as "real," including the proof file for the living loop itself — is uncommitted**, sitting in one disk-pressured pod (49 modified files, 139 untracked new files/directories, 13,721 pending deletions, `git status` clean history stopping at commit `d0a1bb341`, 2026-09-17). If that pod is lost, this audit's "PROVEN" findings are lost with it.

---

## 2. Full-Scale RPG Definition + Maturity Model

**Working definition** (synthesized across multiple sourced framings — full citations in §10 / the source appendix): a full-scale open-world RPG (a) presents a spatially continuous or seamlessly-streamed world rather than discrete levels, (b) gives the player structural agency over what to pursue and in what order, (c) layers systemic simulation on top of authored content so the world evolves when not directly observed, and (d) carries RPG-specific pillars — persistent character build, choice-with-consequence narrative, long-form progression — that distinguish it from open-world games in other genres. A "systemic sim" (RimWorld/Dwarf Fortress) is an adjacent, not identical, category — full-scale RPGs borrow its emergent-narrative-via-interacting-systems *technique* without being one.

**Staged maturity model** (no single canonical industry definition exists — this is the most commonly converged-upon version across multiple sources, each stage's exit criteria stated as a checkable condition, not a vibe):

| Stage | Purpose | Exit criteria |
|---|---|---|
| **Prototype** | Validate the core loop is fun, cheaply, before committing art/content budget | Core verb-set demonstrably engaging in placeholder form; major technical risks (e.g. "can we stream this scale at all") have a proof-of-concept answer |
| **Vertical Slice** | Prove one fully-realized chunk (final-quality art+audio+programming together) justifies scaling up | One region shows real quest state-tracking + one combat encounter + one branching-dialogue example + target streaming/perf behavior simultaneously — not a demo reel |
| **Alpha / Content Production** | Build full content volume on validated systems | All main systems implemented, playable start-to-finish; final assets/VFX/full content volume not yet in place; bugs expected |
| **Content Complete** | All authored content exists in the build | No new content being added; remaining work is bugfix/tune/optimize; quest/dialogue state-tracking is author-final |
| **Beta** | Stabilize a feature-and-asset-complete build | Feature+asset complete, only bugs being fixed; wide external testing; long-run soak testing of save/persistence under high accumulated state |
| **Shippable (Gold)** | Release candidate | Profiled and passing on actual minimum-spec target platform; Basic-tier accessibility present |

**Where Concord/Concordia sits:** past Prototype (the core verbs — move, fight, travel, gossip — are proven fun-adjacent and technically real), but **not yet at a stable Vertical Slice**, because the one thing Vertical Slice explicitly requires — one region with quest-tracking + combat + branching dialogue + target perf, proven *together*, *reproducibly* — doesn't exist: what exists is several separately-probed slices (LIFE_PROOF steps A–F), the perf-proof work order's own audit says "inconclusive-until-play-run," and none of it is committed to version control, so "reproducible" is currently false by definition.

---

## 3. Capability Matrix (Research Bar)

Condensed from the full 40-row matrix in `_scratch_research_partA.md`; **Essential** = required to credibly claim "full-scale open-world RPG," **Optional-AAA-breadth** = raises the bar but isn't required to be a real RPG.

| Capability | Tier | Acceptance criteria | Common failure mode |
|---|---|---|---|
| Open, freely-traversable world | Essential | Spatially continuous or seamlessly streamed; player chooses order/approach | Hub-and-spoke marketed as "open"; hidden load boundaries |
| Systemic world-simulation layer | Essential (some layer) | ≥1 system evolves/reacts unobserved (verifiable by leaving & returning) | Purely reactive world masquerading as systemic |
| Legible core loop (micro/session/macro) | Essential | Loop stays engaging over dozens of hours; quest scope readable before commit | Loop satisfying at only one time-scale |
| World scale matched to density | Essential (density); size Optional | POI variety/quality per area supports the loop | "Map-icon soup" |
| Traversal systems | Essential (movement); mounts/verticality Optional | Time-to-content within session-legibility bounds | Fast travel trivializing exploration |
| Streaming/terrain tooling | Essential (some pipeline) | No player-visible load screens inside "open" area | Visible pop-in / blocking-load stutter |
| Quest architecture (design→script→state→QA) | Essential | Completable regardless of order/build; cross-quest state reads consistently | Softlocks; quest-owner silos; fetch-quest filler |
| Data-driven/tooled quest system | Optional→near-Essential at scale | Non-programmers can author/iterate | System so rigid content needs engineering per quest |
| Branching dialogue w/ persistent state | Essential (some branching+memory); BG3-scale Optional | Later content reacts to earlier choices; state read correctly across systems | "Illusion of choice"; state set by one system never read by another |
| Full voice acting at scale | Optional-AAA-breadth | Coverage proportional to script size if claimed | Partial VO marketed as "fully voiced" |
| Scoped per-faction/per-region reputation | Essential if claimed | NPCs react (dialogue/price/quest gating); recovery path exists | Flattened global karma; cosmetic-only "wanted" status |
| Witness-gated crime | Optional-AAA-breadth | Detection requires plausible observation | Omniscient guards |
| Combat satisfying across full playtime | Essential | Enemy/systemic variety sustains dozens-to-hundreds of encounters | Reskinned "damage sponge" enemies |
| Boss encounters w/ distinct characterization | Essential if bosses claimed | Read as personalities, not stat-inflated regulars | Stat-sponge bosses |
| Persistent-enemy/nemesis memory | Optional-AAA-breadth | Narratively surfaced back to player, not silently tracked | Memory tracked but never surfaced |
| Branching, build-defining progression | Essential | Playthroughs mechanically distinct, not just numerically stronger | Builds converging on one optimal path |
| Crafting/equipment gating exploration | Essential if claimed | Materials/economy gate meaningful content | Crafting present but practically ignorable |
| Balanced currency economy | Essential (basic) | Currency retains value through midgame+ | Unmanaged faucets → late-game meaninglessness |
| Legible NPC daily schedules | Essential for "living world" claims | Readable routines, not static idle loops | NPCs visibly on rails |
| Stable per-object save identity | Essential | Every world-mutable object round-trips on save/load | Silent persistence failures → softlocks |
| Save/live-object separation (DTO) | Essential | Save data is a decoupled snapshot | Brittle saves that break across refactors |
| Save versioning | Essential for patched/live titles | Old saves load or migrate across patches | Saves broken by a content patch |
| Team/timeline commensurate with scope | Essential (reality check) | ~100s of people, multi-year, for AAA full scale | Content lagging world-scale ambition |
| Basic-tier accessibility | Essential (launch-critical) | Remappable controls, subtitles, difficulty options, readable contrast | Deferred to post-launch despite low cost |
| Intermediate-tier accessibility | Optional-AAA-breadth | Assist modes, mid-game difficulty change | Fixed subtitle style breaking non-source languages |
| State-reactive music/audio | Essential (basic) | Legible shift at combat start/major choices | Static loop through major state changes |
| Camera preserving spatial awareness + animation legibility | Essential | No persistent clipping/lock-loss | Camera clipping through geometry |
| Performance budget w/ streaming headroom | Essential | 95th-pct frame time within target incl. streaming I/O | Frame drops in dense areas |
| Perf validated on actual min-spec platform | Essential | Profiled on lowest-spec target, not dev hardware | Underperforms on real console/min-spec |
| Phase-scaled QA staffing | Essential | Headcount scales with dev phase (3–10 early → 50–200+ at alpha) | Fixed small QA team regardless of scale |
| Automated regression testing | Essential at full scale | Meaningful share (~50% cited industry figure) of blocker/critical bugs caught pre-manual-QA | No automated safety net |
| Staged production plan w/ checkable exits | Essential (process) | Each stage has a defined, checkable exit criterion | Skipping vertical-slice validation |

---

## 4. Concord/Concordia Audit Matrix

Status legend: **PROVEN** (code + evidence it works end-to-end, e.g. a passing test or a traced call chain) · **IMPLEMENTED-NOT-PROVEN** (real, complete-looking code, no evidence it's been exercised) · **PARTIAL** (real pieces, real gaps) · **SCAFFOLD** (names/structure exist, substance thin) · **ABSENT**.

| Dimension | Status | Key evidence |
|---|---|---|
| Playable core loop | PARTIAL (one slice PROVEN) | `AURA_LIFE_PROOF.txt` traces move→fight→kill→gossip→return end-to-end once; no single continuous scripted session covering quest chain + save/reload |
| World streaming / SoftEnter / ContinentStream | **IMPLEMENTED, PROVEN by automated test** | `ContinentStream.cs` (895 LOC), `ChunkReadiness` state machine w/ generation-counter race protection; `ContinentStreamPlayModeTests.cs` 2 `[UnityTest]`s with falsifiable assertions |
| Traversal | PARTIAL | Ground movement + fast travel real; **mounts SCAFFOLD** (`CX_Mount_Horse.prefab` exists, zero riding-logic `.cs` found) |
| Quests | PARTIAL, self-admitted narrow | `HubObjectives.cs`'s `QuestLog` is real state-machine logic; content is authored JSON per world; **team's own doc says "not the server quest engine"**; `QuestLog.Done`/`.Active` are `static` in-memory fields — no persistence write found |
| Dialogue | PARTIAL / IMPLEMENTED-NOT-PROVEN | Real WebSocket round-trip to backend LLM (`ConcordClient.AskTwoB`); `GossipEar` proximity-reactive propagation is real and proven; no branching-choice UI or persisted choice-history beyond one rolling `LastEvent` string per world |
| Choices/consequences | PARTIAL, PROVEN for one path | Kill→memory→gossip chain is real and verified; no evidence of dialogue-choice-driven or faction-siding branching consequences |
| Factions/reputation/crime | SCAFFOLD-to-PARTIAL | `factionHeat`: one decaying float per world; no `Faction.cs`/`Crime.cs`, no guard AI, no per-faction standing — thinner than the backend's real `server/lib/hooks.js` CK3-leverage system, which Unity hasn't surfaced at all |
| Combat (Hostile/HitResolver/CombatMotion/CombatFeel) | **IMPLEMENTED, well-built**; bosses **ABSENT** | `HitResolver` (i-frame→parry→block→hit precedence, explicit "resolution before animation" discipline); `ActionRunner` (ms-precision phase machine w/ input buffering); one real kill proven; 0/16 boss verbs animated |
| Progression (skill trees/builds) | **SCAFFOLD** | `SkillLattice` is a one-method VFX-path lookup table, not a build/talent system; no skill-point economy, no respec |
| Items/gear/loot/crafting/economy | PARTIAL — real wiring, **illusory content reach** | `CharacterGear` real & used; `RoadWorld.DropSpoils` proven; ~9,000 LOC `GameplayCore` Fabrication/Gunsmithing/Spellcrafting/Vehicles/Containers is wired into the live input cascade but **zero** spawnable content instances found anywhere in authored worlds |
| NPC schedules/needs/memory/gossip | PARTIAL, real but simple | `NpcLife.cs` real schedule state machine (sleep/work/eat/gather/hide, interruptible); memory is **world-scoped, not per-NPC** — NPCs read a shared slice, not individual memories |
| Settlements | **IMPLEMENTED, tested** | `SettlementCompiler.cs` (906 LOC) procedural plot→module→facade→roof pipeline; 21 tests across 3 files |
| Ecology | PARTIAL | Single scalar dial (`ecology` float, +0.01/hr, gates a births trickle >0.55) — not per-species simulation despite separate `EvoCatalog`/`EvoSpawner`/`CreatureCompiler` files existing unread |
| Companions/party | mostly **ABSENT** | `PartyLine`/`PartyCount` are a read-only HUD mirror of a server-reported number; no companion AI/follow/dialogue |
| World persistence | **PROVEN, split** | Two independent real JSON-to-disk save systems, both now confirmed with substantial real data on disk (`concordia-living-v1.json` 44,575B, `concordia_world_simulation.json` 108,789B, `concordia-unified-v1.json` 103,340B, all timestamped to the same LIFE_PROOF session) — no reconciliation layer between them. One file (`concordia_worldsystems.json`, 32B) corroborates the separate finding that the WorldSystems economy layer is thin/unreached |
| Authoring tools/pipelines | **IMPLEMENTED** | Real Editor tooling: `AnimationCoverageAuditor`, `CxBake`, `PolyHavenPipeline`, `SettlementCompiler`'s own procedural generation |
| Unity ↔ Concord backend presentation | PARTIAL, honestly self-measured | Team's own doc: 239 REST endpoints exist, **0 consumed** by Unity (WebSocket-only by design); ~30+ of 117 realtime broadcast events consumed |
| UI/UX | PARTIAL | `ConcordiaHUD.cs` real; no accessibility features found |
| Accessibility | **ABSENT** | Zero colorblind/remap/screen-reader/caption groundwork found |
| Localization | **ABSENT** | Zero `i18n`/`localiz*` hits; all strings hardcoded English literals |
| Audio | PARTIAL | Real per-surface footsteps, real CC0 UI SFX; no runtime cutscene/Timeline system wired to gameplay events |
| Graphics/animation/camera | PARTIAL, honestly self-quantified | `COVERAGE.md` (self-audited, 442 tracked verbs): `facial`/`procedural`/`secondary` 100%, `gear` 80% — but `firearms`/`magic`/`creatures`(124 missing)/`boss`/`monsters`/`social`/`daily`/`crafting` **0%**; `locomotion` 23%, `combat` 10% (the two most player-visible categories, both weak). Self-check reports **zero fabricated "real" tags** — a strong honesty signal |
| Performance/profiling | PARTIAL, **not yet measured** | Tooling exists; newest work order's own audit: *"performance audit says inconclusive-until-play-run"*; no perf-proof artifact exists anywhere |
| Build/CI | **UNVERIFIED** (leaning absent) | No Unity CI workflow found in a non-exhaustive pass |
| Automated QA | PARTIAL | 12 real test files, ~79 `[Test]` assertions — genuine, not smoke-only — but no evidence they run in CI |
| Player-facing QA | UNVERIFIED as a process | Dated QA-cycle notes exist but read as more agent self-audit, not independent human playtesting |
| Architecture seams | Mixed, some self-documented | GameplayCore ↔ legacy Concordia is deliberately additive (own doc comment); a **second, parallel, confirmed-unused** `CombatDefenseEvaluator` exists; backend quest engine and Unity `QuestLog` are confirmed independent systems |

---

## 5. Integration Seams and Critical End-to-End Chains

**The one real cross-system chain, traced fully:** `TrainingDummy` damage/death → `WorldClock.NoteKill`/`KillLine` → `WorldMemory.MarkDead` (per-world, keyed by name) → `RoadWorld.DropSpoils` + `RoadWorld.NoticeKill` → `GossipEar` (proximity, one-shot, sets `WorldClock.LastEvent` + pushes a feed entry) → `ContinentStream.SoftEnter` back to Hub, which snapshots/restores the kill-line specifically so a "you came home" journey stamp doesn't overwrite the kill chronicle. This is Concord's differentiator, and it's real — not a doc claim, a traced call chain with an instrumented probe run backing it.

**Seams that are real but deliberately narrow:**
- **GameplayCore ↔ legacy Concordia**: additive by explicit design (`GameplayCoreBridge.cs` doc comment: "Existing Concordia systems remain authoritative"). `Hostile.cs` itself confirms which combat-defense system is actually live: `Core.HitResolver`, not `GameplayCore.CombatDefenseEvaluator` — the second evaluator exists, is wired, and is a documented no-op on the real combat path.
- **Unity ↔ Concord backend**: everything rides one WebSocket by staged design (239 REST endpoints exist server-side, 0 used by Unity), not by oversight — the team's own wiring-plan doc frames this as a deliberate multi-phase migration off a prior Three.js/REST client.
- **Backend quest engine ↔ Unity QuestLog**: confirmed, self-admitted as two independent systems. The backend's real `server/emergent/quest-engine.js` (prerequisite chains, breadcrumb protocol, LLM-authored dialogue, per CLAUDE.md) is not what drives Unity's quest boards; Unity's boards present authored, static JSON text.
- **Two persistence systems, no reconciliation**: `WorldMemory` (JSON, proven exercised) and `ConcordiaPersistenceService` (separate JSON envelope, `IMPLEMENTED-NOT-PROVEN`, plausibly covering GameplayCore systems that have no content to actually persist yet).

**The critical missing seam:** the backend's actual richest systemic-simulation model — `server/lib/hooks.js`'s CK3-style leverage/coercion system, `npc_nemesis` relationships, per-faction reputation caching, the full DTU/royalty substrate — is documented at length in CLAUDE.md as real and load-bearing server-side, but **none of it is surfaced in the Unity client**, which instead reinvented a much thinner parallel model (`factionHeat`, one string of `LastEvent`, world-scoped not NPC-scoped memory). This is worth a deliberate architecture decision, not organic drift: either surface the backend's real systems through the existing WebSocket gateway, or consciously accept the client-side model is meant to stay simpler.

---

## 6. Player-Visible Gaps vs. Technical Gaps vs. Content-Production Gaps

**Player-visible gaps** (a player would notice immediately):
- No boss fights (0/16 boss verbs animated, no boss-specific code)
- No magic, no firearms animation (0% coverage each) despite `Spellcrafting`/`Gunsmithing` code existing
- Combat move variety is thin (10% real-clip coverage; most hits likely fall back to procedural)
- No mount riding (the horse exists, you can't ride it)
- No companions/party beyond a HUD number
- Factions/reputation read as a single invisible dial, not a system
- No accessibility options, no localization (English-only, hardcoded strings)
- Progression has no visible build/talent choice

**Technical gaps** (invisible to a player, but block everything downstream):
- Entire working tree uncommitted, disk-pressured (§1) — the single highest-priority item, full stop
- No Unity CI; the team's own automated Test Runner path timed out and was abandoned in favor of manual probes for the most recent proof
- Two unreconciled persistence systems — both now confirmed writing substantial real data to disk (§4), which makes reconciling them more urgent, not less: a divergence between them is now a divergence in live data, not a hypothetical
- A confirmed-dead parallel combat-defense evaluator shipping alongside the live one
- Performance genuinely unmeasured (`applyTargetFrameRate=false`, audit says "inconclusive-until-play-run")
- No look-at/aim IK system found at all

**Content-production gaps** (systems exist, content to drive them doesn't):
- GameplayCore's Fabrication/Gunsmithing/Spellcrafting/Vehicles/Containers (~9,000 LOC, live-wired) has zero spawnable content anywhere in the authored worlds — this is the single largest "built but inert" asset in the whole audit
- Animation coverage 0% across magic/firearms/creatures/bosses/monsters/social/daily/crafting/work verbs — a content-authoring backlog, not an engineering one (the binding mechanism, `_clipsFit`, is real)
- Quest content exists only as hand-authored JSON per a handful of worlds; no procedural/tooled quest generation
- Ecology is a single scalar, not per-species simulation, despite adjacent unread files (`EvoCatalog`/`EvoSpawner`/`CreatureCompiler`) that may already contain more

---

## 7. Top 10 Blockers, Ranked by Dependency Order

1. **Stabilize the working tree.** Commit the current state (or at minimum resolve the disk-pressure crisis and get a clean snapshot preserved) before anything else — every other finding in this report describes code that currently exists in exactly one uncommitted, actively-shrinking-on-disk location. This blocks nothing technically but risks losing everything.
2. **Get Unity automated tests running reliably (fix whatever caused Test Runner to time out).** The team's own most recent proof run fell back to manual probes specifically because the automated path failed — that's a regression in verification capability, and every claim after this point should be CI-checkable, not probe-checkable.
3. **Reconcile the two persistence systems into one source of truth.** Both are now confirmed writing substantial real data to disk (`concordia-living-v1.json`, `concordia_world_simulation.json`, `concordia-unified-v1.json`), so this is no longer a "cheaper to fix before it matters" item — it's live data at risk of silent divergence now.
4. **Close out the in-flight animation-binding work order** (`AURA_FINISH_EVERYTHING.txt`/`AURA_GLIDE_MOTION_POLISH.txt`) — produce the required `FINISH_REPORT.txt`/`AURA_GLIDE_PROOF.txt` proof artifacts, or explicitly mark the work stalled and re-scope it. This blocks any credible claim about locomotion/combat feel quality, which gates nearly every player-visible polish item above it.
5. **Wire real spawnable content into GameplayCore's Fabrication/Gunsmithing/Spellcrafting/Vehicles/Containers.** This is the highest-leverage single unlock in the whole audit — ~9,000 LOC of tested, wired, professionally-structured code sitting completely unreachable behind a content gap, not an engineering gap.
6. **Build a real progression system** to replace `SkillLattice`'s VFX-lookup-table stand-in — player agency (Essential capability-matrix item) currently doesn't exist in any mechanically meaningful form.
7. **Build a real faction/reputation/crime system**, replacing the single `factionHeat` scalar — another Essential-tier capability-matrix gap, and the backend already has a genuinely richer model (`hooks.js`) to draw from instead of reinventing.
8. **Generalize the living-loop mechanism** (see §9) from "kill→gossip→memory" into a reusable template covering quest completion, dialogue choices, and faction shifts — this is what turns Concord's proven differentiator into an actual repeatable game system instead of one demoed path.
9. **Decide and execute the quest-engine question**: either connect Unity to the real backend `quest-engine.js`, or formally commit to client-only authored quests and build real persistence for `QuestLog` state (currently `static` in-memory, likely lost on domain reload).
10. **Accessibility, localization, and real performance validation on target hardware.** Correctly last — these are launch-checklist items per the maturity model, not alpha blockers — but currently at zero investment, and Basic-tier accessibility specifically is cheap enough that deferring it further has no good justification once the above is stable.

---

## 8. Roadmap: Vertical Slice → Alpha → Content Complete → Beta → Ship

**Current position:** past Prototype, attempting Vertical Slice, destabilized by the working-tree/CI issues in §7.

- **Stabilize Vertical Slice (immediate):** commit the tree, restore automated-test reliability, reconcile persistence, close the animation-binding proof. Exit criteria: one committed, CI-passing build demonstrates move→combat→a full authored quest→SoftEnter round trip→save→reload, reproducibly, not as a one-off probe log.
- **Alpha / Content Production:** connect GameplayCore content (blocker #5), build real progression (#6) and faction (#7) systems, generalize the living-loop template (#8), resolve the quest-engine question (#9). Exit criteria: all main systems (quest, save, reputation, progression) functionally present end-to-end even with content volume still low.
- **Content Complete:** author quest/dialogue/area volume against the now-stable systems; animation-coverage backlog (magic/firearms/creatures/bosses/social) gets filled here, not before — filling it against unstable systems would mean re-authoring later. Exit criteria: no more new content being added; quest/dialogue state-tracking is author-final.
- **Beta:** wide playtesting; long-run soak-testing of the (by-now-unified) save system under high accumulated state — the genre's hardest QA problem per the research (§3); accessibility (#10) and localization groundwork lands here, not at the end.
- **Ship:** performance profiled and passing on actual minimum-spec target hardware (not dev machines); Basic-tier accessibility present at launch.

---

## 9. Making the Living-World Cascade a Repeatable Loop, Not a One-Off Demo

The kill→spoils→gossip→Hub-remembers chain is real, proven, and is Concord's actual point of differentiation from a generic open-world RPG — but right now it is **one hardcoded path**, not a system. Three structural facts limit it from generalizing on its own:

1. **`WorldMemory` stores a single rolling `LastEvent` string per world**, not a queue or a set of concurrent memory threads. A second notable event before the first is gossiped will silently overwrite it. This is the single biggest structural ceiling on the mechanism — it needs to become a bounded queue/log, not a scalar, before more than one kind of event can be "remembered" at once.
2. **Memory is world-scoped, not per-NPC.** Every NPC in a world currently reads/writes the same shared slice. That's fine for "the world remembers a notable death," but it caps how personal or targeted gossip/reaction can ever feel — an NPC can't hold a grudge specifically, because there's nowhere for a specific grudge to live client-side.
3. **Only kills feed the chain today.** Quest completions, dialogue choices, and faction-standing shifts do not currently write into `WorldClock.LastEvent` or trigger `GossipEar`-style propagation — the mechanism exists but is plumbed to exactly one event type.

The good news: the backend already has the richer model this needs to grow into. `server/lib/hooks.js` (CK3-style leverage: strong/weak hooks, inheritance on death, generated from secret discovery) and `npc_nemesis` (per-NPC, per-world relationship rows with real decay/promotion heartbeats) are real, tested, documented server-side systems — Concord doesn't need to invent per-NPC memory or richer reputation from scratch, it needs to **surface what the backend already computes** through the same WebSocket gateway that already carries `ApplyKingdom`/`PresentFuneral`/`ApplyCombatFeel` events. That reframes blocker #8 from "build a new system" to "extend `WorldMemory`'s event model to accept more event types, then wire the client to read the backend's existing per-NPC hook/nemesis state instead of reinventing a thinner client-only version." That's a meaningfully smaller lift than it first appears, and it's the highest-leverage design move available: it turns one proven demo into the actual backbone of the "living world" claim.

---

## 10. Sources

Full 81-source list with per-claim annotations lives in `~/.zuko/_scratch_research_partA.md` §"Full Source List" (preserved, not deleted). Highest-value primary/GDC sources used for the capability matrix and maturity model above:
- CD Projekt Red quest-design evolution (Witcher 3 → Cyberpunk 2077), Game Developer — primary quotes on quest ownership, outcome-not-failure design, cross-discipline coordination cost at scale
- GDC Vault — Nemesis System talks (Monolith, Shadow of Mordor/War) — the strongest documented precedent for persistent-enemy memory
- GDC Vault — Streaming in Sunset Overdrive's Open World; Ghost Recon Wildlands Terrain Tools — streaming/tooling-at-scale case studies
- Game Accessibility Guidelines (Basic/Intermediate/Advanced tiering) — the accessibility acceptance-criteria source
- Ardenfall / Hedberg Games / Intelligent Artifice — save-architecture practitioner sources (static/dynamic object taxonomy, DTO pattern, versioning)
- KCD/KCD2 crime-and-reputation (5 independent secondary sources, cross-corroborated, no primary developer source found)
- PC Gamer / PCGamesN / Ask A Game Dev — team-size and budget anchors (Witcher 3, Cyberpunk 2077, general AAA scale)

Notable **research gaps** flagged by the research pass rather than papered over: Joel Burgess's GDC 2011 exploration-design talk (fetch failed, existence only, not content-verified), fast-travel design has no single canonical primary source, Witcher 3 budget figures diverge $14M+ across outlets, FromSoftware has no located GDC talk on boss/AI design, streaming/performance-budget was the weakest-sourced of the 15 research topics.

---

## 11. Limitations of This Audit

- **This is a snapshot of an actively-changing, uncommitted working tree.** Given §1's finding, anything in this report could be stale within hours of being written — the pod it was read from is under active disk pressure and mid-deletion of asset packs at the time of the audit.
- **The audit agent did not open the Unity Editor.** Claims about live save-file contents (`~/Library/Application Support/.../concordia-living-v1.json`), actual runtime frame timing, and whether `ConcordiaPersistenceService`'s save path has ever really fired were read from code, not observed live — flagged inline as UNVERIFIED/IMPLEMENTED-NOT-PROVEN rather than asserted.
- **Not exhaustively searched:** CI/build workflows (a quick, not exhaustive, pass found nothing Unity-specific), `EvoCatalog.cs`/`EvoSpawner.cs`/`CreatureCompiler.cs` (named but not read in full — ecology could be deeper than the single-scalar finding suggests), and whether a `LookAt`/`AimIK` system exists under a name pattern not searched for.
- **The research pass (Part A) explicitly excludes any comparison to this codebase** by design — it's a pure external bar, cross-referenced against the audit by hand in this synthesis, not verified against Concord by the research agent itself.
- **Both source documents (`_scratch_research_partA.md`, `_scratch_audit_partB.md`) are preserved unabridged** at the paths given in the header — treat this document as the synthesis, and go to those for the full underlying evidence on any specific claim.
