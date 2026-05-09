# Archived modules

Modules in this directory are present in git history but are not imported by
any current production code path. They were moved here during the major audit
pass (phase 3.2) on 2026-05-09 after a per-module verification that no
`import`/`require` call references them.

The archive exists so the modules stay in git for historical reference while
not appearing in:
- `ls server/lib/*.js | wc -l` counts
- detector orphan-module reports
- ESLint walks
- the cartographer's "live module" graph

If you need to revive one, `git mv` it back out of `_archived/` (preserving any
sub-path) and add the importer in the same commit so the module stays connected.

| Module | Original path | Reason archived |
|---|---|---|
| `agentic/learnings-curation.js` | `server/lib/agentic/` | Never imported (per detector report) |
| `analogy-engine.js` | `server/lib/` | Never imported |
| `concord-moderate.js` | `server/lib/` | Pre-Phase-C absorbed lib; superseded by current moderation path |
| `concord-test.js` | `server/lib/` | Pre-Phase-C absorbed lib; CJS shim, no live caller |
| `evo-asset/npc-shadow-bridge.js` | `server/lib/evo-asset/` | Only referenced in a comment in `sovereign/refusal-archive.js` |
| `llm-local.js` | `server/lib/` | Only referenced in a comment in `llm-fallback.js` (Tier-2 description) |
| `npc-ambient.js` | `server/lib/` | Superseded by `emergent/npc-conversation-initiator.js` (Layer 13) |
| `npc-combat-profiles.js` | `server/lib/` | Superseded by per-archetype combat in `npc-asymmetry.js` |
| `reasoning/shadow-quality.js` | `server/lib/reasoning/` | Never imported |
| `sim/world.js` | `server/lib/sim/` | Predecessor to the active `domains/world.js` |
| `sqlite-retry.js` | `server/lib/` | Never imported; `better-sqlite3` is sync, retries are not needed |

If a future audit re-discovers a need for any of these, prefer reviving the
exact git-tracked file rather than rewriting from scratch.
