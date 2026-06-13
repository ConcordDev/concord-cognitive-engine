# Concord continuation plan — Depth sweep (to ceiling) + ConKay honest hologram

> **This is the live master plan. The `/root/.claude/plans/` copy is container-ephemeral —
> THIS file is the durable source of truth.** Two independent tracks (run both in parallel).

---

## 🟢 HANDOFF — start here (next instance reads this first)

**Branch:** `claude/handoff-block-docs-7XVgT` (latest work)  ·  **Honest floor:** **0.688** (`node scripts/grade-macro-depth.mjs --honest`) — plateaued ~+0.001–0.002/wave (21 waves done; high-yield band exhausted; practical ceiling ~0.71–0.72). 100% of macros have shape coverage; ~70% of non-`utility` macros have a behavioral test. The whole sweep surfaced only ~9 real bugs total — a low defect rate, so the macro layer mostly works.

> **Strategic companion doc (read alongside this):** `docs/SCIFI_FEASIBILITY_MAP.md` — a
> code-grounded audit (2026-06-08) of what's already built vs. frontier (~10/13 iconic sci-fi
> software systems already in-substrate). The audit **corrected** two things
> this plan leans on: engineering **CAS + beam-frame FEA are a real STRENGTH**, and
> external **connectors are scaffold** (only MCP + OAuth-signin are real) → now tracked as **Track C**.

**What the latest session did (2026-06-08, continuation):**
- **25 concentrated destinations + cross-mounted panels.** `lib/panel-registry.ts` (lazy,
  addressable-by-id) + `panel-affinity.ts` + `GlobalPanelHost`/`CrossMountedPanels` + a grouped
  sidebar "Destinations" tier + per-destination `DestinationNav` workspace tabs. All 259 lenses
  still reachable via hub/sub-lens-tree/extensions/⌘K.
- **Prod de-demo.** Killed the demo chrome (rival-shape "preview" banner → neutral titles, Depth
  "Demo" badge suppressed, stale onboarding copy) AND removed fabricated data from **31 world-lens
  UX panels** (fake federation peers, a `csk_live_…` key, a faked on-chain tx-hash) — then **wired
  all of them to REAL data**: 15 new/extended STATE-backed backend domains (sensor, digital-twin,
  standards, notary, service-market, profile, presence, seasonal, cobuild, district, companion, hub,
  analytics world/global) + VoiceAssistant on the real STT+brain path. Each domain registered +
  behaviorally tested. 3D world render path untouched (only flat HUD panels changed).
- **Depth sweep continued: floor → 0.688** (waves 7–21). See the recalibrated framing above.
- **Strategy:** landed `docs/SCIFI_FEASIBILITY_MAP.md` (code-grounded, three-agent audit —
  inflated counts replaced with anchor-files + depth verdicts; engineering CAS/FEA confirmed a
  STRENGTH; connectors confirmed scaffold). Added the **reveal-not-invent reframe** + **Track C**
  (marquee connector honesty) above. CLAUDE.md handoff refreshed.
- **Track A — fleet wave 7: floor 0.648 → 0.65.** bridge (CREATE, 38 cases/19 macros) +
  atlas/sports/studio/worldmodel (EXTEND, ~87 cases). No source bugs this wave; guard clean
  (3,540 behavioral tests / 139 files).
- **Track B — Phase 2 foundation shipped (honest FUI binding).** New `conkayHudStore.ts` (zustand)
  whose ONLY writer is the macro:* socket adapter (the overlay's Phase-0 lifecycle handlers);
  `ConKayScene` gained `OrbitalRings` that spin IFF a real macro is in flight (ease to a dead stop
  when idle — motion ⟺ real work) + an honest telemetry chip showing the real returned
  domain.action · ok · ms. Zero `setInterval`/fake-progress added (audit grep clean). **Bloom +
  full in-scene telemetry panels deferred** (needs `@react-three/postprocessing`, not installed).

**What the prior session did (2026-06-07, continuation):**
- **Track B — Phase 0 DONE + Phase 1 DONE.** Phase 0 honest event spine: `/api/lens/run`
  emits real `macro:started/completed` (with `{ok,ms}`) to the caller's `user:<id>` room,
  gated on an opt-in `x-conkay-run-id`; `realtimeEmit` gained `{userId}` targeting; shapes
  registered; `ConKayOverlay` binds a step 1:1 to the real events (no fake progress). Phase 1
  verification climax: the `reason.verify` macro now drives the TrustBadge (real verdict —
  grounded / citations_resolve / unsupported / fabricated_citation / unverified). Tests:
  `server/tests/conkay-macro-lifecycle.test.js` (9/9). Frontend type-check clean.
- **Track A — Depth sweep: floor 0.628 → 0.645.** ~32 domains landed across 5 fleet waves +
  2 direct (observe, federation, gallery, daily, mining, supplychain, reasoning, pharmacy,
  music, organ, hr, energy, pets, hypothesis, forestry, cri, integrations, desert, world,
  schema, defense, resonance + extends to agents/government/billing/reflection/food/healthcare/
  astronomy/worldmodel/atlas/automotive). **3 real bugs caught + fixed**:
  `supplychain.scenarioSimulate` (`Math.max(1,…)` phantom alternate supplier),
  `schema.schemaValidate` (integer fields silently accepted non-numbers),
  `defense.resourceAllocation` (`||` collapsed critical priority 0 → medium). Guard: 3340
  behavioral tests / 137 files. **The subagent fleet works reliably** — the standardized
  CREATE prompt AND the append-only EXTEND variant are both proven; clean (no-test) domains
  are mostly exhausted, so most remaining gain is via EXTENDs.
- **Causal-closure experiment built** (the user's dtus.js / "is the in-basis state causally
  closed?" direction): `server/lib/causal-closure.js` (capacity-ladder ceiling predictor —
  linear→poly2→gradient-boosted-trees — via blocked CV; residual surrogate-determinism test;
  awareness-index bridge probe; basis-completion saturation control), `tests/causal-closure.test.js`
  (15/15 synthetic ground truth), CLI `scripts/causal-closure-analyze.mjs`, two opt-in capture
  sites (`CONCORD_CAUSAL_LOG` in `runAwarenessLoop`, `CONCORD_CAUSAL_TICK_LOG` in `governorTick`),
  doc `docs/CAUSAL_CLOSURE_EXPERIMENT.md` (grounded in `dtu_008_irreversible_constraint_cones`).

**Two tracks, run in parallel (owner-locked):**

- **Track A — Depth sweep (mechanical, background).** Continue the proven loop to the ~0.73
  ceiling. `node scripts/depth-backlog.mjs` → dispatch 6 parallel subagents (one domain each) →
  per-agent self-verify green + guard (commit doesn't boot the server) → per-wave
  `node scripts/check-depth-tests.mjs` + `node scripts/grade-macro-depth.mjs --honest` → push.
  **The clean (no-test) high-leverage domains are mostly exhausted** — most remaining gain is in
  **EXTENDING existing partial-coverage test files** (use the append-only EXTEND prompt: read the
  existing file + the domain source, append `describe` blocks for UNCOVERED macros, never modify
  existing cases). **~15–18 waves remain.** Wrapping/gotchas in the "Track A" section below.

- **Track B — ConKay honest hologram (the build).** Phase 0 + Phase 1 are shipped. Next is
  **Phase 2 — FUI holographic scene** (upgrade `ConKayScene` to the JARVIS HUD: orbital rings
  that spin only while a real macro is in flight, telemetry panels showing real returned values,
  selective Bloom where glow ∝ a real value, zustand store written ONLY by the socket adapter).
  Full design in the "Track B" section.

**The one non-negotiable rule (Track B):** *honest by construction* — every animated element
is a pure function of a real backend event; **zero ambient/`setInterval` "progress."** A ring
lights iff a real `macro:started` arrived; a telemetry number is the actual returned value; the
trust badge is the actual `reason.verify` verdict. Enforce:
`grep -rE "setInterval|setTimeout" concord-frontend/components/conkay/` → none may drive "work."

**To resume right now:**
1. `git checkout claude/conkay-honest-hologram-handoff-GvghP && git pull`.
2. Track A: `node scripts/depth-backlog.mjs` → dispatch a fleet wave (EXTEND variant for
   partial-coverage domains). Track B: start Phase 2 (`ConKayScene` FUI scene, bound to the
   `macro:*` lifecycle already emitted by Phase 0).
3. Keep `audit/macro-depth-honest.json` refreshed + this floor number updated each wave.

---

## The strategic frame (load-bearing — reframes the whole product)
The product is **the verified, private compute-agent for R&D** — not a consumer Jarvis.
- **Verification IS the product**, not a feature. "Almost right" is disqualifying for a load
  calc or a reaction. The Grounded/Reasoned badge + `reason.verify` are the *core value prop* —
  make them bulletproof and **visible**.
- **Private/local is the moat funded labs structurally can't cross.** Pharma/defense/materials/
  hardware labs legally cannot send IP to cloud LLMs. Concord runs on their own Ollama, never
  phones home — for a huge slice of serious R&D, the only legal option.
- **Wedge, not "R&D":** "the verified, private compute-agent for [one discipline's one painful
  workflow]." Macros go deepest in the CAS (`math.js`), FEA (`engineering`), `chem`, `materials`
  — all behaviorally tested now. ("R&D" broadly = 259 lenses again = the wedge trap.)
- **The "weaknesses" are credibility:** refusing to fake the unknown is the most trust-building
  behavior for a scientist. ConKay's honest hologram makes the real, verified work *legible*.

### Strategic reframe: reveal, don't invent (2026-06-08, code-grounded)
The `docs/SCIFI_FEASIBILITY_MAP.md` audit informs the *shape* of the work, not the honesty rule:
- **~10/13 iconic sci-fi software systems are already in the substrate** — verified, mostly
  production-grade. The remaining software/AI work is surfacing + polish + testing, not new
  capability.
- **The R&D wedge is now defensible by code, not aspiration:** `domains/math.js` (real CAS) +
  `lib/simulation/fea-solver.js` (real direct-stiffness beam-frame FEA) + `materials.js` + `chem.js`.
  Lead the pitch with "private compute-agent that does the math, runs the FEA, shows its work."
- **The honest gaps are bucketed:** hardware (suits/robots/AR), full CAD + tetra/nonlinear FEA,
  real-world prediction (out of scope by design) — and **external connectors are scaffold** (the one
  software-side gap), which is why **Track C** exists below.
- **Priority order (from the feasibility map §7):** (1) surface+polish ConKay [Track B] → (2) pick
  ONE wedge audience + ship the 3-min first-win → (3) build-in-public "here are the receipts" →
  (4) make the marquee connector real before claiming it [Track C] → (5) hardware frontier, later.

---

# Track A — Depth sweep: continue to the ceiling (mechanical)

**Status:** 0.628, climbing ~+0.004/wave (mid/long tail now). Ceiling ~0.73 (utility weighted
0.6 → honest 1.0 impossible by design). ~18–22 waves remain.

**The proven loop (just repeat):**
1. `node scripts/depth-backlog.mjs` → top 6 uncredited domains.
2. Dispatch **6 parallel subagents**, one per domain, standardized prompt: isolated
   `DB_PATH=/tmp/depth-<d>.db`; **self-verify to `# fail 0` + run the guard before reporting**;
   read source for exact contracts; assert exact value / round-trip / rejection; fix any REAL
   source bug surgically + report it; never fake/weaken; never touch economic constants.
3. As each reports green, commit it (commit doesn't boot the server → no collision with the
   other agents' in-flight boots).
4. Per wave: `node scripts/check-depth-tests.mjs` (cheap static gate) →
   `node scripts/grade-macro-depth.mjs --honest` refresh → commit snapshot → push.
5. **Verify-then-commit any agent that touched SOURCE** (review the diff; run the domain's
   depth + parity tests). That discipline is how all 9 bugs were caught safely.

**Ground truth (unchanged):**
- Harness (`server/tests/depth/_harness.js`): `lensRun(domain, action, {data,params}, ctx)` for
  the `registerLensAction` family; `macroRuntime(label)` → `{runMacro, ctx}` for the `register()`
  family. `depthCtx(label)` for shared state.
- `lens.run` wrapping: dispatch success → `r.result.<field>`; handler refusal → `r.result.ok ===
  false` + `r.result.error`. Some domains double-nest: `r.result.result.<field>`.
- **Guard gotcha:** `scripts/check-depth-tests.mjs` mis-parses a standalone `RegExp.test(` as an
  `it()` → use `.includes()`/`.find()` instead of `/re/.test(x)` in assertions.
- **Run recipe (mandatory `--import` preload or boot hangs ~2min on network):**
  `cd server && DB_PATH=/tmp/depth-<d>.db node --test --import=./tests/preload/no-egress.mjs --test-force-exit --test-timeout=60000 tests/depth/<d>-behavior.test.js`
- Harness `STATE_PATH` is auto-isolated to a tmp file (fixed this session) — don't revert it.

**Critical files:** `server/tests/depth/_harness.js`, `README.md`; templates
`server/tests/depth/{logistics,code,message,trades}-behavior.test.js`;
`scripts/{check-depth-tests,depth-backlog,grade-macro-depth}.mjs`;
`audit/macro-depth-honest.json`; `docs/DEPTH_FLEET_PLAN.md`.

**Stopping rule:** backlog exhausted OR floor plateaus near ~0.73. Do NOT pad macros to chase 1.0.

---

# Track B — ConKay honest hologram (the build)

### The principle (the whole moat)
**Honest by construction.** Every visual beat maps **1:1 to a real event or field**. No fake
spinners, no scripted "thinking…", no `setInterval` "activity" untied to a real call. Bar:
"**impossible to tell the animation from the truth, because there's no gap.**" The instant an
animation outruns the real capability, it's faking — the one sin the project avoids.

### What's already REAL and bindable (codebase survey, this session)
- **ConKay components** (`concord-frontend/components/conkay/`): `ConKayOverlay.tsx`
  (orchestration: `submit→skill→work-steps→result`), `ConKayWorkStatus.tsx` (arc-reactor +
  step spine; already reacts to `phase` + step `state`), `ConKayViz.tsx` (**TrustBadge** at
  ~199–230), `ConKayScene.tsx` (current 3D galaxy canopy, reacts to `ConKayState` + mic
  amplitude), `ConKayHud.tsx`, `useConKayVoice.ts` (real STT/TTS + mic amplitude),
  `conkay-skills.ts` (real skills).
- **TrustBadge already honest** (`ConKayViz.tsx:199`): "Grounded" iff real `toolCalls`/`dtuRefs`/
  `sources`/`computed`; else "Reasoned — verify".
- **Real skill pipeline** (`conkay-skills.ts`): `math` → `runMacro('math','naturalQuery')` = real
  CAS (`server/domains/math.js`); `search` → `runMacro('discovery','search')` with honest
  `semantic` flag; `brief`/`activity`/`world` hit real `/api/*`.
- **`reason.verify`** (`server/domains/reason.js` + `server/lib/reason-verify.js`): deterministic
  citation floor + multi-brain council judge → `grounded`/`unsupported`/`fabricated_citation`/
  `unverified`. **Not yet wired into the badge.**
- **Juice** (`concord-frontend/lib/concordia/juice.ts`): `success/failure/milestone/discovery` +
  SFX — reuse so ConKay's actions feel native.
- **Event spine** (`server/lib/event-shapes.js` + `realtimeEmit`): chat already streams
  `chat:status/token/complete`.

### The ONE real backend gap (the keystone)
`/api/lens/run` (handler ~`server/server.js:38589`) is single request→response with **NO
intermediate lifecycle events** — so a macro's work is invisible mid-flight and any "analysing…"
beat would be *guessed* (= faking). **Fix (Phase 0):** emit real socket events scoped to the
caller's room via `realtimeEmit` + register shapes: `macro:started` → optional `macro:stage` →
`macro:completed`. ~20 lines. Then the hologram is *literally the system reporting its own work*.

### Build phases (each shippable AND honest on its own)
- **Phase 0 — honest event spine (do first).** Emit `macro:started/stage/completed` from
  `/api/lens/run` + register shapes; subscribe ConKayOverlay; rebind the existing step-spine +
  arc-reactor to the REAL macro lifecycle (replace the locally-timed `setStep` choreography).
  Pin with a test (`/api/lens/run` emits started+completed to the room). **No new visuals** —
  just make the current UI honest end-to-end.
- **Phase 1 — verification climax.** Wire `reason.verify` so the TrustBadge shows the real
  verdict; animate the **Grounded snap-on as the climax beat** (fabricated-citation → "unverified").
- **Phase 2 — FUI holographic scene.** Upgrade `ConKayScene` to the JARVIS HUD: orbital scanner
  rings that spin **only while a real macro is in flight**, telemetry panels showing **real
  returned values**, particle core pulsing to real progress, mic waveform. Holographic glow via Bloom.
- **Phase 3 — exploded-view artifacts (discipline-generic).** For a macro returning a structured
  artifact `{ artifact: { kind, components[] } }`, render the exploded 3D view: per-component
  groups, raycast click → expand → **real component detail from the real artifact**. Clicking/
  "expand this" calls a real macro. Generic across CAS/FEA/chem/materials — each opts into the shape.
- **Phase 4 — multibrain partnership loop.** The reason it's multibrain: the user talks to ConKay
  **mid-operation** — the conscious brain converses (streaming `chat:*` exists) while a utility
  macro runs; real-time adjustments re-issue macros.

### Tech stack (research-confirmed, cited)
- **R3F** + **@react-three/drei** (`Html` panels, `Billboard` labels, `Line`/Line2 leader-lines,
  `Text`/troika SDF, `Instances`/`Instance` for rings/particles in one draw call).
- **Holographic look:** **`HolographicMaterial`** (ektogamat drop-in shader — scanlines + fresnel
  + blink via props) → teal/orange JARVIS material, no custom GLSL to start.
- **Glow:** **@react-three/postprocessing** `Bloom` with **`luminanceThreshold:1`** → bloom is
  *selective by physics*: a panel glows **because its value is HOT**, not decoratively. `Selection`+
  `Outline`/`SelectiveBloom` highlight the active/clicked part.
- **State binding (load-bearing R3F rule):** a **zustand** store (`conkayHudStore`) whose ONLY
  writer is the socket-event adapter. Split by frequency: **discrete events → selector-driven**;
  **per-frame interpolation → refs in `useFrame`** (`pos.lerp(targetRef, dt*k)`), never a 60fps
  selector. Reuse the `ConKayBackdrop` client-only dynamic-import.
- **Exploded view:** per-part `targetOffset` from centroid; **GSAP timeline** for explode (amount
  bound to pipeline progress); `useFrame` lerp for live settle (target can change mid-flight).
  Raycast `onClick` → `activePart` → anchored `Html`/`Billboard` detail = real last `TOOL_CALL_RESULT`.
- **a11y/perf:** `@react-three/a11y` + `matchMedia('(prefers-reduced-motion: reduce)')` → degrade
  to static panels; instancing keeps the frame budget.

### Model `macro:*` on the AG-UI lifecycle vocabulary (emerging standard)
`RUN_STARTED` → `STEP_STARTED`/`STEP_FINISHED` → `TOOL_CALL_START` (`toolCallId`+`toolCallName`) →
`TOOL_CALL_ARGS` → `TOOL_CALL_RESULT`/`TOOL_CALL_END` → `RUN_FINISHED`/`RUN_ERROR`. Consumer is a
clean `switch(event.type)`. **Event → beat (1:1):**

| Real event | HUD beat |
|---|---|
| `RUN_STARTED` | core powers on; rings spin up |
| `STEP_STARTED {stage:"route→math"}` | that ring segment lights; leader-line draws to the part |
| `TOOL_CALL_START {toolCallName:"math.naturalQuery"}` | part pulses (selective bloom — *it's hot*) |
| `TOOL_CALL_RESULT {result:42}` | telemetry panel renders the **real** `42`; part settles |
| `reason.verify` verdict | badge resolves **Grounded** (green) vs **Reasoned—verify** (amber) |
| `STEP_FINISHED`/`RUN_FINISHED` | part re-assembles into the core |
| `RUN_ERROR` | part flashes red; ring breaks |

### Honesty invariant (code rule)
> **Every animated element is a pure function of a real backend event; ZERO ambient progress.**
> No `setInterval`, no fake percentage easing, no "thinking…" spinner independent of the stream.
> The deliberate inverse of "benevolent deception" (fake progress bars). Enforce:
> `grep -rE "setInterval|setTimeout" concord-frontend/components/conkay/` → none drives "work."

### Critical files (Track B)
- Frontend: `concord-frontend/components/conkay/{ConKayScene,ConKayOverlay,ConKayViz,ConKayWorkStatus}.tsx`,
  `conkay-skills.ts`; `concord-frontend/lib/concordia/juice.ts`; new `conkayHudStore` (zustand).
- Backend: `server/server.js` (`/api/lens/run` ~38589 — emit lifecycle events);
  `server/lib/event-shapes.js` (register `macro:*`); `server/lib/reason-verify.js` +
  `server/domains/reason.js` (wire into badge).

### Verification (Track B)
- Phase 0: server test — `POST /api/lens/run` emits `macro:started`+`macro:completed` to the
  user's room. Manual: open ConKay, run a macro, step-spine tracks the REAL backend (kill the
  brain → beats still reflect real call start/finish, just no LLM step).
- Phase 1: badge shows the `reason.verify` verdict; fabricated-citation → "unverified".
- Phase 2+: device QA for holographic motion/Bloom; reduced-motion fallback; FPS budget.
- Honesty audit: the `grep` above returns nothing driving "work."

### Sources (research)
R3F docs (pitfalls/scaling/events); ektogamat `HolographicMaterial`;
`@react-three/postprocessing` Bloom/Selection/SelectiveBloom; drei (`Html`/`Billboard`/`Line`/
`Text`/`Instances`); troika-three-text; GSAP R3F exploded-view (DevDojo); `@react-three/a11y`;
AG-UI events spec + CopilotKit 17-event-types; "benevolent deception"/fake-progress critiques.

---

# Track C — marquee connector honesty (verify-before-pitch → build)

**Why it exists:** the feasibility audit found "external integration ✅" was the one *overstated*
software claim. Reality today:
- **MCP — real + bidirectional.** `server/lib/mcp-server.js` exposes ~200 macros to MCP clients;
  `server/lib/mcp-client.js` calls external MCP servers (SSRF-guarded). Keep pitching this.
- **OAuth — sign-in/identity only.** `server/lib/oauth-providers.js` + `server/routes/oauth.js`
  verify Google/Apple JWTs against provider JWKS, then **discard the access/refresh tokens** — no
  write-back, no ongoing API access.
- **iCal — read-only pull.** `server/domains/calendar.js` accepts `direction: pull|push|two-way`
  but only `pull` is implemented; "two-way/push" is label theater, in-memory, no DB persistence.
- **Gmail/Sheets/Slack/GitHub/Notion — catalog scaffolding.** `server/domains/integrations.js`
  `connectApp` stores a fake `tok_${random}`; zero real API calls.

**The honest pitch right now:** "real bidirectional MCP + OAuth sign-in; deep connectors are
on the roadmap." Do **not** claim two-way Gmail/Calendar until the build below lands.

**Build (sequenced after ConKay surface/polish + a wedge audience):**
1. **Persist OAuth tokens** — encrypt + store Google refresh tokens (migration + a `oauth_tokens`
   table keyed by `(user_id, provider)`), with refresh rotation. Gate behind explicit consent.
2. **Google Calendar two-way** — real `googleapis` calendar read + write-back; make
   `calendar.js` `direction: two-way` actually push. Pin with a contract test (round-trip an event).
3. **Relabel honestly in the meantime** — surface iCal as "read-only" in the UI until #2 ships;
   surface scaffold connectors as "coming soon" badges (the personas-lens Z4 pattern), never as
   "connected."

**Stopping rule:** ONE marquee connector real end-to-end (Calendar) beats five scaffolds.
Resist re-expanding the catalog before the first connector genuinely round-trips.

---

## Owner decisions (locked)
- **Discipline = ALL → build generic.** Hologram is discipline-agnostic: binds to the generic
  `macro:*` lifecycle + artifact shape, renders whatever real call arrives — no per-discipline
  code. Cleaner + more honest. The "wedge" is a go-to-market choice, not a build fork.
- **Sequencing = BOTH in parallel.** Track A auto-dispatches waves in the background; build
  effort focuses on Track B Phase 0.
