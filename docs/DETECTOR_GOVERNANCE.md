# Detector Governance

This is how Concord prevents technical debt from re-accumulating.

The detector substrate (Phase 0–9 of the May 2026 cleanup) shipped 11 detectors, a baseline + diff loop, repair-cortex auto-fix routing, Reflex Cortex governance, and cartograph reasoning. Phase 10 — *Permanence* — is the cognitive immune system that keeps it that way.

## The cycle

```
  Detectors discover         (every CLI run, every heartbeat, every commit)
       │
       ▼
  Baseline + history         (audit/detectors/{BASELINE,history.jsonl,BUDGET}.json)
       │
       ├──→ Repair Cortex     (auto-fix safe patterns, council-route risky ones)
       ├──→ Reflex Cortex     (4 governance handlers run on heartbeat)
       └──→ Concordia / HUD   (goddess prompt, world-health badge, EmergentEventFeed)
       │
       ▼
  Pre-commit / Pre-push      (block new critical/high findings)
       │
       ▼
  CI gate                    (debt budget × 1.05 hard ceiling)
```

## Adding a new detector

1. Create `server/lib/detectors/<name>-detector.js`. Export `run<Name>Detector({ root, db, state, opts })` that returns a `DetectorReport` (see `_framework.js`). Use `makeReport(id, findings, t0)` for the happy path and `makeError(id, reason, err, t0)` for failures. The detector **must never throw**.

2. Each finding must include `kind: "static" | "semantic" | "historical" | "predictive" | "architectural"` (the framework defaults to `"static"` for back-compat). Set `severity`, `category`, `message`, optional `location`, `evidence`, `subject`, `fixHint`.

3. Register it in `server/lib/detectors/index.js`:
   ```js
   registerDetector({
     id: "your-id",
     label: "YourDetector",
     consumers: ["code-quality", "repair-cortex", "reflex"],
     dataNeeds: ["fs"],
     description: "What it finds.",
     run: runYourDetector,
   });
   ```

4. Add tests at `server/tests/detectors-yourname.test.js` — pin shape, no-crash on empty input, expected finding when fixture data crosses the threshold.

5. Re-run `npm run detectors:baseline` to incorporate any pre-existing findings into BASELINE.json. The pre-commit hook will then only block *new* findings going forward.

## Acknowledging a baseline finding

If a detector flags something you intend to address later (or won't address), the finding's fingerprint can stay in `BASELINE.json` indefinitely. The pre-commit / pre-push / CI gates only block *new* findings.

To add a finding to the baseline:

```bash
cd server && npm run detectors:baseline   # rewrites BASELINE.json from current state
git add ../audit/detectors/BASELINE.json
git commit -m "ack: add <ruleid> at <path> to detector baseline"
```

The commit message convention `ack:` makes baseline updates easy to grep when reviewing history.

## Registering a new repair-cortex fix

Auto-fixes live under `server/lib/autofix/<name>.js` and register through `server/lib/autofix/index.js#registerFix`.

Each fix has:

```js
{
  id: "kebab-case-id",
  label: "Human description",
  riskTier: "low" | "medium" | "high",  // only "low" runs in continuous loop
  matchFinding(f),    // → boolean — does this fix apply to this finding?
  isApplicable(filePath, content, finding),  // → boolean — final guard
  apply(content, finding),  // → newContent | null (null means no change)
  describe(finding),  // → string for the changelog
}
```

Hard refusals (paths under `server.js`, `migrations/`, `tests/`, `economy/`, `royalty`, `sovereign`, `refusal-field`, `invariant`) are enforced in `safeApply()` regardless of the fix's logic — third-rail paths can never be auto-rewritten.

`riskTier: "high"` fixes never auto-apply; they always escalate to council via `auto-proposal.js`.

## How the budget is tracked

`audit/detectors/BUDGET.json` carries:

```json
{
  "maxTotal": 1300,
  "perDetector": { ... }
}
```

The CI gate (`npm run detectors:ci`) fails when the live total exceeds `maxTotal × 1.05` (5 % grace). Reset with PR review only. Per-detector caps are advisory — the gate enforces total only.

## Pre-commit / pre-push

`.husky/pre-commit` runs `node server/scripts/run-detectors.js --ci` against staged files (fast path). `.husky/pre-push` runs the same against the full tree.

Bypass: `git commit --no-verify` or `git push --no-verify`. Bypass usage is intentionally available because emergencies happen — but every bypass shows up in the git reflog and the next heartbeat sweep will surface the new finding.

## When CI blocks you

1. Run `npm run detectors:diff` locally to see exactly what's new.
2. Two options:
   - **Fix it.** Whatever the detector flagged — sync fs in async path, missing world_id scope on inventory, hardcoded secret, etc. — fix the underlying issue. The finding disappears.
   - **Acknowledge it.** Run `npm run detectors:baseline` to bake the new finding into BASELINE.json, commit the baseline file with an `ack:` prefix, and explain in the commit message why this can't be fixed now.
3. Bypass is the third option but should be the rarest. `--no-verify` is fine for "the deploy is on fire and I need to push a hotfix"; not for "this rule is annoying."

## Reflex Cortex's role

`server/emergent/reflex-cortex.js` runs four governance heartbeats (architectural-drift, scaling-pressure, dependency-entropy, unsafe-expansion). When a critical finding lands, Reflex auto-posts a council proposal AND dispatches the matching repair-cortex task. Sovereign retains override at any point.

`CONCORD_REFLEX_GOVERNANCE=0` disables it (kill-switch only — default is ON).

## What this prevents

- Sync-fs in async handlers slipping into a request path
- Hardcoded API keys ever reaching a commit
- A new dependency landing without an ADR explaining why
- Royalty-cap drift from the marketplace constants
- An invariant being added without a test pin
- DTU citation cycles or orphaned royalty ledger entries
- Module fan-in exceeding 50 (split risk) without architectural review
- Heap or DTU corpus growth slope going unchecked

## What this does NOT do

- Detect logical bugs in business logic (those need conventional tests)
- Catch security issues beyond hardcoded credentials (those need security-review tooling)
- Replace human judgement on architectural questions (Reflex *proposes*, sovereign *decides*)

The detector substrate is a floor, not a ceiling. Above it, traditional review still applies.
