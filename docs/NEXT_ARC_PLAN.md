# NEXT ARC — ConKay JARVIS + Shared Primitives + the 43-Idea Backlog

## 🟢 HANDOFF — start here

**Status update (2026-07-03): Wave 1 is SHIPPED.** Every phase in Track K
(K1–K6, K6-voice) and Track P (P-A, P-B, P-C, P-D) landed on this branch —
see the per-phase SHIPPED markers in §B and §C for commit hashes and
evidence. What follows below is the original hand-off framing (kept for
context); read it as "what Wave 1 was," not "what's still to do." Next work
pulls from the ranked backlog in §D.

You are picking up the arc that follows the v1 production release (PR #841: W1–W10
release, G1–G8 gap closure, H1–H5 docs-as-build-artifact — all merged to main
2026-07-02). This doc is the live plan; the `/root/.claude/plans/` copy is
container-ephemeral — **this repo doc is the source of truth.**

- **What this arc is:** Wave 1 = the **ConKay JARVIS flagship** (Track K below) +
  the **shared-primitives companion track** (Track P). Everything else from the
  user's ideas live in the ranked, audit-annotated 43-item **backlog** (§D) that
  you pull from as waves complete. These choices were made explicitly by the
  owner on 2026-07-02 (§"Locked decisions").
- **How to work:** the method in §A is non-negotiable — it is the same
  audit→research→re-audit→execute + honest-by-construction + compute-don't-guess
  discipline in CLAUDE.md's "How we work here," restated with arc-specific
  bindings. Re-audit any % or file path below before building on it; if reality
  disagrees with this doc, fix this doc in the same commit.
- **Start with:** Track K phase **K1** (honest stage-beat expansion — it gates
  every other ConKay phase) and Track P **P-D** (the governance design doc the
  owner asked for) — these are disjoint and can run as parallel units.
- **Ground rules that bind every unit:** develop on your designated branch only;
  no fabricated data anywhere; stage only named files; one heavy Node process at
  a time; every unit lands with its tests green and the three doc gates passing
  (`node scripts/check-doc-claims-all.mjs --ci`,
  `node scripts/verify-invariant-test-links.mjs --ci`,
  `node scripts/generate-wiring-doc.mjs --check`).

### Provenance of this plan

Three parallel read-only code audits (sci-fi 15 × substrate, grounded 30 ×
substrate, ConKay + 3D capability) plus web research (Jayse Hansen's Iron
Man/Avengers FUI principles; *Make It So*, Shedroff & Noessel) produced the
ground truth below on 2026-07-02. Headline corrections the audits made to the
naive reading of the idea list:

- **Most ideas are 40–80% already built.** The idea list reads as greenfield;
  it is mostly *assembly* over shipped engines. Check
  `docs/NOVELTY_INVENTORY.md` before building anything.
- **Ten shared primitives each unlock 3–6 ideas** (§C, §D.3). Building
  idea-by-idea would rebuild the same missing pieces repeatedly.
- **ConKay's plan-doc blocker is stale**: `docs/CONKAY_HONEST_HOLOGRAM_PLAN.md`
  defers Phase-2 Bloom/panels on a missing `@react-three/postprocessing` — it
  is now installed (`concord-frontend/package.json`: three `^0.160`,
  `@react-three/fiber ^9.6.1`, drei `^10.7.7`, `@react-three/postprocessing
  ^3.0.4`). Nothing in the stack blocks the concept image.
- **The JARVIS research independently validates the honesty rule.** Jayse
  Hansen (lead FUI designer, Iron Man 2/3, Avengers): motion that carries no
  real message reads as fake to audiences. Concord's "every animated element is
  a pure function of a real backend event" is the same principle arrived at
  from the verification side. The honesty rule is not a constraint on the
  JARVIS vision — it IS the JARVIS vision.

### Locked decisions (owner, 2026-07-02)

1. **Wave 1 = ConKay flagship + shared primitives first** — compounding
   infrastructure before individual products.
2. **Plan format = Wave 1 detailed + ranked backlog** — no premature wave
   assignment of all 43 ideas; reality corrects plans.
3. **Governance model gets designed NOW (P-D), as a doc for owner review** —
   consent for phenomenal/personal data, joint DTU ownership, retroactive
   royalties, fork rental. **No economy-touching code ships without explicit
   owner sign-off** — the marketplace-fee/royalty constants are constitutional
   invariants (CLAUDE.md "Key Invariants").

---

## A. The method (non-negotiable)

1. **Audit → web-research → synthesized re-audit → execute**, with pre-agreed
   honest stop-points (§F). Audits correct plans in BOTH directions — expect
   items already done and real gaps nobody listed.
2. **Check `docs/NOVELTY_INVENTORY.md` before building anything.** The audit
   tables below name the substrate per idea; verify the named files still do
   what the table says before extending them.
3. **Honest by construction.** No fake/mock/simulated data in shipped paths;
   honest failures (`{ ok:false, reason }`); unwireable UI stays unrendered
   with a documented reason. ConKay-specific form: every animated element is a
   pure function of a real backend event; zero `setInterval`/fake progress
   (enforcement: `grep -rE "setInterval|setTimeout"
   concord-frontend/components/conkay/` must stay empty); only the socket
   adapter writes `conkayHudStore` (single-writer).
4. **Compute-don't-guess.** Boot the server once via
   `server/tests/depth/_harness.js#lensRun` and use Concord's deterministic
   engines (CAS `domains/math.js`, FEA `lib/simulation/fea-solver.js`, glyph
   algebra, economy conservation) as the oracle for every expected value.
5. **Metrics you can't game.** `scripts/autoloop/guard.mjs` PROTECTs the
   graders/baselines; money/auth invariants are human-escalation. This arc has
   a dedicated governance phase (P-D) precisely because several backlog items
   press on those invariants.
6. **Docs are a build artifact.** Derived numbers carry reproduction commands;
   the three doc gates are blocking in CI. When a unit changes a count, refresh
   the doc in the same commit.
7. **Orchestration discipline.** Parallel disjoint-file subagents with the
   honesty rules in every prompt; one heavy Node process at a time; `git add
   <named paths>` only; salvage a dead agent's on-disk work (verify, then
   commit) rather than discarding or re-doing it; run the affected flow before
   claiming done.

---

## B. WAVE 1 — Track K: ConKay JARVIS (flagship)

**The vision** (owner's concept image): summoning ConKay takes over the screen
as a spatial holographic FUI cockpit — floating panels for **DTU Provenance**,
**Macro Library Access**, and **Forward-Sim Previews** arranged around a live
wireframe **lattice globe**; voice-forward persona; and anything ConKay creates
(blueprints, FEA results, forge apps, foundry worlds) can be spawned into an
**interactive 3D scene** the user rotates, explodes, and inspects. The
JARVIS-workshop feel — built honest.

### Ground truth (audited 2026-07-02)

- **Phases 0–1 of `docs/CONKAY_HONEST_HOLOGRAM_PLAN.md` are SHIPPED.** The
  honest event spine: `/api/lens/run` emits real
  `macro:started`/`macro:stage`/`macro:completed` to the caller's `user:<id>`
  room, gated on the `x-conkay-run-id` header (`server/server.js` ~39283–39421,
  `emitMacroLife`; shapes in `server/lib/event-shapes.js`; pinned by
  `server/tests/conkay-macro-lifecycle.test.js`). `reason.verify` drives the
  TrustBadge with the real verdict (proven/refuted via Z3, grounded /
  unsupported / fabricated_citation, council confidence).
- **Phase-2 foundation is SHIPPED**: `conkayHudStore.ts` (zustand,
  single-writer) + `OrbitalRings` in `ConKayScene.tsx` (spin iff `inFlight >
  0`, ease to dead stop when idle) + telemetry chip. The remaining Phase-2 tail
  (in-scene panels + selective Bloom) was blocked on
  `@react-three/postprocessing` — **that blocker is stale; the dependency is
  installed.**
- **Component inventory** (`concord-frontend/components/conkay/`):
  `ConKayOverlay.tsx` (orchestration, Cmd/Ctrl+J summon, full-screen
  `fixed inset-0 z-[80]` takeover, socket subscription filtered by run id),
  `ConKayViz.tsx` (TrustBadge/VerdictBadge), `ConKayScene.tsx` (R3F world-tree
  + HoloShell + Bloom), `ConKayArtifactExploded.tsx` (exploded view of real
  `ar.render` artifacts, gsap + OrbitControls), `ConKayWorkStatus.tsx`
  (arc-reactor + step spine), `ConKayBackdrop.tsx` (WebGL chooser),
  `ConKaySurface.tsx` (2D fallback), `ConKayHud.tsx`, `HolographicMaterial.ts`
  (fresnel + scanline shader), `conkay-skills.ts` (math→real CAS,
  search→`discovery.search`, brief/activity/world/help/open),
  `useConKayVoice.ts` (Web Speech STT + MediaRecorder/Whisper fallback +
  Piper/ElevenLabs TTS), `conkay-persona.ts`, `useMicAmplitude.ts`,
  `conkayHudStore.ts` (+ test).
- **Voice stack**: `lib/voice/piper-stream.ts` → `voice.tts` macro (returns
  `{ok, audioBase64}`) with a per-frame **amplitude envelope** (mouth-sync
  ready); `server/lib/voice-synthesis.js` is an env-gated ElevenLabs wrapper
  with sha1 disk cache; Web Speech fallback picks a generic voice by name-hint.
  **SHIPPED (K6-voice, `707d34c1`):** a pinned identity now exists —
  `concord-frontend/components/conkay/conkay-persona.ts` defines
  `CONKAY_VOICE_ID = 'en_US-amy-medium'` and `CONKAY_SIGNATURE_GREETING =
  'Kay, online.'`, plus a real decoded-audio envelope (`ttsAmplitudeRef`)
  that pulses the scene on ConKay's own speech. Honest caveat carried by the
  commit itself: the server-side `voice.tts` macro currently only reads
  `PIPER_VOICE` from env and ignores a per-request `input.voice` — so the
  frontend identity is pinned but not yet guaranteed to steer server-side
  audio synthesis. That gap is real and undocumented elsewhere; note it if
  you touch the voice path next.
- **Reusable 3D substrate**: `components/atlas/GraphView.tsx` (force-directed
  DTU graph, canvas Verlet, zero new deps), `components/world/concordia-hud/PanelHost.tsx`
  (spatial FUI panel layout), `components/world-lens/BuildingRenderer3D.tsx`
  (BuildingDTU→3D with `ViewMode: normal|stress_heatmap|validation`),
  `components/engineering/FEAResultViewer.tsx` + `server/lib/simulation/fea-solver.js`
  (real beam-frame FEA), `components/world-lens/ARPreview.tsx` (real WebXR
  immersive-ar with hit-test), `server/domains/foundry.js` (worldspec/blueprint
  compiler, migrations 191–192), `server/lib/forge-template-generator.js`
  (single-file app generator), `components/world/ForwardPredictionsPanel.tsx`.
- **Macro catalog is real data**: `/api/lens-actions/:domain` returns the
  registered macros for any domain.

### JARVIS interaction principles (from the research — bind the build to these)

1. Everything animated carries a real message (Hansen's #1; = our honesty rule).
2. Glanceable complexity — sophisticated at a glance, readable in ~1s, detail
   on demand.
3. Grounded in operator logic — panels mirror real system state, never
   decoration.
4. Conversational turn-taking with visible acknowledgment (greeting → listening
   → working → speaking states; ConKay already has these).
5. Direct manipulation of 3D holograms — grab/rotate/explode (seeded by
   `ConKayArtifactExploded`).
6. Amplify, don't distract — the UI amplifies the user's intent, never competes.
7. **No sustained mid-air gesture** (*Make It So*'s sharpest lesson — gorilla-arm
   fatigue): voice + pointer, not Minority Report.
8. Idle presence must be visually distinct from working motion, so "alive at
   rest" is never mistaken for progress (already the `OrbitalRings`/`HoloShell`
   contract).

Sources: jayse.io · TNW interview with Jayse Hansen · postPerspective "Behind
the Title: Jayse Hansen" · *Make It So* (Rosenfeld Media) · scifiinterfaces.com.

### Phases

**K1 — Honest stage-beat expansion (backend; gates everything).**
Only `server/domains/reason.js` emits `macro:stage` today
(resolving_citations → judging → proving). Extend `ctx.emitMacroStage(stage,
detail)` to a pragmatic macro set, with stage boundaries read from each
macro's REAL execution structure (never invented): engineering FEA solve
(assemble → solve → postprocess around `lib/simulation/fea-solver.js` calls),
`foundry.validate`/`compile`/`preview` (`server/domains/foundry.js`), forge
generate (`server/lib/forge-template-generator.js`: template → compose →
validate), `discovery.search` (embed → rerank, or keyword-fallback — report
which ran), `dtu.create` (validate → persist → cite), `ar.render`. One
node--test per macro following the `server/tests/conkay-macro-lifecycle.test.js`
pattern. **Stop-point:** a macro with no natural internal boundaries stays
start/complete-only — note it, don't invent beats.

**SHIPPED (`1f2fd78e`).** `emitMacroStage` is wired into 7 macros:
`server/domains/reason.js:27`, `ar.js:1172`, `engineering.js:726` (runFEA
assemble→solve→postprocess), `discovery.js:26`, `foundry.js:47` (a shared
`_beat` helper covering validate/compile/preview), `server.js:21003`
(`dtu.create`), `server.js:31910` (`forge.generate`). Per the stop-point,
`foundry.validate` was found to be a single atomic operation with no
internal boundary and was deliberately left start/complete-only. 16/16 new
tests.

**K2 — Spatial FUI cockpit (frontend layout).**
Replace `ConKayOverlay`'s centered chat column with a panel-grid takeover
around the 3D scene. Adapt `components/world/concordia-hud/PanelHost.tsx`
rather than building a new layout system; keep the `ConKaySurface.tsx` 2D
fallback fully working (WebGL-less boxes get the same panels flat). Panels
render only real `conkayHudStore` state.

**SHIPPED (`e11e185a`, fix `4386d71a`, `cf01ae6c`) — reuse target changed.**
`concord-frontend/components/conkay/ConKayCockpit.tsx` exists and is the
panel-grid takeover, but built on **`lib/panel-registry.ts`** (lazy,
dotted-id-addressed panels), not `PanelHost.tsx` as originally scoped. The
file's own header comment explains why: *"Panels are resolved LAZILY by
dotted id through `lib/panel-registry.ts` (the reuse target — NOT the world
HUD's PanelHost.tsx, which is a single-modal, world-coupled component and
the wrong fit here)."* `4386d71a` fixed a real bug where the three built K3
panels (macro-library, provenance, forward-sim) were registered but
unreachable because default panel ids were hardcoded instead of derived
from `allPanels()`. `cf01ae6c` added a 6s disconnect grace period so motion
provably stops when the backend dies (the ConKay acceptance test in §E).

**K3 — The three concept panels.**
- *DTU Provenance*: adapt `components/atlas/GraphView.tsx` to render the live
  run's `dtuRefs` + `reason.verify` citation-resolution graph.
  `fabricated_citation` renders red and prominent — never hidden. The verdict
  IS the panel.
- *Macro Library Access*: persistent browsable catalog fed by
  `/api/lens-actions/:domain` (registered macros only). Connectors that are
  scaffold get labeled honestly ("not yet live"), never "connected."
- *Forward-Sim Previews*: real FEA / scenario-macro outputs +
  `BuildingRenderer3D` stress-heatmap ViewMode; progress bound to K1
  `macro:stage` beats, never a timer; any non-computed claim carries the
  "Reasoned — verify" badge.

**SHIPPED (`4c55072c` substrate, `99188bf2` Macro Library + Provenance,
`76e91657` Forward-Sim).** All three panel files exist under
`concord-frontend/components/conkay/panels/`: `MacroLibraryPanel.tsx` (fetches
`/api/lens-actions/:domain`), `ProvenancePanel.tsx` (reads `lastVerify` +
`runDtuRefs`), `ForwardSimPanel.tsx` (renders real FEA stage progress, no
fabricated verdicts) — each with its own test file.

**K4 — Lattice globe.**
Wireframe icosphere whose node/edge activity binds to real data: active runs +
the current session's DTU provenance graph. Rotation/pulse gated on
`inFlight > 0` (same contract as `OrbitalRings`); idle breath slow and
visually distinct from working motion.

**SHIPPED (`0db186e3` build, `0c6f1ff6` K6b bloom honesty).**
`concord-frontend/components/conkay/LatticeGlobe.tsx` +
`lattice-globe-motion.ts` (pure gating function) exist; idle vs. working
states are measurably distinct (rotation ≥0.72 rad/s working vs ≤0.05 rad/s
idle). `0c6f1ff6` made Bloom emissive-driven so only store-backed elements
glow (threshold 0.15→0.9), closing the "ambient glow" honesty risk called
out in the table below.

**K5 — Generalized artifact→3D pipeline (the "blueprints become interactive" ask).**
Introduce the `{artifact: {kind, components[]}}` schema (per the hologram
plan's Phase 3) + a kind-registry mapping macro outputs → renderers:
`ar.render` → `ConKayArtifactExploded` (exists) · engineering FEA →
`FEAResultViewer` in-scene · building DTU → `BuildingRenderer3D` · foundry
worldspec → preview · forge app → sandboxed preview. Direct manipulation:
raycast click → expand → a real macro call fetches the detail. `ARPreview.tsx`
(real WebXR + hit-test) is the stretch target for true AR inspection.
**Stop-point:** an artifact kind without a real renderer is listed
"inspectable soon" — never a fake 3D placeholder.

**SHIPPED (`7428d219`).** `concord-frontend/lib/conkay/artifact-kinds.ts`
implements the `{artifact: {kind, components[]}}` schema with 5 registered
kinds: `ar-render` ← `ar.render`, `fea-frame` ← `engineering.runFEA`,
`foundry-worldspec` ← **`foundry.preview`**, `forge-app` ← **`forge.sandbox`**
(not `forge.generate` — the sandboxed-preview macro is the one actually
wired), and `building` — a shape-driven detector that the file's own
comment documents as honestly **dormant** until a macro emits
BuildingDTU-shaped rows. Registered as `conkay.artifact-viewer` in
`panel-registry.ts`; unregistered kinds render the stop-point's "inspectable
soon" label.

**K6 — Voice persona + Bloom polish.**
Pin a ConKay voice identity (a chosen Piper/ElevenLabs voice id constant in
`conkay-persona.ts`; ElevenLabs path env-gated as today). Signature greeting:
short and non-overclaiming (the persona prompt already forbids capability
fabrication — keep it that way; "sovereign AI assistant" is fine, implied
omniscience is not). Mouth-sync via the existing `piper-stream` amplitude
envelope. Selective Bloom with `luminanceThreshold: 1` so a panel glows
*because its value is hot* — glow ∝ a real value, never ambient.

**SHIPPED (K6-voice, `707d34c1`; Bloom via K4's `0c6f1ff6`).**
`conkay-persona.ts` pins `CONKAY_VOICE_ID = 'en_US-amy-medium'` and
`CONKAY_SIGNATURE_GREETING = 'Kay, online.'`. **The per-request voice gap
noted here at ship time is now CLOSED** (2026-08-02 audit): `server.js`'s
`register("voice","tts", ...)` resolves `input.voice` via
`server/lib/voice-piper-voice.js#resolvePiperVoice` (closed allowlist, since
the value reaches `spawnSync` as `--model`), `lib/voice/piper-stream.ts`
already sends `input: { text, voice: profile.voice }` on every call, and
`useConKayVoice.ts` already requests `CONKAY_VOICE_ID` — the wire was
end-to-end before this doc was corrected to say so. Pinned by
`server/tests/voice-tts-voice-param.test.js` (15/15). Residual: no checked-in
Piper voice manifest, so an unconfigured `PIPER_VOICES_DIR` means a
missing/invalid voice silently falls back to `PIPER_VOICE` rather than
erroring (honestly reported via the macro's `voiceFallback` field).

**Sequencing (all phases now SHIPPED):** K1 first → then K2 ∥ K6-voice → then K3 ∥ K4 → then K5. Each
phase is a disjoint-file subagent unit landing with vitest (frontend bindings)
+ node--test (stage emission) + the conkay honesty grep clean.

### K-continuation — "Deep ConKay Agency" (V1.1–V1.5, undocumented until this
### 2026-08-02 audit; landed entirely after the K1–K6 snapshot above)

Read this before scoping any new ConKay work — a grounding pass found a whole
second wave of shipped ConKay features this doc never mentioned, discovered
only by `git log` against `components/conkay/` and `server/lib/`, not by
anything in this file. Treat the file inventory below as current; the phase
labels (V1.1, ConKay-B/D/E, etc.) are the real commit-message names, kept for
grep-back.

- **Ambient widget shell (V1.1, commit `b0cd0831`)** — `components/conkay/widget/ConKayWidget.tsx`
  (CK1, prop-driven idle/stand visuals, zero internal timers — grep
  `setInterval|setTimeout` in `components/conkay/widget/` must stay empty) +
  `conkayAttentionStore.ts` (CK2, single-writer bridge from ConKayOverlay's
  real open/busy/listening/speaking state).
  **CK3+CK4 SHIPPED (2026-08-02, same session as this audit).** CK4 bridges
  the widget to the real `initiative-engine.js` feed described below —
  `conkayInitiativeStore.ts` polls the exact same `/api/initiative/pending`
  endpoint `InitiativeBell.tsx` uses, and `ConKayWidget.tsx` gained an
  additive `pendingCount` badge prop (never reusing `state="speaking"` for
  this, since that would have violated the widget's own "state is only a
  real observed event" honesty contract). CK3 turned out narrower than
  originally staged: an audit of every real fixed-position element found no
  free alternate corner to relocate to (every corner besides top-right is
  already a documented occupant per `lib/ui/z-index.ts`), but DID find three
  real, currently-shipped colliders that genuinely cover the widget's exact
  spot when open — `SystemGuidePanel.tsx`'s expanded rail, `PersistentChatRail.tsx`'s
  expanded rail, and `AchievementToast.tsx`'s toast stack. All three now
  carry a `data-conkay-occludes-top-right` marker (truthful — only present
  in the DOM while genuinely visible), and `useConkayOccluded.ts`
  (`ConKayWidgetLayer.tsx`) uses a `MutationObserver` — not polling — to
  hide the widget while one is real, rather than painting over live content
  or inventing a fictitious free spot. 23 new/updated tests across
  `conkayInitiativeStore.test.ts`, `ConKayWidget.test.tsx`,
  `useConkayOccluded.test.ts`, `ConKayWidgetLayer.test.tsx` (the latter two
  files had ZERO test coverage before this pass, despite CK1/CK2 being
  shipped since V1.1).
- **Mission control + action confirm (V1.2 Wave A, `fe7bd685`/`4a2a632c`)** —
  `ConKayMissionControl.tsx` (A4: renders `conkayRunStore`'s real
  `/api/chat-agent/stream` tool-call receipts as a numbered plan, nothing
  invented/forward-looking) and `ConKayActionConfirm.tsx` (A2: pre-execution
  confirm card for any `isMutatingMacro()`-flagged client-initiated call,
  self-documented as NOT covering the server-side agent-loop path since that
  already executed before the client sees the event — an honest scope
  boundary, not a hole).
- **Cross-session continuity (V1.2 Wave B → V1.4, `0d53fc82`…`33451f3e`)** —
  `server/lib/project-thread.js` (migration 378 `projects`) links the durable
  goal tree (`goal-decomposition.js`), marathon sessions
  (`agent-marathon.js`), and conversation memory
  (`conversation-memory.js`) into one addressable, re-openable "project."
  `ConKayProjectPanel.tsx` / `ConKayMemoryPanel.tsx` are its UI, registered
  via `lib/panel-registry.ts` (`conkay.projects` / `conkay.memory` — any
  registered `conkay.*` panel id self-mounts into the cockpit grid, no
  `ConKayOverlay.tsx` edit needed). V1.4's `marathon-plan-context.js` closed
  the last gap: a marathon now actually reads `nextActionable()` and
  write-backs `setNodeStatus` instead of re-deriving a plan from a compacted
  transcript every tick.
- **Proactive nudges are REAL and already shipped — but not through ConKay's
  widget (ConKay-B/D/E, `814d4a7f`/`941eea37`/`b196194f`, 2026-07-24).**
  `server/lib/initiative-engine.js` ("Concord Conversational Initiative
  Engine — The Living Chat") is a mature, tested proactive-outreach substrate
  — 8 trigger types, rate limiting (3/day, 10/week, 4h min gap), quiet hours,
  exponential backoff, style-matched fluidity. `project-continuation-initiative.js`
  (heartbeat `project-continuation-cycle`, ~10min, kill-switch
  `CONCORD_PROJECT_CONTINUATION=0`) and `agent-marathon.js#maybeFireMarathonCheckIn`
  both fire real rows through this same gate. **The surface today is
  `components/chat/InitiativeBell.tsx`/`InitiativeChip.tsx` in the general
  chat UI (`GET /api/initiative/pending`, poll-based) — completely
  disconnected from ConKay's own ambient character.** This is what CK4
  actually is: not inventing a new proactive-suggestion heuristic (which
  would risk the honesty invariant), but bridging the ambient widget to this
  already-tested, already-rate-limited real feed.
- **Tool-authoring (V1.2 Wave E → V1.3, `a3724ec8`/`19011411`)** — a governed
  spec + first-buildable slice letting ConKay author new tools (migration 385
  `conkay_authored_tools`), plus a tool-preference signal folded into style
  learning (V1.3, `d174fa77`). Not yet audited in depth this pass — flagged
  for a future session, not re-verified line-by-line here.

**If you're picking ConKay work back up:** every item in this subsection —
including CK3+CK4 — is now shipped and tested. The tool-authoring line above
is the one item flagged for a future audit pass, not re-verified line-by-line
this session. A separate, real finding surfaced while researching CK4 and is
worth a look next: `components/chat/useChatProactive.ts` (the general chat
rail's OWN proactive system, unrelated to `initiative-engine.js`) generates
"proactive suggestion" content via `Math.random()` picks over hardcoded
string arrays (`getTimeSuggestion`/`getLensNavigationSuggestion`/`getIdleSuggestions`)
with no real signal behind them — a genuine zero-demo-content violation
sitting right next to that same file's honest, server-pushed
`initiative:new` socket listener. Not fixed this session (out of the
explicitly approved scope); flagged here so it doesn't stay invisible the
way the CK3/CK4 gap did.

### Honesty bindings per concept-image element (the fake-temptation map)

| Element | Temptation | Honest binding |
|---|---|---|
| DTU Provenance panel | decorative edges; "verified" before verification | nodes/edges only from real `dtuRefs` + citation-resolution results; unresolved = red |
| Macro Library panel | listing scaffold/aspirational macros as live | populate only from `/api/lens-actions/:domain`; scaffold labeled honestly |
| Forward-Sim panel | smooth "simulation" that's an LLM guess or timer fill | only deterministic-engine outputs; progress = real `macro:stage` beats; verify badge on the rest |
| Lattice globe | ambient JARVIS spin implying work at idle | motion gated on `inFlight`; idle breath visually distinct |
| Voice greeting | overclaiming autonomy/capability | persona prompt's no-fabrication rule extends to the signature line |

---

## C. WAVE 1 — Track P: Shared primitives

**P-A — Provenance-stamped multi-source ingest.** The single
highest-leverage missing piece found by the grounded audit: a pipeline that
turns any external source into a **signed DTU carrying origin hash +
timecode** (`lib/dtu-protocol.js` SHA-256 canonical envelope + the
SSRF-guarded `connectorFetch` chokepoint). Unlocks: personal health ledger,
quote & clip database, public finance tracker, delivery verifier, misinfo
shield, research forge. Prove it with ONE real consumer first — either the
Quote & Clip path (A/V → `/api/voice/transcribe-raw` → quote-DTUs with
timecode + source hash) or the keyless open-data wire (gov/labor APIs) —
pick by what the owner wants to demo.

**SHIPPED (`223e8eee`).** `lib/dtu-protocol.js` gained an optional
`metadata.provenance` field (C2PA-shaped); `server/lib/public-fetch.js` adds
a keyless, SSRF-guarded fetch helper (`fetchPublicUrl`, reusing
`connectorFetch`'s `validateSafeFetchUrl`/`fetchWithPinnedIp` primitives,
closing a prior bare-`fetch()` SSRF gap in `government.js`); `lib/provenance-ingest.js`
(`stampIngestedRecord`) plus the new `government.open-data-ingest` macro
(against `catalog.data.gov`'s CKAN API) is the one concrete consumer proving
the pipeline end-to-end. The commit also fixed a real canonicalization bug
where nested-object tampering in a DTU envelope wasn't detected.

**P-B — X-as-DTU listing generalization.** Generalize
`server/lib/dream-marketplace-bridge.js` (auto-list + repair-brain vetting +
royalty cascade already work end-to-end): parameterize the DTU kind, add
license terms, user pricing, and remix-derivative citation minting. Unlocks:
Qualia Bazaar, Dream Commerce, Somatic Memory Forge. **The royalty cascade
itself is NOT touched — only listing metadata.** Anything that would change
fee/royalty math stops at P-D.

**SHIPPED (`400e312d`).** `promoteDreamDTU` was generalized into
`promoteCandidateAsDTU(STATE, candidate, opts)` in
`server/lib/dream-marketplace-bridge.js`, adding `licenseTerms` (metadata
object copied onto the listing verbatim) and `userPrice` (caller-supplied
price, `price: opts.userPrice ?? 0`) — metadata-only, confirmed no
`server/economy/*` reference was added (the royalty-cascade stop-point
holds). The commit also fixed a real dead-since-introduction bug: a
`repair-brain.js` import of a nonexistent named export (`BRAIN` instead of
`BRAIN_CONFIG`) had silently broken the dream→marketplace path. Tests:
`server/tests/dream-marketplace-bridge.test.js` (7/7).

**P-C — Lattice-fork object + sandbox shard.** The fork primitive behind
Forked Self Marketplace, Mesh Soul Binding, and the Creation Singularity.
Substrate: `server/lib/world-shard-protocol.js` + `server/workers/world-shard.js`
(real forked child-process shards with write-ownership), `domains/personas.js`
(publish/install/rate/versioning), `emergent/merge.js` (field-level
conflict-safe merge). Build the **fork object** (a bounded clone of a user's
DTU corpus + temperament) + sandboxed instantiation first; **rental/marketplace
economics wait for P-D sign-off.** Beware: `domains/fork.js` is GitHub-repo
forks — a red herring, not lattice forks.

**SHIPPED (`d88bfa39` build, `2d5e50dd` N+1 perf fix).**
`server/migrations/351_fork_objects.js` creates `fork_objects(id,
owner_user_id, source_user_id, dtu_ids_json, dtu_count,
temperament_snapshot_json, agent_identity_id, status CHECK IN
draft|active|archived, created_at)`. `server/lib/lattice-fork.js` (439 LOC)
implements `createForkObject` (hard-rejects clones over `MAX_FORK_DTUS =
500`), `instantiateForkSandbox` (confined via the existing
`lib/confined-ctx.js` object-capability sandbox — writes are
unrepresentable, not just forbidden), and `mergeBackDryRun` (dry-run only,
no persistence — real merge execution is explicitly out of scope, per the
stop-point below). Rental pricing and marketplace listing are, as scoped,
not built. `2d5e50dd` fixed a genuine N+1 at `lattice-fork.js:403` found by
a fresh detector ratchet run. Tests: `server/tests/lattice-fork.test.js`
(10/10).

**P-D — Governance design doc (owner-directed: design now, code later).**
A design document — NO code — delivered to the owner for review, covering:

- **Consent model for phenomenal/personal data** — qualia snippets, dreams
  (stitched from real user activity), somatic/pain records, life-moment
  reenactment. Include `agent_disclosure` (migration 324) compliance: a
  reenacted/forked "you" must disclose it is an agent.
- **Joint DTU ownership** vs the single-`creator_id` royalty cascade — what
  breaks, what a multi-party split would require, and whether it's worth it.
- **Retroactive / cross-temporal royalties** vs the ledger-conservation
  predicate (`server/economy/balances.js#CREDIT_ROW_PREDICATE`) — the audit
  flags this as a conservation-breaking risk; design must prove conservation
  or reject the feature.
- **Fork rental terms** — consent, revocation, insight merge-back ownership,
  `agent_drift_watch` (migration 330) obligations on a rented fork.
- **Shadow Parliament advisory→auto-execute criteria** — what proof burden
  would ever justify auto-execution (default: advisory forever).

Owner approval of P-D is the gate for every economy-touching backlog item.

**SHIPPED, docs-only by design (`d80c481d`).** The design doc was delivered
covering all five bullets above: consent model, joint ownership (deferred),
retroactive royalties (default reject unless conservation is provably
maintained), fork rental (preview-only in Wave 1 — no rental economics
shipped), and Shadow Parliament (advisory-forever default). No code, schema,
or migration was touched by this unit — that is the intended shape of a
governance gate, not a gap. Owner sign-off on the doc's recommendations is
still the prerequisite for any future economy-touching backlog pull.

**OWNER-SIGNED-OFF (2026-07-18).** The owner approved P-D's five
recommendations. Each was already enforced in code (not aspirational prose):
Dream-Commerce phenomenal-monetization consent gate (`requireConsent(...,
"allow_phenomenal_monetization")` on any `userPrice > 0` promotion —
`lib/dream-marketplace-bridge.js`), fork agent-disclosure (`lib/lattice-fork.js`
mints a namespaced `agent_…` account + `agent_identities` self-model),
Shadow-Parliament advisory-by-default (`isAutoexecEnabled()` OFF unless the
operator opts in; default-deny money-free allow-list), retroactive-royalty
default-reject (the ledger-conservation predicate stays intact), and
joint-ownership deferred (single-creator cascade). The sign-off is now locked
as governance-as-code by `server/tests/governance/pd-signoff-invariants.test.js`
(8 assertions), so a future change can't silently undo a decision. Building the
gated backlog items themselves (Qualia-Bazaar trade flow, etc.) remains
separate, future, money-reviewed work — the sign-off unblocks it; it does not
switch it on.

---

## D. Ranked backlog (audit-annotated — pull from here as waves complete)

Re-verify the substrate claims before building; if a % is stale, correct this
table in the same commit.

**Re-audited 2026-08-23 against live code + `git log --since=2026-07-03`,
not against this doc's own prior text.** Motivation: a different item (the
`useChatProactive.ts` fake-suggestion removal, tracked in §B) was found to
have been fixed 30 minutes after being flagged as open, with the doc never
updated — direct proof this doc lags real commits. Four parallel audits (one
per table below) confirmed the same pattern here: **18 of the 43 items below
had real, tested, often production-wired work land since 07-03 — mostly on
07-03 itself, hours after that day's audit pass closed, or in mid-to-late
July — that was never folded back into this table.** The other 25 hold up
exactly as previously stated, including several genuinely still at ~0%. This
is NOT "the backlog is done" — most items remain well under 100%, several
untouched — it IS proof the % column specifically cannot be trusted without
re-verification, which is the whole reason this doc says to re-verify before
building. Rows below are marked `(2026-08-23)` where the % changed; unmarked
rows were re-confirmed accurate at their existing %.

### D.1 Sci-fi 15 (by leverage)

| Idea | Built | Existing substrate (verify first) | Delta | Blocker |
|---|---|---|---|---|
| Haunted Knowledge Garden | ~70% | `server/lib/procgen-regions.js` (DRIFT_TO_REGION → haunted_glade etc., idempotent-by-signature, decay-on-resolve) + `lib/lattice-quest-composer.js` + `emergent/drift-monitor.js` | drift-born entities + harvest-DTU minted on resolve | none material |
| Dream Commerce Protocol | ~92% (2026-08-23) | Same substrate + `ab08469f6` (real `allow_phenomenal_monetization` consent gate, mig 355 — closed the P-D blocker) + `8e2854d59` (real money wired: `dtu.marketplace`/`purchaseWithRoyalties`, `server/emergent/dream-cycle.js:384`, `server/server.js:53453`) | remix-derivative citation minting (thin, not yet wired) | none material — consent + monetization both shipped |
| Shadow Parliament | ~78% (2026-08-23) | Same substrate + `fabee84d7` — new `server/lib/shadow-parliament.js`: bounded-autonomous `enact()` with allowlist + dissent-veto, mints an audit DTU, 27/27 tests | the auto-execute path is now BUILT (kill-switch default-OFF, not yet live) — doc previously said "ship ADVISORY only," that constraint is now a runtime flag, not a missing feature | flip the kill-switch → P-D |
| Oracle Prophecy Engine | ~65% | `lib/oracle-engine.js` (6-phase, STSVK theorem check, mints `oracle_answer` DTU) + `lib/embodied/forward-sim.js` + HLR | live-updating prophecy DTUs joining oracle+forward-sim+council | calibration honesty |
| Qualia Bazaar | ~60% (2026-08-23) | Same substrate + `8e2854d59`'s `promoteQualiaSnapshot()` (`server/lib/dream-marketplace-bridge.js:346` — the qualia-DTU listing kind now exists) | `promoteQualiaSnapshot` has zero production callers today (only referenced from a test) — trade flow still not reachable by a real user | phenomenal-data consent → P-D; then wire a real caller |
| Temperament Eclipse | ~50% | migration 326 + `lib/npc-temperament.js`, `lib/temperament-ladder.js` + `lib/temperament-spread.js` (two sibling files, not a `temperament-ladder/` directory), `emergent/affect-trace-cycle.js` | hot-swap/rollback with provenance chain | deliberate swap must not trip `agent_drift_watch` |
| Somatic Memory Forge | ~45% | `lib/embodied/pain.js` + scars/drift (mig 160) + `domains/cognitive-replay.js` | pain→DTU forge + replay-for-training | `no_force_npc_pain` invariant (pain is player-only) |
| Embodied Legacy Codex | ~45% | `lib/npc-legacy.js` + mig 329 + `emergent/history-engine.js`/`chronicle-weave.js` + skinned humanoids | life-moment reenactment of a real user | `agent_disclosure` — must disclose agenthood |
| Forked Self Marketplace | ~72% (2026-08-23) | Same substrate + `29fcdb196` (Jul 17) — real `fork.instantiate_preview` macro + `ForkPreviewPanel`/`ForkDisclosureBadge` UI, 18/18 tests | rental/pricing still explicitly out of scope (`server/lib/lattice-fork.js:23`) — the marketplace delta itself is unchanged | consent/identity/drift + rental economics → P-D |
| Creation Singularity | ~60% (2026-08-23 — real orchestration DID land) | `d75b3e287` (Jul 18) — new `server/lib/creation-singularity.js` (519 LOC) + `server/domains/creation-singularity.js` (registered `domains/index.js:115`) + migration 370: a full bracket-tournament arena over `fork_objects`, deterministic scoring, 15/15 tests. Backend-complete. | no frontend UI exists (`grep creationSingularity concord-frontend/` empty); reward is DTU-only, no payout economics | payout economics → P-D; UI is unblocked, just unbuilt |
| Invariant Weaver | ~48% (2026-08-23) | Same substrate + `7ff3c0419` (Jul 24) — new `server/lib/verification/model-checker.js` + `invariant-specs.js`: a bounded explicit-state checker built specifically for economy invariants (mint/ledger conservation/royalty cascade), tested | not the doc's originally-envisioned NL-compiler/fuzz-harness, but it does mechanize part of "economy invariants stay human-escalation"; `invariant-guardian.js` itself still has zero resolve/collision logic | economy invariants stay human-escalation |
| Conservation Veil | ~35% | ledger-conservation predicate + `domains/eco.js`/`energy.js`/`physics.js` + `domains/ar.js` | AR conservation-flow overlay | overlaps Substrate Resonance's aspirational layer |
| Cross-Temporal Citation | ~35% | royalty cascade + `lib/time-loop.js` + mig 116 | timeline-fork identity + bidirectional flow | retroactive royalty vs conservation → P-D |
| Mesh Soul Binding | ~35% | `emergent/cnet-federation.js`, `emergent/trust-network.js`, `entity-hive.js`, shards, mig 108 train-consent | soul-group object + JOINT ownership | multi-party consent + economics → P-D |
| Substrate Resonance Engine | ~20% | `lib/foundation-atlas.js`, `lib/concord-mesh.js` ("resonance" in-tree = music/literary only) | nearly everything | defer — research-grade |

### D.2 Grounded 28 (top tier by leverage; full audit in session transcript)

(Recounted 2026-07-03: 11 top-tier rows + 13 mid-tier items + 4 deferred
items = 28, not the "30" this section was previously headed with. D.1 (15)
+ D.2 (28) = the 43-item backlog total cited at the top of this doc.)

| Idea | Built | Key substrate | External dep |
|---|---|---|---|
| Personal sovereign API hub | ~80% | `lib/mcp-server.js` + `lib/mcp-oauth.js` (OAuth 2.1 PKCE) + `lib/consent.js` + `domains/privacy.js` + universal-export | none — needs only a config UI + consent-scope surface |
| Creator royalty & attribution lattice | ~75% | `economy/royalty-cascade.js` + Stripe Connect (**mig 003** `003_economy_stripe.js` — corrected; "mig 215" was wrong, that number doesn't exist for this feature) + creator-dashboard | platform OAuth ingest (incremental) |
| Governed ethical decision simulator | ~75% | `domains/ethics.js` (multi-framework) + council-voices + constitution + forward-sim | none — packaging lens |
| Rugged offline-first field tools | ~75% | concord-mobile mesh (BLE/WiFi-P2P/NFC/SQLite) + `lib/offline-first/*` | hardware only (by design) |
| Burnout & focus recovery | ~70% | `domains/attention.js` (focusScore/pomodoro/attentionBudget) + self.js mood/sleep + real calendar connector | Google OAuth secrets only |
| Adaptive learning twin | ~55% (down from ~70% — two of four cited substrate refs were wrong) | `domains/srs.js` (real SM-2/FSRS spaced repetition: `spacedRepetitionSchedule`, `retentionCurve`) + `lib/metalearning.js` (real k-NN/heuristic strategy selection: `strategySelection`). **Removed:** `cognitive-replay.js` — verified it does SQL/array aggregation over chat-session history (`stats`/`filter`/`heatmap`/`compare`), not "A* path reconstruction"; no pathfinding logic exists in the file. **Removed:** mig 010 — its own header states it is superseded/dead ("Cartographer pass-1 confirmed zero SELECT references. REPLACED_BY: economy/royalty-cascade.js + drift-monitor.js + forgetting-engine.js + dtu-pipeline.js"); citing dead schema as live substrate was wrong. "Dual-path counterfactual" left as-is (not re-verified this pass). | none |
| Personal health ledger | ~58% (2026-08-23) | Same substrate + `healthcare.js` grew 2,459→2,617 LOC (`fd40bae69` real clinical-protocol library, `9b0df69ff` image upload) + a manual `device-ingest` macro at line 2066 (not OAuth). Core finding unchanged — `self.js`/`healthcare.js` are still zero-cross-referenced, still two real domains, not one connected ledger. | wearable OAuth (Apple Health/Fitbit/Oura) |
| Zero-trust persona & fork marketplace | ~35% (2026-08-23) | Same substrate + `29fcdb196` (Jul 17) — wires `lattice-fork.js` into a reachable `fork.instantiate_preview` macro + `ForkPreviewPanel`/`ForkDisclosureBadge` UI, closing exactly the wiring gap this row previously flagged. Still preview-only: `personas.js` still has no `CREATE TABLE` (evaporates on restart), sandbox manifest still default-deny — not yet a marketplace. | none |
| Misinformation provenance shield | ~78% (2026-08-23) | Same substrate + `5d4df2542` (07-03, ~5h after that day's audit) — `sourceCredibility` now cryptographically verifies caller-claimed provenance via DTU tamper-check (`grounding.js:325-352`) + `04694adc2` adds a GDELT auto-discovery connector | near-zero |
| Reproducible research forge | ~75% (2026-08-23) | Same substrate + `e205cd094` (07-03) — `reproducibilityCheck` now opt-in persists as a minted DTU (`research.js:339-392`), closing the doc's own previously-stated "pure compute, never persisted" gap | optional |
| Adaptive basic education | ~78% (2026-08-23) | Same substrate + `9aac6a7a6` (genuine multi-tenant catalog) + `41a6527d6` (submissions/peer-review/lesson-authoring wiring) — real expansion beyond the tutor-ask feature this row was scoped to | none (content authoring) |

**Mid tier (individually re-verified 2026-07-03 — the old blanket "~45–60%"
band was imprecise; several items were false-friend risks or wrongly
estimated):**

| Idea | Built | Verified substrate |
|---|---|---|
| Food systems | ~68% (2026-08-23) | Same substrate — the "no live external data" premise was itself stale: `ce7d71852` (07-03) SSRF-hardened, not newly added, real World Bank crop-yield / Spoonacular / Open Food Facts connectors that already existed at the prior audit's cutoff and were simply missed. |
| Conservation engine | ~65% (2026-08-23) | Same substrate + the `ce7d71852` correction above (real live Open-Meteo/GBIF connectors already existed) + `8d69da557` (Jul 17) new `energy.cheapest-window` TOU advisor. |
| Quote & Clip DB | ~68% (2026-08-23) | Same substrate + migration 356 (`925c5f006`, 07-03) gave `saved.js` real DB persistence (`saved_items`/`saved_folders`), replacing the in-memory-only store this row previously cited as the gap. Still not quote-specific. |
| Insurance claims verifier | ~50% tracking / 0% fraud verification | `domains/insurance.js` (1,883 LOC, ~70 macros: `claim-file`, `fnol-intake`, `claim-update`, `policy-*`) is deep real CRUD/workflow. Zero fraud-detection logic found (grep hits were comment text only). Still needs G3. |
| Delivery verifier | ~45% tracking / 0% verification | `domains/logistics.js` (1,908 LOC, ~60 macros) has `delivery-confirm`/`pods-list` that *captures* signature/photo/GPS — but nothing cryptographically or correlatively verifies the capture (no GPS-vs-address check, no signature match). Still needs G3. |
| Dream-to-action bridge | ~50% (up from the ~35-40% hypothesis) | **False-friend risk confirmed and corrected:** `domains/dreams.js` is explicitly the game/NPC subconscious surface (dream-engine + forward-sim for the world HUD), not personal-aspiration tooling. The real match is `server/lib/goal-decomposition.js` (199 LOC, migration 340 `goal_trees`/`goal_nodes` — a genuine DB-backed persistent subgoal tree with roll-up completion), wired via `server/domains/decomp.js` (`decomp.create/decompose/advance/tree/next/list`) and tested (`server/tests/goal-decomposition.test.js`). Real and tested, but built for the R&D engine, not framed as personal-aspiration UI, and has no dedicated frontend lens. |
| Memory/legacy weaver | ~20% | **False-friend risk confirmed:** `domains/legacy.js` is codebase-migration tooling (technical-debt/maintainability index), unrelated to personal memory; `lib/npc-legacy.js` is game NPC death/inheritance mechanics, also unrelated. The genuine near-match is `domains/timeline.js`'s "On this day" feature (surfaces past same-day-different-year posts) — real but thin, not a curation/weaving feature. |
| Contact & preference network | ~10% | No purpose-built substrate found (`grep -rli "contact.*network\|preference.*network" server/domains server/lib` returns nothing beyond a seed-data backup) — only generic social mute/block/DM exists. |
| Public finance tracker | **naming-ambiguous, still flagged** — ~60%+ if "personal finance" was meant / **~35-40% (2026-08-23, corrected — the government reading is NOT zero)** if "government/public transparency" was meant | `domains/finance.js` is the rich personal-finance OS described previously. BUT the "zero government/public-transparency finance code" claim was wrong — the 07-03 audit only looked in `finance.js`: `domains/government.js:282-351`'s `budget-breakdown` macro pulls real USAspending.gov federal budget-by-category data, plus `foia-list/create`, `open-data-search/ingest`, `fines/payments` (this substrate predates 07-03; the prior audit just never checked outside `finance.js`). |
| Post-scarcity marketplace | ~0% | `grep -rli "post.scarcity" server/ content/` hits only lore/seed DTUs (`server/dtus.js`, `server/data/seed/dtus-part8.json`) — zero functional marketplace code. |
| Superorganism coordinator | ~0% (down from the ~5-10% hypothesis) | `grep -rli "superorganism\|hive.mind" server/` returns zero source-file hits (backup/seed data only) — not even tangential NPC hive-mind signaling exists, contradicting the original hypothesis. |
| Invariant collision resolver | ~45-55% (2026-08-23 — the 07-03 audit missed the real substrate) | `server/domains/invariant.js` (1,218 LOC, since `d54fd0306` 2026-04-07 — predates 07-03, was simply never found) implements a real AC-3 arc-consistency constraint-satisfaction solver (`constraintSatisfaction`, lines 421-510) plus `consistencyProof`/`counterexample`/`temporalCheck`/`quantifiedCheck`. `invariant-guardian.js` (the file previously cited) is still detection-only, but it was never the right file to check. |
| Mental-health continuity twin | ~50-55% (2026-08-23 — dedicated audit performed) | `server/domains/mentalhealth.js` (978 LOC, 49 macros): persistent per-user mood/sleep/factor state, real `factor-correlations` (delta-vs-baseline), `mood-insights` trend detection, `therapist-report` (CSV export), `safety-plan-save`. No predictive "twin" simulation exists — this audit substantiates the prior band rather than moving it materially. |

**New-engine tier — 2 of 4 items were wrongly labeled "no substrate" (corrected 2026-07-03):**

| Idea | Built | Verified substrate |
|---|---|---|
| Drug-discovery counterfactual sim (docking/ADMET) | ~0%, correctly deferred | `grep -rli "docking\|ADMET" server/` returns zero matches. No substrate exists. |
| Chemical exposure-accumulation model | ~0%, correctly deferred | Same grep sweep — no substrate found. |
| Disaster hazard models | ~30-35% (2026-08-23) | `geology.js`'s `seismicRisk` and `forestry.js`'s `fireRisk` stand as before + `emergency-services.js` grew substantially: `ebd612a1d` (Jul 17) added real cross-org mutual-aid incident sharing + agency consent atop 13 CAD macros (dispatch, triage-queue, readiness-rollup, active-alerts). Real response infra grew; multi-hazard *prediction* packaging is still unassembled. |
| Labor/career time-series forecasting | ~70-75% (2026-08-23 — essentially closed) | `b825d7761` (Jul 18) shipped `hr.laborForecast` (`server/domains/hr.js:251`), wiring the real BLS connector to the real `temporal.forecast` Holt-Winters engine — the exact "unassembled" gap this row previously flagged — plus a real UI (`BlsWageForecast.tsx`, 251 LOC) and a passing behavioral test (`hr-labor-forecast.test.js`, 4/4, asserts deep-equal against the engine's own output). |

### D.3 Remaining shared primitives (later waves)

G2 wearable/device OAuth adapters (health ledger, insurance, conservation,
burnout) · G3 vision→physical-claim extractor — video → claims →
physics-oracle check (insurance, delivery, A/V verification) · G4 time-series
forecasting (career/labor/disaster) · G5 twin/continuity object — per-user
aggregate joining ledgers+memory+counterfactuals (health, mental-health,
learning, burnout, legacy) · ~~G6 keyless open-data→DTU wire~~ · G7 DTU↔physical
redemption/fulfillment bridge (delivery, post-scarcity marketplace).

**G6 correction (2026-07-03): effectively built this arc, not a future
primitive.** P-A's `server/lib/public-fetch.js` (`fetchPublicUrl`, commit
`223e8eee`) IS the keyless, SSRF-guarded fetch helper G6 called for, and
`server/domains/government.js`'s `open-data-ingest` macro (same commit) is a
real concrete consumer (fetches `catalog.data.gov`'s CKAN API and
provenance-stamps the result via `lib/provenance-ingest.js`). The primitive
still needs per-domain consumers wired for labor/conservation/disaster (only
the `government.js` consumer exists today), but the wire itself — the hard
part — is proven, not speculative.

Note: the marquee connectors (Gmail/Calendar live; Slack/Sheets/GitHub/Notion
code-complete) mean "external dependency" for most grounded ideas is
**OAuth-secret provisioning, not integration code** — see
`docs/CONNECTORS_GO_LIVE.md`.

---

## E. Verification (per unit + arc)

- **Per unit:** vitest for every frontend binding; node--test for every stage
  emission / new macro; the ConKay honesty grep; run the affected flow
  (compute-don't-guess via `lensRun` for expected values).
- **Arc gates (all blocking):** server suite 0 fail · frontend vitest green ·
  `node scripts/check-doc-claims-all.mjs --ci` ·
  `node scripts/verify-invariant-test-links.mjs --ci` ·
  `node scripts/generate-wiring-doc.mjs --check` ·
  `cd server && node scripts/run-detectors.js --diff --ci` (no new
  high/critical) · guard.mjs untouched.
- **ConKay acceptance test:** summon → cockpit renders panels fed only by real
  events; kill the server mid-run → panels show honest failure states and all
  motion stops. If anything keeps moving with the server dead, it's fake —
  find it and remove it.

## F. Honest stop-points (pre-agreed)

- **K1:** no natural stage boundaries → start/complete-only, noted.
- **K5:** no real renderer for an artifact kind → "inspectable soon," never a
  fake placeholder.
- **P-B/P-C:** anything touching royalty math, joint ownership, or rental
  payments STOPS at P-D owner review. Marketplace fee constants are
  constitutional.
- **Backlog pulls:** NOVELTY_INVENTORY check first, always; stale %s in this
  doc get corrected in the same commit (docs are build artifacts).
