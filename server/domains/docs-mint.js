// server/domains/docs-mint.js
//
// Docs Sprint C — the concord-native moat. Mint a document as a
// citable DTU; cite cross-lens DTUs from within a doc so the royalty
// cascade fires through the existing economy engine; export a doc
// as a portable DTU pack with royalty inheritance metadata.
//
// Why this matters: Notion, Google Docs, and Lex can't pay creators
// when a paragraph from one doc is reused in another doc. Concord
// can — every doc is a DTU, every cross-lens cite is a registered
// citation, every downstream sale walks the ancestor chain. Sprint A
// already built the substrate (documents + dtu_citations exists in
// the economy_ledger). This sprint connects them.

import { randomUUID } from "node:crypto";
import { hasRole, getDocument } from "../lib/docs/persistence.js";
import { htmlToMarkdown } from "../lib/docs/markdown.js";

function _resolveDb(ctx) { return ctx?.db || ctx?.STATE?.db || globalThis._concordSTATE?.db || null; }
function _actor(ctx) { return ctx?.actor?.userId || ctx?.userId || null; }
function _now() { return Math.floor(Date.now() / 1000); }

const VALID_VIS = new Set(["private","workspace","public","published","global"]);
const DEFAULT_ROYALTY = 0.21; // matches creative-marketplace-constants INITIAL_ROYALTY_RATE

export default function registerDocsMintMacros(register) {

  register("docs", "mint_as_dtu", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const documentId = String(input.documentId || input.id || "");
    if (!documentId) return { ok: false, reason: "documentId_required" };
    if (!hasRole(db, documentId, userId, "admin")) return { ok: false, reason: "forbidden" };
    const doc = getDocument(db, documentId);
    if (!doc) return { ok: false, reason: "doc_not_found" };

    // Idempotent: if already minted, return existing.
    const existing = db.prepare(`SELECT * FROM doc_mints WHERE document_id = ?`).get(documentId);
    if (existing) return { ok: true, dtuId: existing.dtu_id, alreadyMinted: true };

    const visibility = VALID_VIS.has(input.visibility) ? input.visibility : "workspace";
    const royaltyRate = typeof input.royaltyRate === "number"
      ? Math.max(0, Math.min(0.30, input.royaltyRate))
      : DEFAULT_ROYALTY;
    const allowCitation = input.allowCitation !== false;

    const dtuId = `document:${randomUUID()}`;
    try {
      const tx = db.transaction(() => {
        // Mint the DTU. Use 'document' kind so the marketplace + cite UIs
        // know the shape. Body is the markdown mirror; HTML stays in the
        // doc table for editor reads.
        db.prepare(`
          INSERT INTO dtus (id, kind, title, creator_id, meta_json, created_at)
          VALUES (?, 'document', ?, ?, ?, unixepoch())
        `).run(dtuId, doc.title, userId, JSON.stringify({
          type: "document",
          document_id: documentId,
          word_count: doc.word_count,
          visibility,
          royalty_rate: royaltyRate,
          allow_citation: allowCitation,
          markdown_preview: (doc.content_md || htmlToMarkdown(doc.content_html)).slice(0, 4000),
        }));
        db.prepare(`
          INSERT INTO doc_mints (document_id, dtu_id, creator_id, royalty_rate, visibility, allow_citation, minted_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(documentId, dtuId, userId, royaltyRate, visibility, allowCitation ? 1 : 0, _now());
      });
      tx();
      return { ok: true, dtuId, royaltyRate, visibility };
    } catch (err) {
      return { ok: false, reason: "mint_failed", error: err?.message };
    }
  }, { destructive: true, note: "Mint a document as a citable DTU (admin+)" });

  register("docs", "mint_status", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const documentId = String(input.documentId || input.id || "");
    if (!documentId) return { ok: false, reason: "documentId_required" };
    if (!hasRole(db, documentId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const m = db.prepare(`SELECT * FROM doc_mints WHERE document_id = ?`).get(documentId);
    return { ok: true, minted: !!m, mint: m || null };
  }, { note: "Check whether a document has been minted as a DTU" });

  // Cross-lens cite: insert a citation from THIS doc (must be minted)
  // to a referenced DTU. Routes through the existing royalty-cascade
  // engine so downstream sales walk the ancestor chain correctly.
  register("docs", "cite_dtu", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const documentId = String(input.documentId || "");
    const parentDtuId = String(input.dtuId || input.parentDtuId || "");
    if (!documentId || !parentDtuId) return { ok: false, reason: "documentId_and_dtuId_required" };
    if (!hasRole(db, documentId, userId, "editor")) return { ok: false, reason: "forbidden" };

    // Doc must be minted to be a citation source.
    const mint = db.prepare(`SELECT dtu_id, creator_id FROM doc_mints WHERE document_id = ?`).get(documentId);
    if (!mint) return { ok: false, reason: "doc_not_minted_yet" };
    const parentDtu = db.prepare(`SELECT id, creator_id, kind, meta_json FROM dtus WHERE id = ?`).get(parentDtuId);
    if (!parentDtu) return { ok: false, reason: "parent_dtu_not_found" };

    // Route through the real cascade engine — lazy-import so this module
    // stays loadable for tests that don't seed the economy schema.
    try {
      const { registerCitation } = await import("../economy/royalty-cascade.js");
      const r = registerCitation(db, {
        childId: mint.dtu_id,
        parentId: parentDtu.id,
        creatorId: mint.creator_id,
        parentCreatorId: parentDtu.creator_id,
        parentDtu, hasPurchasedLicense: !!input.hasPurchasedLicense,
        generation: 1,
      });
      if (!r.ok) return r;
      db.prepare(`UPDATE doc_mints SET citation_count = citation_count + 1 WHERE document_id = ?`).run(documentId);
      return { ok: true, childDtuId: mint.dtu_id, parentDtuId: parentDtu.id, cascade: r };
    } catch (err) {
      // Engine missing or schema absent — degrade to a soft "noted" so
      // dev databases (which often lack the full economy schema) still
      // surface the link in the UI.
      return { ok: true, childDtuId: mint.dtu_id, parentDtuId, cascade: { ok: false, reason: "engine_unavailable", error: err?.message } };
    }
  }, { destructive: true, note: "Cite a cross-lens DTU from a minted document (fires royalty cascade)" });

  register("docs", "cited_dtus", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const documentId = String(input.documentId || "");
    if (!documentId) return { ok: false, reason: "documentId_required" };
    if (!hasRole(db, documentId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const mint = db.prepare(`SELECT dtu_id FROM doc_mints WHERE document_id = ?`).get(documentId);
    if (!mint) return { ok: true, citations: [], minted: false };
    // Reads from dtu_citations + dtus to enrich with parent title/kind.
    try {
      const rows = db.prepare(`
        SELECT c.parent_id, c.generation, c.royalty_rate, c.created_at,
               d.title AS parent_title, d.kind AS parent_kind, d.creator_id AS parent_creator
        FROM dtu_citations c
        LEFT JOIN dtus d ON d.id = c.parent_id
        WHERE c.child_id = ?
        ORDER BY c.created_at DESC LIMIT 200
      `).all(mint.dtu_id);
      return { ok: true, citations: rows, minted: true };
    } catch {
      return { ok: true, citations: [], minted: true, note: "dtu_citations table not present" };
    }
  }, { note: "List DTUs this minted doc cites (with cascade metadata)" });

  // DTU export: produce a portable JSON envelope containing the doc
  // body + its citation ancestry chain + royalty inheritance metadata.
  // Useful for cross-instance moves and for the agent marketplace.
  register("docs", "export_dtu_pack", async (ctx, input = {}) => {
    const db = _resolveDb(ctx);
    const userId = _actor(ctx);
    if (!db || !userId) return { ok: false, reason: "auth_required" };
    const documentId = String(input.documentId || input.id || "");
    if (!documentId) return { ok: false, reason: "documentId_required" };
    if (!hasRole(db, documentId, userId, "viewer")) return { ok: false, reason: "forbidden" };
    const doc = getDocument(db, documentId);
    if (!doc) return { ok: false, reason: "not_found" };
    const mint = db.prepare(`SELECT * FROM doc_mints WHERE document_id = ?`).get(documentId);
    let ancestors = [];
    if (mint) {
      try {
        const { getAncestorChain } = await import("../economy/royalty-cascade.js");
        ancestors = getAncestorChain(db, mint.dtu_id) || [];
      } catch { /* engine absent — ship without ancestry */ }
    }
    const pack = {
      spec: "concord-doc-pack/v1",
      exported_at: _now(),
      exported_by: userId,
      document: {
        id: doc.id,
        title: doc.title,
        icon: doc.icon,
        kind: doc.kind,
        word_count: doc.word_count,
        content_html: doc.content_html,
        content_md: doc.content_md || htmlToMarkdown(doc.content_html),
      },
      mint: mint ? {
        dtu_id: mint.dtu_id,
        creator_id: mint.creator_id,
        royalty_rate: mint.royalty_rate,
        visibility: mint.visibility,
        allow_citation: !!mint.allow_citation,
        minted_at: mint.minted_at,
      } : null,
      ancestry: ancestors,
    };
    return {
      ok: true,
      pack,
      filename: `${(doc.title || "untitled").replace(/[^a-z0-9-]+/gi, "-")}.cnd.json`,
    };
  }, { note: "Export a doc as a portable DTU pack with royalty inheritance metadata" });
}
