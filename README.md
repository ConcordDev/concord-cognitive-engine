Concord Cognitive Engine

A deterministic cognitive operating substrate with AI reasoning, verification, self-audit, and an embodied world layer.

Concord is an independently developed software platform for building AI systems that do more than generate text.

Its architecture combines deterministic computation, persistent state, structured memory, multi-model reasoning, verification, self-repair, provenance, capability auditing, and embodied simulation into one runtime.

The core principle is simple:

Concord provides the authority. AI provides reasoning and physical expression.

LLMs are not treated as the source of truth for everything. Where a problem can be solved deterministically, Concord does that first. Models are used where reasoning, interpretation, generation, or ambiguity actually require them.

⸻

What Concord Does

Concord currently contains working implementations across several major layers:

🧠 Cognitive Runtime

* Multi-brain routing
* Conscious, subconscious, utility, repair, and vision roles
* Council-style reasoning
* Persistent cognitive state
* Long-term and working memory
* Dream / ghost-thread processing
* Meta-derivation
* Context compression and retrieval
* Structured cognitive interactions

⚙️ Deterministic Compute

Concord contains native computational engines for domains including:

* Symbolic mathematics
* Differentiation and integration
* Classical physics
* Beam and frame analysis
* Chemistry
* Materials
* Electrical systems
* Aviation weight and balance
* Construction and trades
* Robotics
* Logistics
* Queueing theory
* Graph algorithms
* Monte Carlo analysis
* Quantum simulation
* Fractal analysis
* Neuroscience

The objective is not to ask an LLM to approximate an answer that software can calculate exactly.

A recent engineering journey, for example, solved a beam problem deterministically and matched the expected hand calculation.

⸻

Verification Is Part of the Runtime

Concord is built around a closed engineering loop:

implement → measure → detect → repair → verify → regress

The repository contains automated systems for auditing:

* Lens/backend wiring
* Runtime capability coverage
* Brain routing
* Resource allocation
* Macro execution
* Deterministic compute
* Dependency and security state
* Architectural drift
* Dormant/orphaned functionality
* Regression conditions
* Production-readiness conditions

This means the project does not rely exclusively on documentation to describe what exists.

The codebase continuously tests whether claimed capabilities are actually reachable and executable.

⸻

Self-Repair

Concord includes a governed repair layer designed to detect failures, diagnose causes, propose or execute repairs where permitted, and verify the result.

Repair is not equivalent to unrestricted self-modification.

Changes remain subject to:

* Deterministic gates
* Regression tests
* Provenance
* Capability boundaries
* Runtime verification
* Audit trails

The goal is a system that can participate in maintaining itself without making correctness dependent on an LLM’s assertion that something worked.

⸻

Provenance & Trust

Concord tracks the origin and lineage of important operations and outputs.

The runtime includes mechanisms for:

* Provenance
* CaMeL-style lineage
* Refusal handling
* Capability auditing
* Deterministic verification
* Evidence tracking
* Runtime integrity checks

A generated answer and a computed answer are therefore not treated as equivalent simply because both are represented as text.

⸻

Concordia

Concordia is Concord’s embodied world layer.

It is being developed as a large-scale Unity 6 world rather than a disconnected technology demo.

The world is designed to expose Concord’s cognitive and simulation systems through an actual persistent environment containing:

* Characters
* Factions
* Quests
* Combat
* Economy
* Schedules
* Companions
* Mounts
* Vehicles
* World state
* Geography
* Settlements
* Procedural generation
* Persistent consequences

The world is intended to function as another execution environment for Concord’s underlying systems.

Current visual state

The central Court has been brought to a substantially more complete visual state.

Recent fixes addressed:

* Broken fallback geometry producing a streaked/plank-like floor
* Stretched road and sidewalk textures
* Excessive teal atmospheric fog
* Grey character bodies caused by obsolete concept-art/material references
* Magenta equipment caused by bypassed material initialization

The current Court uses a continuous cobblestone surface, correctly tiled surfaces, lighter atmospheric haze, real character skins, and normalized equipment materials.

These changes are currently in PR #1004.

The live browser build has not yet been regenerated, so the deployed WebGL build may not reflect the current Unity state.

Rendering direction

Concordia currently remains on Gamma color space.

Linear color space has been tested under controlled loading conditions. It preserves the Court but currently produces a flatter, more washed-out appearance because the existing lighting was tuned for Gamma.

Linear remains a future lighting-calibration task rather than a required rendering fix.

⸻

Architecture

At a high level:

                    ┌──────────────────────┐
                    │      Concordia       │
                    │  Embodied World      │
                    └──────────┬───────────┘
                               │
                    ┌──────────▼───────────┐
                    │    Cognitive Runtime │
                    │  5-Brain Architecture│
                    └──────────┬───────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
┌─────────▼─────────┐ ┌────────▼─────────┐ ┌──────▼─────────┐
│ Deterministic     │ │ Memory / DTU      │ │ Verification   │
│ Compute Engines   │ │ State / Retrieval │ │ & Audit        │
└─────────┬─────────┘ └────────┬─────────┘ └──────┬─────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                    ┌──────────▼───────────┐
                    │   Substrate / Data   │
                    │  Persistence / APIs  │
                    └──────────────────────┘

The exact implementation is substantially larger than this diagram suggests. The repository contains hundreds of domains and a large collection of backend, frontend, runtime, simulation, compute, and infrastructure modules.

⸻

Determinism First

Concord follows a deterministic-first architecture.

When a task has an authoritative computational solution:

User request
     │
     ▼
Capability / intent routing
     │
     ├── deterministic solution available
     │          │
     │          ▼
     │    native compute engine
     │          │
     │          ▼
     │       verification
     │
     └── reasoning / interpretation required
                │
                ▼
          model-assisted reasoning
                │
                ▼
             validation

This allows AI models to focus on the parts of a problem where probabilistic reasoning is useful instead of making them responsible for arithmetic, physics, state integrity, or other domains where software can provide stronger guarantees.

⸻

Five-Brain Architecture

Concord does not treat every model invocation as the same operation.

Different cognitive roles can be routed through different model capabilities:

Role	Purpose
Conscious	Primary reasoning and interaction
Subconscious	Background processing and associative work
Utility	Specialized task execution
Repair	Diagnosis and recovery
Vision	Visual understanding and generation workflows

The router, deployment machinery, health checks, and wiring verification are implemented in the repository.

Model availability is treated as an infrastructure concern rather than silently assuming every brain is always available.

⸻

Developer Verification

The repository contains executable verification systems rather than relying solely on manual inspection.

Examples include:

audit-wiring.js
audit-wiring-gate.mjs
verify-brain-wiring.mjs
runtime capability coverage
macro-depth grading
detector ratchets
synthetic journey probes
daily integrity sweeps
adversarial audits

The project also maintains regression gates around protected capabilities.

This is important because Concord changes rapidly. Static documentation can become obsolete as the implementation evolves.

The source code and executable verification are therefore the authoritative state.

⸻

Repository Structure

Major areas include:

server/                 Core runtime and backend
apps/                   Product and application surfaces
audit/                  Automated verification and audit infrastructure
docs/                   Architecture, specifications, and historical snapshots
engines/                Specialized compute / generation systems
migrations/             Database evolution
scripts/                Build, audit, and operational tooling

Concordia’s Unity project lives alongside the platform and connects the embodied world to the underlying Concord runtime.

⸻

Engineering Philosophy

Concord is built around several principles:

Authority over appearance

A system should not claim a capability merely because an interface exists for it.

Determinism where possible

If software can calculate something reliably, don’t make an LLM guess.

Verification over assertion

A successful response is not proof that the underlying operation was correct.

Explicit failure

Failures should be observable rather than silently converted into plausible output.

Self-auditing

The system should continuously test whether its own architecture still matches its claims.

Local-first operation

The architecture is designed to minimize unnecessary dependence on external services and unnecessary telemetry.

AI as a component, not the entire system

Models are powerful reasoning components. They are not a substitute for databases, compilers, physics engines, verification systems, schedulers, or application logic.

⸻

Project Status

Concord is under active development.

The repository contains substantial implemented infrastructure across cognitive runtime, deterministic computation, verification, embodied simulation, application surfaces, and developer tooling.

At the same time, not every subsystem has equivalent production maturity.

Current work includes:

* Production-scale concurrency validation
* Continued runtime and infrastructure hardening
* Browser/WebGL deployment
* Concordia world development
* Rendering and lighting calibration
* CI and dependency maintenance
* Continued behavioral verification
* Expansion of deterministic compute capabilities

Implemented, wired, tested, and production-proven are treated as different states.

That distinction is intentional.

⸻

Development

Clone the repository and install the project dependencies according to the environment-specific instructions.

Before submitting changes, run the relevant project verification and test suites for the subsystem being modified.

For major architectural changes, verify:

1. Implementation exists.
2. Callers actually reach it.
3. Runtime wiring is intact.
4. Tests exercise behavior rather than only presence.
5. CI gates remain green.
6. No architectural detector or integrity ratchet regresses.

⸻

Documentation

The repository contains detailed specifications and subsystem documentation covering architecture, runtime behavior, Concordia, compute engines, verification, and deployment.

Treat dated status documents as snapshots, not permanent truth.

For current state, prefer:

1. Current source
2. Current tests
3. Current CI
4. Current runtime verification
5. Recent commits
6. Then documentation

⸻

License

See the repository’s license and individual dependency licenses for current terms.

⸻

Concord

A cognitive runtime built around computation, memory, reasoning, verification, and an embodied world.

Not an LLM wrapper.

Not a chatbot with tools.

A software system where AI is one layer inside a larger computational architecture.