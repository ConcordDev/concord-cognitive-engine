# conkay — Capability Map

## 2026-11-28 — The math designs, Kay organizes

Owner: "Jarvis level in capability but with actual CERN level physics that can
really build and design things using real math and the LLM is just
essentially the organizer." Until now the model wrote every dimension and the
solvers only graded them. Now:

- **The solvers size the design** (`lib/conkay/build/size.js`). The organizer
  (the person, or Kay) names which sizes may change and their bounds (any
  units) or a stock list; ConKay finds the lightest design in those bounds on
  which every check passes. Deterministic: feasibility by a common geometric
  step (bisection), coordinate descent, then trades (grow one size, shrink
  the others — a tube gets lighter wider with a thinner wall; descent alone
  stops short, found in a browser run). Bounds that cannot work are said with
  the checks that still fail at the limits. The receipt names the checks
  that set the answer (within 0.1 % of their limit) and the solver runs used.
  Benchmarks: a shelf board sized to h* = √(6 M FS / (b Fy)) = 7.2845 mm
  (exact, in inches as written); stock sizes → the smallest that passes; a
  tube cantilever → its maximum diameter with the wall from Mc/I = Fy/3
  (1.1894 mm).
- `POST /api/conkay/build/:id/size`; the report card's **Size it with the
  solvers** (cross-section sizes ticked by default, layout lengths left as
  drawn, bounds ¼×–4× in their own units; the result rides on the build).
- **Kay organizes the open build.** With a build open, the Workshop sends its
  id; the server loads that person's build and shows Kay its real editable
  values. Two tools: `conkay_build_edit` (words → exact edits of listed
  values, every check re-runs) and `conkay_build_size` (she picks what may
  change and sensible bounds; the solvers size it). Her replies may only
  report what the tools returned. Another person's build id is refused.

- **Thin-wall local buckling** of round tubes added to `structure.frame`
  (σcr = γ E t / (R √(3(1−ν²))), NASA SP-8007 bending knockdown). Found by
  letting the math design: the optimizer drives into any failure mode that is
  not a check, so every mode that matters must be one. (For the lamp's
  45 × 0.5 mm post it does not govern — σcr ≈ 700 MPa vs 276 MPa yield — so
  that post is structurally valid; denting and buyable sizes are the real
  limits there, which a stock list states.)

Browser: the shelf sized from 3/4 in to 0.28679 in (1.55 → 0.592 kg, set by
bending at Fy/2); the lamp overloaded with a 40 lbf knock (post fails), then
its post sized by the solvers to pass (45.3 mm OD, 0.5 mm wall at its min).

### Uncertainty on every margin (same day)

A margin was one number; a lab trusts a number with its scatter.
`lib/conkay/build/uncertainty.js` samples the real inputs and re-runs
**every** solver on each sample:

- material strength / stiffness / density: lognormal about the library value,
  one draw per material per sample, coefficients of variation from the JCSS
  Probabilistic Model Code (steel 3.02: fy 0.07, E 0.03; timber 3.05: 0.25 /
  0.13 / 0.10) and Weibull m ≈ 10 for ceramics. Polymers, composites and
  design-defined materials without a category are **not varied** unless the
  person gives their scatter — said in the warnings, never guessed (the
  planner now asks Kay to give a defined material its category);
- loads (forces, spread loads, carried masses) and cross-section sizes
  (spans held): CoV stated by the person, else labelled assumptions (0.10, 0.01).

Per check: utilization, its 5–95 % range, the probability it is not met with a
Wilson 95 % interval — or, when no sample fails, "under 1 − 0.05^(1/N)" (never
zero) — and the input that moves it most. Run twice when the build states a
safety factor: as written, and with the factor at 1 (does the part actually
break). Seeded, so a run repeats exactly; yields to the event loop.
`POST /api/conkay/build/:id/uncertainty`, the report card's **How sure is
it?**, and Kay's `conkay_build_uncertainty`.

Benchmarks: with strength the only scatter, P(u > 1) = Φ((ln u0 + σ²/2)/σ)
(9.36 % for the 8.7 mm pine shelf; Monte Carlo 9.8 %, interval 8.6–11.2 %),
median u0·e^{σ²/2}; FS 2 → 1 halves utilization exactly. Run on the tube post
sized exactly to Fy/3: that check is missed by 49.9 % of real parts (it sits
on the line, as an optimum does), yet none of 2,000 yield with the factor at 1
(< 0.15 %). Which is why the next step below is sizing to a reliability
target rather than to the nominal check.

### Next (toward the owner's bar)

The full long-range plan (phases A–H, comparison targets, "done when" per phase): `docs/conkay/CONKAY_ULTIMATE_PLAN.md`.

1. Size to a reliability target (e.g. P(fail) ≤ 10⁻³ with the factor at 1),
   with importance sampling / FORM for small probabilities Monte Carlo can't reach.
2. Vibration / natural frequencies in the frame solver; CalculiX on the real
   B-rep solids; a published-benchmark validation suite per solver.
3. Sizing beyond lengths (material choice from a shortlist, discrete layout
   options) and objectives beyond mass (cost, deflection).

## 2026-11-27 — Step 3: physics for everyday objects

From the audit (items 3–4): the effects that decide whether a lamp, a mug or
a wing works, on any build (`lib/conkay/physics/solvers/objects.js`). No
constant is built in — air, water, conductivity and emissivity come with
their source (Incropera's tables, ISA) or the check says what it needs.

- **`stability.tipping`** — any assembly: CG from every contained part's real
  volume × density at its real centroid (revolve and extrude centroids
  exact) plus carried masses; support = convex hull of the base part's real
  footprint (box/plate, revolve, vertical extrude or rod); tip angle about
  the nearest edge; a named push tips it when its overturning moment beats
  the weight's. Benchmarks: a block tips at atan(half-width / h); a push at
  exactly F·H = W·d is the boundary; a lamp's CG by hand.
- **`thermal.vessel-cooling`** — a hot drink in a revolved vessel: lumped
  liquid, wall conduction in series with outside natural convection
  (Churchill–Chu) and radiation, open top (hot plate facing up) and
  radiation, RK4 in time. Time to a target, the outside temperature at the
  start (hand contact), minimum time above. **Evaporation is not modelled**
  and the report says so (a mug: 90 → 60 °C in 40 min computed; real coffee
  is faster, mostly by evaporation).
- **`aero.lifting-line`** — any lofted NACA wing: Prandtl lifting line
  (Glauert series) on the loft's own chord and twist, zero-lift angle from
  the camber line (thin-airfoil theory), profile drag by flat-plate
  skin friction × Raymer form factor; lift ≥ weight and below-stall checks.
  Benchmarks: an elliptic wing gives CL = a₀α/(1 + a₀/πAR) with e = 1;
  a rectangular AR 6 wing e ≈ 0.95; NACA 2412 zero-lift −2.08°.
- **Editable conditions** under Loads and settings: flight speed, angle of
  attack, a drink's start temperature and fill, carried masses — in any unit
  ("80 mph" re-checked a glider wing: lift 120.4 → 246.3 N, exactly ∝ V²).
- Catalogue: new "stability" and "wing" families, cooling in "vessel"; each
  example compiles and its solver runs (pinned).
- Report: angles read in degrees and times in min/h.

Browser: a lamp (49° to tip; a 3 lb bulb at the shade drops it to 22°), a
mug (above 60 °C for 40.7 min vs 20 required), a glider wing (fails to carry
25 kg at 25 m/s; passes at 80 mph).

### Open

Modal / natural frequencies; impact and drop; thermal shock; photometry and
LED junction temperature; linkages and joint friction; flight stability
(static margin) and performance; fatigue on real load histories; tolerance
stacks and manufacturability; sweeps, booleans and threads; CalculiX
provisioning; evaporation in vessel cooling.

## 2026-11-27 — Step 2: real shapes, real solids

From the audit's ranked list: real geometry, and the CAD kernel where ConKay runs.

### What shipped

- **Three new shapes in the design language**, written in any units
  (`lib/conkay/geometry/shapes.js`, math in `geometry/profiles.js`):
  - `extrude` — a closed profile with holes (polygons or exact circles) and
    filleted corners, pushed along an axis: brackets, rails, plates with
    mounting holes, handles. Its section properties (area, centroid, second
    moments) are exact, so an extruded part is a **frame member**; the torsion
    constant is Saint-Venant's estimate and said so (and flagged as unreliable
    for hollow or thin-walled sections; unsymmetric sections flagged too).
  - `revolve` — a closed `(r, z)` profile, or an open **outline with a wall**:
    a cup, bowl, bottle, lamp shade. Volume by Pappus (exact); an outline that
    starts on the axis reports **what it holds** to the rim, checked by the new
    `geometry.capacity` solver against `props.capacity { min | max }` ("12 fl oz").
  - `loft` — sections (rectangle, ellipse, NACA 4-digit airfoil with twist)
    blended along an axis: a wing, a blade, a hull. Volume exact for the ruled
    blend (closed-form integral of the quadratic section area); `skin` makes
    it a thin-walled shell (labelled an estimate).
- **They draw in 3D** (`profileMesh`), and their mass, cost and editing come
  through the existing paths (a mug's wall, a loft section's chord, a fillet).
- **OpenCascade B-rep solids** (`geometry/conkay_solids_occ.py`,
  `geometry/solids.js`): every part (profile shapes and primitives) built as a
  real solid. `cad.solid-check` compares the kernel's own volume with
  ConKay's exact volume — two independent computations; they agree to ~1e-16
  for revolve, extrude with fillets and holes, and twisted ruled lofts. The
  check caught a real mismatch in development (a skinned wing compared with
  its solid) and now compares like with like.
- **STEP export of builds** (`GET /api/conkay/build/:id/step`, "STEP" on the
  report): real B-rep solids — planes, cylinders, cones, surfaces of revolution,
  exact circular holes — not faceted triangles.
- **Provisioning**: `server/Dockerfile` installs `cadquery-ocp==7.8.1.1.post1`
  and `cantera==3.2.0` in one venv, `/opt/conkay-occ` (plus libGL/libX11, which
  OCP links), and sets `CONKAY_OCC_PYTHON`; the gating `structural-audits` CI
  job installs the same. They share a venv because chemistry falls back to
  `CONKAY_OCC_PYTHON` — pointing it at a Python with OCP but no Cantera broke
  the chemistry tests, caught in this pass; with both, the 21 chemistry tests
  run real Cantera.
  With the kernel present, the long-open `conkay-envelope-refusal` showcase
  test passes (8/8). Without it, solid checks are NOT_COMPUTED with how to
  install it. (The Docker build itself was not run in this container.)
- **Fixed on the way**: the server's zero-warnings lint gate was red on this
  branch (17 errors, 4 warnings from earlier lens passes: deliberate
  control-character regexes, two literal byte-order marks, and an
  `/api/artistry/assets` write that took its owner from the request body when
  there was no session — now unowned instead); a stale animation test (a
  soundtrack now needs a real source); the darkroom pipeline copy kept
  byte-identical after the lint fix.

### Verified

- Hand calculations: cup capacity π·37²·97 mm³; cone πr²h/3; 50×50×5 angle
  (A = 475 mm², I by parallel axes); plate with a hole; four 90° fillets
  remove (4 − π)r² (2° arc segments, low by < 2.1e-4 of the sectors); frustum;
  NACA 0012 area against its thickness-formula integral; an extruded bar's
  frame stress equals the box section's and σ = Mc/I; a hollow extrusion
  equals the rect-tube; a mug's mass and capacity.
- The display mesh encloses the computed volume (divergence theorem) and
  faces outward on every axis.
- Browser: a mug (13.91 fl oz; an 8 mm wall drops it to 10.71 and the 12 fl oz
  check fails), a desk lamp (filleted base with four holes, spun shade), a
  tapered twisted wing; the STEP download is a 770 KB B-rep file.

### Open

- Physics for these shapes is the next step (audit items 3–4): lift and drag
  on a loft, heat through a revolved wall over time, tipping of a lamp,
  vibration. Kay can now model the shapes; what checks them is still the
  existing catalogue.
- Sweeps along a path, shells offset from a solid, booleans between parts,
  and threads are not in the design language yet.

## 2026-11-27 — Audit, then step 1: builds you can work on

Owner: "1:1 in every aspect that matters for development", for anything (a
car, a lamp, a plane, a coffee cup), "3d and inspectable and manipulated by
the user as long as things pass checks". The full audit is
`docs/conkay/CONKAY_CAPABILITY_AUDIT_2026-11-27.md`: 128 solvers (about 35
tied to a vehicle or robot, 9 untested), six real outside-engine drivers
(OpenCascade, CalculiX, OpenFOAM, Meep, FEniCSx, Cantera) none installed in
the dev container, 27 engine CI lanes whose test files and docs do not exist,
primitive-only geometry, and a 3D view that showed a build but could not
work on it.

### Step 1 (shipped)

- **Per-part status**: every check is tied to the part it is about (a frame
  check names its member, the member names its part); each part takes its
  worst check (`report.partStatus`), and the model is coloured by it: green
  passes, amber warnings, red fails, grey nothing checked it.
- **Pick a part** in the model or the parts list: its status, its own checks
  and its editable values (sizes, material) open in the report card.
- **Edit in any unit** (`report.parameters`, `build/edit.js`): sizes,
  material (library or the design's own), loads, safety factor. Values keep
  the units they were written in ("3/4 in", "-24.3 lbf/ft"); a load typed
  without a sign keeps its direction; a part's new length moves the free end
  of its frame member so the span follows the part (a shared joint is left
  alone and the report says the two disagree). Only listed values can change
  and each must read as the right kind of quantity.
- **Re-check without a model**: `POST /api/conkay/build/:id/edit` re-runs
  every solver and saves the new graph and report; `GET /api/conkay/build/:id`
  reopens a build with its 3D parts, and `?build=<id>` opens it in the
  Workshop.
- **Fixes found on the way**: the design graph is z-up and the 3D view y-up
  (build parts are rotated for display); builds send their overall size so
  the view frames them; `.ws-glass` set `position: relative` outside
  Tailwind's layers and overrode every `absolute` glass card in the Workshop
  (moved into the components layer); with a build open, typing no longer
  edits the hidden I-beam study; SI values show with an engineering prefix
  ("23.21 MPa", not "23210000 Pa").

### Tests

- `server/tests/conkay-build-anything.test.js` (14): parameters keep their
  units; parts take their check colour; a thicker board lowers stress by the
  square of the thickness (hand check); a longer board moves its member end;
  a load keeps its direction; edits refused when unlisted, the wrong kind,
  non-positive, an unknown material, or someone else's build; reopen.
- Frontend: `conkay-build-report.test.tsx` (pick, edit in any unit, refused
  edit reverts, loads), `mesh-artifact-build-parts.test.tsx` (part colours,
  pick, unpick), `conkay-workspace.test.tsx` (pick → edit → server re-check →
  report follows; refused re-check leaves the build; `?build=`).

### Open (from the audit, in order)

Real geometry (revolve, sweep, loft, shell, fillet, hole; OCC installed in the
deploy image); generalise the vehicle-only solvers (aero, stability, fatigue)
and add the missing physics common objects need (transient + natural
convection + radiation, modal, impact/drop, thermal shock, photometry,
junction thermal, linkages, flight stability, tolerance stacks, DFM); real
drivers for the dead engine lanes or remove them; uncertainty on margins and
a lab test-plan → calibration loop. Kay's chat does not yet edit an open
build (sizes change in the inspector; a typed change goes to Kay as a new
ask).

## 2026-11-26 (pass 2) — Build anything: Kay designs, the solvers check

Owner: "Conkay isn't meant to just solve the few hardcoded designs … it's
supposed to be able to build anything down to every level with its solvers
and use textbooks … it's hard to even input inputs like mm feet inches. Oz
for chemicals." Owner choices: **Kay designs, solvers check**; **build it,
mark the gap**; **any unit in, yours back**.

### What was wrong

- The design front door reached four fixed problem types (beam, bracket,
  truss, car). A shelf, a bracket or a stand became an I-beam or a
  layout concept with no checks; "holds 50 kg" quietly set a beam load.
- A part's own shape could not be a frame member (only `rect`/`i-beam`
  sections), there were no design-scoped materials (only the library), and
  the IR example taught an invalid box format (x/y/z instead of
  length/width/height).
- Units: a fixed table of SI-ish strings. "3/4 in", "2 ft 3 in", "fl oz",
  "°F", "psi", "lbf/ft", "cP", "mAh" either failed or were misread.

### What changed

- **Universal units** (`server/lib/conkay/units/universal.js`): dimension
  vectors, compound units (`W/(m·K)`, `lbf/ft`, `Ω·m`), feet-inches,
  fractions, temperatures with offsets, US cooking and chemistry units, and
  refusal of ambiguous ones (`ton`). The compiler and chat quantity readers
  fall back to it.
- **Design-scoped materials**: `materials: { "<id>": { density: { value, source }, … } }`
  compile only when every value carries its source.
- **Parts as frame members**: box, plate, rod/cylinder and round-tube
  sections come from the part's geometry; `round-tube` is a new shape.
- **General solvers** (`physics/solvers/general.js`): `fluid.pipe-network`
  (wraps `fluids/pipe-flow.js`), `thermal.conduction-1d` (wraps
  `thermal/conduction.js`), `electrical.dc-budget` (load current, wire drop
  from a sourced resistivity, AWG by its ASTM B258 definition, runtime),
  `chem.solution` (mass fractions, molarity, mass concentration, ideal
  mixing stated). Nothing is built in: a missing constant is NOT_COMPUTED
  with what it needs.
- **The build pipeline** (`server/lib/conkay/build/`): a catalogue of what
  ConKay can check (each family's props shape and an example that compiles
  and runs), a planner where the model writes the design graph, asks for
  textbook lookups (OpenStax passages are fed back and cited), lists
  questions and assumptions, and is repaired from the compiler's own errors
  (up to 3); quantity strings are normalised to SI deterministically; every
  solver runs; the report lists **checked** (demand vs capacity, pass/fail,
  basis), **computed, not checked**, and **not checked** (with the reason),
  all in the units the person used ("2650 psi (18.27 MPa)", "3.4 lb").
  Builds persist (migration 518 `conkay_builds`);
  `POST /api/conkay/build`, `GET /api/conkay/build/:id`, `GET /api/conkay/builds`.
- **Kay routes physical asks to `conkay_build`** (a shelf, bracket, stand,
  planter, cooler, pump loop, battery pack, brine…); robots, cars, plain
  beams and trusses keep their fixed fast paths. The Workshop box no longer
  sends a bracket to the fixed bracket solver.
- **Workshop**: a build opens the Workshop with its report beside the 3D
  parts (`BuildReportCard`), or on its own when nothing has geometry (a
  brine). The study's number boxes take any unit ("2 ft 3 in" → 685.8 mm,
  "50 kg" in a force box → its weight, said so).

### Tests

- `server/tests/conkay-universal-units.test.js` (9),
  `conkay-general-solvers.test.js` (5, hand-calculated expected values),
  `conkay-build-anything.test.js` (8: every catalogue example compiles and
  runs its solver; families follow the brief; units come back; the planner's
  lookup → repair → check loop against a hand-calculated shelf stress in psi;
  unsourced material refused; no model is an honest failure; repairs give up
  with the compiler's errors; a mechanism is not a pass).
- Routing: `conkay-everyday-routing`, `conkay-tools-default`,
  `cockpit-tools-2026-10-19` updated to the build route; `chat-tool-surface`
  lists the new tool.
- Frontend: `conkay-build-report.test.tsx`, a no-geometry build opening the
  Workshop on its report (`conkay-workspace.test.tsx`), any-unit boxes
  (`lib/conkay-field-units.test.ts`, `conkay-aria-invalid.test.tsx`).

### Open

- Planning needs a language model. With none reachable, the build route
  answers 503 `no_model` with a plain message; nothing is invented. A full
  build could not be driven in this container's browser for that reason;
  the pipeline is proven with a stub model and real solvers.
- The frame solver's `deep_member` warning reads the larger section side
  as the depth, so a wide flat board bending about its thin axis is
  flagged (conservatively) and reads WARN instead of PASS.
- Textbook lookups need network once per OpenStax book (then cached).

## 2026-11-26 — Kay first; Kay thinks, then looks up

Owner: "make sure ConKay actually tries and is easy to work with … right now
it's hard for users and ConKay doesn't take me serious." Owner choices: **Kay
first** (the conversation is the home; the Workshop slides in when she builds),
**think, then look up** (her own view for opinions/advice/explanations; tools
for facts that change or must be exact), and **fix the shared router for Chat
too**.

### What was wrong (measured, ~80 everyday messages through every routing layer)

- **Background-job hijack.** `lib/long-task.js` treated "is … my job" as a job
  status check, so "is this a good idea: quitting my job to trade crypto" was
  answered **"You don't have any background jobs yet."** (labelled
  *Grounded*). Same for "is my research paper any good?", "how is my job
  interview prep looking?", "update on my research: I found 3 papers".
- **Forced web searches for thinking asks.** "Your honest opinion on my startup
  idea", "help me study for my exam", "explain quantum computing like I'm
  five", "what's 15% of 240" all routed to `lookup`, and ConKay's turn plan
  forced a `web_search` whenever the model answered from its own reasoning.
  Her policy opened with "you answer with tools, not from memory".
- **Everyday words read as engineering parts.** "make a bar chart of my sales"
  and "make a table of my expenses" went to `conkay_design`.
- **The beam study grabbed messages.** In the browser, "what is resonance in
  music" got the beam solver's modal-analysis refusal, "run it" re-solved an
  I-beam nobody asked about, and "build a shelf … holds 50 kg" silently set
  the beam's load to 490 N.
- **The first screen was a CAD tool**: an I-beam study, "Tell Kay what to build
  — t_w = 8 mm and re-run", "STRUCTURES · FEA · MATERIALS · DTU", 13 nav items.

### What changed

- **Router (shared with Chat, `lib/chat/agent-route.js`):** a `think` route for
  opinions, advice, evaluations, explanations, help deciding/learning/planning
  (`isThinkAsk`); job status only when the job/task/report/research noun closes
  the ask or is followed by a status word; `answerLongTaskRoute` falls through
  to the model when there are no jobs and the ask never said "background";
  "15% of 240" is compute; "when is my birthday?", "show me what you made
  earlier" are recall; "can you remember …" is stored; "a table/chart of my …"
  is not a lens write.
- **Kay (`lib/conkay/agent-turn.js`, `routes/chat-agent-stream.js`,
  `components/conkay/conkay-persona.ts`):** a new identity line and policy —
  take the person seriously, give a real view with reasons, think first and
  look up when a fact could be wrong, ask one question or state an assumption.
  A tool is forced only for asks that hinge on a current or exact fact
  (`FACT_NEEDED_RE`: prices, news, weather, specs, material constants,
  statistics, laws…); your own records ("my schedule this week") go to
  `find_lens_actions`, never the web; `isDesignAsk` needs a physical cue
  (size, load, material, CAD words) for everyday nouns like table, bar, frame.
- **Kay-first home (`components/conkay/workshop/KayHome.tsx`, `Workshop.tsx`):**
  the conversation fills the screen with starters in everyday words; starters
  that need finishing go into the box. While the conversation is the screen no
  study is in view, so nothing typed is read as a beam edit, an FEA run or a
  scope refusal. The Workshop opens when Kay builds something you asked for
  (a design, a 3D model, a solve) and "Back to the conversation" is one click;
  `?stage=workshop`, `?view=`, `?design=` and the standalone `/conkay/*` routes
  open the Workshop directly. Design briefs still work from the conversation:
  Kay asks what the design needs and your answer (a number, or "defaults")
  completes the brief; an unrelated question in between goes to Kay.
- **Workshop fixes found on the way:** an opened design is opaque again (the
  Workshop stylesheet made its background transparent, so the beam and its
  parameter card showed through); solved values read in words ("Depth
  source", yes/no); out-of-scope refusals no longer fire on the everyday sense
  of a word ("resonance in music", "vibration in my car") or on "what is /
  explain" questions with no analysis verb; a go-ahead after Kay offered
  something goes to her offer; two focus `setTimeout`s became animation frames
  (the ConKay honest-motion gate).
- **Model down, said plainly:** "I can't reach my language model right now, so
  I can't answer that yet. Try again in a minute. Building and checking parts
  in the Workshop still works without it."

### Tests

- `server/tests/conkay-everyday-routing.test.js` (7): life/opinion asks are
  `think` with no forced tool; job status only for real job questions;
  everyday words are not parts (and real parts still are); fact-hungry asks
  search, stable knowledge does not; own data goes to lenses; compute, recall,
  "can you remember"; the policy wording.
- `concord-frontend/tests/conkay-workspace.test.tsx` "ConKay — Kay first" (6):
  opens on the conversation; everyday messages reach Kay with no beam edit,
  refusal or re-solve; starters; Workshop open/back; a built model opens the
  Workshop and back stays back; the brief flow from the conversation.
- Chat's routing suites (180 tests) unchanged and green.

### Open

- `server/tests/conkay-envelope-refusal.test.js` "showcase brief async
  acceptance" fails in a container without the OCP CAD kernel
  (`cadquery-ocp`): mass and top speed come back NOT_COMPUTED. Pre-existing
  and environment-bound; needs the kernel in CI or a decision on whether those
  requirements may depend on the CAD body.
- "Solve now with defaults" hands the brief to the model (the question policy
  has no cited default for e.g. a bracket's arm length), so it needs a running
  model; answering the questions works without one.
