// server/lib/browser-agent/safety.js
//
// Approval-mode + destructive-action detection. The OpenAI-Operator-
// shutdown lesson: agents that auto-execute checkout / send / delete
// actions fail on real-world flows. This layer flags any action that
// matches a destructive pattern and routes it to the approvals queue
// when the task's approval_mode demands it.

const DESTRUCTIVE_TOKENS = [
  // Money / commerce
  "purchase", "checkout", "pay", "buy now", "place order", "submit payment",
  "subscribe", "upgrade plan", "delete card",
  // Identity / auth
  "delete account", "deactivate account", "remove user", "transfer ownership",
  // Communications
  "send email", "send message", "publish", "share publicly", "post tweet",
  "submit form", "send invite", "send sms",
  // Destructive data ops
  "delete file", "delete folder", "remove from cart", "empty trash",
  "clear history", "reset password",
];

const DESTRUCTIVE_URLS = [
  /\/checkout/, /\/cart\/?$/i, /\/purchase/, /\/payment/, /\/billing\/(cancel|delete)/i,
  /\/settings\/account\/delete/i, /\/logout/, /\/oauth\/authorize/,
];

const DESTRUCTIVE_DOM_HINTS = [
  "type=\"submit\"", "data-test-id=\"checkout\"", "aria-label=\"Buy\"",
  "data-action=\"delete\"", "data-action=\"purchase\"",
];

/**
 * Decide whether an action needs approval given the task's approval_mode.
 *
 * task.approval_mode:
 *   'off'                 → never gate
 *   'destructive_only'    → gate only when isDestructive(action) is true
 *   'every_step'          → gate every step
 */
export function requiresApproval(task, action) {
  const mode = task?.approval_mode || "destructive_only";
  if (mode === "off") return false;
  if (mode === "every_step") return true;
  return isDestructive(action);
}

export function isDestructive(action) {
  if (!action || typeof action !== "object") return false;
  // Caller can pre-flag
  if (action.destructive === true) return true;
  const kind = String(action.kind || action.tool || "").toLowerCase();
  const value = String(action.value || action.text || action.selector || "").toLowerCase();
  const url = String(action.url || "").toLowerCase();
  const thought = String(action.thought || "").toLowerCase();
  const dom = String(action.dom_snippet || action.html || "").toLowerCase();

  if (kind === "navigate" && DESTRUCTIVE_URLS.some((re) => re.test(url))) return true;
  if (DESTRUCTIVE_TOKENS.some((t) => value.includes(t) || thought.includes(t))) return true;
  if (DESTRUCTIVE_DOM_HINTS.some((h) => dom.includes(h))) return true;
  // Click on a button whose visible text matches a destructive token
  if (kind === "click" && DESTRUCTIVE_TOKENS.some((t) => (action.element_text || "").toLowerCase().includes(t))) return true;
  return false;
}

/**
 * Inspect the action and return a human-readable approval reason.
 */
export function approvalReason(action) {
  const url = String(action?.url || "").toLowerCase();
  const value = String(action?.value || action?.text || "").toLowerCase();
  const elText = String(action?.element_text || "").toLowerCase();
  const haystack = `${value} ${elText}`;
  // Special-case classifications first (some are destructive, some aren't)
  if (/captcha|recaptcha|hcaptcha|cloudflare/.test(haystack)) return "captcha_detected";
  if (/login|sign in|password|2fa|two[-\s]factor/.test(haystack)) return "authentication_needed";
  if (DESTRUCTIVE_URLS.some((re) => re.test(url))) return "external_purchase";
  if (!isDestructive(action)) return null;
  return "destructive_action";
}
