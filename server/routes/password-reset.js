/**
 * Password Reset Routes
 * Mounted at /api/auth (added to existing auth router)
 *
 * POST /api/auth/forgot-password  — request reset email
 * POST /api/auth/reset-password   — reset with token
 * GET  /api/auth/verify-email     — verify email address
 */

import express from "express";
import logger from "../logger.js";
import {
  sendPasswordResetEmail,
  consumeResetToken,
  sendVerificationEmail,
  verifyEmailToken,
} from "../lib/email-service.js";

/**
 * @param {object} deps
 * @param {object} deps.AuthDB - Auth database interface
 * @param {Function} deps.hashPassword - bcrypt hash function
 * @param {Function} [deps.authRateLimiter] - Rate limiter middleware
 */
export default function createPasswordResetRouter({ AuthDB, hashPassword, authRateLimiter }) {
  const router = express.Router();
  const rateLimit = authRateLimiter || ((req, res, next) => next());

  /**
   * POST /forgot-password
   * Request a password reset email.
   *
   * Always returns 200 to prevent email enumeration.
   */
  router.post("/forgot-password", rateLimit, async (req, res) => {
    const { email } = req.body;
    if (!email || typeof email !== "string") {
      return res.status(400).json({ ok: false, error: "Email is required" });
    }

    // Always respond with success to prevent email enumeration
    const safeResponse = {
      ok: true,
      message: "If an account exists with this email, a reset link has been sent.",
    };

    try {
      const user = AuthDB.getUserByEmail(email.toLowerCase().trim());
      if (!user) {
        logger.info("password-reset", `Reset requested for non-existent email: ${email}`);
        return res.json(safeResponse);
      }

      const result = await sendPasswordResetEmail(user.id, user.email, user.username);
      if (!result.ok) {
        logger.error("password-reset", `Failed to send reset email: ${result.error}`);
      }

      return res.json(safeResponse);
    } catch (err) {
      logger.error("password-reset", `Error in forgot-password: ${err.message}`);
      return res.json(safeResponse); // Still return safe response
    }
  });

  /**
   * POST /reset-password
   * Reset password using a valid token.
   */
  router.post("/reset-password", rateLimit, async (req, res) => {
    const { token, newPassword } = req.body;

    if (!token || !newPassword) {
      return res.status(400).json({ ok: false, error: "Token and new password are required" });
    }

    if (typeof newPassword !== "string" || newPassword.length < 8) {
      return res.status(400).json({ ok: false, error: "Password must be at least 8 characters" });
    }

    try {
      const result = consumeResetToken(token);
      if (!result.valid) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      // Update password in AuthDB
      const user = AuthDB.getUserById ? AuthDB.getUserById(result.userId) : null;
      if (!user) {
        return res.status(404).json({ ok: false, error: "User not found" });
      }

      const passwordHash = hashPassword(newPassword);

      // Update via AuthDB if method exists, otherwise direct db update
      if (AuthDB.updatePassword) {
        AuthDB.updatePassword(result.userId, passwordHash);
      } else if (AuthDB.updateUser) {
        AuthDB.updateUser(result.userId, { passwordHash });
      }

      logger.info("password-reset", `Password reset for user ${result.userId}`);
      return res.json({ ok: true, message: "Password has been reset. You can now log in." });
    } catch (err) {
      logger.error("password-reset", `Error in reset-password: ${err.message}`);
      return res.status(500).json({ ok: false, error: "Failed to reset password" });
    }
  });

  /**
   * GET /verify-email
   * Verify email address via token link.
   */
  router.get("/verify-email", async (req, res) => {
    const { token } = req.query;

    if (!token) {
      return res.status(400).json({ ok: false, error: "Verification token required" });
    }

    try {
      const result = verifyEmailToken(token);
      if (!result.valid) {
        return res.status(400).json({ ok: false, error: result.error });
      }

      // Mark email as verified in AuthDB
      if (AuthDB.updateUser) {
        AuthDB.updateUser(result.userId, { emailVerified: true });
      }

      logger.info("email-verify", `Email verified for user ${result.userId}`);

      // Redirect to login with success message
      return res.redirect(`${process.env.NEXT_PUBLIC_API_URL || ""}/login?verified=true`);
    } catch (err) {
      logger.error("email-verify", `Error in verify-email: ${err.message}`);
      return res.status(500).json({ ok: false, error: "Verification failed" });
    }
  });

  return router;
}
