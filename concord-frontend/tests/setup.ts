import '@testing-library/jest-dom/vitest';
import { vi, beforeEach } from 'vitest';

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

// Mock localStorage — store-backed so round-trip reads work (a no-op stub
// silently breaks any hook that writes then reads, e.g. useWorldTravel /
// useAvatarAnimator). Methods stay vi.fn() spies so tests can still assert
// calls or override a specific return value via .mockReturnValue(...).
const localStorageStore = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((k: string) => (localStorageStore.has(k) ? localStorageStore.get(k)! : null)),
  setItem: vi.fn((k: string, v: string) => { localStorageStore.set(k, String(v)); }),
  removeItem: vi.fn((k: string) => { localStorageStore.delete(k); }),
  clear: vi.fn(() => { localStorageStore.clear(); }),
};
Object.defineProperty(window, 'localStorage', {
  value: localStorageMock,
  configurable: true,
});

// Reset mocks between tests
beforeEach(() => {
  vi.clearAllMocks();
  // clearAllMocks wipes call history but not implementations / return-value
  // overrides; re-establish the store-backed impl and clear the store so
  // each test starts from an empty, persisting localStorage (and any prior
  // test's .mockReturnValue override doesn't leak).
  localStorageStore.clear();
  localStorageMock.getItem.mockImplementation((k: string) => (localStorageStore.has(k) ? localStorageStore.get(k)! : null));
  localStorageMock.setItem.mockImplementation((k: string, v: string) => { localStorageStore.set(k, String(v)); });
  localStorageMock.removeItem.mockImplementation((k: string) => { localStorageStore.delete(k); });
  localStorageMock.clear.mockImplementation(() => { localStorageStore.clear(); });
});
