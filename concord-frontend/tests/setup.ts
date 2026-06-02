import '@testing-library/jest-dom/vitest';
import { configure } from '@testing-library/react';
import { vi, beforeEach } from 'vitest';

// The full `vitest run --coverage` is heavy (v8 instrumentation, jsdom
// environment ~165s); under that load the default 1000ms waitFor timeout flakes
// on components that do an async fetch before first paint (e.g. WalletPage's
// balance card / Buy-CC button). 5s gives ample headroom without masking real
// failures (a genuinely-broken assertion still fails, just later).
configure({ asyncUtilTimeout: 5000 });

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

// Reset mocks + the backing store between tests. clearAllMocks() clears call
// history but keeps the vi.fn(impl) default implementations above.
beforeEach(() => {
  lsStore = {};
  vi.clearAllMocks();
});
