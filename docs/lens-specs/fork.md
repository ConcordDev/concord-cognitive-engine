# fork — Feature Completeness Spec

Rival app(s): GitHub, GitHub mobile, Octobox, Sourcegraph (2026)
Sources:
- https://api.github.com/ (public repo + events data — live)
- repository fork-network / divergence analysis

## Features

### Repo-watchlist management
- [x] Watch repos — owner/repo, reason (upstream / fork / competitor / dependency) (macro: fork.watch-add)
- [x] List watched repos (macro: fork.watch-list)
- [x] Delete a watched repo (macro: fork.watch-delete)
- [x] Refresh live stats — stars, forks, open issues, last push (macro: fork.watch-refresh)
- [x] Watchlist dashboard — repos, total stars, refreshed, by-reason (macro: fork.watch-dashboard)

### Live data & analysis
- [x] GitHub repo events feed — pushes / PRs / issues ingested as DTUs (macro: fork.feed)
- [x] Fork-network explorer + divergence / merge-complexity / fork-health (macro: fork.github-forks / divergenceAnalysis / mergeComplexity / forkHealth)

## Boundary register
| Feature | Dependency | Substitute built |
|---|---|---|
| Authenticated GitHub API (private repos, higher rate limits) | a GitHub OAuth token | unauthenticated public API; per-user BYO token is a future enhancement |

## Verification log
- 2026-05-20: Backend — `node --check server/domains/fork.js` clean.
  Watchlist substrate (5 macros) + GitHub events `feed` macro appended to
  the fork-network domain.
- 2026-05-20: Tests — `tests/fork-watchlist-domain-parity.test.js` 5/5 green
  (watch CRUD + per-user scope + URL normalisation + duplicate guard /
  dashboard by-reason aggregation / events feed → DTUs + dedup on re-run).
- 2026-05-20: Frontend — new `RepoWatchlist` (watched-repo list with live
  refresh + GitHub events feed puller + dashboard) mounted in the fork lens
  page. `npx tsc --noEmit` exit 0.
