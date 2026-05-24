# Production Readiness — current floors

Snapshot at HEAD `be12e43` (2026-05-24, branch `claude/lenses-status-MyQPH`).
Every number below is reproduced by a checked-in script — run it yourself
before trusting this doc.

## Hard floors (CI gate fails if any regress)

| Surface | Floor | Current | Reproduce |
|---|---|---|---|
| Lens wiring (registered backend) | ≥ 234 of 235 WIRED | **234 WIRED / 1 NO-BACKEND-CALL by design** | `node scripts/verify-lens-backends.mjs` |
| Macro depth (weighted) | = 1.000 | **1.000** across 8,442 pairs | `node scripts/grade-macro-depth.mjs` |
| UX polish (weighted) | ≥ 0.995 | **1.000** across 235 lenses | `node scripts/grade-ux-polish.mjs` |
| Server test suite | 0 failures | **21,943 pass / 0 fail / 52 skip** (19,708 main + 2,235 behavior) | `cd server && npm test` |
| Live a11y (axe-core, WCAG 2.0/2.1 AA) | `totalA11yNodes == 0` | **0 violations / 235 lenses** | `node scripts/audit-browser.mjs` |
| Mobile horizontal overflow (375px) | 0 lenses | **0 / 235** | `node scripts/audit-browser.mjs` |
| Network errors at lens load | 0 lenses | **0 / 235** | `node scripts/audit-browser.mjs` |

## Console errors (reported but don't gate)

The browser audit reports 2,021 console errors across 235 lenses — ~10/lens.
All four unique patterns are expected behaviour for an anonymous browser
hitting protected routes, not actual bugs:

| Pattern | Cause | Expected |
|---|---|---|
| `Failed to load resource: 401 (Unauthorized)` | Anonymous lens load reading a protected endpoint before the auth gate redirects | Yes — auth boundary working |
| `Failed to load resource: 429 (Too Many Requests)` | Anonymous fetches exceeding the 30-req/min/IP unauthenticated limit | Yes — rate-limiter working |
| `Failed to load resource: 404 (Not Found)` | Sentry monitoring tunnel endpoint not configured (DSN unset) | Yes — telemetry off by default |
| `The script resource is behind a redirect…` | `/monitoring` rewritten to `/login` for unauthenticated user | Yes — same auth gate |

A logged-in user does not see these. They are the cost of the audit running
as an unauthenticated browser.

## What this measurement does NOT cover

- **External LLM calls** are stubbed by `CONCORD_NO_LISTEN`-test boots and
  by the smoke harness skipping LLM-hint macros. Run with
  `CONCORD_BEHAVIOR_TEST_LLM=true` against a real Ollama stack to exercise
  them.
- **WebRTC peer media** can't be validated in headless Chromium without
  fake-media flags. The signalling path (Socket.IO SDP/ICE relay) is
  smoke-tested; the simple-peer client mounts but real video pipes need
  hardware.
- **Concordia 3D scene** loads in the world lens audit but axe doesn't
  introspect into the canvas. Visual game-feel regressions need the
  `tests/e2e/first-cycle-journey.test.js` Tier-3 E2E.
- **Federation cross-instance** assumes the peer's `CONCORD_FEDERATION_TOKEN`
  matches yours. Single-instance dev does not exercise the protocol.

## Run-to-run stability notes

The browser audit uses `waitForLoadState('networkidle', 5s)` + 2.5s fixed
settle so axe inspects post-hydration DOM. Early runs without this saw
flake of 4–26 nodes that vanished on re-scan. Don't lower these timeouts
without a re-stability test against ≥3 consecutive runs at 0 nodes.

## Backlog (documented, not blocking)

`docs/FEATURE_UPGRADE_BACKLOG.md` enumerates spec-vs-implementation gaps
where the prose was honestly downgraded rather than upgrading the code.
Y.js CRDT for Live Share + WebRTC for telehealth shipped this session;
the remaining items (true CRDT semantics in `collab`, encryption for
`anon`, an actual recommender for `feed`) require new dependencies or
multi-week work and are tracked there.
