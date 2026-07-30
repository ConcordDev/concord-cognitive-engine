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
 * Shipped as `Content-Security-Policy-Report-Only` (not enforced) for this
 * rollout: this is a 260-lens app (3D/canvas/WASM-physics/WebRTC/music/many
 * third-party embeds) that cannot be exhaustively browser-verified in this
 * environment. Report-only collects real violation data with zero
 * functional risk — the standard, textbook way to introduce a new CSP on an
 * app this size — rather than claiming "enforced" without having verified
 * it doesn't break something. See docs/SECURITY_SCAN_TRIAGE_2026-07.md for
 * the flip-to-enforce follow-up plan and the one known un-nonced `<style>`
 * tag (AmbientFeedback.tsx) this will surface as a report.
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
    `connect-src 'self' https: wss: ws:`,
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
  // with `(await headers()).get('x-nonce')`), and set the CSP itself as
  // Report-Only on the response — see the header comment for why.
  const forwardedHeaders = new Headers(request.headers);
  forwardedHeaders.set('x-nonce', nonce);

  function withCspHeaders(response: NextResponse): NextResponse {
    response.headers.set('Content-Security-Policy-Report-Only', csp);
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
