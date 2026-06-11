// @ts-check
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withSentryConfig } = require("@sentry/nextjs");

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  images: {
    domains: ['localhost', 'concord-os.org'],
    unoptimized: process.env.NODE_ENV === 'development',
  },
  // Tree-shake heavy icon libraries and UI packages
  experimental: {
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
            key: 'X-Content-Type-Options',
            value: 'nosniff',
          },
          {
            key: 'X-Frame-Options',
            value: 'DENY',
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
        // 3D assets (GLB/GLTF/KTX2/Draco) are content-addressed + immutable — cache hard.
        // Complements the service-worker SWR + the in-memory GLTF LRU cache.
        source: '/:dir(models|meshes|draco|basis)/:path*',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
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
    ];
  },
  turbopack: {
    root: __dirname,
  },
  typescript: {
    // Keep strict checks by default; allow CI Docker build to opt out explicitly.
    ignoreBuildErrors: process.env.CI_SKIP_TYPECHECK === '1',
  },
  eslint: {
    // Keep strict checks by default; allow CI Docker build to opt out explicitly.
    ignoreDuringBuilds: process.env.CI_SKIP_LINT_IN_BUILD === '1',
  },
  // Proxy API and socket requests to the backend server in production.
  // The Cloudflare tunnel routes to the frontend (port 3000); these rewrites
  // forward /api/* and /socket.io/* to the backend on port 5050.
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || 'http://127.0.0.1:5050';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/api/:path*`,
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
    // uses top-level await. Enable webpack's TLA experiment so that chunk
    // compiles cleanly instead of warning "target does not appear to support
    // 'async/await'". Modern browsers support async/await; this just tells
    // webpack to emit it rather than down-level.
    config.experiments = { ...config.experiments, topLevelAwait: true };
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
