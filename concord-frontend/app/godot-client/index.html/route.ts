import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import { STAGED_INDEX, injectNonce, injectConfigArgs, resolveRequestOrigin } from './helpers';

export async function GET(request: NextRequest) {
  let raw: string;
  try {
    raw = fs.readFileSync(STAGED_INDEX, 'utf8');
  } catch {
    // Honest failure — no fabricated "it's fine" response. The export
    // simply hasn't been run yet (`npm run export:web` from the repo root).
    return NextResponse.json(
      { ok: false, reason: 'godot_web_export_not_built', hint: 'run `node scripts/export-godot-web.mjs` from the repo root' },
      { status: 404 },
    );
  }

  const nonce = request.headers.get('x-nonce') ?? '';
  let html = nonce ? injectNonce(raw, nonce) : raw;
  html = injectConfigArgs(html, request.nextUrl.searchParams, resolveRequestOrigin(request));

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // The export is a static, versioned build artifact per-deploy; the
      // dynamic parts (nonce, config args) change every request, so this
      // response itself must never be cached, or a stale nonce would
      // 100%-reliably fail CSP on the next request.
      'Cache-Control': 'no-store',
    },
  });
}
