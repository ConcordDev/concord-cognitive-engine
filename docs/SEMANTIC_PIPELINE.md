# Semantic Pipeline — the "verified sandwich" agent

**Added 2026-06-26.** A grounded implementation of the pattern the user described as a "Deterministic
Physics-Engine Agent / Semantic Sandwich": an LLM parses natural language into a structured tool call, a
**deterministic** macro DAG executes it (no LLM in the middle), then an LLM formats the raw result —
**verified, not trusted.**

## What this pattern actually is (industry names)
It is **LLM function/tool calling + deterministic tools + constrained decoding** — also called
*neuro-symbolic* orchestration or a *DSPy/LLM-compiler pipeline*. It is sound and standard (OpenAI/
Anthropic tool-use APIs, the DSPy paper, LLM-compiler work), **not novel**. The value is real: keep the
LLM at the edges (parse, speak) and make the middle deterministic and verifiable.

```
  NL ──▶ [PARSE GATE: LLM → {domain,name,input}] ──▶ [ROUTER: intent → macro_dag plan]
                                                              │
                                                              ▼
                              [macro_dag.run — DETERMINISTIC, CPU, contract-verified]
                                                              │
                                                              ▼
                     [FORMAT GATE: LLM prose, CONSTRAINED + VERIFIED] ──▶ answer + verdict
```

## What was already here (≈80%)
- **Deterministic middle:** `server/lib/macro-dag.js` (`macro_dag.{validate,describe,run}`) — declarative
  JSON DAG, topological sort + cycle detection, output→input threading via `${steps.X.result.field}`,
  deterministic `runMacro` per step. Plus `pipeline-executor.js` and the pure-CPU `lib/compute/*` (CAS,
  FEA, quantum, chemistry, formal logic) + `domains/math.js`.
- **Input gate (dated):** `chat-agent.js` marker-based `[TOOL_CALL:{...}]` parsing.
- **Output verifier:** `reason-verify.js` (`reason.verify`) — a deterministic citation floor (catches
  fabricated DTU ids with NO LLM) + council judge + a Z3 SMT formal-proof gate (`proof-gate.js`).

## What this initiative added (the assembly + hardening)
- `server/lib/sandwich/parse-gate.js` — NL → `{domain,name,input}` via **Ollama structured output**
  (the `format` JSON-schema param, now forwarded by `ollama-client.js`) using the invariant-engine
  contracts (`content/contracts/derived/*`) as the per-tool schemas; args validated with
  `macro-param-schema.js`; retry-once-then-honest-fail (no guessing).
- `server/lib/sandwich/router.js` — intent → a real `macro_dag` plan; **rules-first** (explicit
  `no_route`, never a silent mis-pick), optional LLM-router fallback.
- `server/lib/sandwich/format-gate.js` + `TASK_PROMPTS.constrainedSynthesizer` — low-temp prose
  constrained to the data, then **verified**: `reason.verify` on cited claims + a programmatic guard that
  every number/entity in the prose appears in the result data; on a violation it drops to a deterministic
  **template** formatter and marks `verified:false`. Purely-structured results use the template path.
- `server/domains/sandwich.js` (`sandwich.run`) — assembles parse → route → `macro_dag.run` → verify →
  format; returns the deterministic result + prose + verdict + plan.
- Tests: `macro-dag.test.js` (the missing coverage) + `sandwich-pipeline.test.js` (same input → same
  deterministic middle; the numeric guard catches an invented number; honest failure paths).

## The two claims I did NOT implement (category errors — honest)
- ❌ **"Runs on Blackwell tensor/CUDA cores."** The deterministic middle is **CPU** (`macro-pool.js` =
  `node:worker_threads`); only LLM inference uses the GPU. The pipeline is fast because it's compiled JS
  + SQLite, not because of tensor cores.
- ❌ **"The facts are locked, so the output LLM can't hallucinate."** Grounded formatters still
  hallucinate 0.2–20% (CaLM/KCTS/CiteCheck, 2024–26). That is exactly why the format gate **verifies**
  the prose against the data and falls back to a template — it does not trust the LLM. "Verified, not
  hallucination-proof."

## Honest limits
- A **fixed DAG path only covers known intents.** Novel/ambiguous requests need the router's LLM fallback
  or dynamic planning — which reintroduces LLM nondeterminism for *path selection*. The determinism
  guarantee is on the *execution* (the middle), not on *which* path a vague request picks.
- The determinism + contract guarantee on the middle comes from the **Orchestrated Invariant Engine**
  (`docs/INVARIANT_ENGINE.md`) — the same contracts are the parse gate's tool schemas. That synergy is
  the real engineering win here.

## Sources
LLM function calling (OpenAI/Anthropic docs), DSPy (arXiv 2310.03714), constrained decoding / GBNF,
CaLM (arXiv 2406.05365), KCTS (arXiv 2310.09044), CiteCheck (arXiv 2605.27700). Full list in the
research notes captured this session.
