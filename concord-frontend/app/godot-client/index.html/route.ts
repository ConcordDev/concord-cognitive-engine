import { NextRequest, NextResponse } from 'next/server';
import fs from 'node:fs';
import path from 'node:path';

// Serves the Godot Web export's index.html with two request-time injections:
//
// 1. The CURRENT request's CSP nonce, into both <script> tags, so the page
//    survives the app's strict-dynamic script-src (middleware.ts). See
//    scripts/export-godot-web.mjs's header for the full "why not a static
//    public/ file" explanation and the real-browser evidence that motivated
//    this (a plain static export is refused outright by strict-dynamic).
//
// 2. A whitelisted subset of THIS request's query params, into the
//    exported GODOT_CONFIG.args array (as "KEY=VALUE" strings after a "--"
//    separator) — so an embedding page can configure which server/world the
//    client connects to (world/boot.gd#_ready reads them via
//    OS.get_cmdline_user_args() on Web builds, since native env vars don't
//    exist in a browser tab). This was ALSO tried via
//    `window.location.search` + `JavaScriptBridge.eval` first and rejected
//    after a real browser load: the app's CSP has 'wasm-unsafe-eval' (for
//    the WASM runtime) but not the much broader 'unsafe-eval', so
//    JavaScriptBridge.eval is refused outright ("EvalError: Refused to
//    evaluate a string as JavaScript..."). Splicing into GODOT_CONFIG.args
//    needs no CSP relaxation — Godot's own bootstrap script already passes
//    that array to the WASM module's argv unconditionally.
//
// The staged file (concord-frontend/.godot-web-staging/index.html) is the
// export script's raw Godot output — this route's only structural edits are
// the nonce attributes and the args array; index.js/.wasm/.pck/icons/
// worklets ship as plain static bytes under public/godot-client/, untouched.

const STAGED_INDEX = path.join(process.cwd(), '.godot-web-staging', 'index.html');

// Mirrors world/boot.gd#resolve_runtime_config's key names exactly, so
// parse_key_value_args's output needs zero translation on the GDScript side.
const CONFIG_PARAM_KEYS = [
  'CONCORD_GATEWAY_URL',
  'CONCORD_GODOT_API_KEY',
  'CONCORD_GODOT_AUTH_TOKEN',
  'CONCORD_WORLD_ID',
  'CONCORD_GODOT_SPECTATOR',
  'CONCORD_FRONTEND_URL',
] as const;

// Matches an opening <script ...> tag that does not already carry a nonce
// attribute (defensive — the staged file never has one, but this avoids
// ever double-adding if that ever changes) and inserts nonce="<value>"
// right after the tag name, working for both `<script>` and
// `<script src="...">` forms.
export function injectNonce(html: string, nonce: string): string {
  return html.replace(/<script(?![^>]*\bnonce=)([^>]*)>/gi, (_match, attrs) => `<script nonce="${nonce}"${attrs}>`);
}

// Replaces GODOT_CONFIG's `args` array with a "--" separator followed by
// "KEY=VALUE" entries for every whitelisted query param present on this
// request (falling back to `defaultFrontendUrl` for CONCORD_FRONTEND_URL
// specifically when the request didn't set one — see the GET handler for
// why: Godot's own `HTTPRequest` rejects a relative URL outright, even on
// Web, so world/boot.gd needs an ABSOLUTE same-origin URL by default, not
// an empty string). Parses the object as real JSON (not a fragile
// literal-`[]` string replace) so it stays correct regardless of exporter
// formatting changes, and re-serializes via JSON.stringify — which safely
// escapes any character a token/URL value could contain, so no manual
// escaping is ever needed here. Leaves the file byte-for-byte unchanged if
// the marker isn't found (honest no-op, never throws) or if no param
// ultimately applies.
export function injectConfigArgs(html: string, searchParams: URLSearchParams, defaultFrontendUrl?: string): string {
  const args: string[] = [];
  for (const key of CONFIG_PARAM_KEYS) {
    let value = searchParams.get(key);
    if (!value && key === 'CONCORD_FRONTEND_URL' && defaultFrontendUrl) {
      value = defaultFrontendUrl;
    }
    if (value) args.push(`${key}=${value}`);
  }
  if (args.length === 0) return html;

  const match = html.match(/const GODOT_CONFIG = (\{.*\});/);
  if (!match) return html;
  let config: Record<string, unknown>;
  try {
    config = JSON.parse(match[1]);
  } catch {
    return html;
  }
  config.args = ['--', ...args];
  return html.replace(match[0], `const GODOT_CONFIG = ${JSON.stringify(config)};`);
}

// The request's real public origin, for the CONCORD_FRONTEND_URL default.
// NOT request.nextUrl.origin — tried that first and it was wrong: under
// `next dev` (Turbopack), nextUrl.origin resolved to "http://localhost:3010"
// even when the browser was actually on "http://127.0.0.1:3010" (verified
// directly — same mismatch persisted with an explicit Host header on the
// request), which is a DIFFERENT origin under same-origin policy and so
// still got refused by the app's CSP ('self' doesn't match a different
// hostname string, even one resolving to the identical server). The actual
// incoming Host header (or X-Forwarded-Host behind the Cloudflare tunnel
// this app deploys behind — same forwarded-header convention as trust
// proxy handling elsewhere in this repo) is the one value guaranteed to
// match what the BROWSER thinks the origin is, since it's an echo of what
// the browser itself sent. X-Forwarded-Proto covers https behind the
// tunnel; nextUrl.protocol is the same-process fallback for direct/dev
// access with no proxy in front.
export function resolveRequestOrigin(request: NextRequest): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) return request.nextUrl.origin;
  const proto = request.headers.get('x-forwarded-proto') ?? request.nextUrl.protocol.replace(':', '');
  return `${proto}://${host}`;
}

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
