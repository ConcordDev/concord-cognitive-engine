# Phase 1: Substrate Provenance Audit

**Status:** COMPLETE  
**Date:** 2026-04-29

## Summary

The provenance audit framework is operational. It registers verifiable claims about Concord's capabilities and checks them against the running system before any communication uses them.

## Implementation

**File:** `server/lib/audit/provenance.js`

- `ProvenanceAudit` class with `registerClaim`, `verify`, `verifyAll`, `getReport`
- `registerConcordClaims({ db, runMacro })` — wires live verifiers for all capability claims
- `preLaunchVerification()` — gate that blocks launch if any claim fails

## Registered Claims and Live Verification Results

| Claim ID | Description | Status |
|----------|-------------|--------|
| `brain_routing` | Brain router resolves known roles | ✅ VERIFIED |
| `inference_tracer` | Tracer emits and captures spans | ✅ VERIFIED |
| `hooks_system` | Hooks registry operational | ✅ VERIFIED |
| `cost_model` | Cost rates for all brain models | ✅ VERIFIED |
| `otel_exporter` | OTel exporter module loads | ✅ VERIFIED |
| `messaging_adapters` | All 6 messaging adapters load | ✅ VERIFIED |
| `refusal_gate` | Sovereignty invariants load | ✅ VERIFIED |
| `emergent_modules` | Emergent modules initialised | ✅ VERIFIED |
| `lens_count` | Active lenses in database | ⏭ SKIPPED (no db in test) |
| `migrations_applied` | Database migrations applied | ⏭ SKIPPED (no db in test) |
| `zero_ts_errors` | Zero TypeScript errors | ⏭ DEFERRED (requires frontend build) |

**Tests:** 12/12 passing

## Key Insight

The provenance audit revealed that all programmatically-verifiable claims (tracer, hooks, brain routing, messaging adapters, cost model) DO manifest correctly in the running codebase. Database-dependent claims (lens count, migration state) require a live db connection to verify and should run as part of the daily integrity sweep.

## Continuous Verification

The daily integrity script (`server/scripts/daily-integrity.js`) runs `registerConcordClaims()` and `provenance.verifyAll()` each day at 04:00. Alert is raised if any claim transitions from `verified` to `failed`.
