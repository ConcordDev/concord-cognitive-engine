// server/routes/universal-export.js
// DTU export/import API routes for the universal DTU bridge.
// Includes zero-friction universal import (any file → DTU) and
// universal export (DTU → any format).

import { Router } from "express";
import { lensDataToDTU, wrapFormatAsDTU, exportDTUAs, inspectDTU } from "../lib/universal-dtu-bridge.js";
import { asyncHandler } from "../lib/async-handler.js";

// ── MIME → media category mapping ────────────────────────────────────────
const MIME_CATEGORY_MAP = {
  // Audio
  "audio/mpeg": "audio", "audio/wav": "audio", "audio/ogg": "audio",
  "audio/flac": "audio", "audio/aac": "audio", "audio/webm": "audio",
  "audio/x-wav": "audio", "audio/mp4": "audio",
  // Video
  "video/mp4": "video", "video/webm": "video", "video/ogg": "video",
  "video/quicktime": "video", "video/x-matroska": "video",
  // Image
  "image/png": "image", "image/jpeg": "image", "image/gif": "image",
  "image/webp": "image", "image/svg+xml": "image", "image/avif": "image",
  // Document
  "application/pdf": "document", "text/plain": "document",
  "text/markdown": "document", "text/html": "document",
  "application/epub+zip": "document",
  // Data
  "application/json": "data", "text/csv": "data",
  "application/xml": "data", "text/xml": "data",
  "application/x-yaml": "data", "text/yaml": "data",
  // Code
  "text/javascript": "code", "application/javascript": "code",
  "text/x-python": "code", "text/x-rust": "code",
  "text/x-go": "code", "text/x-java": "code",
  "text/typescript": "code",
  // Archive
  "application/zip": "archive", "application/gzip": "archive",
  "application/x-tar": "archive",
  // 3D
  "model/gltf-binary": "3d", "model/gltf+json": "3d",
};

// Extension → category fallback (for when MIME is generic)
const EXT_CATEGORY_MAP = {
  ".mp3": "audio", ".wav": "audio", ".ogg": "audio", ".flac": "audio",
  ".aac": "audio", ".m4a": "audio", ".wma": "audio",
  ".mp4": "video", ".webm": "video", ".mov": "video", ".mkv": "video",
  ".avi": "video", ".wmv": "video",
  ".png": "image", ".jpg": "image", ".jpeg": "image", ".gif": "image",
  ".webp": "image", ".svg": "image", ".avif": "image", ".bmp": "image",
  ".pdf": "document", ".txt": "document", ".md": "document",
  ".doc": "document", ".docx": "document", ".epub": "document",
  ".rtf": "document", ".odt": "document",
  ".json": "data", ".csv": "data", ".xml": "data", ".yaml": "data",
  ".yml": "data", ".toml": "data",
  ".js": "code", ".ts": "code", ".py": "code", ".rs": "code",
  ".go": "code", ".java": "code", ".c": "code", ".cpp": "code",
  ".h": "code", ".rb": "code", ".php": "code", ".swift": "code",
  ".kt": "code", ".cs": "code", ".sql": "code", ".sh": "code",
  ".zip": "archive", ".gz": "archive", ".tar": "archive",
  ".rar": "archive", ".7z": "archive",
  ".glb": "3d", ".gltf": "3d", ".obj": "3d", ".fbx": "3d",
  ".dtu": "dtu",
};

// Category → DTU primary type
const CATEGORY_PRIMARY_TYPE = {
  audio: "audio", video: "video", image: "image",
  document: "document", data: "dataset", code: "code",
  archive: "mixed_content", "3d": "3d_model", dtu: "condensed_knowledge",
};

function detectCategory(mimeType, filename) {
  if (mimeType && MIME_CATEGORY_MAP[mimeType]) return MIME_CATEGORY_MAP[mimeType];
  const ext = (filename || "").match(/(\.[^.]+)$/)?.[1]?.toLowerCase();
  if (ext && EXT_CATEGORY_MAP[ext]) return EXT_CATEGORY_MAP[ext];
  return "document"; // safe default
}

function detectPrimaryType(category) {
  return CATEGORY_PRIMARY_TYPE[category] || "document";
}

// Format extension for export filename
const FORMAT_EXTENSIONS = {
  json: ".json", csv: ".csv", markdown: ".md", md: ".md",
  text: ".txt", txt: ".txt", xml: ".xml", yaml: ".yaml",
  pdf: ".pdf", dtu: ".dtu",
};

export default function createUniversalExportRouter(STATE, runMacro, makeCtx) {
  const router = Router();

  // POST /api/lens/:domain/export-dtu — Export lens artifact as .dtu file
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/api/lens/:domain/export-dtu", asyncHandler(async (req, res) => {
    try {
      const { domain } = req.params;
      const { data, title, tags, format } = req.body || {};
      if (!data) return res.status(400).json({ ok: false, error: "Missing 'data' field" });

      const result = lensDataToDTU(domain, data, { title, tags, format });
      res.set("Content-Type", "application/octet-stream");
      res.set("Content-Disposition", `attachment; filename="${domain}-export.dtu"`);
      res.send(Buffer.from(result.buffer));
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }));

  // POST /api/lens/:domain/import-dtu — Import .dtu file into lens
  router.post("/api/lens/:domain/import-dtu", asyncHandler(async (req, res) => {
    try {
      const { domain } = req.params;

      // Accept raw binary body (Content-Type: application/octet-stream)
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      if (buffer.length < 48) return res.status(400).json({ ok: false, error: "Invalid DTU file (too small)" });

      const inspection = inspectDTU(buffer);
      if (!inspection.ok) return res.status(400).json({ ok: false, error: `Invalid DTU: ${inspection.error}` });

      // Create a DTU in the system from the imported file
      const ctx = makeCtx(req);
      const dtu = await runMacro("dtu", "create", {
        title: inspection.metadata.title || `Import into ${domain}`,
        tags: [...(inspection.metadata.tags || []), domain, "imported"],
        source: "dtu-import",
        meta: {
          importedFrom: "dtu-file",
          importedAt: new Date().toISOString(),
          originalDomain: inspection.metadata.domain,
          fileSize: buffer.length,
        },
      }, ctx);

      res.json({ ok: true, imported: true, dtuId: dtu?.id, metadata: inspection.metadata });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }));

  // POST /api/convert/to-dtu — Convert any format to DTU
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/api/convert/to-dtu", asyncHandler(async (req, res) => {
    try {
      const { format, data, title, domain, tags } = req.body || {};
      if (!format || !data) return res.status(400).json({ ok: false, error: "Missing 'format' and 'data' fields" });

      const result = wrapFormatAsDTU(format, data, { title, domain, tags });
      res.set("Content-Type", "application/octet-stream");
      res.set("Content-Disposition", `attachment; filename="converted.dtu"`);
      res.send(Buffer.from(result.buffer));
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }));

  // POST /api/convert/from-dtu — Convert DTU to any format
  // AUTH: prod-write-mw — productionWriteAuthMiddleware (server.js:5808) enforces req.user for all writes in production
  router.post("/api/convert/from-dtu", asyncHandler(async (req, res) => {
    try {
      const { targetFormat } = req.body || {};
      if (!targetFormat) return res.status(400).json({ ok: false, error: "Missing 'targetFormat' field" });

      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const buffer = Buffer.concat(chunks);

      if (buffer.length < 48) return res.status(400).json({ ok: false, error: "Invalid DTU file" });

      const result = exportDTUAs(buffer, targetFormat);
      res.set("Content-Type", result.mimeType || "application/json");
      res.json({ ok: true, ...result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }));

  // ══════════════════════════════════════════════════════════════════════
  // UNIVERSAL IMPORT — Any file → DTU (zero friction)
  // ══════════════════════════════════════════════════════════════════════

  // POST /api/import/universal — Drop any file, get a DTU back
  // Accepts JSON body with: { filename, mimeType, data (base64), title?, tags?, domain?, destination? }
  router.post("/api/import/universal", asyncHandler(async (req, res) => {
    try {
      const {
        filename, mimeType, data, title, tags = [],
        domain, destination,
      } = req.body || {};

      if (!data) return res.status(400).json({ ok: false, error: "Missing 'data' field (base64-encoded file content)" });
      if (!filename) return res.status(400).json({ ok: false, error: "Missing 'filename'" });

      const fileBuffer = Buffer.from(data, "base64");
      const category = detectCategory(mimeType, filename);
      const primaryType = detectPrimaryType(category);
      const nameWithoutExt = filename.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
      const effectiveTitle = title || nameWithoutExt;
      const effectiveDomain = domain || (category === "audio" ? "music" : category === "image" ? "artistry" : "import");

      // Build auto-tags from file properties
      const autoTags = [
        "imported",
        category,
        ...tags,
      ];
      const ext = (filename.match(/\.([^.]+)$/)?.[1] || "").toLowerCase();
      if (ext) autoTags.push(ext);

      // Determine if this is a binary file (media) or text-parseable
      const isTextual = ["document", "data", "code"].includes(category);

      // Create the DTU via the macro system
      const ctx = makeCtx(req);
      const dtuContent = isTextual
        ? fileBuffer.toString("utf-8").slice(0, 262144) // 256KB text cap for DTU content
        : `[${category}:${filename}] Binary ${primaryType} file (${fileBuffer.length} bytes)`;

      const dtu = await runMacro("dtu", "create", {
        title: effectiveTitle,
        content: dtuContent,
        tags: [...new Set(autoTags)],
        source: "file-import",
        declaredSourceType: category,
        meta: {
          origin: "imported",
          importedAt: new Date().toISOString(),
          originalFilename: filename,
          mimeType: mimeType || "application/octet-stream",
          fileSize: fileBuffer.length,
          category,
          primaryType,
          domain: effectiveDomain,
          destination: destination || null,
        },
      }, ctx);

      res.json({
        ok: true,
        dtuId: dtu?.id,
        title: effectiveTitle,
        category,
        primaryType,
        domain: effectiveDomain,
        fileSize: fileBuffer.length,
        tags: [...new Set(autoTags)],
        origin: "imported",
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }));

  // POST /api/import/universal/batch — Import multiple files at once
  router.post("/api/import/universal/batch", asyncHandler(async (req, res) => {
    try {
      const { files = [] } = req.body || {};
      if (!Array.isArray(files) || files.length === 0) {
        return res.status(400).json({ ok: false, error: "Missing 'files' array" });
      }
      if (files.length > 20) {
        return res.status(400).json({ ok: false, error: "Maximum 20 files per batch" });
      }

      const ctx = makeCtx(req);
      const results = [];

      for (const file of files) {
        try {
          const { filename, mimeType, data, title, tags = [], domain } = file;
          if (!data || !filename) {
            results.push({ filename: filename || "unknown", ok: false, error: "Missing data or filename" });
            continue;
          }

          const fileBuffer = Buffer.from(data, "base64");
          const category = detectCategory(mimeType, filename);
          const primaryType = detectPrimaryType(category);
          const nameWithoutExt = filename.replace(/\.[^/.]+$/, "").replace(/[-_]/g, " ");
          const effectiveTitle = title || nameWithoutExt;
          const effectiveDomain = domain || (category === "audio" ? "music" : category === "image" ? "artistry" : "import");
          const autoTags = ["imported", category, ...tags];
          const ext = (filename.match(/\.([^.]+)$/)?.[1] || "").toLowerCase();
          if (ext) autoTags.push(ext);
          const isTextual = ["document", "data", "code"].includes(category);

          const dtu = await runMacro("dtu", "create", {
            title: effectiveTitle,
            content: isTextual
              ? fileBuffer.toString("utf-8").slice(0, 262144)
              : `[${category}:${filename}] Binary ${primaryType} file (${fileBuffer.length} bytes)`,
            tags: [...new Set(autoTags)],
            source: "file-import",
            declaredSourceType: category,
            meta: {
              origin: "imported",
              importedAt: new Date().toISOString(),
              originalFilename: filename,
              mimeType: mimeType || "application/octet-stream",
              fileSize: fileBuffer.length,
              category,
              primaryType,
              domain: effectiveDomain,
            },
          }, ctx);

          results.push({ filename, ok: true, dtuId: dtu?.id, category, primaryType });
        } catch (err) {
          results.push({ filename: file.filename || "unknown", ok: false, error: err.message });
        }
      }

      const succeeded = results.filter(r => r.ok).length;
      res.json({ ok: true, total: files.length, succeeded, failed: files.length - succeeded, results });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }));

  // ══════════════════════════════════════════════════════════════════════
  // UNIVERSAL EXPORT — DTU → Any format
  // ══════════════════════════════════════════════════════════════════════

  // POST /api/export/universal — Export DTU content as any format
  // Body: { dtuId, targetFormat, title? }
  router.post("/api/export/universal", asyncHandler(async (req, res) => {
    try {
      const { dtuId, targetFormat = "json", title } = req.body || {};
      if (!dtuId) return res.status(400).json({ ok: false, error: "Missing 'dtuId'" });

      // Fetch the DTU from the system
      const ctx = makeCtx(req);
      const dtu = await runMacro("dtu", "get", { id: dtuId }, ctx);
      if (!dtu) return res.status(404).json({ ok: false, error: "DTU not found" });

      const effectiveTitle = title || dtu.title || "export";
      const ext = FORMAT_EXTENSIONS[targetFormat] || ".json";
      const safeFilename = effectiveTitle.replace(/[^a-zA-Z0-9_\-. ]/g, "_").slice(0, 80);

      // If target is 'dtu', encode as binary DTU file
      if (targetFormat === "dtu") {
        const dtuDomain = dtu.meta?.domain || dtu.tags?.[0] || "general";
        const result = lensDataToDTU(dtuDomain, dtu.content || dtu, {
          title: effectiveTitle,
          tags: dtu.tags || [],
          summary: dtu.summary || dtu.human?.summary,
        });
        res.set("Content-Type", "application/octet-stream");
        res.set("Content-Disposition", `attachment; filename="${safeFilename}${ext}"`);
        return res.send(Buffer.from(result.buffer));
      }

      // For text formats, build the export content
      const content = dtu.content || dtu.summary || JSON.stringify(dtu);

      switch (targetFormat) {
        case "json": {
          const exportData = {
            id: dtu.id,
            title: dtu.title,
            content: dtu.content,
            summary: dtu.summary,
            tags: dtu.tags,
            tier: dtu.tier,
            source: dtu.source,
            meta: dtu.meta,
            createdAt: dtu.createdAt || dtu.timestamp,
          };
          res.set("Content-Type", "application/json");
          res.set("Content-Disposition", `attachment; filename="${safeFilename}${ext}"`);
          return res.send(JSON.stringify(exportData, null, 2));
        }

        case "md":
        case "markdown": {
          const lines = [
            `# ${effectiveTitle}`,
            "",
            dtu.summary ? `> ${dtu.summary}` : "",
            "",
            typeof content === "string" ? content : JSON.stringify(content, null, 2),
            "",
            dtu.tags?.length ? `**Tags:** ${dtu.tags.join(", ")}` : "",
            "",
            `*Exported from Concord on ${new Date().toISOString().slice(0, 10)}*`,
          ].filter(Boolean);
          res.set("Content-Type", "text/markdown");
          res.set("Content-Disposition", `attachment; filename="${safeFilename}${ext}"`);
          return res.send(lines.join("\n"));
        }

        case "csv": {
          const header = "field,value";
          const rows = [
            `title,"${String(dtu.title || "").replace(/"/g, '""')}"`,
            `content,"${String(typeof content === "string" ? content : "").slice(0, 5000).replace(/"/g, '""')}"`,
            `tags,"${(dtu.tags || []).join("; ")}"`,
            `tier,${dtu.tier || "regular"}`,
            `source,${dtu.source || ""}`,
            `created,"${dtu.createdAt || dtu.timestamp || ""}"`,
          ];
          res.set("Content-Type", "text/csv");
          res.set("Content-Disposition", `attachment; filename="${safeFilename}${ext}"`);
          return res.send([header, ...rows].join("\n"));
        }

        case "txt":
        case "text": {
          const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
          res.set("Content-Type", "text/plain");
          res.set("Content-Disposition", `attachment; filename="${safeFilename}${ext}"`);
          return res.send(`${effectiveTitle}\n${"=".repeat(effectiveTitle.length)}\n\n${text}`);
        }

        default: {
          // Fallback to JSON
          res.set("Content-Type", "application/json");
          res.set("Content-Disposition", `attachment; filename="${safeFilename}.json"`);
          return res.send(JSON.stringify(dtu, null, 2));
        }
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }));

  // GET /api/import/formats — List supported import formats
  router.get("/api/import/formats", (req, res) => {
    res.json({
      ok: true,
      categories: Object.keys(CATEGORY_PRIMARY_TYPE),
      extensions: Object.keys(EXT_CATEGORY_MAP),
      mimeTypes: Object.keys(MIME_CATEGORY_MAP),
    });
  });

  // GET /api/export/formats — List supported export formats
  router.get("/api/export/formats", (req, res) => {
    res.json({
      ok: true,
      formats: Object.entries(FORMAT_EXTENSIONS).map(([id, ext]) => ({ id, extension: ext })),
    });
  });

  // GET /api/realtime/status — Get real-time feed status
  router.get("/api/realtime/status", asyncHandler(async (req, res) => {
    try {
      const { getRealtimeFeedStatus } = await import("../emergent/realtime-feeds.js");
      res.json({ ok: true, ...getRealtimeFeedStatus() });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }));

  // GET /api/realtime/feed/:feed — Get cached data for a specific feed
  router.get("/api/realtime/feed/:feed", asyncHandler(async (req, res) => {
    try {
      const { getRealtimeFeedData } = await import("../emergent/realtime-feeds.js");
      const data = getRealtimeFeedData(req.params.feed);
      if (data) {
        res.json({ ok: true, feed: req.params.feed, data });
      } else {
        res.json({ ok: true, feed: req.params.feed, data: null, message: "No cached data yet — waiting for next heartbeat tick" });
      }
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  }));

  return router;
}
