import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import { resolveUnityIndexPath, applyUnityWebEmbed, resolveRequestOrigin, buildUnityConfig, injectUnityConfig, injectNonce } from './helpers';

export async function GET(request: NextRequest) {
  const indexPath = resolveUnityIndexPath();
  if (!indexPath) {
    return NextResponse.json(
      {
        ok: false,
        reason: 'unity_web_export_not_built',
        hint: 'run `node scripts/export-unity-web.mjs` from the repo root (needs Unity 6 batchmode)',
      },
      { status: 404 },
    );
  }

  const raw = applyUnityWebEmbed(fs.readFileSync(indexPath, 'utf8'));
  const nonce = request.headers.get('x-nonce') ?? '';
  const origin = resolveRequestOrigin(request);
  const config = buildUnityConfig(request.nextUrl.searchParams, origin);
  let html = injectUnityConfig(raw, config, nonce || undefined);
  if (nonce) html = injectNonce(html, nonce);

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // Same-origin iframe from /lenses/world. Catch-all next.config DENY
      // is excluded for /unity-client/; this is belt-and-braces.
      'X-Frame-Options': 'SAMEORIGIN',
    },
  });
}
