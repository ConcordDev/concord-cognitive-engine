// scripts/walk/check-spec.mjs — the check-spec format: "what I checked and what I expected".
//
// One fixed shape for every NEEDS_HUMAN ticket, so builders write their checks the
// same way and a machine can run them (scripts/walk/run-check.mjs). A spec is JSON:
//
//   {
//     "id": "CS-calendar-ics-export",          // CS-<lens>-<slug>
//     "lens": "calendar",
//     "ticket": "FIX-calendar-010",            // optional: the ticket this checks
//     "why": "Export makes a real .ics with the event at 2 PM ET",   // the expectation, in words
//     "path": "/lenses/calendar",              // relative to the site under test
//     "account": "member",                     // "anon" | "member" | "member2" | "admin"
//     "viewport": "desktop",                   // "desktop" (1280x800) | "mobile" (390x844)
//     "steps": [ { "do": "click", "target": { "role": "button", "name": "Export" } } ],
//     "expect": [ { "download": { "ext": ".ics", "contains": "DTSTART" } } ]
//   }
//
// Targets are accessible only — what a person or a screen reader sees — never CSS:
//   { "role": "button", "name": "Save" }    role + accessible name (exact unless "match": "contains")
//   { "label": "Title" }                    a form control by its label
//   { "text": "Saved" }                     visible text
//   { "testId": "build-size-run" }          data-testid
// Any target may add "nth": n (0-based) when the same target appears more than once.
//
// Steps: goto {path} · click {target} · fill {target, value} · select {target, value} ·
//        press {key, target?} · wait {for: target, timeoutMs?} · scroll {target}
// Expectations (all must hold):
//   visible {target}            the target is on screen and not covered (a splash, a sticky bar, a floating button)
//   hidden {target}             the target is not on screen
//   text {target, equals|contains|matches}   its text
//   count {target, eq|min|max}  how many match
//   url {matches}               the address (a regex)
//   download {ext, contains?}   the last step started a download with this extension (and text)
//   focusInside {target}        keyboard focus is inside the target (dialogs trap focus)
//   noHorizontalScroll {}       nothing wider than the viewport (the 390px rule)
//   contrast {target, min}      text contrast of the target against its background ≥ min (4.5 body, 3 large)
//   noConsoleErrors {}          no console error and no uncaught exception during the run
//   status {path, eq}           an HTTP status for a path (e.g. a missing page is a real 404)
//
// Unknown keys are refused, never ignored: a typo cannot turn a check into a pass.

export const ACCOUNTS = ["anon", "member", "member2", "admin"];
export const VIEWPORTS = { desktop: { width: 1280, height: 800 }, mobile: { width: 390, height: 844 } };
const TARGET_KEYS = { role: "string", name: "string", match: "string", label: "string", text: "string", testId: "string", nth: "number" };
const STEPS = {
  goto: { path: "string" },
  click: { target: "target" },
  fill: { target: "target", value: "string" },
  select: { target: "target", value: "string" },
  press: { key: "string", target: "target?" },
  wait: { for: "target", timeoutMs: "number?" },
  scroll: { target: "target" },
};
const EXPECTS = {
  visible: { target: "target" },
  hidden: { target: "target" },
  text: { target: "target", equals: "string?", contains: "string?", matches: "string?" },
  count: { target: "target", eq: "number?", min: "number?", max: "number?" },
  url: { matches: "string" },
  download: { ext: "string", contains: "string?" },
  focusInside: { target: "target" },
  noHorizontalScroll: {},
  contrast: { target: "target", min: "number" },
  noConsoleErrors: {},
  status: { path: "string", eq: "number" },
};
const TOP = { id: "string", lens: "string", ticket: "string?", why: "string", path: "string", account: "string", viewport: "string", steps: "array", expect: "array" };

function checkTarget(t, where, errors) {
  if (!t || typeof t !== "object" || Array.isArray(t)) { errors.push(`${where}: a target object`); return; }
  for (const k of Object.keys(t)) if (!(k in TARGET_KEYS)) errors.push(`${where}.${k}: not a target key (${Object.keys(TARGET_KEYS).join(", ")})`);
  for (const [k, ty] of Object.entries(TARGET_KEYS)) if (t[k] !== undefined && typeof t[k] !== ty) errors.push(`${where}.${k}: a ${ty}`);
  const kinds = ["role", "label", "text", "testId"].filter((k) => t[k] !== undefined);
  if (kinds.length !== 1) errors.push(`${where}: exactly one of role, label, text, testId`);
  if (t.name !== undefined && t.role === undefined) errors.push(`${where}.name: only with role`);
  if (t.match !== undefined && !["exact", "contains"].includes(t.match)) errors.push(`${where}.match: "exact" or "contains"`);
  if (t.role === "" || t.text === "" || t.label === "" || t.testId === "") errors.push(`${where}: empty`);
}

function checkFields(obj, shape, where, errors) {
  for (const k of Object.keys(obj)) if (!(k in shape)) errors.push(`${where}.${k}: not allowed here (${Object.keys(shape).join(", ") || "no fields"})`);
  for (const [k, ty] of Object.entries(shape)) {
    const optional = ty.endsWith("?"); const base = ty.replace(/\?$/, "");
    if (obj[k] === undefined) { if (!optional) errors.push(`${where}.${k}: required`); continue; }
    if (base === "target") checkTarget(obj[k], `${where}.${k}`, errors);
    else if (base === "array") { if (!Array.isArray(obj[k])) errors.push(`${where}.${k}: a list`); }
    else if (typeof obj[k] !== base) errors.push(`${where}.${k}: a ${base}`);
  }
}

/** Validate a spec. → { ok, errors, spec } (the spec as given; nothing is filled in). */
export function validateSpec(spec) {
  const errors = [];
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return { ok: false, errors: ["a spec is an object"] };
  checkFields(spec, TOP, "spec", errors);
  if (typeof spec.id === "string" && !/^CS-[a-z0-9-]+-[a-z0-9-]+$/.test(spec.id)) errors.push(`spec.id: CS-<lens>-<slug>, lower case (got "${spec.id}")`);
  if (typeof spec.id === "string" && typeof spec.lens === "string" && !spec.id.startsWith(`CS-${spec.lens}-`)) errors.push("spec.id: must start with CS-<lens>-");
  if (typeof spec.path === "string" && !spec.path.startsWith("/")) errors.push("spec.path: a path on the site, starting with /");
  if (typeof spec.account === "string" && !ACCOUNTS.includes(spec.account)) errors.push(`spec.account: one of ${ACCOUNTS.join(", ")}`);
  if (typeof spec.viewport === "string" && !VIEWPORTS[spec.viewport]) errors.push(`spec.viewport: ${Object.keys(VIEWPORTS).join(" or ")}`);
  if (typeof spec.why === "string" && spec.why.trim().length < 8) errors.push("spec.why: say what you expected, in words");
  const each = (list, table, name) => (Array.isArray(list) ? list : []).forEach((item, i) => {
    const where = `${name}[${i}]`;
    if (!item || typeof item !== "object" || Array.isArray(item)) { errors.push(`${where}: an object`); return; }
    const kinds = Object.keys(item).filter((k) => k in table);
    const verbKey = name === "steps" ? "do" : null;
    if (verbKey) {
      if (!(item.do in table)) { errors.push(`${where}.do: one of ${Object.keys(table).join(", ")}`); return; }
      const { do: _d, ...rest } = item;
      checkFields(rest, table[item.do], `${where}(${item.do})`, errors);
    } else {
      if (kinds.length !== 1 || Object.keys(item).length !== 1) { errors.push(`${where}: exactly one of ${Object.keys(table).join(", ")}`); return; }
      const v = item[kinds[0]];
      if (!v || typeof v !== "object" || Array.isArray(v)) { errors.push(`${where}.${kinds[0]}: an object`); return; }
      checkFields(v, table[kinds[0]], `${where}.${kinds[0]}`, errors);
      if (kinds[0] === "text" && [v.equals, v.contains, v.matches].filter((x) => x !== undefined).length !== 1) errors.push(`${where}.text: exactly one of equals, contains, matches`);
      if (kinds[0] === "count" && [v.eq, v.min, v.max].every((x) => x === undefined)) errors.push(`${where}.count: eq, min or max`);
      for (const rk of ["matches"]) if (typeof v[rk] === "string") { try { new RegExp(v[rk]); } catch { errors.push(`${where}.${kinds[0]}.${rk}: not a valid regex`); } }
    }
  });
  each(spec.steps, STEPS, "steps");
  each(spec.expect, EXPECTS, "expect");
  if (Array.isArray(spec.expect) && !spec.expect.length) errors.push("expect: at least one expectation (a check with nothing expected always passes)");
  return { ok: errors.length === 0, errors, spec };
}
