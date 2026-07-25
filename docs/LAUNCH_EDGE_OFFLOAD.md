# Launch Edge Offload — Cloudflare in front of the single-Node origin

**Status: research + config, 2026-07-25. Operator action required in the Cloudflare dashboard — nothing here auto-applies at the edge.**

## Why this document exists

Measured constraint: 44 concurrent requests puts the last one at ~8.5s. There is
**one** `concord-backend` Node process (pm2, `exec_mode: 'fork'`, 1 instance) on a
9 vCPU / 50GB box that also runs 5 Ollama processes. The origin is the scarce
resource, full stop. **Every request Cloudflare answers at the edge is a request
that never reaches that one process.** That makes edge offload the single
highest-leverage lever available for this deployment — higher than anything
achievable in application code, because it doesn't compete with Ollama or the
event loop for anything.

This document does three things: (1) states what is actually deployed today,
verified against the repo, not assumed; (2) cites current Cloudflare + Next.js
guidance for the specific shape of this deployment (Next.js standalone behind a
Cloudflare Tunnel, with a WebSocket path that must survive); (3) hands the
operator exact dashboard steps plus the one code change that was needed
(`concord-frontend/next.config.js`).

**What this does NOT do:** start/stop anything, touch `ecosystem.config.cjs`,
or fix the single-threaded macro-execution tail. See "What this does not fix"
at the end — read it before treating this as a capacity fix.

---

## 1. Current state, verified against the working tree

### Process topology (`ecosystem.config.cjs`, confirmed by direct read)

Three pm2 apps, one box:

| App | What | Port | Notes |
|---|---|---|---|
| `concord-backend` | `node server/server.js` | 5050 | 1 fork instance. `max_memory_restart: 6G`, `--max-old-space-size=8192`. This is the scarce resource. |
| `concord-frontend` | `node .next/standalone/server.js` | 3000 | Next.js **standalone** output, 1 fork instance, `max_memory_restart: 1G`. `BACKEND_URL=http://127.0.0.1:5050` is read by `next.config.js`'s `rewrites()`. |
| `concord-tunnel` | `cloudflared tunnel --no-autoupdate run --token <CLOUDFLARE_TUNNEL_TOKEN>` | n/a (outbound-only) | Supervised by pm2, `autorestart` gated on the token being present. **This is TOKEN MODE.** |

### Token mode means the ingress rules are NOT in this repo

`concord-tunnel`'s pm2 args are `tunnel run --token ...` — no `--config` flag,
no local `cloudflared.yml`. In Cloudflare Tunnel token mode, the tunnel's
**ingress rules (Public Hostname routes) live in the Cloudflare Zero Trust
dashboard**, not in a file cloudflared reads locally. Two YAML files exist in
`infra/cloudflare/` (`cloudflared.yml.example`,
`cloudflared.runpod.yml.example`) but both are explicitly **config-file-mode
templates** for a different, docker-compose-oriented deploy path described in
`infra/cloudflare/README.md` — they are not consumed by the actual
`ecosystem.config.cjs` + `startup.sh --cloudflare` path this deployment uses.

**Practical implication:** there is no ingress config to read or diff in this
repo. `cloudflared.runpod.yml.example`'s ingress *logic* — route `/api`,
`/socket.io`, `/health`, `/ready`, `/metrics`, `/mcp` to the backend on `:5050`,
everything else to the frontend on `:3000` — is the correct shape to replicate
as **Public Hostname** entries in the dashboard, but nobody has verified this
was actually done; the operator must confirm the dashboard's routes exist and
match. (See step-by-step in §3.)

### nginx is present in the repo but NOT in this deployment's request path

`nginx/nginx.conf` exists and has real content (gzip, security headers, rate
limiting, a hand-written CSP). It is referenced in exactly two places:

- `scripts/concord-deploy.sh` — a **different**, Docker-Compose-oriented
  deploy script. It only checks that the file is present (prophet pre-build
  gate) and later curls `localhost:80` as a health check.
- `nginx/nginx.conf` is never invoked by `startup.sh`, which is the actual
  bare-metal entry point (`./startup.sh --cloudflare` or `--runpod`). Grepping
  `startup.sh` end to end shows no `nginx` reference at all — pm2 starts only
  the three apps above.

**Conclusion: for this deployment, there is no nginx in front of anything.**
Request path is `Internet → Cloudflare edge → cloudflared (outbound tunnel) →
concord-frontend:3000 (or concord-backend:5050, per dashboard ingress route) →
Next.js rewrites() for /api and /socket.io → concord-backend:5050`. Any
caching/rate-limiting recommendation below targets the Cloudflare dashboard,
not an nginx config file, because nginx isn't in the loop. If a future deploy
reintroduces nginx into the bare-metal path, port the Cache-Control logic in
§2 into `nginx.conf`'s `location` blocks and re-check this doc's routing
assumption.

### Cache headers already emitted today (`concord-frontend/next.config.js`, before this change)

The `headers()` function already set, prior to this pass:
- Global security headers (`X-Content-Type-Options`, `X-Frame-Options`,
  `X-XSS-Protection`, `Referrer-Policy`, a scoped `Permissions-Policy`) on
  every path (`/(.*)`).
- `Cache-Control: public, max-age=31536000, immutable` on
  `/:dir(models|meshes|draco|basis)/:path*` (the 3D asset directories under
  `public/`, ~175MB of GLB/mesh/texture files).
- `Cache-Control: no-cache` + `Service-Worker-Allowed: /` on `/sw.js`.

Nothing set an explicit header for `/_next/static/*` (Next's own hashed build
output — JS/CSS bundles) or for the small root-level `public/` assets
(`favicon.ico`, `favicon.svg`, `logo*.svg`, `icons/*`). No `_headers` file,
no `wrangler.toml`, no existing Cloudflare Cache Rules / Page Rules artifact
exists anywhere in this repo (verified — none found).

`server/server.js` sets `Cache-Control` explicitly in exactly 5 places (asset
routes: `evo-asset.js`, `media.js`, two inline `server.js` asset endpoints at
`:34916`/`:41684`/`:41689`/`:54927`/`:55597`, all `public, max-age=3600` or
`max-age=86400`). Everything else under `/api/*` gets **no explicit
Cache-Control header** — which matters for §4's bypass rule, because relying
on "the API just isn't cacheable by default" is true today under Cloudflare's
default behavior, but is not a rule you control, and a future zone-level
"Cache Everything" toggle (or a Cache Rule added without reading this doc)
would silently start caching authenticated JSON. Treat the explicit bypass in
§4 as required, not optional.

### Auth shape (why cache-bypass on `/api/*` is not optional)

`server/server.js`'s three-gate permission system
(`authMiddleware`/`publicReadPaths`, `runMacro`/`publicReadDomains`,
`Chicken2`/`_safeReadPaths`) shows most `GET /api/*` traffic is
cookie-authenticated (`cookieParserMiddleware` runs before auth) and only a
narrow, explicitly-allowlisted subset of paths/domains/macros is intentionally
public-read. The general case is a per-user response. Caching it at the edge
without a correctness argument for that specific route is how you serve
User A's private page to User B.

---

## 2. What changed in code (`concord-frontend/next.config.js`)

Two new entries were added to the existing `headers()` array (the file's
`rewrites()`, security headers, and 3D-asset rule were left untouched):

```js
{
  // Explicit reinforcement of Next.js's own built-in immutable-caching
  // behavior for hashed build output (see research note below on why this
  // is believed to already be automatic, and why setting it explicitly is
  // still worth doing).
  source: '/_next/static/:path*',
  headers: [
    { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
  ],
},
{
  // Root-level /public assets (favicon, logos, PWA icons) are NOT
  // content-hashed, so NOT marked immutable — a logo swap at the same URL
  // must actually propagate. Moderate cache + SWR still skips most re-fetches.
  source: '/:path*.(svg|ico|png|jpg|jpeg|webp|woff|woff2|ttf)',
  headers: [
    { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
  ],
},
```

Verified: `node -e "require('./next.config.js')"` loads cleanly, and
`npx tsc --noEmit` passes with zero errors after the change (no `next build`
was run, per the constraint that another agent is measuring memory on this
box — this only exercises the JS config object and the TypeScript project,
neither of which needed a full build to validate).

### Why `/_next/static/*` explicitly, if Next already does this

Next.js's documented behavior (nextjs.org — self-hosting + `headers()`
reference) is that build output under `/_next/static/` embeds a content hash
in the filename and Next's own static-file server sets
`Cache-Control: public, max-age=31536000, immutable` for it — described in
Next's own docs as effectively non-overridable because it's correct by
construction (new build → new hash → new URL, so nothing is ever served stale
under an old URL). This is standard behavior for `next start` / the standalone
`server.js`, not a Vercel-only feature — the standalone server serves
`/_next/static/*` through the same internal handler.

Given that, the explicit rule added here is redundant with Next's own
behavior in the common case. It is included anyway for three reasons: (1) it
makes the caching *contract* legible to anyone reading `next.config.js` or
diffing headers at the edge, instead of relying on tribal knowledge of Next
internals; (2) it is a no-op if Next already sets the same value, and a safety
net if any current or future custom-server wiring in this repo's standalone
`server.js` bypass path ever intercepts static serving before Next's own
handler runs; (3) this is the header Cloudflare's Cache Rule in §3 keys off —
having it asserted in-repo, not just "probably already true," is worth the
one extra `headers()` entry. **This was not fixing a bug** — no evidence was
found that `/_next/static/*` was being served without the header; treat this
as belt-and-suspenders, not a correction.

**Operator verification step (cheap, no build required):** once deployed, run
`curl -sI https://concord-os.org/_next/static/chunks/<any-real-chunk>.js | grep -i cache-control`
and confirm `public, max-age=31536000, immutable` comes back. If Next's
internal behavior ever changes, this explicit rule keeps the contract; if it
doesn't, this confirms both agree.

---

## 3. Cloudflare dashboard — exact steps

These are manual dashboard steps for the operator (per the task's hard
constraint, no server was started/stopped/deployed to verify these end to
end — verify with the `curl -I` commands after applying).

### 3.0 Prerequisite — confirm the zone is proxied (orange cloud)

Cloudflare Tunnel creates a `CNAME` pointed at `<tunnel-id>.cfargotunnel.com`.
**Cache Rules, Page Rules, and WAF only apply to a hostname when its DNS
record is proxied ("orange cloud") through Cloudflare** — a "DNS only" (grey
cloud) record means Cloudflare never terminates the request and none of the
below applies. Published Cloudflare Tunnel hostnames inherit the zone's
Cache Rules / WAF / Rules configuration exactly like any other proxied
origin — the Tunnel only changes *how traffic reaches the origin*
(outbound-only from the box), not which edge features apply.
**Verify:** DNS tab → the `concord-os.org` record for the tunnel hostname
shows the orange cloud icon, not grey.

### 3.1 Confirm/fix the tunnel's Public Hostname routes

Zero Trust dashboard → Networks → Tunnels → the tunnel → **Public Hostname**
tab. Confirm these routes exist (add if missing) — this replicates the
ingress logic already written down in
`infra/cloudflare/cloudflared.runpod.yml.example` for this exact
single-box topology:

| Path | Service | Notes |
|---|---|---|
| `concord-os.org` — path `^/(api\|socket\.io\|health\|ready\|metrics\|mcp)(/.*)?$` | `http://127.0.0.1:5050` | Direct to backend. In practice this may already be handled by the frontend's `rewrites()` proxying `/api/*` and `/socket.io/*` to `127.0.0.1:5050` — **pick one path and confirm it's the one actually in effect**; having both the tunnel AND the Next rewrite try to route the same prefix is not harmful (whichever wins routes correctly either way) but is worth knowing which one is live, since it changes where a `/socket.io` disconnect gets debugged. |
| `concord-os.org` — catch-all | `http://127.0.0.1:3000` | Everything else → the Next.js frontend. |

Under each route's **HTTP Settings**, confirm:
- **HTTP Host Header**: leave default unless the origin needs a specific
  `Host`.
- **Do NOT enable "HTTP/2 origin"** for the `/socket.io` path specifically —
  see §3.4, this is the single most common cause of a WebSocket path that
  works for plain HTTP but 502s for socket.io specifically.

### 3.2 Cache Rules (not Page Rules)

Cloudflare's current guidance (2026) is to use **Cache Rules**, not the
legacy Page Rules product — Cache Rules support matching on more than URL
path (headers, cookies, AND/OR logic), Rules-family features take precedence
over Page Rules when both apply, and the free tier allows 10 Cache Rules vs.
3 free Page Rules. Dashboard: **Caching → Cache Rules → Create rule**.

Create these, **in this order** (Cache Rules evaluate top-to-bottom, first
match with an explicit action wins for that request):

**Rule 1 — Bypass API and realtime (create this FIRST, highest priority)**
- Rule name: `bypass-api-and-realtime`
- When incoming requests match:  
  `(http.request.uri.path starts_with "/api/") or (http.request.uri.path starts_with "/socket.io/") or (http.request.uri.path eq "/health") or (http.request.uri.path eq "/ready")`
- Cache eligibility: **Bypass cache**
- This is a safety backstop even though Cloudflare's default behavior already
  won't cache `Set-Cookie`-bearing or `no-store` responses — see §4 for why
  an explicit bypass rule is still required, not just relied-on defaults.

**Rule 2 — Cache Next.js hashed build assets aggressively**
- Rule name: `cache-next-static-immutable`
- When incoming requests match: `http.request.uri.path starts_with "/_next/static/"`
- Cache eligibility: **Eligible for cache**
- Edge TTL: **Respect origin TTL** (the origin now sends
  `max-age=31536000, immutable` per §2 — let Cloudflare read it rather than
  hardcoding a duplicate number that can drift out of sync)
- Browser TTL: **Respect origin TTL**

**Rule 3 — Cache non-hashed static assets moderately**
- Rule name: `cache-public-static-assets`
- When incoming requests match:  
  `http.request.uri.path matches "^/(favicon\.ico|favicon\.svg|logo.*\.svg|icons/.*|models/.*|meshes/.*|textures/.*)$"`
- Cache eligibility: **Eligible for cache**
- Edge TTL: **Respect origin TTL** (origin sends 1-day for the small
  root-level icons/logos, 1-year-immutable for the 3D asset directories,
  per §2 and the pre-existing rule)

**Do not add a "Cache Everything" rule for `/` or a bare wildcard.** HTML
responses in this app are frequently per-user (auth-cookie-gated shell,
client-fetched personalized data) — cache HTML only if/when a specific route
is audited and proven to render identically for every visitor, and even then
scope the rule to that exact path, never a blanket root match.

### 3.3 Rate limiting — protect the origin from a crude burst

Cloudflare's rate limiting is edge-side (335+ PoPs) and blocks excess traffic
before your origin sees it, which is exactly the "absorb the crude stuff"
role described in the task. As of 2026, the **Free plan includes exactly 1
rate limiting rule** (Pro ~10, Business ~15) — spend the one free rule where
it matters most: protecting the uncached, single-process-serviced paths.

Dashboard: **Security → WAF → Rate limiting rules → Create rule**.

- Rule name: `origin-burst-protection`
- When incoming requests match:  
  `(http.request.uri.path starts_with "/api/") or (http.request.uri.path starts_with "/socket.io/")`
- Rate: **60 requests per 10 seconds**, counted **per IP** — this is a crude
  ceiling meant to catch a runaway client/bot/retry-storm, not a
  per-user-experience throttle; keep it loose enough that no real user
  session trips it under normal use, tight enough that a scripted burst gets
  caught before it reaches the one Node process. Tune the exact numbers after
  watching real traffic — there's no load-test data yet for what a real
  legitimate burst looks like on this app (a page load can fan out many
  `/api/lens/run` calls at once).
- Action: **Managed Challenge** (not outright Block) for the first rollout —
  a challenge only slows down non-browser clients, while an outright block on
  a mistuned rule takes real users offline. Tighten to Block once the
  threshold is confirmed safe.
- **Uncheck "count cached requests"** if the dashboard exposes it (worded as
  restricting counting to "requests reaching the origin") — this rule is
  specifically about the origin's actual request budget, so a client
  re-fetching an already-cached static asset shouldn't burn down the same
  counter as an uncached `/api/*` call.

This is the edge-side complement to whatever in-app load shedding another
agent is building — the edge rule is coarse and IP-scoped (it doesn't know
about users, auth, or macro cost), the in-app shedder is precise and
cost-aware. Neither replaces the other.

### 3.4 WebSockets through the Tunnel — the specific caveats

- **Cloudflare supports proxied WebSocket connections network-wide** — this
  is a platform-level capability, not a paid add-on, and does not need
  special enabling on modern zones (older zones occasionally have a
  "WebSockets" toggle under Network settings; confirm it's ON if present).
- **Cloudflare Tunnel (cloudflared) forwards WebSocket upgrades correctly**,
  but community reports (Cloudflare Community forum) repeatedly show
  socket.io specifically 502-ing through a tunnel even when a bare `ws://`
  connection to the same origin works. The most common root cause reported:
  **`http2Origin: true` set on the ingress rule for the WebSocket path.**
  HTTP/2 to the origin does not carry a WebSocket the same way HTTP/1.1 does
  (WebSocket-over-h2 requires Extended CONNECT, which most origin servers —
  including this one — don't implement); Node's `http` server here is
  HTTP/1.1. **Do not set `http2Origin`/"HTTP/2 origin" on the `/socket.io`
  route.** Since this deployment is token-mode (no local `cloudflared.yml`),
  check the Public Hostname's HTTP Settings in the dashboard for this exact
  toggle and make sure it is off for that route.
- **Never cache the `/socket.io/*` path** — it's covered by Rule 1's bypass
  above. A cached WebSocket upgrade response is nonsensical (each connection
  is unique, long-lived, stateful) — this isn't a performance nuance, it's a
  correctness requirement.
- **Buffering**: Cloudflare's proxy does not buffer WebSocket frames the way
  it might buffer a slow HTTP response body — once the Upgrade handshake
  completes, traffic flows through as a raw stream. No additional
  "no-buffering" flag is needed for this. (If a `keepAliveTimeout` in the
  ingress `originRequest` config is set — visible as `keepAliveTimeout` /
  `keepAliveConnections` in `cloudflared`'s own config surface — make sure
  it's generous, e.g. 90s+, matching the example templates already in
  `infra/cloudflare/*.example`; a short idle timeout there can kill a
  long-lived idle socket.io connection that has no traffic for a while, which
  reads as a connection drop rather than a cache bug but is worth ruling out
  if reconnect churn shows up.)

---

## 4. Cache-bypass safety rules — read this before touching Cache Rules

**Getting this wrong caches a logged-in user's page and serves it to someone
else.** This is the single highest-consequence mistake available in this
document. The rules below are not optional hardening — treat every one as a
launch blocker if violated.

- **`/api/*` — always bypass.** Nearly all of it is per-user (three-gate auth
  system, §1). The narrow `publicReadPaths`/`publicReadDomains` exceptions
  that genuinely are public reads are a moving target maintained in
  `server/server.js`, not something to hand-enumerate into a Cache Rule
  allowlist — bypassing the whole prefix is the only rule that stays correct
  as that allowlist changes over time.
- **`/socket.io/*` — always bypass.** Not just "don't cache it" — an upgraded
  WebSocket connection cached at any layer is meaningless and would break
  every realtime feature (chat streaming, world presence, combat events).
- **`/health`, `/ready` — bypass.** These are liveness probes; a cached
  "healthy" response defeats their purpose.
- **Any response carrying `Set-Cookie` — never cache**, full stop. This is
  Cloudflare's own default behavior (a `Set-Cookie` header marks a response
  per-visitor and is excluded from the default cache), but do not rely on
  the default alone once any broader Cache Rule exists in the zone — a
  future "Respect Origin" Edge TTL override on an over-broad rule can be
  configured to strip `Set-Cookie` and cache anyway (Cloudflare's newer
  "Cache Response Rules" feature, announced 2026, explicitly supports
  stripping `Set-Cookie` before caching — powerful, and exactly the kind of
  rule that must never be pointed at an auth-bearing route). If anyone
  reaches for that feature here, the answer is: not on any route that sets
  a session cookie, which today means effectively all of `/api/*` — see the
  bypass rule above, which already covers this.
- **The request `Cookie` header does NOT bypass cache by default.** This is
  the subtler risk the task called out: Cloudflare's default cache key does
  not vary by the request's `Cookie` header, so if an HTML route were ever
  marked cacheable, a cached copy generated for one logged-in user could be
  served to a different logged-in user with a different cookie — the cache
  doesn't know they're different requests. This is exactly why §3.2
  deliberately does not add any HTML-caching rule, and why "Cache Everything"
  must never be enabled for this zone without a route-by-route audit proving
  the HTML truly renders identically for every visitor (anonymous marketing
  pages only, if any exist — none were identified as unauthenticated static
  HTML in this pass).
- **Never widen the static-asset rules (§3.2, Rules 2–3) to a bare wildcard.**
  Match exact prefixes (`/_next/static/`, the named asset directories) — a
  broad `.*` cache-eligible rule evaluated before the bypass rule would win
  on priority-order and defeat the bypass entirely. This is why Rule 1
  (bypass) is listed first in §3.2 — Cache Rules are evaluated in order and
  the first matching rule with an explicit action applies.

---

## 5. What this does NOT fix

State this plainly so nobody mistakes edge caching for a capacity fix:

- **It does nothing for authenticated dynamic API calls.** Every
  `/api/lens/run` call, every DTU fetch, every macro invocation still goes
  all the way to the single `concord-backend` process. Edge caching offloads
  static bytes and — where a route is genuinely audited as safe — cacheable
  anonymous GETs. It does not make a single one of those authenticated calls
  faster or cheaper.
- **It does nothing for WebSocket/socket.io traffic.** That traffic is
  explicitly bypassed from cache (§4) because it must be — every realtime
  feature still runs through the one Node process's event loop and its
  in-process socket handling, unaffected by anything in this document.
- **It does nothing for the single-threaded macro-execution tail that
  produced the measured 8.5s-at-44-concurrent number.** That is a property of
  one Node process executing one request at a time on the JS main thread
  (plus whatever the worker pools in `workers/heartbeat-pool.js` /
  `workers/macro-pool.js` offload) — a request that reaches the origin still
  waits behind whatever else that process is doing, exactly as before. Fixing
  *that* is in-app load shedding / concurrency work (owned elsewhere per this
  task's framing), not an edge concern.
- **It doesn't reduce Ollama load.** LLM-backed macros still hit the 5
  Ollama processes on the same box exactly as before.

Edge offload's honest contribution is: it removes the population of requests
that never needed to reach the origin at all (hashed JS/CSS bundles, 3D
assets, icons/logos, a crude burst of junk traffic) from competing with the
requests that do. That's a real, meaningful win given the measured
constraint — it is not the same claim as "the origin can now handle more
concurrent real work."

---

## Sources

- [Cache Rules · Cloudflare Cache (CDN) docs](https://developers.cloudflare.com/cache/how-to/cache-rules/) — Cache Rules setup, matching on more than URL.
- [Order and priority · Cloudflare Cache (CDN) docs](https://developers.cloudflare.com/cache/how-to/cache-rules/order/) — rules evaluate top-to-bottom, first explicit-action match wins.
- [Use Cloudflare Cache Rules Instead Of Page Rules](https://www.namehero.com/blog/use-cloudflare-cache-rules-instead-of-page-rules/) — free-tier rule counts (10 Cache Rules vs 3 Page Rules), Rules-family precedence over Page Rules.
- [Introducing Cache Response Rules — The Cloudflare Blog](https://blog.cloudflare.com/introducing-cache-response-rules/) and [2026-03-24 changelog](https://developers.cloudflare.com/changelog/post/2026-03-24-cache-response-rules) — new post-origin-response rule type that can strip `Set-Cookie` / rewrite `Cache-Control` before caching; the reason §4 calls this feature out as a specific hazard for auth-bearing routes.
- [Default cache behavior · Cloudflare Cache docs](https://developers.cloudflare.com/cache/about/default-cache-behavior) — Cloudflare does not cache when `Set-Cookie` is present, `Cache-Control` is `private`/`no-store`/`no-cache`/`max-age=0`, or the method isn't GET; request `Cookie` header does not itself bypass cache by default.
- [Bypass Cache on Cookie · Cloudflare Cache (CDN) docs](https://developers.cloudflare.com/cache/how-to/cache-rules/examples/bypass-cache-on-cookie/) — worked example of an explicit bypass rule.
- [WebSockets · Cloudflare Network settings docs](https://developers.cloudflare.com/network/websockets/) — WebSocket proxying is a platform capability, supported on all plans.
- [WebSocket / Socket IO on Tunnel? — Cloudflare Community](https://community.cloudflare.com/t/websocket-socket-io-on-tunnel/343738) and [How to enable Socket.IO with Cloudflare Proxy — Cloudflare Community](https://community.cloudflare.com/t/how-to-enable-socket-io-with-cloudflare-proxy-enabled-for-erpnext-frappe/756252) — reported socket.io-through-tunnel 502s, generally traced to origin-side HTTP/2 upgrade handling.
- [`ingress` package — cloudflared Go docs](https://pkg.go.dev/github.com/cloudflare/cloudflared/ingress) — confirms `http2Origin`, `keepAliveConnections`, `keepAliveTimeout`, `noHappyEyeballs` as real `originRequest` fields.
- [Rate limiting rules · Cloudflare WAF docs](https://developers.cloudflare.com/waf/rate-limiting-rules/) and [best practices](https://developers.cloudflare.com/waf/rate-limiting-rules/best-practices/) — sliding-window counters, matching on request attributes beyond IP.
- [Rate limiting pricing — BlazingCDN](https://blog.blazingcdn.com/en-us/understanding-cloudflares-rate-limiting-pricing) — Free plan rule-count ceiling (1 rule) cited in §3.3; **cross-check this against your actual Cloudflare plan/dashboard before relying on it** — pricing/tier limits are exactly the kind of detail that drifts and this wasn't confirmed against Cloudflare's own primary pricing page.
- [Guides: CDN Caching · Next.js docs](https://nextjs.org/docs/app/guides/cdn-caching) and [`headers()` config reference · Next.js docs](https://nextjs.org/docs/pages/api-reference/config/next-config-js/headers) — `/_next/static/*` immutable 1-year caching is Next's own built-in behavior for hashed build output; both pages returned HTTP 403 to this session's fetch tool (network-policy block, not a dead link) so the specifics above are corroborated via search-result snippets and general Next.js documentation knowledge rather than a direct read of the full page — **the operator should open these two pages directly to confirm** before treating the self-hosted-standalone claim as airtight.
- Proxied-DNS / Tunnel-inherits-zone-Rules claim: [DNS records · Cloudflare One docs](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/routing-to-tunnel/dns/) and [Protect your origin server · Cloudflare Fundamentals docs](https://developers.cloudflare.com/fundamentals/security/protect-your-origin-server/) — corroborated via search-result snippets (direct fetch of both pages also 403'd to this session's tooling); worth an operator click-through to confirm the "published tunnel hostnames inherit Cache/WAF/Rules" wording precisely.

**Honesty note on sourcing:** this session's `WebFetch` tool returned HTTP 403
on every `developers.cloudflare.com` and `nextjs.org` URL it tried (a
network-policy block in this environment, not a claim about those pages being
down or nonexistent) — all Cloudflare/Next.js specifics above come from
`WebSearch` result snippets, which quote and summarize those same official
docs pages but were not read in full by this session. Every load-bearing claim
above is attributed to its source URL so it can be re-verified with a normal
browser; nothing here was invented, but "read via search snippet" is a weaker
form of verification than "fetched and read the full page," and is disclosed
as such rather than presented as a direct read.
