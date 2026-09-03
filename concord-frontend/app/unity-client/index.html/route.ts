import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

// Serves the Unity WebGL export's index.html with two request-time injections:
//
// 1. The CURRENT request's CSP nonce on every <script> tag — same reason as
//    app/godot-client/index.html/route.ts. Unity's stock Web template ships
//    createUnityInstance bootstrap scripts with no nonce; under the app's
//    strict-dynamic CSP a static public/index.html is refused outright.
//
// 2. window.CONCORD_UNITY_CONFIG — gateway URL, world id, optional token —
//    so the WebGL ConcordClient (jslib WebSocket) does not hardcode
//    wss://live.concordos.ai. Query params win; missing gateway defaults to
//    same-origin /unity-ws (ws/wss from the page origin).
//
// Index sources (first hit wins):
//   1. .unity-web-staging/index.html — local re-export, gitignored
//   2. public/unity-client/export-index.html — committed copy so CI/deploy
//      and Next standalone (startup.sh copies public/) serve HTML without
//      a Unity Editor on the box. Not named index.html: that URL is this
//      route (CSP nonce). Static bytes: public/unity-client/Build/* etc.

const STAGED_INDEX = path.join(process.cwd(), '.unity-web-staging', 'index.html');
const COMMITTED_INDEX = path.join(process.cwd(), 'public', 'unity-client', 'export-index.html');

export function resolveUnityIndexPath(): string | null {
  if (fs.existsSync(STAGED_INDEX)) return STAGED_INDEX;
  if (fs.existsSync(COMMITTED_INDEX)) return COMMITTED_INDEX;
  return null;
}

/** Full-bleed iframe + gzip fallback. Idempotent. */
export function applyUnityWebEmbed(html: string): string {
  let out = html;
  if (!out.includes('id="concord-unity-fullbleed"')) {
    const style =
      '<style id="concord-unity-fullbleed">' +
      'html,body,#unity-container,#unity-canvas{width:100%!important;height:100%!important;margin:0;padding:0;overflow:hidden;background:#000}' +
      '#unity-container.unity-desktop{left:0;top:0;transform:none;width:100%;height:100%}' +
      '#unity-footer{display:none!important}' +
      '</style>';
    out = /<\/head>/i.test(out) ? out.replace(/<\/head>/i, `${style}</head>`) : style + out;
  }
  if (!/\bdecompressionFallback\s*:/.test(out)) {
    out = out.replace(
      /showBanner:\s*unityShowBanner,/,
      'showBanner: unityShowBanner,\n        decompressionFallback: true,',
    );
  }
  out = out.replace(/canvas\.style\.width = "960px";/, 'canvas.style.width = "100%";');
  out = out.replace(/canvas\.style\.height = "600px";/, 'canvas.style.height = "100%";');
  return out;
}

export const UNITY_CONFIG_KEYS = [
  'CONCORD_GATEWAY_URL',
  'CONCORD_AUTH_TOKEN',
  'CONCORD_WORLD_ID',
] as const;

export function injectNonce(html: string, nonce: string): string {
  return html.replace(/<script(?![^>]*\bnonce=)([^>]*)>/gi, (_match, attrs) => `<script nonce="${nonce}"${attrs}>`);
}

export function resolveRequestOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) return request.nextUrl.origin;
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
  return `${proto}://${host}`;
}

function wsOriginFromHttp(origin: string): string {
  if (origin.startsWith('https://')) return `wss://${origin.slice('https://'.length)}`;
  if (origin.startsWith('http://')) return `ws://${origin.slice('http://'.length)}`;
  return origin;
}

export function buildUnityConfig(
  searchParams: URLSearchParams,
  defaultOrigin?: string,
): { gatewayUrl: string; worldId: string; token: string } {
  const origin = defaultOrigin || '';
  const gatewayDefault = origin ? `${wsOriginFromHttp(origin)}/unity-ws` : '';
  return {
    gatewayUrl: searchParams.get('CONCORD_GATEWAY_URL') || gatewayDefault,
    worldId: searchParams.get('CONCORD_WORLD_ID') || 'concordia-hub',
    token: searchParams.get('CONCORD_AUTH_TOKEN') || '',
  };
}

export function injectUnityConfig(html: string, config: { gatewayUrl: string; worldId: string; token: string }, nonce?: string): string {
  const payload = JSON.stringify(config);
  const nonceAttr = nonce ? ` nonce="${nonce}"` : '';
  const tag = `<script${nonceAttr}>window.CONCORD_UNITY_CONFIG=${payload};</script>`;
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head([^>]*)>/i, `<head$1>${tag}`);
  }
  return tag + html;
}

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
