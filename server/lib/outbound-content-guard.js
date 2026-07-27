// server/lib/outbound-content-guard.js
//
// Deterministic leak-prevention backstop for outbound BYO / platform-
// provider calls. This is NOT a privacy feature and must never be
// described as making anything "private" -- it exists because both BYO
// and High Power Mode's baseline are NOT private (see
// byo-router.js#getBrainMode / platform-providers.js): once a call is
// headed to a third-party provider at all, this is the one guard against
// a user pasting a live credential into the message that's now knowingly
// leaving the box. Private Mode never reaches this module at all (its
// brainChat() branch returns straight from ollamaChat, before any
// provider dispatch) -- nothing about Private Mode's guarantee depends on
// this file.
//
// Pattern style is adapted from server/lib/detectors/secret-leak-detector.js:
// tight regex + minimum length + a false-positive marker filter, biased
// hard for precision over recall. An over-eager block just means a chat
// call falls through to local Ollama (the same "never hard-fail the user"
// contract every other outbound failure already gets) -- mildly annoying.
// A missed real secret is an actual leak to a third party. This is a NEW
// module, not a reuse of that detector in place: that one walks repo
// source files at rest for a lint-style report; this one scans live
// chat-message content at the moment of outbound dispatch, with a totally
// different call site, input shape, and lifecycle -- so it does not import
// from or extend the detector.

const PATTERNS = [
  // anthropic_key checked before openai_key: both start with "sk-", and
  // openai_key's looser pattern would otherwise shadow every Anthropic key
  // too (a real key is still blocked either way — this ordering only
  // matters for which patternId gets reported).
  { id: "anthropic_key", description: "Anthropic API key", regex: /\bsk-ant-[A-Za-z0-9_-]{20,}/g },
  { id: "openai_key", description: "OpenAI API key", regex: /\bsk-(?:proj-)?(?!ant-)[A-Za-z0-9_-]{20,}/g },
  { id: "github_token", description: "GitHub personal access token", regex: /\bgh[pousr]_[A-Za-z0-9_]{30,}/g },
  { id: "aws_access_key", description: "AWS access key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "aws_secret", description: "AWS secret access key", regex: /aws_secret_access_key\s*[:=]\s*['"][A-Za-z0-9/+=]{30,}['"]/gi },
  { id: "stripe_live_key", description: "Stripe live secret key", regex: /\bsk_live_[A-Za-z0-9]{24,}/g },
  { id: "slack_token", description: "Slack token", regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { id: "private_key_pem", description: "Embedded private key", regex: /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g },
  { id: "google_api_key", description: "Google API key", regex: /\bAIza[0-9A-Za-z_-]{35}\b/g },
  { id: "jwt_token", description: "JWT bearer token", regex: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g },
  { id: "us_ssn", description: "US Social Security Number", regex: /\b\d{3}-\d{2}-\d{4}\b/g },
  {
    id: "credit_card",
    description: "Possible credit card number",
    // Loose shape first (digits w/ optional space/dash separators), then a
    // real Luhn checksum validates the match -- without the checksum this
    // pattern would false-positive on every 13-19 digit number a user ever
    // pastes (order ids, phone numbers, DTU ids).
    regex: /\b(?:\d[ -]?){13,19}\b/g,
    validate: (matched) => luhnValid(matched.replace(/[ -]/g, "")),
  },
];

// Same false-positive marker convention as secret-leak-detector.js, plus a
// couple of markers specific to this repo's own test fixtures so this
// guard never trips on its own or a sibling test's fake credentials.
const FALSE_POSITIVE_MARKERS = [
  "example", "placeholder", "your-key", "yourkey", "<your", "test_key", "fake",
  "abcdefg", "xxxx", "redacted", "sample", "dummy", "lorem", "fakekey",
];

function isFalsePositive(match) {
  const s = match.toLowerCase();
  return FALSE_POSITIVE_MARKERS.some((m) => s.includes(m));
}

function luhnValid(digits) {
  if (!/^\d{13,19}$/.test(digits)) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Scan a single string for embedded secrets/PII.
 * @param {string} text
 * @returns {{blocked:boolean, patternId?:string, description?:string}}
 */
export function scanTextForLeaks(text) {
  if (!text || typeof text !== "string") return { blocked: false };
  for (const p of PATTERNS) {
    p.regex.lastIndex = 0;
    let m;
    while ((m = p.regex.exec(text)) != null) {
      const matched = m[0];
      if (isFalsePositive(matched)) continue;
      if (p.validate && !p.validate(matched)) continue;
      return { blocked: true, patternId: p.id, description: p.description };
    }
  }
  return { blocked: false };
}

/**
 * Scan an array of {role, content} chat messages (the shape every BYO/
 * platform adapter accepts). Scans every role, not just "user" -- a prior
 * assistant turn could echo something pasted earlier in the same
 * conversation, and the scan is cheap either way.
 *
 * @param {Array<{role?:string, content?:string}>} messages
 * @returns {{blocked:boolean, patternId?:string, description?:string}}
 */
export function scanMessagesForLeaks(messages) {
  if (!Array.isArray(messages)) return { blocked: false };
  for (const m of messages) {
    const r = scanTextForLeaks(m?.content);
    if (r.blocked) return r;
  }
  return { blocked: false };
}
