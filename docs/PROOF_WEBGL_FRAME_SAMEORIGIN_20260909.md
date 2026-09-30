# Proof: concordia-webgl iframe framing (X-Frame-Options SAMEORIGIN)

- When: 2026-09-09 03:08 ET
- Branch: concurrency-refactor
- Env: `NEXT_PUBLIC_UNITY_WEBGL_URL=/concordia-webgl/index.html` (unchanged)

## Problem
Fresh editor WebGL at `public/concordia-webgl/` was refused by browsers because
`next.config.js` set `X-Frame-Options: DENY` for everything except `/unity-client/`.
World lens iframes `/concordia-webgl/`, so the embed failed.

## Fix
1. `next.config.js`: negative lookahead excludes `concordia-webgl/` as well as
   `unity-client/`; explicit `SAMEORIGIN` for `/concordia-webgl/:path*`.
2. Gzip `Content-Encoding` sources updated to `/concordia-webgl/Build/:file*.{wasm,framework.js,data}.gz`
   (covers `concordia-webgl-out-editor-20260909-real.*`).
3. `middleware.ts`: `buildCsp(..., { frameAncestors: "'self'" })` when
   `pathname.startsWith('/concordia-webgl/')` (same as unity-client).
4. Env left on `/concordia-webgl/index.html` (no unity-client flip).
5. Rebuilt standalone (`next build --webpack`), rsynced public, kickstarted
   `com.concord.frontend`.

Also unblocked the rebuild by fixing pre-existing JSX closings in
`PhysicsSandboxPanel.tsx` / `CryptoWalletWorkspace.tsx` and the corrupted
`'use client'` directive in `ChatSystemsDrawer.tsx`.

## Curl proof (127.0.0.1:3000)

```
=== index.html ===
HTTP/1.1 200 OK
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: xr-spatial-tracking=(self)
X-Frame-Options: SAMEORIGIN
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' https:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' https: wss: ws:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
x-nonce: ZjBhZThlN2UtOWMyYS00MmQzLWE2YmYtMDQ3NmJjZmFmMjgx
Accept-Ranges: bytes
Cache-Control: public, max-age=0
Last-Modified: Wed, 09 Sep 2026 06:54:27 GMT
ETag: W/"16a1-1a084f24cb8"
Content-Type: text/html; charset=UTF-8
Content-Length: 5793
Vary: Accept-Encoding
Date: Wed, 09 Sep 2026 07:08:33 GMT
Connection: keep-alive
Keep-Alive: timeout=5

=== loader.js ===
HTTP/1.1 200 OK
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: xr-spatial-tracking=(self)
X-Frame-Options: SAMEORIGIN
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' https:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' https: wss: ws:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
x-nonce: ZGNiNTcwOTMtYmU3ZS00YWRlLTkzMTQtMTA1ZWVkY2NmYmYw
Accept-Ranges: bytes
Cache-Control: public, max-age=0
Last-Modified: Wed, 09 Sep 2026 06:54:27 GMT
ETag: W/"6967-1a084f24cb8"
Content-Type: application/javascript; charset=UTF-8
Content-Length: 26983
Vary: Accept-Encoding
Date: Wed, 09 Sep 2026 07:08:33 GMT
Connection: keep-alive
Keep-Alive: timeout=5

=== data.gz ===
HTTP/1.1 200 OK
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: xr-spatial-tracking=(self)
Content-Type: application/octet-stream
Content-Encoding: gzip
Cache-Control: public, max-age=31536000, immutable
X-Frame-Options: SAMEORIGIN
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' https:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' https: wss: ws:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
x-nonce: NWY5MTgwYzgtZDU5Yy00NGQ0LTg4ODYtYzU3MjhiMGY3NDE0
Accept-Ranges: bytes
Last-Modified: Wed, 09 Sep 2026 06:54:24 GMT
ETag: W/"e5e616-1a084f24100"
Content-Length: 15066646
Date: Wed, 09 Sep 2026 07:08:33 GMT
Connection: keep-alive
Keep-Alive: timeout=5

=== wasm.gz ===
HTTP/1.1 200 OK
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: xr-spatial-tracking=(self)
Content-Type: application/wasm
Content-Encoding: gzip
Cache-Control: public, max-age=31536000, immutable
X-Frame-Options: SAMEORIGIN
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' https:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' https: wss: ws:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
x-nonce: MzE2MWNlYzItMjYzMi00MGI3LWFmMjQtZjcwZmUyZjAyZmIw
Accept-Ranges: bytes
Last-Modified: Wed, 09 Sep 2026 06:54:26 GMT
ETag: W/"109477a-1a084f248d0"
Content-Length: 17385338
Vary: Accept-Encoding
Date: Wed, 09 Sep 2026 07:08:33 GMT
Connection: keep-alive
Keep-Alive: timeout=5

=== framework.js.gz ===
HTTP/1.1 200 OK
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-XSS-Protection: 1; mode=block
Referrer-Policy: strict-origin-when-cross-origin
Permissions-Policy: xr-spatial-tracking=(self)
Content-Type: application/javascript
Content-Encoding: gzip
Cache-Control: public, max-age=31536000, immutable
X-Frame-Options: SAMEORIGIN
content-security-policy: default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; media-src 'self' https:; font-src 'self' data:; worker-src 'self' blob:; connect-src 'self' https: wss: ws:; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'
x-nonce: Y2VjYmFhMjctZTRhZS00MGZmLWE5NDQtMDJmYWY3YjAzMGMz
Accept-Ranges: bytes
Last-Modified: Wed, 09 Sep 2026 06:54:27 GMT
ETag: W/"15e67-1a084f24cb8"
Content-Length: 89703
Vary: Accept-Encoding
Date: Wed, 09 Sep 2026 07:08:33 GMT
Connection: keep-alive
Keep-Alive: timeout=5


```

### Checklist
- [x] `X-Frame-Options: SAMEORIGIN` on `/concordia-webgl/index.html` (not DENY)
- [x] loader/data/wasm/framework return HTTP 200
- [x] `.gz` assets include `Content-Encoding: gzip`
- [x] CSP `frame-ancestors 'self'`
