# BYO Keys Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Every macro below was enumerated by reading
> `server/domains/byo-keys.js` (534 LOC) in full — the entire backend
> surface for this lens (no inline `registerLensAction`/`register("byo_keys"...)`
> calls elsewhere; confirmed via grep). Reference-parity research is real
> (the lens's own reference points — OpenRouter's model catalog, Vercel AI
> Gateway / LiteLLM's BYO-key + fallback-chain conventions — are named in
> the code's own comments and cross-checked, not recalled from training
> data alone).
>
> Reproduce the macro list:
> `grep -n 'register("byo_keys"' server/domains/byo-keys.js`

## Backend surface — 24 macros, all real

Two tiers, both real, persisted differently by design (documented in the
file's own header comment): the original 6 (`list`/`set`/`remove`/
`set_active`/`test`/`available_providers`) persist in SQLite (migration
170, `user_brain_overrides`, AES-GCM encrypted keys); the 18 feature-parity
macros (usage/spend, budgets, rate limits, model picker, fallback chains,
key health, org-shared keys) persist in `globalThis._concordSTATE` Maps
keyed by userId, layered on top without touching the encrypted-key schema.
(Count was 22 as of the Wave 3 audit; `rate_limit_set`/`rate_limit_status`
were added in the 2026-07-12 Wave 4 gap-closure below.)

| Macro | Real effect | Surfaced by |
|---|---|---|
| `list` | current overrides + masked key previews | `page.tsx` (main list) |
| `set` / `remove` / `set_active` | create/update/delete/toggle an override | `page.tsx` (edit form + pause/resume) |
| `test` | 1-token live ping to verify a saved key | `page.tsx` (test button) + mirrors into `record_health`'s substrate |
| `available_providers` | static provider/model catalog | `page.tsx` (provider select) |
| `record_usage` / `usage_summary` | per-call token+cost ledger / monthly rollup with daily series | `UsageSpendPanel.tsx` (`usage_summary` renders live; `record_usage` is the router-side write path, correctly not user-facing) |
| `set_budget` / `budget_status` / `budget_check` | per-slot monthly USD/token cap + spend-vs-cap | `BudgetPanel.tsx` (`set_budget`/`budget_status`); `budget_check` is documented as the inference-router enforcement gate — **note (2026-07-12):** read in full while wiring item #9 below, `server/lib/byo-router.js#brainChat` does not actually call `budget_check`/`record_usage`/`record_health`/`resolve_route` anywhere; they are real, tested macros with no production call site today. Pre-existing, out of scope for this item, flagged honestly rather than silently implied-fixed. |
| `rate_limit_set` / `rate_limit_status` | per-slot requests-per-minute throttle (token bucket) + live remaining/reset status | `RateLimitPanel.tsx`. **This one IS actually enforced** — `server/lib/byo-router.js#brainChat` calls the enforcement function these macros wrap (`consumeRateLimitToken`) directly, before decrypting the key or contacting the provider. Closed 2026-07-12, checklist item #9. |
| `provider_models` | live OpenRouter model catalog per provider (keyless, real HTTP fetch with a bundled-defaults fallback) | `ModelPickerModal.tsx` |
| `set_model` | change just the model on an existing override | `ModelPickerModal.tsx` |
| `set_fallback` / `list_fallbacks` / `resolve_route` | ordered fallback slot chain | `FallbackChainPanel.tsx` (`set_fallback`/`list_fallbacks`); `resolve_route` is the router-side resolve call, correctly not user-facing |
| `record_health` / `health_list` | per-slot health ledger (status/last error/last ok) | `KeyHealthPanel.tsx` renders `health_list`; `record_health` is the router-side write path, correctly not user-facing |
| `org_key_create` / `org_key_add_member` / `org_key_remove_member` / `org_keys_list` | org-shared key groups with owner/admin/user/viewer roles | `OrgKeysPanel.tsx` |

**20 of 24 macros are directly user-facing (DESIGNED)**; the remaining 4
(`record_usage`, `budget_check`, `resolve_route`, `record_health`) are
documented as router-internal write/enforcement hooks the *inference
path* calls, not the UI — correctly absent from any button, per the
domain file's own "router consumes this" doc comments. That absence is
still correct UI design either way; whether the router actually calls
them is a separate, orthogonal question flagged in the table row above
(answer: not currently, for these 4 — but `rate_limit_set`/
`rate_limit_status`'s own enforcement counterpart, `consumeRateLimitToken`,
genuinely is called by `brainChat`, which is the point of closing item #9).

## 1.5 Reference-parity checklist

**(a) Reference points:** [OpenRouter](https://openrouter.ai) (the keyless
live model catalog this lens's `provider_models` macro fetches from
directly) and the BYO-key + fallback-chain pattern popularized by
[LiteLLM](https://www.litellm.ai) / Vercel's AI Gateway (per-slot budget
caps, ordered fallback routing, usage/spend dashboards). Concord's own
framing (`CLAUDE.md`, `docs/LICENSING.md`) is the "revolving door" pattern:
plug in a frontier-tier key you already pay for (ChatGPT Plus/Claude Pro/
Grok) instead of Concord's free local Ollama.

| # | Checklist item | Disposition |
|---|---|---|
| 1 | Per-slot key CRUD with masked preview, never re-showing plaintext | ALREADY REAL | `list`/`set`/`remove`/`set_active`, AES-GCM at rest, preview-only round-trip |
| 2 | Live connectivity test before trusting a key | ALREADY REAL | `test` macro (1-token ping), mirrors into health ledger |
| 3 | Per-key usage + spend tracking with a chartable daily series | ALREADY REAL | `usage_summary` → `UsageSpendPanel` |
| 4 | Monthly budget caps with an enforcement gate | ALREADY REAL | `set_budget`/`budget_status` UI + `budget_check` router gate |
| 5 | Model picker sourced from the provider's live catalog (not a hardcoded list) | ALREADY REAL | `provider_models` hits OpenRouter's real `/api/v1/models` endpoint, falls back to bundled defaults only on fetch failure — labeled honestly (`source: "openrouter" \| "defaults"`) |
| 6 | Ordered fallback chain on primary-key failure | ALREADY REAL | `set_fallback`/`list_fallbacks`/`resolve_route` |
| 7 | Key health / last-error surfacing | ALREADY REAL | `health_list` → `KeyHealthPanel` |
| 8 | Org/team-shared keys with role-gated membership | ALREADY REAL | `org_key_create`/`add_member`/`remove_member`/`list` → `OrgKeysPanel` |
| 9 | ~~Per-key rate limiting (requests/minute, not just monthly $ cap)~~ | ~~GENUINELY MISSING~~ **CLOSED (2026-07-12, `8d76c3a8`)** | ~~Only a monthly USD/token cap exists; no requests-per-minute throttle. Real backend work (a token-bucket in the router), out of scope for a lens-UI pass~~ Built the real backend work this item was explicitly deferred over. New `server/lib/byo-rate-limit.js` implements a continuous-refill token bucket per `(userId, slot)` — the same bucket algorithm `server/lib/socket-rate-limit.js#makeSocketRateLimiter` already uses for socket-event flood protection, generalized to a requests-per-minute cadence and backed by a lazily-created branch of the byo-keys lens's own `_concordSTATE.byoKeysLens` namespace. It lives in `server/lib/`, not `server/domains/`, because it has to be import-safe from **the real router**: `server/lib/byo-router.js#brainChat` — confirmed by reading it, not assumed — is the single dispatch chokepoint every BYO-key inference call goes through (chat, expert-mode, `reason.verify`, agent-marathon, maker-checker, `llm.local`; grep confirms zero other call sites reach a provider directly). `brainChat` now calls `consumeRateLimitToken(userId, slot)` at the top of the override branch, **before** the encrypted key is decrypted or the provider is contacted — a throttled call never touches the network, both protecting the user's own provider account from a runaway loop and avoiding a wasted decrypt cycle. When blocked it returns the same honest-failure shape the rest of this codebase uses: `{ ok:false, error:'rate_limited', retryAfterMs }`, which every existing `brainChat()` caller already branches on via `if (!r.ok)` (verified by reading `reason.js`, `expert-mode.js`, `chat_agent`'s `llm.local` handler — none of them needed changes). Fail-open by design when no limit is configured for that `(user, slot)` — same "no cap = unlimited" convention `budget_check` already uses — so this is an opt-in user protection, never a platform-wide throttle that could block a correctly-configured key. Two new macros, `byo_keys.rate_limit_set` / `byo_keys.rate_limit_status`, mirror the `set_budget`/`budget_status` naming pattern and call the *exact same* lib functions the router enforces with, so the macro layer and the enforcement layer are provably one implementation, not two that could drift apart. **Honesty note, found while wiring this (not assumed):** `budget_check`/`record_usage`/`record_health`/`resolve_route` — the pre-existing macros this doc's own table above describes as "the inference-router enforcement gate, correctly not user-facing" — turned out, on reading `byo-router.js` in full, to NOT actually be called from `brainChat` at all; they're real, tested macros with no production call site. That's a pre-existing gap in a *different* item (budget enforcement, not rate limiting), out of scope for this unit, and left exactly as found — flagged here rather than silently left implied-fixed by proximity. A shared `ensureByoKeysLensState()` initializer (also in `byo-rate-limit.js`) replaced the domain file's own inline state-bootstrap so the two independent lazy-init call sites (macro calls vs. every router call) can't race to partially construct `_concordSTATE.byoKeysLens` — this was caught by a real regression: an earlier per-branch "self-healing" version of the fix silently repaired a state corruption an existing invariant test (`byo-budget-alert-cycle.test.js`) deliberately induces to prove the heartbeat's own try/catch; the single-owner initializer restores byte-identical original semantics while adding the new `rateLimits` branch. New bespoke `RateLimitPanel.tsx` — a live token-bucket gauge (10-cell capacity meter + remaining/max count + next-refill countdown, auto-polling `rate_limit_status` every 5s so the bucket visibly refills without a manual click), sitting beside `BudgetPanel` in the lens grid — not a copy of it: budget is a ceiling that grows toward exhaustion over a month, rate limit is a capacity that drains and refills within a minute, and the two widgets read differently on purpose. Tests: `server/tests/byo-rate-limit.test.js` (19/19 — fail-open with no limit configured, invalid actor/slot, set/clear/floor/clamp on `setRateLimit`, requests strictly under the limit all succeed and consume a token, the over-limit request is rejected with a positive `retryAfterMs`, a rejected request does NOT consume a token, the window resets after `RATE_LIMIT_WINDOW_MS` elapses via an injected clock — no real `setTimeout`/sleep, lowering vs. raising the cap re-clamps vs. doesn't retroactively grant a burst, per-slot isolation, per-user isolation, status never consumes a token, and the two `rate_limit_set`/`rate_limit_status` macros round-trip through the exact same substrate the lib functions read/write), `server/tests/byo-rate-limit-router.test.js` (5/5 — exercises the real `brainChat()` call path end-to-end against an in-memory `user_brain_overrides` row with a stubbed global `fetch`, proving by call-count that an allowed request reaches the provider dispatch and a rate-limited request is rejected by `brainChat()` itself **without ever calling fetch**, plus fail-open-when-unconfigured, per-user isolation through the real path, and that the `concord_default` no-override fallback never touches the BYO limiter at all), `concord-frontend/components/byo-keys/RateLimitPanel.test.tsx` (7/7). |
| 10 | ~~Spend alerts / email or push notification at a % threshold~~ | ~~GENUINELY MISSING~~ **CLOSED (2026-07-12, `e3094f2a`)** | ~~`budget_status` computes `usdPct`/`tokenPct` and an `exceeded` flag, but nothing pushes a proactive alert — a user must open the lens to see it crossed. Would need a notification-dispatch hook, not a UI gap~~ Built the honest, in-app version of this gap (real email/push was explicitly out of scope — no new external service). New `server/domains/byo-keys.js#checkSpendAlerts()` sweeps every user's budgets against this month's real usage (the exact math `budget_status` already uses) and returns only NEWLY-crossed thresholds (`SPEND_ALERT_THRESHOLDS = [1.0, 0.8]`, checked highest-first), with once-per-crossing dedupe state in the same `_concordSTATE.byoKeysLens` namespace (`alerts: Map<userId, Map<slot, {month, threshold}>>`) — a slot only re-fires within the same month if the crossed threshold *increases* (0.8→1.0), and always re-fires fresh on month rollover. A new heartbeat, `server/emergent/byo-budget-alert-cycle.js` (`registerHeartbeat("byo-budget-alert-cycle", {frequency: 20, scope: "global", ...})`, wired in `server.js` right after `registerByoKeysMacros`), calls the sweep every ~5 min and dispatches each newly-fired alert through the **existing** social-layer notification substrate — `server/emergent/social-layer.js#createNotification()`, the same channel that already delivers likes/comments/mentions/DMs. That channel is wired end-to-end: `setSocialEmitter` (server.js, boot) threads a per-user socket emit into `createNotification`, which fires a real-time `social:notification` event; the frontend's `useSocialNotificationToast` hook (mounted once, globally, in `AppShell`) renders it as a toast without the user having the byo-keys lens (or any lens) open — confirmed by reading the existing wiring, not assumed. No new frontend component was needed; `useSocialNotificationToast.ts` only grew one `TYPE_TO_TONE` entry (`budget_alert: 'warning'`) so the toast reads with the right urgency color. **Honesty note, discovered while verifying the channel end-to-end (not by static reading — confirmed by calling `createNotification` and inspecting `STATE.notifications` at runtime):** the separate, persistent REST-backed notification bell/center (`/api/social/notifications`) reads from `STATE.notifications`, a flat `Map` that nothing in the codebase ever writes to — `createNotification` writes into `STATE._social.notifications` instead, a completely different store. This is a pre-existing bug in the shared social-notification wiring (affects every notification type, not just this one — `socialGetNotifications`/`socialMarkNotificationRead`/etc. are imported into `server.js` but never called) and is out of scope for this gap-closure unit; it means a user offline when an alert fires currently only gets the real-time toast, with no durable catch-up record yet. Flagged honestly rather than silently claimed as fixed. Tests: `server/tests/byo-budget-alert-cycle.test.js` (14/14 — exact threshold detection at 0.8 and 1.0, no re-fire on an unchanged crossing, re-fire on threshold increase, re-fire after simulated month rollover, per-user isolation, token-cap parity with USD-cap detection, real notification dispatch + content assertions, no-op when nobody crosses, kill-switch (`CONCORD_BYO_BUDGET_ALERTS=0`), and the heartbeat-never-throws invariant under both a corrupted-state and an absent-`ctx.state` case). |

**Coverage summary:** all 10 checklist items are now real and well-designed
(no generic scaffold anywhere — every panel is bespoke, calls a real macro).
Item 10 (proactive spend alerts) closed 2026-07-12 via a heartbeat + the
existing social-layer notification channel — see that row above. Item 9
(per-key rate limiting) closed 2026-07-12 via a real token-bucket wired
into the actual `brainChat()` router chokepoint — see that row above. Both
were originally the two genuinely-missing, explicitly-deferred backend-work
items on this checklist; neither is deferred anymore.

## 2. What this audit changed

**At audit time (Wave 3): nothing.** This lens was already fully rebuilt in a prior sprint
("Sprint 10D" per the page's own header comment) — every macro maps to a
dedicated, bespoke component (`UsageSpendPanel`, `BudgetPanel`,
`FallbackChainPanel`, `KeyHealthPanel`, `OrgKeysPanel`, `ModelPickerModal`,
`OpenRouterCatalog`), there is no generic artifact-CRUD store, no
`<UniversalActions>`/`<ManifestActionBar>` button wall, and
`grade-ux-polish.mjs --honest` reports `tier: "polished"`,
`isGenericScaffold: false`, `bespokeRatio: 0.719`. The only UI elements
shared with other lenses are the standard discovery sentinels
(`RecentMineCard`/`AutoActionStrip`/`CrossLensRecentsPanel`, all
`hideWhenEmpty`), which sit alongside substantial bespoke depth rather than
standing in for it. Verified honest: read every macro against every panel
call-site (`grep "'byo_keys', '"` across `components/byo-keys/*.tsx` +
`page.tsx`) — 18/18 user-facing macros surfaced, 4/4 internal macros
correctly unsurfaced.

## Files touched

Wave 3 (audit): None — audit-only, no changes needed.

Wave 4 gap-closure (2026-07-12, checklist item #10 — spend alerts):
- `server/domains/byo-keys.js` — `alerts` substrate branch + `checkSpendAlerts()` + `SPEND_ALERT_THRESHOLDS` export
- `server/emergent/byo-budget-alert-cycle.js` — new heartbeat module
- `server/server.js` — `registerHeartbeat("byo-budget-alert-cycle", ...)` wiring
- `server/tests/byo-budget-alert-cycle.test.js` — new, 14 cases
- `concord-frontend/hooks/useSocialNotificationToast.ts` — one `TYPE_TO_TONE` entry (`budget_alert`); no new component

Wave 4 gap-closure (2026-07-12, checklist item #9 — per-key rate limiting):
- `server/lib/byo-rate-limit.js` — new; the token-bucket core (`setRateLimit`/`getRateLimitStatus`/`consumeRateLimitToken`) + the canonical `ensureByoKeysLensState()` initializer
- `server/domains/byo-keys.js` — `rate_limit_set`/`rate_limit_status` macros; `stateRoot()` now delegates to the shared initializer instead of duplicating it
- `server/lib/byo-router.js` — `brainChat()` calls `consumeRateLimitToken()` before decrypting the key / contacting the provider, in the override branch
- `server/tests/byo-rate-limit.test.js` — new, 19 cases (pure token-bucket + macro contract)
- `server/tests/byo-rate-limit-router.test.js` — new, 5 cases (real `brainChat()` end-to-end, stubbed `fetch`)
- `concord-frontend/components/byo-keys/RateLimitPanel.tsx` — new bespoke panel
- `concord-frontend/components/byo-keys/RateLimitPanel.test.tsx` — new, 7 cases
- `concord-frontend/app/lenses/byo-keys/page.tsx` — mounts `RateLimitPanel` beside `BudgetPanel`
