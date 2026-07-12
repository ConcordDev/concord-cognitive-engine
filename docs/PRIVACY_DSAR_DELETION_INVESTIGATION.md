# Privacy DSAR Deletion Investigation — Wave 4 Gap Closure

> Status: **investigation complete, root cause empirically confirmed, NOT
> fixed here.** This is a diagnostic report per the Wave-4 triage rule
> (CLAUDE.md §6: closing the hard 20% invariant) and per this task's explicit
> safety-conservative mandate. The finding is more consequential than the
> `docs/WAVE4_INVENTORY.md` gap description implied in both directions: a
> real, separate account-deletion pipeline already exists and is live in
> production (the gap is narrower than "no purge exists at all") — but that
> real pipeline itself has several genuine, empirically-verified coverage
> gaps and at least one silently-failing bug, discovered while tracing it.
> None of this is fixed in this pass. Filing this so a future session (or the
> owner making a policy call) doesn't repeat the trace.

## TL;DR

The `privacy` lens's DSAR (`dsarSubmit`/`dsarList`/`dsarAdvance`,
`server/domains/privacy.js:77-143`) is exactly what the Wave 4 inventory
said: a real, well-built status tracker (received → in_review →
completed/rejected) that never touches real user data. Advancing a
`kind:"deletion"` request to `"completed"` only flips a field inside an
isolated, per-user, in-memory bucket (`STATE.privacyLens.dsars`,
`server/domains/privacy.js:21-34`) that nothing else in the platform reads.

But Concord already has a **separate, real, substantially-built account
deletion system** — `server/lib/account-lifecycle.js`
(`requestAccountDeletion` / `executeAccountDeletion`) mounted live at
`POST /api/account/delete` (`server/server.js:33874`,
`server/routes/account-lifecycle.js:80-99`). It anonymizes cited DTUs,
deletes uncited ones, delists marketplace listings, tombstones the
economy ledger for 7-year tax retention, and deletes the user row — the
same anonymize-vs-delete split CLAUDE.md's DTU tombstone invariant already
prescribes. **The DSAR system and the account-lifecycle system have never
been connected; they are two independent code paths written by the same
project at different times, one of which (DSAR) is UI-only and one of
which (account-lifecycle) is real and reachable.**

That reframes "the gap" from "no real deletion capability exists" (what the
capability-map's wording implies) to "the real deletion capability exists
but the DSAR UI doesn't call it, and — this is the more important finding
— **the real deletion capability itself has genuine, previously-unverified
coverage gaps and one confirmed silently-failing bug**, discovered by
tracing every table it touches and empirically running its social-content
delete step against the real schema. See Findings 3–6.

## Method

1. Read `server/domains/privacy.js` in full (438 LOC) — confirmed
   `dsarAdvance` (`:124-143`) only mutates `STATE.privacyLens.dsars`, a
   `Map` scoped per-user by `uidOf(ctx)`, with no macro anywhere reading a
   DSAR record to trigger any other action.
2. Grepped for any existing account-deletion / GDPR-erasure machinery before
   assuming none existed (per CLAUDE.md's runtime-truth-over-source-guessing
   discipline) — found `server/lib/account-lifecycle.js` (665 LOC) and its
   route (`server/routes/account-lifecycle.js`), confirmed mounted at
   `server.js:33874`.
3. Read `executeAccountDeletion` (`account-lifecycle.js:121-230`) line by
   line, listing every table it touches (13 steps) and cross-referencing
   each against the real migration that defines that table's schema.
4. Grepped the whole `server/` tree for tables carrying a `user_id`-shaped
   column (136 occurrences across 51 migration files — the real personal-
   data surface is broad; see the category table below) and specifically
   checked several high-sensitivity categories the deletion pipeline's own
   13 steps do *not* mention: chat history, connector OAuth tokens, the
   encrypted personal-DTU locker, sign-in OAuth links, and world/avatar/
   player state.
5. **Empirically verified** (not inferred) a suspected bug in step 4 ("delete
   social content") by constructing the exact table shapes from their real
   migrations in a throwaway in-memory `better-sqlite3` DB and running the
   literal query from `account-lifecycle.js:164` against them — reproduction
   in Finding 3.
6. Grepped for `PRAGMA foreign_keys` across the whole server tree to check
   whether the `ON DELETE CASCADE` constraints declared in 10 migration
   files would actually fire when `executeAccountDeletion` deletes the
   `users` row — confirmed they do not (Finding 4).
7. Read `server/tests/platinum-gdpr.test.js` and
   `server/tests/platinum-privacy-review.test.js` in full to check what test
   coverage exists for any of this — both are **structural regex scans**
   ("does the string `account.delete` appear somewhere in server.js"), not
   functional tests that create a user, delete them, and assert what
   survives (Finding 6).
8. Read `docs/security/privacy-review.md` — the platform's own public GDPR/
   CCPA compliance posture doc — and checked its claims against the code
   (Finding 7).

## Finding 1 — the DSAR flow is real state-tracking, genuinely disconnected from data

`dsarAdvance` (`server/domains/privacy.js:124-143`) takes `{dsarId, status}`,
looks up the record in the calling user's own `STATE.privacyLens.dsars`
bucket, and writes the new status + a history entry. There is no branch on
`req.kind === "deletion"`, no macro call, no `db.prepare` anywhere in this
function or anywhere else in `privacy.js` that would touch a `users`,
`dtus`, or any other real-data table. This matches the capability-map's
original framing exactly — confirmed, not new information.

**A secondary, real observation on top of this:** `dsarAdvance` has **no
confirmation gate and no distinction between "the requester advances their
own request" and "an operator/DPO fulfills it."** `uidOf(ctx)` resolves the
*calling* user, and the bucket is looked up by that same id
(`server/domains/privacy.js:44-46, 134`) — so today, any user can call
`dsarAdvance({dsarId, status:"completed"})` against their own request and
mark it "completed" themselves, with no operator review step and no
`{confirm:"..."}` phrase, unlike the real deletion route (see Finding 2).
This is a real UX/workflow gap independent of the "does it do anything"
question: a real DSAR pipeline (per OneTrust's own model, which this lens is
benchmarked against) normally has the requester submit and a controller-side
process fulfill + advance status — not self-service status advancement.

## Finding 2 — the REAL deletion pipeline already exists and is live

`server/lib/account-lifecycle.js` is not a stub — its own header comment
says so explicitly ("Account deletion is REAL — not a stub") and the code
substantially backs that claim. `requestAccountDeletion` (`:41-92`):

- Blocks deletion if the user has pending withdrawals (`:48-55`).
- Computes wallet balance from `economy_ledger` via the canonical
  `CREDIT_ROW_PREDICATE` (`:60-66` — correctly reuses the same predicate
  CLAUDE.md's ledger-conservation invariant requires, not an ad hoc sum).
- If balance > $0.01, schedules deletion 90 days out
  (`BALANCE_FORFEIT_DAYS`, `:33`) so the user can withdraw first, writing an
  `account_deletion_requests` row (migration `033_account_lifecycle.js:18`).
- Otherwise calls `executeAccountDeletion` immediately.

`executeAccountDeletion` (`:121-230`) runs 13 steps inside one
`db.transaction`:

1. Anonymize DTUs cited by others (`anonymizeAttribution`,
   `server/lib/consent.js:341-374` — writes an `anonymized_attributions`
   row keyed by `original_user_id` + an `anon_wallet_${userId}` id, and
   flips `dtus.metadata_json.creatorDisplay` to `"Anonymous Creator"`; the
   underlying `owner_user_id` column is left alone specifically so royalty
   routing to the anonymous wallet keeps working). **This is the correct
   application of CLAUDE.md's own tombstone-not-hard-delete invariant** —
   the account-lifecycle author already solved exactly the citation-lineage
   problem this task's brief warned about, before this investigation.
2. Delete DTUs *not* cited by anyone (`:144-153`).
3. Delist (not delete) the user's marketplace listings (`:156-158`).
4. Delete social content — **empirically confirmed broken, see Finding 3**.
5. Revoke sessions (`:169-171`).
6. Delete API keys (`:174-176`).
7. Delete consent records (`:179-181`).
8. **Anonymize** (not delete) `economy_ledger` rows — replaces
   `from_user_id`/`to_user_id` with a `deleted_${deletionId}` tombstone
   string, preserving the ledger for the 7-year legal retention window
   (`:183-189`) — matches `docs/security/privacy-review.md`'s own stated
   policy.
9. Delete `user_xp` / `quest_completions` / `creative_xp` (`:192-197`).
10. Remove leaderboard entries (`:200-202`).
11. **Delete the `users` row itself** (`:205`).
12. Write an audit-log entry recording the deletion (best-effort,
    `:208-213`).
13. Mark the `account_deletion_requests` row `completed` (`:216-220`).

`POST /api/account/delete` (`server/routes/account-lifecycle.js:80-99`)
requires an explicit `{confirm: "DELETE_MY_ACCOUNT"}` body field before
calling any of this — a real double-confirmation the DSAR flow (Finding 1)
lacks entirely. `GET /api/account/export` (`:111-122`) is a real, working
GDPR Article 15 export separate from (and broader than) `privacy.js`'s own
`dataExport` macro. This whole system is genuinely live, not dead code: the
router is mounted unconditionally at boot (`server.js:33861,33874`).

**Conclusion of Finding 2:** the honest summary of "does Concord have a real
account/data deletion capability" is **yes** — this predates the Wave-4
inventory pass and the inventory's phrasing ("doesn't execute a real
cross-lens data purge") is accurate only about the DSAR path specifically,
not about the platform as a whole. The corrected framing: *two independent
systems exist for two different regulatory concepts (a trackable per-request
workflow vs. an executable deletion), and nobody wired them together.*

## Finding 3 — EMPIRICALLY CONFIRMED: the real pipeline's own "delete social content" step silently fails on every target table

`executeAccountDeletion:161-166`:

```js
for (const table of ["social_posts", "social_comments", "direct_messages", "forum_posts"]) {
  try {
    db.prepare(`DELETE FROM ${table} WHERE user_id = ? OR author_id = ? OR sender_id = ?`).run(userId, userId, userId);
  } catch (err) { console.warn(...); errors.push({ step: `delete_${table}`, err }); }
}
```

I built the real schemas for these tables from their actual migrations
(`social_posts` from `server/migrations/315_missing_tables_repair.js:142-148`
— columns `id, user_id, author_id, content, created_at`; `direct_messages`
from the same file, `:151-157` — columns `id, sender_id, recipient_id,
content, created_at`) in a throwaway in-memory `better-sqlite3` DB, inserted
one row per table for `user_id`/`sender_id = "u1"`, and ran the exact
literal query above. Output, verbatim:

```
social_posts FAILED: no such column: sender_id
social_comments FAILED: no such table: social_comments
direct_messages FAILED: no such column: user_id
forum_posts FAILED: no such table: forum_posts

remaining social_posts: { c: 1 }
remaining direct_messages: { c: 1 }
```

SQLite resolves every column referenced in a compound `WHERE` clause at
**prepare time**, regardless of which `OR` branch would actually match a
given row — so a query referencing three columns against a table that only
has two of them fails to compile at all, not just for the missing column's
branch. **`social_comments` and `forum_posts` don't exist anywhere in the
schema** (no migration creates them — grepped the full `server/migrations/`
tree, zero hits), and the two tables that *do* exist
(`social_posts`, `direct_messages`) each only have two of the three columns
the query references. All four `try/catch` blocks silently swallow the
error and push it into the `errors` array (`executeAccountDeletion:126,
225`) — which the route (`server/routes/account-lifecycle.js:80-99`) never
even reads or surfaces to the caller; `res.status(result.ok ? 200 : 400)`
only inspects the top-level `ok` flag, and `ok` stays `true` because the
transaction itself commits successfully (the individual step errors are
non-fatal by design, `:223-229`). **Net effect: every user who deletes their
account keeps 100% of their social posts and direct messages in the
database forever, with the deletion response reporting success.** This
directly contradicts both the source file's own header comment ("not a
stub") and the public compliance claim in `docs/security/privacy-review.md`
(Finding 7).

This bug is a strong illustration of *why* Finding 6 (zero functional test
coverage) matters: a `try/catch` with a `console.warn` is exactly the shape
that lets a genuine defect ship silently and stay unnoticed indefinitely —
nothing ever asserted the row count actually went to zero.

## Finding 4 — declared `ON DELETE CASCADE` constraints are inert platform-wide

Deleting the `users` row (step 11) is written as if it were the final,
sweeping cleanup — several tables declare
`FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE`, which reads
as "these clean themselves up when the user is deleted." Grepped for
`PRAGMA foreign_keys` across the entire `server/` tree: **zero results**
except a migration-internal comment and a test-file comment that already
say the quiet part explicitly
(`server/tests/sub-world-spawn-from-forge-mirror.test.js:60`: *"ON DELETE
SET NULL — not enforced without PRAGMA foreign_keys=ON, but..."*).
`better-sqlite3`, like SQLite generally, defaults foreign-key enforcement
**off** per-connection unless a caller explicitly runs
`PRAGMA foreign_keys = ON`; Concord's server never does. That means every
one of the 18 `ON DELETE CASCADE`/`SET NULL` declarations across 10
migration files (`048_sparks.js`, `026_oauth.js`, `011_federation_tiers.js`,
`049_tool_tree.js`, `050_player_inventory.js`, `070_parties.js`,
`051_wagers.js`, `036_personal_locker.js`, `069_player_trade.js`,
`001_core_tables.js`) is **decorative documentation of intent, not an
enforced constraint**. Concretely, deleting the `users` row does **not**
cascade-delete: `player_inventory` (`050_player_inventory.js:16`),
`oauth_connections` (`026_oauth.js:27`), `personal_dtus`
(`036_personal_locker.js:25` — see Finding 5, this is the most sensitive
one), `sparks_ledger`, `parties`, `wagers`, `player_trade`, `tool_tree`
rows, or the 4 FK-bearing relations in `001_core_tables.js`. These become
permanently orphaned rows keyed to a `user_id` that no longer resolves to
any user — invisible garbage, not a privacy leak in the sense of "readable
by someone," but real personal data that was never actually erased despite
the schema author's evident intent that it would be.

## Finding 5 — whole personal-data categories are never referenced by the deletion pipeline at all

Beyond the FK-cascade illusion (Finding 4) and the social-content bug
(Finding 3), several real, substantial data categories are not named
anywhere in `executeAccountDeletion`'s 13 steps — not attempted, not failed,
simply absent:

- **`personal_dtus`** (`server/migrations/036_personal_locker.js:15-27`) —
  a genuinely separate table from the `dtus` table Finding 2's step 1/2
  handle. Columns: `encrypted_content BLOB`, `iv BLOB`, `auth_tag BLOB` —
  this is Concord's *encrypted personal journal/context locker*
  (`server/routes/personal-locker.js`), arguably the single most private
  category of data on the entire platform (its own migration comment: "the
  key itself is never stored — derived at login from password + salt").
  Never touched by account deletion. Single-row deletes exist for a user
  deleting *one* of their own entries (`personal-locker.js:147,180,301`) but
  nothing calls those in bulk on account deletion.
- **`oauth_connections`** (`server/migrations/026_oauth.js:16-29`) — Google/
  Apple sign-in identity links (`provider_user_id`, `email`, `name`,
  `avatar_url`). Never touched. A single-provider disconnect helper exists
  (`server/routes/oauth.js:122-126`) but nothing calls it in bulk.
- **`connector_oauth_tokens`** (`server/migrations/331_connector_oauth_tokens.js:16-29`)
  — real, live Gmail/Google-Calendar `access_token`/`refresh_token` pairs
  (per CLAUDE.md's Track C connectors work — these are genuine external
  credentials, not internal state). Never touched. A single-connector revoke
  helper exists (`server/lib/connector-tokens.js:130-134`) but nothing calls
  it in bulk. Leaving live OAuth credentials behind after "deleting
  everything" is arguably a *security* liability on top of a privacy one.
- **`chat_sessions` / `chat_messages`** (`server/migrations/193_chat_sessions.js:38-59`)
  — the actual persisted conversation history (`role`, `content`, per-turn
  `meta_json`) introduced specifically so conversations survive a restart.
  Never touched.
- **World/avatar/player state** — `avatars`
  (`server/migrations/093_multi_avatar.js:14-23`), `player_inventory`
  (`server/migrations/050_player_inventory.js`), `player_houses`, `player_mail`,
  `player_equipment`, `city_presence`, and the broader Concordia player
  substrate. Never touched (and, per Finding 4, not implicitly cascaded
  either).
- **`STATE.privacyLens`** (`server/domains/privacy.js:21-34`) — the DSAR
  bucket itself, plus cookie config, retention policy, per-lens sharing
  toggles, access log, and data-flow map — is a `globalThis._concordSTATE`
  in-memory structure, `save()`-persisted, per user. Never touched by
  account deletion, and there is no natural place for a SQL-table sweep to
  reach it since it isn't SQL. (There's a defensible argument the DSAR
  *records specifically* should be *retained* even after deletion, as
  evidence the request was received and fulfilled — see the policy table.)

## Finding 6 — zero functional test coverage on a live, irreversible, in-production deletion path

`server/tests/platinum-gdpr.test.js` and
`server/tests/platinum-privacy-review.test.js` are the only test files that
reference account deletion. Both are **static regex scans of source text**
— e.g. `platinum-gdpr.test.js:28`: `assert.ok(/delete.*account|account.*delete|.../i.test(serverJs))`
just confirms *a string resembling account deletion appears somewhere in
server.js*. Neither test creates a user, calls
`requestAccountDeletion`/`executeAccountDeletion`, and asserts what data
survives versus what's gone. Grepped every test file in `server/tests/` for
`requestAccountDeletion`/`executeAccountDeletion`/`account-lifecycle` by
content (not filename) — only the two structural-scan files above reference
it at all. This is precisely the kind of gap that let Finding 3's bug ship
and survive unnoticed: a `try/catch` around a SQL statement whose actual
row-level effect nothing ever asserted.

## Finding 7 — the platform's own public compliance doc overclaims and cites a dead route

`docs/security/privacy-review.md:133` (under "User-facing privacy
commitments," i.e. content that maps to the public `/legal/privacy` policy):

> **You can delete everything, anytime.** Self-service via
> `/api/user/delete`. We tombstone ledger entries for 7y for tax compliance;
> **everything else is hard-deleted.**

Two problems, both confirmed against the running code:

1. **The route doesn't exist.** The real, mounted route is
   `POST /api/account/delete` (`server/routes/account-lifecycle.js:80`,
   mounted at `server.js:33874` under `/api/account`). `/api/user/delete` is
   not a registered route anywhere in `server.js` or `server/routes/`
   (grepped, zero hits).
2. **"Everything else is hard-deleted" is false**, per Findings 3–5: social
   posts and DMs silently survive (a live bug in already-approved,
   already-shipped behavior), and personal_dtus/oauth_connections/
   connector_oauth_tokens/chat history/world-avatar state were never in
   scope of "everything" to begin with.

This is a doc-drift problem CLAUDE.md's own §5 ("Docs are a build artifact,
not prose") explicitly asks to be corrected on discovery, and it's lower-
risk than any code change (no runtime behavior changes) — **corrected as
part of this pass**, see "Corrections made" below. The correction narrows
the public claim to what the code actually does today; it does not invent
new promises.

## What already works (so a future fix doesn't need to re-litigate these)

- **Citation-lineage handling is correct and matches CLAUDE.md's own
  tombstone invariant.** `anonymizeAttribution` (`server/lib/consent.js:341-374`)
  is exactly the "anonymize, don't hard-delete, when others depend on it"
  pattern the DTU forgetting-engine already uses for retention sweeps. A
  future fix connecting DSAR to real deletion does **not** need to touch
  this — it's already right.
- **Economy-ledger tombstoning is correct**, uses the canonical
  `CREDIT_ROW_PREDICATE`, and matches the 7-year legal retention window the
  public docs promise.
- **Marketplace delisting (not deletion) of the seller's own listings is
  correct** — a listing a *buyer* purchased a license against
  (`creative_usage_licenses`) is untouched by the seller's deletion, which
  is the right call (the buyer's purchase shouldn't vanish because the
  seller left).
- **The 90-day balance-forfeit grace period + pending-withdrawal block**
  (`account-lifecycle.js:41-92`) is a reasonable, already-built anti-
  exploit design (matches the withdrawal-hold-hours precedent elsewhere in
  the codebase) — no changes needed there.
- **The explicit `{confirm:"DELETE_MY_ACCOUNT"}` gate** on the real route is
  the right pattern; if DSAR is ever wired to trigger real deletion, it
  should adopt an equivalent explicit-confirmation step rather than
  self-service `dsarAdvance` triggering an irreversible action with a bare
  status-string match.
- **`exportUserData`** (`account-lifecycle.js:261-345`) is a real, broader
  GDPR Article 15 export separate from `privacy.js`'s own `dataExport` — no
  changes needed.

## Options for a future fix (not attempted here — needs an owner decision)

None of these is a small, safe, single-PR change touching the DSAR↔real-
deletion connection; Findings 3–6 mean the *prerequisite* work (fixing the
existing pipeline's own bugs and gaps, and giving it real test coverage) has
to happen regardless of which direction is chosen for DSAR wiring:

1. **Fix Findings 3, 4, 5, 6 first, independent of DSAR.** Repair the
   social-content delete step's column names (and either create
   `social_comments`/`forum_posts` tables or drop them from the loop since
   they don't exist), decide per-category (see policy table below) whether
   to extend `executeAccountDeletion` to also cover personal_dtus/
   oauth_connections/connector_oauth_tokens/chat history/world-avatar state,
   and write a real functional test (create user → seed one row per table →
   delete → assert survivors match the documented policy exactly). This
   makes the *existing* deletion promise true before anyone builds on top of
   it. **Recommended as the correct sequencing regardless of option 2/3.**
2. **Wire `dsarAdvance('completed', kind:'deletion')` to call
   `requestAccountDeletion`.** Straightforward in principle (both already
   exist), but: (a) inherits every gap in Findings 3-5 until option 1 is
   done, (b) needs an explicit re-confirmation step in the DSAR flow to
   match the real route's `{confirm:"DELETE_MY_ACCOUNT"}` gate — advancing
   a status enum by itself is too weak a trigger for an irreversible,
   platform-wide action, (c) needs a decision on whether DSAR-triggered
   deletion goes through the same 90-day balance-forfeit path or should
   behave differently for a DSAR-originated request specifically.
3. **Scope DSAR "deletion" more narrowly than full account deletion**
   (e.g. GDPR-style per-category erasure: "delete my chat history" as a
   distinct DSAR sub-kind from "delete my whole account"). More faithful to
   how DSAR requests actually work in most real systems (a requester can ask
   for partial erasure without leaving the service), but is a genuinely new
   feature — the current `kind` enum (`access|export|deletion|rectification`,
   `server/domains/privacy.js:81`) has no category/scope field, so this
   needs a schema change plus a UI to let the requester specify scope.
4. **Keep DSAR and account-lifecycle separate by design, and instead make
   DSAR "deletion completed" mean "an operator confirms the real
   `/api/account/delete` flow was separately completed for this user."**
   I.e. DSAR stays a pure audit/workflow-tracking layer (which several real
   DPO tools do — the request record and the execution are deliberately
   decoupled for audit-trail integrity), and the fix is UX-only: surface a
   "start real account deletion" link/button from the DSAR panel instead of
   auto-triggering it from a status change. Lowest-risk option since it adds
   no new destructive code path at all — but it means "deletion" DSAR
   `kind:"access"`/`"export"`/`"rectification"` still need their own honest
   disposition (this doc doesn't investigate those three; they may have the
   same "tracks but doesn't act" shape and deserve the same scrutiny in a
   follow-up pass).

**Recommendation for the eventual owner:** do option 1 first regardless of
which of 2/3/4 is chosen for the DSAR-specific wiring — the existing
pipeline making a false "everything is hard-deleted" claim (Finding 7) is
independently worth fixing on its own compliance merits, whether or not DSAR
ever calls it directly.

## Per-category data-deletion policy — for the owner to ratify

Every category below is a *real* table/store found during this
investigation (not exhaustive of Concord's ~674 tables — this lists every
category with a plausible personal-data claim that surfaced while tracing
`executeAccountDeletion`'s scope and its gaps). "Existing coverage" reflects
what the code does today, not what any doc claims.

| Category | Examples | Existing coverage | Recommended policy | Rationale |
|---|---|---|---|---|
| Account credentials | `users` (email/username/password_hash) | Hard-deleted (step 11) | **HARD-DELETE** (keep as-is) | Single-user-scoped, no dependents once everything else is handled |
| Sign-in identity links | `oauth_connections` | **Not touched** (Finding 5) | **HARD-DELETE** | Single-user-scoped, no cross-user dependency |
| Connector credentials | `connector_oauth_tokens` (Gmail/Calendar access+refresh) | **Not touched** (Finding 5) | **HARD-DELETE, high priority** | Live external credentials; leaving them is a security liability, not just a privacy one; zero cross-user dependency |
| Encrypted personal locker | `personal_dtus` (journal/context, `encrypted_content`) | **Not touched** (Finding 5) | **HARD-DELETE** | The most private category on the platform by design (per-user encryption); zero cross-user dependency |
| API keys | `api_keys` | Hard-deleted (step 6) | **HARD-DELETE** (keep) | Correct as-is |
| Public/personal DTU substrate | `dtus`, `royalty_lineage` | Anonymize if cited, else delete (steps 1-2) | **Keep as-is** | Already correctly implements the citation-lineage tombstone precedent |
| Marketplace listings (as seller) | `creative_artifacts` | Delisted, not deleted (step 3) | **Keep as-is** | Preserves discoverability/audit trail without re-offering the item |
| Purchased licenses (as buyer) | `creative_usage_licenses` | Not touched by seller deletion (correct by omission) | **OUT OF SCOPE for the *deleted* user's own request** — belongs to the buyer | A buyer's purchase should survive the seller's departure |
| Economy / financial ledger | `economy_ledger` | Anonymized/tombstoned (step 8) | **REDACT-AND-RETAIN** (keep) | 7-year legal/tax retention; matches stated policy |
| Own social posts | `social_posts` | **Attempted, silently fails** (Finding 3) | **HARD-DELETE** (fix the bug — this is already the intended, approved policy) | Single-author content, no cross-user dependency |
| Direct messages | `direct_messages` | **Attempted, silently fails** (Finding 3) | **NEEDS A POLICY DECISION, not just a bug fix** | Two-party data: hard-deleting by `sender_id OR recipient_id` also erases the *other* party's copy of a conversation they didn't ask to have erased. Real messaging products typically render `[deleted user]` rather than vanish the counterparty's message history. Fixing only the column-name bug without addressing this restores the current (arguably wrong) intended behavior; worth an explicit ratify-or-change call |
| XP / quest completions / leaderboards | `user_xp`, `quest_completions`, `creative_xp`, `leaderboard_entries` | Hard-deleted (steps 9-10) | **HARD-DELETE** (keep) | Correct as-is |
| Consent records | `user_consent` | Hard-deleted (step 7) | **HARD-DELETE** (keep) | Correct as-is |
| Chat history | `chat_sessions`, `chat_messages` | **Not touched** (Finding 5) | **HARD-DELETE** (verify no shared/multi-party session shape first) | Single-user-scoped for normal sessions; check the codebase's `sharedConversation` prompt path (`prompt-registry.js`) doesn't imply multi-owner sessions before blanket-deleting |
| World/avatar/player state | `avatars`, `player_inventory`, `player_houses`, `player_mail`, `player_equipment` | **Not touched, and FK cascades are inert** (Findings 4-5) | **NEEDS AN OWNER DECISION** | Per CLAUDE.md's own "player inventory is user-global" + crafting/trade invariants, some inventory items may carry cross-user trade/gift/craft provenance — an unqualified hard-delete could be fine or could interact with systems this investigation didn't trace (auction house, player trade, gifting). Not "unambiguously theirs alone" the way the task's safe-narrow-case criteria require |
| Privacy lens's own DSAR/config state | `STATE.privacyLens` (dsars, accessLog, cookieConfig, retention, flows, lensSharing) | **Not touched** | **REDACT-AND-RETAIN the DSAR records specifically; HARD-DELETE the rest** | DSAR records are the compliance evidence that the request was made and fulfilled — deleting them alongside the account removes the audit trail a regulator might later ask for. Cookie/retention/sharing config has no ongoing purpose once the account is gone |
| Federation-propagated shadow DTUs on peer instances | cross-instance | **Not addressed by anything in Concord today** | **OUT OF SCOPE** for a single-PR fix | No protocol exists for one instance to request a peer instance delete a propagated shadow DTU; this is a federation-protocol-level gap, not an account-lifecycle one |
| Artifact blob files on disk | `data/artifacts/{dtuId}/…` | Not deleted synchronously, but **eventually GC'd**: `server/lib/artifact-gc.js` runs a weekly sweep (`GC_INTERVAL_MS`, `:24`) that deletes any artifact file with zero live DTU references, which orphaned files become once step 2 deletes their owning DTU row | **Acceptable as eventual-consistency (no code change needed)** | Not a defect — just not immediate; worth documenting the ~weekly lag if the public policy ever says "immediately" |

## What I did NOT do, and why (explicit safety confirmation)

Per this task's explicit mandate, I did **not**:

- Wire `dsarAdvance` to call `requestAccountDeletion`/`executeAccountDeletion`
  or any other real-data mutation. The underlying deletion logic already
  exists and is tested-by-existence (mounted, reachable), but connecting a
  new, weakly-gated trigger (Finding 1) to an already-imperfect, untested,
  irreversible pipeline (Findings 3-6) inside a single investigative pass is
  exactly the "implementing destructive logic to close the gap" pattern the
  brief told me to avoid by default.
- Fix the empirically-confirmed social-content deletion bug (Finding 3),
  even though it is narrowly scoped, single-file, and touches no DTUs /
  economy ledger / citation lineage. I judged it out of scope for this pass
  because: (a) it's a bug fix inside the same untested, irreversible,
  in-production account-deletion transaction, and shipping a partial fix
  there while its sibling gaps (personal_dtus, chat, connector tokens, the
  FK-cascade illusion) remain undocumented risks a misleadingly "more done"
  appearance without the test coverage to back it; (b) the direct-messages
  half of the same bug has a real, unresolved *policy* question (the
  two-party erasure problem in the table above), not just a syntax error —
  fixing the `social_posts` half alone while leaving `direct_messages`
  broken (or half-fixing it into a policy nobody ratified) is worse than
  leaving both as a clearly-documented, single coherent finding for the
  owner to act on together, with a real test written alongside the fix.
- Modify `account-lifecycle.js` to add the missing categories from Finding
  5. Several of them (world/avatar/player state especially) have real,
  unresolved cross-user-dependency questions this investigation surfaced but
  did not resolve (see the policy table) — exactly the class of decision
  this task asked me to escalate rather than answer myself.
- Touch `server/emergent/forgetting-engine.js` or the `dtu:deleted`
  hard-delete event path at all. Nothing in this investigation required
  it, and CLAUDE.md's own invariant explicitly warns against extending
  hard-delete paths into retention-sweep territory.

**What I did do, as pure documentation corrections (zero runtime behavior
change, matching CLAUDE.md §5's "kill drift" discipline):** corrected the
route citation and the overclaim in `docs/security/privacy-review.md`
(Finding 7), and updated `docs/WAVE4_INVENTORY.md`'s `privacy` row and
`docs/lens-specs/privacy-capability-map.md`'s DSAR bullet to point here with
the confirmed, expanded finding.

## Corrections made to other docs as a result of this investigation

- `docs/WAVE4_INVENTORY.md` — the `privacy` row's DSAR item updated to point
  to this doc, correcting the framing from "doesn't execute a real
  cross-lens purge" (which reads as "no deletion capability exists") to the
  confirmed, more precise finding: a real, separate deletion pipeline exists
  and is live, but is disconnected from DSAR and has its own independently
  confirmed bugs/gaps.
- `docs/lens-specs/privacy-capability-map.md` — the "Genuinely missing"
  DSAR bullet updated with a pointer to this doc and the corrected framing.
- `docs/security/privacy-review.md` — Article 17 row and the "You can delete
  everything, anytime" user-facing commitment corrected: the route citation
  fixed (`/api/account/delete`, not `/api/user/delete`) and the "everything
  else is hard-deleted" claim narrowed to reflect Finding 3 honestly (social
  content is not currently deleted due to a live bug) rather than continuing
  to overclaim compliance the code doesn't yet deliver.
