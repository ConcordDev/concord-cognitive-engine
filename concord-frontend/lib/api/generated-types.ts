/**
 * Auto-generated TypeScript types from OpenAPI specification
 * Source: server/openapi.yaml
 *
 * These types ensure frontend/backend API contract alignment.
 * Regenerate with: npm run generate:types
 */

// ============================================================================
// Health & Status
// ============================================================================

export interface HealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  timestamp: string;
}

export interface SystemStatus {
  version: string;
  nodeEnv: string;
  uptime: number;
  memory: {
    heapUsed: number;
    heapTotal: number;
    rss: number;
  };
  dtu: {
    total: number;
    byTier: {
      regular: number;
      mega: number;
      hyper: number;
      shadow: number;
    };
  };
  llm: {
    ready: boolean;
    provider?: string;
  };
  infrastructure: {
    redis: boolean;
    postgres: boolean;
    meilisearch: boolean;
  };
}

// ============================================================================
// Authentication
// ============================================================================

export interface AuthResponse {
  success: boolean;
  token?: string;
  user?: UserProfile;
  expiresAt?: string;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  role: 'admin' | 'user' | 'readonly';
  createdAt: string;
  lastLogin?: string;
  preferences: Record<string, unknown>;
}

export interface LoginRequest {
  username?: string;
  email?: string;
  password: string;
}

export interface RegisterRequest {
  username: string;
  email: string;
  password: string;
}

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  createdAt: string;
  lastUsed?: string;
}

export interface CreateApiKeyRequest {
  name: string;
  scopes: string[];
}

export interface CreateApiKeyResponse {
  apiKey: ApiKey;
  secret: string; // Only returned once at creation
}

// ============================================================================
// DTUs (Discrete Thought Units)
// ============================================================================

export type DTUTier = 'regular' | 'mega' | 'hyper' | 'shadow' | 'archive';

/**
 * Four-layer DTU substrate per CLAUDE.md: human / core / machine / artifact,
 * plus the CRETI scoring layer the resonance engine attaches.
 *
 * Each layer is OPTIONAL — older DTUs predate one or more layers; consumers
 * MUST null-check before reading. Producers populate fields as data becomes
 * available (server/economy/dtu-pipeline.js, server/lib/forge.js).
 *
 * Both layers use index-signature `[key: string]: unknown` so server-side
 * additions don't require a TS update for non-load-bearing fields.
 */
export interface DTUHumanLayer {
  summary?: string;
  tldr?: string;
  bullets?: string[];
  narrative?: string;
  question?: string;
  answer?: string;
  [key: string]: unknown;
}

export interface DTUCoreLayer {
  claims?: string[];
  // Definitions: server emits an array of "term: meaning" strings.
  definitions?: string[];
  invariants?: string[];
  contradictions?: string[];
  examples?: string[];
  [key: string]: unknown;
}

export interface DTUCretiScores {
  composition?: number;
  resonance?: number;
  engagement?: number;
  trust?: number;
  influence?: number;
  total?: number;
  [key: string]: unknown;
}

export interface DTU {
  id: string;
  title: string;
  content: string;
  summary: string;
  timestamp: string;
  updatedAt?: string;
  tier: DTUTier;
  tags: string[];
  source?: string;
  declaredSourceType?: string;
  parents: string[];
  children: string[];
  relatedIds: string[];
  ownerId?: string;
  isGlobal: boolean;
  resonance: number;
  coherence: number;
  stability: number;
  permissions?: DTUPermissions;
  meta: Record<string, unknown>;

  // Extended runtime fields (populated by API for lens contexts)
  domain?: string;
  artifact?: {
    type: string;
    filename: string;
    sizeBytes: number;
    multipart: boolean;
    parts?: { filename: string; type: string; sizeBytes: number }[];
    hasThumbnail?: boolean;
    hasPreview?: boolean;
  };
  // Four-layer substrate fields. All optional. Replaces the long-standing
  // pattern of casting through `as unknown as Record<string, ...>` to
  // access these in components like DTUDetailView.tsx.
  human?: DTUHumanLayer;
  core?: DTUCoreLayer;
  creti?: DTUCretiScores;
  cretiHuman?: string;
  primaryType?: string;
}

export interface DTUPermissions {
  read: string[];
  write: string[];
  delete: string[];
  promote: string[];
}

export interface CreateDTURequest {
  title?: string;
  content: string;
  tags?: string[];
  source?: string;
  parents?: string[];
  isGlobal?: boolean;
  meta?: Record<string, unknown>;
  declaredSourceType?: string;
}

export interface UpdateDTURequest {
  title?: string;
  content?: string;
  tags?: string[];
  meta?: Record<string, unknown>;
  vote?: number;
  reaction?: string;
}

export interface DTUListResponse {
  dtus: DTU[];
  total: number;
  hasMore: boolean;
}

// ============================================================================
// Forge (DTU Creation)
// ============================================================================

export interface ForgeManualRequest {
  title?: string;
  content: string;
  tags?: string[];
  source?: string;
}

export interface ForgeHybridRequest {
  title?: string;
  content: string;
  tags?: string[];
  source?: string;
}

export interface ForgeAutoRequest {
  prompt: string;
  tags?: string[];
}

export interface ForgeFromSourceRequest {
  url?: string;
  text?: string;
  tags?: string[];
}

export interface ForgeResponse {
  success: boolean;
  dtu?: DTU;
  dtus?: DTU[];
  error?: string;
}

// ============================================================================
// Chat
// ============================================================================

export interface ChatRequest {
  message: string;
  mode?: 'overview' | 'deep' | 'creative' | 'critical' | 'ethics' | 'math' | 'meta' | 'quantum';
}

export interface ChatResponse {
  response: string;
  sources?: Array<{
    dtuId: string;
    title: string;
    relevance: number;
  }>;
  metadata?: {
    tokensUsed?: number;
    model?: string;
    durationMs?: number;
  };
}

// ============================================================================
// Council (Governance)
// ============================================================================

export interface VoteRequest {
  dtuId: string;
  vote: 'approve' | 'reject';
  reason?: string;
}

export interface VoteTally {
  dtuId: string;
  approve: number;
  reject: number;
  abstain: number;
  quorumReached: boolean;
  decision?: 'approved' | 'rejected' | 'pending';
}

export interface CredibilityRequest {
  dtuId: string;
}

export interface CredibilityResponse {
  dtuId: string;
  score: number;
  factors: {
    sourceQuality: number;
    communityTrust: number;
    ageDecay: number;
    citationCount: number;
  };
}

// ============================================================================
// Graph
// ============================================================================

export interface GraphQueryRequest {
  dsl: string;
}

export interface GraphNode {
  id: string;
  label: string;
  tier: DTUTier;
  resonance: number;
  x?: number;
  y?: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: 'parent' | 'related' | 'reference';
  weight?: number;
}

export interface GraphResponse {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export interface GraphVisualParams {
  tier?: DTUTier;
  limit?: number;
}

export interface GraphForceParams {
  centerNode?: string;
  depth?: number;
  maxNodes?: number;
}

// ============================================================================
// Personas
// ============================================================================

export interface Persona {
  id: string;
  name: string;
  description: string;
  traits: string[];
  expertise: string[];
  voice: string;
  active: boolean;
  ownerId?: string;
}

export interface PersonaSpeakRequest {
  text: string;
}

export interface PersonaSpeakResponse {
  response: string;
  persona: string;
}

export interface PersonaAnimateRequest {
  kind?: 'talk' | 'think' | 'react';
}

// ============================================================================
// Marketplace
// ============================================================================

export interface Plugin {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  category: string;
  githubUrl: string;
  downloads: number;
  rating: number;
  reviews: number;
  installed?: boolean;
}

export interface PluginSubmitRequest {
  name: string;
  githubUrl: string;
  description?: string;
  category?: string;
}

export interface PluginInstallRequest {
  pluginId?: string;
  fromGithub?: boolean;
  githubUrl?: string;
}

export interface PluginReviewRequest {
  pluginId: string;
  rating: number;
  comment?: string;
}

// ============================================================================
// Webhooks & Automations
// ============================================================================

export interface Webhook {
  id: string;
  name: string;
  url: string;
  events: string[];
  enabled: boolean;
  createdAt: string;
  lastTriggered?: string;
}

export interface CreateWebhookRequest {
  name: string;
  url: string;
  events: string[];
}

export interface Automation {
  id: string;
  name: string;
  trigger: {
    type: string;
    conditions: Record<string, unknown>;
  };
  actions: Array<{
    type: string;
    params: Record<string, unknown>;
  }>;
  enabled: boolean;
  createdAt: string;
  lastRun?: string;
}

export interface CreateAutomationRequest {
  name: string;
  trigger: Automation['trigger'];
  actions: Automation['actions'];
}

// ============================================================================
// Common Response Types
// ============================================================================

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  code?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface ErrorResponse {
  success: false;
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}
