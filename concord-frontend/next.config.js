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
  // WebXR opts for AR lens + persistent-cache big-string compression.
  webpack: (config, { isServer, dev }) => {
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    // Webpack's PackFileCacheStrategy warns on cache entries > 128KB
    // ("Serializing big strings (NkiB) impacts deserialization perf —
    // consider using Buffer instead"). Several lens pages are 130-210kiB
    // single-source files (world/page.tsx ~197kB, realestate ~139kB,
    // education ~210kB) which trip the warning on every cached rebuild.
    //
    // Two-part mitigation:
    //   1. Enable gzip compression on the persistent cache so the on-disk
    //      footprint is small even for the big strings.
    //   2. In production builds, raise the infrastructureLogging level to
    //      'error' — the big-string warning is purely advisory and would
    //      only be actionable by splitting the lens pages, which is a much
    //      bigger refactor. Dev builds keep all warnings so real issues
    //      still surface.
    if (config.cache && config.cache.type === 'filesystem' && !dev) {
      config.cache = {
        ...config.cache,
        compression: 'gzip',
      };
    }
    if (!dev) {
      config.infrastructureLogging = {
        ...(config.infrastructureLogging || {}),
        level: 'error',
      };
    }
    return config;
  },
};

module.exports = withSentryConfig(nextConfig, {
  silent: true,
  org: process.env.SENTRY_ORG || "",
  project: process.env.SENTRY_PROJECT || "concord-frontend",
  // disableLogger was deprecated; the SDK now reads
  // webpack.treeshake.removeDebugLogging from the bundler config. Sentry's
  // own bundler-plugin still strips debug logs when this flag is on, so we
  // keep behaviour parity. Remove this flag once the warning is gone in a
  // future SDK release.
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
  },
  tunnelRoute: "/monitoring",
  hideSourceMaps: true,
  widenClientFileUpload: false,
});
