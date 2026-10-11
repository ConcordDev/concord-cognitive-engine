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

function spanClaimsMm(text) {
  const out = [];
  const re = /(\d+(?:\.\d+)?)\s*(mm|cm|m|ft|feet|foot)\b/gi;
  let m;
  while ((m = re.exec(String(text || "")))) {
    const n = Number(m[1]);
    const u = m[2].toLowerCase();
    if (u === "mm") out.push(n);
    else if (u === "cm") out.push(n * 10);
    else if (u === "m") out.push(n * 1000);
    else out.push(n * 304.8);
  }
  return out;
}

function conflictsWithSpan(text, lengthMm) {
  return spanClaimsMm(text).some((mm) => Math.abs(mm - lengthMm) > 1);
}

/**
 * A kept beam study's PDF/markdown must quote the solved span, load and
 * stress. A title or summary that names a different span (the prompt) is
 * dropped so the file cannot say "4 m" while the numbers are the 1.2 m run.
 */
export function beamStudySolvedCopy(dtu) {
  const m = dtu?.machine;
  const lengthMm = Number(m?.dims?.length);
  if (m?.kind !== "conkay_beam_study" || !Number.isFinite(lengthMm)) return null;
  const loadN = Number(m.loadN);
  const bits = [`Solved span ${lengthMm} mm.`];
  if (Number.isFinite(loadN)) bits.push(`Solved load ${loadN} N.`);
  if (m.support) bits.push(`Support ${m.support}.`);
  if (m.dims.height != null) bits.push(`Section depth ${m.dims.height} mm.`);
  if (Number.isFinite(Number(m.maxStressMPa))) bits.push(`Max stress ${m.maxStressMPa} MPa.`);
  if (Number.isFinite(Number(m.maxDeflectionMm))) bits.push(`Max deflection ${m.maxDeflectionMm} mm.`);
  if (Number.isFinite(Number(m.utilization))) bits.push(`Utilization ${m.utilization}.`);
  if (typeof m.pass === "boolean") bits.push(m.pass ? "Passes yield." : "Exceeds yield.");
  return {
    lengthMm,
    title: `Solved beam study: ${lengthMm} mm span`,
    text: bits.join(" "),
  };
}

/**
 * Build the same {sections, pageInfo} shape lib/renderers/pdf-renderer.js's
 * renderPDF() expects, from a DTU's human/core/machine layers.
 */
export function dtuToPdfSections(dtu) {
  const sections = [];
  const solved = beamStudySolvedCopy(dtu);
  const title = solved ? solved.title : (dtu.title || "Untitled");
  sections.push({ type: "title", text: title });
  sections.push({ type: "subtitle", text: `${dtu.domain || "concord"} — created ${dtu.createdAt || ""}` });
  if (dtu.tags?.length) {
    sections.push({ type: "meta", fields: [{ label: "Tags", value: dtu.tags.join(", ") }] });
  }

  if (solved) {
    sections.push({ type: "heading", text: "Solved parameters" });
    sections.push({ type: "text", text: solved.text });
  }
  const summary = dtu.human?.summary;
  const summaryConflicts = solved && conflictsWithSpan(summary, solved.lengthMm);
  if (summary && !summaryConflicts) {
    sections.push({ type: "heading", text: "Summary" });
    sections.push({ type: "text", text: summary });
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
      const items = arr
        .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)))
        .filter((v) => !(solved && conflictsWithSpan(v, solved.lengthMm)));
      if (!items.length) continue;
      sections.push({ type: "heading", text: label });
      sections.push({ type: "list", items });
    }
  }

  const machineScalars = scalarEntries(dtu.machine);
  if (machineScalars.length) {
    sections.push({ type: "heading", text: "Details" });
    sections.push({ type: "table", headers: ["Field", "Value"], rows: machineScalars.map(([k, v]) => [k, String(v)]) });
  }

  return { sections, pageInfo: { title, domain: dtu.domain || "concord", generatedAt: new Date().toISOString() } };
}

export function dtuToMarkdown(dtu) {
  const lines = [];
  const solved = beamStudySolvedCopy(dtu);
  lines.push(`# ${solved ? solved.title : (dtu.title || "Untitled")}`);
  lines.push(`**Domain:** ${dtu.domain || "concord"} | **Created:** ${dtu.createdAt || ""}`);
  if (dtu.tags?.length) lines.push(`**Tags:** ${dtu.tags.join(", ")}`);
  lines.push("");
  if (solved) lines.push("## Solved parameters", "", solved.text, "");
  const summary = dtu.human?.summary;
  if (summary && !(solved && conflictsWithSpan(summary, solved.lengthMm))) {
    lines.push("## Summary", "", summary, "");
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
      const items = arr
        .map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v)))
        .filter((v) => !(solved && conflictsWithSpan(v, solved.lengthMm)));
      if (!items.length) continue;
      lines.push(`## ${label}`, "");
      for (const v of items) lines.push(`- ${v}`);
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
