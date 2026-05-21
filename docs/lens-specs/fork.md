# fork — Feature Gap vs GitHub (fork network / insights)

Category leader (2026): GitHub fork-network + repo insights. Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `fork` domain — divergenceAnalysis, mergeComplexity, forkHealth, live `github-forks` / `github-repo` (GitHub public API), watch-list CRUD + refresh + dashboard, feed; ForkNetworkExplorer + RepoWatchlist components.

## Has (verified in code)
- Fork network explorer with tree/list view, status filter (active/merged/abandoned), depth tracking
- Divergence analysis between a fork and its parent
- Merge-complexity estimation; fork-health scoring
- Live GitHub fork-network + repo-metadata fetch via public API
- Repo watchlist (add/remove/refresh) with a watch dashboard

## Missing — buildable feature backlog
- [ ] `[M]` Commit-level ahead/behind comparison view (diff stats per fork)
- [ ] `[S]` Pull-request status overlay on the fork network
- [ ] `[M]` Network graph visualization (commits-over-time across forks, like GitHub's network graph)
- [ ] `[S]` Contributor activity / stale-fork detection alerts
- [ ] `[S]` Release / tag tracking on watched repos
- [ ] `[M]` Cross-fork file-level diff browser

## Parity
~55% of GitHub's fork-network surface. Live GitHub data, divergence/health analysis, and a watchlist are solid, but it lacks the commit-graph visualization, PR overlay, and file-level diff browsing that make GitHub's fork tooling actionable.
