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
