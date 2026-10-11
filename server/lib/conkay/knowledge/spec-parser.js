// server/lib/conkay/knowledge/spec-parser.js
//
// Whole-spec ingestion: a deterministic Markdown reader that turns an
// engineering spec into separate claim records (Sentinel/RAM spec rev 1.0,
// section 8 rules 1-2). No model is involved: headings, tables, bullets,
// display equations and paragraphs are split by syntax, and each passage is
// labelled from curated keyword tables. Every record keeps its provenance
// (document sha256, section, line range, excerpt) and the status the
// document itself states for it ("statedStatus"), which is the author's
// assertion, not ConKay's verdict: ConKay's own status comes from the
// re-checks (spec-rechecks.js) and the solvers.

import crypto from "node:crypto";

export const PARSER_VERSION = "1.0.0";

// Status words the spec defines (its "Claim statuses used throughout").
const STATUS_WORDS = ["sourced", "computed", "estimated", "hypothesis", "contradicted", "unknown", "rejected", "measured", "out of scope"];

// Curated passage labels. A passage can carry several; the first match in
// this order is its primary kind. Word-boundary regexes, case-insensitive.
const KIND_RULES = [
  ["computation", /(\\\[|=\s*\d|×\s*\d|\btimes\b|\\frac|\bsum of (?:minima|maxima)\b)/i],
  ["performance", /\b(mph|km\/s|transit|sprint|lift|strike|speed|efficien\w*|indefinite|perpetual|beyond ballistic|self-repair\w*|blocking|radiation-proof|headroom|operating duration|kW\b|W\b|thrust)/i],
  ["material", /\b(USB|HDPE|PP\b|BaTiO|PZT|polymer|formulation|composite|coupon|steel|basalt|graphene|silica|CaCO|thermoplastic)/i],
  ["component", /\b(battery|actuator\w*|sensor\w*|pump|solar|panel|compute|lidar|frame|member\w*|feet|foot|laser|QCL|vessel|housing|charge controller|data logger|filter|flow meter|electrolyzer|armor)\b/i],
  ["dimension", /\b(\d[\d,.]*\s*(?:ft|m|mm|cm|lb|kg|AU)\b|height|mass|area|dimension\w*)/i],
  ["process", /\b(cure|curing|melt\w*|mixing|weld\w*|mold|poured|electrolysis|splitting|residence time|cooling profile|conditioning|poling)/i],
  ["environment", /\b(seawater|salinity|irradiance|site|surface|°C|°F|cabin climate|temperature|brine|condensate)/i],
  ["requirement", /\b(must|required|requires|acceptance|not accepted|reject|is not a pass|no claim)/i],
];

// Bins (spec section 0). Curated phrases → bin; the matching rule is recorded.
const BIN_RULES = [
  ["unsupported-as-stated", /\b(laser seawater|seawater splitting|96\.79 THz|dissociat\w+|fuel cycle|indefinite operation|one battery start|zero drag|instant acceleration|interplanetary|transit time|Mars|Moon at|rain-cycle|QCL hydrogen|resonance-emitter|Conquest|Nano-USB|80–100 mph|15,000 lb|apartment-in-torso)/i],
  ["research-stage", /\b(USB|self-heal\w*|self-repair\w*|piezoelectric|piezo|sensory (?:skin|layer)|BaTiO|PZT|beyond ballistic|IR blocking|radiation|formulation lane|coupon)/i],
  ["buildable", /\b(Milestone [01]|frame|sensors?|solar|batter(?:y|ies)|pumps?|thermal management|cabin packaging|controls|simulation|actuators?|compute)\b/i],
];

const UNIT_RX = String.raw`(THz|Hz|nm|µm|cm⁻¹|cm-1|eV|kJ\/mol|kJ mol⁻¹|kJ\/min|kJ min⁻¹|kWh\/kg|kW|W\/m²|W|V|g\/min|g min⁻¹|kg\/h|kg h⁻¹|mol\/min|mol min⁻¹|g\/mol|lb|ft|m|km\/s|AU|days?|hours?|%|°C|°F|mph)`;
const NUM = String.raw`\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?`;
const QTY = new RegExp(String.raw`(~|about |≈\s*)?(-?(?:${NUM}))(?:\s*[–-]\s*(${NUM}))?(?:\s*[×x]\s*10\^?\{?(-?\d+)\}?)?\s*${UNIT_RX}(?![A-Za-z])`, "g");

/** Strip the LaTeX this spec uses down to readable text (for matching and excerpts). */
export function delatex(s) {
  return String(s)
    .replace(/\\\(|\\\)/g, "")
    .replace(/\\(?:mathrm|text|operatorname)\{([^}]*)\}/g, "$1")
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, "($1)/($2)")
    .replace(/\\,|\\;|\\ /g, " ")
    .replace(/\\times/g, "×").replace(/\\approx/g, "≈").replace(/\\Delta\s*/g, "Δ").replace(/\\nu/g, "ν").replace(/\\lambda/g, "λ")
    .replace(/\\eta/g, "η").replace(/\\int/g, "∫").replace(/\\dot\s*n/g, "ṅ").replace(/\\circ/g, "°").replace(/\{,\}/g, ",")
    .replace(/\^\{-1\}/g, "⁻¹").replace(/\^\{([^}]*)\}/g, "^$1").replace(/_\{?([A-Za-z0-9,]+)\}?/g, "_$1")
    .replace(/\s+/g, " ").trim();
}

function quantities(text) {
  const out = [];
  for (const m of text.matchAll(QTY)) {
    const scale = m[4] ? 10 ** Number(m[4]) : 1;
    const num = (x) => Number(x.replace(/,/g, "")) * scale;
    const q = { value: num(m[2]), unit: m[5], approx: Boolean(m[1]), text: m[0].trim() };
    if (m[3]) q.range = { min: num(m[2]), max: num(m[3]) };
    out.push(q);
  }
  return out;
}

function statedStatus(text) {
  const found = [];
  for (const m of text.matchAll(/\*\*([^*]+)\*\*/g)) {
    const w = m[1].trim().toLowerCase();
    if (STATUS_WORDS.includes(w)) found.push(w);
  }
  return found;
}

function statusInCell(cell) {
  const w = cell.toLowerCase();
  return STATUS_WORDS.filter((s) => new RegExp(`\\b${s}\\b`).test(w));
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);

/**
 * Parse a Markdown spec. Returns { doc, sections, claims, entities }.
 * Deterministic: the same text gives the same output, byte for byte.
 */
export function parseSpecMarkdown(text, { sourceId = "spec" } = {}) {
  const src = String(text).replace(/\r\n/g, "\n");
  const lines = src.split("\n");
  const sha256 = crypto.createHash("sha256").update(src).digest("hex");
  const sections = [];
  const claims = [];
  let section = { id: "front", number: null, title: "(front matter)", level: 0, line: 1 };
  const titleLine = lines.find((l) => /^#\s/.test(l));
  const revLine = lines.find((l) => /^Revision\s/i.test(l)) || null;

  const push = (kind, startLine, endLine, raw, extra = {}) => {
    const plain = delatex(raw.replace(/\*\*/g, ""));
    if (!plain) return;
    const kinds = KIND_RULES.filter(([, rx]) => rx.test(raw) || rx.test(plain)).map(([k]) => k);
    const binHit = BIN_RULES.find(([, rx]) => rx.test(plain));
    // The spec's legend ("**Sourced** — traceable ...") defines words; it asserts nothing.
    const isDefinition = kind === "bullet" && new RegExp(`^\\*\\*(${STATUS_WORDS.join("|")})\\*\\*\\s*—`, "i").test(raw.trim());
    const stated = isDefinition ? [] : extra.statedStatus ?? statedStatus(raw);
    claims.push({
      id: `${sourceId}:${section.number || slug(section.title)}:L${startLine}`,
      block: kind,
      kind: isDefinition ? "definition" : kinds[0] || "statement",
      tags: kinds,
      section: { number: section.number, title: section.title },
      text: plain,
      quantities: quantities(plain),
      statedStatus: stated,
      bin: binHit ? binHit[0] : null,
      binRule: binHit ? String(binHit[1]) : null,
      provenance: { sourceId, sha256, lines: [startLine, endLine], excerpt: plain.slice(0, 240) },
      ...(extra.row ? { row: extra.row } : {}),
    });
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const n = i + 1;
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const title = h[2].trim();
      const num = title.match(/^(\d+(?:\.\d+)*)\.?\s/);
      section = { id: slug(title), number: num ? num[1] : null, title, level: h[1].length, line: n };
      sections.push(section);
      i += 1;
      continue;
    }
    if (/^\s*$/.test(line) || /^---\s*$/.test(line)) { i += 1; continue; }
    if (/^\\\[\s*$/.test(line.trim())) {
      let j = i + 1;
      while (j < lines.length && !/^\\\]\s*$/.test(lines[j].trim())) j += 1;
      push("equation", n, j + 1, lines.slice(i + 1, j).join(" "));
      i = j + 1;
      continue;
    }
    if (/^\|/.test(line)) {
      let j = i;
      while (j < lines.length && /^\|/.test(lines[j])) j += 1;
      const cells = (l) => l.replace(/^\||\|$/g, "").split("|").map((c) => c.trim());
      const header = cells(lines[i]);
      const statusCol = header.findIndex((c) => /status|disposition/i.test(c));
      for (let k = i + 2; k < j; k += 1) {
        const row = cells(lines[k]);
        const stated = statusCol >= 0 ? statusInCell(row[statusCol] || "") : statedStatus(lines[k]);
        push("table-row", k + 1, k + 1, header.map((hd, c) => `${hd}: ${row[c] ?? ""}`).join("; "), { statedStatus: stated, row: Object.fromEntries(header.map((hd, c) => [hd, row[c] ?? ""])) });
      }
      i = j;
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      push("bullet", n, n, line.replace(/^\s*[-*]\s+/, ""));
      i += 1;
      continue;
    }
    let j = i;
    while (j + 1 < lines.length && lines[j + 1].trim() && !/^(#|\||\s*[-*]\s|\\\[|---)/.test(lines[j + 1])) j += 1;
    push("paragraph", n, j + 1, lines.slice(i, j + 1).join(" "));
    i = j + 1;
  }

  // Entities: curated vocabulary, each with every line it appears on.
  const VOCAB = {
    component: ["battery", "actuator", "solar array", "charge controller", "pump", "filter", "flow meter", "pressure tap", "salinity", "data logger", "QCL", "quantum-cascade laser", "frame", "feet", "compute", "sensor head", "payload hard-point", "electrolyzer", "armor cage"],
    material: ["HDPE", "PP", "BaTiO₃", "PZT", "steel", "USB Blend D", "Steel-USB", "basalt", "graphene"],
    process: ["cure", "melt", "weld", "electrolysis", "mixing", "poling", "mold"],
    environment: ["seawater", "salinity", "irradiance", "25 °C", "97–99 °F", "surface"],
  };
  const entities = [];
  for (const [kind, words] of Object.entries(VOCAB)) {
    for (const w of words) {
      const rx = new RegExp(`(^|[^A-Za-z])${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^A-Za-z]|$)`, "i");
      const at = lines.map((l, k) => (rx.test(l) ? k + 1 : null)).filter(Boolean);
      if (at.length) entities.push({ id: `${sourceId}:${kind}:${slug(w)}`, kind, name: w, lines: at, provenance: { sourceId, sha256 } });
    }
  }

  return {
    parser: { id: "spec-markdown", version: PARSER_VERSION },
    doc: { sourceId, sha256, lineCount: lines.length, title: titleLine ? titleLine.replace(/^#\s+/, "").trim() : null, revision: revLine },
    sections: sections.map(({ id, number, title, level, line }) => ({ id, number, title, level, line })),
    claims,
    entities,
  };
}

/** Find the first claim whose text matches rx (for linking re-checks to passages). */
export function findPassage(parsed, rx) {
  return parsed.claims.find((c) => rx.test(c.text)) || null;
}

/** Counts by kind / stated status / bin, for the report. */
export function summarizeSpec(parsed) {
  const count = (f) => parsed.claims.reduce((m, c) => { for (const k of [].concat(f(c))) m[k] = (m[k] || 0) + 1; return m; }, {});
  return {
    claims: parsed.claims.length,
    byKind: count((c) => c.kind),
    byStatedStatus: count((c) => (c.statedStatus.length ? c.statedStatus : ["(none stated)"])),
    byBin: count((c) => c.bin || "(unbinned)"),
    entities: parsed.entities.length,
  };
}
