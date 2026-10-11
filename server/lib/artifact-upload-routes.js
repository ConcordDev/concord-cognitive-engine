// POST /api/artifact/upload and /api/artifact/upload-multi.
// Accepts a raw file body or multipart. Stores one DTU per file, owned by
// the authenticated user, domain from x-domain / the form field (art lens
// uploads stay art). 4xx responses are JSON { ok:false, error }.

import { readUploadRequest } from "./multipart-body.js";
import { inferDomainFromType, inferKindFromType, storeArtifact } from "./artifact-store.js";

function fail(res, status, error) {
  return res.status(status).json({ ok: false, error: String(error || "Upload failed") });
}

async function handleArtifactUpload(req, res, deps, multi) {
  try {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Sign in to upload artwork.");

    const parsed = await readUploadRequest(req);
    if (!parsed.ok) return fail(res, parsed.status || 400, parsed.error);

    let files = parsed.files;
    if (!multi && files.length > 1) files = files.slice(0, 1);
    if (!files.length) return fail(res, 400, "No file was included in the upload.");

    const { validateMimeType } = deps;
    for (const file of files) {
      if (!file.buffer || !file.buffer.length) {
        return fail(res, 400, `“${file.filename || "file"}” was empty.`);
      }
      const mimeCheck = validateMimeType(file.contentType, file.buffer);
      if (!mimeCheck.ok) return fail(res, 400, mimeCheck.error);
    }

    const totalBytes = files.reduce((n, f) => n + f.buffer.length, 0);
    try {
      deps.assertHasSpaceFor(deps.db, userId, totalBytes);
    } catch (e) {
      if (e?.code === "quota_exceeded") {
        return res.status(413).json(e.payload || { ok: false, error: "Storage quota reached." });
      }
      if (e?.code === "auth_required") return fail(res, 401, "Sign in to upload artwork.");
      throw e;
    }

    const explicitDomain = String(parsed.domain || "").trim();
    const sharedTitle = String(parsed.title || "").trim();
    const stored = [];

    for (const file of files) {
      const domain = explicitDomain || inferDomainFromType(file.contentType) || "general";
      const kind = inferKindFromType(file.contentType);
      const title = (files.length === 1 ? sharedTitle : "") || file.filename || "Untitled";
      const dtuId = deps.uid("artifact");
      const artifactRef = await storeArtifact(dtuId, file.buffer, file.contentType, file.filename || title);
      const dtu = {
        id: dtuId,
        tier: "regular",
        scope: "local",
        visibility: "private",
        domain,
        title,
        ownerId: userId,
        createdBy: userId,
        authorId: userId,
        human: { summary: title, bullets: [] },
        core: { definitions: [], claims: [], examples: [] },
        machine: {
          kind,
          verifier: { format: file.contentType, sizeBytes: artifactRef.sizeBytes, hash: artifactRef.hash },
        },
        artifact: artifactRef,
        lineage: { parents: [], children: [] },
        authority: { score: 0.5 },
        meta: {
          createdBy: userId,
          ownerId: userId,
          lens: domain,
          type: kind,
          tags: [domain],
          createdAt: new Date().toISOString(),
        },
        createdAt: new Date().toISOString(),
      };
      deps.STATE.dtus.set(dtuId, dtu);
      try {
        deps.recordStorageDelta(deps.db, userId, artifactRef.sizeBytes || file.buffer.length, deps.STORAGE_REASONS.UPLOAD, dtuId);
      } catch { /* accounting drift must not fail a stored upload */ }
      const hasThumb = !!artifactRef.thumbnail && typeof artifactRef.thumbnail === "string" && String(file.contentType).startsWith("video/");
      stored.push({
        dtuId,
        artifact: { type: artifactRef.type, sizeBytes: artifactRef.sizeBytes },
        thumbnailUrl: hasThumb ? `/api/artifact/${dtuId}/thumbnail` : null,
      });
    }

    try { deps.saveState?.(); } catch { /* best-effort persist */ }

    const first = stored[0];
    return res.status(200).json({
      ok: true,
      dtuId: first.dtuId,
      dtuIds: stored.map((s) => s.dtuId),
      artifact: first.artifact,
      thumbnailUrl: first.thumbnailUrl,
      count: stored.length,
    });
  } catch (err) {
    const message = String(err?.message || err || "Upload failed");
    const status = /unsupported artifact type|not allowed|does not match/i.test(message) ? 400 : 500;
    return fail(res, status, message);
  }
}

export function mountArtifactUploadRoutes(app, deps) {
  app.post("/api/artifact/upload", (req, res) => handleArtifactUpload(req, res, deps, false));
  app.post("/api/artifact/upload-multi", (req, res) => handleArtifactUpload(req, res, deps, true));
}
