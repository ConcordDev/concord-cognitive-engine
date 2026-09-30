# DHTP-RS Cloud Agent Handoff

## 🟢 HANDOFF — start here (cloud agents)

**Spec:** `DHTP-RS-MASTER-001` — Representation Sufficiency benchmark  
**Goal:** Determine whether DHTP produces task-sufficient cognitive representations that beat raw context and same-budget controls.  
**Claim level today:** **1 (Replication)** on fleet-health only. Do not over-claim.

### One command to resume work

```bash
node server/scripts/run-dhtp-rs.mjs resume
```

This reads `server/results/dhtp-rs/AGENT_STATE.json`, runs the next pending automated step, and saves results.

### Quick status (no API key needed)

```bash
node server/scripts/run-dhtp-rs.mjs status
npm run bench:dhtp-rs:status --prefix server
```

### Unit tests (no API key needed)

```bash
node server/scripts/run-dhtp-rs.mjs test
npm run bench:dhtp-rs:test --prefix server
```

---

## API key setup (required for live runs)

**Never commit keys.** Rotate any key previously pasted in chat.

Cloud agents should load keys from one of these (auto-searched by `provider-env-loader.js`):

| Path | Typical environment |
|------|---------------------|
| `.env.runpod` | RunPod / production pod |
| `server/.env` | Local server dev |
| `workers.env` | Worker boxes |
| `~/.config/concord/provider-keys.env` | Operator home dir |

Or pass explicitly:

```bash
node server/scripts/run-dhtp-rs.mjs phase2 --env-file /path/to/keys.env
```

Required var: `GEMINI_API_KEY` (or `CONCORD_PLATFORM_GOOGLE_API_KEY`).

---

## Execution order (spec §24)

| Step | Command | Status |
|------|---------|--------|
| 1. Analyze Phase 1 | `run-dhtp-rs.mjs analyze` | **COMPLETE** (30-trial fleet-health baseline) |
| 2. Phase 2 generalization | `run-dhtp-rs.mjs phase2` | **PENDING** — 6 probes × 20 trials × 3 conditions |
| 3. Selection ablations | `run-dhtp-rs.mjs ablation` | Pending |
| 4. Local models (2B/7B/14B) | Manual — see spec §13 | Pending |
| 5. Full raw selective | Manual | Pending |
| 6. Human blind validation | Manual — spec §16 | Pending |
| 7. Freeze + publish | Manual | Pending |

Progress is tracked in `server/results/dhtp-rs/AGENT_STATE.json`.

---

## Phase 2 details (STEP 2 — next automated work)

```bash
node server/scripts/run-dhtp-rs.mjs phase2
# or dry-run first:
node server/scripts/run-dhtp-rs.mjs phase2 --dry-run
```

- **360 LLM calls** (6 probes × 20 trials × 3 conditions)
- Conditions: DHTP, matched-budget raw, random-budget raw (no full raw)
- **~30–40 minutes** with 4s inter-call delay (rate-limit safe)
- **~$2–4** estimated Gemini cost
- Results: `server/results/dhtp-rs/rsb_<id>.json`

Probes: fleet_health, contradiction_detection, decision, temporal_reasoning, anomaly_detection, planning.

---

## Authorized claim (do not exceed)

> Concord's DHTP representation substantially reduces inference context and, in the current fleet-health benchmark, produces much higher task quality and reliability than full raw DTU context. Preliminary controls also indicate that task-directed structured representation can outperform naive same-budget representations.

**NOT claimed:** universal superiority, 2B=frontier, guaranteed hallucination reduction, all tasks/models.

---

## Rules for cloud agents

1. **Honest by construction** — report whatever the data shows; negative results are valid.
2. **Never log or commit API keys** — results JSON is gitignored.
3. **Evaluator is blind but NOT independent** — deterministic rubric only; human validation needed for publishable claims.
4. **One heavy Node process at a time** — don't run full `npm test` + live benchmark concurrently.
5. **Stage only named files** — don't `git add -A`.
6. After a run, update the owner with: run ID, claim level, DHTP vs matched/random deltas, API failure rate.

---

## Key files

| File | Purpose |
|------|---------|
| `server/scripts/run-dhtp-rs.mjs` | Cloud-agent entry point |
| `server/lib/runtime/dhtp-rs-spec.js` | Spec constants + Phase 1 baseline |
| `server/lib/runtime/representation-sufficiency-bench.js` | Benchmark harness |
| `server/lib/runtime/dhtp-rs-agent-state.js` | Resume/progress tracking |
| `server/results/dhtp-rs/` | Artifacts (gitignored JSON) |

---

## Phase 1 baseline (authoritative)

Run `rsb_c57a1d7b-6d5` — 30 trials, fleet_health, successful calls only:

| Condition | Quality | Tokens | API fail |
|-----------|---------|--------|----------|
| DHTP | 90.6% | ~257 | 0% |
| Matched raw | 85.8% | ~276 | 0% |
| Random raw | 81.0% | ~135 | 0% |
| Full raw | 19.8% | ~16,997 | 30% |

DHTP vs matched: **+4.8pp** (not yet a large-margin win).
