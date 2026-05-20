# education — Feature Completeness Spec

Rival app(s): Coursera, Khan Academy, Duolingo, Anki (2026)
Sources:
- https://opentdb.com/api_config.php — Open Trivia Database (free, no key)

## Features

### Learning substrate
- [x] Courses, enrollments, lesson player, lesson notes
- [x] Flashcard decks + spaced-repetition cards, skill tree, certificates
- [x] Assignments board, course discussions, education dashboard
- (44 macros)

### Live data & feed
- [x] Live quiz feed — Open Trivia DB questions ingested as study-question DTUs (macro: education.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Accredited course catalog | partnerships with universities | authored courses + the lattice corpus |
| Live video classrooms | a WebRTC media server | the `voice` lens carries real-time audio |

## Verification log
- 2026-05-20: Backend — `node --check` clean. `feed` macro added (Open Trivia DB → DTUs).
- 2026-05-20: Tests — `tests/lens-feeds-domain-parity.test.js` education feed green; `tests/education-domain-parity.test.js` intact.
- 2026-05-20: Frontend — `LensFeedButton domain="education"` mounted in the lens page.
