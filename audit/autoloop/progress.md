# Autonomous loop — progress journal

Append-only. The loop writes here each unit (via `loop.mjs --pass/--fail/--escalate`)
so a fresh session resumes with continuity. Newest at the bottom.

- `2026-06-29` Stage 1 toolkit authored: `docs/AUTONOMOUS_LOOP.md` (north-star) + `scripts/autoloop/{lib,next,verify,guard,loop,status}.mjs` + this journal. Backlog seeded from the live rankers — 93 units (depth 60, lens 23, gameloop 1, connector 4, conkay 5). Proven: `next` selects `depth:worldmodel` (highest leverage); `guard` blocks edits to graders/baselines (exit 1); `verify` default-FAILs without a captured preGate (exit 1); `status` reads live ratchets (honest floor 0.684, ux-polish 0.955, orphans 0). Loop runs in-session (Stage 1); cron driver is Stage 3. Prerequisite to running waves: PR #840 merged + a fresh long-running branch off main.
