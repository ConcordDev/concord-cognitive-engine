# Implement status

Updated: 2026-10-02 (Grok, inquiry shelf)

## Done
- Code family — `37abce766`. Buffer, one issue list, one query, real repos.
- Studio family + world place chip — `02b72403c`. Arrangement and one job per studio lens. World glass is Flower Law · Hub, no greeting over the Unity view.
- Graph absorbed — `dc60f50e1`.
- Work destinations — `f14b577b8`.
- Create destinations — `aabf2d7b4`.
- Threads, Forum, Daily — `bd1ed353f`.
- Anonymous, Voice, Feed, News — `2e3a11bc7`.
- Library shelf — `781b92469`.
- Room shelf — `c5cc31cf7`.
- Inquiry shelf — `dfd2ad06e`.
  - Answers: `answers.question-list`. "The thread is empty." only after the list answers. `Ask` reveals title and detail and calls `question-ask` only when the title is at least 8 characters and the body at least 15. Opening a row calls `question-detail`.
  - CRI: no call until `Open the index`, then `cri.scoreRules-get`. Dimension names and numeric weights only.
  - History: no call until `Open a record`, then `history.timeline-list`. Empty shelf says "No record to open." A row calls `timeline-detail` and shows returned events.
  - Linguistics: `Open a text` reveals an utterance and calls `linguistics.analyze` only after text. The reading is the server's `content`.
  - Codex: no call until `Open a page`, then `lore.list`. A title calls `lore.get` and shows title, era, and description.
  - Philosophy: `Begin` calls `philosophy.channel-list`. `channel-create` runs only after a title.

## Commits
- `37abce766` Code lens north star: buffer, one issue list, one query, real repos
- `02b72403c` Studio lens north star: arrangement, one job per studio lens, world place chip
- `dc60f50e1` Graph family north star: schema, entities, one series, one air reading, inventory
- `f14b577b8` Work lenses north star: one book, one statement, one chart, one job
- `aabf2d7b4` Create family north star: one piece, one wallet, one paper, one beam
- `bd1ed353f` Chat family north star: one thread, one board, today's page
- `2e3a11bc7` Chat absorbed north star: sealed post, booth, ranked feed, headlines
- `781b92469` Library north star: one shelf, one reading, one document
- `c5cc31cf7` Room north star: one class, one series, today's list
- `dfd2ad06e` Inquiry north star: one question, one index, one record

## Next
`/lenses/crafting` — concept `134-crafting-northstar-concept.jpg`. Greeting "The piece on the bench, Ramaj". CTA `+ Start a piece`. Then Photos, Narrative trail, Gallery, Maker, TheVault.

## Checks this batch
- `cd concord-frontend && npx vitest run tests/inquiry-northstar.test.tsx` — 7 passed.
- eslint on the six pages, six star components, and the test — 0 errors.
- No browser session. localhost was not exercised.
