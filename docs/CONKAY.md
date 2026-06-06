# ConKay — Concord's JARVIS, as a voice-native Chat mode

> *"It's not just fiction anymore."* — almost every J.A.R.V.I.S./F.R.I.D.A.Y.
> capability now maps to buildable-now technology, and **Concord already ships the
> substrate.** ConKay ("Kay") is the shipped identity; JARVIS/FRIDAY are the research
> model. ConKay is **not a separate lens** — it is a **mode inside Concord Chat**:
> switch into it and the chat surface becomes a holographic, voice-native majordomo
> over your own knowledge.

---

## 1. Research — the canon capability catalogue (J.A.R.V.I.S. / F.R.I.D.A.Y.)

What the fictional AIs actually do, organized by domain (Iron Man 1–3, Avengers,
Age of Ultron, Civil War, Homecoming, Infinity War, Endgame):

| Domain | Canon capability | Real-world 2025 analogue |
|---|---|---|
| **Conversation / proactive briefing** | Natural dialogue, dry wit, anticipates needs; status-on-wake, threat call-outs | LLM chat + scheduled context briefs (BUILDABLE) |
| **Information retrieval & synthesis** | Instant lookup + cross-source synthesis (S.H.I.E.L.D. DB decryption IM2; parsing decades of Stark archives) | RAG over a private corpus + web search (BUILDABLE) |
| **Real-time perception** | Vision, audio, sensor fusion, threat detection, suit-HUD target tracking | Multimodal vision models on uploaded media (BUILDABLE for media; live sensor fusion PARTIAL) |
| **System & device control** | The armor, the workshop, vehicles, **drone fleets** — the **Iron Legion** + **House Party Protocol** (autonomously summons + pilots dozens of suits) | Tool-use/function-calling agents over software APIs (BUILDABLE for software; physical suit STILL SCI-FI) |
| **Autonomous agency** | Acts on its own initiative, runs operations, persists/relocates itself (survives Ultron → becomes **Vision**) | Long-running agent loops / background tasks (BUILDABLE) |
| **R&D / engineering** | Holographic modeling, physics sim; **IM2 new-element discovery** (models a structure → Stark synthesizes it) | Simulation + generative design (PARTIAL/narrow) |
| **Security / defense** | Intrusion detection, countermeasures, building lockdown | Anomaly/telemetry monitoring (BUILDABLE) |
| **Personality / relationship** | Persistent memory, loyalty, humor, emotional read | Persona prompts + long-term memory (BUILDABLE) |

### JARVIS vs FRIDAY — the persona axis
| | J.A.R.V.I.S. | F.R.I.D.A.Y. |
|---|---|---|
| Voice | male, British, dry wit | female, Irish, terse |
| Stance | warm advisory confidant | tactical, ops-first |
| Autonomy | high — runs the workshop + the Legion | high — faster targeting, fewer scruples |
| Failure mode | gentle pushback | just does it |

Adjacent personas worth noting: **KAREN** (Spider-Man's suit AI — an
onboarding/coaching "training-wheels" persona) and **EDITH** (a high-capability /
high-risk *admin tool* with global weapons/satellite access — the cautionary
high-privilege agent that informs how an assistant like this must be *gated*).

**ConKay's chosen identity:** JARVIS's *manner* (anticipatory, competent, warm, a
light dry wit, grounded-honest) with a **female, chill TTS voice** — a calm
presence rather than FRIDAY's terseness. One persona, not a toggle.

---

## 2. Feasibility — "not just fiction anymore" (2025), and why Concord is the right host

| Capability | Status | Concord substrate that already exists |
|---|---|---|
| Agentic multi-tool action | **BUILDABLE** | `runMacro` over **9,609 macros** (the tool surface) |
| Persistent memory / RAG | **BUILDABLE** | the **DTU substrate** + citation system |
| Proactive briefings | **BUILDABLE** | `TASK_PROMPTS.morningBrief` in `prompt-registry.js` |
| Real-time voice (STT/TTS) | **BUILDABLE** | Web Speech API (no key) |
| Multimodal perception (uploaded media) | **BUILDABLE** | the **vision brain** (LLaVA/Qwen-VL) |
| Autonomous background tasks | **BUILDABLE** | **agent-marathon** loops |
| Security/anomaly monitoring | **BUILDABLE** | admin telemetry surfaces |
| Distinct persona | **BUILDABLE** | `prompt-registry.js` + the chat `systemPrompt` field |
| Computer-use / desktop automation | **PARTIAL** | (~72% on OSWorld-class benchmarks) |
| Control a physical suit / general robotics | **STILL SCI-FI** | — |

The honest punchline: ConKay is **mostly integration**, not new AI infrastructure.
The four-brain pipeline already routes, grounds in DTUs, web-augments, and returns
structured fields. ConKay forks the *presentation*, not the brain.

---

## 3. Design — ConKay as a Chat mode (dual-mode rendering over one conversational core)

**Don't fork the brain, fork the presentation.** ConKay is an entry in the chat
lens's existing `AI_MODES` (next to `research`, reachable via `/mode conkay`). When
active it (a) sends its **persona prompt** + the citation-oriented `research`
backend path, (b) **swaps the chat presentation** to the holographic dual-mode
surface, (c) **auto-enables voice**.

### Three render modes, keyed on REAL backend signals (not a faked marker)
The chat reply already returns `computed`, `dtuRefs`, `refs`, `sources`,
`toolCalls`, `webAugmented`. ConKay maps them:

| Render mode | Triggers on | Renders as |
|---|---|---|
| **Conversation** | prose | clean spoken-friendly text + ambient drift |
| **Visualization** | a `computed` payload, or an LLM-emitted ` ```conkay-viz ` block | `ChartKit` (series/bars), metric tiles, a node/edge graph |
| **Archive + research grounding** | `dtuRefs`/`refs` (your DTUs) + `sources` (web) | DTU citation chips + source chips — *"pulling from archives plus research"* |
| **Ambient action** | `toolCalls` | action chips showing what was touched |

> *The animation is easy; the semantic mapping is the work.* The mapping lives in
> `components/conkay/ConKayViz.tsx` (`structured-output-shape → visualization`),
> reusing `ChartKit` — not a parallel chart stack.

### The state machine (every state has a real backing signal)
`idle` (slow drift) → `listening` (mic live, particles orient inward) →
`processing` (the brain is working — swirl) → `presenting` (TTS speaking) →
`acting` (a tool fired). Driven by `sendMutation.isPending` + the voice hook's
`listening`/`speaking` — never a lying screensaver.

### Voice — native to the mode
On entering ConKay, **STT** auto-listens and **TTS** speaks replies in a **calm
female voice** (Web Speech API; voice picked by `CONKAY_VOICE_HINTS`). TTS pauses
STT so ConKay never hears itself. Typing remains a fallback; a mute control + a
`prefers-reduced-motion` static surface keep it accessible.

### Persona
`components/conkay/conkay-persona.ts` — JARVIS manner, female-chill voice,
grounded-honest (no overclaiming, no fabricated data/sources), instructed to
ground in the DTU archive + research and to emit a ` ```conkay-viz ` block when a
response is genuinely data-bearing.

---

## 4. Build status

**P0 — shipped (this pass):**
- `conkay` mode in the chat `AI_MODES` + `/mode conkay`.
- Persona via the existing `systemPrompt` request field (zero backend/monolith change).
- Dual-mode renderer (`ConKayViz.tsx`) keyed on the real reply fields + ` ```conkay-viz ` block.
- Voice-native STT/TTS (`useConKayVoice.ts`), female-chill, feedback-loop aware.
- Holographic presence band + state-machine HUD (`ConKaySurface.tsx`, canvas particle field, reduced-motion aware).

**P1 — shipped:** full-bleed **Three.js** field via `@react-three/fiber`
(`ConKayScene.tsx`) — a 1500-point additive-blended sphere + wireframe core,
reacting to the state machine and to **live mic amplitude** (`useMicAmplitude.ts`)
while listening. `ConKayBackdrop.tsx` picks the 3D scene when WebGL + motion are
available, else the 2D field; loaded `ssr:false`. Verified live (WebGL canvas mounts).

**P2 — shipped:** **ambient-action flares** — a reply that touched a system (real
`toolCalls`) drives a short-lived `acting` state (the field flares + HUD "Working…").
**Brain made visible** — the reply's `brain`/`source` is surfaced as a small
"via {brain}" label *only when the backend reports it* (never fabricated).
**Proactive greeting** — on entering the mode ConKay speaks a brief greeting and
invites "brief me" (which flows through the normal pipeline → a DTU-grounded brief).

**Vision (perception) — shipped wiring:** an image attached in ConKay mode is a
"look at this" — `handleSend` POSTs the raw image to the existing
`POST /api/vision/analyze` (→ `analyzeImage` → the multimodal/vision brain) and
renders the description (labelled "via vision brain"). Fully isolated (only fires
for ConKay + an image; every other send path is unchanged) with an honest offline
fallback ("the vision brain isn't reachable…") when no vision model is connected.
*Real image understanding requires a connected vision model (LLaVA/Qwen-VL); the
end-to-end inference was not live-verifiable in the dev sandbox (no vision model +
backend boot instability), but the route exists and the wiring is type-checked.*

**Later:** WebGPU compute particles; richer realtime-bus subscription for
per-system flares; in-message image thumbnails for the vision turn.

### Files
- `concord-frontend/components/conkay/conkay-persona.ts` — persona prompt, voice hints, state type.
- `concord-frontend/components/conkay/ConKayViz.tsx` — the dual-mode renderer (the semantic mapping).
- `concord-frontend/components/conkay/useConKayVoice.ts` — STT + TTS (female chill).
- `concord-frontend/components/conkay/ConKaySurface.tsx` — holographic band + state HUD.
- `concord-frontend/app/lenses/chat/page.tsx` — mode entry + wiring (≈6 small, reversible hooks).

### Reused substrate (no new infra)
chat lens + its mode system + `/api/chat` stream + `runMacro` + `realtimeEmit` +
`prompt-registry.js` + 5-brain (incl. vision) + DTU RAG/citation + `ChartKit` +
Concordia Three.js/WebGPU + `LensShell` (a11y/reduced-motion) + Web Speech API.
