# State of Concord — verified snapshot (2026-08-01)

> Every number here is reproduced from a command, not memory. Re-run the command
> in the caption to verify. This doc supersedes the stale counts scattered in
> CLAUDE.md and AUDIT_INVENTORY.md. **This is itself a re-refresh** — the prior
> 2026-06-09 snapshot had drifted stale on every row in §1/§2/§3/§4 by the time
> this pass checked it (all **undercounting**, same direction as the drift this
> doc was originally written to correct — see the note in each section below).
> The lesson generalizes: even a "verified snapshot" doc goes stale the moment
> the codebase keeps growing after it's written; re-run the commands, don't
> trust the date in this header past its own re-run.

## 1. Scale (reproduce: `npm run count-loc`)

| Metric | Verified (2026-08-01) | Prior doc (2026-06-09) |
|---|---|---|
| Authored **source** LOC | **2,624,326** (9,413 files) | 2,160,246 (stale low) |
| Authored **content** LOC | **1,746,872** (2,951 files) | 851,292 (stale low) |
| **Total** | **4,371,198** | 3,011,538 (stale low) |

Top languages: js 1.40M · tsx 1.02M · ts 171k · mjs 24k. The counter honestly
reclassifies 10 data-modules (172k lines, e.g. the deprecated 145k-line
`server/dtus.js` seed pack at 0% code density) OUT of the source total.

## 2. Surface (reproduce commands in each row)

| Surface | Verified (2026-08-01) | Reproduce |
|---|---|---|
| Frontend lens directories | **266** | `ls -d concord-frontend/app/lenses/*/ \| wc -l` |
| Lens wiring | **263 WIRED · 0 broken · 2 by-design** | `node scripts/verify-lens-backends.mjs` |
| Macro domains | **547** | verifier `macroDomains` |
| Route prefixes | **2,983** | verifier `routePrefixes` |
| Backend domain files | **420** | `ls server/domains/*.js \| wc -l` |
| Numbered migrations | **398 files** (highest `399`) | `ls server/migrations/[0-9]*.js \| wc -l` |
| Route files | **131** | `ls server/routes/*.js \| wc -l` |
| Lib modules | **691** top (`ls server/lib/*.js \| wc -l`) · **1,052** recursive (`find server/lib -name '*.js' \| wc -l`) | see cell |
| `server/server.js` | **83,290 lines** | `wc -l server/server.js` |
| DB tables (cartographer) | **765** | `cd server && npm run cartograph:static` |
| Socket events (cartographer) | **337** | cartographer |
| Heartbeats (registered) | **168** | `grep -rohE "registerHeartbeat\(['\"][a-z0-9-]+['\"]" server/ \| sort -u \| wc -l` |
| Macros (graded) | **9,495 pairs** | `npm run grade-macros` |

## 3. Macro depth — read BOTH numbers (reproduce: `npm run grade-macros[:honest]`)

| Mode | Score | Distribution |
|---|---|---|
| **Default (generous)** | **0.999** | stub 1 (0.0%) · functional 13 (0.1%) · utility 5,161 (54.4%) · production 4,320 (45.5%) |
| **Honest floor** | **0.696** | stub 458 (4.8%) · functional 1,457 (15.3%) · utility 3,897 (41.0%) · production 3,683 (38.8%) |

**These measure TEST-coverage depth, not feature depth.** The honest 0.696 is a
*behavioral-test-coverage* score that taxes correctly-small `utility` code at 0.6
**by design** — it is NOT "30% untested" and NOT a feature-quality grade. Feature
depth (destinations built deep by composition; the novel primitives in §5) is a
**different axis the grader doesn't measure.** Cite 0.696 for "how much is
behaviorally tested," cite 0.999 / the novelty inventory for "is it real + deep."
Note the total-macro-pair count here (9,495, the grader's own scan of registered
`(domain, macro)` pairs) differs from CLAUDE.md's 10,399 (a broader direct-grep
across `register`/`registerLensAction` call sites, including some the grader's
narrower scan doesn't attribute) — both are current and reproducible; they
measure via different methodologies, not disagreement about the codebase.

## 4. Code health (reproduce: `cd server && node scripts/run-detectors.js`; ratchet `… --diff --ci`)

> **Code-health re-verified 2026-08-01** (committed baseline read directly +
> fresh `--diff --ci` ratchet run, both re-run for this doc pass). Every
> narrative in the previous version of this section (2026-07-03 vintage:
> "71 findings", "one command-injection at `lib.mjs:21`", "9 resource-leak /
> 13 env-config-drift / 2 route_empty_render / 1 table_orphan") described a
> baseline that has since been superseded by at least one further authorized
> refresh — see CLAUDE.md's own detector-baseline paragraph, which documents
> this exact class of drift happening repeatedly. Don't cite the old
> per-finding breakdown below; it's preserved in git history only.

- **`audit/detectors/BASELINE.json` is v1, generated 2026-08-01T15:56:15Z —
  70 fingerprints, `detectorCount` 51, totals `{critical:0, high:7, medium:17,
  low:2, info:45, total:71}`.** This is an owner-authorized refresh
  (`15ec8fd4`) of the prior 2026-07-25 snapshot (44 fingerprints / 46
  detectors). `BUDGET.json` is v13 (`maxTotal` 460, generated 2026-07-19),
  unchanged by the baseline refresh.
- **The ratchet is green.** A fresh `cd server && node scripts/run-detectors.js
  --diff --ci` run against this baseline reports **CI check PASSED** — 0 new
  high/critical.
- **The 7 highs are a known, documented false-positive class**, not live
  defects: `money-txn-hygiene-detector.js`'s own header names
  `server.js#creditWallet`/`debitWallet` verbatim as control-flow-blind noise
  — each wallet function's two `economy_ledger` writes are a primary insert
  and a mutually-exclusive catch-branch fallback, never sequential in the
  same call. Full accounting in `docs/DETECTOR_DEBT_TRIAGE.md` rows H5/H6.
- **0 critical**, holding since the 2026-06-09 `cmd_injection` fix
  (`workers/cognitive-worker.js` `execSync`→`execFileSync` + format-validated).
- **Clean on the historically-tracked classes:** 0 secret leaks (see the
  2026-07-27 P0 triage in `docs/SECURITY_SCAN_TRIAGE_2026-07.md`, which
  investigated both Aikido-flagged "secrets in git history" findings and
  confirmed both false positives) · 0 DTU-lineage issues · 0 orphan modules ·
  0 dormant modules.
- Any per-finding breakdown below the totals above is dated the moment it's
  written — the `macro-usage` detector emits RUNTIME telemetry, so the info
  tier (and total) genuinely varies run-to-run. Read
  `audit/detectors/BASELINE.json` directly for the current per-finding list
  rather than trusting a hand-copied breakdown in this doc.

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

**This section is a compressed pointer, not the changelog.** CLAUDE.md's "Recent
shipped work" table is the maintained, chronologically-ordered ledger and is more
current than anything that could be hand-copied here — read it for the full list.
As of this refresh (2026-08-01), its most recent entries are the 2026-07-31
codebase-audit + prod-readiness pass (deploy fixes, connection-reliability fixes,
LLM-pipeline fixes, Private Mode / High Power Mode per-account LLM routing, 5
security findings fixed including a critical authenticated-RCE, CI honesty fixes
including a Trivy gate that had never actually scanned anything, and root-caused
test-suite flakes) and the 2026-06-07 ConKay prod-audit (a critical double-credit
money bug fixed, earned-only CC withdrawals, front-door/onboarding fixes,
compute-don't-guess math routing, semantic archive search).

The ConKay-as-builder + safety + distribution stack (still current, tested +
dark-by-default):

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
- **Marquee connectors: all six code-complete (superseded from the 2026-06-09
  "Gmail + Calendar only" framing this section used to carry).** Gmail + Google
  Calendar are real two-way (send/push + read/inbox/pull, `connector-client.js` +
  `domains/{gmail,calendar}.js`, SSRF-guarded `connectorFetch` chokepoint,
  encrypted per-user tokens). Slack/Sheets/GitHub/Notion were built in the same
  arc — real `server/domains/{slack,sheets,github,notion}.js` + `connector-client.js`
  readers on the same chokepoint, contract-tested with injected fetch. Going live
  on any of the six needs only operator-supplied OAuth client credentials — an
  operational gate, not a code gap. See `docs/CONNECTORS_GO_LIVE.md`.

## 7. Honest maturity (TRL-style)

Core engine ~7 · builder spine ~6 · safety ~6 · distribution wedge ~5 · connectors
**~7** (all six marquee connectors — Gmail, Google Calendar, Slack, Sheets,
GitHub, Notion — are code-complete and contract-tested as of this arc; live use
on any of them is gated only on operator OAuth client credentials, not code).
**Deployed and live at [concord-os.org](https://concord-os.org) — deployment is
proven and repeatable, and real users' requests drive the work.** The flag posture is
production-correct: secrets hard-required where loss = compromise, dangerous modes
prod-blocked, features on, infra/secret-gated features off until provisioned.

**Scale-risk update (2026-07-30, supersedes the earlier "heavy concurrent load and
high-volume external traffic are still ahead" framing — that was a hypothetical
before anyone went looking).** A dedicated audit pass (`fc600e49`, `89e1e37d`,
`6d400638`, and the continuation work through `69b42627`) went looking specifically
for what each of those risk classes would surface, and fixed real instances rather
than leaving them theoretical:
- **Concurrent load:** root-caused "connections keep dropping" to a duplicate,
  unconditional 2-minute full-state saver doing a ~28MB synchronous serialize +
  forced GC per tick — long enough to trip socket.io's ping timeout under load and
  mass-disconnect everyone. Removed it; three more event-loop stalls ≥300ms found
  and fixed the same way (chunked state-snapshot serialize, a write-through store
  for `lensArtifacts` cutting the snapshot from 19.3MB→9.1MB, LRU-bounded memory).
- **High-volume external/LLM traffic:** `num_ctx` now sent on every Ollama call path
  (was silently truncating prompts under the real context window), a real
  concurrency reservation so background/vision work can't starve live chat,
  streaming chat routed through the priority queue + BYOK, and platform-provider
  overflow lanes registered as endpoint-picker candidates for genuine high-volume
  spillover.
- **Money movement at volume:** surfaced and fixed a critical wallet-drain IDOR
  across `/api/connective-tissue` (tip/bounty/claim/purchase) and a matching one on
  `/api/artifacts/:id/purchase`, a bounty-escrow fee-drain bug, and (same pass) an
  authenticated RCE, two SSRF gaps, an RBAC privilege-escalation path, an open
  redirect, and a path-traversal write — each with a regression test.

**Honest residual, stated precisely so this doesn't over-correct into a new stale
claim:** every item above was found by *auditing* for the failure mode, not by
*surviving* it — no literal heavy-concurrency or high-volume-traffic run has been
executed against the live deployment. The gap that's actually closed is "these
specific, real bugs existed and would have surfaced under load"; the gap that's
still open is "prove it under real traffic," which remains future work.
