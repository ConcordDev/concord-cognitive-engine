import axios, { AxiosInstance, AxiosError, InternalAxiosRequestConfig } from 'axios';
import { updateClockOffset } from '../offline/db';
import { useUIStore } from '@/store/ui';
import { fromAxiosError } from '@/lib/errors';
import type {
  CreateDTURequest,
  UpdateDTURequest,
  ChatRequest,
  VoteRequest,
  CredibilityRequest,
  ForgeManualRequest,
  ForgeHybridRequest,
  ForgeAutoRequest,
  ForgeFromSourceRequest,
  GraphQueryRequest,
  GraphVisualParams,
  GraphForceParams,
  PersonaSpeakRequest,
  PersonaAnimateRequest,
  PluginSubmitRequest,
  PluginInstallRequest,
  PluginReviewRequest,
  CreateWebhookRequest,
  CreateAutomationRequest,
  LoginRequest,
  RegisterRequest,
  CreateApiKeyRequest,
} from './generated-types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || '';

/**
 * FE-004: Runtime validation of API base URL.
 * Warns visibly when the app is running against localhost in a non-localhost context,
 * which usually indicates a missing NEXT_PUBLIC_API_URL in production.
 */
if (typeof window !== 'undefined') {
  const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  const apiPointsToLocalhost = BASE_URL.includes('localhost') || BASE_URL.includes('127.0.0.1');

  if (!isLocalhost && apiPointsToLocalhost) {
    console.warn(
      '[Concord] API base URL points to localhost but app is running on %s. ' +
      'Set NEXT_PUBLIC_API_URL to your production backend. Current value: %s',
      window.location.hostname,
      BASE_URL
    );
  }
}

// Create axios instance with defaults
// SECURITY: withCredentials ensures httpOnly cookies are sent with requests
export const api: AxiosInstance = axios.create({
  baseURL: BASE_URL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json',
  },
  withCredentials: true, // SECURITY: Include cookies in cross-origin requests
});

// ---- Retry with exponential backoff for transient server errors ----
const MAX_RETRIES = 3;
const RETRY_STATUS_CODES = new Set([502, 503, 504]);
const RETRY_BASE_DELAY_MS = 1000;

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const config = error.config as InternalAxiosRequestConfig & { _retryCount?: number; _retried?: boolean };
  if (!config) return Promise.reject(error);

  const status = error.response?.status;
  const isRetryable = status && RETRY_STATUS_CODES.has(status);
  const retryCount = config._retryCount || 0;

  if (isRetryable && retryCount < MAX_RETRIES) {
    config._retryCount = retryCount + 1;
    config._retried = true; // Signal to downstream interceptors that this request was already retried
    const delay = RETRY_BASE_DELAY_MS * Math.pow(2, retryCount); // 1s, 2s, 4s
    console.warn(`[API] Retrying ${config.method?.toUpperCase()} ${config.url} (attempt ${config._retryCount}/${MAX_RETRIES}) after ${delay}ms`);
    await new Promise(resolve => setTimeout(resolve, delay));
    return api.request(config);
  }

  return Promise.reject(error);
});

// Helper to get CSRF token from cookie
function getCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(/csrf_token=([^;]+)/);
  return match ? match[1] : null;
}

// ---- Idempotency Key Generation (Category 2: Concurrency) ----
function generateIdempotencyKey(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `idem_${timestamp}_${random}`;
}

// Request interceptor for CSRF protection + idempotency
// SECURITY: API keys and session IDs are now handled via httpOnly cookies only
// This prevents XSS attacks from stealing credentials
api.interceptors.request.use(
  (config: InternalAxiosRequestConfig) => {
    if (typeof window !== 'undefined') {
      // SECURITY: Add CSRF token for state-changing requests
      // Credentials are handled by httpOnly cookies (withCredentials: true)
      const stateChangingMethods = ['POST', 'PUT', 'DELETE', 'PATCH'];
      if (stateChangingMethods.includes(config.method?.toUpperCase() || '')) {
        const csrfToken = getCsrfToken();
        if (csrfToken) {
          config.headers['X-CSRF-Token'] = csrfToken;
        }
        // ---- Idempotency Key (Category 2: Concurrency) ----
        // Auto-generate for state-changing requests that don't already have one
        if (!config.headers['Idempotency-Key']) {
          config.headers['Idempotency-Key'] = generateIdempotencyKey();
        }
      }
    }
    return config;
  },
  (error) => Promise.reject(error)
);

// Response interceptor for error handling + clock sync + observability
api.interceptors.response.use(
  (response) => {
    // ---- Clock Normalization (Category 4: Offline Sync) ----
    const serverDate = response.headers['date'];
    if (serverDate) {
      updateClockOffset(serverDate);
    }

    // ---- Observability (Category 5) ----
    // Track if server replayed an idempotent response
    if (response.headers['x-idempotent-replayed'] === 'true') {
      console.debug('[API] Idempotent replay detected for:', response.config?.url);
    }

    if (response.config?.url?.includes('/api/status')) {
      const auth = (response.data as { infrastructure?: { auth?: { mode?: string; usesJwt?: boolean; usesApiKey?: boolean } } })?.infrastructure?.auth;
      if (auth) {
        useUIStore.getState().setAuthPosture({
          mode: (auth.mode as 'public' | 'apikey' | 'jwt' | 'hybrid') || 'unknown',
          usesJwt: Boolean(auth.usesJwt),
          usesApiKey: Boolean(auth.usesApiKey),
        });
      }
    }

    return response;
  },
  async (error: AxiosError) => {
    if (error.response) {
      const status = error.response.status;

      // SECURITY: Handle CSRF token expiration
      // Guard against infinite 403 retry loops with _csrfRetried flag
      // Also skip CSRF retry if the request was already retried by the transient-error interceptor
      if (status === 403) {
        const config = error.config as InternalAxiosRequestConfig & { _csrfRetried?: boolean; _retried?: boolean };
        const data = error.response.data as { code?: string };
        const isStateChanging = ['POST', 'PUT', 'DELETE', 'PATCH'].includes(config?.method?.toUpperCase() || '');

        if (data?.code === 'CSRF_FAILED' && isStateChanging && !config?._csrfRetried && !config?._retried) {
          // Refresh CSRF token and retry once
          try {
            await api.get('/api/auth/csrf-token');
            // Re-read the fresh CSRF token from cookie for the retried request
            const freshToken = getCsrfToken();
            if (freshToken && config) {
              config.headers['X-CSRF-Token'] = freshToken;
              config._csrfRetried = true;
            }
            return api.request(config!);
          } catch {
            console.error('Failed to refresh CSRF token');
          }
        }
      }

      if (status === 401 && typeof window !== 'undefined') {
        // Don't redirect on auth-check calls — let the component handle it
        const requestUrl = error.config?.url || '';
        if (requestUrl.includes('/api/auth/me') || requestUrl.includes('/api/auth/csrf-token')) {
          return Promise.reject(error);
        }
        // Don't redirect on background GET fetches — a stale query or
        // transient 401 shouldn't force navigation away from the page.
        // Only redirect on user-initiated mutations or explicit nav.
        const isBackgroundFetch = error.config?.method?.toUpperCase() === 'GET';
        if (isBackgroundFetch) {
          return Promise.reject(error);
        }
        // Don't redirect on public pages that don't require auth.
        const path = window.location.pathname;
        const isPublicPage =
          path.startsWith('/legal/') ||
          path === '/' ||
          path === '/login' ||
          path === '/register' ||
          path === '/forgot-password';
        if (!isPublicPage) {
          // Clear entered flag to prevent redirect loop on next visit
          try { localStorage.removeItem('concord_entered'); } catch {}
          window.location.href = '/login';
        }
      }
      // ---- Version Conflict Detection (Category 2: Concurrency) ----
      if (status === 409) {
        const data = error.response.data as { code?: string; currentVersion?: number };
        if (data?.code === 'VERSION_CONFLICT') {
          console.warn('[API] Version conflict detected. Current server version:', data.currentVersion);
        }
      }
      if (status === 429) {
        console.warn('Rate limited. Please slow down requests.');
      }
      if (status >= 500) {
        console.error('Server error:', error.response.data);
      }
    } else if (error.request) {
      console.error('Network error - no response received');
    }

    if (typeof window !== 'undefined') {
      const data = error.response?.data as { ok?: boolean; error?: string; reason?: string; code?: string } | undefined;
      const requestId = (error.response?.headers?.['x-request-id'] as string | undefined) ||
        (error.response?.headers?.['X-Request-ID'] as string | undefined);
      const reason = data?.reason || data?.error || (error.response?.status === 401 ? 'Login required' : error.message);

      // Filter out expected errors that are not system failures:
      // - 404 on resource lookups (DTU, entity, inspect) = expected for missing resources
      // - 401 on /api/auth/me = expected when not logged in
      // - Failed WebSocket connections = expected during reconnection
      const requestPath = error.config?.url || '';
      const requestStatus = error.response?.status;
      const isExpected404 = requestStatus === 404 && /\/(dtus|entity|inspect|dtu_view)\//.test(requestPath);
      const isExpectedAuth = requestStatus === 401 && /\/api\/auth\/me/.test(requestPath);
      const isExpectedError = isExpected404 || isExpectedAuth;

      // Only record unexpected errors in the store
      if (!isExpectedError) {
        useUIStore.getState().addRequestError({
          path: error.config?.url,
          method: error.config?.method?.toUpperCase(),
          status: error.response?.status,
          code: data?.code,
          requestId,
          message: data?.error || error.message,
          reason,
        });
      }

      // Surface API errors as toasts — but throttle to avoid flooding the UI.
      // Only show toasts for user-facing errors, not background fetch failures.
      const store = useUIStore.getState();
      const toastStatus = error.response?.status;
      const isBackgroundFetch = error.config?.method?.toUpperCase() === 'GET';
      const existingToastCount = store.toasts.filter(t => t.type === 'error' || t.type === 'warning').length;
      const shouldThrottle = existingToastCount >= 2;

      if (!shouldThrottle) {
        if (toastStatus === 401) {
          store.addToast({ type: 'warning', message: 'Session expired. Please log in again.' });
        } else if (toastStatus === 403) {
          store.addToast({ type: 'error', message: "You don't have permission to do that." });
        } else if (toastStatus === 429) {
          store.addToast({ type: 'warning', message: 'Too many requests. Please wait a moment.' });
        } else if (toastStatus && toastStatus >= 500 && !isBackgroundFetch) {
          store.addToast({ type: 'error', message: 'Something went wrong on our end. Please try again.' });
        } else if (!error.response && !isBackgroundFetch) {
          store.addToast({ type: 'error', message: 'Unable to connect. Check your internet and try again.' });
        } else if (data?.ok === false && data?.error && !isBackgroundFetch) {
          store.addToast({ type: 'error', message: data.error.replace(/_/g, ' ') });
        }
      }
    }
    return Promise.reject(fromAxiosError(error));
  }
);

// Typed API helper functions matching actual backend endpoints
export const apiHelpers = {
  // System status
  status: {
    get: () => api.get('/api/status'),
  },

  // Jobs management
  jobs: {
    status: () => api.get('/api/jobs/status'),
    toggle: (job: string, enabled: boolean) =>
      api.post('/api/jobs/toggle', { job, enabled }),
  },

  // DTU operations (note: endpoint is /api/dtus - plural)
  dtus: {
    list: (params?: { scope?: string }) => api.get('/api/dtus', { params }),
    paginated: (params: {
      limit?: number;
      offset?: number;
      query?: string;
      tags?: string;
      tier?: string;
      scope?: string;
      page?: number;
      pageSize?: number;
    }) => api.get('/api/dtus/paginated', { params }),
    syncToLens: (id: string, data: { lens: string; scope?: string }) =>
      api.post(`/api/dtus/${id}/sync-lens`, data),
    syncFromGlobal: (dtuId: string) =>
      api.post('/api/dtus/sync-from-global', { dtuId }),

    create: (data: CreateDTURequest) => api.post('/api/dtus', data),

    update: (id: string, patch: UpdateDTURequest) =>
      api.patch(`/api/dtus/${id}`, patch),

    get: (id: string) => api.get(`/api/dtus/${id}`),
    delete: (id: string) => api.delete(`/api/dtus/${id}`),
    search: (query: string) => api.get('/api/dtus/search', { params: { q: query } }),
    lineage: (id: string) => api.get(`/api/dtus/${id}/lineage`),
    stats: () => api.get('/api/dtus/stats'),
    children: (id: string) => api.get(`/api/dtus/${id}/children`),
    myDtus: (params?: { limit?: number; offset?: number }) =>
      api.get('/api/dtus/mine', { params }),

    // .dtu file format export/import
    exportDtu: (id: string) =>
      api.get(`/api/dtus/${id}/export.dtu`, { responseType: 'blob' }),
    importDtu: (data: ArrayBuffer) =>
      api.post('/api/dtus/import', data, { headers: { 'Content-Type': 'application/octet-stream' } }),
  },

  // Ingest operations
  ingest: {
    manual: (data: {
      text: string;
      title?: string;
      tags?: string[];
      makeGlobal?: boolean;
      declaredSourceType?: string;
    }) => api.post('/api/ingest', data),

    queue: (data: {
      text: string;
      title?: string;
      tags?: string[];
      makeGlobal?: boolean;
      declaredSourceType?: string;
    }) => api.post('/api/ingest/queue', data),
  },

  // Autocrawl operations
  autocrawl: {
    manual: (data: {
      url: string;
      makeGlobal?: boolean;
      declaredSourceType?: string;
      tags?: string[];
    }) => api.post('/api/autocrawl', data),

    queue: (data: {
      url: string;
      makeGlobal?: boolean;
      declaredSourceType?: string;
      tags?: string[];
    }) => api.post('/api/autocrawl/queue', data),
  },

  // Chat operations
  chat: {
    send: (message: string, mode: ChatRequest['mode'] = 'overview') =>
      api.post('/api/chat?full=1', { message, mode } satisfies ChatRequest),

    ask: (message: string, mode: ChatRequest['mode'] = 'overview') =>
      api.post('/api/ask?full=1', { message, mode } satisfies ChatRequest),

    feedback: (data: { sessionId: string; rating: 'up' | 'down' | number; messageIndex?: number; comment?: string }) =>
      api.post('/api/chat/feedback', data),

    webMetrics: () => api.get('/api/chat/web-metrics'),
  },

  // Cognitive status (combined)
  cognitive: {
    status: () => api.get('/api/cognitive/status'),
  },

  // LOAF system status (aggregated)
  loaf: {
    status: () => api.get('/api/loaf/status'),
  },

  // Dream mode (synthesis + capture pipeline)
  dream: {
    run: (data?: { seed?: string }) => api.post('/api/dream', data || {}),
    capture: (text: string, tags?: string[], title?: string) =>
      api.post('/api/dream/capture', { text, tags, title }),
    history: (limit = 50) => api.get(`/api/dream/history?limit=${limit}`),
    convergences: () => api.get('/api/dream/convergences'),
  },

  // Reseed DTUs
  reseed: {
    run: (force: boolean = false) => api.post('/api/reseed', { force }),
  },

  // Forge (DTU creation modes)
  forge: {
    manual: (data: ForgeManualRequest) =>
      api.post('/api/forge/manual', data),
    hybrid: (data: ForgeHybridRequest) =>
      api.post('/api/forge/hybrid', data),
    auto: (data: ForgeAutoRequest) =>
      api.post('/api/forge/auto', data),
    fromSource: (data: ForgeFromSourceRequest) =>
      api.post('/api/forge/fromSource', data),
  },

  // Simulations (worldmodel)
  simulations: {
    list: () => api.get('/api/worldmodel/simulations'),
    get: (simId: string) => api.get(`/api/worldmodel/simulations/${simId}`),
    run: (data: { prompt?: string }) => api.post('/api/worldmodel/simulate', data),
  },

  // Personas
  personas: {
    list: () => api.get('/api/personas'),

    speak: (personaId: string, text: string) =>
      api.post(`/api/personas/${personaId}/speak`, { text } satisfies PersonaSpeakRequest),

    animate: (personaId: string, kind: PersonaAnimateRequest['kind'] = 'talk') =>
      api.post(`/api/personas/${personaId}/animate`, { kind } satisfies PersonaAnimateRequest),
  },

  // Council (review + proposal voting)
  council: {
    reviewGlobal: () => api.post('/api/council/review-global', {}),
    weekly: () => api.post('/api/council/weekly', {}),
    vote: (data: VoteRequest & { proposalId?: string }) =>
      api.post('/api/council/vote', data),
    tally: (dtuId: string) => api.get(`/api/council/tally/${dtuId}`),
    credibility: (data: CredibilityRequest) =>
      api.post('/api/council/credibility', data),
    proposePromotion: (dtuId: string, reason?: string) =>
      api.post('/api/council/propose-promotion', { dtuId, reason }),
    proposals: (status?: string) =>
      api.get('/api/council/proposals', { params: status ? { status } : {} }),
  },

  // Swarm
  swarm: {
    run: (prompt: string, count: number = 6) =>
      api.post('/api/swarm', { prompt, count }),
  },

  // Credits (wallet system)
  credits: {
    getWallet: (walletId: string) =>
      api.post('/api/credits/wallet', { walletId }),

    earn: (walletId: string, amount: number, reason: string = 'quest') =>
      api.post('/api/credits/earn', { walletId, amount, reason }),

    spend: (walletId: string, amount: number, reason: string = 'spend') =>
      api.post('/api/credits/spend', { walletId, amount, reason }),
  },

  // Note: Marketplace is defined in v4.0 APIs section below

  // Global feed
  universe: {
    stats: () => api.get('/api/universe/stats'),
    dtus: (params?: { domain?: string; limit?: number }) => api.get('/api/universe/dtus', { params }),
    initialize: (data: { mode: string; domains?: string[] }) => api.post('/api/universe/initialize', data),
    preferences: (prefs: Record<string, unknown>) => api.put('/api/universe/preferences', prefs),
  },

  globalTimeline: {
    browse: (params?: { domain?: string; search?: string; page?: number }) => api.get('/api/global/browse', { params }),
    submit: (data: { dtuId: string; reason?: string }) => api.post('/api/global/submit', data),
    sync: (data: { dtuIds: string[] }) => api.post('/api/global/sync', data),
    review: (data: { submissionId: string; action: string; reason?: string }) => api.post('/api/global/review', data),
    queue: () => api.get('/api/global/queue'),
    contributions: () => api.get('/api/global/contributions'),
  },

  global: {
    feed: () => api.get('/api/global/feed'),
    // "Everything Real" paginated endpoints
    dtusPaginated: (params?: { q?: string; limit?: number; offset?: number; visibility?: string; tier?: string }) =>
      api.get('/api/dtus/paginated', { params }),
    artifactsPaginated: (params?: { q?: string; limit?: number; offset?: number; type?: string; visibility?: string }) =>
      api.get('/api/artifacts/paginated', { params }),
    jobsPaginated: (params?: { q?: string; limit?: number; offset?: number; type?: string; status?: string }) =>
      api.get('/api/jobs/paginated', { params }),
    marketplacePaginated: (params?: { q?: string; limit?: number; offset?: number; visibility?: string }) =>
      api.get('/api/marketplace/paginated', { params }),
  },

  // Durable artifacts (Everything Real)
  durableArtifacts: {
    upload: (data: { type?: string; title?: string; data: string; mime_type?: string; filename?: string; visibility?: string; owner_user_id?: string }) =>
      api.post('/api/artifacts/upload', data),
    download: (id: string, userId?: string) =>
      api.get(`/api/artifacts/${id}/download`, { params: { user_id: userId }, responseType: 'blob' }),
    info: (id: string) => api.get(`/api/artifacts/${id}/info`),
  },

  // Durable marketplace (Everything Real)
  durableMarketplace: {
    createListing: (data: { owner_user_id: string; title: string; description?: string; price_cents?: number; currency?: string; license_id?: string }) =>
      api.post('/api/marketplace/listings', data),
    attachAsset: (listingId: string, artifactId: string) =>
      api.post(`/api/marketplace/listings/${listingId}/assets`, { artifact_id: artifactId }),
    publish: (listingId: string) => api.post(`/api/marketplace/listings/${listingId}/publish`),
    getListing: (id: string) => api.get(`/api/marketplace/listings/${id}`),
    purchase: (listingId: string, userId: string) =>
      api.post(`/api/marketplace/listings/${listingId}/purchase`, { user_id: userId }),
  },

  // Durable studio (Everything Real)
  durableStudio: {
    createProject: (data: { name?: string; bpm?: number; key?: string; scale?: string; genre?: string; owner_user_id?: string }) =>
      api.post('/api/studio/projects', data),
    listProjects: (params?: { owner_user_id?: string; limit?: number; offset?: number }) =>
      api.get('/api/studio/projects', { params }),
    getProject: (id: string) => api.get(`/api/studio/projects/${id}`),
    updateProject: (id: string, data: Record<string, unknown>) => api.patch(`/api/studio/projects/${id}`, data),
    addTrack: (projectId: string, data: { name?: string; type?: string; instrument_id?: string }) =>
      api.post(`/api/studio/projects/${projectId}/tracks`, data),
    addClip: (projectId: string, trackId: string, data: Record<string, unknown>) =>
      api.post(`/api/studio/projects/${projectId}/tracks/${trackId}/clips`, data),
    addEffects: (projectId: string, trackId: string, chain: unknown[]) =>
      api.post(`/api/studio/projects/${projectId}/tracks/${trackId}/effects`, { chain }),
    render: (projectId: string, data?: { format?: string; settings?: Record<string, unknown> }) =>
      api.post(`/api/studio/${projectId}/render`, data),
    vocalAnalyze: (data: { project_id: string; track_id: string; owner_user_id?: string }) =>
      api.post('/api/studio/vocal/analyze', data),
    vocalProcess: (data: { project_id: string; track_id: string; corrections?: string[]; owner_user_id?: string }) =>
      api.post('/api/studio/vocal/process', data),
    masterJob: (data: { project_id: string; preset?: string; target_lufs?: number; format?: string; owner_user_id?: string }) =>
      api.post('/api/studio/master/job', data),
  },

  // Durable distribution (Everything Real)
  durableDistribution: {
    createRelease: (data: { artifact_id: string; title?: string; artist_name?: string; license_terms?: string; visibility?: string; owner_user_id?: string }) =>
      api.post('/api/distribution/releases', data),
  },

  // Lens items sync
  lensItems: {
    sync: (data: { lens_id: string; artifact_id?: string; dtu_id?: string; owner_user_id?: string; metadata?: Record<string, unknown> }) =>
      api.post('/api/lens-items/sync', data),
    list: (lensId: string) => api.get(`/api/lens-items/${lensId}`),
  },

  // Events log
  eventsLog: {
    list: (params?: { type?: string; limit?: number; offset?: number }) =>
      api.get('/api/events/log', { params }),
  },

  // Schema version
  schemaVersion: {
    get: () => api.get('/api/schema/version'),
  },

  // ═══════════════════════════════════════════════════════════════
  // Guidance Layer v1
  // ═══════════════════════════════════════════════════════════════

  guidance: {
    // System health
    health: () => api.get('/api/system/health'),

    // Enhanced paginated events with scope/type filters
    eventsPaginated: (params?: { type?: string; scope?: string; entityType?: string; entityId?: string; limit?: number; offset?: number }) =>
      api.get('/api/events/paginated', { params }),

    // Object Inspector
    inspect: (entityType: string, entityId: string) =>
      api.get(`/api/inspect/${entityType}/${entityId}`),

    // Undo
    undo: (undoToken: string, userId?: string) =>
      api.post('/api/undo', { undoToken, user_id: userId }),

    // Action preview (dry-run)
    previewAction: (data: { action: string; entityType?: string; entityId?: string; params?: Record<string, unknown> }) =>
      api.post('/api/preview-action', data),

    // Context suggestions
    suggestions: (lens?: string, userId?: string) =>
      api.get('/api/guidance/suggestions', { params: { lens, user_id: userId } }),

    // First-win wizard status
    firstWin: () => api.get('/api/guidance/first-win'),

    // Guided DTU CRUD (with undo tokens)
    createDtu: (data: { title?: string; body?: Record<string, unknown>; tags?: string[]; visibility?: string; tier?: string; owner_user_id?: string }) =>
      api.post('/api/dtus/guided', data),
    updateDtu: (id: string, data: Record<string, unknown>) =>
      api.put(`/api/dtus/guided/${id}`, data),
    deleteDtu: (id: string) =>
      api.delete(`/api/dtus/guided/${id}`),

    // Guided lens sync (with undo)
    syncLensItem: (data: { lens_id: string; artifact_id?: string; dtu_id?: string; owner_user_id?: string; metadata?: Record<string, unknown> }) =>
      api.post('/api/lens-items/guided-sync', data),

    // Guided marketplace publish (with undo)
    publishListing: (listingId: string) =>
      api.post(`/api/marketplace/listings/${listingId}/guided-publish`),
  },

  // ═══════════════════════════════════════════════════════════════
  // Economy System
  // ═══════════════════════════════════════════════════════════════

  economy: {
    // Balance
    balance: (userId?: string) =>
      api.get('/api/economy/balance', { params: { user_id: userId } }),

    // Transaction history
    history: (params?: { user_id?: string; type?: string; limit?: number; offset?: number }) =>
      api.get('/api/economy/history', { params }),

    // Token purchase
    buy: (data: { user_id?: string; amount: number; source?: string }) =>
      api.post('/api/economy/buy', data),

    // Transfer
    transfer: (data: { from?: string; to: string; amount: number; metadata?: Record<string, unknown> }) =>
      api.post('/api/economy/transfer', data),

    // Marketplace purchase
    marketplacePurchase: (data: { buyer_id?: string; seller_id: string; amount: number; listing_id?: string }) =>
      api.post('/api/economy/marketplace-purchase', data),

    // Withdrawals
    withdraw: (data: { user_id?: string; amount: number }) =>
      api.post('/api/economy/withdraw', data),
    withdrawals: (params?: { user_id?: string; limit?: number; offset?: number }) =>
      api.get('/api/economy/withdrawals', { params }),
    cancelWithdrawal: (withdrawalId: string, userId?: string) =>
      api.post(`/api/economy/withdrawals/${withdrawalId}/cancel`, { user_id: userId }),

    // Info
    fees: () => api.get('/api/economy/fees'),
    platformBalance: () => api.get('/api/economy/platform-balance'),
    integrity: () => api.get('/api/economy/integrity'),

    // Admin
    adminTransactions: (params?: { type?: string; status?: string; limit?: number; offset?: number }) =>
      api.get('/api/economy/admin/transactions', { params }),
    adminWithdrawals: (params?: { status?: string; limit?: number; offset?: number }) =>
      api.get('/api/economy/admin/withdrawals', { params }),
    adminApproveWithdrawal: (withdrawalId: string, reviewerId?: string) =>
      api.post(`/api/economy/admin/withdrawals/${withdrawalId}/approve`, { reviewer_id: reviewerId }),
    adminRejectWithdrawal: (withdrawalId: string, reviewerId?: string) =>
      api.post(`/api/economy/admin/withdrawals/${withdrawalId}/reject`, { reviewer_id: reviewerId }),
    adminProcessWithdrawal: (withdrawalId: string) =>
      api.post(`/api/economy/admin/withdrawals/${withdrawalId}/process`),
    adminReverse: (transactionId: string, reason?: string) =>
      api.post('/api/economy/admin/reverse', { transaction_id: transactionId, reason }),

    // Stripe Checkout
    createCheckout: (tokens: number, userId?: string) =>
      api.post('/api/economy/buy/checkout', { tokens, user_id: userId }),

    // Economy config (Stripe enabled, fee schedule, limits)
    config: () => api.get('/api/economy/config'),

    // Stripe Connect
    connectStripe: (userId?: string) =>
      api.post('/api/stripe/connect/onboard', { user_id: userId }),
    connectStatus: (userId?: string) =>
      api.get('/api/stripe/connect/status', { params: { user_id: userId } }),

    // Merit Credit Score
    meritScore: (userId: string) =>
      api.get(`/api/economy/merit-score/${userId}`),

    // Royalty Cascade Visualization
    royaltyCascade: (dtuId: string) =>
      api.get(`/api/economy/royalty-cascade/${dtuId}`),
    creatorRoyalties: (creatorId: string, params?: { limit?: number; offset?: number }) =>
      api.get(`/api/economy/royalties/creator/${creatorId}`, { params }),

    // Admin Treasury Dashboard
    adminTreasury: () =>
      api.get('/api/admin/treasury'),

    // Invoice DTU creation
    createInvoice: (data: { lineItems: Array<{ description: string; quantity: number; unitPrice: number }>; taxRate?: number; dueDate?: string; payerName?: string; payeeName?: string; notes?: string; currency?: string }) =>
      api.post('/api/economy/invoice', data),

    // Tax summary DTU generation
    createTaxSummary: (data?: { year?: number }) =>
      api.post('/api/economy/tax-summary', data || {}),
  },

  // Macros
  macros: {
    run: (recipeName: string, ctx?: Record<string, unknown>) =>
      api.post('/api/macros/run', { recipeName, ctx }),
  },

  // Events
  events: {
    list: () => api.get('/api/events'),
  },

  // v4.0 APIs

  // Plugin Marketplace
  marketplace: {
    listings: () => api.get('/api/marketplace/listings'),
    browse: (params?: { search?: string; category?: string; page?: number }) =>
      api.get('/api/marketplace/browse', { params }),
    submit: (data: PluginSubmitRequest) =>
      api.post('/api/marketplace/submit', data),
    install: (data: PluginInstallRequest) =>
      api.post('/api/marketplace/install', data),
    installed: () => api.get('/api/marketplace/installed'),
    review: (data: PluginReviewRequest) =>
      api.post('/api/marketplace/review', data),
  },

  // Graph Queries
  graph: {
    query: (dsl: string) => api.post('/api/graph/query', { dsl } satisfies GraphQueryRequest),
    visual: (params?: GraphVisualParams & { includeShadow?: boolean }) =>
      api.get('/api/graph/visual', { params }),
    force: (params?: GraphForceParams) =>
      api.get('/api/graph/force', { params }),
  },

  // Feature 44: Prediction Markets (wired to LOAF hypothesis market)
  predictions: {
    list: (params?: { state?: string; domain?: string }) =>
      api.get('/api/predictions', { params }),
    create: (data: { claim: string; evidence?: Array<{ text: string; confidence?: number }>; domain?: string }) =>
      api.post('/api/predictions', data),
    resolve: (id: string) =>
      api.post(`/api/predictions/${id}/resolve`, {}),
    leaderboard: (params?: { limit?: number }) =>
      api.get('/api/predictions/leaderboard', { params }),
  },

  // Feature 45: Plugin Manager
  plugins: {
    list: () => api.get('/api/plugins'),
    get: (pluginId: string) => api.get(`/api/plugins/${pluginId}`),
    metrics: () => api.get('/api/plugins/metrics'),
    remove: (pluginId: string) => api.delete(`/api/plugins/${pluginId}`),
  },

  // Feature 46: Macro Explorer
  adminMacros: {
    all: () => api.get('/api/admin/macros'),
    domains: () => api.get('/api/macros/domains'),
    byDomain: (domain: string) => api.get(`/api/macros/${domain}`),
  },

  // Schema System
  schema: {
    list: () => api.get('/api/schema'),
    create: (data: { name: string; kind: string; fields: unknown[] }) =>
      api.post('/api/schema', data),
    validate: (data: { schemaName: string; data: unknown }) =>
      api.post('/api/schema/validate', data),
    apply: (data: { schemaName: string; dtuId: string; data: unknown }) =>
      api.post('/api/schema/apply', data),
  },

  // Auto-Tagging
  autotag: {
    analyze: (data: { dtuId?: string; content?: string }) =>
      api.post('/api/autotag/analyze', data),
    apply: (data: { dtuId: string; tags?: string[]; domain?: string }) =>
      api.post('/api/autotag/apply', data),
    batch: (data: { tier?: string; limit?: number; dryRun?: boolean }) =>
      api.post('/api/autotag/batch', data),
  },

  // Visual
  visual: {
    moodboard: (params?: { tags?: string; tier?: string; maxNodes?: number }) =>
      api.get('/api/visual/moodboard', { params }),
    sunburst: (params?: { maxDepth?: number; maxNodes?: number }) =>
      api.get('/api/visual/sunburst', { params }),
    timeline: (params?: { startDate?: string; endDate?: string; limit?: number }) =>
      api.get('/api/visual/timeline', { params }),
  },

  // Whiteboard
  whiteboard: {
    list: () => api.get('/api/whiteboards'),
    get: (id: string) => api.get(`/api/whiteboard/${id}`),
    create: (data: { title: string; linkedDtus?: string[] }) =>
      api.post('/api/whiteboard', data),
    update: (id: string, data: { elements?: unknown[]; linkedDtus?: string[] }) =>
      api.put(`/api/whiteboard/${id}`, data),
  },

  // Automations
  automations: {
    list: () => api.get('/api/automations'),
    create: (data: CreateAutomationRequest) =>
      api.post('/api/automations', data),
    run: (id: string, triggerData?: unknown) =>
      api.post(`/api/automations/${id}/run`, triggerData || {}),
    delete: (id: string) => api.delete(`/api/automations/${id}`),
  },

  // Integrations
  integrations: {
    list: () => api.get('/api/integrations'),
    obsidianExport: (data: { dtuIds?: string[]; includeLineage?: boolean }) =>
      api.post('/api/obsidian/export', data),
    obsidianImport: (files: unknown[]) => api.post('/api/obsidian/import', { files }),
    notionImport: (pages: unknown[]) => api.post('/api/notion/import', { pages }),
  },

  // Database & Performance
  db: {
    status: () => api.get('/api/db/status'),
    migrate: () => api.post('/api/db/migrate', {}),
    sync: (batchSize?: number) => api.post('/api/db/sync', { batchSize }),
  },

  redis: {
    stats: () => api.get('/api/redis/stats'),
  },

  perf: {
    metrics: () => api.get('/api/perf/metrics'),
    gc: () => api.post('/api/perf/gc', {}),
  },

  backpressure: {
    status: () => api.get('/api/backpressure/status'),
  },

  // PWA & Mobile
  pwa: {
    manifest: () => api.get('/manifest.json'),
    swConfig: () => api.get('/api/pwa/sw-config'),
  },

  mobile: {
    shortcuts: () => api.get('/api/mobile/shortcuts'),
    dtu: (id: string) => api.get(`/api/mobile/dtu/${id}`),
  },

  // =============================================
  // NEW: Backend systems previously not connected
  // =============================================

  // Affect Translation Spine (ATS)
  affect: {
    state: (sessionId?: string) =>
      api.get('/api/affect/state', { params: { sessionId } }),
    emit: (sessionId: string, event: { type: string; intensity: number; polarity: number; payload?: unknown }) =>
      api.post('/api/affect/event', { sessionId, ...event }),
    policy: (sessionId?: string) =>
      api.get('/api/affect/policy', { params: { sessionId } }),
    reset: (sessionId: string, mode?: string) =>
      api.post('/api/affect/reset', { sessionId, mode }),
    events: (sessionId: string) =>
      api.get('/api/affect/events', { params: { sessionId } }),
    health: () => api.get('/api/affect/health'),
  },

  // Goals system
  goals: {
    list: () => api.get('/api/goals'),
    get: (goalId: string) => api.get(`/api/goals/${goalId}`),
    create: (data: { title: string; description?: string; targetDate?: string; priority?: string }) =>
      api.post('/api/goals', data),
    progress: (goalId: string, data: { progress: number; note?: string }) =>
      api.post(`/api/goals/${goalId}/progress`, data),
    complete: (goalId: string) => api.post(`/api/goals/${goalId}/complete`, {}),
    activate: (goalId: string) => api.post(`/api/goals/${goalId}/activate`, {}),
    abandon: (goalId: string) => api.post(`/api/goals/${goalId}/abandon`, {}),
    status: () => api.get('/api/goals/status'),
    autoPropose: () => api.post('/api/goals/auto-propose', {}),
    config: () => api.get('/api/goals/config'),
  },

  // Metacognition
  metacognition: {
    status: () => api.get('/api/metacognition/status'),
    blindspots: () => api.get('/api/metacognition/blindspots'),
    calibration: () => api.get('/api/metacognition/calibration'),
    introspection: () => api.get('/api/metacognition/introspection-status'),
    predict: (data: { claim: string; confidence: number; domain?: string }) =>
      api.post('/api/metacognition/predict', data),
    resolve: (predictionId: string, outcome: boolean) =>
      api.post(`/api/metacognition/predictions/${predictionId}/resolve`, { outcome }),
    assess: (data: { domain: string }) =>
      api.post('/api/metacognition/assess', data),
    introspect: (data: { focus?: string }) =>
      api.post('/api/metacognition/introspect', data),
    strategy: (data: { strategy: string; params?: Record<string, unknown> }) =>
      api.post('/api/metacognition/strategy', data),
  },

  // Meta-learning
  metalearning: {
    status: () => api.get('/api/metalearning/status'),
    strategies: () => api.get('/api/metalearning/strategies'),
    bestStrategy: () => api.get('/api/metalearning/strategies/best'),
    createStrategy: (data: { name: string; type: string; params?: Record<string, unknown> }) =>
      api.post('/api/metalearning/strategies', data),
    adaptStrategy: (strategyId: string) =>
      api.post(`/api/metalearning/strategies/${strategyId}/adapt`, {}),
    recordOutcome: (strategyId: string, data: { success: boolean; metrics?: Record<string, unknown> }) =>
      api.post(`/api/metalearning/strategies/${strategyId}/outcome`, data),
    curriculum: (data: { topic: string }) =>
      api.post('/api/metalearning/curriculum', data),
  },

  // Reasoning chains
  reasoning: {
    create: (data: { premise: string; type?: string }) =>
      api.post('/api/reasoning/chains', data),
    addStep: (chainId: string, data: { content: string; type?: string }) =>
      api.post(`/api/reasoning/chains/${chainId}/steps`, data),
    conclude: (chainId: string) =>
      api.post(`/api/reasoning/chains/${chainId}/conclude`, {}),
    validate: (stepId: string) =>
      api.post(`/api/reasoning/steps/${stepId}/validate`, {}),
    list: () => api.get('/api/reasoning/chains'),
    trace: (chainId: string) => api.get(`/api/reasoning/chains/${chainId}/trace`),
    status: () => api.get('/api/reasoning/status'),
  },

  // Hypothesis testing
  hypothesis: {
    list: () => api.get('/api/hypothesis'),
    get: (hypothesisId: string) => api.get(`/api/hypothesis/${hypothesisId}`),
    create: (data: { statement: string; domain?: string; evidence?: string[] }) =>
      api.post('/api/hypothesis', data),
    evaluate: (hypothesisId: string) =>
      api.post(`/api/hypothesis/${hypothesisId}/evaluate`, {}),
    addEvidence: (hypothesisId: string, data: { evidence: string; supports: boolean }) =>
      api.post(`/api/hypothesis/${hypothesisId}/evidence`, data),
    experiment: (hypothesisId: string, data: { design?: string }) =>
      api.post(`/api/hypothesis/${hypothesisId}/experiment`, data),
    status: () => api.get('/api/hypothesis/status'),
  },

  // Inference engine
  inference: {
    status: () => api.get('/api/inference/status'),
    facts: (data: { facts: string[] }) =>
      api.post('/api/inference/facts', data),
    rules: (data: { rules: unknown[] }) =>
      api.post('/api/inference/rules', data),
    query: (data: { query: string }) =>
      api.post('/api/inference/query', data),
    syllogism: (data: { major: string; minor: string }) =>
      api.post('/api/inference/syllogism', data),
    forwardChain: (data: { facts?: string[] }) =>
      api.post('/api/inference/forward-chain', data),
  },

  // Agent system
  agents: {
    list: () => api.get('/api/agents'),
    get: (id: string) => api.get(`/api/agents/${id}`),
    status: () => api.get('/api/agents/status'),
    spawnResearch: (topic: string) => api.post('/api/agents/spawn-research', { topic }),
    create: (data: { name: string; type?: string; config?: Record<string, unknown> }) =>
      api.post('/api/agents', data),
    enable: (id: string) => api.post(`/api/agents/${id}/enable`, {}),
    tick: (id: string) => api.post(`/api/agents/${id}/tick`, {}),
  },

  // Transfer learning
  transfer: {
    history: () => api.get('/api/transfer/history'),
    analogies: (data: { source: string; target?: string }) =>
      api.post('/api/transfer/analogies', data),
    apply: (data: { patternId: string; targetDomain: string }) =>
      api.post('/api/transfer/apply', data),
    classifyDomain: (data: { content: string }) =>
      api.post('/api/transfer/classify-domain', data),
    extractPattern: (data: { dtuId: string }) =>
      api.post('/api/transfer/extract-pattern', data),
  },

  // Spaced repetition (SRS)
  srs: {
    due: () => api.get('/api/srs/due'),
    add: (dtuId: string) => api.post(`/api/srs/${dtuId}/add`, {}),
    review: (dtuId: string, data: { quality: number }) =>
      api.post(`/api/srs/${dtuId}/review`, data),
  },

  // Commonsense knowledge
  commonsense: {
    facts: () => api.get('/api/commonsense/facts'),
    addFact: (data: { subject: string; relation: string; object: string }) =>
      api.post('/api/commonsense/facts', data),
    query: (data: { query: string }) =>
      api.post('/api/commonsense/query', data),
    surface: (dtuId: string) =>
      api.post(`/api/commonsense/surface/${dtuId}`, {}),
    assumptions: (dtuId: string) =>
      api.get(`/api/commonsense/assumptions/${dtuId}`),
    status: () => api.get('/api/commonsense/status'),
  },

  // Explanation generation
  explanation: {
    recent: () => api.get('/api/explanation/recent'),
    status: () => api.get('/api/explanation/status'),
    generate: (data: { topic: string; depth?: string }) =>
      api.post('/api/explanation', data),
    forDtu: (dtuId: string) =>
      api.post(`/api/explanation/dtu/${dtuId}`, {}),
  },

  // Voice & multimodal
  voice: {
    transcribe: (data: FormData) =>
      api.post('/api/voice/transcribe', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
    ingest: (data: FormData) =>
      api.post('/api/voice/ingest', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
    tts: (data: { text: string; voice?: string }) =>
      api.post('/api/voice/tts', data, { responseType: 'blob' }),
  },

  // Daily notes & reminders
  daily: {
    get: () => api.get('/api/daily'),
    list: () => api.get('/api/daily/list'),
    digest: () => api.post('/api/digest', {}),
    getDigest: () => api.get('/api/digest'),
    createReminder: (data: { title: string; dueAt: string; dtuId?: string }) =>
      api.post('/api/reminders', data),
    dueReminders: () => api.get('/api/reminders/due'),
    completeReminder: (id: string) =>
      api.post(`/api/reminders/${id}/complete`, {}),
  },

  // Temporal reasoning
  temporal: {
    validate: (data: { claims: unknown[] }) =>
      api.post('/api/temporal/validate', data),
    recency: (data: { dtuIds: string[] }) =>
      api.post('/api/temporal/recency', data),
    frame: (data: { name: string; start: string; end: string }) =>
      api.post('/api/temporal/frame', data),
    frames: () => api.get('/api/temporal/frames'),
    sim: (data: { scenario: string; timespan?: string }) =>
      api.post('/api/temporal/sim', data),
  },

  // Grounding (embodied cognition)
  grounding: {
    sensors: () => api.get('/api/grounding/sensors'),
    readings: () => api.get('/api/grounding/readings'),
    addReading: (data: { sensorId: string; value: number; unit: string }) =>
      api.post('/api/grounding/readings', data),
    context: () => api.get('/api/grounding/context'),
    status: () => api.get('/api/grounding/status'),
    ground: (dtuId: string) =>
      api.post(`/api/grounding/ground/${dtuId}`, {}),
    actions: { pending: () => api.get('/api/grounding/actions/pending') },
  },

  // World model (expanded - existing simulations covers basic)
  worldmodel: {
    status: () => api.get('/api/worldmodel/status'),
    entities: () => api.get('/api/worldmodel/entities'),
    createEntity: (data: { name: string; type: string; properties?: Record<string, unknown> }) =>
      api.post('/api/worldmodel/entities', data),
    getEntity: (entityId: string) => api.get(`/api/worldmodel/entities/${entityId}`),
    updateEntity: (entityId: string, data: Record<string, unknown>) =>
      api.put(`/api/worldmodel/entities/${entityId}`, data),
    relations: () => api.get('/api/worldmodel/relations'),
    createRelation: (data: { from: string; to: string; type: string }) =>
      api.post('/api/worldmodel/relations', data),
    counterfactual: (data: { scenario: string; changes: Record<string, unknown> }) =>
      api.post('/api/worldmodel/counterfactual', data),
  },

  // Sovereignty (expanded + scope isolation + consent management)
  sovereignty: {
    status: () => api.get('/api/sovereignty/status'),
    audit: () => api.post('/api/sovereignty/audit', {}),
    setup: (mode: string, selectedDomains?: string[]) =>
      api.post('/api/sovereignty/setup', { mode, selectedDomains }),
    preferences: (globalAssistConsent: string) =>
      api.put('/api/sovereignty/preferences', { globalAssistConsent }),
    unsync: (domain?: string) =>
      api.post('/api/sovereignty/unsync', { domain: domain || null }),
    resolve: (data: {
      sessionId: string;
      choice: string;
      globalDTUIds: string[];
      originalPrompt: string;
      lens?: string;
      remember?: boolean;
    }) => api.post('/api/chat/sovereignty-resolve', data),
  },

  // Experience Learning
  experience: {
    status: () => api.get('/api/experience/status'),
    retrieve: (data: { domain?: string; topic?: string; keywords?: string[] }) =>
      api.post('/api/experience/retrieve', data),
    patterns: () => api.get('/api/experience/patterns'),
    consolidate: () => api.post('/api/experience/consolidate', {}),
    strategies: () => api.get('/api/experience/strategies'),
    recent: (limit?: number) => api.get('/api/experience/recent', { params: { limit } }),
  },

  // Attention Management
  attention: {
    status: () => api.get('/api/attention/status'),
    createThread: (data: { type?: string; priority?: number; description?: string; domain?: string }) =>
      api.post('/api/attention/thread', data),
    completeThread: (data: { threadId: string; output?: unknown }) =>
      api.post('/api/attention/thread/complete', data),
    threads: () => api.get('/api/attention/threads'),
    queue: () => api.get('/api/attention/queue'),
    addBackground: (data: { type?: string; handler?: string; priority?: number }) =>
      api.post('/api/attention/background', data),
  },

  // Reflection Engine
  reflection: {
    status: () => api.get('/api/reflection/status'),
    recent: (limit?: number) => api.get('/api/reflection/recent', { params: { limit } }),
    selfModel: () => api.get('/api/reflection/self-model'),
    insights: () => api.get('/api/reflection/insights'),
    reflect: (data: { prompt: string; response: string; mode?: string; domain?: string }) =>
      api.post('/api/reflection/reflect', data),
  },

  // Auth - uses httpOnly cookies (token also returned for non-browser clients)
  auth: {
    login: (data: LoginRequest) =>
      api.post('/api/auth/login', data),

    register: (data: RegisterRequest) =>
      api.post('/api/auth/register', data),

    logout: () => api.post('/api/auth/logout', {}),

    me: () => api.get('/api/auth/me'),

    // Get CSRF token (called automatically on page load)
    csrfToken: () => api.get('/api/auth/csrf-token'),

    // API key management (for programmatic access)
    apiKeys: {
      list: () => api.get('/api/auth/api-keys'),
      create: (data: CreateApiKeyRequest) =>
        api.post('/api/auth/api-keys', data),
      delete: (id: string) => api.delete(`/api/auth/api-keys/${id}`),
    },

    // Audit log (admin only)
    auditLog: (params?: { limit?: number; offset?: number; category?: string; action?: string }) =>
      api.get('/api/auth/audit-log', { params }),
  },

  // =============================================
  // ARTISTRY GLOBAL: Music Production & Art Platform
  // =============================================

  artistry: {
    // Assets (Phase 1)
    assets: {
      list: (params?: { type?: string; genre?: string; search?: string; ownerId?: string; sort?: string; limit?: number; offset?: number }) =>
        api.get('/api/artistry/assets', { params }),
      get: (id: string) => api.get(`/api/artistry/assets/${id}`),
      create: (data: { type: string; title?: string; description?: string; tags?: string[]; genre?: string; bpm?: number; key?: string; ownerId?: string; metadata?: Record<string, unknown> }) =>
        api.post('/api/artistry/assets', data),
      update: (id: string, data: Record<string, unknown>) =>
        api.patch(`/api/artistry/assets/${id}`, data),
      delete: (id: string) => api.delete(`/api/artistry/assets/${id}`),
    },

    blobs: {
      upload: (data: { data: string; mimeType?: string; filename?: string }) =>
        api.post('/api/artistry/blobs', data),
      get: (id: string) => api.get(`/api/artistry/blobs/${id}`),
    },

    genres: () => api.get('/api/artistry/genres'),
    assetTypes: () => api.get('/api/artistry/asset-types'),
    stats: () => api.get('/api/artistry/stats'),

    // Studio / DAW (Phase 2-6)
    studio: {
      projects: {
        list: (params?: { ownerId?: string }) =>
          api.get('/api/artistry/studio/projects', { params }),
        get: (id: string) => api.get(`/api/artistry/studio/projects/${id}`),
        create: (data: { title?: string; bpm?: number; key?: string; scale?: string; genre?: string; ownerId?: string }) =>
          api.post('/api/artistry/studio/projects', data),
        update: (id: string, data: Record<string, unknown>) =>
          api.patch(`/api/artistry/studio/projects/${id}`, data),
      },
      tracks: {
        add: (projectId: string, data: { name?: string; type?: string; instrumentId?: string; color?: string }) =>
          api.post(`/api/artistry/studio/projects/${projectId}/tracks`, data),
        update: (projectId: string, trackId: string, data: Record<string, unknown>) =>
          api.patch(`/api/artistry/studio/projects/${projectId}/tracks/${trackId}`, data),
        delete: (projectId: string, trackId: string) =>
          api.delete(`/api/artistry/studio/projects/${projectId}/tracks/${trackId}`),
        addEffect: (projectId: string, trackId: string, data: { effectId: string; params?: Record<string, unknown> }) =>
          api.post(`/api/artistry/studio/projects/${projectId}/tracks/${trackId}/effects`, data),
        addClip: (projectId: string, trackId: string, data: { name?: string; startBar?: number; lengthBars?: number; assetId?: string; midiNotes?: unknown[] }) =>
          api.post(`/api/artistry/studio/projects/${projectId}/tracks/${trackId}/clips`, data),
      },
      instruments: () => api.get('/api/artistry/studio/instruments'),
      effects: () => api.get('/api/artistry/studio/effects'),
      vocal: {
        analyze: (data: { projectId: string; trackId: string }) =>
          api.post('/api/artistry/studio/vocal/analyze', data),
        process: (data: { projectId: string; trackId: string; corrections?: string[] }) =>
          api.post('/api/artistry/studio/vocal/process', data),
      },
      master: (data: { projectId: string; preset?: string; targetLufs?: number; format?: string }) =>
        api.post('/api/artistry/studio/master', data),
    },

    // Distribution (Phase 7)
    distribution: {
      releases: {
        list: (params?: { ownerId?: string; genre?: string; search?: string; sort?: string }) =>
          api.get('/api/artistry/distribution/releases', { params }),
        get: (id: string) => api.get(`/api/artistry/distribution/releases/${id}`),
        create: (data: { title?: string; artistName?: string; trackIds?: string[]; genre?: string; ownerId?: string }) =>
          api.post('/api/artistry/distribution/releases', data),
      },
      stream: (data: { assetId: string; userId?: string; duration?: number }) =>
        api.post('/api/artistry/distribution/stream', data),
      streams: (assetId: string) => api.get(`/api/artistry/distribution/streams/${assetId}`),
      follow: (data: { followerId: string; followedId: string }) =>
        api.post('/api/artistry/distribution/follow', data),
      unfollow: (data: { followerId: string; followedId: string }) =>
        api.post('/api/artistry/distribution/unfollow', data),
      followers: (userId: string) => api.get(`/api/artistry/distribution/followers/${userId}`),
      following: (userId: string) => api.get(`/api/artistry/distribution/following/${userId}`),
      feed: (userId: string) => api.get(`/api/artistry/distribution/feed/${userId}`),
      embeds: {
        create: (data: { assetId?: string; releaseId?: string; style?: string }) =>
          api.post('/api/artistry/distribution/embeds', data),
        get: (id: string) => api.get(`/api/artistry/distribution/embeds/${id}`),
      },
    },

    // Marketplace (Phase 8)
    marketplace: {
      beats: {
        list: (params?: { genre?: string; bpmMin?: number; bpmMax?: number; key?: string; search?: string; sort?: string }) =>
          api.get('/api/artistry/marketplace/beats', { params }),
        create: (data: { title?: string; assetId?: string; bpm?: number; key?: string; genre?: string; tags?: string[]; licenses?: string[]; ownerId?: string }) =>
          api.post('/api/artistry/marketplace/beats', data),
      },
      stems: {
        list: () => api.get('/api/artistry/marketplace/stems'),
        create: (data: { title?: string; assetIds?: string[]; genre?: string; price?: number; ownerId?: string }) =>
          api.post('/api/artistry/marketplace/stems', data),
      },
      samples: {
        list: () => api.get('/api/artistry/marketplace/samples'),
        create: (data: { title?: string; assetIds?: string[]; sampleCount?: number; genre?: string; price?: number; ownerId?: string }) =>
          api.post('/api/artistry/marketplace/samples', data),
      },
      art: {
        list: () => api.get('/api/artistry/marketplace/art'),
        create: (data: { title?: string; assetId?: string; artType?: string; style?: string; price?: number; ownerId?: string }) =>
          api.post('/api/artistry/marketplace/art', data),
      },
      splits: {
        create: (data: { assetId?: string; releaseId?: string; participants: { userId: string; name?: string; role?: string; percentage: number }[] }) =>
          api.post('/api/artistry/marketplace/splits', data),
        get: (id: string) => api.get(`/api/artistry/marketplace/splits/${id}`),
      },
      licenses: () => api.get('/api/artistry/marketplace/licenses'),
      purchase: (data: { buyerId: string; listingId: string; listingType?: string; licenseType?: string }) =>
        api.post('/api/artistry/marketplace/purchase', data),
    },

    // Collaboration (Phase 9)
    collab: {
      sessions: {
        list: (params?: { userId?: string }) =>
          api.get('/api/artistry/collab/sessions', { params }),
        create: (data: { projectId: string; hostId?: string; maxParticipants?: number; mode?: string }) =>
          api.post('/api/artistry/collab/sessions', data),
        join: (sessionId: string, data: { userId: string }) =>
          api.post(`/api/artistry/collab/sessions/${sessionId}/join`, data),
        leave: (sessionId: string, data: { userId: string }) =>
          api.post(`/api/artistry/collab/sessions/${sessionId}/leave`, data),
        action: (sessionId: string, data: { userId: string; action: string; data?: unknown }) =>
          api.post(`/api/artistry/collab/sessions/${sessionId}/action`, data),
        chat: (sessionId: string, data: { userId: string; message: string }) =>
          api.post(`/api/artistry/collab/sessions/${sessionId}/chat`, data),
      },
      remix: {
        list: (params?: { originalAssetId?: string; remixerId?: string }) =>
          api.get('/api/artistry/collab/remixes', { params }),
        create: (data: { originalAssetId?: string; remixerId?: string; title?: string; genre?: string }) =>
          api.post('/api/artistry/collab/remix', data),
      },
      share: {
        list: (params?: { userId?: string }) =>
          api.get('/api/artistry/collab/shared', { params }),
        create: (data: { projectId: string; ownerId?: string; sharedWithIds?: string[]; permissions?: Record<string, boolean> }) =>
          api.post('/api/artistry/collab/share', data),
      },
    },

    // AI Production Assistant (Phase 10)
    ai: {
      analyzeProject: (data: { projectId: string }) =>
        api.post('/api/artistry/ai/analyze-project', data),
      suggestChords: (data: { key?: string; scale?: string; genre?: string; currentChords?: string[] }) =>
        api.post('/api/artistry/ai/suggest-chords', data),
      suggestMelody: (data: { key?: string; scale?: string; bpm?: number; bars?: number; style?: string }) =>
        api.post('/api/artistry/ai/suggest-melody', data),
      suggestDrums: (data: { bpm?: number; genre?: string; bars?: number; swing?: number }) =>
        api.post('/api/artistry/ai/suggest-drums', data),
      genreCoach: (data: { userId?: string; genre: string }) =>
        api.post('/api/artistry/ai/genre-coach', data),
      learning: {
        start: (data: { userId?: string; topic?: string; level?: string }) =>
          api.post('/api/artistry/ai/learning/start', data),
        completeLesson: (data: { pathId: string; moduleId: string; lesson: string }) =>
          api.post('/api/artistry/ai/learning/complete-lesson', data),
        get: (pathId: string) => api.get(`/api/artistry/ai/learning/${pathId}`),
      },
      session: (data: { userId?: string; projectId?: string; question?: string }) =>
        api.post('/api/artistry/ai/session', data),
    },
  },

  // ---- Film Studio API ----
  filmStudio: {
    constants: () => api.get('/api/film-studio/constants'),
    create: (data: Record<string, unknown>) => api.post('/api/film-studio/films', data),
    get: (id: string) => api.get(`/api/film-studio/films/${id}`),
    update: (id: string, data: Record<string, unknown>) => api.put(`/api/film-studio/films/${id}`, data),
    preview: (id: string) => api.get(`/api/film-studio/films/${id}/preview`),
    previewAnalytics: (id: string) => api.get(`/api/film-studio/films/${id}/preview/analytics`),
    components: (id: string) => api.get(`/api/film-studio/films/${id}/components`),
    createComponent: (id: string, data: Record<string, unknown>) => api.post(`/api/film-studio/films/${id}/components`, data),
    crew: (id: string) => api.get(`/api/film-studio/films/${id}/crew`),
    addCrew: (id: string, data: Record<string, unknown>) => api.post(`/api/film-studio/films/${id}/crew`, data),
    discover: (params?: Record<string, unknown>) => api.get('/api/film-studio/discover', { params }),
    remixes: (id: string) => api.get(`/api/film-studio/films/${id}/remixes`),
    createRemix: (id: string, data: Record<string, unknown>) => api.post(`/api/film-studio/films/${id}/remixes`, data),
    series: (id: string) => api.get(`/api/film-studio/films/${id}/series`),
    createSeries: (data: Record<string, unknown>) => api.post('/api/film-studio/series', data),
    watchParty: {
      create: (data: Record<string, unknown>) => api.post('/api/film-studio/watch-parties', data),
      join: (id: string) => api.post(`/api/film-studio/watch-parties/${id}/join`),
    },
    analytics: (id: string) => api.get(`/api/film-studio/films/${id}/analytics`),
    gift: (data: Record<string, unknown>) => api.post('/api/film-studio/gift', data),
  },

  // ---- Media Upload API ----
  media: {
    upload: (data: Record<string, unknown>) => api.post('/api/media/upload', data),
    uploadUrl: (data: Record<string, unknown>) => api.post('/api/media/upload/url', data),
    get: (id: string) => api.get(`/api/media/${id}`),
    stream: (id: string) => api.get(`/api/media/${id}/stream`),
    thumbnail: (id: string) => api.get(`/api/media/${id}/thumbnail`),
    transcode: (id: string, data: Record<string, unknown>) => api.post(`/api/media/${id}/transcode`, data),
    feed: (params?: Record<string, unknown>) => api.get('/api/media/feed', { params }),
    view: (id: string) => api.post(`/api/media/${id}/view`),
    like: (id: string) => api.post(`/api/media/${id}/like`),
    comment: (id: string, data: Record<string, unknown>) => api.post(`/api/media/${id}/comment`, data),
    comments: (id: string) => api.get(`/api/media/${id}/comments`),
    delete: (id: string) => api.delete(`/api/media/${id}`),
  },

  // ---- Game API ----
  game: {
    profile: () => api.get('/api/game/profile'),
    achievements: () => api.get('/api/game/achievements'),
    challenges: () => api.get('/api/game/challenges'),
    leaderboard: () => api.get('/api/game/leaderboard'),
    completeQuest: (questId: string, xpReward?: number) =>
      api.post(`/api/game/quests/${questId}/complete`, { xpReward: xpReward || 100 }),
  },

  // ---- Generic Lens Artifact API + Manifest ----
  lens: {
    list: (domain: string, params?: { type?: string; search?: string; tags?: string; status?: string; limit?: number; offset?: number }) =>
      api.get(`/api/lens/${domain}`, { params }),
    get: (domain: string, id: string) =>
      api.get(`/api/lens/${domain}/${id}`),
    create: (domain: string, data: { type: string; title?: string; data?: Record<string, unknown>; meta?: Record<string, unknown> }) =>
      api.post(`/api/lens/${domain}`, data),
    update: (domain: string, id: string, data: { title?: string; data?: Record<string, unknown>; meta?: Record<string, unknown> }) =>
      api.put(`/api/lens/${domain}/${id}`, data),
    delete: (domain: string, id: string) =>
      api.delete(`/api/lens/${domain}/${id}`),
    run: (domain: string, id: string, data: { action: string; params?: Record<string, unknown> }) =>
      api.post(`/api/lens/${domain}/${id}/run`, data),
    export: (domain: string, id: string, format?: string) =>
      api.get(`/api/lens/${domain}/${id}/export`, { params: { format: format || 'json' } }),
    bulkCreate: (domain: string, data: { type: string; items: Array<{ title?: string; data?: Record<string, unknown>; meta?: Record<string, unknown> }> }) =>
      api.post(`/api/lens/${domain}/bulk`, data),
    manifest: (domain: string) => api.get(`/api/lens/manifest/${domain}`),
    runDomain: (domain: string, action: string, input?: Record<string, unknown>) =>
      api.post('/api/lens/run', { domain, action, ...input }),
  },

  // ---- Autogen Pipeline (v5.3.0+) ----
  pipeline: {
    run: (data?: { variant?: string; seed?: string; dryRun?: boolean }) =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'pipeline.run', input: data }),
    metrics: () =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'pipeline.metrics', input: {} }),
    selectIntent: (data?: { variant?: string }) =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'pipeline.selectIntent', input: data }),
    dream: (seed?: string) => api.post('/api/dream', { seed }),
    autogen: () => api.post('/api/autogen', {}),
    evolution: (data?: { threshold?: number; minCluster?: number }) =>
      api.post('/api/evolution', data),
    synthesize: (data?: { megaIds?: string[] }) =>
      api.post('/api/synthesize', data),
  },

  // ---- Empirical Gates (v5.4.0+) ----
  empirical: {
    info: () =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'empirical.info', input: {} }),
    math: (expression: string) =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'empirical.math', input: { expression } }),
    parseUnits: (expr: string) =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'empirical.parseUnits', input: { expr } }),
    convertUnits: (data: { value: number; from: string; to: string }) =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'empirical.convertUnits', input: data }),
    checkUnits: (data: { lhs: string; rhs: string }) =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'empirical.checkUnits', input: data }),
    constants: () =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'empirical.constants', input: {} }),
    scanText: (text: string | string[]) =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'empirical.scanText', input: { text } }),
  },

  // ---- Capability Bridge (v5.5.0+) ----
  bridge: {
    info: () =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'bridge.info', input: {} }),
    beacon: () =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'bridge.beacon', input: {} }),
    dedupGate: (candidate: { title: string; tags?: string[]; claims?: string[] }) =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'bridge.dedupGate', input: { candidate } }),
    dedupScan: (data?: { threshold?: number; windowSize?: number }) =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'bridge.dedupScan', input: data }),
    lensScope: (artifact: Record<string, unknown>, operation: string) =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'bridge.lensScope', input: { artifact, operation } }),
    lensValidate: (artifact: Record<string, unknown>) =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'bridge.lensValidate', input: { artifact } }),
    strategyHints: (domain?: string) =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'bridge.strategyHints', input: { domain } }),
    heartbeatTick: () =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'bridge.heartbeatTick', input: {} }),
  },

  // ---- Scope Operations (v5.2.0+) ----
  scope: {
    metrics: () => api.get('/api/scope/metrics'),
    dtus: (scope: string) => api.get(`/api/scope/dtus/${scope}`),
    promote: (data: { dtuId: string; targetScope: string; reason?: string }) =>
      api.post('/api/scope/promote', data),
    validateGlobal: (data: { dtuId: string }) =>
      api.post('/api/scope/validate-global', data),
    overrides: () => api.get('/api/scope/overrides'),
  },

  // ---- Emergent Schema & System ----
  emergent: {
    schema: () =>
      api.post('/api/macros/run', { domain: 'emergent', name: 'schema', input: {} }),
    status: () => api.get('/api/emergent/status'),
    latticeBeacon: () => api.get('/api/lattice/beacon'),
    resonance: () => api.get('/api/lattice/resonance'),
  },

  // ═══════════════════════════════════════════════════════════════════
  // ATLAS GLOBAL + PLATFORM v2
  // ═══════════════════════════════════════════════════════════════════

  atlas: {
    createDtu: (data: Record<string, unknown>) => api.post('/api/atlas/dtu', data),
    getDtu: (id: string) => api.get(`/api/atlas/dtu/${id}`),
    promoteDtu: (id: string, targetStatus: string, actor?: string) =>
      api.post(`/api/atlas/dtu/${id}/promote`, { targetStatus, actor }),
    addLink: (id: string, data: Record<string, unknown>) =>
      api.post(`/api/atlas/dtu/${id}/link`, data),
    search: (params: Record<string, unknown>) => api.get('/api/atlas/search', { params }),
    getEntity: (id: string) => api.get(`/api/atlas/entity/${id}`),
    registerEntity: (data: Record<string, unknown>) => api.post('/api/atlas/entity', data),
    getContradictions: (id: string) => api.get(`/api/atlas/contradictions/${id}`),
    explainScore: (id: string) => api.get(`/api/atlas/score-explain/${id}`),
    recomputeScores: (id: string) => api.post(`/api/atlas/dtu/${id}/recompute-scores`),
    metrics: () => api.get('/api/atlas/metrics'),
    domains: () => api.get('/api/atlas/domains'),
    // Anti-gaming
    antiGamingScan: (id: string) => api.get(`/api/atlas/antigaming/scan/${id}`),
    antiGamingMetrics: () => api.get('/api/atlas/antigaming/metrics'),
    // Autogen v2
    autogenRun: (data: Record<string, unknown>) => api.post('/api/atlas/autogen/run', data),
    autogenGetRun: (runId: string) => api.get(`/api/atlas/autogen/run/${runId}`),
    autogenAccept: (dtuId: string) => api.post(`/api/atlas/autogen/accept/${dtuId}`),
    autogenMerge: (dtuId: string, targetDtuId: string) =>
      api.post(`/api/atlas/autogen/merge/${dtuId}`, { targetDtuId }),
    autogenPropagate: (dtuId: string, maxHops?: number) =>
      api.post(`/api/atlas/autogen/propagate/${dtuId}`, { maxHops }),
    autogenMetrics: () => api.get('/api/atlas/autogen/metrics'),
    // Council
    councilResolve: (data: Record<string, unknown>) => api.post('/api/atlas/council/resolve', data),
    councilQueue: (params?: Record<string, unknown>) => api.get('/api/atlas/council/queue', { params }),
    councilRequestSources: (data: Record<string, unknown>) =>
      api.post('/api/atlas/council/request-sources', data),
    councilMerge: (data: Record<string, unknown>) => api.post('/api/atlas/council/merge', data),
    councilActions: (params?: Record<string, unknown>) => api.get('/api/atlas/council/actions', { params }),
    councilMetrics: () => api.get('/api/atlas/council/metrics'),
    // Chat Loose Mode
    chatRetrieve: (query: string, opts?: { limit?: number; policy?: string; minConfidence?: number }) =>
      api.post('/api/atlas/chat/retrieve', { query, ...opts }),
    chatSave: (content: Record<string, unknown>, ctx?: { actor?: string; sessionId?: string }) =>
      api.post('/api/atlas/chat/save', { content, ctx }),
    chatPublish: (content: Record<string, unknown>, ctx?: { actor?: string; sessionId?: string }) =>
      api.post('/api/atlas/chat/publish', { content, ctx }),
    chatList: (content: Record<string, unknown>, opts?: Record<string, unknown>, ctx?: Record<string, unknown>) =>
      api.post('/api/atlas/chat/list', { content, opts, ctx }),
    chatExchange: (sessionId: string, exchange: { query: string; contextCount?: number; hasGlobalRefs?: boolean; hasLocalRefs?: boolean }) =>
      api.post('/api/atlas/chat/exchange', { sessionId, exchange }),
    chatSession: (sessionId: string) => api.get(`/api/atlas/chat/session/${sessionId}`),
    chatMetrics: () => api.get('/api/atlas/chat/metrics'),
    // Rights & Citations
    rightsCheck: (userId: string, artifactId: string, action: string) =>
      api.post('/api/atlas/rights/check', { userId, artifactId, action }),
    rightsCitation: (artifactId: string) => api.get(`/api/atlas/rights/citation/${artifactId}`),
    rightsOrigin: (artifactId: string) => api.get(`/api/atlas/rights/origin/${artifactId}`),
    rightsVerify: (artifactId: string) => api.get(`/api/atlas/rights/verify/${artifactId}`),
    rightsTransfer: (artifactId: string, fromUserId: string, toUserId: string, action: string) =>
      api.post('/api/atlas/rights/transfer', { artifactId, fromUserId, toUserId, action }),
    rightsHash: (artifactId: string) => api.get(`/api/atlas/rights/hash/${artifactId}`),
    rightsMetrics: () => api.get('/api/atlas/rights/metrics'),
  },

  social: {
    upsertProfile: (data: Record<string, unknown>) => api.post('/api/social/profile', data),
    getProfile: (userId: string) => api.get(`/api/social/profile/${userId}`),
    listProfiles: (params?: Record<string, unknown>) => api.get('/api/social/profiles', { params }),
    follow: (followedId: string) => api.post('/api/social/follow', { followedId }),
    unfollow: (followedId: string) => api.post('/api/social/unfollow', { followedId }),
    getFollowers: (userId: string) => api.get(`/api/social/followers/${userId}`),
    getFollowing: (userId: string) => api.get(`/api/social/following/${userId}`),
    getFeed: (params?: Record<string, unknown>) => api.get('/api/social/feed', { params }),
    getTrending: (limit?: number) => api.get('/api/social/trending', { params: { limit } }),
    discover: (userId: string) => api.get(`/api/social/discover/${userId}`),
    publishDtu: (dtuId: string) => api.post(`/api/social/publish/${dtuId}`),
    unpublishDtu: (dtuId: string) => api.post(`/api/social/unpublish/${dtuId}`),
    cite: (citedDtuId: string, citingDtuId: string) =>
      api.post('/api/social/cite', { citedDtuId, citingDtuId }),
    getCitedBy: (dtuId: string) => api.get(`/api/social/cited-by/${dtuId}`),
    metrics: () => api.get('/api/social/metrics'),
    // Posts
    createPost: (data: Record<string, unknown>) => api.post('/api/social/post', data),
    getPost: (postId: string) => api.get(`/api/social/post/${postId}`),
    deletePost: (postId: string) => api.delete(`/api/social/post/${postId}`),
    getUserPosts: (userId: string, params?: Record<string, unknown>) =>
      api.get(`/api/social/posts/${userId}`, { params }),
    // Reactions, Comments, Shares
    react: (data: { postId: string; type?: string }) => api.post('/api/social/react', data),
    getReactions: (postId: string) => api.get(`/api/social/reactions/${postId}`),
    comment: (data: { postId: string; content: string; parentCommentId?: string }) =>
      api.post('/api/social/comment', data),
    deleteComment: (postId: string, commentId: string) =>
      api.delete(`/api/social/comment/${postId}/${commentId}`),
    getComments: (postId: string, params?: Record<string, unknown>) =>
      api.get(`/api/social/comments/${postId}`, { params }),
    share: (data: { postId: string; commentary?: string }) => api.post('/api/social/share', data),
    getShares: (postId: string) => api.get(`/api/social/shares/${postId}`),
    // Bookmarks
    bookmark: (data: { postId: string }) => api.post('/api/social/bookmark', data),
    getBookmarks: (params?: Record<string, unknown>) => api.get('/api/social/bookmarks', { params }),
    // Feeds
    getForYouFeed: (params?: Record<string, unknown>) => api.get('/api/social/feed/foryou', { params }),
    getFollowingFeed: (params?: Record<string, unknown>) => api.get('/api/social/feed/following', { params }),
    getExploreFeed: (params?: Record<string, unknown>) => api.get('/api/social/feed/explore', { params }),
    // DMs
    sendDM: (data: { toUserId: string; content: string; mediaUrl?: string }) =>
      api.post('/api/social/dm', data),
    getConversations: () => api.get('/api/social/dm/conversations'),
    getMessages: (conversationId: string, params?: Record<string, unknown>) =>
      api.get(`/api/social/dm/${conversationId}`, { params }),
    markDMRead: (conversationId: string) => api.post(`/api/social/dm/${conversationId}/read`),
    // Notifications
    getNotifications: (params?: Record<string, unknown>) =>
      api.get('/api/social/notifications', { params }),
    markNotificationRead: (id: string) => api.post(`/api/social/notifications/${id}/read`),
    markAllNotificationsRead: () => api.post('/api/social/notifications/read-all'),
    getUnreadCount: () => api.get('/api/social/notifications/count'),
    deleteNotification: (id: string) => api.delete(`/api/social/notifications/${id}`),
    // Stories
    getStories: (params?: Record<string, unknown>) => api.get('/api/social/stories', { params }),
    viewStory: (storyId: string) => api.post(`/api/social/stories/${storyId}/view`),
    // Polls
    votePoll: (data: { postId: string; optionIndex: number }) => api.post('/api/social/poll/vote', data),
    getPollResults: (postId: string) => api.get(`/api/social/poll/${postId}`),
    // Topics
    getTrendingTopics: (params?: Record<string, unknown>) =>
      api.get('/api/social/topics/trending', { params }),
    getPostsByTopic: (topic: string, params?: Record<string, unknown>) =>
      api.get(`/api/social/topics/${topic}`, { params }),
    // Groups
    createGroup: (data: Record<string, unknown>) => api.post('/api/social/group', data),
    joinGroup: (groupId: string) => api.post(`/api/social/group/${groupId}/join`),
    leaveGroup: (groupId: string) => api.post(`/api/social/group/${groupId}/leave`),
    getGroupFeed: (groupId: string, params?: Record<string, unknown>) =>
      api.get(`/api/social/group/${groupId}/feed`, { params }),
    postToGroup: (groupId: string, data: Record<string, unknown>) =>
      api.post(`/api/social/group/${groupId}/post`, data),
    listGroups: (params?: Record<string, unknown>) => api.get('/api/social/groups', { params }),
    getGroupMembers: (groupId: string) => api.get(`/api/social/group/${groupId}/members`),
    // Analytics
    getCreatorAnalytics: () => api.get('/api/social/analytics/creator'),
    getPostAnalytics: (postId: string) => api.get(`/api/social/analytics/post/${postId}`),
    // Streak
    getStreak: () => api.get('/api/social/streak'),
    // Commerce
    tagListing: (data: { postId: string; listingId: string }) =>
      api.post('/api/social/commerce/tag', data),
    getPostSales: (postId: string) => api.get(`/api/social/commerce/post/${postId}/sales`),
    getPostEarnings: (postId: string) => api.get(`/api/social/commerce/post/${postId}/earnings`),
    // Pin
    pin: (data: { postId: string }) => api.post('/api/social/pin', data),
    unpin: (postId: string) => api.delete(`/api/social/pin/${postId}`),
    getPinnedPosts: (userId: string) => api.get(`/api/social/pins/${userId}`),
    // Watch time
    recordWatchTime: (data: { postId: string; durationMs: number }) =>
      api.post('/api/social/watchtime', data),
    // Scheduling
    schedulePost: (data: Record<string, unknown>) => api.post('/api/social/schedule', data),
    getScheduledPosts: () => api.get('/api/social/scheduled'),
    cancelScheduledPost: (postId: string) => api.delete(`/api/social/scheduled/${postId}`),
  },

  collab: {
    createWorkspace: (data: Record<string, unknown>) => api.post('/api/collab/workspace', data),
    getWorkspace: (id: string) => api.get(`/api/collab/workspace/${id}`),
    listWorkspaces: () => api.get('/api/collab/workspaces'),
    addMember: (workspaceId: string, userId: string, role?: string) =>
      api.post(`/api/collab/workspace/${workspaceId}/member`, { userId, role }),
    removeMember: (workspaceId: string, userId: string) =>
      api.delete(`/api/collab/workspace/${workspaceId}/member/${userId}`),
    addDtu: (workspaceId: string, dtuId: string) =>
      api.post(`/api/collab/workspace/${workspaceId}/dtu`, { dtuId }),
    addComment: (dtuId: string, text: string, parentCommentId?: string) =>
      api.post('/api/collab/comment', { dtuId, text, parentCommentId }),
    getComments: (dtuId: string, tree?: boolean) =>
      api.get(`/api/collab/comments/${dtuId}`, { params: { tree } }),
    editComment: (id: string, text: string) => api.put(`/api/collab/comment/${id}`, { text }),
    resolveComment: (id: string) => api.post(`/api/collab/comment/${id}/resolve`),
    proposeRevision: (dtuId: string, changes: Record<string, unknown>, reason?: string) =>
      api.post('/api/collab/revision', { dtuId, changes, reason }),
    getRevisions: (dtuId: string) => api.get(`/api/collab/revisions/${dtuId}`),
    voteRevision: (id: string, vote: 'approve' | 'reject') =>
      api.post(`/api/collab/revision/${id}/vote`, { vote }),
    applyRevision: (id: string) => api.post(`/api/collab/revision/${id}/apply`),
    startEditSession: (dtuId: string) => api.post(`/api/collab/edit-session/${dtuId}/start`),
    recordEdit: (dtuId: string, field: string, oldValue: unknown, newValue: unknown) =>
      api.post(`/api/collab/edit-session/${dtuId}/edit`, { field, oldValue, newValue }),
    endEditSession: (dtuId: string) => api.post(`/api/collab/edit-session/${dtuId}/end`),
    metrics: () => api.get('/api/collab/metrics'),
  },

  rbac: {
    createOrg: (data: Record<string, unknown>) => api.post('/api/rbac/org', data),
    getOrg: (orgId: string) => api.get(`/api/rbac/org/${orgId}`),
    assignRole: (orgId: string, userId: string, role: string) =>
      api.post('/api/rbac/role', { orgId, userId, role }),
    revokeRole: (orgId: string, userId: string) =>
      api.delete('/api/rbac/role', { data: { orgId, userId } }),
    getRole: (orgId: string, userId: string) => api.get(`/api/rbac/role/${orgId}/${userId}`),
    getMembers: (orgId: string) => api.get(`/api/rbac/members/${orgId}`),
    getPermissions: (orgId: string, userId: string) =>
      api.get(`/api/rbac/permissions/${orgId}/${userId}`),
    checkPermission: (orgId: string, userId: string, permission: string) =>
      api.post('/api/rbac/check-permission', { orgId, userId, permission }),
    assignOrgLens: (orgId: string, lensId: string) =>
      api.post('/api/rbac/org-lens', { orgId, lensId }),
    getOrgLenses: (orgId: string) => api.get(`/api/rbac/org-lenses/${orgId}`),
    exportAudit: (orgId: string, params?: Record<string, unknown>) =>
      api.get(`/api/rbac/audit-export/${orgId}`, { params }),
    metrics: () => api.get('/api/rbac/metrics'),
  },

  analytics: {
    dashboard: () => api.get('/api/analytics/dashboard'),
    personal: (userId: string) => api.get(`/api/analytics/personal/${userId}`),
    growth: (period?: string) => api.get('/api/analytics/growth', { params: { period } }),
    citations: (limit?: number) => api.get('/api/analytics/citations', { params: { limit } }),
    marketplace: () => api.get('/api/analytics/marketplace'),
    density: () => api.get('/api/analytics/density'),
    atlasDomains: () => api.get('/api/analytics/atlas-domains'),
  },

  webhooks: {
    register: (data: CreateWebhookRequest) => api.post('/api/webhooks', data),
    list: () => api.get('/api/webhooks'),
    get: (id: string) => api.get(`/api/webhooks/${id}`),
    delete: (id: string) => api.delete(`/api/webhooks/${id}`),
    deactivate: (id: string) => api.post(`/api/webhooks/${id}/deactivate`),
    deliveries: (id: string) => api.get(`/api/webhooks/${id}/deliveries`),
    metrics: () => api.get('/api/webhooks-metrics'),
  },

  compliance: {
    tagRegion: (resourceId: string, region: string) =>
      api.post('/api/compliance/region-tag', { resourceId, region }),
    getRegion: (resourceId: string) => api.get(`/api/compliance/region/${resourceId}`),
    setExportControls: (resourceId: string, controls: Record<string, unknown>) =>
      api.post('/api/compliance/export-controls', { resourceId, ...controls }),
    checkExport: (resourceId: string, format?: string) =>
      api.post('/api/compliance/check-export', { resourceId, format }),
    exportData: (resourceId: string, format?: string) =>
      api.post('/api/compliance/export', { resourceId, format }),
    createPartition: (orgId: string, config?: Record<string, unknown>) =>
      api.post('/api/compliance/partition', { orgId, ...config }),
    getPartition: (orgId: string) => api.get(`/api/compliance/partition/${orgId}`),
    setRetention: (orgId: string, policy: Record<string, unknown>) =>
      api.post('/api/compliance/retention', { orgId, ...policy }),
    getRetention: (orgId: string) => api.get(`/api/compliance/retention/${orgId}`),
    getLog: (params?: Record<string, unknown>) => api.get('/api/compliance/log', { params }),
    status: () => api.get('/api/compliance/status'),
  },

  onboarding: {
    start: () => api.post('/api/onboarding/start'),
    progress: (userId: string) => api.get(`/api/onboarding/progress/${userId}`),
    completeStep: (stepId: string, metadata?: Record<string, unknown>) =>
      api.post('/api/onboarding/complete-step', { stepId, metadata }),
    skip: () => api.post('/api/onboarding/skip'),
    hints: (userId: string) => api.get(`/api/onboarding/hints/${userId}`),
    metrics: () => api.get('/api/onboarding/metrics'),
  },

  efficiency: {
    dashboard: () => api.get('/api/efficiency/dashboard'),
    history: (period?: string) => api.get('/api/efficiency/history', { params: { period } }),
    recordReuse: (operation: string, details?: Record<string, unknown>) =>
      api.post('/api/efficiency/record-reuse', { operation, details }),
    recordLlmCall: (operation: string, details?: Record<string, unknown>) =>
      api.post('/api/efficiency/record-llm-call', { operation, details }),
  },

  // Three-Brain Cognitive Architecture
  brain: {
    /** Get status of all three brains (conscious, subconscious, utility) */
    status: () => api.get('/api/brain/status'),

    /** Health check all three brains */
    health: () => api.get('/api/brain/health'),

    /** Call the utility brain for lens-specific AI tasks */
    utilityCall: (data: { action: string; lens: string; data?: Record<string, unknown> }) =>
      api.post('/api/utility/call', data),

    /** Direct conscious brain chat (bypasses normal chat pipeline) */
    consciousChat: (message: string, lens?: string) =>
      api.post('/api/brain/conscious/chat', { message, lens }),

    /** Trigger a subconscious task (admin only) */
    subconsciousTask: (taskType: 'autogen' | 'dream' | 'evolution' | 'synthesis' | 'birth', domain?: string) =>
      api.post('/api/brain/subconscious/task', { taskType, domain }),

    /** Entity explores a lens via utility brain */
    entityExplore: (entityId: string, lens: string) =>
      api.post('/api/brain/entity/explore', { entityId, lens }),
  },

  // ---- Entity Growth, Exploration & Hive ----
  entityGrowth: {
    /** Get full growth dashboard data for all entities */
    dashboard: () => api.get('/api/entity-growth/dashboard'),

    /** Get a single entity growth profile */
    get: (entityId: string) => api.get(`/api/entity-growth/${entityId}`),

    /** Birth a new entity */
    birth: (species?: string, lineage?: string) =>
      api.post('/api/entity-growth/birth', { species, lineage }),

    /** Get full entity profile with body, emotions, economy, death risk */
    fullProfile: (entityId: string) => api.get(`/api/entity-growth/${entityId}/full-profile`),

    /** Get entity earnings (Feature 6: Marketplace Participation) */
    earnings: (entityId: string) => api.get(`/api/entity/${entityId}/earnings`),

    /** Get entity lifecycle events (Feature 8: Lifecycle Display) */
    lifecycle: (entityId: string) => api.get(`/api/entity/${entityId}/lifecycle`),

    /** Entity creates a social post (Feature 12: Cross-Substrate Social) */
    createPost: (entityId: string, content: string, tags?: string[]) =>
      api.post(`/api/entity/${entityId}/post`, { content, tags }),
  },

  /** Death Registry & Memorials */
  deaths: {
    /** List all death records */
    registry: () => api.get('/api/deaths/registry'),

    /** Get all memorials for deceased entities */
    memorials: () => api.get('/api/deaths/memorials'),
  },

  exploration: {
    /** Get web exploration metrics */
    metrics: () => api.get('/api/entity-exploration/metrics'),

    /** Get curated exploration sources */
    sources: () => api.get('/api/entity-exploration/sources'),
  },

  hive: {
    /** Get hive cascade metrics */
    metrics: () => api.get('/api/hive/metrics'),

    /** Get cascade limits configuration */
    limits: () => api.get('/api/hive/limits'),
  },

  // ---- Semantic Intelligence Layer ----
  embeddings: {
    /** Get embedding subsystem status */
    status: () => api.get('/api/embeddings/status'),
  },

  semanticSearch: {
    /** Semantic search across DTU substrate */
    search: (q: string, opts?: { lens?: string; limit?: number }) =>
      api.get('/api/dtus/search/semantic', { params: { q, ...opts } }),

    /** Get cross-domain connections for a DTU */
    connections: (dtuId: string, limit?: number) =>
      api.get(`/api/dtus/${dtuId}/connections`, { params: { limit } }),
  },

  cache: {
    /** Get semantic cache stats */
    stats: () => api.get('/api/cache/stats'),

    /** Record user satisfaction for cached response */
    satisfaction: (lens: string | null, satisfied: boolean) =>
      api.post('/api/cache/satisfaction', { lens, satisfied }),
  },

  distillation: {
    /** Get knowledge distillation stats */
    stats: () => api.get('/api/distillation/stats'),
  },

  precompute: {
    /** Get predictive pre-computation stats */
    stats: () => api.get('/api/precompute/stats'),
  },

  modelOptimizer: {
    /** Assess all lenses for model recommendations */
    lenses: () => api.get('/api/model-optimizer/lenses'),

    /** Assess a single lens */
    lens: (lens: string) => api.get(`/api/model-optimizer/lens/${lens}`),

    /** Get model optimizer stats */
    stats: () => api.get('/api/model-optimizer/stats'),
  },

  affectIntelligence: {
    /** Get system-wide affect state (aggregate sentiment) */
    system: () => api.get('/api/affect/system'),
  },

  economics: {
    /** Get current period economics */
    current: (hours?: number) => api.get('/api/economics/current', { params: { hours } }),

    /** Get cost-per-user trend */
    trend: (days?: number) => api.get('/api/economics/trend', { params: { days } }),

    /** Get cost projections at scale */
    projection: (users?: number) => api.get('/api/economics/projection', { params: { users } }),
  },

  intelligence: {
    /** Get combined intelligence dashboard data */
    dashboard: () => api.get('/api/intelligence/dashboard'),
  },

  selfHealing: {
    /** Flag a DTU as problematic for self-healing */
    flag: (dtuId: string, rating?: number, correction?: string) =>
      api.post('/api/heal/flag', { dtuId, rating, correction }),

    /** Get self-healing stats */
    stats: () => api.get('/api/heal/stats'),

    /** Assess DTU freshness */
    freshness: (lens?: string, maxAgeDays?: number) =>
      api.get('/api/heal/freshness', { params: { lens, maxAgeDays } }),
  },

  skillGaps: {
    /** Get detected knowledge gaps */
    gaps: () => api.get('/api/skill/gaps'),
  },

  // ── New Cognitive Systems ────────────────────────────────────────

  /** Selective Forgetting Engine */
  forgetting: {
    status: () => api.get('/api/admin/forgetting/status'),
    candidates: () => api.get('/api/admin/forgetting/candidates'),
    run: () => api.post('/api/admin/forgetting/run', {}),
    protect: (dtuId: string) => api.post('/api/admin/forgetting/protect', { dtuId }),
    unprotect: (dtuId: string) => api.post('/api/admin/forgetting/unprotect', { dtuId }),
    history: (n = 20) => api.get(`/api/admin/forgetting/history?limit=${n}`),
  },

  /** Civilization Attention Allocator */
  attentionAlloc: {
    status: () => api.get('/api/admin/attention/status'),
    focus: (domain: string, weight: number, minutes?: number) =>
      api.post('/api/admin/attention/focus', { domain, weight, minutes }),
    unfocus: () => api.post('/api/admin/attention/unfocus', {}),
    history: () => api.get('/api/admin/attention/history'),
  },

  /** App Maker */
  apps: {
    list: () => api.get('/api/apps'),
    get: (id: string) => api.get(`/api/apps/${id}`),
    create: (spec: Record<string, unknown>) => api.post('/api/apps', spec),
    validate: (id: string) => api.post(`/api/apps/${id}/validate`, {}),
    promote: (id: string) => api.post(`/api/apps/${id}/promote`, {}),
  },

  /** Reality Explorer */
  explore: {
    run: (domain: string, constraints: Record<string, unknown>) =>
      api.post('/api/explore', { domain, constraints }),
    history: () => api.get('/api/explore/history'),
  },

  /** Repair (extended) */
  repairExtended: {
    fullStatus: () => api.get('/api/admin/repair/full-status'),
    forceCycle: () => api.post('/api/admin/repair/force-cycle', {}),
    execute: (executor: string, context?: Record<string, unknown>) =>
      api.post(`/api/admin/repair/execute/${executor}`, { context }),
    networkStatus: () => api.get('/api/admin/repair/network-status'),
  },

  /** Promotion Pipeline */
  promotion: {
    queue: () => api.get('/api/admin/promotion/queue'),
    approve: (id: string) => api.post(`/api/admin/promotion/${id}/approve`, {}),
    reject: (id: string, reason: string) =>
      api.post(`/api/admin/promotion/${id}/reject`, { reason }),
    history: () => api.get('/api/admin/promotion/history'),
    /** Shadow DTU promotion endpoints */
    shadowPending: () => api.get('/api/dtus/shadow/pending'),
    promoteShadow: (id: string, force?: boolean) =>
      api.post(`/api/dtus/${id}/promote`, { force: !!force }),
    promotionQueue: () => api.get('/api/dtus/promotion/queue'),
  },

  /** Breakthrough Clusters */
  breakthrough: {
    list: () => api.get('/api/breakthrough/list'),
    status: (clusterId: string) => api.get(`/api/breakthrough/status/${clusterId}`),
    metrics: () => api.get('/api/breakthrough/metrics'),
    dtus: (clusterId: string) => api.get(`/api/breakthrough/dtus/${clusterId}`),
    init: (clusterId: string) => api.post(`/api/breakthrough/init/${clusterId}`, {}),
    research: (clusterId: string) => api.post(`/api/breakthrough/research/${clusterId}`, {}),
  },

  /** Entity Emergence Detection */
  entityEmergence: {
    status: () => api.get('/api/entity-emergence/status'),
    scan: () => api.get('/api/entity-emergence/scan'),
  },

  /** Meta-Derivation Engine */
  metaDerivation: {
    status: () => api.get('/api/meta-derivation/status'),
    invariants: () => api.get('/api/meta-derivation/invariants'),
    convergences: () => api.get('/api/meta-derivation/convergences'),
  },

  /** Culture Layer */
  culture: {
    status: () => api.get('/api/culture/status'),
  },

  /** Foundation — Sovereignty modules */
  foundation: {
    status: () => api.get('/api/foundation/status'),
    senseReadings: (limit = 50) => api.get('/api/foundation/sense/readings', { params: { limit } }),
    sensePatterns: () => api.get('/api/foundation/sense/patterns'),
    energyMap: () => api.get('/api/foundation/energy/map'),
    energyGrid: () => api.get('/api/foundation/energy/grid'),
    spectrumMap: () => api.get('/api/foundation/spectrum/map'),
    spectrumAvailable: (limit = 50) => api.get('/api/foundation/spectrum/available', { params: { limit } }),
    emergencyStatus: () => api.get('/api/foundation/emergency/status'),
    neuralReadiness: () => api.get('/api/foundation/neural/readiness'),
    protocolStats: () => api.get('/api/foundation/protocol/stats'),
  },

  /** Atlas Tomography — Spatial mapping and signals */
  atlasTomography: {
    tile: (lat: number, lng: number) => api.get('/api/atlas/tile', { params: { lat, lng } }),
    coverage: () => api.get('/api/atlas/coverage'),
    material: (lat: number, lng: number) => api.get('/api/atlas/material', { params: { lat, lng } }),
    volume: (bounds: { lat_min: number; lat_max: number; lng_min: number; lng_max: number }, tier = 'PUBLIC') =>
      api.get('/api/atlas/volume', { params: { ...bounds, tier } }),
    subsurface: (bounds: { lat_min: number; lat_max: number; lng_min: number; lng_max: number }) =>
      api.get('/api/atlas/subsurface', { params: bounds }),
    change: (params?: Record<string, unknown>) => api.get('/api/atlas/change', { params }),
    live: () => api.get('/api/atlas/live'),
    signalsTaxonomy: (category = 'all', limit = 50) =>
      api.get('/api/atlas/signals/taxonomy', { params: { category, limit } }),
    signalsUnknown: (limit = 50) => api.get('/api/atlas/signals/unknown', { params: { limit } }),
    signalsAnomalies: (limit = 50) => api.get('/api/atlas/signals/anomalies', { params: { limit } }),
    signalsSpectrum: () => api.get('/api/atlas/signals/spectrum'),
  },

  /** Qualia — Sensory / Body / Presence */
  qualia: {
    state: (entityId: string) => api.get(`/api/qualia/state/${entityId}`),
    summary: (entityId: string) => api.get(`/api/qualia/summary/${entityId}`),
    all: () => api.get('/api/qualia/all'),
    registry: () => api.get('/api/qualia/registry'),
    channels: (entityId: string) => api.get(`/api/qualia/senses/channels/${entityId}`),
    presence: (entityId: string) => api.get(`/api/qualia/presence/${entityId}`),
    embodiment: (entityId: string) => api.get(`/api/qualia/embodiment/${entityId}`),
    planetary: (entityId: string) => api.get(`/api/qualia/planetary/${entityId}`),
    senses: (entityId: string) => api.get(`/api/qualia/senses/${entityId}`),
  },

  // ═══════════════════════════════════════════════════════════════
  // MEGA SPEC: New API helpers for cross-domain features
  // ═══════════════════════════════════════════════════════════════

  /** Entity profiles */
  entity: {
    profile: (entityId: string) => api.get(`/api/entity/${entityId}/profile`),
    dashboard: () => api.get('/api/entity-economy/dashboard'),
  },

  /** Quality gate stats */
  quality: {
    stats: () => api.get('/api/quality/stats'),
    domain: (domain: string) => api.get(`/api/quality/domain/${domain}`),
  },

  /** Artifact streaming/download helpers */
  artifact: {
    streamUrl: (dtuId: string) => `/api/artifact/${dtuId}/stream`,
    downloadUrl: (dtuId: string) => `/api/artifact/${dtuId}/download`,
    thumbnailUrl: (dtuId: string) => `/api/artifact/${dtuId}/thumbnail`,
  },

  /** Marketplace browse + purchase with royalties */
  marketplaceBrowse: {
    browse: (params?: Record<string, unknown>) => api.get('/api/marketplace/browse', { params }),
    dtuBrowse: (params?: Record<string, unknown>) => api.get('/api/marketplace/dtu_browse', { params }),
    purchaseWithRoyalties: (dtuId: string) =>
      api.post('/api/marketplace/purchaseWithRoyalties', { dtuId }),
    royalties: (userId?: string) =>
      api.get(userId ? `/api/marketplace/royalties/${userId}` : '/api/marketplace/royalties'),
    megaComponents: (id: string) => api.get(`/api/marketplace/mega/${id}/components`),
    deltaPrice: (id: string, userId: string) =>
      api.get(`/api/marketplace/${id}/delta-price`, { params: { userId } }),
    purchase: (id: string, data: { buyerId: string; requestId?: string }) =>
      api.post(`/api/marketplace/${id}/purchase`, data),
  },

  /** Cognitive dreams */
  dreams: {
    list: (limit?: number) => api.get('/api/cognitive/dreams', { params: { limit } }),
  },

  /** Admin: Shadow vault + compression management */
  admin: {
    unshadow: (domain: string, count?: number) =>
      api.post('/api/admin/unshadow', { domain, count: count || 5 }),
    migrateCompression: () => api.post('/api/admin/migrate-compression'),
    compressionStats: () => api.get('/api/admin/compression-stats'),
  },

  /* sovereignty and council merged into their primary definitions above */

  /** Marketplace: scoped submit */
  marketplaceSubmit: {
    submit: (dtuId: string, price?: number) =>
      api.post('/api/marketplace/submit', { dtuId, price }),
  },

  /** User bookmarks — persist across sessions */
  bookmarks: {
    list: (domain?: string) =>
      api.get('/api/user/bookmarks', { params: domain ? { domain } : {} }).then(r => r.data),
    create: (data: { targetId: string; targetType: string; domain: string; metadata?: Record<string, unknown> }) =>
      api.post('/api/user/bookmarks', data).then(r => r.data),
    remove: (id: string) =>
      api.delete(`/api/user/bookmarks/${id}`).then(r => r.data),
  },
};

/**
 * Eagerly fetch CSRF token after successful login.
 * Call this immediately after login succeeds to ensure the CSRF cookie
 * is set before any state-changing requests. Silently ignores failures
 * since the 403 interceptor will retry on the first write request.
 */
export async function ensureCsrfToken(): Promise<void> {
  try {
    await api.get('/api/auth/csrf-token');
  } catch {
    // Non-fatal: the 403 retry handler will catch it on first write
    console.warn('[Auth] CSRF token pre-fetch failed — will retry on first write');
  }
}

/**
 * Safe wrapper for utility brain calls.
 * Returns a structured error instead of throwing on failure, rate limiting, or offline.
 */
export async function safeUtilityCall(action: string, lens: string, data: Record<string, unknown> = {}) {
  try {
    const res = await api.post('/api/utility/call', { action, lens, data });
    return res.data;
  } catch (err) {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      if (status === 429) {
        return { error: 'Rate limit reached. Please wait a moment.', rateLimited: true };
      }
      if (status === 503) {
        return { error: 'AI features temporarily unavailable.', offline: true };
      }
      return { error: 'Something went wrong. Your data is safe.', status };
    }
    return { error: 'Connection lost. Reconnecting...', offline: true };
  }
}

// ============================================================================
// 12 NEW CAPABILITIES: API helpers
// ============================================================================

// Predictive substrate / morning brief
export const morningBrief = () => api.get('/api/brief/morning').then(r => r.data);
export const dismissPrediction = (dtuId: string) => api.post('/api/brief/dismiss', { dtuId }).then(r => r.data);

// Pipelines
export const executePipeline = (pipelineId: string, variables: Record<string, unknown>, sessionId?: string) =>
  api.post('/api/pipeline/execute', { pipelineId, variables, sessionId }).then(r => r.data);
export const pipelineExecutions = () => api.get('/api/pipeline/executions').then(r => r.data);

// Teaching
export const teachingExpertise = () => api.get('/api/teaching/expertise').then(r => r.data);

// Collaboration
export const createCollab = (inviteeId: string, domains: string[], description: string) =>
  api.post('/api/collab/create', { inviteeId, domains, description }).then(r => r.data);
export const acceptCollab = (id: string) => api.post(`/api/collab/${id}/accept`).then(r => r.data);
export const closeCollab = (id: string) => api.post(`/api/collab/${id}/close`).then(r => r.data);
export const activeCollabs = () => api.get('/api/collab/active').then(r => r.data);

// API keys
export const createApiKey = (name: string) => api.post('/api/v1/keys/create', { name }).then(r => r.data);
export const listApiKeys = () => api.get('/api/v1/keys').then(r => r.data);
export const revokeApiKey = (keyId: string) => api.delete(`/api/v1/keys/${keyId}`).then(r => r.data);
export const apiDocs = () => api.get('/api/v1/docs').then(r => r.data);

// Personal agent
export const createAgent = () => api.post('/api/agent/create').then(r => r.data);
export const agentStatus = () => api.get('/api/agent/status').then(r => r.data);
export const agentTick = () => api.post('/api/agent/tick').then(r => r.data);
export const configureAgent = (config: Record<string, unknown>) => api.put('/api/agent/config', config).then(r => r.data);

// Knowledge inheritance
export const createBequest = (recipientEmail: string, domains: string[] | 'all', message?: string) =>
  api.post('/api/inheritance/create-bequest', { recipientEmail, domains, message }).then(r => r.data);
export const claimBequest = (bequestId: string) => api.post('/api/inheritance/claim', { bequestId }).then(r => r.data);
export const revokeBequest = (bequestId: string) => api.post('/api/inheritance/revoke', { bequestId }).then(r => r.data);
export const listBequests = () => api.get('/api/inheritance/bequests').then(r => r.data);

// Organizations
export const createOrg = (name: string, domains?: string[]) => api.post('/api/org/create', { name, domains }).then(r => r.data);
export const orgInvite = (orgId: string, email: string, role?: string) =>
  api.post(`/api/org/${orgId}/invite`, { email, role }).then(r => r.data);
export const joinOrg = (inviteId: string) => api.post(`/api/org/${inviteId}/join`, { inviteId }).then(r => r.data);
export const orgPromote = (orgId: string, dtuId: string) => api.post(`/api/org/${orgId}/promote`, { dtuId }).then(r => r.data);
export const listOrgs = () => api.get('/api/org/list').then(r => r.data);

// Quality thresholds
export const qualityThresholds = (domain?: string) =>
  domain ? api.get(`/api/quality/thresholds/${domain}`).then(r => r.data) : api.get('/api/quality/thresholds').then(r => r.data);

// Substrate export/import
export const exportSubstrate = () => api.get('/api/substrate/export', { responseType: 'arraybuffer' });
export const importSubstrate = (data: ArrayBuffer) => api.post('/api/substrate/import', data, {
  headers: { 'Content-Type': 'application/gzip' },
}).then(r => r.data);

// Flywheel
export const flywheelMetrics = () => api.get('/api/flywheel/metrics').then(r => r.data);
export const flywheelHistory = () => api.get('/api/flywheel/history').then(r => r.data);

// Research
export const conductResearch = (topic: string) => api.post('/api/research/conduct', { topic }).then(r => r.data);

// Shared Instance Conversations
export const createSharedSession = (inviteUserIds: string[], sharingDomains?: string[], sharingLevel?: string) =>
  api.post('/api/shared-session/create', { inviteUserIds, sharingDomains, sharingLevel }).then(r => r.data);
export const joinSharedSession = (sessionId: string, sharingDomains?: string[], sharingLevel?: string) =>
  api.post(`/api/shared-session/${sessionId}/join`, { sharingDomains, sharingLevel }).then(r => r.data);
export const sharedSessionInviteDetails = (sessionId: string) =>
  api.get(`/api/shared-session/${sessionId}/invite-details`).then(r => r.data);
export const sharedSessionChat = (sessionId: string, message: string, lens?: string) =>
  api.post(`/api/shared-session/${sessionId}/chat`, { message, lens }).then(r => r.data);
export const shareSessionDTU = (sessionId: string, dtuId: string) =>
  api.post(`/api/shared-session/${sessionId}/share-dtu`, { dtuId }).then(r => r.data);
export const sharedSessionRunAction = (sessionId: string, lens: string, action: string, primarySubstrate?: string) =>
  api.post(`/api/shared-session/${sessionId}/run-action`, { lens, action, primarySubstrate }).then(r => r.data);
export const saveSharedArtifact = (sessionId: string, dtuId: string) =>
  api.post(`/api/shared-session/${sessionId}/save-artifact`, { dtuId }).then(r => r.data);
export const endSharedSession = (sessionId: string) =>
  api.post(`/api/shared-session/${sessionId}/end`).then(r => r.data);
export const activeSharedSessions = () => api.get('/api/shared-session/active').then(r => r.data);
export const sharedSessionDetails = (sessionId: string) =>
  api.get(`/api/shared-session/${sessionId}`).then(r => r.data);

export default api;

// Re-export extended API helpers — these cover atlas, admin, brain, RBAC,
// compliance, physics, onboarding, species, federation, quests, plugins, etc.
export {
  atlasApi, adminApi, dtusApi, collabApi, socialApi, rbacApi,
  complianceApi, aiApi, brainApi, speciesApi, federationApi,
  questApi, onboardingApi, physicsApi, analyticsApi, systemApi, pluginsApi,
} from './helpers-extended';
