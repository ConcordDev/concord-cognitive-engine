# Orchestrated Invariant Engine

**Added 2026-06-26.** A contract-driven, adversarial, continuous verification system that proves
Concord's macros behave — grounded in the REAL `runMacro` path, not mocks. It plugs into the existing
immune system (detectors, lens-wiring, schema-drift, param-schema) as a new ratcheted gate.

## Why
With ~2,599 registered macros (and ~9,600 macro/lens-action pairs once dynamic + LENS_ACTIONS are
counted), you can't hand-write a test per tool. Instead the engine **auto-derives a contract per macro**
from the live registry and **adversarially attacks** every headless-safe macro on every commit, driving
violations toward 0 with a ratchet (the same honest-floor discipline as `grade-macro-depth`).

## Parts

### 1. Contracts (`content/contracts/`)
- `SCHEMA.md` + `_example.json` — the contract shape:
  `{ macro_id, domain, inputs:{<param>:{type,min,max}}, invariants:[<js-expr over (input,output)>], fuzz_cases:[{input,expect}] }`.
- `scripts/contracts/derive-contracts.mjs` (`npm run contracts:derive`) — boots the app, reads
  `globalThis.__CARTOGRAPHER__ = { MACROS, listDomains, listMacros }` (exposed at `server.js:10918`),
  and writes a baseline contract per macro into `content/contracts/derived/<domain>.json` (445 domain
  files, 2,599 macros). Inputs seed from `spec.paramSchema` where present. **Hand-authored overrides**
  in `content/contracts/overrides/<domain>.<macro>.json` merge on top — that's where you add tighter
  invariants/fuzz seeds for a macro that deserves a real proof. Not 9,600 hand-written files.

### 2. The adversarial runner (`scripts/macro-assassin.mjs`, `npm run audit:invariants`)
Boots the app in-process (reusing the smoke-harness boot) and runs 3 vectors per **headless-safe** macro:
- **V1 — seed:** each contract `fuzz_cases[].input` through `runMacro`; assert `expect` keys.
- **V2 — fuzz:** a malicious payload (NaN, Infinity, 1e308, `-1`, `<script>`, cyclic/oversized) → PASS if
  it returns `{ok:false}` or throws a caught guard error; FAIL only on a hard crash or `ok:true` on poison.
- **V3 — invariant proof:** minimal-valid input; evaluate each invariant via the safe
  `server/lib/invariant-eval.js` evaluator; FAIL on false.
- **Ratchet:** `--ratchet` compares against `audit/invariant-engine/BASELINE.json` (fingerprint =
  macro_id+vector+reason) and exits non-zero **only on NEW** violations; `--write-baseline` snapshots.

**Honest coverage boundary:** only the headless-safe macros (~2,574 of 2,599; the rest are
LLM-hint/destructive/heavy and skipped) get the V1/V2 adversarial drive. Every macro additionally gets:

### 3. The live runtime wrapper (`server/server.js`, in `runMacro`)
After each macro executes, `runMacro` asserts the universal contract on the **real output** (a macro
must return a non-null object) — full in non-prod, ~1% sampled in prod, `CONCORD_INVARIANT_RUNTIME=0` to
disable. A violation records a drift footprint + counter on `globalThis.__INVARIANT_RUNTIME__`; it
**never throws and never blocks the tick**. This catches drift live, between commits.

### 4. CI orchestrator (`scripts/adversarial-audit.mjs`, `npm run audit:adversarial`)
Runs the real gates by exit code (NO hardcoded structural counts): lens-wiring
(`verify-lens-backends.mjs`) + the invariant ratchet (`macro-assassin --ratchet`) + the detector ratchet
+ doc-claims. Wired as a `.github/workflows/` gate so a NEW violation fails the PR check.

## Baseline (first capture, 2026-06-26)
`2,599 macros enumerated · 2,574 driven adversarially · 0 hard crashes · 13 violations` — mostly
fuzz/invariant **timeouts** on heavy macros (`detectors.diff/findings/runAll/summary`,
`emergent.repair.prophet`), plus one **real caught bug** (`hypothesis.get` returned `null` — now fixed
to return an envelope). **0 hard crashes across 2,574 adversarially-fuzzed macros** is the load-bearing
result: the macro layer is robust against NaN/injection/garbage input.

## How to use it
- Add a tight contract for a macro: drop `content/contracts/overrides/<domain>.<macro>.json` with
  `invariants` / `fuzz_cases`, run `npm run audit:invariants`.
- After fixing violations: `node scripts/macro-assassin.mjs --write-baseline` to lower the ratchet.
- The ratchet only fails CI on NEW violations — so the floor only moves down over time.
