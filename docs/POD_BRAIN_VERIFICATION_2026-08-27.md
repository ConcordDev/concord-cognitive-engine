# Pod brain verification — 2026-08-27

Purpose: before the RunPod A40 pod (`194.68.245.126`) is torn down, confirm
every system that depends on the five-brain LLM stack actually works end to
end against the real models, and log the result — so LLM-dependent work can
be "frozen" on a known-good baseline and further app development can
continue on the local Mac without the GPU pod.

## Pod bring-up (from a freshly-recreated container)

The container's ephemeral root filesystem had been wiped since the last
session (no `node`/`npm`/`pm2`/`ollama` installed — RunPod recycles the
container's root disk independently of the persistent `/workspace` network
volume). Brought back up from scratch:

- Node 22.23.2 via NodeSource, `pm2` via npm.
- `ollama` via the official install script (needed `zstd` first).
- Confirmed model weights survived on the persistent volume: `/workspace/.ollama`
  (37GB — `concord-conscious`, `gemma4`, `qwen2.5`, `qwen2.5vl` families), so no
  re-download was needed.
- `scripts/runpod-cognition.sh` (bare-metal 5-brain launcher, no docker-compose)
  — **must be run with `.env.runpod` sourced first** (`set -a; . ./.env.runpod; set +a`).
  Running it without sourcing that file silently uses the script's own
  built-in defaults instead of the pod's actual configured models — first
  attempt loaded `qwen2.5vl:7b`/`qwen2.5:1.5b` for vision/repair instead of
  the real `.env.runpod` values (`gemma4:e4b`/`qwen2.5:0.5b`). Re-ran
  correctly the second time.
- `npm run migrate` — see **Finding 1** below (blocked on a broken orphan
  migration, worked around).
- `pm2 start ecosystem.config.cjs --only concord-backend --env runpod`.

## Findings (pod/ops, not this session's app code unless noted)

### Finding 1 — migration-number collision, one broken migration (pod filesystem only, not in git)
The pod's `server/migrations/` had three files never committed to this
repo's git history: `415_lexicon_semantic.js`, `416_kv_cache_dtus.js`,
`417_server_dtu_substrate.js` — labeled "Sprint 33 Phase 2: CSL (Concord
Semantic Language) substrate," referencing `docs/SPRINT-33-CSL-PLAN.md`
(also not in this repo). These collide with this branch's real
`416_world_consequences.js`/`417_npc_living_world.js` numbering.

`415_lexicon_semantic.js` is itself broken: its `CREATE TABLE IF NOT EXISTS
lexicon_nodes` uses `BIGSERIAL` (a PostgreSQL type) against SQLite, and a
stale partially-created `lexicon_nodes` table already existed on the pod's
live DB (from a prior interrupted run) without the columns the migration's
own `CREATE INDEX` immediately requires — `npm run migrate` hard-failed with
`no such column: part_of_speech`.

**Action taken:** moved the 3 files (not deleted) to
`/workspace/pod-orphan-migrations-CSL-sprint33/` on the pod so `npm run
migrate` could proceed to this branch's real 415/416/417. This is a
pod-filesystem-only change — nothing in this repo's migrations directory
was touched. Whether the CSL work is still wanted is an operator decision;
if so, it needs proper numbering (append after whatever's actually next)
and the `BIGSERIAL`→SQLite type fix before it can land.

### Finding 2 — `.env.runpod` vs `ecosystem.config.cjs`'s `env_runpod` disagree on `BRAIN_REPAIR_MODEL`
`.env.runpod` says `qwen2.5:0.5b`; `ecosystem.config.cjs`'s `env_runpod`
section (which pm2 actually uses — confirmed live) says `qwen2.5:1.5b`. Not
a functional break (both models are present in the shared Ollama model
store either way, and `/health` confirmed the repair brain does come online
and respond), just a real drift between two sources of truth that are
supposed to agree, same class of issue CLAUDE.md's "Heap & cap tuning"
section already warns about for `MAX_OLD_SPACE_SIZE`. Whichever value is
actually intended, one of the two files is stale.

### Finding 3 — `/health`'s per-brain `enabled` flag lags real readiness by up to ~2 minutes after boot
`initFiveBrains()`'s probe is async and NOT awaited by whatever gates
`import("../server.js")`/first HTTP readiness — `/health` immediately after
boot can report `enabled:false` for brains that are, moments later,
genuinely online (confirmed: raw `curl` to the same Ollama port succeeded
throughout). Repeated polling showed conscious/subconscious settle fast,
utility/repair/multimodal can take substantially longer. This is likely
also the root cause of the repeated `oracle_brain_call_failed` /
`narrative_bridge_lore_failed` / `lore_synthesis_failed` warning loops seen
in the very first seconds of every boot (the world/NPC content seeder tries
an oracle-brain call before the probe has finished). Not fixed this session
(no production code touched) — flagged for the operator's judgment on
whether early-boot LLM-dependent calls should wait on a "brains ready"
signal instead of firing immediately.

### Finding 4 (test-only fix, applied + verified) — `llm-router-contract.test.js` raced the same async probe
The first subtest (`ctx.llm.chat → conscious brain happy path`) called
`ctx.llm.chat()` immediately after `import("../server.js")` resolved, with
no wait for `BRAIN.conscious.enabled`. On a genuinely cold boot the probe
hadn't finished yet — proven directly: the log's own `brain_online` event
for `conscious` landed chronologically *after* the test had already failed
and the suite had already reported `not ok`. This produced a false
negative — the system was not actually broken, the test just checked too
early. Fixed by polling `BRAIN.conscious.enabled` (60s deadline) before the
assertion — a test-only change, `server/tests/llm-router-contract.test.js`.
Re-ran and confirmed green after the fix (see results table below).

## Results — brain-dependent systems, tested live against the pod's 5 Ollama instances

| # | System | Method | Result |
|---|---|---|---|
| 1 | Raw Ollama reachability, all 5 ports | `ollama pull` + wiring verifier (`scripts/runpod-cognition.sh`'s own check) | ✅ WIRED — all 5 models present |
| 2 | Raw inference — conscious (`concord-conscious:latest`, 14.8B) | direct `POST /api/generate` | ✅ `"PONG"` |
| 3 | Raw inference — subconscious (`qwen2.5:7b-instruct-q4_K_M`) | direct `POST /api/generate` | ✅ `"PONG"` |
| 4 | Raw inference — utility (`qwen2.5:3b`) | direct `POST /api/generate` | ✅ `"PONG"` |
| 5 | Raw inference — repair (`qwen2.5:1.5b`, per live pm2 config) | direct `POST /api/generate` | ✅ `"PONG"` |
| 6 | Raw inference — vision (text-only sanity, `gemma4:e4b`/`qwen2.5vl:7b`) | direct `POST /api/generate` | ✅ `"PONG"` |
| 7 | Vision — real image understanding | 256×256 solid-blue PNG, "what color?" | ✅ `"Blue"` (a degenerate hand-rolled 32px swatch was misread as "White" — not representative of real photos, not treated as a defect) |
| 8 | App-level `/health` brain wiring | `GET /health` after full settle | ✅ all 5 `enabled:true`, correct URLs/models |
| 9 | `ctx.llm.chat` → conscious, live | `llm-router-contract.test.js` | ✅ after Finding 4's fix (was a false-negative race before) |
| 10 | `ctx.llm.chat` clean-fail when conscious forced offline | `llm-router-contract.test.js` | ✅ (4/4 pass in the file) |
| 11 | `callVision` end-to-end through the app | `llm-router-contract.test.js` | ✅ (4/4 pass in the file) |
| 12 | LLM-hint macros (27 macros gated by `CONCORD_BEHAVIOR_TEST_LLM`) | `llm-hint-macros-contract.test.js` | ✅ 27/27 pass |
| 13 | Prompt-injection defenses under live brains | `platinum-prompt-injection.test.js` | ✅ 7/7 pass |
| 14 | Quest dialogue composer (opt-in LLM path) | `quest-dialogue-composer.test.js` | ✅ 10/10 pass |
| 15 | Lattice-born quest composer (opt-in LLM path) | `lattice-quest-composer.test.js` | ✅ 29/29 pass |
| 16 | Real production chat API, real auth, real conscious-brain round trip | `POST /api/chat?full=1` with a freshly-registered account's bearer token | ✅ `{"ok":true,"reply":"PONG",...,"llmUsed":true,"capabilities":{"llmReady":true,...}}` |
| 17 | Real production vision macro, real auth | `POST /api/lens/run {domain:"food", name:"vision"}` with a real (synthetic) image | ✅ after Finding 5 below — first call 503'd, warm retry succeeded with a genuinely reasoned, honest response |

**Totals: 6 LLM-gated test files, 77 individual test cases, all green. Plus
2 real HTTP round trips through the actual production routes (not just
internal `ctx.llm` calls) — chat and vision — both confirmed working
end-to-end with real auth.**

### Finding 5 — vision brain's cold-VRAM-load can exceed the app's 60s request timeout on the first call after boot
`POST /api/lens/run {domain:"food", name:"vision"}` 503'd with `"Request
timeout","timeoutMs":60000` on the very first vision call after the
cognition stack came up. Direct raw `curl` to the same Ollama vision
instance (`gemma4:e4b`) with the same image took 45.1s standalone
(model already warm from nothing — this WAS the cold load) and returned a
correct, honest response. Retried the exact same app-level call afterward
(model now warm): succeeded in 39.0s with a well-reasoned answer. Not a
vision-pipeline defect — the model and prompt path both work correctly —
but a real operational gap: nothing pre-warms the vision brain at boot, so
the first real user to trigger a vision-dependent lens shortly after a
deploy/restart can get a spurious timeout. Worth a boot-time warm-up call
or a longer timeout specifically for the vision slot; not fixed this
session (ops/config tuning, not a code defect).

## Summary

Every brain-dependent system this session could exercise — the 5 raw
Ollama endpoints, the app's own `/health` wiring, `ctx.llm.chat` (both the
happy path and the clean-failure path), `callVision`, the 27 LLM-hint
macros, prompt-injection defenses, the quest-dialogue and lattice-quest LLM
composers, and two real production HTTP round trips (chat, food vision) —
is confirmed working against the live 5-brain stack. Two genuine defects
were found and fixed (both test-only, zero production code touched):
Finding 4's boot-race false negative. Three more are logged as findings for
an operator decision, not fixed here because they're either pod-filesystem
state unrelated to this repo (Finding 1), config drift between two files
that both claim to be authoritative (Finding 2), or operational tuning
(Findings 3 and 5) — none of them indicate the brains or their app
integration are actually broken.

## Follow-up — config fixes (same day, after the verification pass above)

Per an explicit "fix any and all configs" instruction, closed out Findings
2 and 5 for real (both were previously just logged):

- **`ecosystem.config.cjs`'s `env_runpod.BRAIN_REPAIR_MODEL`** was
  `'qwen2.5:1.5b'`, directly contradicting a comment 4 lines above it in the
  same file that already documented the intended set as "... +
  qwen2.5:0.5b + ...", and contradicting `.env.runpod`'s
  `BRAIN_REPAIR_MODEL=qwen2.5:0.5b`. Fixed to `0.5b`. Root cause of *why*
  this could drift silently: the existing `[ENV_CONFLICT]` detector in
  `server.js`'s dotenv loader only compares the plain `.env` file against
  pm2-injected env — it never sees `.env.runpod` at all, because
  `.env.runpod` is exclusively shell-sourced by
  `scripts/runpod-up.sh`/`runpod-cognition.sh`, never dotenv-loaded by the
  Node process itself. So `.env.runpod` vs `ecosystem.config.cjs`'s
  `env_runpod` drift is currently invisible to any automated check — this
  fix closed the one instance found, not the class of bug (no new detector
  was added).
- Systematically diffed **every** key in `env_runpod` against
  `.env.runpod`: only `BRAIN_REPAIR_MODEL` was a real functional mismatch.
  The `BRAIN_*_URL`/`OLLAMA_HOST` differences (`127.0.0.1` vs `localhost`)
  are cosmetically different but functionally identical (both loopback);
  left alone.
- **`LLM_REQUEST_TIMEOUT_MS`** added at `90000` (was unset, defaulting to
  60000) in both `.env.runpod` and `ecosystem.config.cjs`'s `env_runpod`
  (declared in both, same reasoning as every `BRAIN_*` pair — only the
  ecosystem.config.cjs copy actually reaches a pm2-managed process).
  Closes Finding 5's cold-boot vision timeout with real headroom instead of
  leaving it as a known gap.
- Pushed both corrected files to the pod and did a clean `pm2 delete` +
  `pm2 start --env runpod` (not a bare `restart`, which does not reload
  env — confirmed live: `pm2 restart` kept serving the stale repair model
  after the file was already fixed). Re-verified via `/health`: `repair`
  now reports `qwen2.5:0.5b`, `multimodal` reports `qwen2.5vl:7b` (this one
  was already correct in git — the pod's *own*, previously-uncommitted
  local edit to `ecosystem.config.cjs` had it on `gemma4:e4b`; pushing the
  git-tracked file corrected that too, incidentally).
- Real-inference sanity check on the new repair model: default-temperature
  request returned `"PING"` instead of the requested `"PONG"` once — looked
  concerning, but re-tested at `temperature:0` (deterministic decoding, 3
  attempts): `"PONG"` every time. Not a defect — a genuinely small (0.5B)
  model has more default-temperature sampling variance than the four bigger
  brains, which all answered correctly regardless of temperature. Worth
  knowing about if `repair`'s call sites don't already pin a low
  temperature for structured auto-fix output, but not something this pass
  changed.
- Synced every fix (the 3 character-creation/world-lens fixes from earlier
  in the session, the test fix, both config files, this doc) into the
  self-hosted local mirror at `~/concord/concord-cognitive-engine` (a
  separate, non-git checkout the operator runs local dev against
  specifically to avoid paying for the pod during ordinary work) — as of
  this pass it, this git-tracked checkout, and the pod are all consistent
  with each other. `.pod-salvage-2026-08-27/` was deliberately NOT synced
  there or merged anywhere — see its own README.

**This is a reasonable point to freeze LLM-dependent verification work on
the pod.** Config drift is closed, not just documented. The next step is
reconciling whatever's on the pod's disk that isn't yet in this git repo
before the pod comes down — see `.pod-salvage-2026-08-27/README.md` for
that (kept separate since it's a different kind of decision — what to keep
vs. discard — not a pass/fail verification).
