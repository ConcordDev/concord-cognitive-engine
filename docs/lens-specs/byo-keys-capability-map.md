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

## Backend surface — 22 macros, all real

Two tiers, both real, persisted differently by design (documented in the
file's own header comment): the original 6 (`list`/`set`/`remove`/
`set_active`/`test`/`available_providers`) persist in SQLite (migration
170, `user_brain_overrides`, AES-GCM encrypted keys); the 16 feature-parity
macros (usage/spend, budgets, model picker, fallback chains, key health,
org-shared keys) persist in `globalThis._concordSTATE` Maps keyed by
userId, layered on top without touching the encrypted-key schema.

| Macro | Real effect | Surfaced by |
|---|---|---|
| `list` | current overrides + masked key previews | `page.tsx` (main list) |
| `set` / `remove` / `set_active` | create/update/delete/toggle an override | `page.tsx` (edit form + pause/resume) |
| `test` | 1-token live ping to verify a saved key | `page.tsx` (test button) + mirrors into `record_health`'s substrate |
| `available_providers` | static provider/model catalog | `page.tsx` (provider select) |
| `record_usage` / `usage_summary` | per-call token+cost ledger / monthly rollup with daily series | `UsageSpendPanel.tsx` (`usage_summary` renders live; `record_usage` is the router-side write path, correctly not user-facing) |
| `set_budget` / `budget_status` / `budget_check` | per-slot monthly USD/token cap + spend-vs-cap | `BudgetPanel.tsx` (`set_budget`/`budget_status`); `budget_check` is the inference-router enforcement gate, correctly not user-facing |
| `provider_models` | live OpenRouter model catalog per provider (keyless, real HTTP fetch with a bundled-defaults fallback) | `ModelPickerModal.tsx` |
| `set_model` | change just the model on an existing override | `ModelPickerModal.tsx` |
| `set_fallback` / `list_fallbacks` / `resolve_route` | ordered fallback slot chain | `FallbackChainPanel.tsx` (`set_fallback`/`list_fallbacks`); `resolve_route` is the router-side resolve call, correctly not user-facing |
| `record_health` / `health_list` | per-slot health ledger (status/last error/last ok) | `KeyHealthPanel.tsx` renders `health_list`; `record_health` is the router-side write path, correctly not user-facing |
| `org_key_create` / `org_key_add_member` / `org_key_remove_member` / `org_keys_list` | org-shared key groups with owner/admin/user/viewer roles | `OrgKeysPanel.tsx` |

**18 of 22 macros are directly user-facing (DESIGNED)**; the remaining 4
(`record_usage`, `budget_check`, `resolve_route`, `record_health`) are
router-internal write/enforcement hooks the *inference path* calls, not
the UI — correctly absent from any button, per the domain file's own
"router consumes this" doc comments. This is not an unsurfaced-macro gap;
it's the router/UI split working as designed.

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
| 9 | Per-key rate limiting (requests/minute, not just monthly $ cap) | GENUINELY MISSING | Only a monthly USD/token cap exists; no requests-per-minute throttle. Real backend work (a token-bucket in the router), out of scope for a lens-UI pass |
| 10 | ~~Spend alerts / email or push notification at a % threshold~~ | ~~GENUINELY MISSING~~ **CLOSED (2026-07-12, pending commit)** | ~~`budget_status` computes `usdPct`/`tokenPct` and an `exceeded` flag, but nothing pushes a proactive alert — a user must open the lens to see it crossed. Would need a notification-dispatch hook, not a UI gap~~ Built the honest, in-app version of this gap (real email/push was explicitly out of scope — no new external service). New `server/domains/byo-keys.js#checkSpendAlerts()` sweeps every user's budgets against this month's real usage (the exact math `budget_status` already uses) and returns only NEWLY-crossed thresholds (`SPEND_ALERT_THRESHOLDS = [1.0, 0.8]`, checked highest-first), with once-per-crossing dedupe state in the same `_concordSTATE.byoKeysLens` namespace (`alerts: Map<userId, Map<slot, {month, threshold}>>`) — a slot only re-fires within the same month if the crossed threshold *increases* (0.8→1.0), and always re-fires fresh on month rollover. A new heartbeat, `server/emergent/byo-budget-alert-cycle.js` (`registerHeartbeat("byo-budget-alert-cycle", {frequency: 20, scope: "global", ...})`, wired in `server.js` right after `registerByoKeysMacros`), calls the sweep every ~5 min and dispatches each newly-fired alert through the **existing** social-layer notification substrate — `server/emergent/social-layer.js#createNotification()`, the same channel that already delivers likes/comments/mentions/DMs. That channel is wired end-to-end: `setSocialEmitter` (server.js, boot) threads a per-user socket emit into `createNotification`, which fires a real-time `social:notification` event; the frontend's `useSocialNotificationToast` hook (mounted once, globally, in `AppShell`) renders it as a toast without the user having the byo-keys lens (or any lens) open — confirmed by reading the existing wiring, not assumed. No new frontend component was needed; `useSocialNotificationToast.ts` only grew one `TYPE_TO_TONE` entry (`budget_alert: 'warning'`) so the toast reads with the right urgency color. **Honesty note, discovered while verifying the channel end-to-end (not by static reading — confirmed by calling `createNotification` and inspecting `STATE.notifications` at runtime):** the separate, persistent REST-backed notification bell/center (`/api/social/notifications`) reads from `STATE.notifications`, a flat `Map` that nothing in the codebase ever writes to — `createNotification` writes into `STATE._social.notifications` instead, a completely different store. This is a pre-existing bug in the shared social-notification wiring (affects every notification type, not just this one — `socialGetNotifications`/`socialMarkNotificationRead`/etc. are imported into `server.js` but never called) and is out of scope for this gap-closure unit; it means a user offline when an alert fires currently only gets the real-time toast, with no durable catch-up record yet. Flagged honestly rather than silently claimed as fixed. Tests: `server/tests/byo-budget-alert-cycle.test.js` (14/14 — exact threshold detection at 0.8 and 1.0, no re-fire on an unchanged crossing, re-fire on threshold increase, re-fire after simulated month rollover, per-user isolation, token-cap parity with USD-cap detection, real notification dispatch + content assertions, no-op when nobody crosses, kill-switch (`CONCORD_BYO_BUDGET_ALERTS=0`), and the heartbeat-never-throws invariant under both a corrupted-state and an absent-`ctx.state` case). |

**Coverage summary:** 9 of 10 checklist items are now real and well-designed
(no generic scaffold anywhere — every panel is bespoke, calls a real macro,
and the 4 "unsurfaced" macros are correctly internal-only). Item 10
(proactive spend alerts) closed 2026-07-12 via a heartbeat + the existing
social-layer notification channel — see the row above. 1 item remains a
genuine, scoped backend gap (per-key rate limiting) — named honestly
rather than papered over, deliberately deferred as real-backend-work,
not lens-rebuild scope.

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
