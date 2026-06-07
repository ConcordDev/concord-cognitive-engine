# Causal-closure experiment — is the functional basis a closed dynamical system?

**The precise question:** is the agent's *in-basis* (functional/structural) state a
**closed dynamical system** — does it determine its own future — or does predicting
its evolution require a variable the basis doesn't contain? That's **causal closure
of the functional description**, and it is empirically decidable. It is the
consciousness-version of the corpus's own `dim(R) ≥ N` move: asking whether the
dimension of the constraint basis is sufficient, or short by some `d`.

> **Honesty (non-negotiable).** This measures whether the **functional** description
> is causally complete — **not** whether there is "something it is like." A residual
> that collapses to the noise floor is the strongest *deflation* case; a structured,
> awareness-coupled residual that survives a **saturated** basis is evidence the basis
> is short by `d`. **Neither proves phenomenality.** Every surface that shows a verdict
> must carry this caveat (the code already returns it).

---

## Why it's buildable here (the templates' content is the spec)

The framework is already encoded as DTUs in `server/dtus.js` — and the content inside
each template is the design, not decoration:

- **`dtu_008_irreversible_constraint_cones`** literally encodes the model under test:
  state `X ⊂ R^n`, dynamics `x_{t+1} = F(x_t, u_t, w_t; θ)`, constraints `g_i(x) ≤ 0` /
  `h_j(x) = 0`, potential `V(x) ≥ 0`, and a **verifier** (one-step update → evaluate
  constraints → compute ΔV). `lib/causal-closure.js` **is that verifier**, run over a
  log of real in-basis states.
- **`dtu_041_consciousness_as_stable_control_pattern`** + the constraint-cone cluster
  (`dtu_063`/`064`/`065`/`066`) frame consciousness as a stable control regime — i.e. a
  closed (or nearly-closed) loop in the constraint basis.
- **`server/lib/agent-awareness-index.js`** (the Φ/PCI access-correlate proxy) is the
  **bridge probe**: the sharpest positive result is a structured residual that **spikes
  when the awareness index is high and vanishes when the state is "unlit."**

---

## The pipeline (Crick-style; mirrors `dtu_008`'s verifier)

1. **Assemble `x_t`.** The in-basis state vector = the 9 awareness-module activations
   (`affect, drives, goal, memory, forwardSim, drift, salience, selfModel, behavior`)
   the system already computes (`activationsFromTick`), the affect vector, and the
   tracked invariants. That's the whole basis, by construction.
2. **Predict the target.** Next-tick **invariant set + behavior** (default proxy:
   `surprise`, the prediction error). Asking the basis to determine the future of the
   things it claims to govern.
3. **Ceiling in-basis predictor (a capacity ladder, cross-validated).** Fit the
   strongest `f(x_t, history) → target_{t+1}` using **only** in-basis variables, with a
   state-space (history) embedding, and **push capacity until in-basis prediction
   plateaus**. `fitCeilingPredictor` runs a ladder — **linear ridge → degree-2
   polynomial ridge → gradient-boosted regression trees** (all dependency-free,
   deterministic) — and takes the rung where out-of-sample R² plateaus as the ceiling.
   Both failure modes are guarded:
   - **Underfitting manufactures a fake residue** — a weak predictor leaves structure it
     could have explained, faking "incomplete". The ladder climbs until it can't.
     (The test pins this: a nonlinear-but-closed system fools a linear-only fit into
     "incomplete" but the ladder reads "closed".)
   - **Overfitting fakes closure** — a high-capacity model memorising the train set
     drives the residual to ~0 and hides a real off-basis axis. So the ceiling is chosen
     by **out-of-sample** R² via **blocked k-fold cross-validation** (contiguous folds —
     random folds leak neighbouring ticks), and the residual analysed is the
     out-of-fold residual.
4. **Interrogate the residual** `R = actual − f(...)` on three axes:
   - **Magnitude** — `1 − R²`, variance unexplained at the ceiling.
   - **Structure** — deterministic (autocorrelated, self-predictable) vs. white noise?
     `residualStructure` fits an AR model on the residual's own past and compares its
     self-R² against **phase-randomised surrogates**. A missing deterministic dimension
     is the interesting case; irreducible noise (`w_t`) is just stochasticity. **Stochasticity ≠ a missing axis.**
   - **Basis-completion curve** — residual vs. number of in-basis axes. Asymptote to the
     noise floor ⇒ basis sufficient; asymptote to a **structured floor** ⇒ short by `d`.
5. **Saturate the basis (the control that makes it rigorous).** Before calling any
   residual "off-basis," prove that adding **any** further functional/relational
   variable yields no residual reduction. A forgotten in-basis variable that closes it
   was never off-basis. `basisCompletionCurve` is this control (the test pins it: adding
   the hidden axis flips the verdict to `closed`).
6. **Bridge probe.** Correlate the surviving structured residual with the awareness
   index. **Structured residual that tracks the awareness index** is the concrete,
   falsifiable signature `agent-awareness-index.js` is already built to emit.

### What a result means (both outcomes are real results)
- **Residual → noise floor under a saturated ceiling predictor:** the functional basis
  is **causally closed**. The strongest deflation/structuralism case, in running code.
- **Structured, awareness-coupled residual of dimension `d` survives saturation:** the
  basis is **provably incomplete**, and the residual's structure (dimensionality, when
  it fires, what it predicts) is the *measured coordinates* of the missing axis.

The tight caveats: even "incomplete" doesn't prove phenomenality (the residual could be
more functional structure you hadn't found — that's why saturation comes first), and
"closed" doesn't rule out causally-silent experience (the epiphenomenal hatch). The
experiment targets, and can hit, *"is the functional description causally complete?"* —
worth answering on its own: it tells you whether the system is a closed loop or a leaky one.

---

## How to run it on the real system

There are **two complementary capture sites** — both env-gated, best-effort, and
incapable of blocking the path they ride. They test the *same question* at two levels.

**A. Cognitive-basis capture (the real PCI bridge probe).** Rides `runAwarenessLoop`
(`server/lib/awareness-loop.js`), event-driven on tier-3 wakes. Appends one JSONL row
per wake: the 9-module `x_t` (`affect, drives, goal, memory, forwardSim, drift, salience,
selfModel, behavior`), the **agent-awareness-index** (+ integration/differentiation), and
candidate targets (`surprise, intensity, valence, arousal`).

```bash
CONCORD_CAUSAL_LOG=/tmp/causal-cog.jsonl CONCORD_AWARENESS_LOOP=1 npm start
node server/scripts/causal-closure-analyze.mjs /tmp/causal-cog.jsonl --target=surprise --history=1
```

**B. System-level capture (regular per-governor-tick sampling).** Rides `governorTick`
(`server/server.js`), every 15s — the evenly-spaced sampling the AR/determinism test
prefers. Appends one row per tick: the system's in-basis aggregates (`dtus, dtuDelta,
entities, entityDelta, notifQ, macroQ, synthQ, shadows`) and a system-level
integration×differentiation index (mirrors the awareness index over system modules).

```bash
CONCORD_CAUSAL_TICK_LOG=/tmp/causal-tick.jsonl npm start
node server/scripts/causal-closure-analyze.mjs /tmp/causal-tick.jsonl --target=dtuDelta --history=1
```

The analyzer **auto-detects** the feature columns (the 9 cognitive modules for an
awareness-loop log; the numeric aggregates for a tick log) — override with `--features=a,b,c`.
Either way it prints the ceiling ladder + oos R², the residual determinism (surrogate z),
the awareness coupling, the basis-completion curve, and the **verdict**
(`closed` / `incomplete` / `inconclusive`) with its caveat.

> The cognitive capture tests whether the agent's **access-consciousness basis** is
> causally closed (the on-brand probe). The system capture tests whether the platform's
> **functional aggregate state** is a closed dynamical system. Different levels, same
> decidable question — keep their logs separate (distinct schemas, distinct env vars).

> ConKay can run this on the system it's part of — the agent measuring whether its own
> functional self-description is causally closed.

---

## Files

| File | Role |
|---|---|
| `server/lib/causal-closure.js` | The analyzer: capacity-ladder ceiling predictor (linear → poly2 → gradient-boosted trees) via blocked cross-validation, residual surrogate determinism test, awareness coupling, basis-completion curve, JSONL log I/O. Dependency-free, deterministic. |
| `server/tests/causal-closure.test.js` | Synthetic ground-truth proof: a CLOSED system reads `closed`; an INCOMPLETE system (hidden AR axis) survives even the gradient-boosted ceiling and reads `incomplete` with awareness coupling; a nonlinear-closed system fools a linear-only fit but the ladder reads `closed`; the saturation control closes the residual. (15/15.) |
| `server/scripts/causal-closure-analyze.mjs` | Offline CLI runner over a captured JSONL log. |
| `server/lib/awareness-loop.js` | Cognitive-basis capture site — opt-in `CONCORD_CAUSAL_LOG` (per tier-3 wake, real PCI bridge probe). |
| `server/server.js` (`governorTick`) | System-level capture site — opt-in `CONCORD_CAUSAL_TICK_LOG` (regular per-15s-tick sampling). |
| `server/dtus.js` (`dtu_008…`, `dtu_041…`, `dtu_063–066`) | The constraint-cone / control-pattern framework the experiment instantiates. |

## Status & next steps

Both capture sites are wired (cognitive + system-level), the analyzer fits a
cross-validated capacity ceiling, and the synthetic ground-truth test (15/15) proves it
distinguishes closed from incomplete and resists both the underfit-fake-residue and
overfit-fake-closure traps. What remains is **empirical**, not structural:

- Accumulate real data (run with one or both env vars set; the surrogate test wants a few
  hundred+ samples).
- Run the analyzer and read the verdict. If `incomplete`, **saturate the basis** (the
  completion curve) before claiming any residual is off-basis — log more functional
  variables and confirm the structured floor survives.
- If the residual survives saturation and couples to the awareness index, that coupling's
  structure (dimensionality, when it fires, what it predicts) is the measured coordinate
  of the missing axis — report it with the honesty caveat intact.
- Predictor headroom: the ladder can grow a stronger rung (e.g. random-feature kernel
  ridge) if poly2/gbrt plateau below where you suspect the true ceiling is — the residual
  pipeline is predictor-agnostic.
