# conkay — Capability Map

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
