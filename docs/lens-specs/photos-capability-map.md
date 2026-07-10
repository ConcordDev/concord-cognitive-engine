# Photos Lens — Capability Map (Verify-Pass)

> Derived, not asserted. This is a **verify-pass** per `docs/FRONTEND_REBUILD_PROGRAM.md`'s
> per-lens rebuild loop step 1 (capability audit) — not a rebuild. A prior audit had
> mis-filed `app/lenses/photos/page.tsx` as an incomplete "retry backlog" item; this
> pass confirms the page is a real, bespoke surface (not the generic scaffold) and
> corrects that filing. One real gap was found and fixed inline (small scope): the
> gallery never actually rendered the photo bytes it stores. See "What was fixed" below.
>
> Reproduce the macro/route list:
> `grep -n "register(\"photos\"" server/domains/photos.js`
> `grep -n "app\.\(get\|post\)(\"/api/photos" server/server.js`

## Backend surface

### Registered macros — `server/domains/photos.js` (4)

| Macro | Real result shape | Classification |
|---|---|---|
| `photos.list` | `{ok, photos:[{id, world_id, caption, taken_at, dtu_id, visibility}], count}` — caller's own gallery, `db.prepare`-backed, never leaks across users | **DESIGNED** — page.tsx's "My photos" tab (via the equivalent REST route, see below) |
| `photos.get` | `{ok, photo:{id, user_id, world_id, caption, taken_at, dtu_id, visibility, blob_path}}` — single row, owner-or-public gate, 404s on a private photo it doesn't disclose | **UNSURFACED** — no single-photo detail/lightbox view exists in the frontend; every photo is only ever seen as a gallery-card summary. Legitimate gap, but out of "small scope" for this verify-pass (would need a new detail modal/route, not a quick wire) |
| `photos.world` | `{ok, photos:[...], count}` — public feed for a world | **DESIGNED** — "World feed" tab |
| `photos.share` | delegates to `sharePhoto()` — mints a `kind='photo'` DTU + flips visibility public, owner-gated | **DESIGNED** — Share button on each "My photos" card |

### REST routes — `server/server.js` (5, +1 added this pass)

The file header of `domains/photos.js` states the REST routes and macros are
"byte-for-byte consistent" — they call the identical lib functions in
`server/lib/photo-gallery.js`. The frontend page talks to the REST routes
directly (not through `lensRun`); this is a normal, established pattern in
this codebase (same as several other lenses) and is not a gap.

| Route | Real behavior | Frontend caller |
|---|---|---|
| `POST /api/photos/save` | writes the PNG blob to `./data/photos/<id>.png` (5MB cap, `data:image/png;base64,...` input) + inserts the `user_photos` row | `components/world/PhotoMode.tsx` (the in-world freecam capture UI, opened with `P`) — correctly NOT in the gallery lens, since capture happens in the world lens |
| `POST /api/photos/:photoId/share` | owner-gated; mints DTU, flips visibility public | `app/lenses/photos/page.tsx` `share()` |
| `POST /api/photos/:photoId/delete` | owner-gated; deletes row + unlinks blob | `app/lenses/photos/page.tsx` `remove()` |
| `GET /api/photos/mine` | caller's own gallery | `app/lenses/photos/page.tsx` `refreshMine()` |
| `GET /api/photos/world/:worldId/public` | public feed for a world (in `publicReadPaths`, works unauthenticated) | `app/lenses/photos/page.tsx` `refreshWorld()` |
| `GET /api/photos/:photoId/image` **(added this pass)** | streams the actual blob bytes via `res.sendFile`, owner-or-public gate, 404 for a private photo without disclosing existence | `app/lenses/photos/page.tsx` photo card `<img>` **(added this pass)** |

## What was fixed (small-scope, inline)

**Real gap found:** the photo gallery stores real PNG blobs (`./data/photos/<id>.png`,
per CLAUDE.md's documented substrate) and every other verb (save/share/delete/list/
world-feed) was genuinely wired — but **no route anywhere served those bytes back to a
browser**, and `page.tsx` rendered only caption text + timestamp, never an `<img>`. This
is not fabricated data (nothing invented a fake thumbnail) — it's a load-bearing
omission: a "photo gallery" that could not show a photo. Confirmed by direct grep
(`grep -n "blob_path\|Content-Type.*image\|express.static" server/server.js`) turning up
zero image-serving code, and by reading `page.tsx` end-to-end (no `<img>`/`<Image>`
anywhere in the file pre-fix).

Fixed:
1. `server/server.js` — new `GET /api/photos/:photoId/image` route (placed next to the
   other `/api/photos/*` routes). Mirrors the `photos.get` macro's owner-or-public gate
   (a private photo 404s for a non-owner without disclosing existence); serves via
   `res.sendFile(path.resolve(row.blob_path))` — same idiom as the existing
   `/api/artifact/:dtuId/thumbnail` route. `Cache-Control: public, max-age=3600` for
   shared photos, `private, no-store` for private ones.
2. `server/server.js` — added a Gate-1 (`authMiddleware`) regex bypass
   (`/^\/api\/photos\/[^/]+\/image$/`, GET-only, only when no auth cookie/header is
   present) so an anonymous `<img src>` request for a *public* photo isn't 401'd before
   it reaches the route's own gate — an `<img>` tag can't attach a bearer header. An
   authenticated request (cookie present) still runs the full pipeline, so `req.user`
   is populated for the owner-viewing-their-own-private-photo case.
3. `concord-frontend/app/lenses/photos/page.tsx` — each gallery card now renders
   `<img src={`/api/photos/${p.id}/image`} loading="lazy" ... />` inside a fixed
   aspect-ratio frame, with an honest `onError` degrade (hides the broken-image icon
   rather than fabricating a placeholder thumbnail — the caption text still identifies
   the entry).
4. `concord-frontend/tests/photos-lens-states.test.tsx` — added a pinning test
   asserting the READY state renders an `<img>` with the correct `src` and
   `loading="lazy"`.

Verified: `server/tests/photo-gallery.test.js` (10/10) + `server/tests/photos-domain-macros.test.js`
(6/6) still pass unchanged (lib-level, untouched by this fix); `node --check server/server.js`
clean; `concord-frontend` eslint clean on both touched files (repo convention
`eslint-disable-next-line @next/next/no-img-element` matches ~10 other dynamic-image call
sites in the codebase, e.g. `components/dtu/DTUEmbed.tsx`, `components/dtu/CreatorBadge.tsx`);
all 45 tests across the 5 photos-related frontend test files pass
(`tests/photos-lens-states.test.tsx`, `tests/lenses/photos-page.test.tsx`,
`tests/photo-mode-freecam.test.tsx`, `tests/photography-lens-states.test.tsx`,
`tests/lib/lenses/manifest.test.ts`).

**Sandbox note:** a full server-boot HTTP smoke test (register → save → fetch-as-anon
(expect 404) → fetch-as-owner (expect 200 + correct bytes) → share → fetch-as-anon
(expect 200)) was attempted but this environment has no network egress; an unrelated
background heartbeat (`entity-web-exploration`, fetching `robots.txt` for scheduled
web research) throws an uncaught `fetch failed` exception a few seconds after boot
regardless of this change, crashing the process before the route could be exercised —
both with and without the `tests/preload/no-egress.mjs` guard. This is a pre-existing
environment constraint, not something introduced by this fix. The route was verified by
static code review against the two closest existing precedents in this file
(`/api/artifact/:dtuId/thumbnail`'s `res.sendFile` pattern, `/api/worlds/:worldId/health`'s
regex Gate-1 bypass pattern) plus `node --check`.

## Dead-panel check

None found. Every rendered element in `page.tsx` traces to live fetched state
(`mine`/`worldFeed` from the two GET routes). The tab switch, world-id input, refresh
button, share/delete actions, and all four UX states (loading/error/empty/populated)
are real and exercised by `tests/photos-lens-states.test.tsx` (9/9 passing, including
the two new assertions from this pass).

## Fake-data check

Ran the three `frontend-fake-data-detector.js` rules manually against `page.tsx` and
`components/photos/*` (the latter directory does not exist — there is no separate
components dir for this lens, everything lives in the one page file):

1. **`hardcoded_array_rendered_as_live_data`** — no hardcoded array-of-objects literal
   in the file; `mine`/`worldFeed` are `useState` variables populated only from `fetch`
   responses.
2. **`math_random_in_render`** — zero `Math.random()` calls in the file.
3. **`placeholder_content_in_jsx`** — zero lorem/sample/dummy/fake/mock/TODO strings.
   The only "Untitled" fallback text is an honest label for a real null `caption`
   field, not fabricated content.

Clean on all three rules, before and after this pass's fix.

## Macro coverage sanity check

The `photos` domain is intentionally small (4 macros) — it is a thin, single-purpose
lens (capture happens in the world lens via `PhotoMode.tsx`; this lens is purely the
gallery/browse/share surface for what's already been captured). All 4 macros map
1:1 onto real REST routes with identical backing logic; 3 of 4 are DESIGNED, 1
(`photos.get`) is UNSURFACED but low-priority (a detail-view enhancement, not a broken
promise — the gallery card view already surfaces every field `photos.get` would add
except the image itself, which this pass fixed via the REST image route instead).
Given the domain's narrow, correctly-scoped surface, 3/4 macros DESIGNED + the REST
surface fully wired is a reasonable coverage ratio — there is no "dark tail" here.

## Disposition

**Small-fix.** The lens was correctly identified by the prior audit as a real, bespoke
page (not scaffold) with honest 4-state handling and real wiring for list/share/delete/
world-feed. This pass found and fixed one genuine gap — the missing image-serving route
— which is now closed. No rebuild needed; `photos.get`'s unsurfaced single-photo detail
view is a legitimate but low-priority follow-on, not a defect blocking this disposition.
