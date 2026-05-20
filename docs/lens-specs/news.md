# news — Feature Completeness Spec

Rival app(s): Apple News, Google News, Ground News (2026)
Sources:
- https://www.gdeltproject.org/ — GDELT Project global news index (free, no key)

## Features

### News substrate
- [x] Saved articles, topics + follows, reading list, source tracking
- [x] Coverage comparison, sentiment + bias signals, news calculators
- (29 macros)

### Live data & feed
- [x] Live news feed — GDELT global news articles ingested as DTUs (macro: news.feed)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Full-text licensed articles | publisher content licences | GDELT headlines + links; full text stays at source |

## Verification log
- 2026-05-20: `feed` macro present (GDELT → DTUs), registered at `domains/news.js:788`.
- 2026-05-20: `tests/news-domain-parity.test.js` green.
