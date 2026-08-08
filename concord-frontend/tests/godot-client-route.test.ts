import { describe, it, expect } from 'vitest';
import { injectNonce, injectConfigArgs, resolveRequestOrigin } from '../app/godot-client/index.html/route';
import type { NextRequest } from 'next/server';

function makeRequest(headers: Record<string, string>, protocol = 'http:'): NextRequest {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (key: string) => map.get(key.toLowerCase()) ?? null },
    nextUrl: { protocol, origin: `${protocol}//nextUrlOriginFallback` },
  } as unknown as NextRequest;
}

const SAMPLE_HTML =
  '<html><body><canvas></canvas>' +
  '<script src="index.js"></script>' +
  '<script>\nconst GODOT_CONFIG = {"args":[],"canvasResizePolicy":2,"executable":"index"};\nconst engine = new Engine(GODOT_CONFIG);\n</script>' +
  '</body></html>';

describe('injectNonce', () => {
  it('adds a nonce attribute to both script tags', () => {
    const out = injectNonce(SAMPLE_HTML, 'abc123');
    expect(out).toContain('<script nonce="abc123" src="index.js"></script>');
    expect(out).toContain('<script nonce="abc123">');
  });

  it('never double-adds a nonce to an already-nonced tag', () => {
    const already = '<script nonce="existing">console.log(1)</script>';
    const out = injectNonce(already, 'new-nonce');
    expect(out).toBe(already);
  });
});

describe('resolveRequestOrigin', () => {
  it('uses the Host header over nextUrl.origin (the real bug this was written to fix)', () => {
    // Reproduces the actual dev-server mismatch found via a real browser load:
    // nextUrl.origin resolved to "localhost" while the browser was really at
    // "127.0.0.1" -- a different CSP origin, so 'self' refused the fetch.
    const req = makeRequest({ host: '127.0.0.1:3010' });
    expect(resolveRequestOrigin(req)).toBe('http://127.0.0.1:3010');
  });

  it('prefers X-Forwarded-Host over a plain Host header (reverse-proxy/tunnel case)', () => {
    const req = makeRequest({ host: 'internal-backend:3000', 'x-forwarded-host': 'concord-os.org' });
    expect(resolveRequestOrigin(req)).toBe('http://concord-os.org');
  });

  it('uses X-Forwarded-Proto for scheme when present (behind an https-terminating tunnel)', () => {
    const req = makeRequest({ host: 'concord-os.org', 'x-forwarded-proto': 'https' });
    expect(resolveRequestOrigin(req)).toBe('https://concord-os.org');
  });

  it('falls back to nextUrl.protocol when no forwarded-proto header is present', () => {
    const req = makeRequest({ host: '127.0.0.1:3010' }, 'https:');
    expect(resolveRequestOrigin(req)).toBe('https://127.0.0.1:3010');
  });

  it('falls back to nextUrl.origin only when no host header exists at all', () => {
    const req = makeRequest({});
    expect(resolveRequestOrigin(req)).toBe('http://nextUrlOriginFallback');
  });
});

describe('injectConfigArgs', () => {
  it('leaves the HTML untouched when no whitelisted param is present and no default origin is given', () => {
    const params = new URLSearchParams('irrelevant=1');
    expect(injectConfigArgs(SAMPLE_HTML, params)).toBe(SAMPLE_HTML);
  });

  it('defaults CONCORD_FRONTEND_URL to the given origin when the request did not set one', () => {
    const params = new URLSearchParams();
    const out = injectConfigArgs(SAMPLE_HTML, params, 'https://concord-os.org');
    const config = JSON.parse(out.match(/const GODOT_CONFIG = (\{.*\});/)![1]);
    // CONCORD_BACKEND_URL co-defaults to the same origin (see the dedicated
    // test below) — both land here since neither was explicitly set.
    expect(config.args).toEqual([
      '--',
      'CONCORD_FRONTEND_URL=https://concord-os.org',
      'CONCORD_BACKEND_URL=https://concord-os.org',
    ]);
  });

  it('an explicit CONCORD_FRONTEND_URL query param wins over the default origin', () => {
    const params = new URLSearchParams({ CONCORD_FRONTEND_URL: 'https://cdn.example.com' });
    const out = injectConfigArgs(SAMPLE_HTML, params, 'https://concord-os.org');
    const config = JSON.parse(out.match(/const GODOT_CONFIG = (\{.*\});/)![1]);
    // CONCORD_BACKEND_URL still defaults independently; only the frontend
    // one was overridden.
    expect(config.args).toEqual([
      '--',
      'CONCORD_FRONTEND_URL=https://cdn.example.com',
      'CONCORD_BACKEND_URL=https://concord-os.org',
    ]);
  });

  it('an explicit CONCORD_BACKEND_URL query param wins over the default origin', () => {
    const params = new URLSearchParams({ CONCORD_BACKEND_URL: 'https://api.example.com' });
    const out = injectConfigArgs(SAMPLE_HTML, params, 'https://concord-os.org');
    const config = JSON.parse(out.match(/const GODOT_CONFIG = (\{.*\});/)![1]);
    // CONCORD_FRONTEND_URL still defaults independently; only the backend
    // one was overridden.
    expect(config.args).toEqual([
      '--',
      'CONCORD_FRONTEND_URL=https://concord-os.org',
      'CONCORD_BACKEND_URL=https://api.example.com',
    ]);
  });

  it('splices whitelisted params into GODOT_CONFIG.args as "--" + KEY=VALUE entries', () => {
    const params = new URLSearchParams({
      CONCORD_GATEWAY_URL: 'ws://127.0.0.1:5199/godot-ws',
      CONCORD_WORLD_ID: 'tunya',
      irrelevant: 'ignored',
    });
    const out = injectConfigArgs(SAMPLE_HTML, params);
    const match = out.match(/const GODOT_CONFIG = (\{.*\});/);
    expect(match).not.toBeNull();
    const config = JSON.parse(match![1]);
    expect(config.args).toEqual([
      '--',
      'CONCORD_GATEWAY_URL=ws://127.0.0.1:5199/godot-ws',
      'CONCORD_WORLD_ID=tunya',
    ]);
    // Every other GODOT_CONFIG field survives the round-trip untouched.
    expect(config.canvasResizePolicy).toBe(2);
    expect(config.executable).toBe('index');
  });

  it('never includes a non-whitelisted query param, even with a matching-looking name', () => {
    const params = new URLSearchParams({ irrelevant: 'ignored', CONCORD_WORLD_ID: 'tunya' });
    const out = injectConfigArgs(SAMPLE_HTML, params);
    const config = JSON.parse(out.match(/const GODOT_CONFIG = (\{.*\});/)![1]);
    expect(config.args).toEqual(['--', 'CONCORD_WORLD_ID=tunya']);
  });

  it('safely round-trips a value containing characters that need JSON escaping', () => {
    const params = new URLSearchParams({ CONCORD_GODOT_AUTH_TOKEN: 'a.b"c\\d' });
    const out = injectConfigArgs(SAMPLE_HTML, params);
    const config = JSON.parse(out.match(/const GODOT_CONFIG = (\{.*\});/)![1]);
    expect(config.args).toEqual(['--', 'CONCORD_GODOT_AUTH_TOKEN=a.b"c\\d']);
  });

  it('is a no-op when the GODOT_CONFIG marker is not found', () => {
    const html = '<html>no godot config here</html>';
    const params = new URLSearchParams({ CONCORD_WORLD_ID: 'tunya' });
    expect(injectConfigArgs(html, params)).toBe(html);
  });
});
