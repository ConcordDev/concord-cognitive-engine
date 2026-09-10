// @ts-check
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  skipTrailingSlashRedirect: true,
  output: 'standalone',
  // Local next dev: Chrome hits 127.0.0.1:3000; Next 15 blocks that host for HMR
  // unless listed. Without it the client never hydrates and the splash never drops.
  allowedDevOrigins: ['127.0.0.1', 'localhost'],
  images: {
    remotePatterns: [
      { protocol: 'http', hostname: 'localhost' },
      { protocol: 'http', hostname: '127.0.0.1' },
      { protocol: 'https', hostname: 'concord-os.org' },
    ],
    unoptimized: process.env.NODE_ENV === 'development',
  },
  // Tree-shake heavy icon libraries and UI packages
  experimental: {
    useTypeScriptCli: true,
    optimizePackageImports: [
      'lucide-react',
      'framer-motion',
      '@tiptap/react',
      '@tiptap/starter-kit',
    ],
  },
  // Security headers (CSP nonces were removed — they block Next.js inline scripts)
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            // HSTS. The Express API sets this via Helmet
            // (server/middleware/index.js) and nginx sets it too
            // (nginx/conf.d/default.conf), but NEITHER is necessarily in the
            // browser's path for the HTML document: the Cloudflare tunnel
            // routes root traffic to this Next.js server on 127.0.0.1:3000,
            // so on that topology the document shipped with no HSTS at all.
            //
            // The existing test (server/tests/platinum-security-headers.test.js)
            // could not catch this — it greps server.js/middleware for an HSTS
            // config, so it passes on the API's header while the frontend has
            // none.
            //
            // Two years, subdomains included, preload-eligible — matching what
            // Helmet already sends on the API so the two layers agree.
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-XSS-Protection',
            value: '1; mode=block',
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin',
          },
          {
            // Explicitly allow same-origin WebXR (immersive-ar/vr) on the document —
            // navigator.xr is gated by the xr-spatial-tracking policy (Chromium rejects
            // with SecurityError where disallowed). Only this feature is listed so
            // camera/microphone/geolocation keep their default `self` allowlist (other
            // lenses use mic for karaoke, geolocation for routes, etc.).
            key: 'Permissions-Policy',
            value: 'xr-spatial-tracking=(self)',
          },
        ],
      },

      {
        // Unity WebGL gzip builds: browser must see Content-Encoding: gzip
        // so it decompresses .wasm.gz / .framework.js.gz / .data.gz.
        // Filename prefix changes per editor export (e.g. …-editor-20260909-real);
        // match any Build/*.gz so Content-Encoding survives renames.
        source: '/concordia-webgl/Build/:file*.wasm.gz',
        headers: [
          { key: 'Content-Type', value: 'application/wasm' },
          { key: 'Content-Encoding', value: 'gzip' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/concordia-webgl/Build/:file*.framework.js.gz',
        headers: [
          { key: 'Content-Type', value: 'application/javascript' },
          { key: 'Content-Encoding', value: 'gzip' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        source: '/concordia-webgl/Build/:file*.data.gz',
        headers: [
          { key: 'Content-Type', value: 'application/octet-stream' },
          { key: 'Content-Encoding', value: 'gzip' },
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // 3D assets (GLB/GLTF/KTX2/Draco) are content-addressed + immutable — cache hard.
        // Complements the service-worker SWR + the in-memory GLTF LRU cache.
        source: '/:dir(models|meshes|draco|basis)/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // Launch edge-offload (docs/LAUNCH_EDGE_OFFLOAD.md) — explicit reinforcement of
        // Next.js's own built-in immutable-caching behavior for hashed build output.
        // Next's standalone server already emits this Cache-Control for /_next/static/*
        // (the filename embeds a content hash, so a stale cached copy can never be
        // served under a URL a new build would use), but stating it here makes the
        // contract explicit for the CDN layer in front of it and survives any future
        // change to Next's internal static-file server. Do not lower this — it's the
        // single largest edge-cacheable win for this deployment (see the doc).
        source: '/_next/static/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
        ],
      },
      {
        // Root-level /public assets (favicon, logos, PWA icons) are NOT content-hashed
        // (unlike /_next/static), so they must NOT be marked immutable — a logo swap at
        // the same URL needs to actually propagate. A moderate cache + SWR still lets
        // both the browser and the Cloudflare edge skip re-fetching on every load,
        // without the multi-year staleness risk immutable would carry for these paths.
        //
        // LATENT RISK, checked and currently clear: this matcher keys on the
        // EXTENSION, not the prefix, so it would also match an API path ending in
        // one — e.g. a future authenticated `/api/avatar/:id.png`. A `public`
        // directive on an authenticated response is cacheable by SHARED caches,
        // which is a cache-poisoning shape. Verified 2026-07-25 that no route
        // under `server/routes/` serves any of these extensions today, so nothing
        // is exposed. Two things keep it that way: the Cloudflare Cache Rule in
        // docs/LAUNCH_EDGE_OFFLOAD.md §4 bypasses `/api/*` at highest priority,
        // and this note. If you ever add an authenticated image/font endpoint
        // under `/api/`, scope this rule to exclude it rather than assuming the
        // edge rule alone will save you — browsers cache too.
        source: '/:path*.(svg|ico|png|jpg|jpeg|webp|woff|woff2|ttf)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=86400, stale-while-revalidate=604800' },
        ],
      },
      {
        // Allow service worker to control the entire scope
        source: '/sw.js',
        headers: [
          { key: 'Service-Worker-Allowed', value: '/' },
          { key: 'Cache-Control', value: 'no-cache' },
        ],
      },
      {
        // Clickjacking: DENY everywhere except the Unity WebGL player paths,
        // which /lenses/world iframes same-origin. `/(.*)` used to set DENY
        // globally and that refused the embed even from the world lens.
        // Both /unity-client/ and /concordia-webgl/ are carve-outs (env points
        // at /concordia-webgl/index.html).
        source: '/((?!unity-client/|concordia-webgl/).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
        ],
      },
      {
        source: '/unity-client/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
      {
        source: '/concordia-webgl/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
      {
        // Unity gzip-compresses *.unityweb at export time. The browser must
        // see Content-Encoding: gzip (or Unity's decompressionFallback, which
        // the index route also injects). Without this, createUnityInstance
        // treats gzip bytes as wasm and the canvas stays black.
        source: '/unity-client/Build/:file*.unityweb',
        headers: [
          { key: 'Content-Encoding', value: 'gzip' },
          { key: 'Content-Type', value: 'application/octet-stream' },
        ],
      },
    ];
  },
  turbopack: {
    root: __dirname,
  },
  typescript: {
    // Keep strict checks by default; allow CI Docker build to opt out explicitly.
    ignoreBuildErrors: process.env.CI_SKIP_TYPECHECK === '1',
  },
  // Next.js 16 removed build-time ESLint integration entirely (the `eslint`
  // key here is now silently ignored with an "Unrecognized key(s)" warning —
  // confirmed via a real `next build` run). The CI_SKIP_LINT_IN_BUILD gate
  // it implemented did nothing under Next 15 either in a way that mattered
  // here: `.github/workflows/ci.yml` already runs `npm run lint` as its own
  // independent step, not relying on next build's internal ESLint pass, so
  // removing this dead config changes no real CI coverage.
  // Proxy API and socket requests to the backend server in production.
  //
  // Topology note (audit 2026-07-27 — reconciles an apparent contradiction
  // with docs/DEPLOYMENT_TOPOLOGY.md, which was never actually wrong, just
  // describing a DIFFERENT one of this repo's two real topologies):
  //   - BARE METAL (pm2/startup.sh, the current primary A40 target — no
  //     nginx container at all): a `cloudflared` binary on the host tunnels
  //     directly to this frontend on :3000 (infra/cloudflare/cloudflared.yml.example's
  //     "BARE METAL" block). Its ingress rules already route /api/*,
  //     /socket.io/*, and /godot-ws straight to the backend on :5050 at the
  //     edge (one hop, avoids double-proxying and keeps TRUST_PROXY hop-count
  //     correct) — so THESE rewrites mostly serve local `next dev`/`next start`
  //     without a tunnel, or as a safety net for any request that reaches
  //     the frontend anyway.
  //   - DOCKER COMPOSE (nginx service in docker-compose.yml, matches
  //     docs/DEPLOYMENT_TOPOLOGY.md's diagram): nginx terminates 80/443 and
  //     does its own reverse-proxying (nginx/conf.d/default.conf) to both
  //     frontend :3000 and backend :5050; an optional Cloudflare tunnel in
  //     that mode points at nginx, not directly at this frontend.
  // Both topologies are real and coexist in the repo; this file's rewrites
  // are harmless in either since they forward to the same BACKEND_URL.
  async redirects() {
    return [
      { source: '/signup', destination: '/register', permanent: true },
      { source: '/chat', destination: '/lenses/chat', permanent: false },
      { source: '/dashboard', destination: '/hub', permanent: false },
      { source: '/marketplace', destination: '/lenses/marketplace', permanent: false },
      { source: '/world', destination: '/lenses/world', permanent: false },
      { source: '/graph', destination: '/lenses/graph', permanent: false },
      { source: '/hermes', destination: '/agents', permanent: false },
      { source: '/dila', destination: '/agents', permanent: false },
      { source: '/lenses', destination: '/hub', permanent: false },
    ];
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:5050';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
      },
      // HTTP/engine.io polling only. Next 16 `next dest` (launchd) does not
      // proxy WebSocket upgrades; browser sockets use same-origin + polling
      // first (lib/realtime/socket.ts). Production custom server is
      // server-proxy.js which DOES upgrade /socket.io to :5050.
      {
        source: '/socket.io',
        destination: `${backendUrl}/socket.io/`,
      },
      {
        source: '/socket.io/:path*',
        destination: `${backendUrl}/socket.io/:path*`,
      },
      {
        source: '/health',
        destination: `${backendUrl}/health`,
      },
      {
        source: '/ready',
        destination: `${backendUrl}/ready`,
      },
    ];
  },
  // WebXR opts for AR lens + force-resolve react to the package.json
  // version (18.3.1). Without this alias, Next 15.5 substitutes its
  // bundled React 19 in app-pages-browser chunks, which breaks
  // @react-three/fiber v8 (react-reconciler reaches into 18.x's
  // __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED.ReactCurrentOwner
  // — gone in React 19, throws TypeError on every R3F mount).
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    // three.js's experimental WebGPU renderer (lazy-loaded in ConcordiaScene
    // only when the user opts in via localStorage 'concordia:renderer'='webgpu')
    // uses top-level await. The experiment enables the TLA syntax.
    config.experiments = { ...config.experiments, topLevelAwait: true };
    // Suppress two known-harmless THIRD-PARTY build warnings (not code defects):
    //  • three.js's opt-in WebGPU renderer uses top-level await; webpack's
    //    down-level note ("target may not support async/await") is cosmetic on
    //    the modern browser target and the path is default-OFF.
    //  • @opentelemetry/instrumentation (pulled in via @sentry/node) uses a
    //    dynamic require for auto-instrumentation — the classic "Critical
    //    dependency: the request of a dependency is an expression" warning,
    //    harmless by design.
    config.ignoreWarnings = [
      ...(config.ignoreWarnings || []),
      { module: /three[\\/]examples[\\/]jsm[\\/](capabilities[\\/]WebGPU|renderers[\\/]webgpu)/ },
      { module: /@opentelemetry[\\/]instrumentation/ },
    ];
    return config;
  },
};

// Wrap with Sentry only when actually configured. Without SENTRY_DSN +
// SENTRY_ORG the tunnelRoute /monitoring/* rewrite injects script
// references that hit a redirect (Sentry CDN behaviour) and Chromium
// refuses to follow redirects for <script src> with the default CSP.
// That surfaces as a "Failed to load resource: 404" + "The script
// resource is behind a redirect, which is disallowed." console error
// on every page in dev / unconfigured environments. Skipping
// withSentryConfig when DSN isn't set removes the spurious script
// load entirely; production deployments that set NEXT_PUBLIC_SENTRY_DSN
// (and SENTRY_ORG/SENTRY_PROJECT for source maps) still get the full
// integration.
const sentryDsnConfigured = !!(process.env.NEXT_PUBLIC_SENTRY_DSN && process.env.SENTRY_ORG);
module.exports = sentryDsnConfigured
  ? withSentryConfig(nextConfig, {
      silent: true,
      org: process.env.SENTRY_ORG || "",
      project: process.env.SENTRY_PROJECT || "concord-frontend",
      disableLogger: true,
      tunnelRoute: "/monitoring",
      hideSourceMaps: true,
      widenClientFileUpload: false,
    })
  : nextConfig;
