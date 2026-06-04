/**
 * @fileoverview Security headers middleware for Concord server.
 *
 * Provides a standalone, lightweight security-headers layer that can be used
 * alongside (or instead of) Helmet.  When Helmet is available it handles most
 * of these headers already, but this module guarantees the exact policy values
 * specified by the project security requirements regardless of Helmet config.
 *
 * Headers set:
 *   Content-Security-Policy
 *   Strict-Transport-Security
 *   X-Frame-Options
 *   X-Content-Type-Options
 *   X-XSS-Protection
 *   Referrer-Policy
 *   Permissions-Policy
 */

/**
 * Express middleware that sets hardened security response headers.
 *
 * @param {import('express').Request}  req
 * @param {import('express').Response} res
 * @param {import('express').NextFunction} next
 */
export default function securityHeaders(req, res, next) {
  // ---- Content-Security-Policy ------------------------------------------------
  // M3: CSP is owned solely by the Helmet config in middleware/index.js (which adds the
  // per-request nonce). Setting it here too was dead (Helmet runs after and overwrites)
  // and a second, conflicting source of truth — removed. This middleware keeps the other
  // hardening headers below.

  // ---- Strict-Transport-Security ---------------------------------------------
  res.setHeader(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains"
  );

  // ---- Legacy / defence-in-depth headers -------------------------------------
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");

  // ---- Referrer-Policy -------------------------------------------------------
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");

  // ---- Permissions-Policy ----------------------------------------------------
  // Explicitly allow same-origin WebXR (immersive-ar/vr): per the WebXR spec, the
  // `xr-spatial-tracking` policy gates navigator.xr — Chromium rejects
  // isSessionSupported/requestSession with a SecurityError where it's disallowed.
  // It defaults to `self`, but being explicit future-proofs the AR/VR lenses against a
  // tightened policy. camera/mic/geolocation stay restricted (immersive-ar passthrough
  // is handled by the XR compositor, not getUserMedia, so camera=() doesn't block it).
  res.setHeader(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), xr-spatial-tracking=(self)"
  );

  next();
}
