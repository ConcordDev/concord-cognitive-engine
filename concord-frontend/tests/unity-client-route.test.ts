import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  injectNonce,
  injectUnityConfig,
  buildUnityConfig,
  resolveRequestOrigin,
  applyUnityWebEmbed,
  resolveUnityIndexPath,
} from '../app/unity-client/index.html/route';
import type { NextRequest } from 'next/server';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function makeRequest(headers: Record<string, string>, protocol = 'http:'): NextRequest {
  const map = new Map(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    headers: { get: (key: string) => map.get(key.toLowerCase()) ?? null },
    nextUrl: { protocol, origin: `${protocol}//nextUrlOriginFallback` },
  } as unknown as NextRequest;
}

const SAMPLE =
  '<html><head></head><body><canvas id="unity-canvas"></canvas><script src="Build/web.loader.js"></script></body></html>';

describe('injectNonce', () => {
  it('adds a nonce to Unity loader script tags', () => {
    const out = injectNonce(SAMPLE, 'n1');
    expect(out).toContain('<script nonce="n1" src="Build/web.loader.js"></script>');
  });
});

describe('buildUnityConfig', () => {
  it('defaults gateway to same-origin /unity-ws', () => {
    const cfg = buildUnityConfig(new URLSearchParams(), 'https://concord-os.org');
    expect(cfg.gatewayUrl).toBe('wss://concord-os.org/unity-ws');
    expect(cfg.worldId).toBe('concordia-hub');
    expect(cfg.token).toBe('');
  });

  it('uses ws:// for http origins', () => {
    const cfg = buildUnityConfig(new URLSearchParams(), 'http://127.0.0.1:3000');
    expect(cfg.gatewayUrl).toBe('ws://127.0.0.1:3000/unity-ws');
  });

  it('lets query params win', () => {
    const cfg = buildUnityConfig(
      new URLSearchParams({
        CONCORD_GATEWAY_URL: 'ws://127.0.0.1:5050/unity-ws',
        CONCORD_WORLD_ID: 'tunya',
        CONCORD_AUTH_TOKEN: 'tok',
      }),
      'https://concord-os.org',
    );
    expect(cfg.gatewayUrl).toBe('ws://127.0.0.1:5050/unity-ws');
    expect(cfg.worldId).toBe('tunya');
    expect(cfg.token).toBe('tok');
  });
});

describe('injectUnityConfig', () => {
  it('injects window.CONCORD_UNITY_CONFIG into <head>', () => {
    const out = injectUnityConfig(SAMPLE, { gatewayUrl: 'wss://x/unity-ws', worldId: 'hub', token: '' }, 'n1');
    expect(out).toContain('window.CONCORD_UNITY_CONFIG=');
    expect(out).toContain('"gatewayUrl":"wss://x/unity-ws"');
    expect(out).toContain('<script nonce="n1">window.CONCORD_UNITY_CONFIG=');
  });
});

describe('resolveRequestOrigin', () => {
  it('uses Host over nextUrl.origin', () => {
    const req = makeRequest({ host: '127.0.0.1:3010' });
    expect(resolveRequestOrigin(req)).toBe('http://127.0.0.1:3010');
  });
});

describe('applyUnityWebEmbed', () => {
  const stock =
    '<html><head></head><body><canvas id="unity-canvas"></canvas><script>canvas.style.width = "960px";\n        canvas.style.height = "600px";\nvar config = { showBanner: unityShowBanner, };</script></body></html>';

  it('full-bleeds the 960×600 desktop canvas and hides the Unity footer', () => {
    const out = applyUnityWebEmbed(stock);
    expect(out).toContain('id="concord-unity-fullbleed"');
    expect(out).toContain('canvas.style.width = "100%"');
    expect(out).toContain('canvas.style.height = "100%"');
    expect(out).not.toContain('960px');
    expect(out).toContain('decompressionFallback: true');
  });

  it('is idempotent', () => {
    const once = applyUnityWebEmbed(stock);
    const twice = applyUnityWebEmbed(once);
    expect(twice.split('concord-unity-fullbleed').length).toBe(2);
    expect(twice.split('decompressionFallback').length).toBe(2);
  });
});

describe('committed Unity WebGL player', () => {
  it('ships export-index + wasm so deploy is not a 404 fallback', () => {
    const root = path.join(__dirname, '..');
    const index = path.join(root, 'public', 'unity-client', 'export-index.html');
    const wasm = path.join(root, 'public', 'unity-client', 'Build', 'concordia.wasm.unityweb');
    expect(fs.existsSync(index), 'public/unity-client/export-index.html missing').toBe(true);
    expect(fs.readFileSync(index, 'utf8')).toContain('concordia.loader.js');
    expect(fs.existsSync(wasm), 'concordia.wasm.unityweb missing from public/').toBe(true);
    expect(fs.statSync(wasm).size).toBeGreaterThan(1_000_000);
    expect(resolveUnityIndexPath()).toBeTruthy();
  });
});
