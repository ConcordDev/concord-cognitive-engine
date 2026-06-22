// @ts-nocheck — Express middleware patterns require complex type overrides; incremental migration
/**
 * @fileoverview Centralized middleware configuration for the Concord server.
 * Extracted from server.js to improve modularity while preserving the monolith architecture.
 *
 * Configures: CSP nonce, Helmet, compression, body parsing, idempotency,
 * CORS, request ID, request logging, sanitization, rate limiting, metrics,
 * cookie parsing, auth, write-auth, and CSRF.
 */

import crypto from "crypto";
import securityHeaders from './security-headers.js';

/**
 * Configure all middleware on the Express app.
 *
 * @param {import('express').Application} app - Express application instance
 * @param {object} deps - Dependencies injected from server.js
 * @param {typeof import('express')} deps.express - Express module
 * @param {Function|null} deps.helmet - Helmet middleware (optional)
 * @param {Function} deps.cors - CORS middleware
 * @param {Function|null} deps.compression - Compression middleware (optional)
 * @param {Function|null} deps.rateLimiter - Rate limiter instance (optional)
 * @param {Function} deps.idempotencyMiddleware - Idempotency middleware
 * @param {Function} deps.requestIdMiddleware - Request ID middleware
 * @param {Function} deps.requestLoggerMiddleware - Structured logging middleware
 * @param {Function} deps.sanitizationMiddleware - Input sanitization middleware
 * @param {Function|null} deps.inputLimitsMiddleware - Field-level input length enforcement (optional)
 * @param {Function|null} deps.requestTimeoutMiddleware - Request timeout middleware (optional)
 * @param {Function} deps.metricsMiddleware - Prometheus metrics middleware
 * @param {Function} deps.cookieParserMiddleware - Cookie parsing middleware
 * @param {Function} deps.authMiddleware - Authentication middleware
 * @param {Function} deps.productionWriteAuthMiddleware - Production write-auth middleware
 * @param {Function} deps.csrfMiddleware - CSRF protection middleware
 * @param {string} deps.NODE_ENV - Current environment
 */
export default function configureMiddleware(app, deps) {
  const {
    express,
    helmet,
    cors,
    compression,
    rateLimiter,
    idempotencyMiddleware,
    requestIdMiddleware,
    requestLoggerMiddleware,
    sanitizationMiddleware,
    inputLimitsMiddleware,
    requestTimeoutMiddleware,
    metricsMiddleware,
    cookieParserMiddleware,
    authMiddleware,
    productionWriteAuthMiddleware,
    csrfMiddleware,
    NODE_ENV,
  } = deps;

  // ---- Security Headers (standalone, runs before Helmet) ----
  app.use(securityHeaders);

  // ---- CSP Nonce Generation ----
  // Generate a per-request nonce for Content-Security-Policy script integrity
  app.use((req, res, next) => {
    res.locals.cspNonce = crypto.randomBytes(16).toString('base64');
    next();
  });

  // ---- Helmet: Security Headers ----
  if (helmet) {
    app.use(helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // M3: drop 'unsafe-inline' (and dev 'unsafe-eval') from scriptSrc so the
          // per-request nonce is actually ENFORCED (with 'unsafe-inline' present, CSP3
          // browsers ignore the nonce). This CSP applies to express/API responses (JSON,
          // and the express-served Swagger page which carries the nonce on its inline
          // init script) — NOT the Next.js HTML document, so the app is unaffected.
          scriptSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
          styleSrc: ["'self'", "'unsafe-inline'"], // Required for styled-components/emotion
          imgSrc: ["'self'", "data:", "blob:", "https:"],
          connectSrc: ["'self'", "wss:", "ws:", ...(process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim()) : [])],
          fontSrc: ["'self'", "data:"],
          objectSrc: ["'none'"],
          mediaSrc: ["'self'"],
          frameSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
          upgradeInsecureRequests: NODE_ENV === "production" ? [] : null,
        },
      },
      crossOriginEmbedderPolicy: NODE_ENV === "production",
      hsts: NODE_ENV === "production" ? { maxAge: 31536000, includeSubDomains: true, preload: true } : false,
      referrerPolicy: { policy: "strict-origin-when-cross-origin" },
      permissionsPolicy: {
        features: {
          camera: ["'none'"],
          microphone: ["'self'"],
          geolocation: ["'none'"],
          payment: ["'none'"],
        },
      },
    }));
  }

  // CSP nonce is available via res.locals.cspNonce for template rendering.
  // It must NOT be exposed in a response header (that would defeat CSP).

  // ---- Compression ----
  if (compression) app.use(compression());

  // ---- Body Parsing (per-endpoint size limits) ----
  // Strict limits for chatty endpoints; generous for bulk operations
  const BODY_LIMITS = {
    '/api/chat': '256kb',
    '/api/ask': '256kb',
    '/api/chat/stream': '256kb',
    '/api/chat/feedback': '16kb',
    '/api/auth/register': '16kb',
    '/api/auth/login': '16kb',
    '/api/auth/change-password': '4kb',
    '/api/shared-session': '64kb',
  };

  app.use((req, res, next) => {
    // Find most specific matching route prefix
    const matchedLimit = Object.entries(BODY_LIMITS).find(([prefix]) => req.url.startsWith(prefix));
    const limit = matchedLimit ? matchedLimit[1] : '10mb';
    // Accept the Fediverse Content-Type for federation inbox POSTs.
    // Default express.json() only parses application/json; Mastodon &
    // friends send application/activity+json (and the historical
    // application/ld+json variant). Without this extra type list the
    // inbox handler sees an empty body and returns missing_activity_fields.
    express.json({
      limit,
      type: ['application/json', 'application/activity+json', 'application/ld+json'],
      verify: (innerReq, _res, buf) => {
        // Stripe webhook signature verification needs the UNPARSED body bytes
        // (stripe.webhooks.constructEvent hashes the raw payload). Capture it
        // for the canonical Stripe webhook path + legacy aliases. Match on
        // pathname only (strip any query string).
        const _path = (innerReq.url || '').split('?')[0];
        if (_path === '/api/stripe/webhook' || _path === '/api/economy/webhook' || _path === '/api/economic/webhook') {
          innerReq.rawBody = buf;
        }
        // ActivityPub inbox needs the unparsed body so HTTP-Signature
        // digest verification can prove the body wasn't tampered with.
        if (/^\/api\/federation\/users\/[^/]+\/inbox\b/.test(innerReq.url)) innerReq.rawBody = buf;
      },
    })(req, res, next);
  });
  app.use(express.urlencoded({ extended: true, limit: "10mb" }));

  // ---- Body parser error handler ----
  // express.json() throws on malformed JSON, empty bodies with a content-
  // type, oversized payloads, etc. Without an explicit handler the error
  // bubbles to the default Express handler and the client sees 500. These
  // are user input failures — they should be 400, not 500.
  app.use((err, req, res, next) => {
    if (!err) return next();
    if (err.type === 'entity.parse.failed' || err instanceof SyntaxError) {
      return res.status(400).json({ ok: false, error: 'malformed_json', message: err.message });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ ok: false, error: 'payload_too_large', limit: err.limit });
    }
    return next(err);
  });

  // ---- Idempotency ----
  // Category 2: Double-submit prevention via Idempotency-Key header
  app.use(idempotencyMiddleware);

  // ---- CORS ----
  const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(",").map(o => o.trim())
    : [];
  const corsOptions = {
    origin: (origin, callback) => {
      // Requests with no Origin header come from same-origin requests, server-to-server
      // calls, health checks (curl/Docker), and non-browser clients. Browsers always
      // send an Origin header on cross-origin requests, so no-origin is safe to allow.
      if (!origin) {
        return callback(null, true);
      }
      // In development, allow localhost
      if (NODE_ENV !== "production" && (origin.includes("localhost") || origin.includes("127.0.0.1"))) {
        return callback(null, true);
      }
      // Explicit allowlist takes priority
      if (allowedOrigins.length > 0) {
        if (allowedOrigins.includes(origin)) {
          return callback(null, true);
        }
        // DENY CLEANLY — do NOT throw. Passing an Error to the cors callback turns a
        // simple "origin not allowed" into a 500 INTERNAL_ERROR (the cors lib calls
        // next(err) → the global error handler). That made every cross-origin/mismatched
        // request surface in the browser UI as a scary 500 "error code" + log spam, when
        // the correct behaviour is a normal CORS denial (no ACAO header → the browser
        // blocks it client-side). callback(null,false) still fails CLOSED — it just does
        // so gracefully. Set ALLOWED_ORIGINS to the EXACT browser origin (apex AND www,
        // https) to allow it.
        console.warn("[CORS] Rejected origin (not in ALLOWED_ORIGINS):", origin);
        return callback(null, false);
      }
      // ALLOWED_ORIGINS not configured
      if (NODE_ENV === "production") {
        // M2: still fail CLOSED (deny), but gracefully — see the note above. A missing
        // ALLOWED_ORIGINS must not 500 every request; it denies cross-origin cleanly.
        // ALLOWED_ORIGINS is a required prod env (validateEnvironment warns at boot).
        console.error("[CORS] DENIED: ALLOWED_ORIGINS is not configured in production. Origin:", origin, "— Set ALLOWED_ORIGINS=https://your-frontend-domain (include apex AND www)");
        return callback(null, false);
      }
      // In development, allow all origins with a warning
      console.warn("[CORS] WARNING: No ALLOWED_ORIGINS set. Allowing origin:", origin, "— Set ALLOWED_ORIGINS env var to restrict.");
      return callback(null, true);
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization", "X-API-Key", "X-Requested-With", "X-Session-ID", "X-CSRF-Token", "X-XSRF-Token", "X-Request-ID", "Idempotency-Key"],
    exposedHeaders: ["X-Request-ID"],
  };
  app.use(cors(corsOptions));

  // ---- Request Tracking & Logging ----
  app.use(requestIdMiddleware);       // Add request ID to all requests
  app.use(requestLoggerMiddleware);   // Structured JSON logging
  app.use(sanitizationMiddleware);    // Sanitize input
  if (inputLimitsMiddleware) app.use(inputLimitsMiddleware); // Enforce field-level length limits

  // ---- Request Timeouts ----
  if (requestTimeoutMiddleware) app.use(requestTimeoutMiddleware);

  // ---- Rate Limiting ----
  if (rateLimiter) app.use(rateLimiter);

  // ---- Metrics ----
  app.use(metricsMiddleware);

  // ---- Auth Pipeline ----
  app.use(cookieParserMiddleware);          // Parse cookies before auth
  app.use(authMiddleware);                  // Authentication
  app.use(productionWriteAuthMiddleware);   // Enforce auth on all writes in production
  app.use(csrfMiddleware);                  // CSRF protection after auth
}
