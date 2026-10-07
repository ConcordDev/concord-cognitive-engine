# Mission: Concord lens UI north stars (continue)

You are Grok on Ramaj’s Mac. Goal: continue the per-lens north-star pack so Claude can implement later. Save Grok Bot usage by doing screenshot + concept work here.

## Canonical pack
`~/.zuko/lens-northstar/`
Also mirror copies into:
`/Users/dutch/concord vs code/concord-web/docs/lens-northstar/`

Read first: `NORTHSTAR.md`, `STATUS.md`, `LENSES.md`, approved Chat/Board concepts.

## Rules (non-negotiable)
1. Same family as approved Chat + Board: Claude-clean — deep black canvas, thin icon rail, serif greeting, rare teal/purple accent, ONE primary CTA. No cockpit (no brains/stalled/wallet bar, no Agent FABs, no right utility strips, no DTU trees, no stacked analysis toolbars).
2. **Every absorbed tab/sub-lens needs its own current shot + concept** — parent approval does not cover children.
3. Live site: https://concord-os.org — use browser tools / screenshots. Sign in if needed (look for `~/.claude/**/claude_test_account.md` or reuse existing browser session; do not kill Claude RC / Concord).
4. Asset naming: `NN-<id>-current.png` and `NN-<id>-northstar-concept.jpg` (or png). Update `NORTHSTAR.md` tables + `STATUS.md` after each pair.
5. Do NOT cut over live FE/BE. Pack assets + docs only.
6. Prefer Core 6 absorbed tabs first, then remaining Core parents, then Destinations 19. Full ~238 lenses inherit principles until individually specified — do NOT try to finish all 238 in one run; batch and write a CONTINUE note.

## Already done (do not redo unless broken)
- Chat APPROVED: `01-chat-current.png`, `02-chat-northstar-concept.jpg`
- Board kanban APPROVED: `03-board-current.png`, `04-board-northstar-concept.jpg`
- Goals + Calendar: currents + concepts ready awaiting human approval:
  - `05-goals-current.png`, `07-goals-northstar-concept.jpg`
  - `06-calendar-current.png`, `08-calendar-northstar-concept.jpg`

## Your batch (this mission)
Complete current + concept for remaining **Board absorbed** tabs, then start **Graph**:

1. Timeline (`/lenses/timeline` or Board → Timeline tab)
2. Study / SRS (`/lenses/srs` or Board → Study)
3. Whiteboard (`/lenses/whiteboard`)
4. Graph parent (`/lenses/graph`) — current + concept
5. If time: Graph absorbed — schema, entity, temporal, eco, meta (at least currents; concepts if bandwidth)

For concepts: generate UI mock images (image gen tools if available). Match Board concept language. If image gen unavailable, write detailed ASCII/markdown wireframes in `NORTHSTAR.md` AND still capture currents.

## Done when
- New assets on disk under `~/.zuko/lens-northstar/`
- `STATUS.md` updated
- `NORTHSTAR.md` updated with Board absorbed + Graph rows
- Write `~/.zuko/lens-northstar/MISSION_REPORT.md` with PASS/PARTIAL, files added, next batch suggestion
- Mirror pack into `concord-web/docs/lens-northstar/`

When finished, exit cleanly.
