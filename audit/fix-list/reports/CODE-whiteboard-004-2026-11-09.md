# CODE-whiteboard-004 — empty / missing board → ErrorState "Whiteboard not found" — 2026-11-09

**Ticket:** FIX-whiteboard-004 (high). **Live:** `/lenses/whiteboard` (no id) for a test account with no boards shows ErrorState **"Something went wrong" / "Whiteboard not found"** on desktop and 390×844; survives hard reload; Try again briefly flashes Untitled Whiteboard ▾ + New board, then the error returns. Console: **404** on whiteboard fetch and on `/api/lens/run`. **Code-only** against `/workspace/webdb-audit` tip assumed `dae9e10a6`. **No files/DB/services modified. Fix not implemented.**

## Symptoms → code surfaces

| Live observation | Code |
|------------------|------|
| "Something went wrong" + "Whiteboard not found" + Try again | `ErrorState` in `WhiteboardStudio.tsx:1412–1416` (title from `EmptyState.tsx:246–247`), **not** LensErrorBoundary copy |
| 404 on `GET /api/whiteboard/:id` | `apiHelpers.whiteboard.get` → `server.js` `register("whiteboard","get")` `:59659–59663` → `_wbMissing()` `:59526` → `_wbHttp` `:59729–59731` returns **HTTP 404** |
| 404 on `/api/lens/run` | Studio effect `board-load` (`WhiteboardStudio.tsx:254–260`) → domain `board-load` returns `{ ok:false, error:"not found" }` (`whiteboard.js:427–441`) → `shapeLensRunHttp` / `httpStatusForLensFailure` maps `* not found` → **HTTP 404** (`server/lib/lens-run-http.js:44–48`). **Actions are registered** — this is not a missing-route 404 |
| Try again flash of Untitled Whiteboard ▾ + New board | `onRetry` refetches (`:1415`); while queries are mid-flight / remount, auto-pick can re-select a listed shadow titled Untitled / create chrome stays mounted (`:1815–1819` New board FAB always on main tree) |

## How the default / last board id is chosen

There is **no URL id** on `app/lenses/whiteboard/page.tsx` (Studio only). Selection is entirely client state:

1. `selectedWbId` starts `null` (`WhiteboardStudio.tsx:123`).
2. Board list (`:226–229`):
   - Prefer `GET /api/whiteboards` → `whiteboards.whiteboards`.
   - **If that array is empty**, fall back to `useLensData('whiteboard','board')` artifacts mapped as `{ id: a.id, title: a.title, … }` — uses the **lens artifact id**, **not** `a.data.whiteboardId`.
3. Auto-pick once list is non-empty (`:231–239`):
   - Read `localStorage['concord:whiteboard:last']` (`LAST_BOARD_KEY` `:61`).
   - If that id is still in `boardListItems`, select it; else select `boardListItems[0].id`.
4. Persist selection (`:241–244`): every `selectedWbId` write updates that localStorage key.
5. Enabling `GET /api/whiteboard/${selectedWbId}` (`:208–221`) and `board-load` (`:248–262`) whenever `selectedWbId` is set.

**Server has no "default board id" for an empty account.** `whiteboard.list` returns only owner-visible DTUs (`server.js:59666–59674`). Create mints a fresh `uid("wb")` (`:59621`). The empty-state UI when `selectedWbId` is null is honest (`:1765–1768` "Start a board…").

### Why a "no boards" account still fetches an id

Any of:

| Source | Mechanism |
|--------|-----------|
| **Orphan lens shadows** | REST DTU list empty → fallback to artifacts (`:226–228`). Shadow `id` is `lart_…` from `_wbAttachMirror` (`server.js:59531–59561`), while canvas GET expects the **whiteboard DTU id**. Fetching `lart_…` → `_wbMissing` 404 |
| **Stale `concord:whiteboard:last`** | Survives hard reload. Auto-pick only applies it when the id is still present in `boardListItems` — so alone it is harmless **unless** the fallback artifact list still contains that id (or another pickable row) |
| **Soft-deleted / permanently deleted DTU with leftover shadow** | Same artifact-fallback 404 |
| **Not** a hard-coded server default | No seed board id found for empty users |

So the 404 is **client selection of a non-DTU or missing id** (stale last-board and/or artifact-id fallback), **not** a server inventing a default board.

## Why 404 becomes the full-page ErrorState instead of empty / New board

Intended soft-fail (`WhiteboardStudio.tsx:214–218`):

```ts
if (axiosStatus(err) === 404) return { ok: false, error: 'Whiteboard not found', status: 404 };
throw err;
```

`axiosStatus` (`boardOwner.ts:19–21`) only reads `(err as any).response?.status`.

But the axios response interceptor **always** rejects with `fromAxiosError(error)` (`client.ts:726`), and for HTTP 404 that returns:

```ts
new ConcordError(msg, 'NOT_FOUND', 404)  // errors.ts:182–190
```

`ConcordError` carries **`statusCode`**, not `response.status` (`errors.ts:12–28`). Therefore:

1. `GET /api/whiteboard/:id` → 404 body `{ error: "Whiteboard not found" }`.
2. Interceptor → `ConcordError("Whiteboard not found", "NOT_FOUND", 404)` — **no `.response`**.
3. `axiosStatus(err) === undefined` → catch **rethrows**.
4. React Query sets `isError3` + `error3.message === "Whiteboard not found"`.
5. Render gate `:1412–1416` treats **any** of `isError|isError2|isError3|isError4` as fatal → full-page `ErrorState` — **never** clears `selectedWbId`, **never** falls through to the empty canvas / New board state.

So the soft-404 path is **dead** after `fromAxiosError`. A missing board is indistinguishable from a hard studio failure.

Secondary console 404: `board-load` for the same bad id is shaped to HTTP 404 by `lens-run-http.js`. Client `lensRun` uses `validateStatus: status < 500` (`client.ts:401–406`), so that call does **not** trip `isError3`; it only explains the `/api/lens/run` 404 in DevTools. **Whiteboard domain actions including `board-load` / `board-save` / etc. are registered** in `server/domains/whiteboard.js` (loaded from `domains/index.js`).

## Minimal fix (proposed — not implemented)

Prefer a small, layered patch:

1. **`axiosStatus` (or local helper)** — treat Concord errors as 404 too, e.g. read `statusCode` / `code === 'NOT_FOUND'` in addition to `response?.status` (`boardOwner.ts:19–21`). Restores the existing soft-catch at `:217`.
2. **On soft 404 (or `selectedWb.data.ok === false`)** — `setSelectedWbId(null)`, remove `concord:whiteboard:last`, invalidate `['whiteboard', id]`, and render the existing empty state (`:1765–1768`) instead of ErrorState. Do **not** map 404 into `isError3`.
3. **Fix artifact fallback ids** (`:226–228`) — use `String((a.data as any)?.whiteboardId || a.id)` so catalog shadows resolve to canvas DTU ids (and skip rows with no `whiteboardId` if desired).
4. **Optional:** if REST `whiteboards` is empty, clear stale `LAST_BOARD_KEY` and skip auto-pick entirely.

Out of scope for this ticket but related: ErrorState currently ORs `useLensData` / DTU list failures (`isError` / `isError4`) into the same full-page fatal path — a DTU catalog blip can blank the studio even when board list is fine.

## Root-cause summary

| Question | Answer |
|----------|--------|
| How is default/last board chosen? | Client auto-pick: `localStorage['concord:whiteboard:last']` if still in list, else first `boardListItems` entry (`WhiteboardStudio.tsx:231–239`). No server default. |
| Why 404 → error UI not empty state? | Soft-catch uses `axiosStatus` → `.response.status`, but interceptor converts 404s to `ConcordError.statusCode` (`client.ts:726`, `errors.ts:182–190`), so catch rethrows → `isError3` → `ErrorState` (`:1412–1416`). |
| Is `/api/lens/run` 404 "no whiteboard route"? | **No.** `board-load` is registered; HTTP 404 is the shaped `"not found"` for the missing board id (`lens-run-http.js:44–48`). |
| Stale localStorage / last-board / server default? | **Stale last-board + especially artifact-id fallback** can select a missing id. **Not** a server default id. |

## Cite map

| Item | Location |
|------|----------|
| LAST_BOARD_KEY / auto-pick | `concord-frontend/components/whiteboard/WhiteboardStudio.tsx:61,231–244` |
| List fallback uses `a.id` | `:226–228` |
| Soft 404 catch (broken) | `:214–218` |
| Fatal ErrorState gate | `:1412–1416` |
| `axiosStatus` | `components/whiteboard/boardOwner.ts:19–21` |
| `fromAxiosError` 404 → ConcordError | `lib/errors.ts:182–190`; applied `lib/api/client.ts:726` |
| GET missing board | `server/server.js:59659–59663,59526,59729–59731,59743` |
| Shadow artifact id ≠ DTU id | `server/server.js:59531–59561` |
| board-load not-found | `server/domains/whiteboard.js:427–441` |
| lens/run "not found" → HTTP 404 | `server/lib/lens-run-http.js:44–48` |
