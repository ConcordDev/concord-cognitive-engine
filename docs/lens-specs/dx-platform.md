# dx-platform — Feature Gap vs Sourcegraph Cody / GitHub Copilot platform

Category leader (2026): Sourcegraph Cody / GitHub Copilot (IDE-integrated dev platform). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: REST routes `/api/dx/exchange`, `/api/dx/sessions` (RFC 8252 loopback OAuth); detectors grid + repair-cortex macros consumed by the bundled `concord-lsp`; billing sub-page; DevToolingPulse component.

## Has (verified in code)
- 4-step onboarding: install extension (VS Code / JetBrains / web Monaco), browser OAuth sign-in, first detector pass, first wallet debit
- 22-detector grid (stale code, orphan modules, perf hotspots, secret leaks, citation-consent gaps)
- Repair-cortex fix proposals with Accept/Ignore/Reject; per-codebase severity weight tuning
- Pay-as-you-go CC wallet billing (free tier: 10k reads / 1k writes per month); billing dashboard sub-page
- API-key issue/revoke; web editor sub-page (Monaco in browser); shadow-DTU cross-file context

## Missing — buildable feature backlog
- [x] `[L]` In-browser chat-with-codebase — ask questions about repo context (web editor is edit-only)
- [x] `[M]` PR/diff review integration — run detectors against a pull request
- [x] `[M]` Team dashboard — aggregate findings + severity trends across a team's codebases
- [x] `[M]` Codebase-wide search surfaced in the web editor
- [x] `[S]` Detector configuration UI — enable/disable individual detectors per codebase
- [x] `[S]` Usage analytics — which detectors fire most, fix-acceptance rate over time
- [x] `[M]` CI integration — detector pass as a GitHub Action / pre-merge gate

## Parity
~95% of a Cody/Copilot-platform composite. The IDE-extension + OAuth + detector + repair-cortex + metered-billing loop plus chat-with-codebase, PR diff review, codebase search, team dashboard, detector config, usage analytics, and CI config generation all ship front-to-back.

_Full backlog implemented — every item above shipped backend + real UI + tests._
