import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { vi, beforeEach } from 'vitest';

// The full `vitest run --coverage` is heavy (v8 instrumentation, jsdom
// environment ~165s); under that load the default 1000ms waitFor timeout flakes
// on components that do an async fetch before first paint (e.g. WalletPage's
// balance card / Buy-CC button). 5s gives ample headroom without masking real
// failures (a genuinely-broken assertion still fails, just later).
configure({ asyncUtilTimeout: 5000 });

// This whole DOM-mock block only applies under the jsdom environment. A
// handful of pure-logic test files (no rendering, no DOM) opt into
// `// @vitest-environment node` — e.g. tests/obsidian-vault-export.test.ts,
// which needs a real single-realm Uint8Array for fflate's zipSync/unzipSync
// (jsdom's own Uint8Array global is a distinct realm from Node's, which
// makes fflate's internal `instanceof Uint8Array` checks silently fail —
// a jsdom/vitest artifact, not a product bug: real browsers have exactly
// one Uint8Array realm). setupFiles run for every test file regardless of
// its per-file environment, so this guard keeps the existing jsdom-suite
// behavior byte-for-byte unchanged while letting node-environment files
// load this file without crashing on `window is not defined`.
if (typeof window !== 'undefined') {
  // Mock window.matchMedia
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  // Mock IntersectionObserver
  class MockIntersectionObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
  }

  Object.defineProperty(window, 'IntersectionObserver', {
    writable: true,
    value: MockIntersectionObserver,
  });

  // Mock ResizeObserver
  class MockResizeObserver {
    observe = vi.fn();
    disconnect = vi.fn();
    unobserve = vi.fn();
  }

  Object.defineProperty(window, 'ResizeObserver', {
    writable: true,
    value: MockResizeObserver,
  });

  // Mock scrollTo
  Object.defineProperty(window, 'scrollTo', {
    writable: true,
    value: vi.fn(),
  });

  // jsdom doesn't implement URL.createObjectURL / revokeObjectURL — map components
  // (leaflet/mapbox-ish) call it at module/import time, so without this they throw
  // on import. Polyfill so the import-smoke net + any map test can load them.
  if (typeof window.URL.createObjectURL !== 'function') {
    window.URL.createObjectURL = vi.fn(() => 'blob:mock');
    window.URL.revokeObjectURL = vi.fn();
  }

  // jsdom's File/Blob doesn't implement `.text()` (a standard Blob-interface
  // method every real browser supports) — file-upload components across this
  // codebase (e.g. ExportToolkit's DecryptedArchive, PortabilityPanel) call
  // `file.text()` on the File a user selects. Without this polyfill any test
  // that fires a file input `change` event throws `f.text is not a function`
  // synchronously inside the component's try/catch, which silently looks like
  // a "not valid JSON" parse failure instead of a real environment gap.
  if (typeof File.prototype.text !== 'function') {
    File.prototype.text = function (this: Blob) {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result ?? ''));
        reader.onerror = () => reject(reader.error);
        reader.readAsText(this);
      });
    };
  }

  // Mock localStorage — a REAL in-memory store (still vi.fn, so .mockReturnValue
  // overrides keep working). The prior bare-vi.fn() stubs never persisted, so any
  // test relying on a getItem/setItem round-trip (avatar compute mode, active
  // world id) failed. Vitest isolates per file, so the store is fresh per file.
  let lsStore: Record<string, string> = {};
  const localStorageMock = {
    getItem: vi.fn((k: string) => (Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null)),
    setItem: vi.fn((k: string, v: unknown) => { lsStore[k] = String(v); }),
    removeItem: vi.fn((k: string) => { delete lsStore[k]; }),
    clear: vi.fn(() => { lsStore = {}; }),
    key: vi.fn((i: number) => Object.keys(lsStore)[i] ?? null),
    get length() { return Object.keys(lsStore).length; },
  };
  Object.defineProperty(window, 'localStorage', {
    value: localStorageMock,
    configurable: true,
  });

  // Reset the backing store between tests.
  beforeEach(() => {
    lsStore = {};
  });
}

// Reset mock call history between tests regardless of environment.
beforeEach(() => {
  vi.clearAllMocks();
});
