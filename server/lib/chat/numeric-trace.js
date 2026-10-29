// server/lib/chat/numeric-trace.js
//
// A number with an engineering unit in a reply must come from somewhere: a tool
// result from this turn, the user's own message, or a plain derivation of those
// (a sum, difference, product or quotient of two of them, or a unit rescale).
// Live-test finding (2026-10-29, footbridge): the tool returned 25 MPa and the
// reply said 111 MPa. Nothing compared them.
//
// This does not rewrite the reply (a rewrite could damage a correct sentence).
// It flags: a note names every unit-bearing number it could not trace, so the
// reader knows those figures are the model's own and unchecked.
//
// Only runs when a calculation tool ran this turn; with no tool results there
// is nothing to trace against and other guards own that case.

const UNITS = "(?:GPa|MPa|kPa|Pa|psi|ksi|kN|MN|N|lbf|kips?|kg|g|mm|cm|km|m|ft|in|K|°C|°F|kW|MW|W|kJ|MJ|J|Hz|kHz|V|kV|A|mA|ohms?|Ω|%|m/s|m²|m³|mm²|mm⁴|m⁴|N·m|kN·m|N\\*m|kN\\*m)";
const NUM = "-?\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|-?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?";
const QUANTITY_RE = new RegExp(`(${NUM})\\s*(${UNITS})(?![A-Za-z])`, "g");
const REL_TOL = 0.005; // 0.5%: a rounded figure still traces
const SCALES = [1, 1e3, 1e-3, 1e6, 1e-6, 1e9, 1e-9, 100, 0.01, 0.5, 2];
const MAX_POOL = 40;

const toNumber = (s) => Number(String(s).replace(/,/g, ""));

// Keys that repeat or bulk out a result (a recipe's receipt copies its result and every step).
const BULK_KEYS = new Set(["receipt", "steps", "inputSchema", "verification", "artifact", "artifacts"]);

function numbersIn(value, acc, { maxDepth = 8, skipBulk = false } = {}, depth = 0, seen = new WeakSet()) {
  if (value == null || depth > maxDepth) return;
  if (typeof value === "number") { if (Number.isFinite(value)) acc.add(value); return; }
  if (typeof value === "string") {
    for (const m of value.matchAll(new RegExp(NUM, "g"))) { const n = toNumber(m[0]); if (Number.isFinite(n)) acc.add(n); }
    return;
  }
  if (typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) { for (const v of value) numbersIn(v, acc, { maxDepth, skipBulk }, depth + 1, seen); return; }
  for (const [k, v] of Object.entries(value)) {
    if (skipBulk && BULK_KEYS.has(k)) continue;
    numbersIn(v, acc, { maxDepth, skipBulk }, depth + 1, seen);
  }
}

const close = (a, b) => (a === b) || (b !== 0 && Math.abs(a - b) <= REL_TOL * Math.abs(b)) || (Math.abs(a - b) < 1e-9);

function tracedAgainst(x, pool, prominent) {
  const ax = Math.abs(x);
  // any number the tools printed, rescaled by a unit factor
  for (const v of pool) for (const s of SCALES) if (close(ax, Math.abs(v) * s)) return true;
  // a plain derivation (sum, difference, product, quotient) only of the headline numbers: deriving from every
  // number in a large result would let almost any figure "trace"
  const small = prominent.slice(0, MAX_POOL);
  for (let i = 0; i < small.length; i++) {
    for (let j = i; j < small.length; j++) {
      const a = Math.abs(small[i]); const b = Math.abs(small[j]);
      const derived = [a * b, a + b, Math.abs(a - b), b ? a / b : NaN, a ? b / a : NaN];
      for (const d of derived) for (const s of SCALES) if (Number.isFinite(d) && close(ax, d * s)) return true;
    }
  }
  return false;
}

/**
 * @param {string} reply
 * @param {Array} toolCalls  executed tool results this turn
 * @param {{prompt?:string}} [opts]
 * @returns {{ text: string, untraced: string[], checked: number }}
 */
export function guardNumericTrace(reply, toolCalls = [], { prompt = "" } = {}) {
  const text = String(reply || "");
  const ran = (toolCalls || []).filter((t) => t && t.ok !== false && t.result != null
    && /^(?:run_compute|conkay_design|conkay_solve|run_recipe|get_live_data|run_python)$/.test(String(t.tool || "")));
  if (!text || !ran.length) return { text, untraced: [], checked: 0 };

  const set = new Set();
  const head = new Set();
  for (const t of ran) { numbersIn(t.result, set); numbersIn(t.result, head, { maxDepth: 3, skipBulk: true }); }
  numbersIn(String(prompt || ""), set);
  numbersIn(String(prompt || ""), head);
  const pool = [...set].filter((n) => n !== 0);
  const prominent = [...head].filter((n) => n !== 0);

  // Prose outside code fences only; a fenced block is the tool's own echo.
  const prose = text.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");
  const untraced = [];
  let checked = 0;
  for (const m of prose.matchAll(QUANTITY_RE)) {
    const x = toNumber(m[1]);
    if (!Number.isFinite(x)) continue;
    checked++;
    if (m[2] === "%" && Number.isInteger(x) && x <= 100) continue; // "100%" / "95%" confidence-style prose
    if (tracedAgainst(x, pool, prominent)) continue;
    const shown = `${m[1]} ${m[2]}`;
    if (!untraced.includes(shown)) untraced.push(shown);
  }
  if (!untraced.length) return { text, untraced, checked };
  const list = untraced.slice(0, 6).join(", ");
  const more = untraced.length > 6 ? ` (+${untraced.length - 6} more)` : "";
  return {
    text: `${text.replace(/\s+$/, "")}\n\n_Unverified figures: ${list}${more} did not appear in this turn's tool results or in your message. Treat them as unchecked; the tool results above are the checked numbers._`,
    untraced,
    checked,
  };
}
