import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PWA_SERVICE_WORKER_SCOPE, PWA_SERVICE_WORKER_URL } from '@/lib/pwa/registration';

const require = createRequire(import.meta.url);
const policy = require('../../public/sw-policy.js') as {
  CACHE_NAME: string;
  OFFLINE_URL: string;
  PRECACHE_URLS: string[];
  decide: (request: {
    url: string;
    method?: string;
    mode?: string;
    destination?: string;
  }) => string;
  canStore: (
    request: { url: string; method?: string },
    response: { status?: number; type?: string; headers?: Headers | Record<string, string> } | null
  ) => boolean;
  isRetiredCache: (name: string) => boolean;
};

const root = resolve(__dirname, '../..');

function req(url: string, extra: Record<string, string> = {}) {
  return { url, method: 'GET', ...extra };
}

describe('service worker routing policy', () => {
  it('versions the shell cache and precaches only the static shell', () => {
    expect(policy.CACHE_NAME).toBe('concord-shell-v2');
    expect(policy.OFFLINE_URL).toBe('/offline.html');
    expect(policy.PRECACHE_URLS).toContain('/offline.html');
    expect(policy.PRECACHE_URLS.every((url) => !url.startsWith('/api/'))).toBe(true);
    expect(policy.PRECACHE_URLS).not.toContain('/');
  });

  it('retires previous Concord caches and leaves other names', () => {
    expect(policy.isRetiredCache('concord-shell-v1')).toBe(true);
    expect(policy.isRetiredCache('concord-shell-v2')).toBe(false);
    expect(policy.isRetiredCache('unity-cache')).toBe(false);
  });

  it('never intercepts /api/ or non-GET', () => {
    expect(policy.decide(req('https://concord-os.org/api/me'))).toBe('passthrough');
    expect(policy.decide(req('/api/push/vapid-public-key'))).toBe('passthrough');
    expect(policy.decide(req('/api/avatar/1.png', { destination: 'image' }))).toBe('passthrough');
    expect(policy.decide({ url: '/api/chat', method: 'POST' })).toBe('passthrough');
    expect(policy.decide({ url: '/_next/static/chunk.js', method: 'POST' })).toBe('passthrough');
    expect(policy.decide({ url: '/', method: 'POST', mode: 'navigate' })).toBe('passthrough');
  });

  it('serves a navigation offline fallback and cache-first shell assets', () => {
    expect(policy.decide(req('/', { mode: 'navigate' }))).toBe('navigation');
    expect(policy.decide(req('/lenses/studio', { mode: 'navigate' }))).toBe('navigation');
    expect(policy.decide(req('/_next/static/chunks/app.js', { destination: 'script' }))).toBe(
      'static'
    );
    expect(policy.decide(req('/icons/icon-192x192.png', { destination: 'image' }))).toBe('static');
    expect(policy.decide(req('/offline.html'))).toBe('static');
    expect(policy.decide(req('/lenses/chat', { destination: 'document' }))).toBe('passthrough');
  });

  it('refuses to store non-GET, API, non-200, opaque, and Set-Cookie responses', () => {
    const ok = { status: 200, type: 'basic', headers: new Headers() };
    expect(policy.canStore(req('/icons/icon-192x192.png'), ok)).toBe(true);

    expect(policy.canStore({ url: '/icons/icon-192x192.png', method: 'POST' }, ok)).toBe(false);
    expect(policy.canStore(req('/api/me'), ok)).toBe(false);
    expect(policy.canStore(req('/icons/icon-192x192.png'), { status: 500, type: 'basic' })).toBe(
      false
    );
    expect(policy.canStore(req('/icons/icon-192x192.png'), { status: 0, type: 'opaque' })).toBe(
      false
    );
    expect(
      policy.canStore(req('/icons/icon-192x192.png'), { status: 200, type: 'opaqueredirect' })
    ).toBe(false);

    const cookieHeaders = new Headers();
    cookieHeaders.set('set-cookie', 'session=secret');
    expect(
      policy.canStore(req('/icons/icon-192x192.png'), {
        status: 200,
        type: 'basic',
        headers: cookieHeaders,
      })
    ).toBe(false);
    expect(
      policy.canStore(req('/manifest.json'), {
        status: 200,
        type: 'basic',
        headers: { 'Set-Cookie': 'a=b' },
      })
    ).toBe(false);
  });
});

describe('one service worker registration', () => {
  it('points every registrar at /sw.js and keeps the other URL as a shim', () => {
    expect(PWA_SERVICE_WORKER_URL).toBe('/sw.js');
    expect(PWA_SERVICE_WORKER_SCOPE).toBe('/');

    const sources = [
      'components/shell/AppShell.tsx',
      'components/offline/ServiceWorkerPanel.tsx',
      'hooks/useWebPush.ts',
    ];
    for (const rel of sources) {
      const src = readFileSync(resolve(root, rel), 'utf8');
      expect(src).toContain('PWA_SERVICE_WORKER_URL');
      expect(src).not.toMatch(/register\(\s*['"]\/service-worker\.js['"]/);
      expect(src).not.toMatch(/getRegistration\(\s*['"]\/service-worker\.js['"]/);
      expect(src).not.toMatch(/register\(\s*['"]\/sw\.js['"]/);
    }

    const sw = readFileSync(resolve(root, 'public/sw.js'), 'utf8');
    expect(sw).toContain("importScripts('/sw-policy.js')");
    expect(sw).toContain('policy.canStore');
    expect(sw).toContain("addEventListener('push'");
    expect(sw).toContain("addEventListener('notificationclick'");
    expect(sw).toContain('policy.OFFLINE_URL');
    expect(sw).not.toMatch(/pathname\.startsWith\(['"]\/api\/['"]\)/);

    const shim = readFileSync(resolve(root, 'public/service-worker.js'), 'utf8');
    expect(shim).toContain("importScripts('/sw.js')");
    expect(shim).toContain('self.registration.unregister()');
    expect(shim).not.toContain('showNotification');
    expect(shim).not.toContain('cache.put');
  });
});
