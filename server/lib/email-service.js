/**
 * Email Service for Concord Cognitive Engine
 *
 * Transactional email via SMTP (nodemailer). Supports:
 * - Password reset tokens
 * - Email verification
 * - Purchase confirmations
 * - Commission notifications
 * - General transactional emails
 *
 * Provider-agnostic: works with SendGrid, Postmark, SES, Mailgun,
 * or any SMTP relay. Configure via env vars.
 *
 * When SMTP is not configured, logs emails to console (dev mode).
 */

import crypto from "crypto";
import logger from "../logger.js";

// ── Configuration ────────────────────────────────────────────────────────────

const SMTP_HOST = process.env.SMTP_HOST || "";
const SMTP_PORT = parseInt(process.env.SMTP_PORT || "587", 10);
const SMTP_USER = process.env.SMTP_USER || "";
const SMTP_PASS = process.env.SMTP_PASS || "";
const SMTP_FROM = process.env.SMTP_FROM || "noreply@concord-os.org";
const SMTP_FROM_NAME = process.env.SMTP_FROM_NAME || "Concord";
const APP_URL = process.env.NEXT_PUBLIC_API_URL || "https://concord-os.org";

// Password reset tokens: 1 hour expiry
const RESET_TOKEN_EXPIRY_MS = 60 * 60 * 1000;
// Email verification tokens: 24 hours
const VERIFY_TOKEN_EXPIRY_MS = 24 * 60 * 60 * 1000;

/** @type {Map<string, { userId: string, email: string, expiresAt: number }>} */
const _resetTokens = new Map();

/** @type {Map<string, { userId: string, email: string, expiresAt: number }>} */
const _verifyTokens = new Map();

// Lazy-loaded nodemailer transporter
let _transporter = null;
let _transporterReady = false;

// ── Transport ────────────────────────────────────────────────────────────────

/**
 * Get or create the nodemailer transport.
 * Falls back to console logging if SMTP isn't configured.
 */
async function _getTransporter() {
  if (_transporter) return _transporter;

  if (!SMTP_HOST) {
    logger.warn("email-service", "SMTP not configured — emails will be logged to console only");
    _transporter = {
      sendMail: async (opts) => {
        logger.info("email-service", `[DEV] Email to ${opts.to}: ${opts.subject}`);
        logger.debug("email-service", `[DEV] Body: ${opts.text || "(HTML only)"}`);
        return { messageId: `dev-${Date.now()}`, accepted: [opts.to] };
      },
    };
    _transporterReady = true;
    return _transporter;
  }

  try {
    // Dynamic import — nodemailer is optional dependency
    const nodemailer = await import("nodemailer");
    _transporter = nodemailer.default.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: {
        user: SMTP_USER,
        pass: SMTP_PASS,
      },
      // Connection pooling for high throughput
      pool: true,
      maxConnections: 5,
      maxMessages: 100,
      // Timeout settings
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });

    // Verify connection on first use
    await _transporter.verify();
    _transporterReady = true;
    logger.info("email-service", `SMTP connected: ${SMTP_HOST}:${SMTP_PORT}`);
    return _transporter;
  } catch (err) {
    logger.error("email-service", `SMTP connection failed: ${err.message}`);
    // Fall back to console logger
    _transporter = {
      sendMail: async (opts) => {
        logger.warn("email-service", `[FALLBACK] Would send to ${opts.to}: ${opts.subject}`);
        return { messageId: `fallback-${Date.now()}`, accepted: [] };
      },
    };
    _transporterReady = true;
    return _transporter;
  }
}

// ── Core Send ────────────────────────────────────────────────────────────────

/**
 * Send an email.
 *
 * @param {object} opts
 * @param {string} opts.to - Recipient email
 * @param {string} opts.subject - Email subject
 * @param {string} [opts.text] - Plain text body
 * @param {string} [opts.html] - HTML body
 * @param {string} [opts.from] - Override from address
 * @returns {Promise<{ ok: boolean, messageId?: string, error?: string }>}
 */
export async function sendEmail({ to, subject, text, html, from = null }) {
  try {
    const transporter = await _getTransporter();
    const result = await transporter.sendMail({
      from: from || `"${SMTP_FROM_NAME}" <${SMTP_FROM}>`,
      to,
      subject,
      text,
      html,
    });

    logger.info("email-service", `Email sent to ${to}: ${subject} (${result.messageId})`);
    return { ok: true, messageId: result.messageId };
  } catch (err) {
    logger.error("email-service", `Failed to send email to ${to}: ${err.message}`);
    return { ok: false, error: err.message };
  }
}

// ── Password Reset ───────────────────────────────────────────────────────────

/**
 * Generate a password reset token and send reset email.
 *
 * @param {string} userId
 * @param {string} email
 * @param {string} username
 * @returns {Promise<{ ok: boolean, error?: string }>}
 */
export async function sendPasswordResetEmail(userId, email, username) {
  // Clean up expired tokens first
  _cleanExpiredTokens(_resetTokens);

  // Rate limit: max 3 reset requests per email per hour
  const recentForEmail = [..._resetTokens.values()].filter(
    (t) => t.email === email && t.expiresAt > Date.now()
  );
  if (recentForEmail.length >= 3) {
    return { ok: false, error: "Too many reset requests. Try again later." };
  }

  const token = crypto.randomBytes(32).toString("hex");
  _resetTokens.set(token, {
    userId,
    email,
    expiresAt: Date.now() + RESET_TOKEN_EXPIRY_MS,
  });

  const resetUrl = `${APP_URL}/reset-password?token=${token}`;

  const sent = await sendEmail({
    to: email,
    subject: "Reset your Concord password",
    text: _templates.passwordResetText(username, resetUrl),
    html: _templates.passwordResetHtml(username, resetUrl),
  });
  // Surface the minted token to the CALLER (the auth route / tests) — it is
  // never sent to the requesting client, only embedded in the email link.
  return { ...sent, token };
}

/**
 * Verify a password reset token.
 *
 * @param {string} token
 * @returns {{ valid: boolean, userId?: string, email?: string, error?: string }}
 */
export function verifyResetToken(token) {
  const entry = _resetTokens.get(token);
  if (!entry) return { valid: false, error: "Invalid or expired reset token" };
  if (Date.now() > entry.expiresAt) {
    _resetTokens.delete(token);
    return { valid: false, error: "Reset token has expired" };
  }
  return { valid: true, userId: entry.userId, email: entry.email };
}

/**
 * Consume a reset token (single use).
 */
export function consumeResetToken(token) {
  const result = verifyResetToken(token);
  if (result.valid) _resetTokens.delete(token);
  return result;
}

// ── Email Verification ───────────────────────────────────────────────────────

/**
 * Send email verification link.
 */
export async function sendVerificationEmail(userId, email, username) {
  _cleanExpiredTokens(_verifyTokens);

  const token = crypto.randomBytes(32).toString("hex");
  _verifyTokens.set(token, {
    userId,
    email,
    expiresAt: Date.now() + VERIFY_TOKEN_EXPIRY_MS,
  });

  const verifyUrl = `${APP_URL}/api/auth/verify-email?token=${token}`;

  return sendEmail({
    to: email,
    subject: "Verify your Concord email",
    text: _templates.verifyEmailText(username, verifyUrl),
    html: _templates.verifyEmailHtml(username, verifyUrl),
  });
}

/**
 * Verify an email verification token.
 */
export function verifyEmailToken(token) {
  const entry = _verifyTokens.get(token);
  if (!entry) return { valid: false, error: "Invalid or expired verification token" };
  if (Date.now() > entry.expiresAt) {
    _verifyTokens.delete(token);
    return { valid: false, error: "Verification token has expired" };
  }
  _verifyTokens.delete(token); // Single use
  return { valid: true, userId: entry.userId, email: entry.email };
}

// ── Transactional Emails ─────────────────────────────────────────────────────

/**
 * Send purchase confirmation.
 */
export async function sendPurchaseConfirmation(email, { username, itemName, amount, currency = "CC", transactionId }) {
  return sendEmail({
    to: email,
    subject: `Purchase confirmed: ${itemName}`,
    text: _templates.purchaseConfirmText(username, itemName, amount, currency, transactionId),
    html: _templates.purchaseConfirmHtml(username, itemName, amount, currency, transactionId),
  });
}

/**
 * Send commission notification (creator earned revenue).
 */
export async function sendCommissionNotification(email, { username, itemName, amount, currency = "CC", buyerName }) {
  return sendEmail({
    to: email,
    subject: `You earned ${amount} ${currency} from a sale`,
    text: _templates.commissionText(username, itemName, amount, currency, buyerName),
    html: _templates.commissionHtml(username, itemName, amount, currency, buyerName),
  });
}

/**
 * Send welcome email after registration.
 */
export async function sendWelcomeEmail(email, username) {
  return sendEmail({
    to: email,
    subject: "Welcome to Concord",
    text: _templates.welcomeText(username),
    html: _templates.welcomeHtml(username),
  });
}

// ── Email Templates ──────────────────────────────────────────────────────────

const _baseStyle = `
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  max-width: 600px;
  margin: 0 auto;
  padding: 40px 20px;
  background: #0a0a1a;
  color: #e0e0e0;
`;

const _buttonStyle = `
  display: inline-block;
  background: #6366f1;
  color: #ffffff;
  padding: 14px 32px;
  text-decoration: none;
  border-radius: 8px;
  font-weight: 600;
  font-size: 16px;
  margin: 20px 0;
`;

const _footerStyle = `
  margin-top: 40px;
  padding-top: 20px;
  border-top: 1px solid #333;
  font-size: 12px;
  color: #888;
`;

function _wrap(content) {
  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#050510;">
  <div style="${_baseStyle}">
    <div style="text-align:center;margin-bottom:30px;">
      <h1 style="color:#6366f1;font-size:24px;margin:0;">CONCORD</h1>
    </div>
    ${content}
    <div style="${_footerStyle}">
      <p>Concord Cognitive Engine &mdash; Sovereign Knowledge Platform</p>
      <p><a href="${APP_URL}/legal/privacy" style="color:#6366f1;">Privacy Policy</a> &middot;
         <a href="${APP_URL}/legal/terms" style="color:#6366f1;">Terms of Service</a></p>
      <p>You received this email because you have an account on Concord.
         If you didn't request this, you can ignore it.</p>
    </div>
  </div>
</body>
</html>`;
}

const _templates = {
  // Password Reset
  passwordResetText: (username, url) =>
    `Hi ${username},\n\nYou requested a password reset for your Concord account.\n\nReset your password: ${url}\n\nThis link expires in 1 hour. If you didn't request this, ignore this email.\n\n— Concord`,

  passwordResetHtml: (username, url) => _wrap(`
    <h2 style="color:#fff;margin-top:0;">Reset Your Password</h2>
    <p>Hi ${username},</p>
    <p>You requested a password reset for your Concord account. Click the button below to choose a new password.</p>
    <div style="text-align:center;">
      <a href="${url}" style="${_buttonStyle}">Reset Password</a>
    </div>
    <p style="font-size:13px;color:#999;">This link expires in 1 hour. If you didn't request this, you can safely ignore this email.</p>
  `),

  // Email Verification
  verifyEmailText: (username, url) =>
    `Hi ${username},\n\nVerify your email address: ${url}\n\nThis link expires in 24 hours.\n\n— Concord`,

  verifyEmailHtml: (username, url) => _wrap(`
    <h2 style="color:#fff;margin-top:0;">Verify Your Email</h2>
    <p>Hi ${username},</p>
    <p>Please verify your email address to complete your Concord account setup.</p>
    <div style="text-align:center;">
      <a href="${url}" style="${_buttonStyle}">Verify Email</a>
    </div>
    <p style="font-size:13px;color:#999;">This link expires in 24 hours.</p>
  `),

  // Purchase Confirmation
  purchaseConfirmText: (username, item, amount, currency, txId) =>
    `Hi ${username},\n\nYour purchase is confirmed.\n\nItem: ${item}\nAmount: ${amount} ${currency}\nTransaction: ${txId}\n\nThank you for using Concord.\n\n— Concord`,

  purchaseConfirmHtml: (username, item, amount, currency, txId) => _wrap(`
    <h2 style="color:#fff;margin-top:0;">Purchase Confirmed</h2>
    <p>Hi ${username},</p>
    <div style="background:#111;border:1px solid #333;border-radius:8px;padding:20px;margin:20px 0;">
      <p style="margin:4px 0;"><strong>Item:</strong> ${item}</p>
      <p style="margin:4px 0;"><strong>Amount:</strong> ${amount} ${currency}</p>
      <p style="margin:4px 0;font-size:12px;color:#888;"><strong>Transaction ID:</strong> ${txId}</p>
    </div>
    <p>Thank you for using Concord.</p>
  `),

  // Commission Notification
  commissionText: (username, item, amount, currency, buyer) =>
    `Hi ${username},\n\nYou earned ${amount} ${currency} from a sale of "${item}" by ${buyer}.\n\n— Concord`,

  commissionHtml: (username, item, amount, currency, buyer) => _wrap(`
    <h2 style="color:#2ecc71;margin-top:0;">You Earned Revenue!</h2>
    <p>Hi ${username},</p>
    <div style="background:#0d1f0d;border:1px solid #2ecc71;border-radius:8px;padding:20px;margin:20px 0;text-align:center;">
      <p style="font-size:32px;font-weight:bold;color:#2ecc71;margin:0;">${amount} ${currency}</p>
      <p style="color:#888;margin:8px 0 0 0;">from sale of "${item}" by ${buyer}</p>
    </div>
  `),

  // Welcome
  welcomeText: (username) =>
    `Welcome to Concord, ${username}!\n\nYour sovereign knowledge platform is ready. Start by exploring your lenses and creating your first DTU.\n\nVisit: ${APP_URL}\n\n— Concord`,

  welcomeHtml: (username) => _wrap(`
    <h2 style="color:#fff;margin-top:0;">Welcome to Concord, ${username}!</h2>
    <p>Your sovereign knowledge platform is ready.</p>
    <p>Here's how to get started:</p>
    <ol style="line-height:2;">
      <li><strong>Explore your lenses</strong> — 113 domain workspaces, from finance to music to law</li>
      <li><strong>Create your first DTU</strong> — Your knowledge, owned by you, forever</li>
      <li><strong>Connect with others</strong> — Join organizations, attend events, build together</li>
    </ol>
    <div style="text-align:center;">
      <a href="${APP_URL}" style="${_buttonStyle}">Enter Concord</a>
    </div>
  `),
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function _cleanExpiredTokens(tokenMap) {
  const now = Date.now();
  for (const [key, val] of tokenMap) {
    if (now > val.expiresAt) tokenMap.delete(key);
  }
}

// ── Status ───────────────────────────────────────────────────────────────────

/**
 * Get email service status.
 */
export function getEmailServiceStatus() {
  return {
    configured: !!SMTP_HOST,
    host: SMTP_HOST || "(not configured — console logging mode)",
    port: SMTP_PORT,
    from: SMTP_FROM,
    transportReady: _transporterReady,
    pendingResetTokens: _resetTokens.size,
    pendingVerifyTokens: _verifyTokens.size,
  };
}

export default {
  sendEmail,
  sendPasswordResetEmail,
  verifyResetToken,
  consumeResetToken,
  sendVerificationEmail,
  verifyEmailToken,
  sendPurchaseConfirmation,
  sendCommissionNotification,
  sendWelcomeEmail,
  getEmailServiceStatus,
};
