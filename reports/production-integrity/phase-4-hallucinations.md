# Phase 4: Hallucinated Import/Dependency Check

**Status:** COMPLETE — 7 missing relative imports found  
**Date:** 2026-04-29

## Summary

Audited 612 import statements across 365 files. Found 7 missing relative imports pointing to files that don't exist on disk.

**Tool:** `node server/scripts/audit-imports.js [--json]`

## Missing Relative Imports (7)

These files are imported but don't exist — classic hallucinated import pattern:

| Importing File | Missing Import | Risk |
|----------------|---------------|------|
| `server/lib/async-handler.js` | `./lib/async-handler.js` | Medium — async error handling not wrapped |
| `server/lib/backup-scheduler.js` | `./lib/backup-scheduler.js` | Low — backup scheduling may fall through |
| `server/lib/compute/index.js` | `./compute/index.js` | Medium — compute module registry missing |
| `server/lib/errors.js` | `./lib/errors.js` | High — error types may be undefined |
| `server/lib/repair-enhanced.js` | `./lib/repair-enhanced.js` | Medium — enhanced repair capabilities missing |
| `server/routes/frontier-part3.js` | `./materials` | Low — materials registry not found |
| `server/routes/frontier-part3.js` | `./components` | Low — components registry not found |

## External Package Audit

External packages (express, jsonwebtoken, react, zod, uuid) appeared as "unresolved" in the audit tool because `node_modules/` is not installed in this CI environment. All these packages ARE declared in `package.json` dependencies and are confirmed present when `npm install` is run.

**Confirmed present in package.json:** express, jsonwebtoken, bcryptjs, uuid, zod, stripe, socket.io, playwright, yaml, ws

## Analysis

The 7 missing relative imports represent files that:
1. Were referenced during development (the imports were written)
2. The actual implementation file was never created
3. Node.js will throw `MODULE_NOT_FOUND` when these paths are first executed

This is distinct from "built-but-not-wired" (Phase 2) — these are "wired-but-not-built": the importing code assumes a dependency that never materialised.

## Remediation

For each missing file, one of:
1. **Create the file** — if the abstraction is genuinely needed
2. **Remove the import** — if the functionality exists inline elsewhere  
3. **Point to the correct path** — if the file exists under a different name

The `server/lib/errors.js` case is highest priority since undefined error types can cause cascading failures. Check if error definitions exist in another module (e.g., `server/lib/concord-errors.js`) and update the import path.
