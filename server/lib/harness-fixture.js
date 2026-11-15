// server/lib/harness-fixture.js
//
// Fingerprint for QA-harness fixture values that leaked into
// user-facing lists (audit sweep, theme 1 tail). The fleet's test
// harnesses name the rows they create with self-describing templates:
//   - brush presets saved as "tz1026164702gi name harness value"
//     (a tz-token plus the template tail "… harness value"), and
//   - mentor profiles registered as "QA mentor smtmv820475" /
//     "QA bio smtmv820475 …" by harness accounts.
// The rows themselves are live data and are never rewritten from
// code; surfaces use this predicate to keep harness fixtures out of
// user-facing lists (or clearly labelled), and write paths use it to
// refuse new fixtures at the door.
//
// The signals are the harness's own fingerprints — the word
// "harness" in a display name, or a leading tz-token of 8+
// alphanumerics — not generic quality judgements about names, so a
// name a person would actually choose never matches.

export function isHarnessFixtureName(name) {
  if (typeof name !== "string") return false;
  const n = name.trim();
  if (!n) return false;
  if (/\bharness\b/i.test(n)) return true;
  if (/^tz[0-9a-z]{8,}\b/i.test(n)) return true;
  return false;
}
