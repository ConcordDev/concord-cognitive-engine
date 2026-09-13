/**
 * Register the committed HubKit MANIFEST into evo_assets so store/Kenney
 * meshes are first-class evo rows. Does not copy binaries; paths are local.
 */
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const CANDIDATES = [
  join(HERE, "../../apps/concordia-living-world/unity-client/Assets/StreamingAssets/HubKit/MANIFEST.json"),
  join(HERE, "../../concord-frontend/public/unity-client/StreamingAssets/HubKit/MANIFEST.json"),
];

export function hubKitManifestPath() {
  return CANDIDATES.find((p) => existsSync(p)) || null;
}

export function registerHubKitEvo(db) {
  if (!db) return { ok: false, reason: "no_db" };
  const path = hubKitManifestPath();
  if (!path) return { ok: false, reason: "manifest_missing" };
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { ok: false, reason: "manifest_unreadable" };
  }
  const files = Array.isArray(manifest?.files) ? manifest.files : [];
  let inserted = 0;
  let known = 0;
  for (const entry of files) {
    if (!entry?.stem || !entry?.file) continue;
    const id = `evo_hubkit_${String(entry.stem).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    try {
      const exists = db.prepare(`SELECT id FROM evo_assets WHERE id = ?`).get(id);
      if (exists) { known++; continue; }
      db.prepare(`
        INSERT INTO evo_assets (id, kind, source, source_id, local_path, category)
        VALUES (?, 'mesh', 'kenney', ?, ?, 'hub')
      `).run(id, String(entry.stem), `StreamingAssets/HubKit/${entry.file}`);
      inserted++;
    } catch {
      /* table optional */
    }
  }
  return { ok: true, inserted, known, total: files.length, manifest: path };
}
