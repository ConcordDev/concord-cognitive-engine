/**
 * Register the committed HubKit MANIFEST into evo_assets so HubKit stems
 * are first-class evo rows (source='hubkit'). Does not copy binaries;
 * paths stay StreamingAssets/HubKit/...
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
  let existsGet;
  let insertRun;
  try {
    existsGet = db.prepare(`SELECT id FROM evo_assets WHERE id = ?`);
    insertRun = db.prepare(`
      INSERT INTO evo_assets (id, kind, source, source_id, local_path, category)
      VALUES (?, 'mesh', 'hubkit', ?, ?, 'hub')
    `);
  } catch {
    return { ok: false, reason: "evo_assets_missing" };
  }
  for (const entry of files) {
    if (!entry?.stem || !entry?.file) continue;
    const id = `evo_hubkit_${String(entry.stem).replace(/[^a-zA-Z0-9_-]/g, "_")}`;
    try {
      const exists = existsGet.get(id);
      if (exists) { known++; continue; }
      insertRun.run(id, String(entry.stem), `StreamingAssets/HubKit/${entry.file}`);
      inserted++;
    } catch {
      /* row optional / unique */
    }
  }
  return { ok: true, inserted, known, total: files.length, manifest: path };
}
