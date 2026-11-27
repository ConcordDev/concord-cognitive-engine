// server/lib/conkay/build/report.js
//
// What a build proved, in the person's own units (owner: "any unit in, yours
// back"; "build it, mark the gap"). Three lists, all read from solver runs:
//   checked   — a solver compared a demand with a capacity (PASS / FAIL / WARN)
//   computed  — a solver produced numbers but no limit was stated to check them
//   gaps      — what no solver could check, with its reason and what would check it
// plus the part tree and an overall verdict. Nothing here is the model's word.

import { scanAmounts, parseUnit, formatAmount, siSymbol } from "../units/universal.js";

const DIM_ALIASES = { "fraction of supply": "ratio", fraction: "ratio", "1": "ratio" };

/** The units the person used, per dimension; imperial lengths pull stress/force/pressure to US units. */
export function unitPreferences(text) {
  const prefs = {};
  for (const a of scanAmounts(text).amounts) if (a.dim && !prefs[a.dim] && a.unit) prefs[a.dim] = a.unit;
  const usLen = /^(?:in|ft|'|"|yd|mi|inch|inches|feet|foot)$/.test(prefs.length || "");
  if (usLen || /^(?:lb|lbs|oz)$/.test(prefs.mass || "")) {
    prefs.pressure ??= "psi";
    prefs.force ??= "lbf";
    prefs.mass ??= "lb";
  }
  if (prefs.temperature) prefs.temperature = /F/.test(prefs.temperature) ? "°F" : /C/.test(prefs.temperature) ? "°C" : prefs.temperature;
  return prefs;
}

/** SI value + unit label from a solver → { si, dim } (null when the label is not a unit). */
function toSI(value, unit) {
  if (!Number.isFinite(value)) return null;
  const u = String(unit || "");
  if (DIM_ALIASES[u]) return { si: value, dim: DIM_ALIASES[u] };
  if (/^[a-z_]+$/.test(u) && siSymbol(u) !== "SI") return { si: value, dim: u };
  const p = parseUnit(u.replace(/\^3/g, "³").replace(/\^2/g, "²"));
  if (!p.ok) return null;
  return { si: p.offset ? value * p.factor + p.offset : value * p.factor, dim: p.dim };
}

const show = (value, unit, prefs) => {
  const s = toSI(value, unit);
  if (!s) return Number.isFinite(value) ? `${Number(value.toPrecision(4))} ${unit || ""}`.trim() : String(value);
  if (s.dim === "ratio" || /fraction/.test(s.dim)) return `${Number((s.si * 100).toPrecision(3))} %`;
  return formatAmount(s.si, s.dim, prefs[s.dim]);
};

function partTree(graph) {
  const contained = new Set();
  for (const n of graph.nodes.values()) for (const k of graph.children(n.id)) contained.add(k.id);
  const walk = (n, depth) => (depth > 8 ? null : {
    id: n.id, name: n.name || n.id, kind: n.kind,
    ...(n.material ? { material: n.material } : {}),
    ...(n.geometry?.shape ? { shape: n.geometry.shape } : {}),
    children: graph.children(n.id).map((k) => walk(k, depth + 1)).filter(Boolean),
  });
  return [...graph.nodes.values()].filter((n) => !contained.has(n.id) && n.kind !== "Material").map((n) => walk(n, 0));
}

export function buildReport(session, { text = "", plan = {} } = {}) {
  const prefs = unitPreferences(text);
  const graph = session.graph;
  const nameOf = (id) => graph.node(id)?.name || id;
  const env = session.results();
  const checked = []; const computed = []; const gaps = [];
  for (const e of env) {
    const base = { solver: e.solver?.id, method: e.solver?.method || null, target: e.target, targetName: nameOf(e.target), status: e.status };
    if (e.status === "NOT_COMPUTED" || e.status === "ERROR") {
      gaps.push({ ...base, reason: String(e.reason || e.error || "not computed"), needs: /needs? (.+)$/i.exec(String(e.reason || ""))?.[1] || null });
      continue;
    }
    const margins = Array.isArray(e.margins) ? e.margins : [];
    if (margins.length) {
      for (const m of margins) {
        const ok = Number(m.demand) <= Number(m.capacity);
        checked.push({
          ...base, check: m.check, pass: ok, basis: m.basis || null,
          demand: show(Number(m.demand), m.unit, prefs), capacity: show(Number(m.capacity), m.unit, prefs),
          utilization: Number(m.capacity) > 0 ? Number((m.demand / m.capacity).toPrecision(3)) : null,
        });
      }
      if (e.status === "WARN" && e.warnings?.length) for (const w of e.warnings) computed.push({ ...base, note: String(w) });
    } else {
      const outs = Object.entries(e.outputs || {}).filter(([, o]) => o && typeof o === "object" && Number.isFinite(o.value)).slice(0, 6)
        .map(([k, o]) => ({ name: k, value: show(o.value, o.unit, prefs) }));
      computed.push({ ...base, outputs: outs, note: (e.warnings || []).join("; ") || "computed; no limit was stated to check it against" });
    }
  }
  // Domains a part needs that no solver covers at all.
  for (const row of session.coverage()) {
    for (const d of row.domains || []) {
      if (d.status === "not computed" && /^no .+ solver yet$/.test(d.reason || "")) gaps.push({ target: row.node, targetName: nameOf(row.node), domain: d.domain, reason: d.reason, needs: `a ${d.domain} solver` });
    }
  }
  const fails = checked.filter((c) => !c.pass).length;
  const passes = checked.filter((c) => c.pass).length;
  const masses = env.filter((e) => e.solver?.id === "mass.part" && e.status !== "NOT_COMPUTED")
    .map((e) => ({ id: e.target, name: nameOf(e.target), mass: Number.isFinite(e.outputs?.mass?.value) ? show(e.outputs.mass.value, e.outputs.mass.unit || "kg", prefs) : null }));
  return {
    verdict: fails ? "fails" : passes ? "passes_checked" : "unchecked",
    headline: fails ? `${fails} of ${checked.length} checks fail` : passes ? `all ${passes} checks pass; ${gaps.length} not checked` : "nothing was checked against a limit yet",
    units: prefs,
    parts: partTree(graph), masses,
    checked, computed, gaps,
    questions: plan.questions || [], assumptions: plan.assumptions || [], sources: plan.sources || [],
  };
}
