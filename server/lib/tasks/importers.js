// server/lib/tasks/importers.js
//
// CSV importers for Linear / Jira / Asana exports. Each importer
// returns a normalised TaskRow shape: { title, description, status,
// priority, assignee, labels, dueAt, estimate, type, parentKey,
// externalKey }. The caller maps these into createTask + sets
// dependencies on a second pass once all PROJ-N keys exist.

function _splitCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ",") { out.push(cur); cur = ""; }
      else { cur += c; }
    }
  }
  out.push(cur);
  return out;
}

export function parseCsv(text) {
  if (!text) return { headers: [], rows: [] };
  const lines = text.replace(/\r\n?/g, "\n").split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = _splitCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
  const rows = lines.slice(1).map((l) => {
    const cells = _splitCsvLine(l);
    const row = {};
    for (let i = 0; i < headers.length; i++) row[headers[i]] = (cells[i] || "").trim();
    return row;
  });
  return { headers, rows };
}

function _firstOf(row, ...keys) {
  for (const k of keys) {
    if (row[k] != null && row[k] !== "") return row[k];
  }
  return null;
}

function _normPriority(p) {
  const x = String(p || "").toLowerCase();
  if (/urgent|p0|sev1|critical/.test(x)) return "urgent";
  if (/high|p1|major/.test(x)) return "high";
  if (/medium|med|p2|normal/.test(x)) return "medium";
  if (/low|p3|minor/.test(x)) return "low";
  if (/none|trivial|p4/.test(x)) return "none";
  return "medium";
}

function _normType(t) {
  const x = String(t || "").toLowerCase();
  if (/bug|defect/.test(x)) return "bug";
  if (/feature|enhancement/.test(x)) return "feature";
  if (/epic/.test(x)) return "epic";
  if (/story|user story/.test(x)) return "story";
  if (/spike|research/.test(x)) return "spike";
  if (/chore|task/.test(x)) return "task";
  return "task";
}

function _normStatus(s) {
  const x = String(s || "").toLowerCase();
  if (/done|closed|completed|resolved/.test(x)) return "st:done";
  if (/cancel/.test(x)) return "st:cancelled";
  if (/review/.test(x)) return "st:in_review";
  if (/progress|in progress|doing|started/.test(x)) return "st:in_progress";
  if (/todo|open|backlog/.test(x)) return "st:todo";
  return "st:backlog";
}

function _parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  if (!Number.isFinite(d.getTime())) return null;
  return Math.floor(d.getTime() / 1000);
}

function _splitLabels(s) {
  if (!s) return [];
  return String(s).split(/[;,]+/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
}

/**
 * Detect which provider produced this CSV by checking for telltale
 * columns. Falls back to a best-guess "generic" if none match.
 */
export function detectProvider(headers) {
  const set = new Set(headers.map((h) => h.toLowerCase()));
  if (set.has("id") && (set.has("title") || set.has("issue title")) && (set.has("estimate") || set.has("status"))) return "linear";
  if (set.has("issue key") || set.has("summary")) return "jira";
  if (set.has("task name") || (set.has("name") && set.has("assignee") && set.has("section/column"))) return "asana";
  return "generic";
}

export function normaliseRows(rows, provider) {
  return rows.map((row) => {
    // Common across providers
    const title = String(_firstOf(row, "title", "issue title", "task name", "name", "summary") || "").trim();
    if (!title) return null;
    const description = String(_firstOf(row, "description", "notes") || "");
    const status = _normStatus(_firstOf(row, "status", "state", "section/column"));
    const priority = _normPriority(_firstOf(row, "priority"));
    const assignee = String(_firstOf(row, "assignee", "assignees", "assigned to") || "").split(/[,;]/)[0]?.trim() || null;
    const labels = _splitLabels(_firstOf(row, "labels", "tags"));
    const dueAt = _parseDate(_firstOf(row, "due date", "due", "due_at"));
    const estimateRaw = _firstOf(row, "estimate", "story points", "points", "estimate_minutes");
    const estimate = estimateRaw ? Number(estimateRaw) : null;
    const type = _normType(_firstOf(row, "type", "issue type"));
    const externalKey = String(_firstOf(row, "id", "key", "issue key", "task id") || "").trim() || null;
    const parentKey = String(_firstOf(row, "parent id", "parent key", "parent", "parent task") || "").trim() || null;

    return {
      title, description, status, priority, assignee, labels,
      dueAt, estimate: Number.isFinite(estimate) ? estimate : null,
      type, externalKey, parentKey,
      provider,
    };
  }).filter(Boolean);
}

/**
 * Full pipeline: text → { provider, rows[] } ready for createTask
 * fan-out by the importer macro.
 */
export function importCsv(text) {
  const { headers, rows } = parseCsv(text);
  if (rows.length === 0) return { ok: false, reason: "empty_csv" };
  const provider = detectProvider(headers);
  const normalised = normaliseRows(rows, provider);
  if (normalised.length === 0) return { ok: false, reason: "no_valid_rows" };
  return { ok: true, provider, headers, rows: normalised };
}
