# Sponsorship Lens — Capability Map (Frontend Rebuild Program, Wave 3)

> Derived, not asserted. Backend surface enumerated by reading
> `server/domains/sponsorship.js` (417 LOC) in full — every macro registered
> via `registerLensAction("sponsorship", "<name>", ...)`, confirmed with
> `grep -c 'registerLensAction("sponsorship"' server/domains/sponsorship.js`
> → **16**. Frontend audited by reading `app/lenses/sponsorship/page.tsx`
> (96 LOC) and all 6 `components/sponsorship/*.tsx` files (~800 LOC
> combined) in full. Backend money/ledger claims verified by reading the
> real `subscribe`/`change_tier`/`billing` handlers line-by-line, not by
> trusting comments.

## What this lens is

A Patreon-shaped creator-membership platform: tiered CC subscriptions to a
seeded catalog of 6 NPC-creators (`npc_arden`, `npc_vael`, `npc_torian`,
`npc_seris`, `npc_juno`, `npc_mira`), sponsor-only content gating by tier
rank, dispatch/post archives, sponsor leaderboards with badges, a billing
dashboard (committed spend / trend / payment history), and direct
creator→sponsor thank-you messaging. All state lives in an in-memory
`globalThis._concordSTATE.sponsorshipLens` (Maps keyed by userId/creatorId)
— this is a fully self-contained lens-local substrate, not backed by SQL
tables. Currency is CC throughout; every charge amount comes from the
seeded tier catalog, never from caller input (see the money-path
verification below).

## Backend surface — 16 macros in `domains/sponsorship.js`, all real and all reached by the UI

`discover`, `list_tiers`, `subscribe`, `list_for_user`, `pause`, `resume`,
`change_tier`, `cancel`, `publish_post`, `feed`, `dispatch_history`,
`leaderboard`, `billing`, `send_thanks`, `list_messages`,
`mark_message_read`.

Cross-reference (UI → macro), verified by grepping every `lensRun('sponsorship', …)`
call site across the 6 components (14 call sites total; `list_tiers` and
`publish_post` are each called from two components):

| Macro | Frontend caller |
|---|---|
| `discover` | `DiscoverPanel.tsx`, `CreatorHub.tsx` |
| `list_tiers` | `DiscoverPanel.tsx` (type export), `MySponsorships.tsx` |
| `subscribe` | `DiscoverPanel.tsx` |
| `list_for_user` | `MySponsorships.tsx` |
| `pause` / `resume` / `change_tier` / `cancel` | `MySponsorships.tsx` (`act()`) |
| `publish_post` | `CreatorHub.tsx` |
| `feed` / `leaderboard` | `CreatorHub.tsx` |
| `dispatch_history` | `MySponsorships.tsx` |
| `billing` | `BillingDashboard.tsx` |
| `send_thanks` / `list_messages` / `mark_message_read` | `SponsorInbox.tsx` |

Zero dead macros on the UI side, zero fake macro calls on the frontend side
— every button in every panel reaches a real, hand-written handler (no
`<UniversalActions>`/`<LensFeaturePanel>` wall; `page.tsx` mounts 6 bespoke,
purpose-built panels behind a tab strip, plus a `SponsorRepos.tsx` real-world
reference panel pulling live GitHub `topic:sponsorship` search results).

## A second, unrelated `sponsorship` domain exists in `server.js` — shadowed, not broken

`server/server.js:76955-77005` (Phase 9.4 "native economy primitives",
migration `163_economy_primitives.js`, table `npc_sponsorships`) registers
THREE macros via the older `register("sponsorship", …)` path: `create`,
`cancel`, `list_for_user`. This is a **different, DB-backed system**
("sponsor pays mentor NPC in CC; system composes periodic dispatches from
the NPC's recent state") that predates the lens rebuild and was never wired
to any heartbeat (`grep -rn "npc_sponsorships" server/emergent server/lib`
returns only the migration file — no consumer ever charges or dispatches
against it) and is called by zero frontend code (`grep -rn "'sponsorship'"
concord-frontend` outside `app/lenses/sponsorship` and
`components/sponsorship` returns only unrelated `source: 'sponsorship'`
accounting-category strings in the creator-revenue panels).

Per `/api/lens/run`'s dispatch order (`server.js:39592-39607`: prefer
`LENS_ACTIONS`, fall back to `MACROS`) — the same precedence this codebase
already documents for the `personas` lens in `CLAUDE.md` — the
`registerLensAction` versions of `cancel` and `list_for_user` in
`domains/sponsorship.js` **permanently shadow** the `register()`-based
`npc_sponsorships` versions of those two names. Only `sponsorship.create`
remains reachable (no `LENS_ACTIONS` entry for that name), but it has no
caller anywhere. This is dead-but-harmless legacy capability, not a defect
to fix here — out of this lens's touch scope (`server.js` is shared with
5 concurrent sibling agents this wave) and superseded by the complete,
tested, UI-driven system in `domains/sponsorship.js`. Documented here so a
future session doesn't rediscover it as a mystery.

## Reference apps

Patreon / GitHub Sponsors / Ko-fi — tiered recurring membership, creator
discovery, sponsor-gated posts, a supporter leaderboard/wall, and a billing
history. The lens's Discover/Memberships/Billing/Inbox/Creator-Hub tab
structure and the amber-accent CC-denominated stat tiles match this
category directly (dark commerce-dashboard identity, not a generic CRUD
list) — `BillingDashboard.tsx` uses the shared `ChartKit` bar chart for the
6-month contribution trend, `MySponsorships.tsx` renders a real tier
dropdown + pause/resume/cancel/dispatch-history action row per membership.

## What I found: a real authz gap (client-supplied ownerId pattern)

Per this wave's authz sweep, I checked whether any mutation macro can
touch **another real user's** data by passing an arbitrary id.

**All 12 user-owned macros (`subscribe`, `list_for_user`, `pause`,
`resume`, `change_tier`, `cancel`, `billing`, `list_messages`,
`mark_message_read`, `dispatch_history`, `feed`, `discover`) are safely
scoped by construction** — every record lookup is
`(s.sponsorships|payouts|messages).get(actor(ctx))`, i.e. the array
searched is keyed by the **caller's own** `userId` first, and only THEN is
the caller-supplied id (`sponsorshipId`/`messageId`) looked up inside it.
Since ids (`sub_N`, `chg_N`, `msg_N`) are drawn from one global sequence,
passing another user's real id simply doesn't resolve inside your own
array — confirmed by the existing `"INVARIANT: sponsorships scoped
per-user"` test and the new isolation assertions below.

**Two macros were NOT scoped at all: `publish_post` and `send_thanks`.**
Both act on behalf of a `creatorId` — but every `creatorId` in this lens is
a fixed seeded NPC (the 6-entry `CATALOG`), with **no ownership binding to
any real user account anywhere in the system**. Before this fix:

- `publish_post(ctx, { creatorId, title, body, minTier })` — **any**
  authenticated caller could pass **any** of the 6 creatorIds and publish
  content into that creator's feed, indistinguishable from an official
  dispatch, visible (per `minTier`) to every real sponsor of that creator.
- `send_thanks(ctx, { toUserId, creatorId, body })` — **any** authenticated
  caller could pass **any other real user's** `toUserId` (sponsor
  leaderboards already expose real `userId`s publicly, so targets are
  trivially discoverable) plus any of the 6 `creatorId`s, and inject an
  arbitrary message straight into that stranger's private inbox
  (`SponsorInbox`), reading exactly like a genuine creator thank-you, with
  no rate limit and no content check. The only existing guard
  (`recipient is not an active sponsor`) does nothing to stop the sender
  from being an arbitrary uninvolved user — it only checks the *recipient*
  relationship, never the *sender's* authority to speak as the creator.

This is the client-supplied-ownerId pattern this wave's sweep has found
repeatedly elsewhere (`toUserId` chosen by the caller, no binding check) —
here the twist is that the impersonated identity is a shared NPC rather
than a specific other account, but the blast radius (arbitrary content
into a stranger's private inbox / into a paid membership's official feed)
is the same shape of bug.

### Fix

Admin-gated both macros in-handler off `ctx.actor.role`, the exact idiom
`server/domains/announcements.js:70-90` already uses for
`announcements.post` (`role !== "admin"` → `{ ok:false, error:"admin_only"
}`, never a silent hide, never a fabricated success):

```js
function isAdmin(ctx) { return (ctx?.actor?.role || "") === "admin"; }
...
registerLensAction("sponsorship", "publish_post", (ctx, artifact, params = {}) => {
  try {
    if (!isAdmin(ctx)) return { ok: false, error: "admin_only" };
    ...
registerLensAction("sponsorship", "send_thanks", (ctx, artifact, params = {}) => {
  try {
    if (!isAdmin(ctx)) return { ok: false, error: "admin_only" };
    ...
```

Followed the announcements page's own documented convention ("attempt,
then degrade honestly" — `app/lenses/announcements/page.tsx:14-21`):
**no** client-side pre-gating with a separate `/api/auth/me` probe. The
compose forms in `CreatorHub.tsx` and `SponsorInbox.tsx` stay visible to
everyone; a non-admin's submit attempt now surfaces the real backend
rejection reason in plain language (`"Your account isn't an admin —
publishing creator content is admin-only."` / `"...sending as an NPC
creator is admin-only."`) instead of a raw `Failed: admin_only`, and each
compose section grew a one-line honest disclosure explaining *why*
(`"NPC creators have no linked player account, so authoring their official
dispatches is restricted to operators."`) rather than silently disappearing.

Existing tests (`server/tests/sponsorship-domain-parity.test.js`,
`server/tests/sponsorship-lens-macros.test.js`) previously exercised
`publish_post`/`send_thanks` with a plain non-admin `ctxA` — that encoded
the defect as expected behavior. Updated those call sites to a `ctxAdmin`
fixture (`{ actor: { userId: "user_a", role: "admin" } }`) so the tests
keep covering the real (now admin-gated) content-authoring path, and added
explicit new tests in both files pinning the non-admin rejection AND that
nothing is written to state when it fires (feed stays empty, inbox stays
empty) — not just that the call returns `ok:false`.

## 1.5 Reference-parity checklist

| # | Item | Disposition |
|---|---|---|
| 1 | Tiered recurring membership (3 tiers/creator, CC-denominated) | ALREADY REAL — `subscribe`/`change_tier`, exact tier-price accounting (money-path tests assert no CC is ever minted or lost) |
| 2 | Creator discovery + search/filter | ALREADY REAL — `DiscoverPanel.tsx`, query + world filter |
| 3 | Sponsor-only gated content by tier rank | ALREADY REAL — `feed`'s `tierRank` comparison, body withheld (not just hidden) when locked |
| 4 | Dispatch/post archive per membership | ALREADY REAL — `dispatch_history`, scoped to posts after the sponsorship's `startedAt` |
| 5 | Pause/resume/cancel without losing the relationship | ALREADY REAL — `pause`/`resume` preserve the row; `cancel` is terminal |
| 6 | Sponsor leaderboard + tier badges | ALREADY REAL — `leaderboard`, ranked + badge-mapped |
| 7 | Billing dashboard (committed spend, trend, history) | ALREADY REAL — `BillingDashboard.tsx` + `ChartKit` 6-month trend |
| 8 | Direct creator→sponsor messaging | ALREADY REAL, but was **unauthorized** — now admin-gated (this session's fix) |
| 9 | Real-world sponsorship-tooling reference panel | ALREADY REAL — `SponsorRepos.tsx`, live GitHub search |

**Coverage summary:** 9 of 9 checklist items real; item 8 had a genuine
authz defect, fixed this session. No fabricated data anywhere — the money
path is provably conservative (see the `fail-CLOSED money path` test
describe block: poisoned numeric injection on `subscribe`/`change_tier`
never reaches `totalContributed`/`monthlyCommitted`, only the seeded tier
price does).

## Files touched

- `server/domains/sponsorship.js` — admin-gate on `publish_post` and
  `send_thanks` + an authz doc-comment explaining the scoping model for
  every macro in the file.
- `concord-frontend/components/sponsorship/CreatorHub.tsx` — honest
  `admin_only` error copy + a disclosure line on the publish form.
- `concord-frontend/components/sponsorship/SponsorInbox.tsx` — honest
  `admin_only` error copy + a disclosure line on the thank-you form.
- `server/tests/sponsorship-domain-parity.test.js` — `ctxAdmin` fixture,
  updated `publish_post`/`send_thanks` call sites, new admin-gate describe
  block (2 tests).
- `server/tests/sponsorship-lens-macros.test.js` — `ctxAdmin` fixture,
  updated `publish_post`/`send_thanks` call sites, new admin-gate describe
  block (2 tests).
- `docs/lens-specs/sponsorship-capability-map.md` — this document.

## Verification

- `node --check server/domains/sponsorship.js` — clean.
- `cd server && node --test tests/sponsorship-domain-parity.test.js tests/sponsorship-lens-macros.test.js`:
  ```
  # tests 44
  # suites 20
  # pass 44
  # fail 0
  # cancelled 0
  ```
  (18/18 in `sponsorship-domain-parity.test.js`, 26/26 in
  `sponsorship-lens-macros.test.js`.)
- `cd server && npx eslint domains/sponsorship.js tests/sponsorship-domain-parity.test.js tests/sponsorship-lens-macros.test.js` — clean, no output.
- `cd concord-frontend && npx eslint components/sponsorship/*.tsx app/lenses/sponsorship/page.tsx` — **could not run**: this worktree's `concord-frontend/node_modules` is not installed (`Cannot find package '@eslint/eslintrc'`), a pre-existing environment limitation unrelated to this change (`node_modules` has effectively 0 installed packages). Reviewed both diffs manually instead — 10 and 7 line changes respectively, template-literal → ternary string swaps and one added `<p>` disclosure line each, no new imports, no altered prop contracts, no JSX structural changes.
- `node scripts/verify-lens-backends.mjs` → `{"verdicts":{"WIRED":258,"NO-BACKEND-CALL":2},"total":260,"macroDomains":534,"routePrefixes":2965}` — unchanged from baseline; `sponsorship` is not in the printed `NO-BACKEND-CALL`/`BROKEN`/`PARTIAL` list, confirming it stayed WIRED.
- `node scripts/grade-ux-polish.mjs --honest` → sponsorship entry: `"tier": "polished"`, `"isGenericScaffold": false`, `"importsGenericTrio": false`, `"honestCapped": false`, `"antiPatterns": 0` — unchanged tier, still not a generic scaffold.
- `git checkout -- audit/` run afterward to revert the transient grader output (confirmed clean with `git status --short audit/`).
