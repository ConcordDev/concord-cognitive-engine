# Phase 2: Built-But-Not-Wired Audit

**Status:** COMPLETE — findings documented, remediation plan defined  
**Date:** 2026-04-29

## Summary

Static analysis of 893 source files (server lib + routes + frontend lib + components) identified **45 orphaned server modules** — exported code that is never imported from any production path.

## Tool

**Script:** `node server/scripts/audit-wiring.js [--json]`

The script:
1. Walks `server/lib/`, `server/routes/`, `concord-frontend/lib/`, `concord-frontend/components/`
2. Parses all import statements (static, dynamic, require)
3. Checks which lib files are never imported
4. Excludes files with dynamic registry patterns (`lensRegistry.register`, `import()`, etc.)

## Orphaned Modules Found (45)

### Agentic / Infrastructure (High Priority — should be wired)
| File | Exports | Size | Recommendation |
|------|---------|------|----------------|
| `server/lib/agentic/memory-bank.js` | `MEMORY_LAYERS` | 5.4KB | Wire into agent loop context assembly |
| `server/lib/agentic/trust-trajectory.js` | `computeTrustScore`, `permissionScopeFor` | 4.1KB | Wire into permission evaluation |
| `server/lib/agentic/worktree.js` | `createWorktree`, `getWorktree`, `recordOperation` | 5.2KB | Wire into agent task management |

### Constants / Configuration (Medium Priority — wire or inline)
| File | Exports | Size | Recommendation |
|------|---------|------|----------------|
| `server/lib/api-billing-constants.js` | `API_BILLING_MODEL`, `API_PRICING` | 6.0KB | Import from billing route |
| `server/lib/artifact-constants.js` | `ARTIFACT`, `FEEDBACK` | 0.5KB | Import from artifact routes |
| `server/lib/canonical-registry.js` | `initCanonicalRegistry`, `createCanonicalStore` | 14.9KB | Wire into startup |

### CDN / Caching (Medium Priority)
| File | Exports | Size | Recommendation |
|------|---------|------|----------------|
| `server/lib/cdn-manager.js` | `createCDNManager` | 22.3KB | Wire into asset serving path |
| `server/lib/cdn-middleware.js` | `cdnMiddleware`, `cdnCacheHeaders` | ~8KB | Wire into Express middleware chain |

### Remaining 37 modules
Full list at: `server/scripts/audit-wiring.js --json > /tmp/wiring-audit.json`

## Root Cause Pattern

The build-but-not-wire pattern occurs when:
1. A module is implemented during a feature sprint
2. The implementation is correct and self-consistent
3. The integration step (adding the import to server.js or the consuming module) is skipped or forgotten
4. Unit tests pass because they test the module in isolation
5. The system appears to work because the missing capability is never exercised

This is the canonical AI-generated code failure mode — the code is internally correct but never enters the call graph.

## Remediation Plan

**Tier 1 (wire immediately):** agentic modules — memory-bank, trust-trajectory, worktree. These are explicitly referenced in architectural docs but not imported.

**Tier 2 (wire in next sprint):** Constants modules. Low risk, import from consuming routes.

**Tier 3 (audit for obsolescence):** CDN/caching modules. Verify if these duplicate existing middleware before wiring.

**Tier 4 (document as intentional):** If any module is intentionally unused (example, test fixture), add a comment: `// INTENTIONALLY_UNIMPORTED: reason`.

## False Positives

Modules that appear orphaned but are dynamically loaded (via `readdir`, `glob`, or registry patterns) are correctly excluded by the audit script. The 45 reported are truly static-import orphans.
