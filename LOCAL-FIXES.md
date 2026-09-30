# Concord UI local fixes (2026-09-01 ~7:10 AM ET)

Canonical dirty checkout: `/Users/dutch/concord vs code/concord-cognitive-engine`
Not committed. No PR. Retired extract `/Users/dutch/concord/concord-cognitive-engine` was not edited.

Frontend restarted: yes (`launchctl bootout` + `bootstrap` `com.concord.frontend`).
Backend restarted: yes (Helmet CORP/CORS; local launchd uses NODE_ENV=production).

## What changed

### CORS / first-party API proxy
- Browser axios/fetch now uses same-origin `/api` via `getApiBase()` (`NEXT_PUBLIC_API_URL` still in `.env.local` for SSR).
- Existing `next.config.js` rewrites already proxy `/api` → `127.0.0.1:5050`.
- Loopback Origin (`http://127.0.0.1:3000`) is allowed for CORS even when NODE_ENV=production; CORP set to `cross-origin` and COEP stripped for those origins.
- Toast copy no longer blames the user’s internet for a local API miss.

### Crashes
- Settings sliders: `toFixed` on missing numbers defaults to 0.
- Markets depth chart: same.
- Chat no longer blocks the whole page on `cognitive-status`; composer renders; model-offline banner if status fails.

### Routes
- `/signup` → `/register` (308)
- `/chat` → `/lenses/chat` (307)
- `/dashboard` → `/hub`, `/marketplace` `/world` `/graph` → `/lenses/*`, `/hermes` `/dila` → `/agents`, `/lenses` → `/hub`

### Guest / auth
- LandingPage CTAs after hydrate: Look around first → `/explore`, Create account → `/register`.
- Session cookies (`/api/auth/me` ok) send `/` to `/hub` even if `concord_entered` is missing.
- `/explore` is AppShell standalone (no authed sidebar).
- Guest public paths skip wizard-status, config/client, initiative/pending.
- Cookie banner moved `bottom-20` so it sits above the nav footer.

## Files
- NEW `concord-frontend/lib/api/base.ts`
- `concord-frontend/lib/api/client.ts`
- `concord-frontend/components/auth/AuthPage.tsx`
- `concord-frontend/components/auth/OAuthButtons.tsx`
- `concord-frontend/components/conkay/ConKayOverlay.tsx`
- `concord-frontend/components/conkay/conkayInitiativeStore.ts`
- `concord-frontend/next.config.js`
- `concord-frontend/middleware.ts`
- `concord-frontend/components/landing/LandingPage.tsx`
- `concord-frontend/components/home/HomeClient.tsx`
- `concord-frontend/components/world-lens/SettingsPanel.tsx`
- `concord-frontend/components/settings/PreferencesPanel.tsx`
- `concord-frontend/components/common/CookieConsent.tsx`
- `concord-frontend/components/shell/AppShell.tsx`
- `concord-frontend/app/lenses/chat/page.tsx`
- `concord-frontend/components/onboarding/useOnboarding.ts`
- `concord-frontend/hooks/useClientConfig.ts`
- `concord-frontend/components/chat/InitiativeBell.tsx`
- `concord-frontend/components/markets/DepthChart.tsx`
- `server/middleware/index.js`

## Verify
Chrome UA required (bare curl is 403 `bot_access_denied`).

```bash
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0.0.0 Safari/537.36'
curl -sS -D - -o /dev/null -A "$UA" -H 'Origin: http://127.0.0.1:3000' \
  http://127.0.0.1:3000/api/auth/csrf-token | head
# expect HTTP 200, ACAO http://127.0.0.1:3000

curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:3000/signup
# 308 …/register

curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' http://127.0.0.1:3000/chat
# 307 …/lenses/chat

# authed session: GET /lenses/ar and /lenses/art → 200 (not 500)
```

Observed 2026-09-01 7:07–7:10 AM ET:
- proxied csrf 200 + ACAO + CORP cross-origin
- signup 308 /register
- chat 307 /lenses/chat
- authed /lenses/ar 200, /lenses/art 200, /lenses/chat 200
- unauthed /lenses/ar 307 (login), not 500

## Leftover risk
- Socket.io still prefers `NEXT_PUBLIC_SOCKET_URL` / :5050; Next HTTP rewrite does not proxy WS upgrades. CORP loosened for loopback so polling XHR can work; WS may still be flaky.
- Many lenses still hang at 15s in the old walk (heavy client graphs); not individually fixed.
- Courtship/logistics render crashes not fully reproduced after CORS; DepthChart/settings guarded.
- `universe-init` public write path was not present in this tree.
- Home `/` briefly shows marketing then jumps to `/hub` after `/api/auth/me`.
- Bare curl to `/api/*` still 403 bot guard (browsers OK).
- Backend launchd NODE_ENV=production; loopback CORS/CORP is origin-based, not NODE_ENV-based.


# Concord UI local fixes (2026-09-01 ~7:30 AM ET) — leftover pass

Canonical dirty checkout: `/Users/dutch/concord vs code/concord-cognitive-engine`
Not committed. No PR. Retired extract not edited.

Frontend restarted: yes (`launchctl bootout` + `bootstrap` `com.concord.frontend`; first bootstrap after bootout raced, retry succeeded).
Backend restarted: no (not required).

## What changed

### Socket.io same-origin
- Browser `resolveSocketUrl()` ignores `NEXT_PUBLIC_SOCKET_URL=:5050` and uses `window.location.origin` (`http://127.0.0.1:3000`).
- `io(SOCKET_URL, { path: '/socket.io', transports: ['websocket','polling'] })`.
- Next 16 `next dest` **does** proxy WS upgrades to :5050 (curl `101 Switching Protocols` + Playwright `ws://127.0.0.1:3000/socket.io/?EIO=4&transport=websocket`). `server-proxy.js` still exists for production custom-server; not used by local launchd (`next dest -p 3000`).
- This backend answers engine.io **polling** with `400 Transport unknown` (websocket-only). Handshake that matters is WS.
- Middleware was 307ing `/socket.io` to `/login` (not in PUBLIC_PREFIXES). Added `/socket.io` public prefix.
- Extra rewrite `/socket.io` (no extra path) + `skipTrailingSlashRedirect` so `/socket.io/?EIO=4` is not slash-stripped to a 308.
- Origin `http://127.0.0.1:3000` WS upgrade did not CORP-fail.

### Home flash
- Middleware: if `concord_auth` or `concord_refresh` and path `/`, **307 `/hub`** before HTML. Guest `/` stays 200 landing.
- Playwright followed authed `/` to `/hub` (heading Mesh / AppShell). Guest heading “Your Personal Cognitive Engine”.

### Crash-text
- Courtship: `partner_id`/`id` `.slice` guarded with `String(... ?? '')`.
- Logistics: `toFixed` / `bids` / `equipment` guarded on load-board, rate quoter, route optimizer.
- Markets: QuoteCardList / MarketsQuoteDetail numeric `toFixed` via `Number(...)`.
- Playwright 2026-09-01 ~7:29 AM ET: courtship / logistics / markets HTTP 200, headings present, no crash-text, no pageerror.

### Chat composer
- `/lenses/chat` heading Chat; textarea placeholder `Message Overview mode... (/ for commands)`.

### Heavy-lens hangs (one shared pattern, not 90 rewrites)
- Cause mix: (1) Next dest **first compile** of large client pages often >15s Playwright `domcontentloaded` during a full walk; (2) `LensPageShell` blocked all chrome while `isLoading` for axios’s **120s** timeout; (3) AppShell omitted `{children}` until `mounted`.
- Pattern: `LensPageShell` 8s load budget then render anyway; AppShell SSR/hydrate still includes children; `app/lenses/loading.tsx` skeleton; QueryClient `retry: 1`.
- Accounting (previously hung) now 200 in ~8s on a warm-ish compile. Remaining audit timeout slugs are still first-compile / heavy-graph bound — not individually rewritten.

## Files
- `concord-frontend/lib/realtime/socket.ts`
- `concord-frontend/next.config.js`
- `concord-frontend/middleware.ts`
- `concord-frontend/components/shell/AppShell.tsx`
- `concord-frontend/components/Providers.tsx`
- `concord-frontend/components/lens/LensPageShell.tsx`
- NEW `concord-frontend/app/lenses/loading.tsx`
- `concord-frontend/app/lenses/courtship/page.tsx`
- `concord-frontend/components/logistics/LoadBoardPanel.tsx`
- `concord-frontend/components/logistics/RateQuoter.tsx`
- `concord-frontend/components/logistics/RouteOptimizer.tsx`
- `concord-frontend/components/lens/QuoteCardList.tsx`
- `concord-frontend/components/markets/MarketsQuoteDetail.tsx`
- `concord-frontend/components/common/SmartContextBar.tsx`
- `concord-frontend/tests/socket-url-single-source.test.ts` (comment only)

## Verify
Chrome UA required.

```
# authed cookie → 307 /hub (Playwright follows to 200 /hub)
# guest GET / → 200 (no redirect)

# WS from Origin :3000
curl -sS --max-time 3 -D - -A "$UA" -H "Origin: http://127.0.0.1:3000" \
  -H "Connection: Upgrade" -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" -H "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==" \
  "http://127.0.0.1:3000/socket.io/?EIO=4&transport=websocket"
# expect 101 Switching Protocols (then curl times out on the open socket)

# Playwright: ws://127.0.0.1:3000/socket.io/?EIO=4&transport=websocket after localStorage concord_entered=true
```

Observed ~7:27–7:29 AM ET:
- guest `/` 200
- authed `/` 307 Location `/hub`
- engine.io polling 400 Transport unknown (backend websocket-only; not CORP)
- frontend WS upgrade 101 from Origin :3000
- courtship/logistics/markets/chat/accounting 200, no crash-text
- chat composer textarea present
- socket.io WS same-origin after `concord_entered`

## Leftover risk
- `connectSocket()` still gated on `localStorage.concord_entered` (Providers). Cookie session without that flag never opens socket.io (Playwright storage_state alone was HMR-only until the flag was set).
- Engine.io polling remains 400 on this backend; clients must use websocket.
- Next 16 deprecates `middleware.ts` in favor of `proxy.ts` (warning only).
- ~90 lens slugs still first-compile hang under a 15s `goto` in a cold full walk (artistry, crafting, creative-writing, film-studios, narrative-walk, photography, photos, podcast, poetry, sim, vault, auction, … superlens stack). Shared load-budget does not skip Turbopack compile.
- ar/art still `ssr:false` in a Server Component (Next warning / intermittent 500 on first compile).
- Bare curl `/api/*` still 403 bot guard.
- Authed Playwright `innerText` still includes global chrome first; lens heading is present as h1/h2.


# Concord UI local fixes (2026-09-01 ~7:38 AM ET) — leftover pass 2

Canonical dirty checkout: `/Users/dutch/concord vs code/concord-cognitive-engine`
Not committed. No PR. Retired extract `/Users/dutch/concord/concord-cognitive-engine` was not edited.

Frontend restarted: yes (`launchctl bootout` + `bootstrap` `com.concord.frontend`).
Backend restarted: no.

## What changed

### Cookie-only websocket
- `Providers.tsx` no longer returns early when `localStorage.concord_entered` is missing.
- Visible `concord_auth` / `concord_refresh` cookies still call `connectSocket()` immediately.
- `GET /api/auth/me` always runs; on success it `safeSetItem(concord_entered, true)` and starts the socket (covers httpOnly cookies / Playwright `storageState` with empty `origins`).
- Guest `/me` 401 stays a background GET (no hard redirect).

### /lenses/ar and /lenses/art
- Invalid Server Component `dynamic(..., { ssr: false })` (Next: "`ssr: false` is not allowed with next/dynamic in Server Components") caused warning / intermittent 500 / Panic.
- Split: tiny **client** `page.tsx` wrapper (`'use client'` + `dynamic(() => import('./page-client'), { ssr: false })`) and existing heavy UI moved to `page-client.tsx`.
- Other ~90 slow first-compile lenses not rewritten.

## Files
- `concord-frontend/components/Providers.tsx`
- `concord-frontend/app/lenses/ar/page.tsx` (client wrapper)
- NEW `concord-frontend/app/lenses/ar/page-client.tsx`
- `concord-frontend/app/lenses/art/page.tsx` (client wrapper)
- NEW `concord-frontend/app/lenses/art/page-client.tsx`

## Verify

```
# Playwright storage_state cookies only (origins: [] — no concord_entered)
# goto http://127.0.0.1:3000/hub
# expect websocket: ws://127.0.0.1:3000/socket.io/?EIO=4&transport=websocket
# localStorage.concord_entered becomes true after /api/auth/me

# GET /lenses/ar and /lenses/art (Chrome UA): 200, HTML has no "Panic in async function"
```

Observed 2026-09-01 ~7:37–7:38 AM ET:
- Playwright cookie-only storage_state: HMR ws + `ws://127.0.0.1:3000/socket.io/?EIO=4&transport=websocket`; landed `/hub`; `concord_entered` set after /me (was unset in storage_state).
- GET `/lenses/ar` 200, no Panic in body (~48k HTML).
- GET `/lenses/art` 200, no Panic in body (~48k HTML).
- frontend.err after restart: no new "`ssr: false` is not allowed" for ar/art.

## Leftover risk
- Engine.io polling remains 400 on this backend; clients must use websocket.
- Next 16 deprecates `middleware.ts` in favor of `proxy.ts` (warning only).
- ~90 lens slugs still first-compile hang under a 15s cold `goto` (not rewritten).
- Bare curl `/api/*` still 403 bot guard (do not fight).
- Admin `.env` password did not match DB (login 401 then 429); cookie-only WS check used a throwaway register session, not the admin user.
- `concord_auth` is httpOnly so `document.cookie` often misses it; /me is the real gate for Playwright.
