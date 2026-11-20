// server/lib/dtu-shelf.js
//
// Which shelf of the Binder a DTU belongs on. Shelves are what a person
// browsing for valuable work expects, not how a DTU was stored:
//
//   works      music releases, artwork, film, writing, podcasts — finished creative work
//   specs      engineering, designs, CAD, code, recipes, how-tos
//   documents  files: PDFs, spreadsheets, imported text
//   knowledge  research, claims, theories, proofs, explanations
//   data       live data snapshots from outside feeds (prices, weather, quakes)
//   records    personal context: chat memory, conversations, notes to self, mood, till records
//   parts      pieces of something else: uploaded audio behind a release, covers, product photos, passes
//   system     machine rows: error reports, heartbeats, internal consolidations, genesis
//
// The first four are shown by default; the rest only when someone filters
// them in. Pure and cheap (no I/O). Rules are ordered; the first match wins,
// and the reason is returned so the Binder can say why a card is where it is.

import { classifyDtu } from "./dtu-quality/classify.js";

export const SHELVES = Object.freeze(["works", "specs", "documents", "knowledge", "data", "records", "parts", "system"]);
export const DEFAULT_SHELVES = Object.freeze(["works", "specs", "documents", "knowledge"]);
export const HIDDEN_SHELVES = Object.freeze(["data", "records", "parts", "system"]);

const lc = (v) => String(v ?? "").toLowerCase();
const tagsOf = (d) => [...(Array.isArray(d?.tags) ? d.tags : []), ...(Array.isArray(d?.meta?.tags) ? d.meta.tags : [])].map(lc);

const SYSTEM_SOURCES = /^(client_error|error|heartbeat|kernel|sentinel|ops|incident|env|environment|trace_fabric_error|test_seed|test_credit|shadow|shadow_graph|usb\.macro|x-forwarded-for|concord-mesh|event_bridge_compression|core\.invariants|viability|world_events_log)$/;
const RECORD_SOURCES = /^(conversation-memory|chat-enrichment|memory|mood|notification|affect_valence_delta|proactive|your-thread|user_rule|scheduled|today|chat|session|journal|retail-till-close|income|credits|accounting-invoice)$/;
const RECORD_TAGS = /^(chat|conversation|chat-memory|session|memory|mood|journal|till|ledger|receipt|invoice|notification)$/;
const PART_TYPES = /^(podcast_supporter_pass|supporter_pass|license|listing_cover)$/;
const WORK_TYPES = /^(music_release|film_release|artwork|album|track|podcast_episode|video|film|animation|poem|poetry|story|novel|essay|writing|photo|photograph|game|world)$/;
const WORK_DOMAINS = /^(music|art|film|poetry|writing|creative-writing|photography|podcast|animation|studio|games?|literature|fashion|dance|theatre|theater)$/;
const SPEC_DOMAINS = /^(engineering|code|cad|architecture|woodworking|welding|carpentry|masonry|plumbing|hvac|electrical|manufacturing|robotics|automotive|aerospace|materials|chem|chemistry|cooking|food|trades|home-improvement|construction|conkay|electronics|3d|maker)$/;
const SPEC_SOURCES = /^(asset-gen|conkay_design|cad\.body|step-import|code-lens|blueprint|user-forge|hubkit|kit|typescript)$/;
const SPEC_TAGS = /^(generated-asset|spec|specs|specification|cad|blueprint|design|schematic|recipe|how-to|howto|bom|datasheet|tolerance|drawing)$/;
// Made things that run or get built: apps, code, blueprints, recipes, formulas.
const SPEC_TYPES = /^(forge_app|app|program|code|blueprint|recipe|formula|craft|evo_asset|skill_recipe|spell_recipe|fighting_style_recipe|design|cad|schematic|kit)$/;
const DOC_SOURCES = /^(file-import|csv-import|upload|text-extraction|pdf|document|docx)$/;
const DOC_MIME = /^(application\/(pdf|msword|vnd\.|rtf|epub)|text\/(plain|csv|markdown))/;
const KNOWLEDGE_KINDS = new Set(["empirical", "hypothesis", "theory", "math_proof", "mega", "hyper", "ingested_corpus"]);

/** The domain the DTU says it is in (not one guessed from its words). */
function declaredDomain(d) {
  const explicit = d?.domain || d?.lens || d?.meta?.domain || d?.meta?.lens;
  if (typeof explicit === "string" && explicit.trim()) return lc(explicit);
  const tag = tagsOf(d).find((t) => t.startsWith("domain:") || t.startsWith("lens:"));
  return tag ? tag.split(":")[1] : "";
}

/** Does the DTU carry real words a reader would read? */
function hasSubstance(d) {
  const core = d?.core || {};
  const n = [d?.human?.summary, d?.cretiHuman, d?.body, d?.content, ...(core.claims || []), ...(core.definitions || [])]
    .filter((x) => typeof x === "string").join(" ").trim().length;
  return n >= 40;
}

/**
 * @returns {{ shelf: string, reason: string, kind: string, origin: string, domain: string }}
 */
export function shelfOf(d) {
  const { kind, origin, domain } = classifyDtu(d || {});
  const src = lc(d?.source);
  const tags = tagsOf(d);
  const mtype = lc(d?.meta?.type || d?.type);
  const vis = lc(d?.visibility || d?.meta?.visibility);
  const title = String(d?.title || "");
  const mime = lc(d?.mimeType || d?.meta?.mimeType || d?.artifact?.mimeType || d?.artifact?.type);
  const out = (shelf, reason) => ({ shelf, reason, kind, origin, domain });

  // system: never browsed unless asked for
  if (lc(d?.kind) === "client_error" || tags.includes("client_error")) return out("system", "an error report");
  if (lc(d?.kind) === "genesis") return out("system", "a genesis anchor");
  if (tags.some((t) => t.startsWith("quarantine:"))) return out("system", "quarantined");
  if (vis === "internal") return out("system", "internal to the system");
  if (d?.shadow === true || /^shadow[_:]/.test(String(d?.id || ""))) return out("system", "a shadow copy");
  if (SYSTEM_SOURCES.test(src)) return out("system", `made by ${src}`);

  // records: someone's own context, not work for others
  if (RECORD_SOURCES.test(src)) return out("records", "personal context");
  if (tags.some((t) => RECORD_TAGS.test(t))) return out("records", "personal context");
  if (/^chat[_-]/.test(mtype) || mtype === "conversation" || mtype === "memory") return out("records", "personal context");

  // parts: pieces that belong to something else
  if (PART_TYPES.test(mtype) || tags.includes("podcast-supporter-pass") || tags.includes("podcast-cover")) return out("parts", "part of a show or listing");
  if (mtype === "media" || d?.mediaType) {
    if (/^(application|text)\//.test(mime) || lc(d?.mediaType) === "document") return out("documents", "an uploaded file");
    return out("parts", `an uploaded ${lc(d?.mediaType) || "media"} file`);
  }
  if (mtype === "artwork" && /^(cover|product photo)\b/i.test(title)) return out("parts", "a cover or product photo");

  // data: snapshots of outside feeds
  if (kind === "feed_snapshot") return out("data", "a live data snapshot");

  // works
  if (WORK_TYPES.test(mtype)) return out("works", mtype.replace(/_/g, " "));
  if (WORK_DOMAINS.test(declaredDomain(d)) && origin === "user") return out("works", `${declaredDomain(d)} work`);

  // documents
  if (DOC_SOURCES.test(src) || DOC_MIME.test(mime) || /\.(pdf|docx?|csv|xlsx?|md|txt)$/i.test(String(d?.originalFilename || d?.meta?.filename || ""))) return out("documents", "a document");

  // specs
  const madeKind = [mtype, lc(d?.kind), lc(d?.meta?.skill_kind), lc(d?.contentType || d?.meta?.contentType)].find((x) => SPEC_TYPES.test(x));
  if (madeKind) return out("specs", madeKind.replace(/_/g, " "));
  if (SPEC_SOURCES.test(src) || tags.some((t) => SPEC_TAGS.test(t))) return out("specs", "a design or spec");
  // A declared domain only: a word-guessed domain ("load" → engineering)
  // would put every explanation of a structure on the specs shelf.
  if (SPEC_DOMAINS.test(declaredDomain(d))) return out("specs", `${declaredDomain(d)}`);

  // knowledge: anything that makes claims or explains, with real words in it
  if (KNOWLEDGE_KINDS.has(kind)) return out("knowledge", kind.replace(/_/g, " "));
  if (origin === "autogen") return out("system", "machine-generated draft");
  if (hasSubstance(d)) return out("knowledge", "an explanation");
  return out("records", "a short note");
}

/** Knowledge that must pass the checks before it can be published. */
export function needsPublishCheck(d) {
  const s = shelfOf(d);
  if (s.shelf === "knowledge") return true;
  // A measured claim needs its check wherever it sits (a spec quoting test
  // results), except finished works and parts. Proof/theory kinds are guessed
  // from words ("proof" in a summary), so they count only on the knowledge shelf.
  return s.kind === "empirical" && !["works", "parts", "records", "system"].includes(s.shelf);
}

/** Shelves no one should publish by accident. */
export function isPrivateShelf(shelf) {
  return shelf === "records" || shelf === "system";
}
