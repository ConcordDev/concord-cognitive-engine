// server/lib/universal-dtu-bridge.js
// Universal bridge for converting any lens data to/from DTU format.
// Wraps any artifact into a DTU container using the existing binary format.

import { encodeDTU, decodeDTU, verifyDTU } from "../economy/dtu-format.js";
import { DTU_FORMAT_CONSTANTS } from "./dtu-format-constants.js";
import { storeArtifact, isSupportedType } from "./artifact-store.js";

const { PRIMARY_TYPES } = DTU_FORMAT_CONSTANTS;

// Domain → primary type mapping
const DOMAIN_TYPE_MAP = {
  finance: "dataset",
  trades: "dataset",
  crypto: "dataset",
  market: "dataset",
  news: "document",
  environment: "dataset",
  eco: "dataset",
  healthcare: "document",
  education: "document",
  legal: "document",
  accounting: "dataset",
  government: "document",
  realestate: "dataset",
  aviation: "dataset",
  insurance: "dataset",
  manufacturing: "dataset",
  logistics: "dataset",
  energy: "dataset",
  retail: "dataset",
  agriculture: "dataset",
  music: "audio",
  studio: "image",
  artistry: "image",
  creative: "document",
  paper: "document",
  research: "document",
  science: "document",
  bio: "document",
  chem: "document",
  physics: "document",
  quantum: "document",
  neuro: "document",
  math: "document",
  fractal: "image",
  reasoning: "document",
  ethics: "document",
  philosophy: "document",
  law: "document",
  council: "document",
  debug: "code",
  code: "code",
  ml: "code",
  sim: "simulation",
  game: "simulation",
  ar: "simulation",
  fitness: "dataset",
  food: "document",
  household: "document",
  default: "document",
};

function getDomainPrimaryType(domain) {
  return DOMAIN_TYPE_MAP[domain] || DOMAIN_TYPE_MAP.default;
}

/**
 * Convert any lens data into a DTU binary buffer.
 * @param {string} domain - Lens domain (e.g., "finance", "news")
 * @param {object} artifactData - The artifact data to wrap
 * @param {object} options - { title, tags, author, format }
 * @returns {{ buffer: Buffer, metadata: object }}
 */
export function lensDataToDTU(domain, artifactData, options = {}) {
  const title = options.title || `${domain} artifact — ${new Date().toISOString().slice(0, 10)}`;
  const tags = options.tags || [domain, "lens-export"];
  const author = options.author || "ConcordOS";
  const primaryType = getDomainPrimaryType(domain);

  const dtuPayload = {
    primaryType,
    title,
    tags,
    human: {
      summary: options.summary || `Exported from ${domain} lens`,
      bullets: options.bullets || [],
    },
    core: {
      definitions: options.definitions || [],
      invariants: options.invariants || [],
      claims: options.claims || [],
      examples: [],
      nextActions: [],
    },
    machine: {
      kind: `${domain}_export`,
      domain,
      format: options.format || "json",
      exportedAt: new Date().toISOString(),
      sourceVersion: "1.0",
    },
    artifact: artifactData,
    author,
    createdAt: new Date().toISOString(),
  };

  const buffer = encodeDTU(dtuPayload);
  return {
    buffer,
    metadata: {
      primaryType,
      title,
      domain,
      size: buffer.length,
      createdAt: dtuPayload.createdAt,
    },
  };
}

/**
 * Convert external format data to a DTU.
 * @param {string} sourceFormat - Source format (json, csv, md, yaml, html, xml, txt)
 * @param {string|Buffer|object} sourceData - The raw data
 * @param {object} metadata - { title, domain, tags, author }
 * @returns {{ buffer: Buffer, metadata: object }}
 */
export function wrapFormatAsDTU(sourceFormat, sourceData, metadata = {}) {
  const domain = metadata.domain || "import";
  const title = metadata.title || `Imported ${sourceFormat} — ${new Date().toISOString().slice(0, 10)}`;

  let parsedData;
  let summary;

  switch (sourceFormat.toLowerCase()) {
    case "json":
      parsedData = typeof sourceData === "string" ? JSON.parse(sourceData) : sourceData;
      summary = `JSON document with ${Object.keys(parsedData).length} top-level keys`;
      break;
    case "csv": {
      parsedData = { raw: String(sourceData), format: "csv" };
      const lines = String(sourceData).split("\n").filter(Boolean);
      summary = `CSV with ${lines.length} rows`;
      break;
    }
    case "md":
    case "markdown":
      parsedData = { raw: String(sourceData), format: "markdown" };
      summary = `Markdown document (${String(sourceData).length} chars)`;
      break;
    case "yaml":
    case "yml":
      parsedData = { raw: String(sourceData), format: "yaml" };
      summary = `YAML document`;
      break;
    case "html":
      parsedData = { raw: String(sourceData), format: "html" };
      summary = `HTML document (${String(sourceData).length} chars)`;
      break;
    case "xml":
      parsedData = { raw: String(sourceData), format: "xml" };
      summary = `XML document`;
      break;
    case "txt":
    case "text":
      parsedData = { raw: String(sourceData), format: "text" };
      summary = `Plain text (${String(sourceData).length} chars)`;
      break;
    default:
      parsedData = { raw: sourceData, format: sourceFormat };
      summary = `${sourceFormat} document`;
  }

  return lensDataToDTU(domain, parsedData, {
    title,
    tags: metadata.tags || [domain, "import", sourceFormat],
    author: metadata.author || "user",
    summary,
    format: sourceFormat,
  });
}

/**
 * Export a DTU to an external format.
 * @param {Buffer} dtuBuffer - The .dtu binary buffer
 * @param {string} targetFormat - Target format (json, csv, md, yaml, txt)
 * @returns {{ data: string|object, format: string, metadata: object }}
 */
export function exportDTUAs(dtuBuffer, targetFormat) {
  const decoded = decodeDTU(dtuBuffer);

  switch (targetFormat.toLowerCase()) {
    case "json":
      return {
        data: JSON.stringify(decoded, null, 2),
        format: "json",
        mimeType: "application/json",
        metadata: { title: decoded.title, primaryType: decoded.primaryType },
      };

    case "md":
    case "markdown": {
      const lines = [`# ${decoded.title || "Untitled DTU"}\n`];
      if (decoded.human?.summary) lines.push(`> ${decoded.human.summary}\n`);
      if (decoded.human?.bullets?.length) {
        lines.push("## Key Points\n");
        for (const b of decoded.human.bullets) lines.push(`- ${b}`);
        lines.push("");
      }
      if (decoded.core?.definitions?.length) {
        lines.push("## Definitions\n");
        for (const d of decoded.core.definitions) lines.push(`- ${d}`);
        lines.push("");
      }
      if (decoded.core?.claims?.length) {
        lines.push("## Claims\n");
        for (const c of decoded.core.claims) lines.push(`- ${c}`);
        lines.push("");
      }
      if (decoded.tags?.length) lines.push(`\n**Tags:** ${decoded.tags.join(", ")}`);
      return {
        data: lines.join("\n"),
        format: "markdown",
        mimeType: "text/markdown",
        metadata: { title: decoded.title },
      };
    }

    case "csv": {
      const artifact = decoded.artifact;
      if (artifact && typeof artifact === "object" && artifact.raw && artifact.format === "csv") {
        return { data: artifact.raw, format: "csv", mimeType: "text/csv", metadata: { title: decoded.title } };
      }
      // Fallback: export DTU metadata as CSV
      const header = "field,value";
      const rows = [
        `title,"${(decoded.title || "").replace(/"/g, '""')}"`,
        `primaryType,${decoded.primaryType || ""}`,
        `tags,"${(decoded.tags || []).join("; ")}"`,
        `summary,"${(decoded.human?.summary || "").replace(/"/g, '""')}"`,
      ];
      return { data: [header, ...rows].join("\n"), format: "csv", mimeType: "text/csv", metadata: { title: decoded.title } };
    }

    case "txt":
    case "text": {
      const parts = [decoded.title || "Untitled DTU"];
      if (decoded.human?.summary) parts.push(`\nSummary: ${decoded.human.summary}`);
      if (decoded.core?.definitions?.length) {
        parts.push("\nDefinitions:");
        for (const d of decoded.core.definitions) parts.push(`  - ${d}`);
      }
      if (decoded.core?.claims?.length) {
        parts.push("\nClaims:");
        for (const c of decoded.core.claims) parts.push(`  - ${c}`);
      }
      return { data: parts.join("\n"), format: "text", mimeType: "text/plain", metadata: { title: decoded.title } };
    }

    default:
      return { data: JSON.stringify(decoded, null, 2), format: "json", mimeType: "application/json", metadata: { title: decoded.title } };
  }
}

/**
 * Verify a DTU buffer and return decoded metadata.
 * @param {Buffer} buffer
 * @returns {{ ok: boolean, metadata?: object, error?: string }}
 */
export function inspectDTU(buffer) {
  try {
    const verification = verifyDTU(buffer);
    const decoded = decodeDTU(buffer);
    return {
      ok: true,
      metadata: {
        title: decoded.title,
        primaryType: decoded.primaryType,
        tags: decoded.tags,
        domain: decoded.machine?.domain,
        format: decoded.machine?.format,
        createdAt: decoded.createdAt,
        size: buffer.length,
      },
      verification,
    };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  }
}

export { DOMAIN_TYPE_MAP };

/**
 * Wrap ANY file (binary or text) inside a DTU envelope. The bytes are
 * persisted to the content-addressed artifact-store; the DTU buffer carries
 * a reference so the round-trip is fully reproducible.
 *
 * This is the user-facing "universal file format" surface: hand it a
 * Buffer/Uint8Array and a mime type, get back a `.dtu` buffer that holds
 * the DTU metadata + the original file bytes + structured envelope.
 *
 * @param {Buffer|Uint8Array} fileBuffer - The file contents
 * @param {object} options
 * @param {string} options.mime - MIME type (e.g. "image/png", "audio/mpeg",
 *                                "application/pdf"). Unknown types fall
 *                                back to "application/octet-stream".
 * @param {string} [options.filename] - Original filename for display
 * @param {string} [options.dtuId] - Pre-computed DTU id (else uses sha256 prefix)
 * @param {string} [options.title]
 * @param {string} [options.domain="import"]
 * @param {string} [options.author="user"]
 * @param {string[]} [options.tags]
 * @param {string} [options.description]
 * @returns {Promise<{ buffer: Buffer, metadata: object, attachment: object }>}
 */
export async function wrapAnyFileAsDTU(fileBuffer, options = {}) {
  const buf = Buffer.isBuffer(fileBuffer) ? fileBuffer : Buffer.from(fileBuffer);
  const mime = options.mime && isSupportedType(options.mime)
    ? options.mime
    : "application/octet-stream";
  const filename = options.filename || `file-${Date.now()}`;
  const domain = options.domain || "import";
  const tags = options.tags || [domain, "universal-file", mime];
  const title = options.title || filename;

  // Persist bytes via the existing content-addressed artifact-store.
  // dtuId is required by storeArtifact for legacy directory layout — if the
  // caller didn't supply one, derive a stable id from the buffer hash so
  // re-wrapping the same bytes is deterministic.
  const dtuId = options.dtuId
    || `dtu_file_${(await import("node:crypto")).createHash("sha256").update(buf).digest("hex").slice(0, 16)}`;
  const stored = await storeArtifact(dtuId, buf, mime, filename);

  // Compose the DTU envelope. The artifact ref + sha256 ride in attachments[];
  // the human-readable summary records what kind of file this is.
  const dtuPayload = {
    primaryType: getDomainPrimaryType(domain),
    title,
    tags,
    human: {
      summary: options.description || `Universal file: ${filename} (${mime}, ${buf.length} bytes)`,
      bullets: [
        `File: ${filename}`,
        `MIME: ${mime}`,
        `Size: ${buf.length} bytes`,
        `Hash: ${stored.hash}`,
      ],
    },
    core: {
      definitions: [],
      invariants: [`content-hash:${stored.hash}`],
      claims: [],
      examples: [],
      nextActions: [],
    },
    machine: {
      kind: "universal_file",
      domain,
      format: mime,
      filename,
      exportedAt: new Date().toISOString(),
      sourceVersion: "1.0",
    },
    // attachments rides alongside content so consumers that don't need bytes
    // can skip them; the artifact-store holds the canonical copy.
    attachments: [{
      name: filename,
      mime,
      size: buf.length,
      sha256: stored.hash,
      artifactRef: stored.diskPath,
      description: options.description,
      attachedAt: stored.createdAt,
    }],
    artifact: { ref: stored.diskPath, hash: stored.hash, mime, size: buf.length },
    author: options.author || "user",
    createdAt: new Date().toISOString(),
  };

  const buffer = encodeDTU(dtuPayload, { artifactData: buf, artifactMimeType: mime });
  return {
    buffer,
    metadata: {
      primaryType: dtuPayload.primaryType,
      title,
      domain,
      filename,
      mime,
      size: buffer.length,
      artifactSize: buf.length,
      hash: stored.hash,
      createdAt: dtuPayload.createdAt,
    },
    attachment: dtuPayload.attachments[0],
  };
}
