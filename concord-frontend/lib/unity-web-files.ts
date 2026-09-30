/**
 * Where the committed Unity WebGL player actually lives on disk.
 *
 * Next `output: 'standalone'` does not bundle `public/`. launchd on this Mac
 * runs `.next/standalone/server.js` with cwd = that folder. A partial copy
 * once left only `export-index.html` — HTML 200, wasm/loader 500 through the
 * App Router, world lens reads as "Unity WebGL missing".
 *
 * Walk cwd + known repo-relative fallbacks so both the index route and the
 * Build catch-all find the same tree git already has.
 */
import fs from 'node:fs';
import path from 'node:path';

export const UNITY_WEB_MARKERS = [
  path.join('Build', 'concordia.loader.js'),
  path.join('Build', 'concordia.wasm.unityweb'),
  'export-index.html',
] as const;

function hasPlayer(root: string): boolean {
  return UNITY_WEB_MARKERS.some((rel) => fs.existsSync(path.join(root, rel)));
}

export function unityWebRootCandidates(cwd = process.cwd()): string[] {
  return [
    path.join(cwd, 'public', 'unity-client'),
    path.join(cwd, '.unity-web-staging'),
    // standalone cwd = concord-frontend/.next/standalone → ../../public
    path.join(cwd, '..', '..', 'public', 'unity-client'),
    path.join(cwd, 'concord-frontend', 'public', 'unity-client'),
  ];
}

export function resolveUnityWebRoot(cwd = process.cwd()): string | null {
  for (const candidate of unityWebRootCandidates(cwd)) {
    try {
      if (hasPlayer(candidate)) return candidate;
    } catch {
      /* skip unreadable */
    }
  }
  return null;
}

export function resolveUnityIndexFile(cwd = process.cwd()): string | null {
  const staged = [
    path.join(cwd, '.unity-web-staging', 'index.html'),
    path.join(cwd, '..', '..', '.unity-web-staging', 'index.html'),
  ];
  for (const p of staged) {
    if (fs.existsSync(p)) return p;
  }
  const root = resolveUnityWebRoot(cwd);
  if (!root) return null;
  const committed = path.join(root, 'export-index.html');
  if (fs.existsSync(committed)) return committed;
  const index = path.join(root, 'index.html');
  if (fs.existsSync(index)) return index;
  return null;
}

const MIME: Record<string, string> = {
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.glb': 'model/gltf-binary',
  '.wasm': 'application/wasm',
};

export function unityAssetContentType(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.wasm.unityweb')) return 'application/wasm';
  if (lower.endsWith('.js.unityweb')) return 'application/javascript';
  if (lower.endsWith('.data.unityweb')) return 'application/octet-stream';
  if (lower.endsWith('.unityweb')) return 'application/octet-stream';
  const ext = path.extname(lower);
  return MIME[ext] || 'application/octet-stream';
}

export function unityAssetIsGzipped(filename: string): boolean {
  return filename.toLowerCase().endsWith('.unityweb');
}

/** Reject path traversal. Relative POSIX path inside the player root, or null. */
export function safeUnityRelativePath(rel: string): string | null {
  const cleaned = rel.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleaned || cleaned.includes('..')) return null;
  if (cleaned.split('/').some((p) => p === '' || p === '.')) return null;
  return cleaned;
}
