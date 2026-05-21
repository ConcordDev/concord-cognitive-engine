# repos — Feature Gap vs GitHub

Category leader (2026): GitHub (code hosting + collaboration). Content fills via free public APIs + user uploads by design — this scores FEATURE parity, not content volume.
Backend: `server/domains/repos.js` — 6 macros (codeComplexity, commitAnalysis, dependencyAudit, github-commits-recent, github-issues, github-languages) hitting the real GitHub public API.

## Has (verified in code)
- 9 tabs: code, issues, pulls, actions, projects, wiki, security, insights, settings
- Real GitHub API integration: recent commits, issues, language breakdown
- Code complexity analysis, commit analysis, dependency audit macros
- Repository browser with tabbed GitHub-shape navigation

## Missing — buildable feature backlog
- [ ] `[L]` File tree + code viewer with syntax highlighting — browse repo contents
- [ ] `[M]` Pull request detail — diff view, review comments, merge
- [ ] `[M]` Issue detail + create/comment — full issue lifecycle, not just a list
- [ ] `[M]` Actions / CI run logs — view workflow runs and their output
- [ ] `[S]` Branch + tag management, commit history graph
- [ ] `[S]` Security tab — Dependabot alerts, code scanning results
- [ ] `[S]` Repo insights — contributor graphs, traffic, commit activity charts

## Parity
~30% of GitHub's feature surface. Real GitHub API calls and a 9-tab GitHub-shape shell are a good frame, but most tabs are read-only summaries — it lacks a code viewer, PR diff/review, and full issue lifecycle, the daily-driver features of GitHub.
