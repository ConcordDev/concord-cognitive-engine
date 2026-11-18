# orc.workspace-3d — the 3-D study workspace (surface specification)

Solver id: `orc.workspace-3d` · domain: orchestration · engine: frontend
Surface: `/lenses/conkay` · Components: `concord-frontend/components/conkay/workspace/*`
Status of this doc: the SX-ORC-13 take-up specification — the surface exists; this doc specifies its generalization from a beam study to any system, and the server contract that generalization consumes. The frontend build leg is named at the end.

## What exists today (census at f4f1f77ff)

The workspace is real and composed: `ConKayWorkspace` (902
lines) lays out the workspace rail, the 3-D study viewport,
result cards, the ConKay conversation pane, and the voice/text
composer (`VoiceComposer`). `useConKayWorkspace` owns the study
state; `DesignPane` handles brief-shaped designs (a brief →
design answers — truss-shaped today, via its BriefClaim /
TrussAnswer forms); `ParameterPanel` and
`StudyCards` present parameters and results.

The study loop is **beam-only**: deterministic commands
("t_w = 8 mm and re-run", "cantilever, 50 kN") are parsed by
`lib/conkay/workspace-commands.ts` into `BeamDims` and run
against `engineering.beamStudy`; `BeamViewport` renders beam
geometry; the reply is composed from the beam solver's numbers.
Anything else routes to the ConKay agent stream with the study
as context. One system shape is wired; the ticket's target is
**any** system.

## The generalization (target behaviour)

1. **Graph-driven viewport.** The viewport renders the design
   graph, not a beam: nodes become parts (positioned by their
   declared geometry/position props where present, laid out by
   the graph where not), edges become interfaces. Beam designs
   keep rendering through the same path — the beam becomes one
   system among many, not a special case. *Generalize, do not
   rewrite* (the ticket's own note): BeamViewport's camera,
   selection and overlay machinery carries over; its
   beam-geometry builder is replaced by a graph builder.
2. **Click a part or interface → its evidence.** Selecting a
   node shows that node's envelopes from the latest session
   run: solver id@version, status, inputs (as submitted),
   outputs, warnings, and provenance — the sources and
   receipts behind the numbers. Selecting an interface shows
   the chain seam that crosses it, when the run was a chain
   run (SX-CHAIN-RECEIPT: seam status, both sides' values).
   A part with no envelope shows that honestly ("no solver
   targeted this part in the last run"), never a placeholder.
3. **Stage-beats from real events only.** Progress in the
   conversation pane is composed from actual backend events —
   session run completions, envelope arrivals, chain receipt
   status changes. No simulated progress, no fake beats: if
   nothing has run, the pane says so.
4. **The conversation pane keeps its two paths.** Deterministic
   commands run solvers directly (today: beam edits; target:
   any registered solver's declared command surface, via the
   same parse-then-run discipline); everything else goes to
   the agent stream with the design as context, and a re-solve
   through agent tools reloads the stored result — as today.

## The server contract (verified present at this seat)

The generalization needs nothing new from the server:

- **Per-node envelopes.** A design session run returns, per
  solver×node: `{runId, solver, target, status, inputs,
  outputs, warnings, assumptions, provenance}` — the shape
  the SXC-23 replay harness executes against. Inputs are the
  submitted props; provenance carries the solver's sources.
- **Chain receipts.** A chain run's receipt (SX-CHAIN-RECEIPT)
  carries per-link hashes and seam contracts — the interface
  evidence leg 2 surfaces.
- **The design domain.** `server/domains/conkay-design.js` is
  the macro surface the workspace's design operations ride;
  `engineering.beamStudy` remains the beam study's entry.
- **Receipts for claims.** `orc.system-report` claims each
  carry `{solver, evidence}` receipts — the same evidence
  shape the part pane presents, so a report and the workspace
  never disagree about where a number came from.

## Replay expectation (walker form)

This is a surface, not a compute solver: its replay is a lens
replay, not a `conkay_solve` call. Post-fix, on `/lenses/conkay`:
load the golden chain design (the SXC-26 robot brief) → run →
the viewport shows the design's parts; clicking the battery
part shows its envelopes; the chain receipt reads SIGNED; the
conversation pane's stage-beats match the run's actual link
completions (nine links, the fallback shown as skipped when
undeclared — or, on an infeasible chain with fallback inputs
declared, its closest-realistic-version link, per SX-ORC-09 as
landed 2026-11-18 after the founder's F10 ruling). A
PASS-labelled display over a SEAM_VIOLATION or
INCOMPLETE receipt is a failure of this check, not a success.

## The split (what remains, and whose)

- **This doc + the server contract verification: B3, landed
  with SX-ORC-13's claim.** No server change is required.
- **The frontend generalization build** (graph viewport,
  evidence pane, generalized commands) is `concord-frontend`
  work under the fleet frontend contract (type-check, lint,
  browser exercise on desktop + mobile) — outside this seat's
  toolchain and verification reach. It is the ticket's
  remaining leg, for the office to seat with a frontend
  builder. Until it lands, the workspace remains beam-shaped
  in its study loop, exactly as censused above — this spec
  does not claim otherwise.
