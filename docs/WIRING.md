# Concord — Wiring Status (GENERATED — do not hand-edit)

> Generated from commit `e8081198` by `scripts/generate-wiring-doc.mjs`.
> Every number below is COMPUTED by the named verifier at generation time.
> Regenerate: `node scripts/generate-wiring-doc.mjs` · Drift gate: `--check` in CI.

## Lens ↔ backend wiring — `scripts/verify-lens-backends.mjs` (live run)

| Metric | Value |
|---|---|
| Lenses WIRED | 263 |
| Lenses NO-BACKEND-CALL | 2 |
| Total lenses | 265 |
| Macro domains | 547 |
| Route prefixes | 2983 |

## Invariant → test-link integrity — `scripts/verify-invariant-test-links.mjs` (live run)

- 191/191 `pinned by tests/…` claims resolve to real files on disk.
- All invariant proofs exist. A missing one fails CI (detectors-cartography workflow).

## Lens UX polish — `scripts/grade-ux-polish.mjs` (committed artifact `audit/ux-polish.json`)

- Weighted score: **1**
- Tiers: `{"raw":0,"functional":0,"polished":260}`

## Cartograph snapshot — `audit/cartograph/SYSTEMS.json` (self-stamped 2026-06-09T02:16:46.505Z)

```json
{
  "coverageInScope": 73,
  "coveragePresent": 54,
  "deadTableCount": 28,
  "dormantModuleCount": 0,
  "heartbeatCount": 105,
  "lensCount": 260,
  "macroCount": 752,
  "macroDomainCount": 165,
  "moduleCount": 0,
  "orphanModuleCount": 0,
  "routeCount": 3370,
  "tableCount": 690
}
```

---
_For event-wiring history and the abstraction-aware audit method (why raw grep
cannot adjudicate emit/listener liveness here), see `docs/research/WIRING_INTEGRITY_AUDIT.md`._
