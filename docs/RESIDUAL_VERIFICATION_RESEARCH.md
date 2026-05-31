# Closing the Residual-Risk Tiers — what we'd need (research)

## 0. The premise

The three risk tiers a no-network sandbox can't reach — **browser runtime, multiplayer-at-scale, and
LLM/mobile/dynamic-SQL** — are **solved problems with mature, off-the-shelf kits.** Plenty of sites and
multiplayer games shipped through exactly these. Concordia doesn't need novel methods; it needs to adopt
the standard tools and point them at its **enumerable surface** (257 lenses, ~273 socket events, the 28
TASK_PROMPTS, the mobile flows) — the same auto-derive principle as the Function Assurance method. These
are layers **L4 (browser)** and **L5 (synthetic/scale)** of that method, with the tooling spelled out.

---

## Tier 1 — Browser runtime (does the frontend actually render & behave?)

**Established kit:** **Playwright** E2E + smoke, sharded across CI workers.

**What we'd need:**
- A **smoke spec auto-derived from `app/lenses/*`** (all 257 dirs): for each lens, `page.goto`, then
  assert **no `console.error`, no `pageerror`, no failed `requestfailed`, and primary content renders**
  (not a white-screen / error boundary). This is the documented way to catch the hydration sites
  (`Date.now()`/`new Date()` rendered raw) and the dead-backend lenses.
- **Sharding** (`--shard`, `fullyParallel: true`): a few-hundred-page suite that's 20 min on one runner
  becomes ~5 min across 4 shards. Worker parallelism alone is 5–10×.
- **Smoke on branches, full suite on main**; **trace viewer** for failures (not video).
- Optional **visual-regression** (must pin OS + browser version).
- **Where:** RunPod (has network → `npx playwright install --with-deps chromium`), behind a **named,
  SSE-capable Cloudflare tunnel** (quick tunnels break chat streaming). `--no-sandbox
  --disable-dev-shm-usage`, `--shm-size=1gb`.

**Effort:** ~1 day to stand up the auto-derived lens-sweep; it's the single highest-value frontend gate.

---

## Tier 2 — Multiplayer at scale (does it hold under many concurrent players?)

**Established kit:** **Artillery** (native **Socket.IO** support — and Concordia *is* socket.io, so it's
the natural fit; k6 does raw WS, Gatling does WS/SSE). Soak tests for memory leaks.

**What we'd need:**
- **Artillery socket.io scenarios** that simulate a realistic player: connect → enter world → move
  (presence updates) → combat events → chat → disconnect/reconnect. Ramp concurrency to find the ceiling.
- **Measure:** connection-establishment time, message round-trip latency, messages/sec throughput,
  concurrent-connection ceiling, **reconnection behavior**, and **server resource curves** (the
  round-1 event-loop-lag-spike + heartbeat-overrun counters are exactly what to watch).
- **Soak test** (hours at steady load) to catch slow leaks / heartbeat drift — Concordia already exposes
  `concord_heartbeat_ticks_total` / `_skipped_total` + the Grafana stack to graph it.
- **Scale path:** a single tuned node handles ~10k–100k concurrent connections; beyond that is **Redis
  pub/sub horizontal scaling** — which Concordia **already has** (redis in docker-compose) and the
  **world-shard protocol (Phase F)** is built for. Load testing *validates the shard boundaries* +
  the `PER_WORLD_WRITE_TABLES` write-ownership rules under real contention.
- **Proof point:** Heroic Labs load-tested Nakama (a comparable game backend) to **2M concurrent players
  with Artillery + AWS** — the architecture class scales; the question is only Concordia's per-node tuning
  + shard count.

**Effort:** ~2–3 days for the Artillery scenarios + a first ceiling/soak run on RunPod (or a cloud box).

---

## Tier 3a — LLM behavior (do the brains do the right thing, safely?)

**Established kit:** the **LLM testing pyramid** — deterministic unit checks → **regression eval on a
frozen golden set** → **red-team/canary**. Tools: **Promptfoo** (now OpenAI-owned), **Langfuse**,
**Confident AI / deepeval**, **Giskard** (automates the full OWASP LLM Top 10).

**What we'd need:**
- **Deterministic base (free, no LLM):** Concordia *already* has much of this — the secret-omission
  canary, the deterministic dialogue/quest/evolution composers, the citation-validity checks. Keep them
  as the floor.
- **Golden-set regression eval:** freeze a set of (prompt, expected-property) cases for the 28
  `TASK_PROMPTS` + NPC dialogue + chat; run it **on every PR that touches `prompt-registry.js`, a model
  pin, or retrieval**. Score with a rubric (faithfulness, on-persona, no-secret-leak, task-completion).
  Block merges that regress. Eval against the **self-hosted Ollama brains** (no external API needed).
- **Red-team for prompt injection (#P1, OWASP LLM01 — the #1 risk):** Giskard / a 500–2,000-pattern suite
  (DAN, role-play bypass, encoded instructions) against the NPC-dialogue + chat paths. This is the
  *automated* version of the #P1 finding — and it gates the §2b LLM-feature enablement.
- **Prod observability:** sample **5–10% of live traffic**, auto-score for drift/hallucination/safety.
  Langfuse/Confident AI plug into the existing Prometheus/Grafana.

**Effort:** ~2–3 days for the golden-set + Promptfoo wiring; red-team suite is incremental.

---

## Tier 3b — Mobile (`concord-mobile`, React Native + Expo)

**Established kit:** **Maestro** — the clear fit for Concordia because it's **black-box, YAML, zero-config,
<1% flaky, and integrates with EAS Workflows** (Concordia is Expo). Detox is grayer-box/faster-per-flow
but needs native build config; reserve it only if you need internal-state assertions.

**What we'd need:**
- **Maestro smoke flows** for the critical paths: login/signup, the marketplace, beats, the macro-client
  wrappers (the mobile parity layer), wallet. YAML flows, runnable on **EAS Workflows** against real
  device/emulator.
- Pyramid: keep **Jest** for unit/component (70/20), **Maestro** for the 10% E2E.

**Effort:** ~1–2 days for the smoke flows; CI ~8–12 min on Maestro.

---

## Tier 3c — Dynamic SQL (the 167 `${}` queries static analysis can't read)

**Established kit:** **runtime query validation** + **API fuzzing** (Schemathesis-style).

**What we'd need:**
- **Runtime statement logging:** during the L2 route-smoke + L4 browser sweep, log every executed
  `db.prepare`/`db.exec` (incl. the interpolated ones) and validate each against the live schema — the
  dynamic queries get *exercised*, so the ones that drift surface as real `no such column` at test time.
- **API fuzzing:** throw varied/boundary inputs at the endpoints that build dynamic SQL, assert no 500 /
  no SQL error (this also re-catches the #P1-class injection surfaces and the round-2/3 write-crashes).
- Folds directly into Function-Assurance **L0 (extended to runtime-logged statements)** + **L2**.

**Effort:** ~1 day (it's mostly wiring a query-logger into the existing smoke harness).

---

## 1. The shopping list (what "we'd need", concretely)

| Tier | Tool (standard) | Infra | Effort | Function-Assurance layer |
|---|---|---|---|---|
| Browser runtime | **Playwright** (sharded) | RunPod + named CF tunnel | ~1d | L4 |
| Scale / multiplayer | **Artillery** (socket.io) + soak | RunPod / cloud box; Redis already present | ~2–3d | L5 |
| LLM behavior | **Promptfoo** + **Giskard** + golden set | self-hosted Ollama (have it) | ~2–3d | L5 + L2 |
| Mobile | **Maestro** on EAS Workflows | Expo EAS | ~1–2d | (mobile L4) |
| Dynamic SQL | runtime query-log + **Schemathesis** fuzz | none extra | ~1d | L0/L2 |

**Total: ~1.5–2 weeks of standard-tool adoption** — no novel research, all mature kits. Concordia already
has the hard parts (the enumerable surface to auto-derive from, Redis for scale, Ollama for evals, Expo
for mobile, Prometheus/Grafana for observability).

## 2. The principle that makes it cheap

Same as Function Assurance: **adopt the standard tool, then auto-derive its cases from Concordia's live
surface** — the Playwright sweep reads `app/lenses/*`, the Artillery scenario replays real socket events,
the LLM golden set freezes the `TASK_PROMPTS`, the mobile flows mirror the macro-client. You're not
hand-authoring thousands of cases; you're pointing proven tools at an enumerable system. That's how the
residual tiers close without a QA army.

## 3. Verdict

The three things the sandbox couldn't verify are not unknowns — they're **a two-week adoption of
Playwright + Artillery + Promptfoo/Giskard + Maestro**, each plugging into infrastructure Concordia
already runs. Do that, and the "residual risk" I flagged stops being residual: it becomes the **L4/L5
gates** that prove the live, at-scale, multi-client, AI-driven behavior the same way L0–L3 prove the
backend. Then "does the whole thing work, for real, under load, on every device, with the brains on?" is
answered by green CI + green dashboards — not hope.

**Sources:** [Socket.IO load testing](https://socket.io/docs/v4/load-testing/) ·
[WebSocket perf testing](https://yrkan.com/blog/websocket-performance-testing/) ·
[load tool comparison (k6/Gatling/Artillery)](https://www.vervali.com/blog/best-load-testing-tools-in-2026-definitive-guide-to-jmeter-gatling-k6-loadrunner-locust-blazemeter-neoload-artillery-and-more/) ·
[LLM app testing 2026](https://www.vervali.com/blog/ai-and-llm-application-testing-in-2026-the-definitive-guide/) ·
[LLM eval guide](https://galtea.ai/blog/llm-evaluation-complete-guide) ·
[LLM observability tools](https://www.confident-ai.com/knowledge-base/compare/top-7-llm-observability-tools) ·
[Playwright sharding](https://playwright.dev/docs/test-sharding) ·
[Playwright best practices](https://playwright.dev/docs/best-practices) ·
[Detox vs Maestro](https://maestro.dev/insights/detox-vs-maestro-reducing-flakiness-react-native) ·
[Maestro on EAS Workflows](https://docs.expo.dev/eas/workflows/examples/e2e-tests/)
