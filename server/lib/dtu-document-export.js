/**
 * DTU Document Export — converts a real DTU (human/core/machine layers) into
 * a real downloadable file (PDF/Markdown/JSON/CSV/ZIP), reusing this repo's
 * existing render primitives (renderPDF from lib/renderers/pdf-renderer.js —
 * the SAME pdfkit wrapper 18 domains' auto-rendered PDFs already go through
 * — and lib/renderers/zip-renderer.js) rather than inventing a parallel
 * rendering path.
 *
 * Distinct from `lens.export` (server.js) — that macro operates on
 * STATE.lensArtifacts (the ~106-domain "lens artifact" data structure) and
 * returns unrendered MARKUP for a client-side PDF renderer, never a stored
 * file. This module operates on DTUs (STATE.dtus — human/core/machine
 * layers) and always produces a REAL file buffer via storeArtifact, because
 * the caller here (ConKay/chat's agent loop, via chat-agent.js's
 * export_dtu/create_document tools) has no browser to hand markup to.
 */

import { renderPDF } from "./renderers/pdf-renderer.js";
import { renderZip } from "./renderers/zip-renderer.js";
import { slugify } from "./render-engine.js";

export const DOCUMENT_EXPORT_FORMATS = Object.freeze(["pdf", "md", "markdown", "json", "csv", "txt", "zip"]);

function scalarEntries(obj) {
  return Object.entries(obj || {}).filter(([, v]) => v !== null && v !== undefined && typeof v !== "object");
}

/**
 * Build the same {sections, pageInfo} shape lib/renderers/pdf-renderer.js's
 * renderPDF() expects, from a DTU's human/core/machine layers.
 */
export function dtuToPdfSections(dtu) {
  const sections = [];
  sections.push({ type: "title", text: dtu.title || "Untitled" });
  sections.push({ type: "subtitle", text: `${dtu.domain || "concord"} — created ${dtu.createdAt || ""}` });
  if (dtu.tags?.length) {
    sections.push({ type: "meta", fields: [{ label: "Tags", value: dtu.tags.join(", ") }] });
  }

  if (dtu.human?.summary) {
    sections.push({ type: "heading", text: "Summary" });
    sections.push({ type: "text", text: dtu.human.summary });
  }
  if (dtu.human?.bullets?.length) {
    sections.push({ type: "list", items: dtu.human.bullets });
  }

  const coreSections = [
    ["claims", "Claims"], ["definitions", "Definitions"], ["invariants", "Invariants"],
    ["examples", "Examples"], ["nextActions", "Next Actions"],
  ];
  for (const [key, label] of coreSections) {
    const arr = dtu.core?.[key];
    if (arr?.length) {
      sections.push({ type: "heading", text: label });
      sections.push({ type: "list", items: arr.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))) });
    }
  }

  const machineScalars = scalarEntries(dtu.machine);
  if (machineScalars.length) {
    sections.push({ type: "heading", text: "Details" });
    sections.push({ type: "table", headers: ["Field", "Value"], rows: machineScalars.map(([k, v]) => [k, String(v)]) });
  }

  return { sections, pageInfo: { title: dtu.title, domain: dtu.domain || "concord", generatedAt: new Date().toISOString() } };
}

export function dtuToMarkdown(dtu) {
  const lines = [];
  lines.push(`# ${dtu.title || "Untitled"}`);
  lines.push(`**Domain:** ${dtu.domain || "concord"} | **Created:** ${dtu.createdAt || ""}`);
  if (dtu.tags?.length) lines.push(`**Tags:** ${dtu.tags.join(", ")}`);
  lines.push("");
  if (dtu.human?.summary) {
    lines.push("## Summary", "", dtu.human.summary, "");
  }
  if (dtu.human?.bullets?.length) {
    for (const b of dtu.human.bullets) lines.push(`- ${b}`);
    lines.push("");
  }
  const coreSections = [
    ["claims", "Claims"], ["definitions", "Definitions"], ["invariants", "Invariants"],
    ["examples", "Examples"], ["nextActions", "Next Actions"],
  ];
  for (const [key, label] of coreSections) {
    const arr = dtu.core?.[key];
    if (arr?.length) {
      lines.push(`## ${label}`, "");
      for (const v of arr) lines.push(`- ${typeof v === "object" ? JSON.stringify(v) : String(v)}`);
      lines.push("");
    }
  }
  return lines.join("\n");
}

export function dtuToJson(dtu) {
  return JSON.stringify({
    id: dtu.id, title: dtu.title, domain: dtu.domain, tags: dtu.tags,
    createdAt: dtu.createdAt, updatedAt: dtu.updatedAt,
    human: dtu.human, core: dtu.core, machine: dtu.machine,
  }, null, 2);
}

/** Rows: one DTU per row, scalar core/human fields flattened into columns. */
export function dtusToCsv(dtus) {
  const rows = [["id", "title", "domain", "createdAt", "tags", "summary"]];
  for (const dtu of dtus) {
    rows.push([
      dtu.id, dtu.title || "", dtu.domain || "", dtu.createdAt || "",
      (dtu.tags || []).join(";"), (dtu.human?.summary || "").replace(/\n/g, " "),
    ]);
  }
  return rows.map((r) => r.map(csvEscape).join(",")).join("\n");
}

function csvEscape(val) {
  const s = String(val ?? "");
  return s.includes(",") || s.includes('"') || s.includes("\n") ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * Render a single DTU into a real file buffer. Never throws — returns
 * {ok:false, error} for an unsupported format rather than guessing one.
 * @param {object} dtu
 * @param {string} format — one of DOCUMENT_EXPORT_FORMATS
 */
export async function renderDtuAsFile(dtu, format) {
  const fmt = String(format || "pdf").toLowerCase();
  const base = slugify(dtu.title || dtu.id || "document");
  if (fmt === "pdf") {
    const { sections, pageInfo } = dtuToPdfSections(dtu);
    const buffer = await renderPDF(sections, pageInfo);
    return { ok: true, buffer, mimeType: "application/pdf", filename: `${base}.pdf` };
  }
  if (fmt === "md" || fmt === "markdown") {
    return { ok: true, buffer: Buffer.from(dtuToMarkdown(dtu), "utf-8"), mimeType: "text/markdown", filename: `${base}.md` };
  }
  if (fmt === "json") {
    return { ok: true, buffer: Buffer.from(dtuToJson(dtu), "utf-8"), mimeType: "application/json", filename: `${base}.json` };
  }
  if (fmt === "txt") {
    return { ok: true, buffer: Buffer.from(dtuToMarkdown(dtu), "utf-8"), mimeType: "text/plain", filename: `${base}.txt` };
  }
  if (fmt === "csv") {
    return { ok: true, buffer: Buffer.from(dtusToCsv([dtu]), "utf-8"), mimeType: "text/csv", filename: `${base}.csv` };
  }
  if (fmt === "zip") {
    const buffer = renderZip([
      { name: `${base}.md`, content: dtuToMarkdown(dtu) },
      { name: `${base}.json`, content: dtuToJson(dtu) },
    ]);
    return { ok: true, buffer, mimeType: "application/zip", filename: `${base}.zip` };
  }
  return { ok: false, error: "unsupported_format", supportedFormats: DOCUMENT_EXPORT_FORMATS };
}
