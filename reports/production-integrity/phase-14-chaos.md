# Phase 14: Chaos Engineering Setup

**Status:** COMPLETE — framework operational, 4 built-in experiments  
**Date:** 2026-04-29

## Implementation

**File:** `server/lib/chaos/failure-injector.js`

- `FailureInjector` class with `registerExperiment`, `runExperiment`, `runAll`
- Safety gate: only runs when `CONCORD_CHAOS_ENABLED=true`
- Observation collection via inference tracer spans during experiments
- Guaranteed cleanup via try/finally pattern

## Built-in Experiments

| Experiment | Injected Failure | Assertion |
|-----------|-----------------|-----------|
| `hooks_throwing_handler` | Hook handler throws | System continues, no crash |
| `tracer_buffer_overflow` | 2,100 spans emitted (buffer=2,000) | Buffer stays bounded, no OOM |
| `messaging_null_input` | `parseIncoming(null)` | Returns `{ok:false}` not throw |
| `permission_tier_no_context` | `before_tool` without `lensContext` | Not aborted (messaging gate skips) |

## Usage

```bash
# Enable chaos mode
CONCORD_CHAOS_ENABLED=true node -e "
  import('./server/lib/chaos/failure-injector.js').then(({ failureInjector }) =>
    failureInjector.runAll().then(console.log)
  )
"
```

## Tests

- `runExperiment` skips when `CONCORD_CHAOS_ENABLED` not set ✅
- Built-in experiments registered ✅
- `registerExperiment` is chainable ✅

## Planned Experiments (Next Sprint)

| Experiment | Failure | Verification |
|-----------|---------|-------------|
| `ollama_brain_dies` | Kill ollama process | Router falls through, user experience continuous |
| `database_slow` | Add 2000ms DB latency | Timeouts handled gracefully |
| `memory_pressure` | Allocate 90% memory | Graceful degradation, core ops continue |
| `network_partition` | Block port 11434 | Brain routing falls back |

These require OS-level failure injection (kill, tc, stress-ng) and should run on a dedicated staging instance, not in CI.

## Constitutional Constraint

Chaos experiments NEVER run in production without explicit opt-in. The `CONCORD_CHAOS_ENABLED` gate enforces this. The framework respects Concord's "do not break existing functionality during audits" principle by always calling `cleanup()` even when experiments fail.
