/**
 * Lens activity labels, objects, and quiet reads (fix for the #1906
 * re-sitting FAIL on PR #1910 — R3, 2026-10-31: 4 PASS / 8 FAIL).
 *
 * #1910's recorder writes a feed row for every successful lens dispatch,
 * but three labelling defects remained, all verified by live repro:
 *
 *  1. The verb was the raw action name with only [-_] split, so
 *     camelCase actions rendered as raw tool names ("registerMonitor",
 *     "sessionLog", "exportTrace"). `humanizeLensAction` splits
 *     camelCase too; per-action `label` overrides cover the cases where
 *     the honest user-language name differs from the tool name
 *     (cognition's trace creation IS its exportTrace dispatch).
 *  2. The object probe only looked for name/title/label in a few
 *     places, so object-carrying actions recorded action-only rows —
 *     each leg's object lives under a leg-specific key (Attention's
 *     distraction text is input.source; a Commonsense finding's object
 *     is the question on result.check; a Root save's is
 *     result.computation.label). Per-action `object` specs name those
 *     keys. A spec is AUTHORITATIVE: when a spec exists and yields "",
 *     the row is action-only — the generic probe never overrides it
 *     (the generic probe is what named a meditation track instead of
 *     the session's goal/length).
 *  3. Read/fetch dispatches recorded indiscriminately ("check detail"
 *     ×9, "getExport" ×4 on lens load), and the shared Activity panel
 *     fetches one global page — a member's own action rows rotated out
 *     under the lens's own read traffic. Actions flagged `quiet` here
 *     are pure reads/fetches: they write no activity row.
 *
 * The table covers the thirteen re-sitting domains (the eight standing
 * legs plus the five discharged ones, whose read floods are quieted so
 * their passing rows cannot rotate out either). Domains/actions with
 * no entry keep the generic behaviour: humanized verb + generic
 * object probe + recorded.
 */

const clean = (v) =>
  typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, 80) : "";

export function humanizeLensAction(action) {
  return String(action || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .replace(/[-_]+/g, " ")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function probePath(root, path) {
  let cur = root;
  for (const key of path.split(".")) {
    if (!cur || typeof cur !== "object") return "";
    cur = cur[key];
  }
  return clean(cur);
}

/** The #1910 generic object probe, unchanged in behaviour. */
export function genericActivityObject(input, result) {
  const fromObj = (o) => {
    if (!o || typeof o !== "object") return "";
    for (const k of ["name", "title", "label"]) {
      const s = clean(o[k]);
      if (s) return s;
    }
    return "";
  };
  let label = fromObj(input) || fromObj(result);
  if (!label && result && typeof result === "object") {
    for (const k of ["experiment", "artifact", "item", "created", "entry", "record", "computation", "monitor", "map"]) {
      label = fromObj(result[k]);
      if (label) break;
    }
  }
  if (!label) {
    const t = clean(input?.text);
    if (t) label = t.split("\n")[0].slice(0, 80);
  }
  return label;
}

function factTriple(o) {
  if (!o || typeof o !== "object") return "";
  // A predicate alone is not a fact display ("is" names nothing) —
  // require at least one endpoint, then join what is present.
  if (!clean(o.subject) && !clean(o.object)) return "";
  const parts = [clean(o.subject), clean(o.predicate || o.relation), clean(o.object)]
    .filter(Boolean);
  return parts.join(" ");
}

const COMPOSERS = {
  // Inference fact adds arrive in two shapes: the desk REST route's
  // {subject, predicate, object} body, and lens/run kb-add's {text}
  // of Prolog lines. Both name the fact the same way.
  kbAddObject(input) {
    const triple = factTriple(input);
    if (triple) return triple;
    // First line of the raw text (clean() would collapse the newline
    // before the split could see it).
    const raw = typeof input?.text === "string" ? input.text : "";
    const first = raw.split("\n").map((l) => l.trim()).find(Boolean) || "";
    return clean(first);
  },
  // kb-remove returns the removed entry (its handler captures it
  // before the delete): a desk fact carries subject/predicate/object,
  // a KB fact carries predicate + args, a rule carries its text/name.
  removedFact(_input, result) {
    const e = result?.removedEntry;
    if (!e || typeof e !== "object") return "";
    const triple = factTriple(e);
    if (triple) return triple;
    if (clean(e.text)) return clean(e.text);
    if (e.predicate && Array.isArray(e.args) && e.args.length) {
      const args = e.args.map((a) => clean(a)).filter(Boolean);
      if (args.length >= 2) return `${args[0]} ${clean(e.predicate)} ${args.slice(1).join(" ")}`;
      if (args.length === 1) return args[0];
    }
    return clean(e.name);
  },
  // A meditation session's object is its goal and length — never the
  // track title (the generic probe's answer, and the re-sitting's
  // FAIL). The session player sends its goal with the log call and
  // the handler stores it on the entry; older callers degrade to the
  // length alone.
  meditationSession(input, result) {
    const entry = result?.entry && typeof result.entry === "object" ? result.entry : {};
    const goal = clean(entry.goal || input?.goal || "");
    const minutes = entry.durationMin ?? input?.minutes;
    const parts = [];
    if (goal) parts.push(goal.charAt(0).toUpperCase() + goal.slice(1));
    if (minutes != null && minutes !== "" && Number(minutes) > 0) parts.push(`${Number(minutes)} min`);
    return parts.join(" · ");
  },
};

const Q = { quiet: true };

export const LENS_ACTIVITY = {
  attention: {
    distractionLog: { object: { paths: ["input.source", "result.entry.source"] } },
    calendarBlocks: Q, distractionSummary: Q, focusAnalytics: Q,
    focusModeGet: Q, peakHours: Q, plannerGet: Q, pomodoroStats: Q,
    pomodoroStatus: Q, focusScore: Q, attentionBudget: Q, priorityMatrix: Q,
  },
  commonsense: {
    "check-ask": { object: { paths: ["input.question", "result.check.question"] } },
    "check-finding": { object: { paths: ["result.check.question", "input.question"] } },
    "check-exception": { object: { paths: ["result.check.question", "input.question"] } },
    factAdd: { object: { compose: "kbAddObject" } },
    "check-detail": Q, "check-list": Q, factList: Q,
    "conceptnet-edges": Q, "conceptnet-relatedness": Q, confidenceQuery: Q,
    knowledgeGraph: Q, provenanceChain: Q, relationTaxonomy: Q,
  },
  inference: {
    "kb-add": { object: { compose: "kbAddObject" } },
    "kb-remove": { object: { compose: "removedFact" } },
    "kb-list": Q, "kb-check": Q, "kb-explain": Q, "kb-trace": Q,
  },
  cognition: {
    // The Cognition page's create IS exportTrace (title + question in,
    // stored trace out — the page's own header documents it). The row
    // names the action the user took: creating the trace.
    exportTrace: { label: "trace create", object: { paths: ["input.title", "result.export.title"] } },
    getExport: Q, listExports: Q,
  },
  root: {
    save: { label: "computation save", object: { paths: ["result.computation.label", "input.label", "input.expression"] } },
    deleteComputation: { label: "computation delete", object: { paths: ["result.computation.label"] } },
    history: Q, reload: Q, getShare: Q, glyphLookup: Q, tutorial: Q,
  },
  invariant: {
    listMonitors: Q, violationHistory: Q, templates: Q,
  },
  meditation: {
    sessionLog: { object: { compose: "meditationSession" } },
    pickTrack: Q, streakSummary: Q, dailyPrompt: Q, history: Q,
    library: Q, courses: Q, courseProgress: Q, "meditation-dashboard": Q,
    milestones: Q, "mood-history": Q, reminders: Q, recommendations: Q,
    streak: Q,
  },
  "ux-suite": {
    "save-props": { object: { paths: ["input.component", "result.component"] } },
    "reset-props": { object: { paths: ["input.component", "result.component"] } },
    catalog: Q, search: Q, preview: Q, "props-schema": Q,
    "usage-snippet": Q, "a11y-check": Q, "variant-gallery": Q,
    "favourites-list": Q,
  },
  // The five discharged legs: labels/objects already pass; only their
  // read floods are quieted so passing rows cannot rotate out.
  ml: {
    "dataset-list": Q, "deploy-list": Q, "experiment-list": Q,
    "space-list": Q, "space-get": Q, datasetProfile: Q,
    "dataset-hub": Q, "model-hub": Q, "automl-templates": Q,
  },
  reasoning: {
    "map-delete": { object: { paths: ["result.map.title"] } },
    "map-list": Q, "map-get": Q, "scheme-list": Q,
  },
  transfer: {
    "connector-list": Q, "connector-read": Q, "pipeline-list": Q,
    "run-log": Q,
  },
  affect: {
    journalPrompts: Q, getScale: Q, checkinHistory: Q,
    emotionTimeline: Q, trends: Q, activityCorrelation: Q, nudges: Q,
  },
  suffering: {
    "pain-list": Q, "intervention-list": Q, "theme-list": Q,
    "trend-view": Q,
  },
};

function specFor(domain, action) {
  const d = LENS_ACTIVITY[domain];
  return d && typeof d === "object" ? d[action] : undefined;
}

export function isQuietLensAction(domain, action) {
  return specFor(domain, action)?.quiet === true;
}

export function lensActivityLabel(domain, action) {
  const spec = specFor(domain, action);
  if (spec && typeof spec.label === "string" && spec.label) return spec.label;
  return humanizeLensAction(action);
}

export function lensActivityObject(domain, action, input, result) {
  const spec = specFor(domain, action);
  if (spec && spec.object) {
    const { paths, compose } = spec.object;
    if (Array.isArray(paths)) {
      for (const p of paths) {
        const root = p.startsWith("result.") ? result : input;
        const rel = p.replace(/^(input|result)\./, "");
        const v = probePath(root, rel);
        if (v) return v;
      }
    }
    if (compose && COMPOSERS[compose]) {
      return clean(COMPOSERS[compose](input, result));
    }
    return ""; // authoritative spec: no generic fallback
  }
  return genericActivityObject(input, result);
}
