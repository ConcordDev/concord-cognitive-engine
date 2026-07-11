import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

/**
 * Auth middleware — enforces authentication via cookie check.
 * CSP nonce generation was removed because it blocks Next.js inline scripts
 * in production builds. Security headers are handled at the reverse-proxy layer.
 */

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

  // Allow public paths through
  if (PUBLIC_PATHS.has(pathname)) {
    return NextResponse.next();
  }

  // Allow public prefixes through
  if (PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  // Allow static assets (by extension) through — see STATIC_ASSET_RE comment.
  if (STATIC_ASSET_RE.test(pathname)) {
    return NextResponse.next();
  }

  // Check for session cookie (httpOnly cookie set by backend on login).
  const hasSession =
    request.cookies.has('concord_auth') ||
    request.cookies.has('concord_refresh');

  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    loginUrl.searchParams.set('from', pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    /*
     * Match all paths except static files and images.
     */
    '/((?!_next/static|_next/image|favicon.ico|icons/).*)',
  ],
};
