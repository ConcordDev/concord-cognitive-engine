# Physics Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep, a full read of the file it's about, or
> a runtime call through `server/tests/depth/_harness.js#lensRun` (compute-
> don't-guess — the running system, not hand arithmetic).

## Backend surface

```
grep -c 'registerLensAction("physics"' server/domains/physics.js
```
→ **20** macros registered via `registerPhysicsActions(registerLensAction)`
in `server/domains/physics.js` (1259 lines): `kinematicsSim`,
`orbitalMechanics`, `waveInterference`, `thermodynamics` (the original,
PhET/Algodoo-parity multi-body engine — see the finding below),
`kinematics-1d`, `projectile`, `convert-units`, `constants` (2026 Wolfram-
Alpha-parity flat calculators), `scene-list/save/get/delete/share/
load-shared/run`, `simulate-scene`, `measure` (ruler/protractor/force —
PhET-style scene editor substrate), `curriculum-list/get`, `pendulum-period`.

**Load-bearing finding — 4 of these 20 bodies are dead code.**
`server.js`'s "Engineering Compute" block (~line 41797) re-registers
`registerLensAction('physics', 'kinematicsSim'|'orbitalMechanics'|
'waveInterference'|'thermodynamics', ...)` **after** `domains/physics.js`
loads at boot. `registerLensAction` writes into a plain `Map` (`LENS_ACTIONS`)
keyed by `"domain.action"` — last write wins — so the four richer
`domains/physics.js` bodies for these exact names are permanently shadowed
and unreachable. Verified at runtime via the harness (not by reading source
and guessing):

```js
const r = await lensRun("physics", "kinematicsSim",
  { data: { initialVelocity: 2, acceleration: 3, time: 4 },
    params: { initialVelocity: 2, acceleration: 3, time: 4 } });
// r.result → { finalVelocity: 14, displacement: 32, averageVelocity: 8, formula: "v = u + at, s = ut + ½at²" }
// — the flat single-body server.js handler, NOT the multi-body drag engine
//   in domains/physics.js (which would need a `bodies[]` array and never runs).
```

This is not a fresh discovery of an accidental regression — `server/tests/
depth/physics-behavior.test.js` already has a header comment documenting it
("kinematicsSim / thermodynamics / orbitalMechanics / waveInterference are
re-registered in server.js … AFTER domains/physics.js, so the LIVE lens.run
handlers are the server.js ones — the domains/physics.js bodies for these
four are shadowed (dead)") and pins the **server.js contract** as the tested,
canonical one. `CLAUDE.md`'s invariants log the same defect class being fixed
for `math` and `engineering.runFEA` in this exact code block ("Removed the
duplicates so the domain handler wins. Do not re-register these here.") —
physics was evidently missed in that cleanup, but because a dedicated test
file already asserts the shadowed state as the live contract, un-shadowing it
here would be a backend-architecture decision (which engine is canonical, and
a test-suite rewrite) out of scope for a frontend-only pass — see "Genuinely
missing, deferred" below.

The 4 live (non-shadowed) contracts, confirmed via the harness:

| Macro | Live input | Live output |
|---|---|---|
| `kinematicsSim` | `{initialVelocity, acceleration, time}` (single body, 1D) | `{finalVelocity, displacement, averageVelocity, formula}` |
| `orbitalMechanics` | `{mass1, mass2, distance}` (two-point-mass Newtonian gravity) | `{gravitationalForce, orbitalVelocity, orbitalPeriod, formula}` |
| `waveInterference` | `{frequency, waveSpeed, sourceFreq, sourceVel, observerVel}` | `{results:{wavelength:{value,unit}, doppler:{value,unit,shiftHz}}}` — two independent sub-calcs, each may carry its own `{error}` instead of throwing |
| `thermodynamics` | `{pressure,volume,moles,temperatureK (any 3 of 4), mass,specificHeat,deltaTemp, hotK,coldK}` | `{results:{idealGas:{value,unit,solvedFor}, heatTransfer:{value,unit}, carnot:{value,percent}}}` |

## Frontend surface

`concord-frontend/app/lenses/physics/page.tsx` (1751 lines) +
`concord-frontend/components/physics/{PhysicsLab,PhysicsActionPanel,
PhysicsWorkbench,PhysicsArxiv}.tsx`. `PhysicsLab.tsx` already wired the
16-macro PhET/Algodoo scene-editor substrate correctly (scene CRUD,
`simulate-scene`, share/import, measurement tools, curriculum). Also
present: an entirely separate, self-contained client-side 2D physics
sandbox inline in `page.tsx` (drag-place circles/rectangles, springs, force
fields, Verlet integration, canvas rendering, 7 presets) — this is a real,
honest, client-computed interactive playground (no fabricated data — every
number on screen is a real integration of the visible bodies), distinct in
purpose from the server-authoritative engines, and left alone (see below).

## The defect found

### `page.tsx`'s "Physics Analysis" panel called 4 real macros with a
field shape that matched none of their contracts

`handlePhysicsAction(action)` used `useRunArtifact('physics')` — which
posts to `/api/lens/physics/:id/run` and passes the **persisted artifact's
`.data`** as both the macro's `artifact.data` and `params` — against
`savedSims[0]?.id`, the most recently **saved 2D canvas-sandbox scene**
(`{bodies, constraints, forceFields, settings}` with 2D `position:{x,y}`
bodies, no `dragCoefficient`/`crossSection`, no `orbit`/`stateVector`, no
`sources[]`, no `state{pressure,volume,temperature}` — and, per the finding
above, even those domains/physics.js field names wouldn't have mattered
since that handler never runs). Verified via direct read + the field
contracts above:

- **`waveInterference`** — live handler needs `frequency`/`waveSpeed`/
  `sourceFreq`/`sourceVel`/`observerVel`; none exist on the saved scene.
  Every click of this button failed the exact same way, always.
- **`thermodynamics`** — live handler runs 3 independent sub-calcs
  (`idealGas` needs exactly 3 of 4 of `pressure/volume/moles/temperatureK`,
  `heatTransfer` needs `mass/specificHeat/deltaTemp`, `carnot` needs
  `hotK/coldK`); none exist on the saved scene. Every click returned all
  three sub-calcs as `{error:"…"}` — the panel rendered blank result cards
  every time (the JSX guarded on `'process' in physicsActionResult`, a
  field the live handler never returns at all, so the whole card silently
  never rendered — a second, compounding bug).
- **`orbitalMechanics`** — live handler needs `mass1`/`mass2`/`distance`;
  none exist on the saved scene, so `Number(undefined)` → `NaN` on all
  three, failing `[m1,m2,r].every(Number.isFinite)` — every click returned
  the same `{ok:false, error:"orbitalMechanics needs numeric mass1, mass2,
  distance(>0)"}`, but the panel's JSX only ever branched on `'elements' in
  physicsActionResult` (a domains/physics.js-shaped field the live handler
  never returns), so the error was silently swallowed and the panel showed
  nothing.
- **`kinematicsSim`** — the only one of the four that happened not to
  outright error, because the live 1D handler's `time` field could
  coincidentally be `undefined` → `NaN` → same silent-failure path as
  above (no `time` field on a canvas body). So all 4 buttons were reliably
  broken, just via three different failure shapes (three silent blanks +
  one 100%-reproducible visible `undefined%`-style error the JSX never
  actually surfaced because it read the wrong result fields throughout).

Net effect: 4 buttons in a section literally labelled "Physics Analysis",
0 of which ever produced a rendered result, on any saved scene, ever.

Separately, `pendulum-period` — a real macro whose own doc comment says it
"backs the predict-then-verify curriculum loop" — had zero frontend caller
anywhere (confirmed by `node scripts/lens-unsurfaced.mjs --lens physics`
pre-pass and by grep). `scene-run` also has zero caller, but is a
non-defect: `PhysicsLab.tsx` already calls `simulate-scene` (the
free-form, no-persistence-required sibling macro) with the live in-memory
scene state directly, which is strictly better UX than `scene-run`
(requires a prior save + risks running a stale persisted copy) — the two
macros are functionally redundant by design, not a wiring gap.

## What changed

### 1. New `components/physics/PhysicsAdvancedLab.tsx` — real, bespoke,
tabbed solver panel for the 4 macros, built against the verified LIVE
contracts (not the dead domains/physics.js ones)

Four tabs, each a real form + real result rendering, no artifact/save
round-trip required (`lensRun('physics', action, {…flat fields…})` calls
`POST /api/lens/run` directly, whose virtual artifact's `.data` **is** the
input body — no persisted scene needed):

- **Kinematics** — `u`/`a`/`t` inputs → `v = u+at`, `s = ut+½at²`,
  average velocity, with the formula string rendered.
- **Orbital Mechanics** — `m₁`/`m₂`/`r` inputs → gravitational force,
  circular orbital velocity, orbital period (displayed in hours).
- **Waves & Doppler** — `frequency`/`waveSpeed` (for λ) plus
  `sourceFreq`/`sourceVel`/`observerVel` (for Doppler, sharing
  `waveSpeed`) → wavelength and Doppler-shifted frequency, each rendered
  independently with its own inline error state if under-specified
  (matches the live handler's per-sub-calc-error contract, no throw).
- **Thermodynamics** — three grouped sub-forms (ideal gas: any 3 of 4 of
  P/V/n/T; heat transfer: mass/specific heat/ΔT; Carnot: hot/cold
  reservoir K) fired together in one call, three independent result
  cards, each honestly showing its own `{error}` if under/over-specified.

Every field name and result shape was verified against the live handler
via the harness (see the input/output table above and the runtime
transcript in Verification), not assumed from reading `domains/physics.js`
in isolation — which is exactly the trap the first draft of this panel
fell into before the shadowing was discovered.

### 2. `app/lenses/physics/page.tsx` — removed the broken artifact-gated
panel, mounted the new solver panel, dropped now-dead state

Removed `useRunArtifact`, `physicsActionResult`/`physicsIsRunning` state,
`handlePhysicsAction`, and the ~85-line JSX block that rendered (or, in
practice, never rendered) its results; removed the now-unused `Loader2`
import (still used elsewhere? — checked, it was not). Replaced with
`<PhysicsAdvancedLab />`. `savedSims`/`useLensData` stay — the "Saved
Simulations" list in the sidebar is unrelated and still real.

### 3. `components/physics/PhysicsLab.tsx` — wired the previously-
unsurfaced `pendulum-period` macro into a real "Predict, then verify" tool

Added a small widget under the Pendulum Lab curriculum module's step list
(shown only when `activeModule.id === 'pendulum-lab'`): length + amplitude
inputs, a "Predict period" button that calls `pendulum-period` (small-angle
and amplitude-corrected period, frequency), and a prompt to then click the
scene editor's existing Run button and compare the bob's actual
oscillation against the analytic prediction — realizing the exact
predict-then-verify loop the macro's own doc comment describes. New
component-local state (`pendLength`, `pendAmplitude`, `pendPrediction`,
`pendBusy`) and a `predictPendulum` callback; no changes to the file's
existing scene-editor/measurement/curriculum logic.

## Macro → UI classification (all 20 macros)

**DESIGNED** — 19/20 after this pass (was 15/20 before: 4 macros reachable
only through the broken artifact-shape panel above, `pendulum-period`
unsurfaced):

| Macro group | Count | Where |
|---|---:|---|
| `kinematicsSim`, `orbitalMechanics`, `waveInterference`, `thermodynamics` | 4 | `PhysicsAdvancedLab.tsx` (**rebuilt this pass against the verified live contract**) |
| `kinematics-1d`, `projectile`, `convert-units`, `constants` | 4 | `PhysicsActionPanel.tsx` + `PhysicsWorkbench.tsx` (pre-existing, real — two independent bespoke surfaces for the same 4 macros, see below) |
| `scene-list/save/get/delete/share/load-shared` | 6 | `PhysicsLab.tsx` scene editor (pre-existing, real) |
| `simulate-scene` | 1 | `PhysicsLab.tsx` Run button (pre-existing, real) |
| `measure` (ruler/protractor/force) | 1 | `PhysicsLab.tsx` measurement tools (pre-existing, real) |
| `curriculum-list/get` | 2 | `PhysicsLab.tsx` curriculum panel (pre-existing, real) |
| `pendulum-period` | 1 | `PhysicsLab.tsx` predict-then-verify widget (**newly wired this pass**) |

Total: 4+4+6+1+1+2+1 = **19**.

**GENERIC-STRIP-ONLY**: none. `<UniversalActions>`/`<AutoActionStrip>`/
`<RecentMineCard>`/`<LensFeaturePanel>` are present on the page but as
supplementary footer surfaces after the real bespoke content (`PhysicsLab`,
`PhysicsAdvancedLab`, `PhysicsWorkbench`, `PhysicsActionPanel`,
`PhysicsArxiv`), not as the primary way to reach any macro — matches the
grader's distinction between "referenced in a generic action array" and "a
genuine designed feature" (`isGenericScaffold: false`, see Verification).

**UNSURFACED**: `scene-run` (1/20) — non-defect, see above (`simulate-scene`
is the strictly-better, already-used sibling for the same job).

## Confirmed real and left alone, with reason

`grep -n "Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded"
components/physics/*.tsx app/lenses/physics/page.tsx` → the only
`Math.random()` hits are in `page.tsx`'s client-side sandbox (`generateId()`
for local-only body/constraint ids, and the "Bouncing Balls"/"Wind Tunnel"
presets' randomized initial velocity/mass/radius for visual variety) — both
honest: they seed a real, locally-computed physics integration the user
watches run, not a fabricated result standing in for a backend call.

- **The client-side 2D sandbox** (drag-place bodies, springs, force fields,
  Verlet integration + collision response, canvas rendering, 7 presets) —
  a genuine, real-time interactive physics playground computed entirely in
  the browser. Left unchanged: this is a legitimate, honest design choice
  (PhET-style sandboxes commonly run client-side for 60fps interactivity),
  distinct in purpose from the server-authoritative `PhysicsLab` scene
  editor (persistence, sharing, curriculum, authoritative multi-substep
  simulation with energy-drift reporting) and from the new textbook-style
  `PhysicsAdvancedLab` solvers.
- **`PhysicsActionPanel.tsx` + `PhysicsWorkbench.tsx`** — genuinely
  duplicate bespoke UIs for the same 4 macros (`kinematics-1d`,
  `projectile`, `convert-units`, `constants`): one is an always-visible
  inline "physicist's bench" with mint/DM/publish/agent actions, the other
  a slide-over reference panel. Both correctly wired, both real, no
  fabrication in either. Redundant but not a defect per the audit's
  fabrication/shape/surfacing checks — left alone (consolidating them is a
  polish call, not a correctness fix, and removing either would remove a
  real, working, differently-purposed surface).
- **`PhysicsArxiv.tsx`** — real arXiv physics feed via `ArxivPanel`, no
  changes needed.

## Genuinely missing, deferred

~~**ENGINEERING** — un-shadowing `domains/physics.js`'s richer
`kinematicsSim`/`orbitalMechanics`/`waveInterference`/`thermodynamics`
bodies~~ **CLOSED (2026-07-16, `fcb7f7d9`)** — deleting the `server.js`
duplicates was rejected as unsafe (`PhysicsAdvancedLab.tsx` and
`physics-behavior.test.js` depend byte-for-byte on the shadowed shape).
Instead the `orbitalMechanics` handler (Keplerian-element propagation +
a real Hohmann-transfer Δv/time calculation) is also registered under a
new additive name, `orbitalMechanicsAdvanced`, that nothing shadows —
zero logic changed. A dedicated regression test proves the shadowed
`physics.orbitalMechanics` name is still byte-identical. `kinematicsSim`/
`waveInterference` were similarly dual-registered as stretch goals;
`thermodynamics` remains untouched. New `PhysicsKeplerianLab` panel.

## Verification

- `node --check server/domains/physics.js` — clean (file untouched this
  pass; verified anyway per the assignment brief).
- `node --test tests/depth/physics-behavior.test.js
  tests/physics-lens-macros.test.js tests/physics-domain-parity.test.js`
  (from `server/`) — **55/55 pass**, unmodified.
- Runtime verification via `server/tests/depth/_harness.js#lensRun` (ad hoc
  script, not committed) confirmed the exact live input/output shapes for
  all 4 rebuilt macros before writing `PhysicsAdvancedLab.tsx`, e.g.:
  `orbitalMechanics({mass1:5.972e24, mass2:1000, distance:7000000})` →
  `{gravitationalForce:8134.11, orbitalVelocity:7545.78,
  orbitalPeriod:5828.73, formula:"F = G·m₁·m₂/r²"}`.
- `node scripts/lens-unsurfaced.mjs --lens physics` (from repo root) —
  **1/20 unsurfaced** (`scene-run`, non-defect — was also 1/20 before this
  pass, since the static scanner never flagged `pendulum-period` as a
  distinct gap from `scene-run`'s cluster; the real fix is documented
  above and confirmed by direct grep of `pendulum-period` in
  `PhysicsLab.tsx` post-pass).
- `npx eslint app/lenses/physics/page.tsx components/physics/*.tsx` (from
  `concord-frontend/`) — clean, exit 0.
- `node scripts/verify-lens-backends.mjs` (from repo root) —
  `{"WIRED":258,"NO-BACKEND-CALL":2}` total 260 (physics was already WIRED
  and stays WIRED).
- `node scripts/grade-ux-polish.mjs --honest` (from repo root) — physics
  entry: `"tier":"polished"`, `"isGenericScaffold":false`,
  `"bespokeRatio":0.569`, `"pillarsPresent":5`, `"antiPatterns":0`.
  `audit/` outputs reverted via `git checkout -- audit/` per the
  transient-artifact rule.
