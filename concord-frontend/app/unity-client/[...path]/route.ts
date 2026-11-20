/**
 * Serve committed Unity WebGL bytes when Next standalone did not copy
 * public/unity-client/Build (the actual "missing Unity WebGL" failure).
 * index.html stays the nonce/config route; everything else under
 * /unity-client/* lands here.
 */
import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';
import {
  resolveUnityWebRoot,
  safeUnityRelativePath,
  unityAssetContentType,
  unityAssetIsGzipped,
  unityPayloadCompression,
  unityPayloadIsLfsPointer,
} from '@/lib/unity-web-files';

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ path: string[] }> | { path: string[] } },
) {
  const raw = await Promise.resolve(context.params);
  const rel = safeUnityRelativePath((raw.path || []).join('/'));
  if (!rel || rel === 'index.html') {
    return NextResponse.json({ ok: false, reason: 'unity_web_export_not_built' }, { status: 404 });
  }

  const root = resolveUnityWebRoot();
  if (!root) {
    return NextResponse.json(
      { ok: false, reason: 'unity_web_export_not_built' },
      { status: 404 },
    );
  }

  const abs = path.join(root, rel);
  const resolvedRoot = path.resolve(root);
  const resolvedFile = path.resolve(abs);
  if (!resolvedFile.startsWith(resolvedRoot + path.sep) && resolvedFile !== resolvedRoot) {
    return NextResponse.json({ ok: false, reason: 'unity_web_export_not_built' }, { status: 404 });
  }
  if (!fs.existsSync(resolvedFile) || !fs.statSync(resolvedFile).isFile()) {
    return NextResponse.json({ ok: false, reason: 'unity_web_export_not_built' }, { status: 404 });
  }

  const body = fs.readFileSync(resolvedFile);
  // A checkout without `git lfs pull` still has the pointer text. Serving it
  // as JavaScript (and advertising an encoding) makes the loader throw
  // `unityFramework is not defined`. The real export is the compressed blob.
  if (unityPayloadIsLfsPointer(body)) {
    return NextResponse.json(
      { ok: false, reason: 'unity_web_export_not_built' },
      { status: 404 },
    );
  }
  const headers: Record<string, string> = {
    'Content-Type': unityAssetContentType(rel),
    'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Frame-Options': 'SAMEORIGIN',
  };
  // Name the payload's own compression (PF-10): gzip exports get `gzip`,
  // Brotli exports get `br`. Before PF-10 only gzip was recognised, so a
  // Brotli export was served with no Content-Encoding and never decoded.
  const compression = unityAssetIsGzipped(rel) ? unityPayloadCompression(body) : null;
  if (compression) headers['Content-Encoding'] = compression === 'gzip' ? 'gzip' : 'br';

  return new NextResponse(body, { status: 200, headers });
}
