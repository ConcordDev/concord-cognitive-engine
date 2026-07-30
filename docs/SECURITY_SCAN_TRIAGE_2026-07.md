# Security scan triage — 2026-07-27

An external scan (Aikido) produced ~40 findings. This file records the
**determinations**, so the same noise isn't re-triaged from scratch next
quarter, and so the fixes have a written rationale.

**2026-07-30 addendum:** after the scan's own findings were closed, a
follow-on sweep for the exact same "identity/tier read from the request body,
not verified against the authenticated caller" shape turned up several MORE
real instances the original scan never flagged, including a genuine
wallet-drain vulnerability across `/api/connective-tissue`. See the bottom of
the "Real, fixed" table and its own subsection below — this file now covers
both the original scan and this follow-on sweep.

Two rules governed the pass:

1. **Verify before fixing.** Several findings were wrong in one direction or
   the other, and two of the most serious problems were *not* in the report at
   all — they were found by opening the code a flagged item pointed at.
2. **Never fix by weakening a checker.** `scripts/autoloop/guard.mjs` protects
   the graders and detector baselines. Nothing here was resolved by
   re-baselining or loosening a rule.

---

## Real, fixed

| ID | Finding | Severity as found | Commit |
|----|---------|-------------------|--------|
| SEC-1 | **Authenticated RCE** in `domains/invariant.js` | Critical | `d54fd030` |
| SEC-2 | SSRF in `cooking.import-from-url` + `productivity.calendar-import-ics` | High | `296609be` |
| SEC-3 | Unguarded RBAC mutations | *Latent* (see below) | `be3b8033` |
| SEC-4 | Open redirect in the connector OAuth callback | High | `a58c22ac` |
| — | **Systemic SSRF**: `lib/external-fetch.js` (38 importers) | High | `48108fe1` |
| — | **SSRF** in `emergent/ingest-engine.js`, bypassable at any tier | High | `97fdc3d3` |
| — | Timing-unsafe secret comparison + `timingSafeEqual` throw-on-length | Medium | `2d11a73a` |
| — | Frontend document served without HSTS | Medium | `63fdf7d4` |
| — | `req.body?.tier` privilege read in `routes/operations.js` (ingest submit) | Low (impact already removed by the SSRF fix; wrong on its own terms) | `7ce35c5d` |
| — | IDOR on `/api/social/analytics/creator` + publish/unpublish (missing ownership) | Medium | `78c671e9` |
| — | Admin-gated DTU tier mutation + bulk-route IDOR in `helpers-extended.js` | High (arbitrary delete of another user's DTUs) | `f9a3c03a` |
| — | **Wallet-drain IDOR across `/api/connective-tissue`** (tip/bounty/claim/purchase) | Critical | `360a3a24` |
| — | Wallet-drain IDOR on `/api/artifacts/:id/purchase` (creative-marketplace) | High | `ec7b4bba` |
| — | Bounty escrow fee-drain (human-authorized `balances.js` edit) | Correctness/economy, not IDOR | `535e4817` |
| — | Frontend CSP — was entirely absent; now report-only with a real per-request nonce | Medium | `4f017e80` |

### SEC-1 was not in the report as an RCE

The scanner flagged `new Function` generically. Opening it showed
`validateExpressionAST` (an acorn allowlist) validated the *original*
expression while `new Function` compiled a **different** string — the output of
a regex pass that spliced resolved state values into the expression text via
`JSON.stringify`, which emits its own quotes. A value landing inside a string
literal broke out of it and became code.

Worth recording how it was confirmed: the first proof-of-concept asserted on
the expression's *return value* and read as "no bypass". The return value was
irrelevant — the payload had already executed. Only a **side-effect canary**
proved it. When testing for code execution, assert on the side effect.

### SEC-3 was over-stated in the report

Graded as live privilege escalation; it is not. `globalThis._assignRole` /
`_revokeRole` / `_getUserRole` / `_checkPermission` **do not exist anywhere in
the tree**, so those handlers optional-chain into no-ops, and
`STATE.rbacCustomRoles` is write-only — no authorization path reads it. A
self-authored `permissions: ["*"]` role granted nothing. Fixed anyway, because
wiring either helper later turns it into real privesc with no other change.

### SEC-4's "tokenKey leak" is not a leak

`resolveTokenKey` returns a *storage key name* (`"gmail"`, `"google"`, a
connector id), never a credential. The open redirect is the real issue.

### The two findings the scan missed entirely

- **`lib/external-fetch.js`** — imported by 38 files, documented as being for
  "free public APIs", used a bare `fetch()`. Two callers were live and
  **reflected** (response body returned to the caller):
  `import.fetchFromConnector` (`cfg.url` is `params.url` straight off the macro
  input) and `custom.bindingTest`. Fixed at the shared helper so all 38
  importers are covered.
- **`emergent/ingest-engine.js`** — guarded only by a *name* check, whose
  blocklist contains two `example.com` placeholders, and whose tier gate reads
  `req.body?.tier`. A caller could declare itself `sovereign` and skip every
  check. Fixed at the transport, so it holds for a spoofed tier.

### 2026-07-30 follow-on sweep — the same shape, found by grepping for it deliberately

After closing the scan's own list, `routes/operations.js`'s ingest-tier fix
prompted a targeted re-grep across `routes/` and `domains/` for the identical
pattern: an identity or privilege field read from `req.body` and trusted
without checking it against `req.user`. Three more real instances turned up,
none in the original scan:

- **`routes/helpers-extended.js`** — `POST /api/atlas/tiers/promote|demote/:dtuId`
  had `requireAuth()` only (no ownership, no admin check) and set
  `dtu.tier = req.body.tier || "verified"/"regular"` — a raw client override
  on a field the DTU-consolidation pipeline reads for regular/mega/hyper
  classification across dozens of files. `POST /api/dtus/bulk` had the same
  `requireAuth()`-only gate with **zero per-item ownership check** — any
  authenticated user could bulk-delete, bulk-retag, or bulk-promote up to 100
  of *any other user's* DTUs by id. Fixed: the atlas routes are now
  admin-gated and stopped accepting a body override (the endpoint name
  already declares the direction); `/api/dtus/bulk` gained a per-item
  ownership check reusing `dtu.delete`'s own field convention, plus an
  admin-only gate on `action: "promote"`. Confirmed dead from the real
  frontend (only the raw API client wrapper exists; the real bulk-ops UI
  calls an unrelated macro) — zero legitimate-usage impact. `f9a3c03a`.
- **`routes/connective-tissue.js`** — the most severe finding in this whole
  document, in either pass. Every money-moving route
  (`/tip`, `/bounties`, `/bounties/:id/claim`, `/dtu/purchase`) read the
  **funds-source identity** — `tipperId`, `posterId`, `claimerId`, `buyerId`
  — straight off the request body. `executeTransfer()` (`economy/transfer.js`)
  has no caller-identity check of its own by design, so nothing stood between
  an authenticated attacker and moving money out of an arbitrary victim's
  wallet: tip yourself using the victim's `tipperId`, escrow the victim's
  funds into a bounty only you can claim, or — worst of the four, since it
  needs no setup — copy any open bounty's id + its real `posterId` straight
  off the *public* `GET /bounties` listing and claim its full escrowed reward
  with an arbitrary `claimerId`, since `claimBounty()` never checked the
  claimer's identity or the submitted solution at all. Fixed with a shared
  `requireSelf(bodyField)` middleware requiring the claimed identity match
  `req.user.id`, deliberately permissive only when `req.user` is absent
  entirely (mirrors `dtu.delete`'s own `AUTH_MODE=public` exception — that
  deployment mode has exactly one real user). `360a3a24`.
  - **A second, unrelated, pre-existing bug was found while verifying this
    — now FIXED (`535e4817`)**: `postBounty`'s escrow-in transfer was typed
    `TRANSFER` (`FEES.TRANSFER = 0.0146`), so `__ESCROW__` only ever received
    `bounty.amount * (1 - 0.0146)`, while `claimBounty` tried to release the
    full original `bounty.amount` — every real bounty claim failed with
    `insufficient_balance`, independent of the identity fix above. Fixed via
    migration 399: new fee-exempt `BOUNTY_ESCROW`/`BOUNTY_CLAIM` ledger types,
    following the exact precedent of the existing `STAKE_ESCROW`/
    `STAKE_RETURN` types (both absent from `fees.js`'s `FEES` map). This
    required a **human-authorized** edit to `economy/balances.js` — one of
    the five money-invariant files `guard.mjs` requires explicit sign-off
    for — because `executeTransfer()`'s debit+credit-row split (the same
    shape `TRANSFER`/`MARKETPLACE_PURCHASE` use) needed the two new types
    added to `CREDIT_ROW_PREDICATE`'s exclusion list, or every bounty
    escrow/claim would have double-credited its recipient. See
    `tests/economy/ledger-conservation.test.js`'s bounty-specific cases.
- **`routes/creative-marketplace.js`** — `POST /api/artifacts/:id/purchase`
  had the identical `buyerId`-from-body shape as `/dtu/purchase` above (the
  router's own `authForWrites` middleware guarantees some session is valid
  on every non-GET request, but never checked it against `buyerId` before
  calling `purchaseArtifact()`, which debits `buyerId`'s wallet for real).
  Fixed with the same requireSelf-shaped inline check (fail-open only when
  `req.user` is absent). `world.js`'s `POST /businesses/:id/sale` was
  checked for the same pattern (`buyerId` from body) and is a confirmed
  false positive: `recordBusinessSale()` only increments an in-memory
  `revenue`/`customersServed` game-stat counter — no real economy transfer
  — and the route's positional call args don't even match the function's
  actual `(businessId, { amount })` signature (a separate, non-security,
  not-in-scope functional bug).

---

## The most important CI finding — also not in the report

**The Trivy container CVE gate had never scanned anything.**
`.github/workflows/platinum-security.yml` gated every step on
`if [ -f Dockerfile ]` at the repo root. No root `Dockerfile` has ever existed
(the real ones are `server/` and `concord-frontend/`), so the job emitted
`::notice::No Dockerfile at repo root` and passed green on every run — while
its own comment described that step as "the actual CVE gate".

A gate whose skip path is indistinguishable from a pass is worse than no gate,
because it is counted as coverage. Fixed in `1a326dc6`. **Expect its first real
run to be red**; that is the gate working, not a regression.

The same class was found twice more: `constant-time` was tagged into no
blocking consumer, and `secret-leak` ran only under `code-quality`. See
`9f5fd71d`.

---

## False positives — do NOT "fix" these

Each was checked against the code, not assumed.

| Finding | Determination |
|---------|---------------|
| GitHub Actions **script injection** | All 50 `${{ }}` expressions across 24 workflows enumerated; **none** reference `event.*.title/body`, `comment.body`, `review.body`, or `head_ref`. Likely trigger was `deploy.yml` `username: ${{ github.actor }}` — a registry username field, not a `run:` body. |
| **`immer`** prototype pollution (CVE-2021-23436) | Advisory targets `<9.0.6`. Every copy here is `10.2.0` / `11.1.4`. |
| **`@ungap/structured-clone`** deserialize RCE | Advisory targets `<1.0.1`; installed is `1.3.0`. |
| **GitHub org IP allowlist** not enabled | `ConcordDev` is a **User** account, not an Organization. IP allow lists are an Org/Enterprise feature — not applicable. |
| **Secrets in `k8s/secrets.yaml`** | One commit in the file's entire history. All credential values are `CHANGE_ME…` placeholders or empty strings. The scanner matched a tracked `kind: Secret` manifest with base64-looking values without decoding them. |
| **Secret in `SensorDashboard.tsx`** | The flagged fingerprint appears only in an untracked, gitignored `concord.db` and in audit-snapshot commits (detector `sha256(...)` fingerprints). The historical value was a mock display-only key — nothing to rotate. |
| **HSTS missing** | *Partially* false: the API (Helmet) and nginx both set it correctly. Real only for the Next.js document layer, now fixed. |
| **Godot binary fetch unverified** | Already exemplary — `godot-client.yml` asserts the pin exists *before* fetching, then SHA-512 verifies. This is the model the k6 fix copied. |
| **Rust `Command::arg` injection** | Only spawn site is `process_supervisor.rs`; all inputs come from operator env vars with hardcoded defaults, selected via a fixed `match`. No shell interpolation, no `sh -c`. |
| **k8s images on `:latest`** | Moot: `deploy.yml` follows every `kubectl apply` with `kubectl set image ...:${IMAGE_TAG}` using the commit short-SHA. Pinning the manifests would be cosmetic and could break a pull. |
| **Missing Gradle dependency locking** (`concord-jetbrains`) | Technically accurate, practically empty. `concord-jetbrains` is a 984-byte scaffold with no wrapper, no `settings.gradle`, no version catalog — and **no workflow builds it**; it is referenced only from docs and its own README, which calls it "a thin shell". Adding `dependencyLocking` to a module nothing builds produces configuration no one exercises and no lockfile (generating one needs a working Gradle build). Left alone deliberately. If it ever becomes a real, built, shipped plugin, locking should land *with* the wrapper and a CI build, not before them. |

**On the repo being public:** `ConcordDev/concord-cognitive-engine` is public
and has two third-party forks (`netzkontrast`, `5mhyjt8mk8-cyber`). History
rewriting therefore cannot un-expose anything. If a real secret is ever
committed, **rotation is the only remedy** — which is why `secret-leak` was
promoted into the blocking gate.

---

## Known-open, deliberately not closed here

- **The security detector gate is RED** on one pre-existing `authz-coverage`
  high: `/api/welding/portal/` in `WRITE_AUTH_PUBLIC_PATHS`. It is a reviewed,
  intentional, end-to-end-tested bypass that was never baselined. It predates
  this branch (present on `origin/main`). Clearing it requires a deliberate
  BASELINE refresh, which is human-authorized by design — not something to do
  as a side effect of a triage pass.
- **`next` 15→16** — major needing individual verification (full production
  build + `tsc --noEmit` + vitest run, not just a version bump). Still open.
  (`uuid` 9→14 is done — `0a3d70e3` bumped it after auditing every call site
  for the v3/v5/v6 signature changes; the line that used to list it here as
  open was stale.)

### `@xenova/transformers` — 4 flagged CVEs, and why an `overrides` entry is the wrong fix

This one subtree accounts for four flagged packages: `sharp` 0.32.6 and
`onnxruntime-{node,web,common}` 1.14.0. The obvious move is an npm `overrides`
entry forcing newer versions. **Don't** — the situation is worse and simpler
than that:

- `@xenova/transformers` is at **2.17.2, its final release**. The package was
  renamed; the maintained successor is `@huggingface/transformers` (now 4.2.0).
  It will therefore *never* ship a fix for its dependencies.
- It **pins `onnxruntime-web` to exactly `1.14.0`**. Forcing 1.2x under a
  package built against the 1.14 API risks silently breaking inference rather
  than failing loudly — trading a known CVE for an unknown correctness bug.

What it actually is, in this codebase (`server.js:17265`): an **optional
dependency**, used only as the **CPU fallback** for embeddings when the Ollama
embedding backend fails, imported as
`await import("@xenova/transformers").catch(() => ({}))` and degrading to an
honest `{ ok:false, reason:"package_not_installed" }`. The deployed box uses
Ollama for embeddings (`CONCORD_EMBED_OLLAMA_URL`), so this path is not the
production one.

**Recommended fix, in order:** migrate the single call site to
`@huggingface/transformers` (same `pipeline("feature-extraction", ...)` API
family), which drops the whole stale subtree at once. Failing that, drop the
optional dependency entirely — the fallback already degrades honestly without
it.

**Not executed here** deliberately: swapping an ML runtime cannot be verified
in this environment (no model downloads, no egress), and an unverified swap of
an inference backend is a worse outcome than a documented one. The exposure
while it waits is bounded — an optional package on a non-default code path.
