// Governor optional macros.
//
// governorTick used to call these every tick inside try/catch → observe().
// None of them are registered:
//   queue            — lens-action domain, not in MACROS (domain-not-found)
//   jobs.tick        — jobs drain on their own worker; no tick macro
//   ingest.tick      — ingest has processQueueOnce, not tick
//   crawl.tick       — crawl.fetch runs as a job; no tick macro
//   system.synth     — the real macro is system.synthesize, already on the
//                      cognitive heartbeat
// Each miss threw into the repair cortex on every tick. Log the absence
// once when the governor starts, then skip. A macro that IS registered
// still runs, and a throw from it is still observed.

export const GOVERNOR_OPTIONAL_MACROS = Object.freeze([
  { domain: "jobs", name: "tick", tag: "governor_jobs_tick" },
  { domain: "queue", name: "tick", tag: "governor_queue_tick" },
  { domain: "ingest", name: "tick", tag: "governor_ingest_tick" },
  { domain: "crawl", name: "tick", tag: "governor_crawl_tick" },
  { domain: "system", name: "synth", tag: "governor_synth_heartbeat" },
]);

const _loggedAbsent = new Set();

export function isMacroRegistered(macros, domain, name) {
  const bucket = macros?.get?.(domain);
  if (!bucket || typeof bucket.get !== "function") return false;
  return Boolean(bucket.get(name));
}

/** Identity the boot log should use: bare domain when the domain itself is missing. */
export function absentMacroLabel(macros, spec) {
  if (!macros?.get?.(spec.domain)) return spec.domain;
  return `${spec.domain}.${spec.name}`;
}

/**
 * Log each still-unregistered optional macro once per process (or per `seen` set).
 * @returns {string[]} labels logged by this call
 */
export function logAbsentGovernorMacrosOnce(macros, log, seen = _loggedAbsent) {
  const logged = [];
  for (const spec of GOVERNOR_OPTIONAL_MACROS) {
    if (isMacroRegistered(macros, spec.domain, spec.name)) continue;
    const label = absentMacroLabel(macros, spec);
    if (seen.has(label)) continue;
    seen.add(label);
    logged.push(label);
    const domainMissing = !macros?.get?.(spec.domain);
    log("info", "governor_optional_macro_absent", {
      macro: label,
      domain: spec.domain,
      name: spec.name,
      reason: domainMissing ? "domain_not_registered" : "macro_not_registered",
    });
  }
  return logged;
}

/**
 * Run the optional macros that are actually registered. Absent ones are
 * skipped with no observe(). A throw from a present macro is observed
 * under that macro's tag and does not stop the rest.
 */
export async function tickGovernorOptionalMacros({
  macros,
  runMacro,
  observe,
  input,
  ctx,
  synthEnabled = true,
}) {
  for (const spec of GOVERNOR_OPTIONAL_MACROS) {
    if (spec.domain === "system" && spec.name === "synth" && !synthEnabled) continue;
    if (!isMacroRegistered(macros, spec.domain, spec.name)) continue;
    try {
      await runMacro(spec.domain, spec.name, input, ctx);
    } catch (e) {
      try { observe(e, spec.tag); } catch { /* observe must not stop the tick */ }
    }
  }
}
