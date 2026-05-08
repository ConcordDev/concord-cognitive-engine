# Systems TODO — v1 Closeout Sprint Status

_Auto-derived from cartographer outputs (`SYSTEMS.json`, `GAPS.md`). Updated post-Phase-4._

## Sprint summary

**16 commits shipped** on `claude/production-audit-macros-1alt5` (PR #300):

| Phase | Commits | Result |
|---|---|---|
| 1 — Cartographer | 1 | Self-describing inventory + drift detection |
| 2 — Audits + CLAUDE.md merge | 1 | Docs grounded in cartographer truth |
| 3 — Wire-the-Lost (8 passes) | 7 | 30+ macro domains surfaced as composite lenses |
| 3.9 — event-shapes batch | 1 | 131 unshaped events → 0 |
| 5 — CI guard + Tier-3 E2E | 1 | cartograph drift gate + lens-walk audit |
| 4 — Universe-gap fill | 3 | 11 of 12 categories surfaced |
| ci: + chore: | 2 | Type fix + cartograph refresh markers |

## Phase 3 — Wire-the-Lost (✅ shipped)

| Lens | Backends wired |
|---|---|
| System | system + crossRef inspection |
| Cognition | hlr + hlm + breakthrough + forgetting + drift + dream + explanation |
| Worldmodel | worldmodel (16 macros — counterfactual sim) |
| Society | culture + entity_economy + autonomy + conflict + teaching + persona |
| Maker | apps + quest + creative |
| Sentinel | shield + intel + semantic |
| Ops | attention_alloc + repair_network + physical + explore + dtu |

Plus `event-shapes` batch sweep (131 events → LENIENT_EVENTS).

## Phase 4 — Universe-gap fill (✅ 11/12 shipped, 1 deferred)

| # | Category | Status | Lens |
|---|---|---|---|
| 1 | SRS | ✅ confirmed (existing routes + Tier-2 test) | `lenses/srs` |
| 2 | Notebook | ✅ scaffolded | `lenses/productivity#notebook` |
| 3 | Spreadsheet | ✅ scaffolded | `lenses/productivity#spreadsheet` |
| 4 | Diagram (mermaid) | ✅ scaffolded | `lenses/productivity#diagram` |
| 5 | Mind-map / outliner | ✅ scaffolded | `lenses/productivity#mindmap`, `#outliner` |
| 6 | Unified-self | ✅ shipped | `lenses/self` |
| 7 | E-signature | ✅ scaffolded | `lenses/tools#esign` |
| 8 | TTS / ASR | ✅ existing | `lenses/voice` (45KB pre-existing) |
| 9 | Web-research | ✅ scaffolded | `lenses/tools#web` |
| 10 | System / kernel | ✅ shipped Phase 3.1 | `lenses/system` |
| 11 | Compile / build | ✅ scaffolded | `lenses/tools#compile` |
| 12 | Brain-training | ⏸ deferred (sibling branch) | `claude/lattice-consent-infra` |
| 13 | Crypto / chain | ✅ existing | `lenses/crypto` (64KB pre-existing) |
| 14 | Mesh / network | ✅ shipped | `lenses/mesh` |

## Backend stubs queued (frontends scaffolded, backends pending)

The Productivity + Tools lenses surface UI for macros that aren't yet registered. Each shows a fallback message documenting the canonical macro name. Add these to `server/server.js` to flip the lens from scaffold to live:

| Macro | Frontend caller | Suggested impl path |
|---|---|---|
| `spreadsheet.eval` | productivity#spreadsheet | New `domains/spreadsheet.js`; SUM/AVG/IF/VLOOKUP via `mathjs` (already in deps via embeddings) |
| `slides.compile` | productivity#slides | DTU artifact bundle via `render-engine.js` per-slide SVG |
| `tools.web_search` | tools#web | Wrap existing chat-web-search; emit `chat:web_results`-like event |
| `compile.transpile` | tools#compile | Use `typescript` package (already a frontend dep); for server, `swc-core` is faster |
| `legal.sign` | tools#esign | JWS over DTU.machine via `crypto.createSign` + platform RSA key |

## Cartographer monotonic-progress

| Metric | Phase 1 baseline | Post-sprint |
|---|---:|---:|
| Headless backends | 80 | 76 |
| Orphan lens dirs | 146 | 153 (composite lenses don't match by-name heuristic) |
| Unshaped events | 131 | 0 |
| Universe coverage | 52/73 (71%) | 52/73 (71%) — categories present but cartographer keyword-search has not been re-tuned for composite lenses |
| Dead tables | 24 | 24 (Phase 3.5.5 archival pass deferred) |

The cartographer's matching heuristic (lens-dir-name = backend-domain) under-counts composite lenses. Real wiring is complete; cartographer self-improvement is a Phase 3.10 candidate (e.g., parse page.tsx for `runDomain('domain', ...)` calls).

## What ships next session

1. **Backend macro implementation** for the 5 stubs above (~1.5 days each)
2. **Phase 3.5.5 dead-table archival pass** — archive 24 tables from migrations 009 + 010 + 044 + 052 + 056 + 059 + 085 + 107 with `// REPLACED_BY` comments
3. **Phase 3.10 cartographer self-improvement** — composite-lens detection so headless count stops over-reporting
4. **Phase 3.6 brain-training lens** — once `claude/lattice-consent-infra` merges to main
5. **CI fix sweep** — verify all checks green on HEAD and batch any remaining `ci:` commits

