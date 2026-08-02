import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Auth middleware — enforces authentication via cookie check, and (below)
 * generates a per-request CSP nonce.
 *
 * Security audit 2026-07-30: a prior CSP-nonce attempt was reportedly
 * removed because "it blocks Next.js inline scripts" — but the more likely
 * real cause (confirmed by grep) is that a naive `style-src 'nonce-x'`
 * WITHOUT `'unsafe-inline'` would have broken this app outright: CSP nonces
 * only apply to `<style>` ELEMENTS, never to the `style="..."` HTML
 * ATTRIBUTE, and this codebase has 800+ files using React's `style={{...}}`
 * prop (which compiles to that attribute) — there is no way to nonce those,
 * only to allow them. The Express API's own Helmet CSP
 * (server/middleware/index.js) already made exactly this call —
 * `styleSrc: ["'self'", "'unsafe-inline'"]`, commented "Required for
 * styled-components/emotion" — this mirrors that established, working
 * precedent for the much-more-inline-style-heavy frontend.
 *
 * Flipped to fully-enforced `Content-Security-Policy` (2026-07-30), after a
 * dedicated pre-flight audit rather than a browser test of all 260 lenses
 * (infeasible in this sandbox): confirmed zero raw `<script>` tags, zero
 * `javascript:` URLs, and zero `next/script` usage anywhere in `app/` or
 * `components/` (script-src's nonce + 'strict-dynamic' covers everything
 * that remains — Next's own bootstrap + its chunks); confirmed style-src's
 * `'unsafe-inline'` is unaffected by the flip (no nonce/hash competes with
 * it in that same directive, so the one known un-nonced `<style>` tag in
 * AmbientFeedback.tsx was never actually at risk); and traced all 13 files
 * using `<iframe>` — Forge/AppBuilder/PreviewPane's live previews use
 * sandboxed `srcDoc` (same-origin inline document, not a `frame-src`-gated
 * navigation) and LensStationOverlay/ArtifactRenderer use same-origin
 * relative paths (both already covered by 'self'), leaving exactly two real
 * external cases — YouTube embeds for rocket-launch webcasts
 * (LaunchCountdown.tsx) and NASA APOD's video-of-the-day entries
 * (NasaLivePanel.tsx/NasaExplorer.tsx) — now covered by the `frame-src`
 * directive below. See docs/SECURITY_SCAN_TRIAGE_2026-07.md for the full
 * report-only rollout history this flip closes out.
 */

function buildCsp(nonce: string): string {
  const directives = [
    `default-src 'self'`,
    // 'strict-dynamic' lets Next's own nonce'd bootstrap script load its
    // chunks/webpack runtime without allowlisting every chunk URL by hand.
    // 'wasm-unsafe-eval' is required for @dimforge/rapier3d-compat's
    // client-side WASM physics (world-lens) — narrower than 'unsafe-eval',
    // it permits WASM instantiation only, not arbitrary string-to-JS eval.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval'`,
    // See header comment: nonces cannot cover the `style` HTML attribute,
    // and this app's React components use it pervasively.
    `style-src 'self' 'unsafe-inline'`,
    // Generous, mirroring the API's own imgSrc precedent: user-uploaded
    // avatars/artifacts, generated thumbnails, and canvas/data-URI content
    // all need this.
    `img-src 'self' data: blob: https:`,
    // Music lens streams from external free-API sources (iTunes/Jamendo/
    // Audius — see CLAUDE.md's music-lens section) whose CDN hosts aren't
    // enumerable in advance.
    `media-src 'self' https:`,
    `font-src 'self' data:`,
    // Web Workers (avatar animator, physics offload) are blob: URLs.
    `worker-src 'self' blob:`,
    // 'https:'/'wss:'/'ws:' cover every real production topology (frontend
    // and backend share an origin behind the Cloudflare tunnel there). But
    // local dev and CI/E2E run frontend (:3000) and backend (:5050) as
    // genuinely separate plain-http origins (NEXT_PUBLIC_API_URL is an
    // absolute http://localhost:5050 URL there) — connect-src's scheme
    // allowlist has no 'http:' entry, so EVERY cross-origin call was
    // silently CSP-blocked before it even reached the network layer,
    // independent of the backend's own CORS headers (confirmed directly: a
    // real fetch to http://localhost:5050 logs "Refused to connect ...
    // violates ... Content Security Policy directive" in the browser
    // console, and a Playwright page.route() mock of the same URL never
    // even fires, because CSP evaluates the destination before
    // routing/interception decides how to answer it).
    //
    // NOT gated on NODE_ENV: `next build`/`next start` (what CI's E2E job
    // actually runs) always bakes NODE_ENV='production' into the bundle
    // regardless of the shell env, so a NODE_ENV check here would silently
    // never fire in exactly the CI topology this exists to fix. Instead,
    // derive the exact allowed origin from NEXT_PUBLIC_API_URL itself (the
    // same env var the frontend's own API client uses to build every
    // request) when — and only when — it's explicitly a plain-http URL;
    // real production either omits it (same-origin) or sets it to
    // https://..., already covered by 'https:' above, so this is inert
    // there and precise (not a `http://localhost:*` wildcard) everywhere
    // else.
    `connect-src 'self' https: wss: ws:${(() => {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL;
      if (!apiUrl) return '';
      try {
        const u = new URL(apiUrl);
        return u.protocol === 'http:' ? ` ${u.origin}` : '';
      } catch {
        return '';
      }
    })()}`,
    // Pre-flight for the enforce flip (2026-07-30): grepped every real
    // `<iframe src={...}>` in the app. Forge/AppBuilder/PreviewPane's live
    // previews all use `srcDoc` (inline, sandboxed, same-origin document —
    // not a `frame-src`-gated navigation) and LensStationOverlay's src is a
    // same-origin `/lenses/...` path — both already covered by 'self'. Two
    // real external cases: LaunchCountdown.tsx's `ytEmbed()` always builds
    // a `https://www.youtube.com/embed/...` URL for rocket-launch webcasts,
    // and NASA's APOD API links its video-of-the-day entries to YouTube
    // too (astronomy/NasaLivePanel.tsx, NasaExplorer.tsx). No other
    // external iframe source exists in the app today.
    `frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ];
  return directives.join('; ');
}

const PUBLIC_PATHS = new Set([
  '/',
  '/explore',        // public "look around first" showcase — no account needed
  '/login',
  '/register',
  '/forgot-password',
  '/reset-password',  // token arrives via ?token= — the page itself must be public
  '/onboarding',
]);

const PUBLIC_PREFIXES = [
  '/api/',
  '/_next/',
  '/icons/',
  '/legal/',
  '/dtu/',
  '/lens/',
  '/newsletter/',
  '/profile/',
  // Static render-pipeline assets must serve unauthenticated. Without
  // these, AvatarSystem3D's loadHeroMesh falls through to procedural
  // for every hero NPC (Phase S bake wasted), the soundscape engine
  // never loads stems, and procedural-buildings textures 307 to login.
  '/meshes/',
  '/music/',
  '/sounds/',
  '/textures/',
  '/manifest.json',
  '/manifest.webmanifest',
  '/robots.txt',
  '/favicon.ico',
  '/favicon.svg',
  // Welding client portal — a customer with no Concord account opens a
  // token link a welder sent them (`/api/welding/portal/:token`, itself
  // public). Without this prefix the middleware would 307 an anonymous
  // customer to /login before the page ever renders, defeating the whole
  // point of a no-account customer portal.
  '/welding-portal/',
  // Animation public share viewer — an anonymous visitor with a share
  // link opens `/share/animation/:token`, backed by the public
  // `/api/animation/share/:token` route (server.js). Without this prefix
  // the middleware would 307 the visitor to /login before the page ever
  // renders, defeating the whole point of a logged-out-viewable share link.
  '/share/animation/',
  // Chat public share viewer — an anonymous visitor with a share link opens
  // `/share/chat/:token`, backed by the public `/api/chat/share/:token`
  // route (server.js). Without this prefix the middleware would 307 the
  // visitor to /login before the page ever renders, same as the animation
  // share fix above — this is the #1 organic loop for a chat product.
  '/share/chat/',
  // Spectate public viewer — a read-only, no-account-required live world
  // feed at `/spectate/:worldId`, backed by the public
  // `/api/spectate/:worldId/subscribe|feed` + `/api/spectate/heartbeat`
  // routes (server.js). Without this prefix the middleware would 307 an
  // anonymous visitor to /login before the page ever renders, defeating
  // the point of an always-on embeddable spectator feed. Distinct from
  // `/lenses/spectate/:worldId`, the authenticated in-app version.
  '/spectate/',
  // Explore fork sub-pages (`/explore/engine`, `/explore/world`) — same
  // public "look around first" showcase as the top-level `/explore` (in
  // PUBLIC_PATHS above), just split into two audience-specific entry paths.
  '/explore/',
  // PWA service worker + its scope assets must serve unauthenticated, or the SW
  // script is fetched via a 307→/login redirect and the browser refuses to register
  // it ("The script resource is behind a redirect, which is disallowed").
  '/sw.js',
  '/service-worker.js',
  '/offline',
  '/workbox-',
];

// Anything served out of `public/` — including top-level files like
// `/logo-cosmic.svg` or `/og-image.png` — is world-readable by construction
// in Next.js (there is no auth gate a static file in `public/` could ever
// honor). Prior to this, only a curated set of PUBLIC_PREFIXES subdirectories
// (/meshes/, /music/, /sounds/, /textures/, ...) were exempted, so any
// top-level static asset 307'd anonymous visitors to /login instead of
// serving the file (e.g. the logo on the public /login page itself was
// broken). Matching by extension covers the whole class without gating
// real page routes, which never end in a static-file extension.
const STATIC_ASSET_RE =
  /\.(svg|png|jpe?g|gif|webp|avif|ico|woff2?|ttf|otf|mp3|ogg|wav|mp4|webm|glb|gltf|json|txt|xml|md|map)$/i;

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Nonce is generated for every request (not just authenticated ones) —
  // the CSP must cover the public /login, /explore, etc. pages too. Base64
  // of a random UUID, the standard pattern (128 bits of entropy, never
  // reused across requests).
  const nonce = btoa(crypto.randomUUID());
  const csp = buildCsp(nonce);

  // Propagate the nonce to Server Components via a request header (read
  // with `(await headers()).get('x-nonce')`), and set the CSP itself as a
  // fully-enforced header on the response — see the header comment for the
  // pre-flight audit that justified the flip from report-only.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set('x-nonce', nonce);

  function withCspHeaders(response: NextResponse): NextResponse {
    response.headers.set('Content-Security-Policy', csp);
    response.headers.set('x-nonce', nonce);
    return response;
  }

  const passThroughOptions = { request: { headers: forwardedHeaders } };

  // Allow public paths through
  if (PUBLIC_PATHS.has(pathname)) {
    return withCspHeaders(NextResponse.next(passThroughOptions));
  }

  // Allow public prefixes through
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return withCspHeaders(NextResponse.next(passThroughOptions));
  }

  // Allow static assets (by extension) through — see STATIC_ASSET_RE comment.
  if (STATIC_ASSET_RE.test(pathname)) {
    return withCspHeaders(NextResponse.next(passThroughOptions));
  }

  // Check for session cookie (httpOnly cookie set by backend on login).
  const hasSession =
    request.cookies.has('concord_auth') ||
    request.cookies.has('concord_refresh');

  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return withCspHeaders(NextResponse.redirect(loginUrl));
  }

  return withCspHeaders(NextResponse.next(passThroughOptions));
}

export const config = {
  matcher: [
    /*
     * Match all paths except static files and images.
     */
    '/((?!_next/static|_next/image|favicon.ico|icons/).*)',
  ],
};
