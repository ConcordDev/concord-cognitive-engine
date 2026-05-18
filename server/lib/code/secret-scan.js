// server/lib/code/secret-scan.js
//
// Real secret-detection for the AGENTS.md publish path (and any
// other content the user is about to make public). NOT cryptographic
// — pattern-matched. The cost of a false positive is annoyance; the
// cost of a missed leak is real. We err toward over-flagging.

const PATTERNS = [
  { name: "aws_access_key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "aws_secret_key", re: /\b[A-Za-z0-9/+=]{40}\b(?=\s*['"]?(?:aws|secret))/gi },
  { name: "github_pat",      re: /\bghp_[A-Za-z0-9]{36}\b/g },
  { name: "github_app",      re: /\bghs_[A-Za-z0-9]{36}\b/g },
  { name: "github_oauth",    re: /\bgho_[A-Za-z0-9]{36}\b/g },
  { name: "github_refresh",  re: /\bghr_[A-Za-z0-9]{36}\b/g },
  { name: "openai_key",      re: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: "anthropic_key",   re: /\bsk-ant-(?:api|admin)\d{2}-[A-Za-z0-9\-_]{32,}\b/g },
  { name: "stripe_live",     re: /\b(?:rk|sk|pk)_live_[A-Za-z0-9]{20,}\b/g },
  { name: "stripe_secret",   re: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g },
  { name: "gcp_service_acc", re: /-----BEGIN PRIVATE KEY-----/g },
  { name: "rsa_private",     re: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/g },
  { name: "slack_token",     re: /\bxox[apbrs]-[0-9A-Za-z-]{10,}\b/g },
  { name: "jwt_token",       re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: "generic_pw_assign", re: /\b(?:password|passwd|pwd|api[_-]?key|secret|token)\s*[:=]\s*['"]([A-Za-z0-9_!@#$%^&*\-+=./]{8,})['"]/gi },
];

/**
 * Scan a string for likely secrets.
 * @returns { ok: false, matches: [{name, sample, count}] } when found,
 *          { ok: true } otherwise.
 */
export function scanForSecrets(content) {
  if (!content || typeof content !== "string") return { ok: true };
  const matches = [];
  for (const { name, re } of PATTERNS) {
    let count = 0;
    let sample = null;
    let m;
    // reset re lastIndex per scan since some are /g
    re.lastIndex = 0;
    while ((m = re.exec(content)) !== null) {
      count++;
      if (!sample) {
        // never echo the whole secret back — fingerprint only
        const found = m[0];
        sample = `${found.slice(0, 4)}…${found.slice(-4)} (${found.length} chars)`;
      }
      if (count > 20) break; // bound work for adversarial input
    }
    if (count > 0) matches.push({ name, sample, count });
  }
  if (matches.length === 0) return { ok: true };
  return { ok: false, reason: "secret_in_memory", matches };
}
