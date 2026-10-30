// DTU classification: what a DTU *is* (kind), where it came from (origin) and what it is about (domain).
// Pure and cheap (no I/O): safe to call on every write. Rules are ordered; the first match wins.

export const CLASSIFY_VERSION = 1;

export const KINDS = Object.freeze([
  "mega", "hyper", "feed_snapshot", "ingested_corpus", "math_proof", "hypothesis", "theory",
  "empirical", "autogen", "user_authored", "unclassified",
]);

const lc = (v) => String(v ?? "").toLowerCase();
const tagsOf = (d) => (Array.isArray(d?.tags) ? d.tags.map(lc) : []);
const hasTag = (tags, re) => tags.some((t) => re.test(t));

export function textOf(d) {
  const core = d?.core || {};
  const parts = [
    d?.title, d?.human?.summary, d?.cretiHuman, typeof d?.creti === "string" ? d.creti : "", d?.body, d?.content,
    ...(Array.isArray(core.definitions) ? core.definitions : []), ...(Array.isArray(core.claims) ? core.claims : []),
  ];
  return parts.filter((x) => typeof x === "string" && x).join("\n").slice(0, 8000);
}

export function originOf(d) {
  const src = lc(d?.source), tags = tagsOf(d);
  if (/^(feed|rss)/.test(src) || hasTag(tags, /^feed\b/) || d?.meta?.feedName) return "feed";
  if (/(import|ingest|corpus|textbook|wiki)/.test(src) || hasTag(tags, /^(ingest|corpus|import)/)) return "ingest";
  if (/(autogen|subconscious|dream|synthes|consolidat|auto)/.test(src) || hasTag(tags, /^(autogen|auto-generated|subconscious|synthesized)/)) return "autogen";
  if (/^(user|manual|human|upload)/.test(src) || d?.meta?.authoredBy === "user") return "user";
  if (/(system|seed|operator)/.test(src)) return "system";
  return d?.author || d?.createdBy ? "user" : "unknown";
}

const MATH_RE = /\b(theorem|lemma|corollary|proof|prove[sd]?|qed|axiom)\b|[∀∃∑∫]|\\begin\{|\\forall|\\exists/i;
const UNIT_FIGURE_RE = /\b-?\d[\d,]*(?:\.\d+)?\s?(?:mm|cm|km|m|kg|g|mg|n|kn|mpa|gpa|pa|kpa|hz|khz|mhz|ghz|w|kw|mw|v|mv|a|ma|ohm|k|°c|°f|j|kj|mol|l|ml|s|ms|min|h|%)\b/gi;

export function hasUnitFigures(text) {
  return (String(text).match(UNIT_FIGURE_RE) || []).length;
}

export function kindOf(d, origin = originOf(d)) {
  const tags = tagsOf(d), text = textOf(d), title = lc(d?.title);
  if (d?.tier === "mega" || d?.tier === "MEGA") return "mega";
  if (d?.tier === "hyper" || d?.tier === "HYPER") return "hyper";
  if (origin === "feed") return "feed_snapshot";
  if (origin === "ingest") return "ingested_corpus";
  if (hasTag(tags, /^(math|proof|theorem|lemma|formal)/) || MATH_RE.test(text)) return "math_proof";
  if (hasTag(tags, /hypothes/) || /^hypothesis\b|\bhypothes[ie]s:/.test(title)) return "hypothesis";
  if (hasTag(tags, /theor/) || /\btheory\b/.test(title)) return "theory";
  if (hasTag(tags, /^(measured|empirical|experiment|dataset|observation|benchmark)/) || (hasUnitFigures(text) >= 2 && (d?.meta?.sourceUrl || d?.sources?.length))) return "empirical";
  if (origin === "autogen") return "autogen";
  if (origin === "user") return "user_authored";
  return "unclassified";
}

const DOMAIN_WORDS = [
  ["mathematics", /\b(theorem|lemma|integral|derivative|matrix|polynomial|prime|topology|algebra|calculus)\b/i],
  ["physics", /\b(quantum|relativity|momentum|entropy|thermodynamic|electromagnetic|photon|particle)\b/i],
  ["chemistry", /\b(molecule|reaction|compound|enthalpy|acid|polymer|stoichiometr|catalyst)\b/i],
  ["engineering", /\b(beam|truss|load|stress|buckling|torque|bearing|weld|tolerance|fea)\b/i],
  ["biology", /\b(cell|protein|gene|genome|species|ecosystem|enzyme|dna|rna)\b/i],
  ["medicine", /\b(patient|clinical|diagnos|therapy|dose|symptom|disease)\b/i],
  ["computing", /\b(algorithm|compiler|database|network|software|kernel|neural|api|runtime)\b/i],
  ["economics", /\b(market|price|inflation|currency|trade|royalt|ledger|supply|demand)\b/i],
  ["law", /\b(statute|contract|liability|court|regulation|patent|copyright)\b/i],
  ["music", /\b(melody|harmony|chord|tempo|rhythm|synth|mix)\b/i],
  ["history", /\b(empire|century|war|dynasty|revolution|ancient)\b/i],
  ["philosophy", /\b(ethic|epistem|metaphys|ontolog|consciousness|moral)\b/i],
  ["agriculture", /\b(crop|soil|harvest|irrigation|livestock|yield)\b/i],
];

export function domainOf(d) {
  const explicit = d?.domain || d?.lens || d?.meta?.domain || d?.meta?.lens;
  if (typeof explicit === "string" && explicit.trim()) return lc(explicit).slice(0, 40);
  const tag = (Array.isArray(d?.tags) ? d.tags : []).map(lc).find((t) => t.startsWith("domain:") || t.startsWith("lens:"));
  if (tag) return tag.split(":")[1].slice(0, 40);
  const text = `${d?.title || ""}\n${textOf(d)}`;
  let best = null, bestN = 0;
  for (const [name, re] of DOMAIN_WORDS) {
    const n = (text.match(new RegExp(re.source, "gi")) || []).length;
    if (n > bestN) { best = name; bestN = n; }
  }
  return best || "general";
}

export function classifyDtu(d) {
  const origin = originOf(d);
  return { kind: kindOf(d, origin), origin, domain: domainOf(d) };
}
