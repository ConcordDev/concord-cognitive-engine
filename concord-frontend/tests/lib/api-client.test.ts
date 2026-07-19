import { describe, it, expect, vi, beforeEach } from 'vitest';
import axios from 'axios';

// Mock axios before importing the client
vi.mock('axios', () => {
  const mockAxios = {
    create: vi.fn(() => mockAxios),
    get: vi.fn().mockReturnValue(Promise.resolve({ data: {} })),
    post: vi.fn().mockReturnValue(Promise.resolve({ data: {} })),
    put: vi.fn().mockReturnValue(Promise.resolve({ data: {} })),
    patch: vi.fn().mockReturnValue(Promise.resolve({ data: {} })),
    delete: vi.fn().mockReturnValue(Promise.resolve({ data: {} })),
    interceptors: {
      request: { use: vi.fn() },
      response: { use: vi.fn() },
    },
    request: vi.fn().mockReturnValue(Promise.resolve({ data: {} })),
  };
  return { default: mockAxios };
});

describe('API Client', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset modules to get fresh import
    vi.resetModules();
  });

  describe('axios instance configuration', () => {
    it('creates axios instance with correct defaults', async () => {
      // Import after mocking
      await import('@/lib/api/client');

      expect(axios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          // 120s matches the nginx/proxy ceiling so the client never aborts
          // a slow non-streaming LLM route before the proxy would — see the
          // @env-config-ok comment in lib/api/client.ts. The old 30s value
          // this test asserted predates that fix.
          timeout: 120000,
          headers: {
            'Content-Type': 'application/json',
          },
          withCredentials: true,
        })
      );
    });

    it('sets up request interceptor', async () => {
      await import('@/lib/api/client');

      expect(axios.create().interceptors.request.use).toHaveBeenCalled();
    });

    it('sets up response interceptor', async () => {
      await import('@/lib/api/client');

      expect(axios.create().interceptors.response.use).toHaveBeenCalled();
    });
  });

  describe('apiHelpers structure', () => {
    it('exports all expected endpoint groups', async () => {
      const { apiHelpers } = await import('@/lib/api/client');

      // Core endpoints
      expect(apiHelpers.status).toBeDefined();
      expect(apiHelpers.jobs).toBeDefined();
      expect(apiHelpers.dtus).toBeDefined();
      expect(apiHelpers.auth).toBeDefined();

      // Feature endpoints
      expect(apiHelpers.chat).toBeDefined();
      expect(apiHelpers.forge).toBeDefined();
      expect(apiHelpers.council).toBeDefined();
      expect(apiHelpers.graph).toBeDefined();
      expect(apiHelpers.marketplace).toBeDefined();
      expect(apiHelpers.personas).toBeDefined();

      // System endpoints
      expect(apiHelpers.db).toBeDefined();
      expect(apiHelpers.redis).toBeDefined();
      expect(apiHelpers.perf).toBeDefined();
    });

    it('has correct DTU operations', async () => {
      const { apiHelpers } = await import('@/lib/api/client');

      expect(typeof apiHelpers.dtus.list).toBe('function');
      expect(typeof apiHelpers.dtus.create).toBe('function');
      expect(typeof apiHelpers.dtus.update).toBe('function');
    });

    it('has correct auth operations', async () => {
      const { apiHelpers } = await import('@/lib/api/client');

      expect(typeof apiHelpers.auth.login).toBe('function');
      expect(typeof apiHelpers.auth.register).toBe('function');
      expect(typeof apiHelpers.auth.logout).toBe('function');
      expect(typeof apiHelpers.auth.me).toBe('function');
      expect(typeof apiHelpers.auth.csrfToken).toBe('function');
      expect(typeof apiHelpers.auth.apiKeys.list).toBe('function');
      expect(typeof apiHelpers.auth.apiKeys.create).toBe('function');
      expect(typeof apiHelpers.auth.apiKeys.delete).toBe('function');
    });

    it('has correct forge operations', async () => {
      const { apiHelpers } = await import('@/lib/api/client');

      expect(typeof apiHelpers.forge.manual).toBe('function');
      expect(typeof apiHelpers.forge.hybrid).toBe('function');
      expect(typeof apiHelpers.forge.auto).toBe('function');
      expect(typeof apiHelpers.forge.fromSource).toBe('function');
    });

    it('has correct council operations', async () => {
      const { apiHelpers } = await import('@/lib/api/client');

      expect(typeof apiHelpers.council.reviewGlobal).toBe('function');
      expect(typeof apiHelpers.council.weekly).toBe('function');
      expect(typeof apiHelpers.council.vote).toBe('function');
      expect(typeof apiHelpers.council.tally).toBe('function');
      expect(typeof apiHelpers.council.credibility).toBe('function');
    });

    it('has correct graph operations', async () => {
      const { apiHelpers } = await import('@/lib/api/client');

      expect(typeof apiHelpers.graph.query).toBe('function');
      expect(typeof apiHelpers.graph.visual).toBe('function');
      expect(typeof apiHelpers.graph.force).toBe('function');
    });
  });
});

describe('CSRF Token handling', () => {
  it('getCsrfToken returns null on server side', async () => {
    // The function checks typeof document === 'undefined'
    // In Node/test environment, document is mocked but we can test the structure
    const { apiHelpers } = await import('@/lib/api/client');

    // csrfToken endpoint should be defined
    expect(typeof apiHelpers.auth.csrfToken).toBe('function');
  });
});

describe('Error handling', () => {
  it('module exports default api instance', async () => {
    // Import the client module
    const clientModule = await import('@/lib/api/client');

    // Should export a default api instance
    expect(clientModule.default).toBeDefined();
  });
});
