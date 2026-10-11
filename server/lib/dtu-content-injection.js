// Fast-path jailbreak patterns plus the injection-defense module.
// The module's threat level is the lowercase string "none" (THREAT_LEVELS.NONE).
// Comparing it to "NONE" tagged every scanned DTU quarantine:injection-review.
// A level counts only when it is not "none" (any case) AND the scan returned
// at least one finding. Regex hits still count on their own.

const INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+(instructions?|prompts?|rules?)/i,
  /you\s+are\s+now\s+(a|an|in)\s+/i,
  /system\s*:\s*you\s+(are|must|should|will)/i,
  /\bDAN\b.*\bjailbreak/i,
  /forget\s+(everything|all|your)\s+(you|instructions?|rules?)/i,
  /act\s+as\s+(if|though)\s+you\s+(have\s+no|don't\s+have)/i,
  /override\s+(your|the|all)\s+(safety|content|system)/i,
  /\[\s*SYSTEM\s*\]/i,
  /<<\s*SYS\s*>>/i,
];

export function detectContentInjection(text) {
  if (typeof text !== "string" || text.length < 10) return { injected: false, patterns: [] };
  const matched = [];
  for (const pat of INJECTION_PATTERNS) {
    if (pat.test(text)) matched.push(pat.source.slice(0, 40));
  }
  try {
    const injDef = globalThis._injectionDefenseModule;
    if (injDef?.scanContent) {
      const fullScan = injDef.scanContent(globalThis._concordSTATE || {}, text);
      const findings = Array.isArray(fullScan?.findings) ? fullScan.findings : [];
      const level = String(fullScan?.threatLevel || "").toUpperCase();
      // Case-insensitive, and a bare level with zero findings is not a hit.
      if (level && level !== "NONE" && findings.length > 0) {
        return {
          injected: true,
          patterns: [
            ...matched,
            ...findings.map((f) => `${f.type}:${f.severity ?? "?"}`),
          ],
          threatLevel: fullScan.threatLevel,
          firstFinding: findings[0]?.message || null,
        };
      }
    }
  } catch (e) {
    // A broken scanner must not tag the DTU. The regex result still applies.
    void e;
  }
  return { injected: matched.length > 0, patterns: matched };
}
