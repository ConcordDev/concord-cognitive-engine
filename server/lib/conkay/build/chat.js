// server/lib/conkay/build/chat.js
//
// Kay as the organizer of an open build (owner, 2026-11-27: "the LLM is just
// essentially the organizer"). When the person has a build open, Kay is shown
// that build's real editable values (loaded server-side for this user, never
// taken from the client's text) and two tools:
//   conkay_build_edit  — words → exact edits of listed values; every solver re-runs
//   conkay_build_size  — which sizes may change and their bounds; the solvers size it
// Kay picks WHAT changes. The numbers that come back are solver outputs.

import { loadBuild } from "./index.js";
import { listParameters } from "./edit.js";

/** The hint Kay gets with an open build, or null when the id is not this person's build. */
export function openBuildHint(db, buildId, userId) {
  const b = loadBuild(db, buildId, userId);
  if (!b?.plan?.ir) return null;
  const params = listParameters(b.plan.ir);
  const r = b.report || {};
  const failing = (r.checked || []).filter((c) => !c.pass).map((c) => `${c.targetName}: ${c.check} (${c.demand} vs ${c.capacity})`);
  const lines = params.slice(0, 60).map((p) => `- ${p.id} — ${p.nodeName} ${p.label} = ${p.value}${p.options ? ` (one of: ${p.options.slice(0, 12).join(", ")})` : ""}`);
  return {
    buildId: b.id,
    hint: [
      `The person has a ConKay build open: "${b.plan.summary || b.brief}" (build id ${b.id}). Current result: ${r.headline || "not checked yet"}.`,
      failing.length ? `Failing now: ${failing.slice(0, 8).join("; ")}.` : "",
      "Its editable values (id — what it is = current value):",
      ...lines,
      "When they ask to change it (\"make the arm 2 inches longer\", \"try oak\", \"what if it carries 60 lb\"), call conkay_build_edit with buildId and edits [{ id, value }] using ONLY ids from this list; values in any unit (work out \"2 inches longer\" from the current value shown).",
      "When they ask you to make it pass, make it lighter, or size it, call conkay_build_size with buildId and variables: the SIZE ids (lengths) that may change, each with min and max (or a stock list of buyable sizes). You choose WHAT may change and sensible bounds; the solvers find the sizes. Keep layout lengths (spans, heights) fixed unless they asked.",
      "Report only what the tool returned: which values changed, which checks pass or fail now, the mass before and after. Never state a number the tool did not return. For an unrelated new object, use conkay_build.",
    ].filter(Boolean).join("\n"),
  };
}
