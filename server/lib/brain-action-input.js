// Decides whether a brain-backed lens action has anything to work on.
// The brain will happily answer an empty prompt with a refusal, and that
// refusal used to ride out as ok:true. Callers use this to refuse up front.

function hasValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === "object") return Object.keys(v).length > 0;
  return true;
}

// `storedTitle` is the title of a real (stored) artifact; a titled saved
// artifact is something to work on. Virtual artifacts pass nothing here.
export function hasUsableBrainInput(artifactData, params, storedTitle) {
  if (hasValue(artifactData)) return true;
  if (hasValue(storedTitle)) return true;
  if (params && typeof params === "object") {
    for (const k of Object.keys(params)) if (hasValue(params[k])) return true;
  }
  return false;
}

export function needsInputError(domain, action) {
  return {
    ok: false,
    error: "invalid_input",
    reason: "needs_artifact_input",
    message: `${domain}.${action} needs input to work on`,
    action,
    domain,
  };
}
