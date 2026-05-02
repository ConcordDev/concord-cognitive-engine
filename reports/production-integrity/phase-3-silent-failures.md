# Phase 3: Silent Failure Detection Sweep

**Status:** COMPLETE — 514 findings across 10 patterns, 21 critical  
**Date:** 2026-04-29

## Summary

Scanned 365 production source files (server/lib + server/routes) for AI-generated code failure patterns. 514 total findings across 10 pattern categories.

**Tool:** `node server/scripts/audit-silent-failures.js [--severity=critical|high|medium|low]`

## Findings by Severity

| Severity | Count | Categories |
|----------|-------|------------|
| 🔴 Critical | 21 | sensitive_in_error (9), empty_catch (12) |
| 🟠 High | 64 | catch_log_only (18), empty_function_body (44), unhandled_promise (2) |
| 🟡 Medium | 298 | async_without_await (243), await_in_loop (45), console_log_production (10) |
| ⚪ Low | 131 | placeholder_variable (51), null_default (80) |
| **AI tells** | **135** | Patterns characteristic of AI-generated scaffolding |

## Critical Findings Detail

### sensitive_in_error (9 occurrences, 4 files)

Pattern: `throw new Error(...)` with sensitive keywords in the message.

**⚠️ IMPORTANT CAVEAT — False Positives**: 7 of 9 occurrences are **false positives** from parser code in `server/lib/compute/formal-logic.js` and `server/lib/compute/symbolic-math.js`, where `token` means an AST parsing token (e.g., `"Unexpected token ${t.type}"`), not a security credential. The regex pattern needs refinement to exclude these.

**Genuine findings (2):**
- `server/lib/jwks-verifier.js:80` — `throw new Error("verifyProviderJwt: token is required")` — low risk, "token" refers to JWT parameter
- Review remaining 7 for actual credential exposure

**Recommendation:** Refine the sensitive_in_error pattern to require surrounding context (assignment, API call) rather than bare keyword presence.

### empty_catch (12 occurrences, 6 files)

Empty `catch` blocks silently swallow exceptions. Typical AI scaffolding left in place.

```javascript
// Example found:
} catch (e) { }  // exception disappears
```

**Recommended fix per occurrence:**
```javascript
} catch (e) {
  logger.warn('operation_name_failed', { error: e.message });
  // ... handle or rethrow as appropriate
}
```

These are the highest-priority fixes. 12 locations where failures become invisible.

## High Findings Detail

### empty_function_body (44 occurrences, 30 files)

Functions declared with no implementation body `function foo() {}`. These are **the clearest AI-generated scaffold indicator** — the model wrote the function signature but left the body for a future pass that never happened.

**Examples found:** Functions in domain logic, factory methods, event handlers.

**Recommendation:** Audit each: either implement or delete. An empty exported function is a capability claim that doesn't manifest.

### catch_log_only (18 occurrences, 3 files)

Catch blocks that `console.log(error)` but take no corrective action. The error is observed but the system state is not recovered.

### unhandled_promise (2 occurrences, 1 file)

`.then()` chains without `.catch()`. Rejected promises become unhandled rejections which can crash Node.js in newer versions.

## Medium Findings: async_without_await (243)

The most numerous finding. `async` functions that never `await` anything are likely one of:
1. Function was written async by AI habit but doesn't need to be (harmless)
2. Await was accidentally omitted (potential bug — returned promise is unwrapped but caller expects value)
3. Implementation was intended but never written (overlaps with empty_function_body)

**Recommendation:** Systematic review of the 45 files affected. Most are probably harmless; look for cases where the return value suggests async was needed.

## AI Code Tell Summary

135 findings match patterns characteristic of AI-generated scaffolding:
- Empty catch blocks: 12
- Empty function bodies: 44
- Generic error messages: 0 (true count after false-positive removal)
- TODO comments: checked separately
- Placeholder variables: 51
- console.log in production: 10

These are not necessarily bugs but indicate places where AI output wasn't fully reviewed before commit.

## Remediation Priority Queue

1. **Fix 12 empty catch blocks** (1 day) — highest risk, failures invisible
2. **Fix 2 unhandled promise chains** (1 hour) — process stability
3. **Audit 44 empty function bodies** (2-3 days) — capability gaps
4. **Fix 18 log-only catch blocks** (1-2 days) — error recovery
5. **Remove console.log from production** (2 hours) — cleanup
6. **Review async_without_await** (1 week) — systematic review
