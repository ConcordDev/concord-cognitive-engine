# 🤖 AUTONOMOUS_LOOP — north-star for the self-driving completion loop

> **This file is the source of truth. The loop re-reads it at the top of every unit.**
> Progress lives in **files + git**, never in an agent's context window. The thing that
> says "done" (the verifier) is **never** the thing that did the work (the worker).

This loop drives Concord's five remaining workstreams to completion without losing
coherence. It is the generalized, automated form of the proven depth-fleet pattern,
hardened with the anti-drift / anti-reward-hacking guards from the long-running-agent
research (Anthropic `cwc-long-running-agents`, the Ralph loop, the 2025–26 reward-hacking
literature).

## The loop contract

```
re-read THIS file + audit/autoloop/backlog.json          ← durable state, NOT context
  → node scripts/autoloop/next.mjs                        → selects ONE highest-leverage unit
  → fresh-context WORKER subagent implements that unit     (one domain/lens/connector/beat/loop)
  → node scripts/autoloop/verify.mjs <unitId>             → INDEPENDENT default-FAIL gate (PASS/NEEDS_WORK)
  → node scripts/autoloop/guard.mjs                        → automated anti-gaming gate on the diff
  → commit + push the unit; mark passes:true; append to audit/autoloop/progress.md
  → check stop conditions (AGENT_STOP, STEER.md, max-iters, no-progress) → repeat
```

Two load-bearing rules:
1. **A unit is "done" only when `verify.mjs` returns PASS** — a worker's self-report is never trusted.
2. **`guard.mjs` must pass before any commit** — it auto-rejects (no human needed) any diff that
   games a metric.

## The five streams + their machine-checkable DONE

| Stream | Unit = | Worker builds | Verifier gate (one-direction ratchet) | Stream DONE |
|---|---|---|---|---|
| `depth` | one domain | `depth-scaffold.mjs <d>` → fill REAL assertions → `check-depth-tests` clean | honest floor (`grade-macro-depth.mjs --honest` `weightedScore`) rose, OR the domain's `untested` set in `depth-backlog` shrank with substantive asserts | `depth-backlog` empty OR floor flat (<0.001) over 2 consecutive waves (ceiling) |
| `lens` | one sub-bar lens | real empty-state / CRUD / rival-shape per `lens-features` manifest | that lens's tier in `ux-polish.json` improved (raw→functional→polished) AND global `weightedScore` held | every lens `polished` (floor → 1.0) |
| `connector` | one connector (slack/sheets/github/notion) | egress helpers in `connector-client.js` + tokens + `domains/<c>.js` + contract tests w/ **injected fetch** (mirror gmail/calendar) | the connector's contract tests pass AND `lens-broken-calls.mjs --ci 0` holds | 4 connectors built; **live-creds/go-live is ESCALATED, not auto** |
| `conkay` | one HUD beat ↔ one real `macro:*` event | bind one scene element to one real socket event | honesty grep gate (no `setInterval`/fake-progress under `components/conkay/`) holds AND a test asserts the element reacts to the real event | scene bound, honest-by-construction |
| `gameloop` | one Concordia loop | wire the orphan-emit / dead-listener / reward-without-grant | `audit-emergent-wiring` orphan==0 AND `check-orphaned-events` clean AND a behavioral test proves the consequence lands (e.g. wallet actually credited) | 0 orphan / 0 phantom across all loops |

## Escalation (maximize-autonomy: machine gates stay, human stops are minimal)

**Hard-STOP and ask a human ONLY when:**
- a unit's diff would edit a **money or auth invariant** (royalty/fee constants, withdrawal policy,
  JWT/auth gates, the three-gate permission system);
- a `connector` unit reaches the **live-credentials / go-live** step (real OAuth app secrets the
  loop cannot self-provision);
- a unit fails `verify.mjs` **3 times** in a row (genuinely stuck → human triage).

**Everything else proceeds autonomously.** Note: `guard.mjs` rejecting a grader/test/baseline edit is
an **automated** rejection (the worker re-does the unit without gaming), NOT a human escalation — it is
the structural rail that must survive maximize-autonomy.

## Control files (kill-switch / steer)

- **`AGENT_STOP`** (repo root) — if this file exists, the loop halts after finishing the current unit.
  `touch AGENT_STOP` to stop; `rm AGENT_STOP` to resume.
- **`STEER.md`** (repo root) — if present, the loop surfaces its contents once at the top of the next
  unit (async human redirection without stopping), then deletes it.

## Anti-drift guards (research → mechanism)

- Durable state = `backlog.json` + `progress.md` + git, re-read each unit (no reliance on context memory).
- **Independent verifier**: `verify.mjs` is run by a verifier subagent spawned with **no Write/Edit
  tools**; it grades from the diff + a real evidence artifact, defaulting to FAIL.
- **One-direction ratchets** are the DONE signal — shape-only / padded work scores *low* by
  construction (`--honest` weights utility 0.6 and refuses shape-only credit; `check-depth-tests`
  blocks `assert.ok`-only tests).
- **No-progress detection**: the loop exits if N consecutive units produce no ratchet movement and no
  new passing unit. Plus a max-iterations cap and a token ceiling per run.
- Idempotent units: a `passed` unit is skipped on re-entry; a crashed unit resumes from the last green
  commit.

## Resume anchor (for a fresh session / the cron driver)

1. Read this file.
2. `node scripts/autoloop/status.mjs` — current per-stream state + ratchet numbers.
3. `node scripts/autoloop/next.mjs` — the next unit + its DONE gate + the worker prompt.
4. Tail `audit/autoloop/progress.md` — recent learnings / dead-ends.

The loop's wave commits land on a dedicated long-running branch off `main` (created once PR #840 is
merged); this toolkit is authored on the current feature branch.

## Stage 3 — hands-off cron driver (`.github/workflows/autoloop.yml`)

A scheduled workflow runs ONE bounded iteration per fire: `next.mjs` selects the unit → Claude Code
(headless, `claude -p`, one unit, `--max-turns 60`) does the intelligent worker step → the
**deterministic gates decide if it lands**: `verify.mjs` must PASS (default-FAIL) and `guard.mjs` must
be clean, or the changes are discarded (`git checkout`/`clean`) and the attempt recorded. The model
never owns the commit. Safety: runs only on branch `autoloop/main` (never `main`), honors `AGENT_STOP`,
one unit per run, `guard.mjs` hard-blocks grader/baseline/test-weakening/money-auth edits.

**Human prerequisites (one-time):** (1) repo secret `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`)
— the loop can't self-provision model access; (2) the `autoloop/main` branch off `main`; (3) review +
fast-forward `autoloop/main` → `main` periodically. Bump the cron (`0 */6 * * *`) once trusted, or drive
on demand from the Actions tab (`workflow_dispatch`, `max_iterations` input).
