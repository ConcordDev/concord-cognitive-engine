# A40 GPU Local Brain Routing
# When you set up your NVIDIA A40 (48GB VRAM), point these env vars to it.
# All 5 brains (conscious, subconscious, utility, repair, vision) can route to 
# one A40 instance OR 5 separate instances for max parallelism.

# SINGLE INSTANCE (recommended to start):
# Set OLLAMA_URL=http://<A40-host>:11434
# Then brain-config.js routes all brains there automatically (Phase D fix).

# MULTI-INSTANCE (after proof of concept):
# Each brain on a separate A40 — round-robin picker spreads load.
# Set comma-separated URLS for each brain:
# BRAIN_CONSCIOUS_URLS=http://a40-1:11434,http://a40-2:11434
# BRAIN_SUBCONSCIOUS_URLS=http://a40-3:11434
# BRAIN_UTILITY_URLS=http://a40-4:11434
# BRAIN_REPAIR_URLS=http://a40-5:11434
# BRAIN_VISION_URLS=http://a40-6:11434

# Model weights to install on A40 (suggested):
# - llama3.1:70b        (conscious, high-reasoning)
# - mistral:7b          (subconscious, fast pattern matching)
# - codellama:13b       (utility, code-aware)
# - deepseek-coder:33b  (repair, code fixing)
# - llava:13b           (vision, multi-modal)

# Free-tier / fallback before A40:
# BRAIN_CONSCIOUS_URL=http://<free-tier-llm>:443
# BRAIN_SUBCONSCIOUS_URL=http://<free-tier-llm>:443
# etc.

---

## Role → model map (GB-1541, founder-confirmed 2026-11-14)

The platform's brain roles route to Ollama Cloud models, set by env at
deploy (BRAIN_CONSCIOUS_MODEL / CONKAY_MODEL / BRAIN_REPAIR_MODEL /
BRAIN_BACKGROUND_MODEL and the subconscious equivalent in brain-config.js):

| Role          | Model                  | Notes                                   |
|---------------|------------------------|-----------------------------------------|
| conscious     | kimi-k3.1-pro:cloud    | main chat / reasoning                   |
| ConKay        | kimi-k3.1-pro:cloud    | dedicated `conkay` slot (BR-02)         |
| subconscious  | minimax-m3:cloud       | background cognition                    |
| background    | gpt-oss:20b-cloud      | high-frequency small jobs (GB-1540)     |
| repair        | gpt-oss:120b-cloud     | repair proposer (BR-01, flag-gated)     |

Emergent-layer jobs (dream cycle, detectors' narrative passes) ride the
**background** brain — they are high-frequency, small, and must never
contend with the user-facing conscious/ConKay slots. Anything emergent
that needs deep reasoning escalates through the repair/conscious routes
explicitly rather than borrowing a bigger slot by default.

---

## Superseded note — the repair brain proposes, it does not apply (IMM-01, 2026-11-17)

The role → model map above stands, including the repair role
(gpt-oss:120b-cloud, BR-01). What is superseded is any reading — in this
doc's earlier form or anywhere else — of the repair brain as a component
that applies fixes, hot-patches source, or writes on its own authority.
Under `docs/IMMUNE_SYSTEM.md` the repair brain is a proposer: its output
is a structured proposal in the remediation queue, and a proposal becomes
a change only through the human-gated pipeline. The flag-gated apply path
shipped with BR-01 is being retired under IMM-02 of the v1 work order;
CONCORD_REPAIR_HOTPATCH stays unset. Nothing in this note changes model
routing.
