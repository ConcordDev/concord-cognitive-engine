# Mission: Concord lens north-star — REMAINING ~188 lenses

You are Grok on Ramaj’s Mac. Owner (2026-10-02): finish **every remaining** lens with current + concept. **No approval gates.** Owner reviews the pack later. Save Grok Bot usage by doing this here.

## Canonical pack
`~/.zuko/lens-northstar/`
Mirror: `/Users/dutch/concord vs code/concord-web/docs/lens-northstar/`

Read: `NORTHSTAR.md`, `STATUS.md`, `LENSES.md`, approved Chat/Board (`02`, `04`), prior HTML/CSS mock method from packed `27+`.

## Remaining list (authoritative)
`missions/REMAINING_LENSES.txt` — one route slug per line (under `/lenses/<slug>`).
Skip any slug that already has both `*-<slug>-current.png` and `*-<slug>-northstar-concept.jpg` on disk (idempotent resume).

## Rules
1. Claude-clean family: deep black, thin icon rail, serif greeting, rare teal/purple, ONE CTA. No cockpit chrome.
2. Continue numbering from highest existing NN (currently through `100`). Pattern `NN-<slug>-current.png` + `NN-<slug>-northstar-concept.jpg` (slug matches the remaining list; use hyphens).
3. Currents: `http://localhost:3000/lenses/<slug>` preferred (signed-in `claude_design`); else https://concord-os.org. Dismiss cookie banner. ~1024×570.
4. Concepts: HTML/CSS mocks 1280×720 (exact type > image-gen). Same family as packed Code/Studio.
5. Do NOT kill Concord / Claude RC / Unity. Do NOT cut over live FE/BE.
6. Disk is tight (~6 Gi free) — keep assets lean; do not dump huge intermediates; delete temp HTML after rasterizing.
7. Work in **batches of ~20–25 lenses**. After each batch: update STATUS.md (count packed / remaining), append to NORTHSTAR.md a compact table row block, rewrite MISSION_REPORT.md with CONTINUE + next slug, mirror to concord-web docs, then **keep going** in the same session if tokens allow.
8. If context/token limit: finish the in-flight pair, write CONTINUE with exact next slug from REMAINING_LENSES.txt, exit cleanly so resume relaunches.
9. When REMAINING_LENSES.txt is empty (every slug has a pair) OR every listed slug is packed: MISSION_REPORT = **PASS COMPLETE ALL**, STATUS says remaining 0, exit.

## Helper
At start, regenerate remaining by comparing LENSES.md routes to `*-current.png` filenames and overwrite `missions/REMAINING_LENSES.txt` so resumes stay accurate.

## Product notes
- Do not invent live data (prices, patients, headlines, repos). Empty-state CTA only.
- Hide NaN / fake quorum / loading forever — same notes as prior MISSION_REPORT.
- Shared kill list on currents for Claude notes: app sidebar clutter, brain dots, wallet, Ask-about, Agent FAB, Install banner, right strip — concepts strip these.

When finished, exit cleanly.
