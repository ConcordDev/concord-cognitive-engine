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
| Frontend lens directories | **261** | `ls -d concord-frontend/app/lenses/*/ \| wc -l` |
| Lens wiring | **257 WIRED · 0 broken · 2 by-design** | `node scripts/verify-lens-backends.mjs` |
| Macro domains | **492** | verifier `macroDomains` |
| Route prefixes | **2,973** | verifier `routePrefixes` |
| Backend domain files | **405** | `ls server/domains/*.js \| wc -l` |
| Numbered migrations | **355** | `ls server/migrations/[0-9]*.js \| wc -l` |
| Route files | **131** | `ls server/routes/*.js \| wc -l` |
| Lib modules | **623** top (`ls server/lib/*.js \| wc -l`) · **922** recursive (`find server/lib -name '*.js' \| wc -l`) | see cell |
| `server/server.js` | **77,424 lines** | `wc -l server/server.js` |
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

## 4. Code health (reproduce: `cd server && node scripts/run-detectors.js`; ratchet `… --diff --ci`)

> **Code-health re-verified 2026-07-03** (fresh full run + fresh `--diff --ci`
> against the committed baseline, both re-run for this doc pass). The
> 2026-06-09 "73 high perf backlog" that used to stand here is **CLOSED** — 0
> high today too. That 73 predated the 2026-06-29 baseline refresh; don't cite
> it.

- **0 critical · 0 high, both today's fresh run and the ratchet.** A fresh
  full `node scripts/run-detectors.js` run (2026-07-03) totals **71 findings:
  {critical:0, high:0, medium:26, low:15, info:30}**. This differs from the
  committed baseline (`audit/detectors/BASELINE.json`, v1, 2026-06-29, 30
  detectors: `{critical:0, high:0, medium:27, low:15, info:176} = 218`)
  almost entirely in the **info** bucket — info findings are runtime
  macro-usage telemetry (per CLAUDE.md), not static-code defects, so they're
  inherently volatile run-to-run; medium/low are close to stable. The
  `--diff --ci` ratchet (the actual PR gate) is the more meaningful signal:
  **added 5** (0 critical, 0 high, 4 medium, 1 info) vs **removed 152**, **66
  unchanged** — **CI check PASSED**, 0 new high/critical. `BUDGET.json` (v10,
  maxTotal 225) still states "0 critical / 0 high" as its floor.
- **The perf backlog is closed, and its named sites were largely false-positives.**
  art/studio/whiteboard carry only module-scope `fs.existsSync` (runs once at boot —
  the detector explicitly exempts sync-fs outside a handler body); `dream-engine.js`
  uses the correct `.all()`-then-iterate (one query, not an N+1). The 2026-06-09
  `cmd_injection` critical fix (`workers/cognitive-worker.js` `execSync`→`execFileSync`
  + format-validated) still holds → **0 critical**.
- **Two residual findings named in earlier snapshots of this doc are now FIXED
  (verified against today's fresh run — neither appears in current findings):**
  the `emergent/nemesis-cycle.js:123-127` query-in-loop and the
  `server/lib/world-snapshot.js:77` `db_prepare_in_loop` were both closed by
  commit `4b2384da` ("perf: hoist per-table prepared statement in
  world-snapshot; collapse nemesis-cycle N+1") — `world-snapshot.js#restoreWorld`
  now hoists one prepared INSERT per table outside the row loop, and
  `nemesis-cycle.js#_processSchemeBetrayals` now does one batched
  `character_opinions` lookup via `WHERE npc_id IN (...) AND target_id IN
  (...)` instead of a per-row query, correlated in-memory via a Map. Both
  behavior-identical (`world-snapshot.test.js` 4/4, `nemesis-cycle.test.js`
  19/19).
- **Command-injection: the earlier "2 medium" figure and its `scripts/autoloop/lib.mjs:21`
  citation need a correction.** Today's fresh run confirms exactly **one**
  current command-injection finding — `cmd_injection_variable_command` at
  **`scripts/autoloop/lib.mjs:21`** (dev-script scope, real security-relevant
  signal, PROTECTed autoloop file — not something this doc pass can or should
  edit). The *second* command-injection finding that used to make the count
  "2" was `scripts/repair-surgeon.js:113` (`executeFixCommand`'s
  `execSync(cmd)`), and it is now **FIXED** — commit `4c2546ea` switched it to
  `execFileSync("/bin/sh", ["-c", cmd], ...)` (an explicit argv shape instead
  of a single interpolated string handed to a shell-spawning exec; the
  injection surface was already closed upstream by the pre-validated
  `safePkg`/`safePort`/`safePath` captures, this closes the pattern at the
  sink too). Confirmed absent from today's findings. So the current, accurate
  count is **1 medium command-injection finding**, at `lib.mjs:21`.
- **Other residual (medium, tracked — none high, none corrupt data):** 9
  `resource-leak` findings, 13 `env-config-drift` findings (hardcoded
  connector URLs — Notion's OAuth/API endpoints in
  `server/lib/connector-client.js:392` and
  `server/routes/connector-oauth.js:106-107` are the newest, added this
  session), 2 `route_empty_render` (both in
  `concord-frontend/app/lenses/quantum/page.tsx`), 1 `stale-code` /
  `table_orphan` (`server/migrations/275_evo_asset_fk_repair.js:35` — a table
  created but never read/written outside migrations).
- **Clean:** 0 secret leaks · 0 DTU-lineage issues · 0 orphan modules · 0 dormant
  modules · 0 decorative-state lens issues.
- The prior "980 findings / 1,131 floor" line was the 2026-06-09 pre-refresh snapshot
  (info-heavy). Trust a fresh run + the ratchet, not that number.

## 5. What's genuinely novel

> **Full inventory: `docs/NOVELTY_INVENTORY.md` — ~326 distinct novelties across 34
> groups** (a hand-maintained full-tree sweep). The cartographer's auto-generated
> `audit/cartograph/NOVEL.md` curates only the ~20 *headline* primitives below; the
> real surface is ~15× that, and most of the invention is in the **couplings**
> (drift→quest, pain→XP→buff, citation→royalty, fault→verified-fix→governance). Use
> the inventory as the build-reference map for "does X already exist / where does it
> live" before building anything new. For the *strategic* read — why the combination
> is defensible, the white-space argument, the honest caveats — see
> `docs/WHY_CONCORD_IS_DIFFERENT.md`.

The ~20 cartographer-tagged headline primitives — things that don't exist elsewhere
or that Concord composes distinctively:

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
- **Marquee connectors made real (2026-06-09):** Gmail + Google Calendar are now
  real two-way. Send/push were already real; this arc added the read side —
  `connector-client.js` Gmail read (`readGmailMessages`/`readGmailMessage` full
  MIME parse, `modifyGmailMessage`, `listGmailLabels`) + Calendar pull
  (`readGoogleCalendarEvents`), `domains/gmail.js`
  `list/get/modify/trash/labels`, `domains/calendar.js#accounts-pull-events` —
  all on the SSRF-guarded `connectorFetch` chokepoint (encrypted per-user tokens,
  auto refresh). Frontend: a polished **GmailSection** inbox client in the
  message lens + a **Sync Google** overlay in the calendar lens. Tests:
  `connector-read-paths` (11) + `connector-oauth*` (23). Live use needs only a
  Google OAuth client (operational — `docs/CONNECTORS_GO_LIVE.md`).

## 7. Honest maturity (TRL-style)

Core engine ~7 · builder spine ~6 · safety ~6 · distribution wedge ~5 · connectors
**~6** (Gmail + Google Calendar real two-way as of 2026-06-09; other connectors
still to wire). **Deployed and live at [concord-os.org](https://concord-os.org) — deployment is
proven and repeatable, and real users' requests drive the work.** The remaining
hardening is about *scale*, not shipping: heavy concurrent load and high-volume
external traffic are still ahead, and provider-gated features (e.g. some connectors)
turn on as their secrets are provisioned — see `.env.example` go-live section. The flag posture is
production-correct: secrets hard-required where loss = compromise, dangerous modes
prod-blocked, features on, infra/secret-gated features off until provisioned.
