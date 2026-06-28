// lens-input-normalize.js — dispatch-layer input normalization for /api/lens/run.
//
// THE BUG THIS FIXES (the "double-wrapped-input dead-calculator" class):
// The lens dispatch ALREADY builds the virtualArtifact and sets
// `virtualArtifact.data = body.input`, so a frontend panel that ALSO wraps its
// payload as `{ artifact: { data: {...} } }` (a common copy-paste shape across
// ~40 *ActionPanel components — e.g. `runDomain(d, a, { input: { artifact: {
// data } } })` or a local `callMacro(action, { artifact: { data } })`) makes
// `virtualArtifact.data === { artifact: { data: {...} } }`. Every handler that
// reads `artifact.data.X` then sees `undefined` and silently returns its
// empty/default result IN PRODUCTION while the lens "looks wired" and tests that
// use the correct single-wrap shape still pass. Confirmed dead in carpentry,
// cooking, construction, automotive (each fixed per-domain) before the root
// cause was traced to the dispatch.
//
// FIX: peel EXACTLY one redundant layer at the dispatch, and ONLY when the body
// is the sole-key `{ artifact: { data: <plain object> } }` shape — so
// legitimate flat input, and bodies carrying real sibling fields (e.g.
// `{ artifact: { data }, period }`), are byte-identical and never mangled.
// Idempotent: peeling already-flat input is a no-op, so the per-domain unwrap
// helpers the earlier fixes added remain correct (they no-op on flat input).

export function peelRedundantArtifactWrapper(rest) {
  if (
    rest && typeof rest === "object" && !Array.isArray(rest) &&
    Object.keys(rest).length === 1 &&
    rest.artifact && typeof rest.artifact === "object" && !Array.isArray(rest.artifact) &&
    rest.artifact.data && typeof rest.artifact.data === "object" && !Array.isArray(rest.artifact.data)
  ) {
    return rest.artifact.data;
  }
  return rest;
}

export default peelRedundantArtifactWrapper;
