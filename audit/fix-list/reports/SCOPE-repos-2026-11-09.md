# Repos scope check (read-only code) — 2026-11-09

Source: `/workspace/webdb-audit/server/domains/repos.js` (+ adjacent `server/domains/github.js` OAuth connector, `concord-frontend/app/lenses/repos/page.tsx`, `components/repos/ConcordRepoWorkspace.tsx`, `components/repos/TrendingRepos.tsx`, `components/repos-explorer/RepoBrowser.tsx`). Tip assumed same mega deploy as prior SCOPE reports (`dae9e10a6`). **No files/DB/services modified.** Code-only; not live-proven.

Requested as READ-ONLY code scope check for Lens Tester 3 after claiming `repos` (criteria/repos.md). Creates held until this answer — especially whether writes are per-user and deletable, whether they touch real GitHub / external git / OAuth, run code/CI/agents, use GPU or paid compute, emit DTUs (`_lensEmitDTU`, FIX-xl-ws-001), or make anything public/shared.

**Slug confirmed:** `repos` (route `/lenses/repos`; domain macros `repos.*`). Adjacent but separate: `github` domain (`server/domains/github.js`) — real OAuth connector with outbound writes. The Repos lens **Explore** tab uses **public** GitHub API macros on the `repos` domain (no user OAuth). Do not treat `github.*` connector writes as in-scope for this lens's default UI, but they are **BLOCKED** if reached.

## Model — dual plane: per-user virtual Concord host + public GitHub reads

| Layer | UI | API path | Storage |
|-------|-----|----------|---------|
| **Your repos (workspace)** | `page.tsx` view `workspace` → `ConcordRepoWorkspace.tsx` | `lensRun('repos', 'repo-create'\|'repo-list'\|'repo-delete'\|'file-*'\|'branch-*'\|'tag-*'\|'issue-*'\|'pull-*'\|'workflow-*'\|'security-scan'\|'repo-insights'\|…)` → `domains/repos.js` ~1228–2325 | Per-user `globalThis._concordSTATE.reposLens.repos` Map (`userId → [repo]`) — key `reposLens` is in `LENS_STATE_KEYS` (`lens-state-persistence.js:208`) |
| **Explore GitHub** | view `explore` → `RepoBrowser.tsx` + `TrendingRepos.tsx` | `repos.github-commits-recent` / `github-issues` / `github-languages` / `github-trending` / `github-topic-search` / `github-repo-meta` / `github-gists-public` / `github-advisories` | **Read-only** public `api.github.com` (+ OSV.dev for security-scan deps). Optional server `GITHUB_TOKEN` env raises rate limit — **not** the signed-in user's OAuth |
| **Analytics (artifact-shaped)** | Not primary workspace chrome; domain macros exist | `codeComplexity` / `commitAnalysis` / `dependencyAudit` | Operate on passed artifact/params modules — local AST / OSV; no GPU |
| **Adjacent `github` connector (NOT this lens's default tab)** | No Connect button found on `/lenses/repos` page | `github.connect` / `github.issue-create` / `github.file-commit` / `github.branch-create` / … | Real user OAuth token under connector_id `"github"` — **real GitHub writes** |

### Shared runtime facts

- Domain registers via `guardAnonWrites` (`repos.js:132`). Actor helper: `rpUid(ctx) = ctx?.actor?.userId \|\| ctx?.userId \|\| "anon"` (`:864`).
- Virtual workspace is **owner-scoped** — `repo-list` / `rpFindRepo` only see `s.repos.get(rpUid(ctx))` (`:1248–1258,881–882`). Other users cannot list or mutate another account's Concord repos via these macros.
- UI discloses honesty: *"no git remote, nothing to clone, nothing to push"* (`ConcordRepoWorkspace.tsx:209`). Virtual PRs/commits/branches are in-process substrate only.
- `repos` is **NOT** in `LENS_SOCIAL_DOMAINS` (`server.js:49775`).
- `repos` is **NOT** in `FRONTEND_ARTIFACT_TYPES` (no `repos` entry in `lens-artifact-types.js`) — workspace CRUD does **not** go through generic `lens.create`.
- **FIX-xl-ws-001 / `_lensEmitDTU`:** domain-level `POST /api/lens/run` lens_action path used by the workspace **does not** call `_lensEmitDTU` (unlike artifact-scoped `lens.run` at `server.js:50262`). Workspace writes hit `reposLens` + `rpSave()` only. **Prefer skip:** header `DTUExportButton`, Explore `SaveAsDtuButton`s (Trending + RepoBrowser) — generic DTU mint class.
- `isPrivate` defaults **`false`** on seed (`repos.js:907`) but visibility is still **per-user Map** — cosmetic flag inside the virtual host, **not** a shared/public catalog.
- Caps / guards: commit content ≤200000 chars (`:1339`); workflowRuns retained last 50 (`:2155`); duplicate repo name rejected (`:1236–1238`); `repo-delete` requires exact `confirmName` (`:1558–1559`).

## Hotkeys (RCA-form-hotkey-steal)

From `app/lenses/repos/page.tsx:40–52` via `useLensCommand`:

| Key | Action |
|-----|--------|
| `w` | Your repos view |
| `e` | Explore GitHub view |
| `n` | **New repository** (focus `#repo-new-name`) |

**RC1: YES — bare-letter `w` / `e` / `n`.** Commands do not set `global`. `useLensCommand` skips INPUT / TEXTAREA / SELECT / `contentEditable` unless `global` — guard *should* hold while typing repo/file/commit fields; still RCA-class if the guard fails (same family as Classroom / Entity).

**RC2: NO** in repos page + `components/repos*` + `repos-explorer` — no `role="button"` modal backdrop pattern found.

**Delete confirm:** `repo-delete` requires typing the exact repo name (server + UI). Other destructive actions (file-delete, branch-delete, issue close, PR close) are UI one-click / state toggles without `window.confirm` in the workspace file set — prefer careful QA naming + `repo-delete` cleanup of the whole fixture.

## Answers to the policy questions

### Per-user vs shared / public?

| Surface | Scope | Shared with other users / public? |
|---------|-------|-----------------------------------|
| **Virtual repo + files/branches/commits/issues/PRs/CI runs/security alerts** | Per creating account (`reposLens.repos` keyed by userId) | **No** — other accounts cannot read via `repo-list` |
| **Explore GitHub reads** | Public upstream | Read-only public data; no Concord publish |
| **`github.*` connector writes** | Caller's linked GitHub account | **Yes — real external GitHub** (issues, commits, branches on real repos) |

### Real GitHub / external git / OAuth?

| Path | Touches real GitHub / git / OAuth? |
|------|-------------------------------------|
| Workspace `repo-create` / commit / branch / PR / merge / issues | **No** — virtual substrate only |
| Explore `github-commits-recent` / `github-issues` / `github-languages` / trending / topic-search / advisories | **Read-only** public API (optional server `GITHUB_TOKEN` for rate limit — not user OAuth) |
| `github.connect` / `github.file-commit` / `github.issue-create` / `github.branch-create` | **Yes — BLOCKED** (real OAuth + outbound writes). Not wired on the default Repos lens chrome reviewed here |

### Code execution / CI / agents / GPU / paid?

| Path | Notes | Verdict |
|------|-------|---------|
| `workflow-run` | Runs local checks including `new vm.Script(...)` over JS file contents (`repos.js:2114`) — **in-process code parse/exec shaped** | **BLOCKED-by-policy** (code execution) |
| `security-scan` | Regex rules + **OSV.dev** public vulnerability lookup | SAFE_READ / OK on own QA repo (no GPU/paid Concord AI) |
| `codeComplexity` / `commitAnalysis` / `dependencyAudit` | Local AST / math / OSV | SAFE on own data; no GPU |
| Agents / GPU / billing / Workers AI / Ollama | **None** found on `repos` workspace macros | — |
| Standing rule | Stop if any cost UI appears on LensShell Ask | — |

### `_lensEmitDTU` (FIX-xl-ws-001)?

**No** on workspace `repo-*` / `file-*` / `pull-*` / `issue-*` domain macros via `/api/lens/run`. **Prefer skip** `DTUExportButton` / `SaveAsDtuButton` (Explore).

## Verdict table — repos actions (user-visible)

| Action | Bucket | Delete / reverse | Side effects | Verdict |
|--------|--------|------------------|--------------|---------|
| **repo-list / file-tree / file-read / branch-list / commit-graph / commit-detail / issue-list / issue-detail / pull-list / pull-detail / workflow-runs / workflow-logs / repo-insights** (own) | read | n/a | Owner-scoped | **SAFE_READ** |
| **github-commits-recent / github-issues / github-languages / github-trending / github-topic-search / github-repo-meta / github-gists-public / github-advisories** | read public | n/a | Public GitHub / advisory feeds | **SAFE_READ** |
| **repo-create** (name `QA LT3 repos 2026-11-09 …`) | **(a) SAFE private** | **Yes** `repo-delete` + confirmName | Per-user Map; seeds starter tree; **no** `_lensEmitDTU`; **no** real git remote | **SAFE_PRIVATE_DELETABLE** |
| **file-save / file-delete / branch-create / branch-delete / tag-create / tag-delete** (own QA repo) | **(a)** | Yes (or whole-repo delete) | Virtual commits only | **SAFE_PRIVATE** (own QA repo only) |
| **issue-create / issue-comment / issue-set-state** (own) | **(a)** | Close / whole-repo delete | Virtual issues | **SAFE_PRIVATE** |
| **pull-create / pull-review / pull-comment / pull-link-issue / pull-set-state / pull-merge** (own) | **(a)** | Close / merge / whole-repo delete | Virtual PRs inside owner Map | **SAFE_PRIVATE** |
| **repo-update** (description / isPrivate flag) | **(a)** | delete repo | Flag is cosmetic inside private Map | **SAFE_PRIVATE** |
| **repo-delete** | **(e)** cleanup | n/a | Requires exact name confirm | **OK as cleanup** |
| **security-scan / repo-insights** (own) | read/derive + persist alerts on own repo | n/a | OSV + local rules; writes `securityAlerts` on own repo | **SAFE** on own QA repo |
| **workflow-run** | **(c) code-exec shaped** | n/a | `vm.Script` over repo JS | **BLOCKED-by-policy** |
| **codeComplexity / commitAnalysis / dependencyAudit** | analytic | n/a | Local / OSV | Prefer only on own QA / pasted fixtures; no paid GPU |
| **SaveAsDtu / DTUExport / LensShell Mint-Publish** | DTU mint | library delete if available | FIX-xl-ws-001 class | **Prefer skip** |
| **`github.connect` / `github.issue-create` / `github.file-commit` / `github.branch-create`** (adjacent domain) | **(d) real GitHub** | n/a | OAuth + outbound mutation | **BLOCKED-by-policy** |
| Real clone / push / webhook / fork-on-GitHub / star-on-GitHub | — | — | **No** such macros on the virtual `repos` workspace. Explore only *reads* public star/fork *counts* | **N/A / BLOCKED** if any future chrome appears |

### Paid / GPU / credits

- **No** billing hooks, credit burns, fine-tunes, or GPU jobs on workspace CRUD or Explore public reads.
- OSV.dev + public GitHub API = free upstream (rate-limited).
- `workflow-run` is blocked for **code execution**, not because it bills.
- Stop if any cost UI appears on adjacent Ask.

## Private AND deletable (qualify for a single QA write)

| Qualify | Notes |
|---------|-------|
| **repo-create → (optional file/branch/issue/PR edits) → repo-delete** | Name `QA LT3 repos 2026-11-09 <thing>`. Delete requires typing the exact name. **Preferred.** |
| **file-save / branch-create / issue-create / pull-create** on that QA repo | Keep all activity inside the one labelled fixture; clean up with **repo-delete**. |
| **Explore Load / Trending** | Read-only OK. Do **not** SaveAsDtu. |
| **security-scan / repo-insights** on own QA repo | OK reads. |

**Delete path exists** (`repo-delete` with confirmName) → virtual creates are **not** KEEP_BLOCKED for cleanup reasons — **unless** you cannot complete confirmName (then leftover; try again with exact name).

## Keep BLOCKED / do not write

1. **`workflow-run` / Run checks** — `vm.Script` code-execution path (`repos.js:2114`).
2. **Any `github.*` connector write** — `connect`, `issue-create`, `file-commit`, `branch-create` (`github.js`) — real OAuth / real GitHub mutation.
3. **SaveAsDtu** on Explore / Trending; header **DTUExport**; LensShell Publish/share / Mint — prefer skip (FIX-xl-ws-001 / standing rules).
4. **Do not** attempt real clone, push, webhook install, or starring/forking on github.com from this lens.
5. Agents, paid Ask, GPU, payments, emails, SMS — standing rules.
6. Do **not** open or mutate another user's Concord repos (none should appear in Your repos; if foreign rows appear, treat as read-only noise).

## Validation / form test hints

- **repo-create:** `name` required (`repos.js:1231–1232`); duplicate name → `duplicate_name` (`:1236–1238`); description ≤280; language ≤40.
- **file-save:** path required; empty commit message (when provided) → `commit_message_required`; empty content needs `confirmEmpty:true`; unchanged content → `no_changes`.
- **repo-delete:** `confirmName` must equal `repo.name` exactly (`:1558–1559`).
- **pull-create / branch-create:** exercise only inside own QA repo; merge stays virtual.
- **RC1:** typing new repo name / file path / commit message / Explore owner-repo — watch bare **`n` / `w` / `e`**.
- **RC2:** not present.
- Persistence: create repo → hard reload → still in `repo-list`; delete with confirm → gone.
- Mobile 390×844: view pills + fixed **New repo** FAB (`page.tsx:130–138`) — expect FAB/nav crowding (same class as Classroom/Foundry).

## Gaps / notes

- Two product stories under one URL: **Your repos** (private virtual host) vs **Explore GitHub** (public reads). Testers should not confuse Explore Load with importing a real remote.
- Adjacent `github` connector domain can perform **real** writes if invoked — not on the default Repos page chrome reviewed, but treat any "Connect GitHub" CTA as BLOCKED.
- `isPrivate: false` default is cosmetic; do not read it as "published to other Concord users."
- Live not proven: whether production `GITHUB_TOKEN` is set; whether QA account already has `reposLens` fixtures; whether `CONCORD_GITHUB_ENABLED` exposes connector elsewhere in the shell.

## Summary for tester

**OK for one QA call + delete** (name `QA LT3 repos 2026-11-09 …`):
- **Preferred:** Your repos → **New repo** (`repo-create`) → optional file edit / branch / virtual issue or PR → hard reload → **repo-delete** (type exact name).
- Also OK: Explore **Load** / Trending **reads** (no SaveAsDtu); `security-scan` / `repo-insights` on the QA repo.

**Virtual Concord repos are per-user and deletable.** They do **not** touch real GitHub remotes. Explore is public read-only. **`_lensEmitDTU` does not fire** on workspace creates.

**BLOCKED-by-policy:** `workflow-run` (vm code exec); `github.*` OAuth/writes; SaveAsDtu/Export mint (prefer); real push/clone/webhook/star/fork.

**No paid/GPU on workspace CRUD.** **Delete path exists** → creates allowed (not KEEP_BLOCKED for cleanup).

**RC1 bare-letter `w` + `e` + `n`.** **RC2 not present.**

Code-only verdict; not live-proven.
