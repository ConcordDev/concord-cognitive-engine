// server/domains/docs-templates.js
//
// Docs Sprint C — template library. CRUD + apply (instantiate a new
// document from a template + bump usage_count). Six built-in templates
// seeded on first list call so the surface isn't empty on day one.

import { randomUUID } from "node:crypto";
import { hasRole, createDocument } from "../lib/docs/persistence.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }

const VALID_CATEGORIES = new Set(["general","meeting","spec","rfc","okr","journal","onboarding","retro","postmortem","plan","custom"]);
const VALID_VIS = new Set(["private","workspace","public"]);

const SEED_TEMPLATES = [
  { id: "tmpl:seed:meeting", name: "Meeting notes", category: "meeting", icon: "📝", description: "Attendees, agenda, decisions, action items.",
    contentHtml: `<h1>Meeting notes</h1><h2>Attendees</h2><ul><li><p>Add names</p></li></ul><h2>Agenda</h2><ol><li><p>Item</p></li></ol><h2>Decisions</h2><ul><li><p>Decision</p></li></ul><h2>Action items</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Who owns what</p></li></ul>`,
  },
  { id: "tmpl:seed:spec", name: "Spec doc", category: "spec", icon: "📄", description: "Problem, proposal, alternatives, risks, plan.",
    contentHtml: `<h1>Spec: …</h1><h2>Problem</h2><p>What's broken? Who's affected? Why now?</p><h2>Proposal</h2><p>The change in two paragraphs.</p><h2>Alternatives considered</h2><ul><li><p>Option A — pros/cons</p></li><li><p>Option B — pros/cons</p></li></ul><h2>Risks &amp; unknowns</h2><ul><li><p>What could go wrong?</p></li></ul><h2>Rollout plan</h2><ol><li><p>Step 1</p></li></ol>`,
  },
  { id: "tmpl:seed:rfc", name: "RFC", category: "rfc", icon: "🧭", description: "Request for Comments — opinionated proposal + decision log.",
    contentHtml: `<h1>RFC-N: …</h1><blockquote><p><strong>Status:</strong> Draft · <strong>Author:</strong> · <strong>Date:</strong></p></blockquote><h2>Summary</h2><p>One paragraph.</p><h2>Motivation</h2><p>Why are we doing this?</p><h2>Detailed design</h2><p>How does it work?</p><h2>Drawbacks</h2><p>What does this cost?</p><h2>Open questions</h2><ul><li><p>?</p></li></ul><h2>Decision log</h2><ul><li><p>YYYY-MM-DD — </p></li></ul>`,
  },
  { id: "tmpl:seed:okr", name: "OKR planning", category: "okr", icon: "🎯", description: "Objectives, key results, owner per KR.",
    contentHtml: `<h1>Q-N OKRs</h1><h2>Objective 1: …</h2><ul><li><p><strong>KR1</strong> — measurable, who owns it</p></li><li><p><strong>KR2</strong> — </p></li><li><p><strong>KR3</strong> — </p></li></ul><h2>Objective 2: …</h2><ul><li><p><strong>KR1</strong> — </p></li></ul>`,
  },
  { id: "tmpl:seed:postmortem", name: "Incident post-mortem", category: "postmortem", icon: "🔥", description: "Blameless write-up + timeline + action items.",
    contentHtml: `<h1>Post-mortem: …</h1><h2>Summary</h2><p>One paragraph — what happened, impact, duration.</p><h2>Impact</h2><ul><li><p>Users affected:</p></li><li><p>Revenue impact:</p></li></ul><h2>Timeline</h2><table><tbody><tr><th>Time</th><th>Event</th></tr><tr><td>HH:MM</td><td></td></tr></tbody></table><h2>Root cause</h2><p>What broke and why.</p><h2>Action items</h2><ul data-type="taskList"><li data-type="taskItem" data-checked="false"><p>Owner — by when</p></li></ul>`,
  },
  { id: "tmpl:seed:journal", name: "Daily journal", category: "journal", icon: "📓", description: "Highlights, what worked, what to try tomorrow.",
    contentHtml: `<h1>Journal — DATE</h1><h2>Highlights</h2><ul><li><p></p></li></ul><h2>What worked</h2><ul><li><p></p></li></ul><h2>What to try tomorrow</h2><ul><li><p></p></li></ul>`,
  },
];

function _seedDefaults(db) {
  // Only seed once; check count.
  try {
    const cnt = db.prepare(`SELECT COUNT(*) AS n FROM doc_templates WHERE owner_id = 'system_seed'`).get().n;
    if (cnt > 0) return;
    const ins = db.prepare(`
      INSERT INTO doc_templates (id, owner_id, name, description, category, content_html, icon, visibility, created_at, updated_at)
      VALUES (?, 'system_seed', ?, ?, ?, ?, ?, 'public', ?, ?)
      ON CONFLICT(id) DO NOTHING
    `);
    const tx = db.transaction((rows) => {
      for (const t of rows) ins.run(t.id, t.name, t.description, t.category, t.contentHtml, t.icon, _now(), _now());
    });
    tx(SEED_TEMPLATES);
  } catch { /* best effort */ }
}

export default function registerDocsTemplatesMacros(register) {

  register("docs", "template_create", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const name = String(input.name || "").trim();
    if (!name) return { ok: false, reason: "name_required" };
    const category = VALID_CATEGORIES.has(input.category) ? input.category : "general";
    const visibility = VALID_VIS.has(input.visibility) ? input.visibility : "private";
    const id = `tmpl:${randomUUID()}`;
    try {
      db.prepare(`
        INSERT INTO doc_templates (id, owner_id, name, description, category, content_html, icon, visibility, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, userId, name.slice(0, 120),
        input.description ? String(input.description).slice(0, 400) : null,
        category,
        String(input.contentHtml || "").slice(0, 1_000_000),
        input.icon ? String(input.icon).slice(0, 8) : null,
        visibility, _now(), _now(),
      );
      return { ok: true, id };
    } catch (err) {
      return { ok: false, reason: "insert_failed", error: err?.message };
    }
  }, { destructive: true, note: "Save a page template for reuse" });

  register("docs", "template_delete", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const r = db.prepare(`DELETE FROM doc_templates WHERE id = ? AND owner_id = ?`).run(id, userId);
    return { ok: r.changes > 0, deleted: r.changes };
  }, { destructive: true, note: "Delete a template (owner only; seed templates protected)" });

  register("docs", "template_list", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    _seedDefaults(db);
    const rows = db.prepare(`
      SELECT id, owner_id, name, description, category, icon, visibility, usage_count, updated_at
      FROM doc_templates
      WHERE owner_id = ? OR visibility IN ('workspace','public')
      ${input.category ? "AND category = ?" : ""}
      ORDER BY (owner_id = ?) DESC, usage_count DESC, updated_at DESC
      LIMIT ?
    `).all(
      userId,
      ...(input.category ? [input.category] : []),
      userId,
      Math.min(Number(input.limit) || 100, 300),
    );
    return { ok: true, templates: rows };
  }, { note: "List templates (mine + workspace + public + seeded defaults)" });

  register("docs", "template_get", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const id = String(input.id || "");
    if (!id) return { ok: false, reason: "id_required" };
    const row = db.prepare(`SELECT * FROM doc_templates WHERE id = ?`).get(id);
    if (!row) return { ok: false, reason: "not_found" };
    if (row.owner_id !== userId && row.owner_id !== "system_seed" && row.visibility === "private") return { ok: false, reason: "forbidden" };
    return { ok: true, template: row };
  }, { note: "Get a template + its content_html" });

  register("docs", "template_apply", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const templateId = String(input.id || input.templateId || "");
    if (!templateId) return { ok: false, reason: "templateId_required" };
    const tmpl = db.prepare(`SELECT * FROM doc_templates WHERE id = ?`).get(templateId);
    if (!tmpl) return { ok: false, reason: "template_not_found" };
    if (tmpl.owner_id !== userId && tmpl.owner_id !== "system_seed" && tmpl.visibility === "private") {
      return { ok: false, reason: "forbidden" };
    }
    // Instantiate as a new doc owned by the caller.
    const r = createDocument(db, {
      ownerId: userId,
      title: input.title || tmpl.name,
      parentId: input.parentId || null,
      kind: "doc",
      visibility: "private",
      icon: tmpl.icon,
      contentHtml: tmpl.content_html,
    });
    if (r.ok) {
      db.prepare(`UPDATE doc_templates SET usage_count = usage_count + 1, updated_at = ? WHERE id = ?`).run(_now(), templateId);
    }
    return r;
  }, { destructive: true, note: "Instantiate a new document from a template" });

  register("docs", "template_save_from_doc", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const documentId = String(input.documentId || "");
    if (!documentId) return { ok: false, reason: "documentId_required" };
    if (!hasRole(db, documentId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const doc = db.prepare(`SELECT title, content_html, icon FROM documents WHERE id = ? AND deleted_at IS NULL`).get(documentId);
    if (!doc) return { ok: false, reason: "doc_not_found" };
    const id = `tmpl:${randomUUID()}`;
    db.prepare(`
      INSERT INTO doc_templates (id, owner_id, name, description, category, content_html, icon, visibility, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id, userId,
      String(input.name || `${doc.title} (template)`).slice(0, 120),
      input.description ? String(input.description).slice(0, 400) : null,
      VALID_CATEGORIES.has(input.category) ? input.category : "general",
      doc.content_html,
      doc.icon,
      VALID_VIS.has(input.visibility) ? input.visibility : "private",
      _now(), _now(),
    );
    return { ok: true, id };
  }, { destructive: true, note: "Save the current doc's structure as a new template" });
}
