// server/domains/document.js
//
// Real document production for ConKay/Concord chat — PDF/Markdown/JSON/
// CSV/TXT/ZIP, backed by this repo's existing render primitives
// (lib/renderers/pdf-renderer.js's pdfkit wrapper — the SAME one 18
// domains' auto-rendered PDFs already use — and the newly-wired
// lib/renderers/zip-renderer.js, finally putting the long-declared-but-
// unused `adm-zip` dependency to work). Files are stored through the
// existing artifact-store.js (content-addressed, quota/TTL/GC'd) and
// served through the existing GET /api/artifact/:dtuId/download route —
// no new storage or serving mechanism.
//
// document.export_dtu  — render an EXISTING DTU into a chosen file format.
// document.create      — mint a NEW DTU from fresh content (ConKay composing
//                         a spec/blueprint/report on the spot) and render it.
// document.read_zip    — list/read entries from a stored ZIP artifact
//                         ("open and see" for zips — real, no vendored
//                         package needed since adm-zip already reads too).
//
// Honest scope: DOCX (Word) generation has no wired path in this codebase
// (no library, no renderer) — a real gap, not silently faked here. PDF
// *reading* (extracting text from an uploaded/attached PDF) needs PyMuPDF
// vendored through the SAME lib/pyodide-packages.js mechanism the
// numpy/pandas/matplotlib/scipy/sympy work added — not yet added to that
// whitelist. Both are named, scoped follow-ups, not omissions.

import { renderDtuAsFile, DOCUMENT_EXPORT_FORMATS } from "../lib/dtu-document-export.js";
import { listZipEntries, readZipEntryText } from "../lib/renderers/zip-renderer.js";
import { storeArtifact, retrieveArtifact } from "../lib/artifact-store.js";

function canReadDtu(dtu, userId) {
  if (!dtu) return false;
  if (!dtu.ownerId) return true; // system/no-owner DTUs
  if (dtu.ownerId === userId) return true;
  if (dtu.ownerId === "anon" || dtu.ownerId === "system") return true;
  return dtu.visibility === "public";
}

export default function registerDocumentActions(register) {
  register("document", "export_dtu", async (ctx, input = {}) => {
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: false, error: "no_dtu_store" };
    const dtuId = String(input.dtuId || "");
    if (!dtuId) return { ok: false, error: "dtuId required" };
    const dtu = STATE.dtus.get(dtuId);
    if (!dtu) return { ok: false, error: "dtu_not_found" };
    const userId = ctx?.actor?.userId || ctx?.actor?.id || "anon";
    if (!canReadDtu(dtu, userId)) return { ok: false, error: "forbidden" };

    const rendered = await renderDtuAsFile(dtu, input.format);
    if (!rendered.ok) return rendered;

    // Store the export as its own artifact-bearing DTU rather than
    // overwriting the source DTU's `.artifact` (which may already hold
    // different content — e.g. an uploaded image). Real DTU, real
    // provenance link back to the source, no fabricated success.
    const exportDtu = {
      id: `dtu_export_${dtuId}_${Date.now().toString(36)}`,
      title: `${dtu.title || "Document"} (${rendered.filename})`,
      tags: ["document_export", ...(dtu.tags || []).slice(0, 5)],
      tier: "regular",
      source: "document_export",
      ownerId: userId,
      visibility: dtu.visibility === "public" ? "public" : "private",
      human: { summary: `Exported from "${dtu.title || dtuId}" as ${rendered.mimeType}.`, bullets: [] },
      core: { definitions: [], invariants: [], examples: [], claims: [], nextActions: [] },
      machine: { kind: "document_export", sourceDtuId: dtuId, format: rendered.mimeType },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      domain: "document",
    };
    const ref = await storeArtifact(exportDtu.id, rendered.buffer, rendered.mimeType, rendered.filename);
    exportDtu.artifact = ref;
    STATE.dtus.set(exportDtu.id, exportDtu);
    if (typeof globalThis._concordSaveStateDebounced === "function") globalThis._concordSaveStateDebounced();

    return {
      ok: true,
      dtuId: exportDtu.id,
      sourceDtuId: dtuId,
      filename: rendered.filename,
      mimeType: rendered.mimeType,
      sizeBytes: ref.sizeBytes,
      downloadUrl: `/api/artifact/${exportDtu.id}/download`,
    };
  }, { note: `Render an existing DTU into a real downloadable file. Formats: ${DOCUMENT_EXPORT_FORMATS.join(", ")}.` });

  register("document", "create", async (ctx, input = {}) => {
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: false, error: "no_dtu_store" };
    const title = String(input.title || "Untitled Document");
    const userId = ctx?.actor?.userId || ctx?.actor?.id || "anon";

    let files = null;
    if (String(input.format || "").toLowerCase() === "zip" && Array.isArray(input.files) && input.files.length) {
      files = input.files.map((f) => ({ name: String(f?.name || "file.txt"), content: f?.content ?? "" }));
    }

    const dtu = {
      id: `dtu_doc_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
      title,
      tags: Array.isArray(input.tags) ? input.tags.map(String) : ["document"],
      tier: "regular",
      source: "document_create",
      ownerId: userId,
      visibility: "private",
      human: { summary: String(input.summary || input.content || "").slice(0, 2000), bullets: Array.isArray(input.bullets) ? input.bullets : [] },
      core: {
        definitions: [], invariants: [], examples: [],
        claims: Array.isArray(input.claims) ? input.claims : [],
        nextActions: [],
      },
      machine: { kind: "document" },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      domain: "document",
    };

    let rendered;
    if (files) {
      const { renderZip } = await import("../lib/renderers/zip-renderer.js");
      const { slugify } = await import("../lib/render-engine.js");
      rendered = { ok: true, buffer: renderZip(files), mimeType: "application/zip", filename: `${slugify(title)}.zip` };
    } else {
      rendered = await renderDtuAsFile(dtu, input.format);
    }
    if (!rendered.ok) return rendered;

    const ref = await storeArtifact(dtu.id, rendered.buffer, rendered.mimeType, rendered.filename);
    dtu.artifact = ref;
    STATE.dtus.set(dtu.id, dtu);
    if (typeof globalThis._concordSaveStateDebounced === "function") globalThis._concordSaveStateDebounced();

    return {
      ok: true,
      dtuId: dtu.id,
      filename: rendered.filename,
      mimeType: rendered.mimeType,
      sizeBytes: ref.sizeBytes,
      downloadUrl: `/api/artifact/${dtu.id}/download`,
    };
  }, { note: `Create a brand-new document from fresh content (a spec, blueprint, report) and render it as a real file. Formats: ${DOCUMENT_EXPORT_FORMATS.join(", ")}. For zip: pass files:[{name,content}].` });

  register("document", "read_zip", async (ctx, input = {}) => {
    const STATE = globalThis._concordSTATE;
    if (!STATE?.dtus) return { ok: false, error: "no_dtu_store" };
    const dtuId = String(input.dtuId || "");
    if (!dtuId) return { ok: false, error: "dtuId required" };
    const dtu = STATE.dtus.get(dtuId);
    if (!dtu) return { ok: false, error: "dtu_not_found" };
    const userId = ctx?.actor?.userId || ctx?.actor?.id || "anon";
    if (!canReadDtu(dtu, userId)) return { ok: false, error: "forbidden" };
    if (!dtu.artifact) return { ok: false, error: "no_artifact_on_dtu" };
    if (dtu.machine?.format !== "application/zip" && dtu.artifact?.type !== "application/zip") {
      return { ok: false, error: "not_a_zip_artifact" };
    }

    const buffer = retrieveArtifact(dtuId, dtu.artifact);
    if (!buffer) return { ok: false, error: "artifact_unreadable" };
    const entries = listZipEntries(buffer);

    const entryName = input.entryName ? String(input.entryName) : null;
    if (entryName) {
      const text = readZipEntryText(buffer, entryName);
      if (text == null) return { ok: false, error: "entry_not_found", entries: entries.map((e) => e.name) };
      return { ok: true, entries, entryName, text: text.slice(0, 50_000) };
    }
    return { ok: true, entries };
  }, { note: "List entries in a stored zip artifact, or read one entry's text content when entryName is given." });
}
