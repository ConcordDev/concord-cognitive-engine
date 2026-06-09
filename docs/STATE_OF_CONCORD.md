# State of Concord — verified snapshot (2026-06-09)

> Every number here is reproduced from a command, not memory. Re-run the command
> in the caption to verify. This doc supersedes the stale counts scattered in
> CLAUDE.md and AUDIT_INVENTORY.md (a 2026-06-09 sweep found 10 of 13 CLAUDE.md
> count-claims had drifted — all **undercounting**; the real numbers are below).

## 1. Scale (reproduce: `npm run count-loc`)

| Metric | Verified | Prior doc |
|---|---|---|
| Authored **source** LOC | **2,160,246** (7,374 files) | ~2.05M (stale low) |
| Authored **content** LOC | **851,292** (978 files) | — |
| **Total** | **3,011,538** | ~2.91M (stale low) |

Top languages: js 1.13M · tsx 860k · ts 148k · mjs 13k. The counter honestly
reclassifies 8 data-modules (168k lines, e.g. the deprecated 145k-line
`server/dtus.js` seed pack at 0% code density) OUT of the source total.

## 2. Surface (reproduce commands in each row)

| Surface | Verified | Reproduce |
|---|---|---|
| Frontend lens directories | **260** | `ls -d concord-frontend/app/lenses/*/ \| wc -l` |
| Lens wiring | **257 WIRED · 0 broken · 2 by-design** | `node scripts/verify-lens-backends.mjs` |
| Macro domains | **492** | verifier `macroDomains` |
| Route prefixes | **2,973** | verifier `routePrefixes` |
| Backend domain files | **366** | `ls server/domains/*.js \| wc -l` |
| Numbered migrations | **333** | `ls server/migrations/[0-9]*.js \| wc -l` |
| Route files | **132** | `ls server/routes/*.js \| wc -l` |
| Lib modules | **580 top · 875 recursive** | `ls server/lib/*.js` / `find server/lib -name '*.js'` |
| `server/server.js` | **76,376 lines** | `wc -l server/server.js` |
| DB tables (cartographer) | **690** | `npm run cartograph:static` |
| Socket events | **277** | cartographer |
| Heartbeats (registered) | **105 static** | cartographer / detector summary |
| Macros (graded) | **8,825 pairs** | `npm run grade-macros` |

## 3. Macro depth — read BOTH numbers (reproduce: `npm run grade-macros[:honest]`)

| Mode | Score | Distribution |
|---|---|---|
| **Default (generous)** | **1.000** | stub 0 · functional 4 · utility 4,878 (55%) · production 3,943 (45%) |
| **Honest floor** | **0.687** | stub 443 (5%) · functional 1,477 (17%) · utility 3,591 (41%) · production 3,314 (38%) |

**These measure TEST-coverage depth, not feature depth.** The honest 0.687 is a
*behavioral-test-coverage* score that taxes correctly-small `utility` code at 0.6
**by design** — it is NOT "31% untested" and NOT a feature-quality grade. Feature
depth (destinations built deep by composition; the novel primitives in §5) is a
**different axis the grader doesn't measure.** Cite 0.687 for "how much is
behaviorally tested," cite 1.0 / the novelty inventory for "is it real + deep."

## 4. Code health (reproduce: `cd server && node scripts/run-detectors.js`)

- **980 findings** total (2 critical → **1 fixed this pass**, 73 high, 850 medium,
  21 low) — **under** the ~1,131 baseline floor.
- **Fixed (2026-06-09):** a real `cmd_injection` critical — `execSync()` with
  interpolated `CONCORD_WORKER_CORES` in `workers/cognitive-worker.js` → switched to
  `execFileSync` (no shell) + format-validated. Security consumer now **0 critical**.
- **Remaining high (perf backlog, not security):** 73 — `perf_sync_fs_in_handler`
  (sync fs in async paths: art/studio/whiteboard) + `perf_uncaught_sql_loop` (N+1:
  dreams/nemesis/royalty-cascade/concordia-cycles/mount-behavior). Track + fix
  incrementally; none are correctness or security.
- **Clean:** 0 secret leaks (7,286 files scanned) · 0 DTU-lineage issues · 0 orphan
  modules · 0 dormant modules · 0 decorative-state lens issues.
- 1 remaining "critical" renders as `undefined/undefined` under invariant-guardian —
  a detector-output bug to triage (not a confirmed code defect).

## 5. What's genuinely novel (reproduce: `npm run cartograph:static` → NOVEL.md)

~20 substrate primitives the cartographer tags high-novelty — things that don't
exist elsewhere or that Concord composes distinctively:

- **DTU substrate** — 4-layer self-compressing knowledge units + auto MEGA→HYPER
  consolidation + citation-cascade royalty economy on top.
- **Citation cascade** — perpetual royalties, depth-halving (21%→…, floor 0.05%,
  cap 30%, seller keeps ≥64.54%).
- **Refusal Field** — base-6 glyph algebra → time-bounded ethical gates; strength≥6
  compound-refusal overrides world signals.
- **Five-brain router** — 4 cognitive + LLaVA vision, dispatched by reasoning class
  + circuit breakers + queue depth (not MoE — full hot-swappable models).
- **HLR** — 7-mode reasoning (deductive/inductive/abductive/adversarial/analogical/
  temporal/counterfactual) with trace persistence. **HLM** — lattice topology
  mapping. **Drift monitor** — 6 contradiction classes on the corpus.
- **Embodied Layers 7–11** — per-cell sensory-OS world physics; bidirectional
  skill↔environment coupling (frost stronger in cold, fire weaker in storms,
  DBZ-style stagger into buildings); repair-pain somatic ledger; per-player offline
  dreams + forward-sim ("the world thinks about you while you're offline"); faction
  strategy state machines that act when nobody's watching.
- **7-transport mesh** (Internet/WiFi/BLE/LoRa/RF-Ham/Telephone/NFC) + **cnet
  federation** — cognition that survives infrastructure collapse.
- **EvoAsset evolution** — gameplay-derived assets auto-refine through verified
  engagement.

## 6. Shipped this arc (not yet in any other doc)

The ConKay-as-builder + safety + distribution stack, all tested + dark-by-default:

- **Builder spine:** TS LanguageService semantic layer · confined-ctx capability
  sandbox · verifiable build loop (honesty invariant: never "done" until run+lint+
  verify) · Concord DSL (lexer/parser/interpreter → macro calls, confined) + a
  Monaco language for it.
- **Memory/retrieval:** Qdrant ANN client (dual-write + ANN read, in-process cosine
  fallback) · agent long-term action memory · native-JS HDC/VSA + glyph-anchored
  Oracle compositional recall (**now on by default**).
- **Safety:** CaMeL provenance separation + quarantined-extraction + action-screening
  · confined plugin execution · self-repair decision engine → Sovereign queue.
- **Distribution wedge:** hardened MCP server (rate-limit + per-tool auth), verified-
  compute tools (`concord.verify`, `concord.math`), MCP OAuth 2.1 + PKCE, RFC 9728/
  8414 metadata, `server/mcp-server.json` for the official registry.
- **Publish boundary:** content-safety gate (`screenForPublish`) at promotion/post/
  upload — local checks always on, classifier + CSAM auto-engage when keyed.

## 7. Honest maturity (TRL-style)

Core engine ~7 · builder spine ~6 · safety ~6 · distribution wedge ~5 · connectors
~4. **Code-complete and prod-config-correct, sitting at the deploy line.** The
remaining gate is operational (secrets, a public URL, provider accounts), not
engineering — see `.env.example` go-live section. The flag posture is
production-correct: secrets hard-required where loss = compromise, dangerous modes
prod-blocked, features on, infra/secret-gated features off until provisioned.
