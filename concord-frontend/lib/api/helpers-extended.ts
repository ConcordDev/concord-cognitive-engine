/**
 * @deprecated These extended helpers are re-exported from client.ts but have no
 * production consumers yet. Import from '@/lib/api/client' when wiring new pages.
 * If still unused after feature integration, consider consolidating into client.ts.
 *
 * Extended API helpers for previously unreachable backend endpoints.
 *
 * The backend has 963 endpoints. The original client.ts covers ~300.
 * This file adds typed helpers for the remaining critical categories:
 *   - Atlas (64 endpoints) — knowledge navigation
 *   - Admin (37) — system administration & repair
 *   - DTUs extended (29) — advanced DTU operations
 *   - Collab (20) — real-time collaboration
 *   - Social (15) — social layer
 *   - RBAC (12) — role-based access control
 *   - Compliance (11) — compliance system
 *   - AI extended (8) — direct brain/AI interaction
 *   - Onboarding (8) — user onboarding
 *   - Physics (7) — physics simulation
 *   - Analytics extended (7) — analytics
 *   - Species (4) — entity classification
 *   - Brain (5) — direct brain access
 *   - Federation (3) — C-NET
 *   - Quest (2) — quests
 *
 * Pattern: every helper returns AxiosPromise matching the existing apiHelpers style.
 */

import { api } from './client';

// ── Atlas ──────────────────────────────────────────────────────────────────

export const atlasApi = {
  // Autogen
  autogen: {
    run: () => api.post('/api/atlas/autogen/run'),
    getRun: (runId: string) => api.get(`/api/atlas/autogen/run/${runId}`),
    accept: (dtuId: string) => api.post(`/api/atlas/autogen/accept/${dtuId}`),
    merge: (dtuId: string) => api.post(`/api/atlas/autogen/merge/${dtuId}`),
    propagate: (dtuId: string) => api.post(`/api/atlas/autogen/propagate/${dtuId}`),
    metrics: () => api.get('/api/atlas/autogen/metrics'),
  },
  // Knowledge
  knowledge: {
    coverage: () => api.get('/api/atlas/knowledge/coverage'),
    gaps: () => api.get('/api/atlas/knowledge/gaps'),
    integrity: () => api.get('/api/atlas/knowledge/integrity'),
    deepAudit: () => api.get('/api/atlas/knowledge/deep-audit'),
  },
  // Domains
  domains: {
    list: () => api.get('/api/atlas/domains'),
    get: (id: string) => api.get(`/api/atlas/domains/${id}`),
    map: () => api.get('/api/atlas/domains/map'),
    gaps: (id: string) => api.get(`/api/atlas/domains/${id}/gaps`),
    dtus: (id: string) => api.get(`/api/atlas/domains/${id}/dtus`),
  },
  // Lineage
  lineage: {
    get: (dtuId: string) => api.get(`/api/atlas/lineage/${dtuId}`),
    tree: (dtuId: string) => api.get(`/api/atlas/lineage/${dtuId}/tree`),
  },
  // Anti-gaming
  antigaming: {
    metrics: () => api.get('/api/atlas/antigaming/metrics'),
    scan: (id: string) => api.get(`/api/atlas/antigaming/scan/${id}`),
  },
  // Auto-promote
  autoPromoteGate: (id: string) => api.get(`/api/atlas/auto-promote-gate/${id}`),
  // Cross-domain
  crossDomain: {
    connections: () => api.get('/api/atlas/cross-domain/connections'),
    bridges: () => api.get('/api/atlas/cross-domain/bridges'),
  },
  // Trust
  trust: {
    scores: () => api.get('/api/atlas/trust/scores'),
    audit: (id: string) => api.get(`/api/atlas/trust/audit/${id}`),
  },
  // Tier management
  tiers: {
    stats: () => api.get('/api/atlas/tiers/stats'),
    promote: (dtuId: string, tier: string) => api.post(`/api/atlas/tiers/promote/${dtuId}`, { tier }),
    demote: (dtuId: string, tier: string) => api.post(`/api/atlas/tiers/demote/${dtuId}`, { tier }),
  },
};

// ── Admin Extended ─────────────────────────────────────────────────────────

export const adminApi = {
  dashboard: () => api.get('/api/admin/dashboard'),
  stats: () => api.get('/api/admin/stats'),
  metrics: () => api.get('/api/admin/metrics'),
  audit: () => api.get('/api/admin/audit'),
  logs: (params?: { limit?: number; type?: string }) => api.get('/api/admin/logs', { params }),
  logsStream: () => api.get('/api/admin/logs/stream'),
  queue: {
    stats: () => api.get('/api/admin/queue/stats'),
  },
  backup: {
    status: () => api.get('/api/admin/backup/status'),
  },
  ssl: {
    status: () => api.get('/api/admin/ssl/status'),
  },
  sso: (data: unknown) => api.post('/api/admin/sso', data),
  saveState: () => api.post('/api/admin/save-state'),
  repairBuild: () => api.post('/api/admin/repair-build'),
  governanceRejections: () => api.get('/api/admin/governance-rejections'),
  // Repair (extended beyond base)
  repair: {
    status: () => api.get('/api/admin/repair/status'),
    fullStatus: () => api.get('/api/admin/repair/full-status'),
    patterns: () => api.get('/api/admin/repair/patterns'),
    accumulator: () => api.get('/api/admin/repair/accumulator'),
    networkStatus: () => api.get('/api/admin/repair/network-status'),
    trigger: () => api.post('/api/admin/repair/trigger'),
    forceCycle: () => api.post('/api/admin/repair/force-cycle'),
    execute: (executor: string) => api.post(`/api/admin/repair/execute/${executor}`),
    report: (data: unknown) => api.post('/api/admin/repair/report', data),
    rollbackMacro: (data: unknown) => api.post('/api/admin/repair/rollback-macro', data),
  },
  // Attention
  attention: {
    status: () => api.get('/api/admin/attention/status'),
    history: () => api.get('/api/admin/attention/history'),
    focus: (data: { domain: string; weight: number; durationMs?: number }) => api.post('/api/admin/attention/focus', data),
    unfocus: () => api.post('/api/admin/attention/unfocus'),
  },
  // Forgetting
  forgetting: {
    status: () => api.get('/api/admin/forgetting/status'),
    candidates: () => api.get('/api/admin/forgetting/candidates'),
    history: () => api.get('/api/admin/forgetting/history'),
    run: () => api.post('/api/admin/forgetting/run'),
    protect: (data: { dtuId: string }) => api.post('/api/admin/forgetting/protect', data),
    unprotect: (data: { dtuId: string }) => api.post('/api/admin/forgetting/unprotect', data),
  },
  // Promotion
  promotion: {
    queue: () => api.get('/api/admin/promotion/queue'),
    history: () => api.get('/api/admin/promotion/history'),
    approve: (id: string) => api.post(`/api/admin/promotion/${id}/approve`),
    reject: (id: string, reason?: string) => api.post(`/api/admin/promotion/${id}/reject`, { reason }),
    shadowPending: () => api.get('/api/dtus/shadow/pending'),
    promoteShadow: (id: string, force?: boolean) => api.post(`/api/dtus/${id}/promote`, { force: !!force }),
    promotionQueue: () => api.get('/api/dtus/promotion/queue'),
  },
};

// ── DTUs Extended ──────────────────────────────────────────────────────────

export const dtusApi = {
  get: (id: string) => api.get(`/api/dtus/${id}`),
  delete: (id: string) => api.delete(`/api/dtus/${id}`),
  search: (query: string) => api.get('/api/dtus/search', { params: { q: query } }),
  export: (id: string) => api.get(`/api/dtus/${id}/export.dtu`),
  lineage: (id: string) => api.get(`/api/dtus/${id}/lineage`),
  children: (id: string) => api.get(`/api/dtus/${id}/children`),
  tags: (id: string) => api.get(`/api/dtus/${id}/tags`),
  promote: (id: string, tier: string) => api.post(`/api/dtus/${id}/promote`, { tier }),
  fork: (id: string) => api.post(`/api/dtus/${id}/fork`),
  merge: (id: string, data: unknown) => api.post(`/api/dtus/${id}/merge`, data),
  related: (id: string) => api.get(`/api/dtus/${id}/related`),
  history: (id: string) => api.get(`/api/dtus/${id}/history`),
  bulk: (data: unknown) => api.post('/api/dtus/bulk', data),
  stats: () => api.get('/api/dtus/stats'),
  recent: (limit?: number) => api.get('/api/dtus/recent', { params: { limit } }),
};

// ── Collab Extended ────────────────────────────────────────────────────────

export const collabApi = {
  sessions: () => api.get('/api/collab/sessions'),
  session: (id: string) => api.get(`/api/collab/sessions/${id}`),
  create: (data: unknown) => api.post('/api/collab/session', data),
  join: (data: { sessionId: string }) => api.post('/api/collab/join', data),
  leave: (data: { sessionId: string }) => api.post('/api/collab/leave', data),
  edit: (data: unknown) => api.post('/api/collab/edit', data),
  merge: (data: unknown) => api.post('/api/collab/merge', data),
  lock: (data: { sessionId: string; dtuId: string }) => api.post('/api/collab/lock', data),
  unlock: (data: { sessionId: string; dtuId: string }) => api.post('/api/collab/unlock', data),
  presence: (sessionId: string) => api.get(`/api/collab/sessions/${sessionId}/presence`),
  history: (sessionId: string) => api.get(`/api/collab/sessions/${sessionId}/history`),
  resolve: (data: unknown) => api.post('/api/collab/resolve', data),
};

// ── Social ─────────────────────────────────────────────────────────────────

export const socialApi = {
  profile: (userId?: string) => api.get(userId ? `/api/social/profile/${userId}` : '/api/social/profile'),
  updateProfile: (data: unknown) => api.post('/api/social/profile', data),
  followers: (userId: string) => api.get(`/api/social/followers/${userId}`),
  following: (userId: string) => api.get(`/api/social/following/${userId}`),
  follow: (userId: string) => api.post('/api/social/follow', { followedId: userId }),
  unfollow: (userId: string) => api.post('/api/social/unfollow', { followedId: userId }),
  feed: () => api.get('/api/social/feed'),
  discover: (userId: string) => api.get(`/api/social/discover/${userId}`),
  trending: (limit?: number) => api.get('/api/social/trending', { params: { limit } }),
  notifications: () => api.get('/api/social/notifications'),
};

// ── RBAC ───────────────────────────────────────────────────────────────────

export const rbacApi = {
  roles: () => api.get('/api/rbac/roles'),
  role: (id: string) => api.get(`/api/rbac/roles/${id}`),
  createRole: (data: unknown) => api.post('/api/rbac/roles', data),
  updateRole: (id: string, data: unknown) => api.put(`/api/rbac/roles/${id}`, data),
  deleteRole: (id: string) => api.delete(`/api/rbac/roles/${id}`),
  permissions: () => api.get('/api/rbac/permissions'),
  assignRole: (data: { userId: string; roleId: string }) => api.post('/api/rbac/assign', data),
  revokeRole: (data: { userId: string; roleId: string }) => api.post('/api/rbac/revoke', data),
  userRoles: (userId: string) => api.get(`/api/rbac/users/${userId}/roles`),
  check: (data: { userId: string; permission: string }) => api.post('/api/rbac/check', data),
};

// ── Compliance ─────────────────────────────────────────────────────────────

export const complianceApi = {
  status: () => api.get('/api/compliance/status'),
  audit: () => api.get('/api/compliance/audit'),
  policies: () => api.get('/api/compliance/policies'),
  violations: () => api.get('/api/compliance/violations'),
  report: (data: unknown) => api.post('/api/compliance/report', data),
  gdpr: {
    export: (userId: string) => api.get(`/api/compliance/gdpr/export/${userId}`),
    delete: (userId: string) => api.post(`/api/compliance/gdpr/delete/${userId}`),
  },
};

// ── AI Extended ────────────────────────────────────────────────────────────

export const aiApi = {
  chat: (data: unknown) => api.post('/api/ai/chat', data),
  complete: (data: unknown) => api.post('/api/ai/complete', data),
  creti: (data: unknown) => api.post('/api/ai/creti', data),
  autoTag: (data: unknown) => api.post('/api/ai/auto-tag', data),
  search: (query: string) => api.get('/api/ai/search', { params: { q: query } }),
  gaps: () => api.get('/api/ai/gaps'),
  embeddings: {
    status: () => api.get('/api/ai/embeddings/status'),
    rebuild: () => api.post('/api/ai/embeddings/rebuild'),
  },
};

// ── Brain Direct ───────────────────────────────────────────────────────────

export const brainApi = {
  status: () => api.get('/api/brain/status'),
  conscious: (data: unknown) => api.post('/api/brain/conscious', data),
  subconscious: (data: unknown) => api.post('/api/brain/subconscious', data),
  utility: (data: unknown) => api.post('/api/brain/utility', data),
  repair: (data: unknown) => api.post('/api/brain/repair', data),
};

// ── Species ────────────────────────────────────────────────────────────────

export const speciesApi = {
  list: () => api.get('/api/species'),
  get: (id: string) => api.get(`/api/species/${id}`),
  create: (data: unknown) => api.post('/api/species', data),
  classify: (entityId: string) => api.post(`/api/species/classify/${entityId}`),
};

// ── Federation (C-NET) ─────────────────────────────────────────────────────

export const federationApi = {
  status: () => api.get('/api/federation/status'),
  peers: () => api.get('/api/federation/peers'),
  sync: (data: unknown) => api.post('/api/federation/sync', data),
};

// ── Quests ─────────────────────────────────────────────────────────────────

export const questApi = {
  list: () => api.get('/api/quests'),
  get: (id: string) => api.get(`/api/quests/${id}`),
  create: (data: unknown) => api.post('/api/quests', data),
  complete: (id: string) => api.post(`/api/quests/${id}/complete`),
};

// ── Onboarding ─────────────────────────────────────────────────────────────

export const onboardingApi = {
  status: () => api.get('/api/onboarding/status'),
  start: () => api.post('/api/onboarding/start'),
  step: (data: { step: string; data: unknown }) => api.post('/api/onboarding/step', data),
  complete: () => api.post('/api/onboarding/complete'),
  skip: () => api.post('/api/onboarding/skip'),
  reset: () => api.post('/api/onboarding/reset'),
};

// ── Physics ────────────────────────────────────────────────────────────────

export const physicsApi = {
  status: () => api.get('/api/physics/status'),
  simulate: (data: unknown) => api.post('/api/physics/simulate', data),
  validate: (data: unknown) => api.post('/api/physics/validate', data),
  constants: () => api.get('/api/physics/constants'),
  models: () => api.get('/api/physics/models'),
};

// ── Analytics Extended ─────────────────────────────────────────────────────

export const analyticsApi = {
  dashboard: () => api.get('/api/analytics/dashboard'),
  growth: () => api.get('/api/analytics/growth'),
  density: () => api.get('/api/analytics/density'),
  citations: () => api.get('/api/analytics/citations'),
  atlasDomains: () => api.get('/api/analytics/atlas-domains'),
  marketplace: () => api.get('/api/analytics/marketplace'),
  personal: (userId: string) => api.get(`/api/analytics/personal/${userId}`),
};

// ── System ─────────────────────────────────────────────────────────────────

export const systemApi = {
  health: () => api.get('/api/system/health'),
  info: () => api.get('/api/system/info'),
  config: () => api.get('/api/system/config'),
  version: () => api.get('/api/system/version'),
};

// ── Plugins Extended ───────────────────────────────────────────────────────

export const pluginsApi = {
  list: () => api.get('/api/plugins'),
  get: (id: string) => api.get(`/api/plugins/${id}`),
  install: (pluginId: string) => api.post(`/api/plugins/gallery/${encodeURIComponent(pluginId)}/install`),
  uninstall: (id: string) => api.post(`/api/plugins/${id}/uninstall`),
  enable: (id: string) => api.post(`/api/plugins/${id}/enable`),
  disable: (id: string) => api.post(`/api/plugins/${id}/disable`),
  sdk: () => api.get('/api/plugins/sdk'),
};
