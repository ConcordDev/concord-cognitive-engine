# Mission: Concord lens north-star RUN-THROUGH (no approval gates)

You are Grok on Ramaj’s Mac. Owner instruction (2026-10-02 ~14:46 ET): **do not wait for human approval between lenses.** Run current + concept pairs continuously. Owner reviews the pack later. Save Grok Bot usage by doing this work here.

## Canonical pack
`~/.zuko/lens-northstar/`
Mirror into: `/Users/dutch/concord vs code/concord-web/docs/lens-northstar/`

Read first: `NORTHSTAR.md`, `STATUS.md`, `LENSES.md`, approved Chat/Board concepts (`02`, `04`), and reuse the HTML/CSS mock approach from the last PASS (exact type > image-gen garble).

## Rules (non-negotiable)
1. Same family as approved Chat + Board: Claude-clean — deep black canvas, thin icon rail, serif greeting, rare teal/purple accent, ONE primary CTA. No cockpit (no brains/stalled/wallet bar, no Agent FABs, no right utility strips, no DTU trees, no stacked analysis toolbars).
2. **Every absorbed tab/sub-lens needs its own current shot + concept** — parent does not cover children.
3. Live currents: prefer `http://localhost:3000` as signed-in user (same DB as concord-os.org) if FE is up; else https://concord-os.org. Dismiss cookie banner before shots. Do not kill Claude RC / Concord / Unity.
4. Asset naming: continue numbering from highest existing `NN-` (currently through `26-meta-*`). Pattern `NN-<id>-current.png` + `NN-<id>-northstar-concept.jpg`.
5. Update `NORTHSTAR.md` tables + per-lens stubs and `STATUS.md` after each family batch (not after every single file if that slows you — but never leave assets undocumented at exit).
6. Do NOT cut over live FE/BE. Pack assets + docs only.
7. **NO human approval waits.** Mark completed pairs `packed` (ready for Claude / owner review later), not “awaiting approval”.
8. If you hit context/token/time limits: finish the in-flight lens pair, write `MISSION_REPORT.md` with **CONTINUE** + exact next lens id, update STATUS, mirror, exit cleanly. A resume mission will pick up from CONTINUE.

## Already done — do not redo
- Chat APPROVED: `01`/`02`
- Board kanban APPROVED: `03`/`04`
- Board absorbed packed: Goals, Calendar, Timeline, Study/SRS, Whiteboard (`05`–`14`)
- Graph parent + absorbed packed: Graph, Schema, Entity, Temporal, Eco, Meta (`15`–`26`)

Also flip any “awaiting approval” wording in STATUS/NORTHSTAR for those to **packed**.

## Run order (this mission — keep going)
### A. Code parent + absorbed
1. Code `/lenses/code`
2. Debug `/lenses/debug`
3. Database `/lenses/database`
4. Repos `/lenses/repos`

### B. Studio parent + absorbed
5. Studio `/lenses/studio`
6. Music `/lenses/music`
7. Art `/lenses/art`
8. Fractal `/lenses/fractal`
9. Game `/lenses/game`
10. Sim `/lenses/sim`
11. AR `/lenses/ar`
12. Podcast `/lenses/podcast`

### C. World
13. World `/lenses/world` (no absorbed)

### D. Destinations 19 (skip Whiteboard + Calendar — already packed)
Work: finance, accounting, healthcare, legal, projects, analytics, marketplace, trades  
Create: music (already in Studio — one pair is enough; don’t duplicate), creator, crypto  
Knowledge: research, lab, frontier, agents  
Comms: message (`/lenses/message`), social, council  

### E. If still going — Chat absorbed (Chat parent APPROVED does not cover these)
thread, forum, daily, council (if not done as destination), anon, voice, feed, news

Full ~238 inherit principles until specified — after Core remaining + Destinations + Chat absorbed, stop with PASS COMPLETE and do not grind all 238.

## Concept method
Prefer HTML/CSS mocks at 1280×720 (same family as prior batch). Capture currents ~1024×570 after cookie dismiss. Product notes for Claude go in MISSION_REPORT and short stubs in NORTHSTAR.

## Done when (PASS COMPLETE)
- Code + Studio (+ absorbed) + World + remaining Destinations each have current + concept on disk
- STATUS.md reflects packed / remaining
- NORTHSTAR.md tables updated
- MISSION_REPORT.md = PASS COMPLETE (or CONTINUE with next id)
- Pack mirrored to concord-web docs

When finished, exit cleanly.
