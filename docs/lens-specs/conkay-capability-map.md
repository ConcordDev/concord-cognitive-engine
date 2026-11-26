# conkay — Capability Map

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
