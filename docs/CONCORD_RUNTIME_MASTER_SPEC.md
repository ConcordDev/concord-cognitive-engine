# Concord Runtime — Master Integration Specification

**Status: IN PROGRESS as of 2026-08-31.** The operator chose to formalize the
Runtime INSIDE the existing Concord backend (server.js) rather than as a new
separate process — Concord's macro system, heartbeat registry, and `/health`
already cover much of what §1 "Runtime Kernel" describes, so this build
extends that kernel rather than replacing it. §17's "separate process /
Concord registers itself in" framing below is explicitly NOT the path taken.

**What's actually shipped (§2/§3/§9, §11 partial):**
- `server/lib/runtime/capability-registry.js` — real capability
  registration/lookup/health-check (`registerCapability`,
  `getCapabilityDescriptor`, `listCapabilities`, `checkCapabilityHealth`).
  In-memory, populated at boot by domains calling `registerCapability()`,
  mirroring how `LENS_ACTIONS`/`MACROS` are already populated — no new
  persistence layer. `checkCapabilityHealth` never trusts a registration's
  claim; it checks the REAL `globalThis.__concordLensActions` /
  `globalThis._concordMACROS` maps, so a stale or typo'd registration
  reports itself honestly as unreachable (the registry's own instance of
  this repo's runtime-truth-over-source-guessing doctrine).
- `server/lib/runtime/execution-envelope.js` — `runCapability(request)`
  implements the ExecutionRequest/ExecutionResult shape from §3. Additive,
  not a replacement for `/api/lens/run` (10,000+ existing macro call sites
  are untouched) — a second, in-process entry point that adds registry
  lookup + event-bus visibility on top of the SAME underlying dispatch
  (`globalThis.__concordLensActions` / `globalThis.__concordRunMacro`,
  both already exposed for exactly this kind of reuse).
- `server/lib/runtime/event-bus.js` — real pub/sub (`publish`/`subscribe`),
  the §9 event taxonomy as a documented (not enforced) reference list,
  per-listener error isolation, and a bounded recent-event ring for
  observability. Node's built-in `EventEmitter`, no new dependency.
- **Predict is the first (and so far only) domain onboarded** —
  `domains/predict.js` registers its 12 macros as real capability
  descriptors with real risk tiers (`predict.promoteAuthority` is the
  repo's first `risk:"high"` capability) and publishes real events
  (`prediction.created`, `prediction.resolved`, `finding.created`,
  `capability.promoted`, `capability.rejected`) at the actual points those
  things happen — not a toy example wired for demonstration.
- `/api/runtime/capabilities`, `/api/runtime/capabilities/:capability/health`,
  `/api/runtime/events/recent` — admin-gated observability routes (§11),
  same `requireRole("owner","admin","sovereign","founder")` convention as
  the existing `/api/admin/*` telemetry surfaces.
- `tests/runtime/capability-registry.test.js` (16), `tests/runtime/
  event-bus.test.js` (10), `tests/depth/execution-envelope-behavior.test.js`
  (7) — 33 new tests, every expected value hand-computed or independently
  derived. Reproduce: `node --test tests/runtime/*.test.js tests/depth/
  predict-*.test.js tests/depth/execution-envelope-behavior.test.js tests/
  lattice-orchestrator.test.js` → 74/74 passing (includes the pre-existing
  predict + lattice-orchestrator suites, re-verified green after the
  wiring, not just the 33 new ones). Live-verified against the real
  production server post-restart (clean boot, `predict.reconcile` still
  answering correctly through the same key/scope from the P0-P7 work).

**Deliberately deferred, not started (correcting the earlier "nothing
built" framing only for what's above — everything else in this doc is
still exactly as aspirational as when it was written):**
- §4 Dila/Zuko as Runtime agents, §6 Pentester Supreme as a domain, §7
  Trading as a monitored domain, §10 the full supervisor tree, §12 model
  abstraction as a Runtime-level router (Concord already has a real
  per-LLM-call version via `brain-config.js#pickBrainEndpoint` — unifying
  that under the capability registry is future work, not done), §17
  website architecture. None of these have code. Onboarding a new domain
  (Dila, Zuko, Pentester Supreme, Concordia, trading) means writing that
  domain's OWN `registerCapability()` calls the way `predict.js` now does
  — there is no shortcut and no fabricated stub for any of them here.
- §16 capability-promotion lifecycle (IDEA→PROTOTYPE→SANDBOX→TESTED→
  SHADOW→VALIDATED→PROMOTED) is NOT a shared/generic library — it exists
  today only as `predict.authorityStatus`/`predict.promoteAuthority`'s own
  concrete implementation (a simplified 5-stage version: IDEA→SHADOW→
  TESTED→VALIDATED→PROMOTED, plus a HALTED safety override the master
  spec's generic ladder doesn't have). Deliberately NOT extracted into a
  shared `capability-lifecycle.js` yet — there is exactly one real
  consumer, and this repo's own anti-premature-abstraction rule ("don't
  design for hypothetical future requirements") argues against generalizing
  from a sample size of one, especially for logic this safety-critical. If
  a second real domain (a pentester capability, a trading strategy) needs
  the same evidence-gated promotion pattern, extract then — with a second
  real caller to shape the abstraction correctly and predict's own tests
  as the regression net for the refactor.
- §8 DTU memory-class formalization (Ephemeral/Episodic/Durable as an
  enforced Runtime concept, not just a documented convention) — not built.

Context at time of writing: Concord Predict's P0 (passive prediction logging
from the live Dila/AutoTrader system) had just shipped and been verified
end-to-end. The operator's framing: now that Concord runs natively on the
Mac (`com.concord.backend`, `com.concord.frontend`, launchd-managed), stop
thinking about each subsystem as something to individually wire together,
and instead define one runtime architecture all of them sit inside.

Systems on record at time of writing (per the operator's own list):
Concord Cognitive Engine/ConcordOS, the DTU substrate, Dila, Zuko, Concord
Predict, Pentester Supreme, the AutoTrader (PPO 19/39/9), the trading
research infrastructure, a fleet architecture (research/scraper/analyst/
trader/writer/verifier workers), Concordia (Unity), the LLM/provider layer,
the Mac-native runtime/failover setup, the Telegram/operator interface, the
deterministic computation substrate, and the research/novelty loop.

---

## Core objective

Create one persistent Concord Runtime on the Mac that treats every
subsystem as a managed capability rather than allowing each subsystem to
independently orchestrate itself.

```
                         CONCORD RUNTIME
                              │
       ┌──────────────────────┼──────────────────────┐
       │                      │                      │
   Identity               Policy/Gates          Runtime State
       │                      │                      │
       └──────────────────────┼──────────────────────┘
                              │
                       EVENT / TASK BUS
                              │
       ┌──────────┬───────────┼──────────┬─────────────┐
       │          │           │          │             │
      Dila      Zuko       Predict    Pentester    Concordia
       │          │           │          │             │
       └──────────┴───────────┼──────────┴─────────────┘
                              │
                     DETERMINISTIC CORE
                              │
        Math / Stats / Simulation / Calibration
                              │
                         DTU MEMORY
                              │
                    MODEL PROVIDER LAYER
```

## 1. Runtime Kernel

The Runtime becomes the permanent parent process. It owns: startup,
shutdown, health, lifecycle, task scheduling, capability discovery, state,
event routing, permissions, resource limits, telemetry, recovery,
provenance.

Nothing important should depend on a random cron job being alive. Cron/
launchd becomes a trigger mechanism, not the architecture itself.

## 2. Capability Registry

Every major subsystem gets a machine-readable capability definition, e.g.:

```
predict.forecast
predict.resolve
predict.calibrate
predict.monte_carlo
predict.historical_analog
security.status
security.start_engagement
security.invoke_capability
security.next_steps
trading.observe
trading.evaluate
trading.execute
concordia.world
concordia.simulation
concordia.asset
dtu.create
dtu.retrieve
dtu.resolve
dtu.calibrate
agent.dila
agent.zuko
```

The Runtime doesn't care how a capability is implemented. It only knows:
capability, owner, inputs, outputs, risk, authorization, dependencies,
health.

## 3. Universal Execution Envelope

Every capability invocation passes through the same envelope:

```
ExecutionRequest
├── request_id
├── actor
├── session
├── capability
├── intent
├── input
├── authorization
├── constraints
├── provenance
└── timestamp
```

Returns:

```
ExecutionResult
├── request_id
├── status
├── result
├── evidence
├── confidence
├── provenance
├── side_effects
├── cost
└── timestamp
```

This means the Runtime can observe everything without understanding every
domain.

## 4. Dila and Zuko become Runtime agents

Don't make Dila the Runtime. Don't make Zuko the Runtime. They're agents
running inside it. They receive: context, available capabilities,
authorization, memory, current task — and return: plan, tool requests,
hypotheses, predictions, results. The Runtime executes the actual
capability requests. That prevents an agent from quietly becoming the
system's root authority.

## 5. Predict becomes the empirical reasoning layer

Dila generates a hypothesis. Runtime asks Predict to forecast it. Predict
produces a PredictionTicket (probability, confidence, evidence, analogues,
simulation, calibration). Then the system can actually perform the
experiment:

```
Hypothesis → Prediction → Experiment → Observation → Outcome
  → Calibration → DTU → Improved future reasoning
```

That's the novelty architecture.

## 6. Pentester Supreme becomes a controlled experimental domain

The Pentester exposes capabilities, not arbitrary execution. Runtime
enforces: Actor → Authorization → Engagement → Capability risk → Target
scope → Execution → Evidence. Findings feed back into Predict and DTUs:

```
Pentester detects unknown behavior → Dila generates hypotheses
  → Predict ranks hypotheses → Runtime selects authorized experiment
  → Pentester tests it → Evidence → Predict resolves forecast
  → DTU records durable finding
```

## 7. Trading becomes another Runtime domain

The AutoTrader remains independently safety-bounded. Runtime can monitor
market observation, signal, prediction, position, execution, fill, fee,
P&L, outcome — but Runtime must not bypass the trading system's existing
safety boundary. The current PPO core (PPO 19/39/9, 15-day minimum hold, 33
assets, 20 slots, validated signal-driven exit) stays as-is. Predict can
eventually become an empirical research/evaluation layer for trading — it
does not automatically become trading authority simply because it
generated a probability. That promotion needs its own evidence gate (this
is the same staged-authority principle already governing the live P0-P7
Concord Predict × Dila integration — see the CP-DILA-INTEGRATION-V1
spec/work already in progress separately from this doc).

## 8. DTUs become the shared memory substrate

Every domain can produce structured knowledge, but don't dump every event
into DTUs. Use three classes:

- **Ephemeral** — logs, telemetry, temporary reasoning.
- **Episodic** — predictions, experiments, outcomes.
- **Durable** — validated findings, calibrated models, rejected
  hypotheses, discovered relationships.

That prevents the DTU store from becoming an enormous garbage dump.

## 9. Event Bus

Probably the single most important new infrastructure piece. Domains
publish events such as: `prediction.created`, `prediction.resolved`,
`experiment.started`, `experiment.completed`, `finding.created`,
`finding.validated`, `dtu.created`, `dtu.revised`, `market.observed`,
`trade.executed`, `trade.resolved`, `agent.task.created`,
`agent.task.completed`, `capability.promoted`, `capability.rejected`.
Other systems subscribe without hard-coding integrations — this is how
`Dila → Predict → Pentester → DTU → Zuko → Trading → Concordia` avoids
becoming spaghetti.

## 10. Persistent Mac Runtime

Since Concord now runs natively on the Mac, the Mac becomes the always-on
execution environment:

```
launchd
   ↓
concord-runtime
   ↓
runtime supervisor
   ├── API
   ├── event bus
   ├── scheduler
   ├── Dila
   ├── Zuko
   ├── Predict
   ├── DTU
   ├── Pentester
   ├── trading bridge
   └── Concordia services
```

The supervisor should continuously know: RUNNING, DEGRADED, RESTARTING,
FAILED, DISABLED. A dead worker should not make the entire system appear
healthy.

## 11. Self-health

Every subsystem gets a heartbeat, e.g.:

```
Dila             HEALTHY
Zuko             HEALTHY
Predict          HEALTHY
DTU              HEALTHY
Pentester        HEALTHY / LOCKED
Trading          HEALTHY
Concordia        HEALTHY
LLM providers    7/9 AVAILABLE
Event bus        HEALTHY
Database         HEALTHY
```

Critically: **health ≠ authorization.** A perfectly healthy Pentester can
still be completely locked.

## 12. Model abstraction

Don't hard-code Concord around today's models:

```
Concord Runtime → Model Router → provider/model
```

The router selects based on task, latency, cost, context, capability,
availability, reliability. Then swapping models doesn't require rewriting
Concord. (Concord already has a real version of this shape for the 4-brain
architecture + BYO-key routing + Private/High-Power Mode — see
`server/lib/brain-config.js#pickBrainEndpoint` and the CLAUDE.md "Five-brain
architecture" section. This doc's ask is to generalize that pattern across
every subsystem, not just LLM brain calls.)

## 13. Deterministic substrate stays underneath

One of Concord's defining architectural rules: **LLMs propose;
deterministic systems verify wherever verification is possible.**

```
LLM → hypothesis → math/statistics/simulation → evidence → decision
```

rather than:

```
LLM → sounds convincing → action
```

(This is already a live Concord principle — see CLAUDE.md's "Compute-
don't-guess" section. This doc's ask is to make it a Runtime-enforced
contract across every domain, not just something an author has to
remember.)

## 14. Runtime authority hierarchy

Made explicit, never reversed:

```
HARD SAFETY / AUTHORIZATION
          ↓
RUNTIME POLICY
          ↓
CAPABILITY PERMISSIONS
          ↓
DOMAIN LOGIC
          ↓
AGENT
          ↓
LLM
```

An LLM cannot grant itself permission. An agent cannot elevate its own
capability. A prediction cannot become authorization. A DTU cannot become
authority merely because it says something confidently.

## 15. Autonomous research loop

```
OBSERVE → DETECT UNKNOWN → GENERATE HYPOTHESES → PREDICT
  → SELECT EXPERIMENT → CHECK AUTHORIZATION → RUN BOUNDED EXPERIMENT
  → COLLECT EVIDENCE → RESOLVE PREDICTION → CALIBRATE → SYNTHESIZE
  → CREATE/UPDATE DTU → PROPOSE NEW CAPABILITY → TEST
  → PROMOTE OR REJECT
```

The Concord learning loop, operating across domains.

## 16. Capability promotion

A formal lifecycle:

```
IDEA → PROTOTYPE → SANDBOX → TESTED → SHADOW → VALIDATED → PROMOTED
```

No agent should simply create a new capability and immediately gain
production authority. Especially important for the security system and
the trading system.

## 17. Website architecture

```
USER → Concord Web → Authenticated API → Concord Runtime
  → Capability Router → Domain → Deterministic substrate / model / DTU
  → Result
```

The frontend shouldn't know whether the answer came from Dila, Zuko,
Predict, a deterministic engine, or some combination. It talks to Runtime.

## 18. What this ultimately turns Concord into

- **Concord Runtime** → manages everything.
- **Dila/Zuko** → reason and orchestrate.
- **LLMs** → provide language intelligence.
- **Deterministic engines** → provide mathematical/verifiable computation.
- **Predict** → provides empirical probabilistic reasoning.
- **Pentester Supreme** → provides bounded security experimentation.
- **DTUs** → provide persistent validated knowledge.
- **Trading** → provides an autonomous economic experiment.
- **Concordia** → provides simulation/world-building capabilities.
- **Website** → provides the human interface.

The Runtime is the connective tissue.

**The key design principle:** don't build one giant super-agent. Build a
super-system composed of specialized capabilities with a common runtime
contract. Given how much already exists in Concord, this is a candidate
for the next master architectural milestone — after, not instead of,
continuing the current staged Concord Predict × Dila integration
(P0 shipped 2026-08-30; P2 in progress as of this doc's writing).
