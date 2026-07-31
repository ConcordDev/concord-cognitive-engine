// server/lib/safe-path.js
//
// Path-containment primitives for anything that builds a filesystem path out
// of a value a caller supplied.
//
// Why this exists as a shared module rather than another inline check: five
// separate files already hand-roll their own containment logic
// (routes/domain.js, routes/skills.js, routes/dtus.js,
// lib/skills/anthropic-skills-adapter.js, lib/detectors/stale-code-detector.js).
// Rolling a sixth is exactly how `domains/whiteboard.js#publish-as-blueprint`
// ended up with none: a board id was length-capped (`.slice(0, 64)`) but never
// path-sanitized, and `board-save` accepted the id verbatim from the caller, so
// an id of `../../../x` round-tripped through the board store and then escaped
// LENS_BLUEPRINT_ROOT on write.
//
// The rule this module encodes: NEVER trust `path.join` to keep you inside a
// root. `path.join(root, "../../x")` resolves happily outside it — joining is
// not containment. Validate the resolved result against the root, and prefer
// rejecting a bad segment outright over sanitizing it into something
// "close enough" (a silent rewrite makes two different ids collide onto one
// file, which is its own bug).

import path from "node:path";

/**
 * Is `candidate` inside `root` (or equal to it) after full resolution?
 *
 * The `+ path.sep` on the prefix test is load-bearing: a bare
 * `resolved.startsWith(root)` also accepts a SIBLING directory whose name
 * merely starts with the root's name (`/data/exports-evil` passes a
 * `startsWith("/data/exports")` test). `routes/domain.js` already gets this
 * right; this is the same check, hoisted so it can't be re-derived wrong.
 */
export function isWithinRoot(root, candidate) {
  if (typeof root !== "string" || typeof candidate !== "string") return false;
  const r = path.resolve(root);
  const c = path.resolve(candidate);
  return c === r || c.startsWith(r + path.sep);
}

/**
 * Resolve `candidate` and return it only if contained by `root`; otherwise
 * null. Callers turn null into their own domain-appropriate error.
 *
 * Not dead code: tests/whiteboard-blueprint-path-traversal.test.js calls
 * this directly (a real caller a plain `grep -rn` silently misses — that
 * file embeds a literal NUL byte in one of its adversarial fixture strings,
 * `"ok\x00.png"`, which makes `grep` classify the whole file as binary and
 * skip it without `-a`). Confirmed 2026-07-31 after the standing wiring
 * gate's "zero-caller" search led to deleting this, which broke that test;
 * restored.
 */
export function resolveWithin(root, candidate) {
  return isWithinRoot(root, candidate) ? path.resolve(candidate) : null;
}

/**
 * True when `value` is safe to use as a SINGLE filename/path segment.
 *
 * Deliberately an allowlist, not a denylist of `..`/`/`: denylists in this
 * space keep losing to encodings, backslashes on the Windows path parser,
 * NUL truncation, and unicode lookalikes. Anything outside
 * [A-Za-z0-9._-] is rejected, plus explicit rejection of the two
 * dot-segments and of a leading dot (no writing `.bashrc`-shaped names).
 */
export function isSafePathSegment(value, { maxLength = 128 } = {}) {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > maxLength) return false;
  if (value === "." || value === "..") return false;
  if (value.startsWith(".")) return false;
  return /^[A-Za-z0-9._-]+$/.test(value);
}

/**
 * Assert-style variant: returns the segment or throws. For call sites that
 * would otherwise forget to check the boolean.
 */
export function requireSafePathSegment(value, label = "path segment", opts) {
  if (!isSafePathSegment(value, opts)) {
    throw new Error(`unsafe ${label}: must match [A-Za-z0-9._-] and not be a dot-segment`);
  }
  return value;
}

export default { isWithinRoot, resolveWithin, isSafePathSegment, requireSafePathSegment };
