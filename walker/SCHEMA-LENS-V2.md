# Lens record schema v2 (MST-W0-01)

`lens-<slug>.json` keeps every v1 key, so v1 readers keep working. It adds the keys below.

Use `concord_walker.lensrecord.load_lens_record()` to load a record:

- It reads both v1 and v2.
- A v1 record comes back with `schema_version: 1`, `v1: true` and `deploy.sha_status: "missing"`.

| key | meaning |
|---|---|
| `schema_version` | `2` |
| `deploy` | `backend_sha` (from `/health` buildSha; must be hex), `frontend_build_id`, `walker_sha`, `walker_dirty`, `base_url`, `checked_at` (ET), `walked_at` (ISO with offset), `sha_status` (see below), `sha_note` |
| `findings[]` | `id`, `signature` (root-cause signature), `check`, `severity`, `area`, `title`, `evidence[]`, `filed` (new / dup / candidate), `build_sha`, `walked_at` |
| `screenshots[]` | `{path, kind}`. `kind` is one of `initial`, `open`, `after_escape`, `m390`, `mid_task`, `failure` |
| `controls[]` | `control_id` (`phase:role:slug`), `sid` (stable id), `phase`, `role`, `name`, `exercised`, `reason`, `effect`, `no_call`, `requests[]`, `lens_actions[]`, `console_errors`, `http_4xx[]`, `http_5xx[]`, `overflow`, plus `errors{}`, `error_samples`, `slow_calls`, `long_tasks`, `max_long_task_ms`, `freeze_ms`, `readback`, `broken[]`, `build_sha`, `walked_at` |
| `requests[]` | `method`, `path` (templated `:n :uuid :hex :id :long`; the query string is reduced to sorted keys), `status` or `error`, `n`, `ms`, `type`, `write`, `initiator`, `req_bytes`, `resp_bytes`, `req_keys` / `resp_keys` (type tags only, never values), `flags` (whitelist), `lens_action` |
| `endpoints[]` | aggregated per method and path: `statuses{}`, `n`, `write`, `max_ms`, `controls[]`, stamp |
| `actions[]` | lens actions observed on `POST /api/lens/run`: `{domain, action, statuses, controls}` |
| `net` | `requests_seen`, `requests_kept`, `overflow`, `controls_overflow`, `static_assets`, `third_party_hosts` (counts) |
| `premap_findings[]` | `class`: `fake_success`, `ownership`, `js_error`, `asset_fail`, `http_5xx`, `http_4xx`, `request_failed`, `slow_call`, `freeze`; plus `control_id`, `sid`, `title`, `evidence[]` (≤ 1 failure screenshot), stamp |
| `two_account` | present only with `--two-account`: `status` (`PASS`, `FAIL`, `NA`, `SKIPPED` or `ERROR`), `replayed`, `ownership_failures`, `calls[]` (method, templated path, status, verdict; never ids or bodies). Ownership rows also go to `premap_findings` |

**`sha_status` values**

- `ok`: the sha is hex and matches `--expect-sha` when one is given.
- `missing`: `/health` gave no hex sha.
- `mismatch`: the sha differs from `--expect-sha`.
- `drift`: the live sha changed during the run.

**Build stamp rule.** Every control, endpoint, finding and premap row carries `build_sha` (12 characters) and `walked_at`.

- A missing or mismatched sha is flagged. It is never treated as current.
- `lensrecord.build_verdict(repo, deploy, fix_sha)` gives the one line that reverify and the packer print: "ran against build X, which CONTAINS / does NOT contain fix commit Y". The answer comes from `git merge-base --is-ancestor`. Without a repo, or on any git doubt, the answer is `UNKNOWN`.

**Stable control id.** `sid = "c_" + sha1(role | norm_name | a11y container path)[:12]`.

- `norm_name` collapses whitespace, lowercases, and replaces digits with `#`.
- The id survives reordering, whitespace changes and changing counters.

**`walk-manifest.json`** (one per run dir) holds:

- `run_id`, `total`, `resumes`, `status` (`running`, `done` or `aborted`)
- `lenses[]`, each with `slug`, `status` (`walked` or `aborted`), `reason`, `build_sha`, `walked_at`, `sha_status` and `checks_not_run`

`--resume <run>` skips the slugs already walked.

**Redaction.** Records never store request or response bodies, field values, header values, cookies or query values.
