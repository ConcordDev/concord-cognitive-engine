# Mail Lens — Capability Map (Frontend Rebuild Program)

> Derived, not asserted. Every number below has a reproduction command; every
> classification is backed by a grep or a full read of the file it's about.

## Backend surface

```
grep -c 'register("mail"' server/domains/mail.js
```
→ **6** macros: `list`, `sent`, `get`, `send`, `read`, `claim` (`server/domains/mail.js`,
127 lines). Every macro is a thin `ctx`/actor-resolution + input-validation
wrapper that delegates to the single engine in `server/lib/player-mail.js`
(`sendMail`, `listInbox`, `listSent`, `getMail`, `readMail`,
`claimAttachments`) — no duplicated wallet/DTU/COD logic in the domain file,
confirmed by full read.

```
grep -c 'app\.\(get\|post\)("/api/mail' server/server.js
```
→ **6** REST routes at `server/server.js:52768-52813`
(`POST /api/mail/send`, `GET /api/mail/inbox`, `GET /api/mail/sent`,
`GET /api/mail/:id`, `POST /api/mail/:id/read`, `POST /api/mail/:id/claim`).
Each route does a plain `await import("./lib/player-mail.js")` and calls the
exact same exported function as the macro of the same name — confirmed by
full read of both files. **The domain file's own header comment is
accurate**: the REST routes are the primary path the `/lenses/mail` page
uses; the macros exist so the same engine is reachable via
`/api/lens/run` + MCP dispatch. There is no parallel/fake logic anywhere in
this surface — one engine, two front doors, verified consistent.

`server/lib/player-mail.js` (345 lines) is the real engine: WoW-style async
player-to-player mail with a 30-day TTL, escrow-on-send, and a
single-transaction claim (`db.transaction(...)` wrapping COD debit/credit +
DTU ownership transfer + status flip — the invariant named in
`CLAUDE.md`). A `mail-expiry-sweep` heartbeat (`server/server.js:514`) calls
`sweepExpiredMail` to refund escrowed CC to the sender and mark stale mail
`expired`.

Full capability inventory read off the engine:
- `sendMail`: `fromUserId, toUserId, subject, body, attachmentDtuIds[]
  (≤12), attachmentCc, codCc, worldId?` — escrows `attachmentCc` from the
  sender immediately (so claim can never fail on the sender having since
  spent it), stamps a `mail_escrow` marker onto each attached DTU.
- `listInbox` / `listSent`: optional `status` filter (`unread|read|claimed|
  expired`) and `limit` (capped 200).
- `getMail`: participant-only (sender or recipient), else `null`.
- `readMail`: idempotent unread→read flip, recipient-only.
- `claimAttachments`: single-transaction COD (recipient pays sender) +
  attachment-CC release (sender's escrow → recipient) + DTU ownership
  transfer + status→`claimed`. Idempotent (`alreadyClaimed: true` on
  re-claim). Rejects `expired` mail.
- `sweepExpiredMail`: heartbeat-only, refunds escrow, marks `expired`.

## The defect: DTU attachments were send-only-invisible — the UI could
## display them but never let a player attach one

`concord-frontend/app/lenses/mail/page.tsx` (377 lines before this pass) was
otherwise a genuinely real, honest WoW-style mail client — not a generic
scaffold. Full read + `grep -n
"Math.random|MOCK|mock|fake|Lorem|lorem|hardcoded" app/lenses/mail/page.tsx`
→ empty, confirmed before touching anything. It already:
- Fetched real inbox/sent via `/api/mail/inbox` + `/api/mail/sent`, with
  honest loading/error/empty states (pinned by
  `concord-frontend/tests/components/MailPage.test.tsx`'s four UX-state
  tests — left unmodified by this pass).
- Read-on-select (`POST /api/mail/:id/read`), a real unread-count badge,
  socket-driven `mail:received` refetch (not a dead `window` listener —
  also pinned by that test file).
- A full claim flow (`POST /api/mail/:id/claim`) surfacing the exact
  `payout.attachmentCc` / `attachments.dtuIds` shape the engine returns, and
  correctly branching UI copy for `claimed` vs. `expired` mail.
- A compose form for recipient/subject/body/**CC gift**/**COD**, posting the
  exact field names `sendMail` expects.

**But the inbox/detail views render DTU-attachment chips
(`attachment_dtu_ids.length`, a `Package` icon) for received mail, while the
compose form had no field of any kind for `attachmentDtuIds`.** A player
could receive a DTU-bearing letter and see it rendered, but could never
compose one — the capability was asymmetric: real on the read side, entirely
absent (not stubbed, not a generic strip — just missing) on the write side,
even though the engine has supported `attachmentDtuIds` (up to
`MAX_ATTACHMENTS = 12`) since this file was written (confirmed:
`server/tests/mail-domain-macros.test.js`'s core round-trip test exercises
exactly this field and has since the file was authored). Classification:
**UNSURFACED** — a real, tested backend capability with zero UI path.

A secondary, smaller gap: `listInbox`'s `status` filter (`unread/read/
claimed/expired`) and a free-text search were both real, cheap, honest
capabilities to add — the REST route already accepts `?status=`, and the
already-fetched rows already carry `subject`/`body`/`status` — but the page
exposed neither a filter control nor a search box, so a growing inbox had no
way to narrow itself. This is the "full app, not almost one" bar from
`CLAUDE.md` (a Gmail-shaped app without All/Unread and search reads as
unfinished), not a backend/frontend field-shape mismatch.

## What changed

**`concord-frontend/app/lenses/mail/page.tsx` — three additive changes, no
removed capability, no field-shape changes to the existing send/claim/read
paths (both REST calls and their body/query shapes are unchanged).**

1. **DTU attachments are now composable.** Added a "DTU attachments" section
   to the Compose tab: an "Attach from my DTUs" button opens
   `components/dtu/DTUPickerModal` (an existing, real, already-used-elsewhere
   component — `app/lenses/studio/page.tsx` uses the identical pattern) with
   `filter="user"` ("My Creations" — the sender can only attach DTUs they
   own, matching the engine's ownership-gated escrow stamp
   `WHERE id = ? AND creator_id = ?`). Selected DTUs render as removable
   chips, capped client-side at `MAX_ATTACHMENTS = 12` (a UX guard mirroring
   the server's real cap — the server's `.slice(0, MAX_ATTACHMENTS)` is the
   actual enforcement, not duplicated here). On submit, `handleSend` now
   posts `attachmentDtuIds: composeAttachments.map(d => d.id)` alongside the
   existing `attachmentCc`/`codCc` fields — no new endpoint, no new macro,
   the exact field `sendMail` has always accepted.
2. **Inbox status filter.** A `role="group"` chip row (`All / Unread / Read
   / Claimed / Expired`) filters the already-fetched inbox rows client-side
   by `status`. (Client-side, not a re-fetch with `?status=`, because the
   full inbox is already in memory and re-filtering it is instant — no
   reason to round-trip for data already on hand.)
3. **Search box.** A text input filters the active folder's rows by
   subject/body/counterparty substring match — again client-side over
   already-real, already-fetched data; no fabricated search index, no new
   backend call.
4. Empty-state copy now distinguishes "no mail at all" from "no mail
   matches this filter/search" (previously always said "No mail" even when
   a filter had legitimately zeroed the list) — an honesty fix, not just
   polish: the old copy would have told a user with 40 pieces of mail and an
   active "Expired" filter that returned 0 rows that they had no mail at
   all.

No backend files were modified — `server/domains/mail.js` and
`server/lib/player-mail.js` were read in full and found to already
correctly implement every capability the rebuilt UI now surfaces. This is a
pure frontend wiring fix.

## Confirmed real and already correctly wired (no changes needed)

Read the full page (377 → 424 lines) both before and after edits; the
following were already genuinely real and are unchanged:
- Compose → `sendMail` field-shape parity (`toUserId, subject, body,
  attachmentCc, codCc` — every field name matches the engine exactly).
- Claim flow → `claimAttachments` response shape
  (`payout.attachmentCc`, `attachments.dtuIds`) consumed correctly in the
  flash-toast message.
- Read-on-select → `readMail`, idempotent, recipient-gated server-side.
- Realtime `mail:received` subscription → matches the exact event name
  emitted by `POST /api/mail/send`'s `realtimeEmit` call
  (`server/server.js:52775`).
- Compose deep-link prefill (`?to=` query param) → matches
  `components/world/FriendsPresencePanel.tsx:309`'s
  `` `/lenses/mail?to=${encodeURIComponent(f.friendUserId)}` `` link — the
  only other place in the frontend that references the mail lens, confirmed
  by `grep -rn "lenses/mail"`.
- Expiry messaging (`"Expired — attachments returned to sender."`) → matches
  `sweepExpiredMail`'s actual refund behavior.

## Verification

- `node --check server/domains/mail.js` — clean (unmodified file).
- `node --check server/lib/player-mail.js` — clean (unmodified file).
- `cd server && node --test tests/mail-domain-macros.test.js
  tests/player-mail.test.js tests/player-mail-realdb.test.js` —
  **28/28 pass**, unmodified (0 backend files touched, so this is a
  regression check, not new coverage).
- `cd concord-frontend && npx eslint app/lenses/mail/page.tsx` — clean, exit
  0. (No `components/mail/` directory was created — the DTU-attach UI reuses
  the existing shared `DTUPickerModal`, so there is no new component file to
  lint.)

## Left alone, with reason

- **`mail.get` / `GET /api/mail/:id` has no dedicated frontend call site.**
  `listInbox`/`listSent` already return full mail rows (subject, body,
  attachments, status, timestamps) in one round trip, so selecting a row
  from the list needs no follow-up fetch. A single-mail GET would only earn
  its keep for a direct-link-to-one-letter deep link, which nothing in the
  product currently asks for. Left unsurfaced — not a defect, a genuinely
  redundant capability given the list shape.
- **`worldId` is not shown or settable in the UI.** Per `CLAUDE.md`'s
  player-inventory invariant, `world_id` on a mail row is
  acquisition/context metadata, not a visibility or gameplay filter — mail
  is user-to-user, not per-world, and nothing in `player-mail.js` ever
  queries by `world_id`. Surfacing a field that affects nothing would be
  clutter, not honesty.
- **Sender-side escrow / COD / single-transaction claim internals** — left
  completely untouched; these are the load-bearing money-safety invariants
  named in `CLAUDE.md` ("Mail attachments transfer is single-transaction")
  and this pass is a pure frontend wiring fix with zero backend edits.

## Genuinely missing (deferred, not faked) — CLOSED (Wave 4 gap-closure, 2026-07-11)

- ~~**No way to browse/search *other users* to pick a recipient.**~~ **Fixed —
  ENGINEERING-class, no new backend surface needed.** The real endpoint
  already existed: `GET /api/social/users/search?q=` (`server/routes/social-groups.js`,
  a genuine `SELECT id, username, email FROM users WHERE is_active = 1 AND
  (username LIKE ? OR email LIKE ?)` query, mounted at `/api/social`) — and a
  frontend consumer of it already existed too:
  `concord-frontend/components/message/RecipientSearchInput.tsx`, built for
  the message lens's own identical gap and left unreused until now. The mail
  compose tab (`concord-frontend/app/lenses/mail/page.tsx`) now mounts that
  same component for its recipient field: type-ahead search-and-pick, debounced
  300ms, resolves to the user's real `id` (never free text once a result is
  picked), degrades honestly to manual-id-entry (unchanged `composeTo` state)
  if the search API errors. No backend files touched. Manual paste of a known
  id still works — the component doesn't remove that path, only adds search on
  top of it. Pinned by `concord-frontend/tests/components/MailPage.test.tsx`'s
  `compose: recipient is picked from a real user search, not typed as a raw
  id` test (asserts the exact `api.get('/api/social/users/search', { params:
  { q } })` call and that selecting a result sets `composeTo` to the returned
  `id`, not the typed query text).
