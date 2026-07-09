# LFG (Looking For Group) Lens — Capability Map (Verify-Pass)

> Derived, not asserted. This is a **verify-pass**, not a rebuild — a prior
> audit had flagged `lfg` as an incomplete "retry backlog" item
> (`docs/FRONTEND_REBUILD_PROGRAM.md`), but that flag was about the *rebuild
> session* running out of token budget before attempting the lens, not about
> the lens's actual quality. This pass re-verified the claim from scratch and
> found `app/lenses/lfg/page.tsx` (278 LOC) is already a real, bespoke,
> fully-wired app. No rebuild was performed or needed.
>
> Backend surface enumerated by reading `server/domains/lfg.js` (macro
> registrations) + `server/lib/lfg.js` (implementation) + grepping
> `server.js` for `/api/lfg`. Reproduce the route list:
> `grep -n '"/api/lfg' server/server.js`
> Reproduce the macro list:
> `grep -n 'register("lfg"' server/domains/lfg.js`

## Backend surface

The `lfg` domain is intentionally small — Phase U5 (matchmaking) shipped a
tight, single-purpose feature: post a group request, browse open requests,
invite a poster into your party, cancel your own post. There is no larger
unsurfaced surface hiding behind this — the domain has exactly 4 read/write
capabilities plus one heartbeat-only maintenance function.

### REST routes — `server/server.js` (4)

| Route | Auth | Real result shape | Classification |
|---|---|---|---|
| `POST /api/lfg/post` | required | `{ok, id}` — inserts `lfg_requests` row, auto-cancels the caller's prior open request in the same world | **DESIGNED** — "Post your own" form |
| `GET /api/lfg/open` | public (in `publicReadPaths`, line 6297) | `{ok, requests:[{id,userId,worldId,role,partyType,note,createdAt,expiresAt,partyMaxSize,currentSize}]}` | **DESIGNED** — "Open requests" list, live-polled every 8s + on filter change |
| `POST /api/lfg/:lfgId/cancel` | required | `{ok}` or `{ok:false, error:"not_open_or_unauthorized"}` | **DESIGNED** — "Cancel" button on the caller's own rows |
| `POST /api/lfg/:lfgId/invite` | required | `{ok, partyId, inviteId}`; emits `lfg:matched` realtime event | **DESIGNED** — "Invite" button on other players' rows |

### Registered macros — `server/domains/lfg.js` (4)

Thin delegation layer over the same `server/lib/lfg.js` functions the REST
routes call — a registry-addressable parity surface for the macro dispatcher
and invariant engine, not additional capability. The lens correctly talks to
the REST routes directly (1:1 field-shape match verified against
`listOpenLfg`'s SQL column aliasing), which is a legitimate wiring choice —
no capability is missed by not going through `POST /api/lens/run`.

| Macro | Delegates to | Covered by page via |
|---|---|---|
| `lfg.post` | `postLfg` | `POST /api/lfg/post` (same lib fn) |
| `lfg.list` | `listOpenLfg` | `GET /api/lfg/open` (same lib fn) |
| `lfg.cancel` | `cancelLfg` | `POST /api/lfg/:lfgId/cancel` (same lib fn) |
| `lfg.join` | `inviteFromLfg` | `POST /api/lfg/:lfgId/invite` (same lib fn) |

Also registered in `lib/lenses/manifest.ts:5273` (`domain: 'lfg'`, macros
`list`/`get`/`create`/`run` mapped to `lfg.list`/`lfg.list`/`lfg.post`/
`lfg.join`) — consistent with the above.

### Heartbeat-only (not user-facing, correctly unsurfaced)

- `sweepExpiredLfg` (`server/lib/lfg.js:127`) — registered as
  `lfg-expiry-sweep` heartbeat (`server.js:481`). Flips `open` rows past
  `expires_at` to `expired`. No frontend surface needed; this is
  maintenance, not a capability.

## Coverage verdict

**4/4 real user-facing capabilities are DESIGNED, 0 UNSURFACED, 0
GENERIC-STRIP-ONLY.** Every route the domain exposes has a corresponding,
purpose-built UI element:

- Post → right-column form (world/role/party-type/note, honest submit
  busy-state, replaces-prior-post notice)
- List/browse → left-column list with world + role filters, live 8s poll,
  background-refresh-without-flicker behavior
- Invite → per-row "Invite" button (hidden on the caller's own rows)
- Cancel → per-row "Cancel" button (shown only on rows the session created,
  tracked via `ownPosts` ref since the open-list API is anonymous)

## Dead-panel check

None found. Both panels (open-requests list, post-your-own form) are fully
data-driven:
- The list panel implements all 4 honest UX states (loading / error+retry /
  empty / populated) per `CLAUDE.md`'s honest-by-construction rule — no
  panel is permanently empty or static.
- The form panel's `WORLDS`/`ROLES` arrays are structural UI vocabulary
  (dropdown options mirroring the DB `CHECK` constraints in migration
  `219_party_lfg.js`), not content masquerading as live data.

## Fake-data check

Ran the exact three rules from `server/lib/detectors/frontend-fake-data-detector.js`
by hand against `page.tsx`:

1. **`hardcoded_array_rendered_as_live_data`** — `WORLDS`/`ROLES` are
   arrays of bare strings, not object literals, so `extractArrayShape`
   would find `objectCount === 0` — the rule doesn't even fire on them (and
   correctly so: they're a static enum, not fabricated content).
2. **`math_random_in_render`** — no `Math.random()` anywhere in the file.
3. **`placeholder_content_in_jsx`** — no lorem/sample/dummy/fake/mock/TODO
   strings in any rendered string literal. (The `<textarea>` has no
   `placeholder=` attribute at all — the "Note (optional)" field relies on
   its `<label>`.)

No `components/lfg/*` directory exists — the lens is correctly
self-contained in the single page file with no companion component tree to
also check.

## Adjacent observation (out of scope, not fixed here)

`concord-frontend/components/world/LFGBoardPatch.tsx` — actually
`LFGBoardPanel.tsx` (a **different** component, mounted from the world lens
via the `concordia:open-lfg-board` event from the command palette's "Find a
group" action, not part of `/lenses/lfg`) — fetches `GET /api/lfg?worldId=…`
(no `/open` suffix). That bare route does not exist in `server.js` (only
`/api/lfg/post`, `/api/lfg/open`, `/api/lfg/:lfgId/cancel`,
`/api/lfg/:lfgId/invite` are registered), so that panel's fetch will 404.
This is a real defect but lives in a different file/surface than the one
this task scoped (the `/lenses/lfg` page itself is unaffected — it correctly
calls `/api/lfg/open`). Flagging for a separate, small follow-up fix
(`LFGBoardPanel.tsx:52` — change `/api/lfg?` to `/api/lfg/open?`), not
addressed in this verify-pass per the task's small-scope guidance (this
lives outside the audited lens's own files).

## Verification run

- `npx vitest run tests/components/LfgLensPage.test.tsx` → 5/5 passing
  (loading / error+retry / empty / populated / a11y states).
- No files were modified in this pass (verify-only; the lens needed no
  fixes).

## Disposition: **verified clean, no rebuild needed**

The prior "retry backlog" filing was accurate about *why* the lens wasn't
attempted (session token limit during a batch run) but not about the
lens's actual state — `lfg` was already a real, bespoke, honestly-wired app
before this pass. Recommend removing `lfg` from any remaining
Wave-1-retry backlog language in `docs/FRONTEND_REBUILD_PROGRAM.md`.
