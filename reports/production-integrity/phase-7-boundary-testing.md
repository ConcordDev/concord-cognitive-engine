# Phase 7: Boundary and Edge Case Testing

**Status:** COMPLETE — boundary tests added to production-integrity suite  
**Date:** 2026-04-29

## Property-Based Invariants Verified

The production-integrity.test.js suite includes boundary tests for:

### Cost Model Boundaries
- `computeInferenceCost(model, 0, 0)` → totalCost = 0 (zero tokens = zero cost)
- `computeInferenceCost(unknownModel, 1000, 1000)` → falls back to default rate, still > 0
- All known models produce positive cost for positive token counts

### Tracer Buffer Boundary
- Chaos experiment `tracer_buffer_overflow` emits 2,100 spans against a 2,000-span buffer
- Buffer stays bounded without OOM (circular eviction working)

### Permission Tier Boundaries
- `isToolPermitted(anyTool, "elevated")` → `{permitted: true}` (wildcard)
- `isToolPermitted(unknownTool, "restricted")` → `{permitted: false}`
- `isToolPermitted(allowedTool, "standard")` → `{permitted: true}`
- `isToolPermitted(restrictedTool, undefined)` → falls back to restricted tier

### Voice Session Boundaries
- `handleBargeIn(nonexistentId)` → returns false, doesn't throw
- `createSession`, `closeSession`, `getSession(closed)` → returns null
- Double close of same session: graceful

### Messaging Adapter Boundaries
- `parseIncoming(null)` → `{ok: false}` (all adapters)
- `parseIncoming({})` → `{ok: false}` (all adapters)
- `verifyIncoming(null, null)` → false, not throw

## Fast-Check Property Tests (Setup)

Property-based testing with `fast-check` requires:
```bash
npm install -D fast-check
```

Example properties to verify once installed:
```javascript
import fc from "fast-check";

test("DTU lineage has no cycles property", () => {
  fc.assert(fc.property(fc.array(fc.string()), ids => {
    // Any DTU chain built linearly has no cycles
    const chain = ids.map((id, i) => ({ id, parentId: ids[i-1] || null }));
    const seen = new Set();
    for (const node of chain) {
      if (seen.has(node.id)) return false; // cycle detected
      seen.add(node.id);
    }
    return true;
  }));
});

test("computeInferenceCost is non-negative for any inputs property", () => {
  const { computeInferenceCost } = require("../lib/inference/cost-model.js");
  fc.assert(fc.property(
    fc.string(), fc.nat(), fc.nat(),
    (model, tokensIn, tokensOut) => {
      const { totalCost } = computeInferenceCost(model, tokensIn, tokensOut);
      return totalCost >= 0;
    }
  ));
});
```

## Identified Boundaries Needing Tests

| Boundary | Current Test | Gap |
|----------|-------------|-----|
| Max DTU lineage depth | None | Test royalty cascade at depth 50 |
| Max thread history | None | Test circular buffer at 20 items |
| Max session inactivity | None | Test 30-min stale session pruning |
| Max cost aggregation | None | Test sortObj with >20 entries |
| Max inference spans | Chaos test | ✅ |

## Unicode / Special Character Handling

Verified by audit: messaging adapters that parse JSON bodies handle malformed input gracefully. The `parseIncoming(null)` tests cover the most common boundary case. Unicode handling for non-ASCII message content is deferred to per-platform integration testing.
