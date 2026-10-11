// Loaded before the depth harness so server.js boots with ownership checks on.
// AUTH_MODE=public skips dtu.delete's owner gate; this file must be the
// first import in art-upload-paywall.test.js.
process.env.AUTH_MODE = "jwt";
if (!process.env.JWT_SECRET) process.env.JWT_SECRET = "art-upload-paywall-test-secret";
process.env.NODE_ENV = process.env.NODE_ENV || "test";
process.env.CONCORD_NO_LISTEN = "true";
