/**
 * infrastructure.js
 *
 * Default infrastructure configuration for the Concord Cognitive Engine platform.
 * This file contains seed values for services, messaging, caching, security,
 * analytics, ML operations, and all supporting subsystems.
 *
 * Override per-environment values via CONCORD_ENV or process.env overrides.
 */

// ---------------------------------------------------------------------------
// 1. Services
// ---------------------------------------------------------------------------
const services = [
  {
    name: 'api-gateway',
    port: 3000,
    healthEndpoint: '/health',
    replicas: 3,
    memoryLimit: '512Mi',
    cpuLimit: '500m',
    autoScale: {
      enabled: true,
      minReplicas: 2,
      maxReplicas: 10,
      targetCpuPercent: 70,
      targetMemoryPercent: 80,
      scaleUpCooldownSeconds: 60,
      scaleDownCooldownSeconds: 300,
    },
  },
  {
    name: 'world-sim',
    port: 3001,
    healthEndpoint: '/health',
    replicas: 2,
    memoryLimit: '1Gi',
    cpuLimit: '1000m',
    autoScale: {
      enabled: true,
      minReplicas: 2,
      maxReplicas: 8,
      targetCpuPercent: 65,
      targetMemoryPercent: 75,
      scaleUpCooldownSeconds: 45,
      scaleDownCooldownSeconds: 300,
    },
  },
  {
    name: 'physics-engine',
    port: 3002,
    healthEndpoint: '/health',
    replicas: 2,
    memoryLimit: '2Gi',
    cpuLimit: '2000m',
    autoScale: {
      enabled: true,
      minReplicas: 1,
      maxReplicas: 6,
      targetCpuPercent: 75,
      targetMemoryPercent: 80,
      scaleUpCooldownSeconds: 30,
      scaleDownCooldownSeconds: 180,
    },
  },
  {
    name: 'ai-brain',
    port: 3003,
    healthEndpoint: '/health',
    replicas: 2,
    memoryLimit: '4Gi',
    cpuLimit: '4000m',
    autoScale: {
      enabled: true,
      minReplicas: 1,
      maxReplicas: 4,
      targetCpuPercent: 60,
      targetMemoryPercent: 70,
      scaleUpCooldownSeconds: 60,
      scaleDownCooldownSeconds: 300,
    },
  },
  {
    name: 'marketplace',
    port: 3004,
    healthEndpoint: '/health',
    replicas: 2,
    memoryLimit: '512Mi',
    cpuLimit: '500m',
    autoScale: {
      enabled: true,
      minReplicas: 1,
      maxReplicas: 6,
      targetCpuPercent: 70,
      targetMemoryPercent: 80,
      scaleUpCooldownSeconds: 60,
      scaleDownCooldownSeconds: 300,
    },
  },
  {
    name: 'social-hub',
    port: 3005,
    healthEndpoint: '/health',
    replicas: 2,
    memoryLimit: '512Mi',
    cpuLimit: '500m',
    autoScale: {
      enabled: true,
      minReplicas: 1,
      maxReplicas: 8,
      targetCpuPercent: 70,
      targetMemoryPercent: 80,
      scaleUpCooldownSeconds: 45,
      scaleDownCooldownSeconds: 300,
    },
  },
];

// ---------------------------------------------------------------------------
// 2. Event Bus  (NATS)
// ---------------------------------------------------------------------------
const eventBus = {
  provider: 'nats',
  url: process.env.NATS_URL || 'nats://localhost:4222',
  clusterName: 'concord-events',
  maxReconnectAttempts: 60,
  reconnectTimeWaitMs: 2000,
  channels: [
    {
      name: 'world.updates',
      description: 'World state change broadcasts',
      maxAge: 3600,          // seconds
      maxBytes: 536870912,   // 512 MB
      retention: 'limits',
    },
    {
      name: 'physics.results',
      description: 'Physics simulation output events',
      maxAge: 1800,
      maxBytes: 268435456,   // 256 MB
      retention: 'limits',
    },
    {
      name: 'ai.responses',
      description: 'AI inference result events',
      maxAge: 3600,
      maxBytes: 268435456,
      retention: 'limits',
    },
    {
      name: 'market.transactions',
      description: 'Marketplace transaction events',
      maxAge: 86400,
      maxBytes: 134217728,   // 128 MB
      retention: 'limits',
    },
    {
      name: 'social.events',
      description: 'Social interactions, chat, collaboration',
      maxAge: 7200,
      maxBytes: 268435456,
      retention: 'limits',
    },
    {
      name: 'moderation.flags',
      description: 'Content moderation flags and actions',
      maxAge: 604800,        // 7 days
      maxBytes: 67108864,    // 64 MB
      retention: 'limits',
    },
  ],
};

// ---------------------------------------------------------------------------
// 3. Job Queues  (Bull / Redis-backed)
// ---------------------------------------------------------------------------
const jobQueues = {
  provider: 'bull',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  defaultJobOptions: {
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: 1000,
    removeOnFail: 5000,
  },
  queues: [
    {
      name: 'physics-validation',
      concurrency: 4,
      rateLimit: { max: 200, duration: 1000 },
      priority: 1,
      description: 'Validate physics simulation results against constraints',
    },
    {
      name: 'ai-inference',
      concurrency: 2,
      rateLimit: { max: 50, duration: 1000 },
      priority: 1,
      description: 'Queue AI model inference requests',
    },
    {
      name: 'dtu-indexing',
      concurrency: 6,
      rateLimit: { max: 500, duration: 1000 },
      priority: 2,
      description: 'Index DTU documents for semantic search',
    },
    {
      name: 'notification-dispatch',
      concurrency: 8,
      rateLimit: { max: 1000, duration: 1000 },
      priority: 3,
      description: 'Send push notifications, emails, and in-app alerts',
    },
    {
      name: 'backup-snapshot',
      concurrency: 1,
      rateLimit: { max: 1, duration: 60000 },
      priority: 5,
      description: 'Create point-in-time backup snapshots',
    },
    {
      name: 'analytics-etl',
      concurrency: 2,
      rateLimit: { max: 10, duration: 1000 },
      priority: 4,
      description: 'Extract-transform-load analytics events to warehouse',
    },
  ],
};

// ---------------------------------------------------------------------------
// 4. Cache  (Redis)
// ---------------------------------------------------------------------------
const cache = {
  provider: 'redis',
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  maxMemory: '512mb',
  evictionPolicy: 'allkeys-lru',
  keyPrefixes: {
    session: 'sess:',
    dtu: 'dtu:',
    world: 'world:',
    user: 'user:',
    physics: 'phys:',
    ai: 'ai:',
    market: 'mkt:',
    rateLimit: 'rl:',
  },
  defaultTtlSeconds: 3600,
  connectionPool: {
    min: 5,
    max: 30,
  },
};

// ---------------------------------------------------------------------------
// 5. Edge Cache  (Cloudflare)
// ---------------------------------------------------------------------------
const edgeCache = {
  provider: 'cloudflare',
  enabled: process.env.NODE_ENV === 'production',
  rules: [
    {
      pattern: '/api/static/*',
      ttlSeconds: 86400,         // 24 hours
      cacheEverything: true,
      edgeTtlSeconds: 604800,    // 7 days at edge
      browserTtlSeconds: 86400,
      description: 'Static assets served through the API',
    },
    {
      pattern: '/api/worlds/*/terrain',
      ttlSeconds: 3600,          // 1 hour
      cacheEverything: true,
      edgeTtlSeconds: 7200,
      browserTtlSeconds: 1800,
      bypassOnCookie: 'concord_auth',
      description: 'World terrain data, semi-static',
    },
    {
      pattern: '/api/marketplace/catalog',
      ttlSeconds: 300,           // 5 minutes
      cacheEverything: true,
      edgeTtlSeconds: 600,
      browserTtlSeconds: 120,
      description: 'Marketplace catalog listings',
    },
  ],
  purgeWebhook: process.env.CF_PURGE_WEBHOOK || null,
};

// ---------------------------------------------------------------------------
// 6. Security  (Zero-Trust)
// ---------------------------------------------------------------------------
const security = {
  model: 'zero-trust',
  authentication: {
    provider: 'jwt',
    algorithm: 'RS256',
    tokenExpiry: '15m',
    refreshTokenExpiry: '7d',
    issuer: 'concord-cognitive-engine',
    audience: 'concord-platform',
    clockToleranceSeconds: 30,
  },
  encryption: {
    atRest: {
      algorithm: 'aes-256-gcm',
      keyRotationDays: 90,
      keyDerivation: 'hkdf',
    },
    inTransit: {
      minTlsVersion: '1.3',
      cipherSuites: [
        'TLS_AES_256_GCM_SHA384',
        'TLS_CHACHA20_POLY1305_SHA256',
        'TLS_AES_128_GCM_SHA256',
      ],
      hsts: {
        enabled: true,
        maxAgeSeconds: 63072000,  // 2 years
        includeSubDomains: true,
        preload: true,
      },
    },
  },
  auditLog: {
    enabled: true,
    retentionDays: 90,
    storage: 'append-only',
    events: [
      'auth.login',
      'auth.logout',
      'auth.token_refresh',
      'dtu.create',
      'dtu.update',
      'dtu.delete',
      'world.modify',
      'market.transaction',
      'admin.action',
      'moderation.flag',
    ],
  },
  rateLimit: {
    windowMs: 60000,
    maxRequests: 100,
    skipSuccessfulRequests: false,
  },
  cors: {
    allowedOrigins: process.env.CORS_ORIGINS
      ? process.env.CORS_ORIGINS.split(',')
      : ['http://localhost:3000'],
    allowedMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowCredentials: true,
    maxAgeSeconds: 86400,
  },
};

// ---------------------------------------------------------------------------
// 7. Analytics Pipeline
// ---------------------------------------------------------------------------
const analytics = {
  pipeline: {
    batchSize: 1000,
    flushIntervalSeconds: 30,
    maxBufferSize: 10000,
    retryAttempts: 3,
  },
  storage: {
    provider: 'clickhouse',
    host: process.env.CLICKHOUSE_HOST || 'localhost',
    port: 8123,
    database: 'concord_analytics',
    retentionDays: 365,
    compressionCodec: 'lz4',
    partitionBy: 'toYYYYMM(event_time)',
  },
  realtime: {
    provider: 'redis-streams',
    streamKey: 'analytics:realtime',
    maxLen: 100000,
    consumerGroup: 'analytics-workers',
    blockTimeoutMs: 5000,
  },
  trackedEvents: [
    'page_view',
    'dtu_interaction',
    'world_session',
    'build_action',
    'marketplace_browse',
    'social_interaction',
    'ai_query',
    'physics_simulation',
  ],
};

// ---------------------------------------------------------------------------
// 8. Knowledge Graph  (STAXX)
// ---------------------------------------------------------------------------
const knowledgeGraph = {
  provider: 'staxx',
  host: process.env.STAXX_HOST || 'localhost',
  port: 7687,
  database: 'concord_kg',
  nodeTypes: [
    {
      type: 'DTU',
      description: 'Digital Twin Unit - core knowledge artifact',
      indexedFields: ['id', 'title', 'created_at', 'author_id'],
    },
    {
      type: 'User',
      description: 'Platform user or contributor',
      indexedFields: ['id', 'username', 'reputation'],
    },
    {
      type: 'World',
      description: 'Virtual world or simulation environment',
      indexedFields: ['id', 'name', 'owner_id', 'created_at'],
    },
    {
      type: 'District',
      description: 'Subdivision within a world',
      indexedFields: ['id', 'name', 'world_id', 'type'],
    },
    {
      type: 'Material',
      description: 'Building material or resource type',
      indexedFields: ['id', 'name', 'category', 'rarity'],
    },
    {
      type: 'Firm',
      description: 'Organization or collective entity',
      indexedFields: ['id', 'name', 'founded_at', 'sector'],
    },
  ],
  edgeTypes: [
    {
      type: 'cites',
      description: 'DTU citation reference',
      from: 'DTU',
      to: 'DTU',
      properties: ['context', 'weight', 'cited_at'],
    },
    {
      type: 'created_by',
      description: 'Authorship or creation link',
      from: ['DTU', 'World', 'District'],
      to: 'User',
      properties: ['created_at', 'role'],
    },
    {
      type: 'located_in',
      description: 'Spatial containment relationship',
      from: ['DTU', 'District'],
      to: ['World', 'District'],
      properties: ['position', 'added_at'],
    },
    {
      type: 'made_of',
      description: 'Composition or material relationship',
      from: 'DTU',
      to: 'Material',
      properties: ['quantity', 'unit'],
    },
    {
      type: 'validated_by',
      description: 'Peer-validation or verification link',
      from: 'DTU',
      to: 'User',
      properties: ['validated_at', 'score', 'method'],
    },
  ],
  connectionPool: {
    min: 2,
    max: 20,
  },
};

// ---------------------------------------------------------------------------
// 9. Semantic Search
// ---------------------------------------------------------------------------
const search = {
  model: 'all-MiniLM-L6-v2',
  dimensions: 384,
  index: {
    type: 'hnsw',
    metric: 'cosine',
    efConstruction: 200,
    m: 16,
    efSearch: 128,
  },
  provider: process.env.VECTOR_DB || 'qdrant',
  host: process.env.VECTOR_DB_HOST || 'localhost',
  port: 6333,
  collectionName: 'concord_embeddings',
  batchSize: 64,
  maxResults: 20,
  minScore: 0.65,
  reranking: {
    enabled: true,
    topK: 50,
    model: 'cross-encoder/ms-marco-MiniLM-L-6-v2',
  },
};

// ---------------------------------------------------------------------------
// 10. Observability
// ---------------------------------------------------------------------------
const observability = {
  tracing: {
    provider: 'opentelemetry',
    endpoint: process.env.OTEL_ENDPOINT || 'http://localhost:4318',
    sampleRate: 0.10,
    serviceName: 'concord-cognitive-engine',
    propagation: ['tracecontext', 'baggage'],
    exporterProtocol: 'http/protobuf',
  },
  errorTracking: {
    provider: 'sentry',
    dsn: process.env.SENTRY_DSN || '',
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.10,
    attachStacktrace: true,
    maxBreadcrumbs: 50,
    ignoreErrors: [
      'AbortError',
      'NavigationDuplicated',
    ],
  },
  metrics: {
    provider: 'prometheus',
    scrapeIntervalSeconds: 15,
    endpoint: '/metrics',
    defaultLabels: {
      service: 'concord-cognitive-engine',
    },
    collectors: [
      'http_request_duration_seconds',
      'http_requests_total',
      'active_connections',
      'job_queue_depth',
      'ai_inference_duration_seconds',
      'cache_hit_ratio',
      'event_bus_lag',
    ],
  },
  healthDashboard: {
    enabled: true,
    refreshIntervalSeconds: 30,
    services: [
      'api-gateway',
      'world-sim',
      'physics-engine',
      'ai-brain',
      'marketplace',
      'social-hub',
    ],
    checks: [
      'redis',
      'nats',
      'clickhouse',
      'staxx',
      'vector-db',
    ],
  },
};

// ---------------------------------------------------------------------------
// 11. DevOps
// ---------------------------------------------------------------------------
const devops = {
  ci: {
    provider: 'github-actions',
    testCommand: 'npm test',
    lintCommand: 'npm run lint',
    buildCommand: 'npm run build',
    coverageThreshold: 80,
    timeoutMinutes: 15,
  },
  cd: {
    provider: 'github-actions',
    environments: ['staging', 'production'],
    approvalRequired: {
      staging: false,
      production: true,
    },
    rollbackEnabled: true,
    deployTimeoutMinutes: 20,
  },
  featureFlags: {
    provider: 'internal',
    flags: {
      snap_build_v2: {
        enabled: false,
        description: 'Next-generation snap-to-grid building system',
        rolloutPercent: 0,
      },
      voice_interface: {
        enabled: false,
        description: 'Voice command interface for world interaction',
        rolloutPercent: 0,
      },
      ar_preview: {
        enabled: false,
        description: 'Augmented reality preview of DTU models',
        rolloutPercent: 0,
      },
      multiplayer_256: {
        enabled: false,
        description: 'Support for 256-player concurrent world sessions',
        rolloutPercent: 0,
      },
    },
  },
  backups: {
    schedule: '0 2 * * *',   // daily at 02:00 UTC
    retentionDays: 30,
    storage: 's3',
    bucket: process.env.BACKUP_BUCKET || 'concord-backups',
    encryption: true,
    verifyAfterBackup: true,
  },
  infrastructure: {
    provider: 'terraform',
    stateBackend: 's3',
    lockProvider: 'dynamodb',
    modules: [
      'networking',
      'compute',
      'database',
      'cache',
      'monitoring',
      'cdn',
    ],
  },
};

// ---------------------------------------------------------------------------
// 12. ML Operations  (Ollama)
// ---------------------------------------------------------------------------
const mlOps = {
  inference: {
    provider: 'ollama',
    host: process.env.OLLAMA_HOST || 'http://localhost:11434',
    models: {
      conscious: {
        name: 'qwen2.5:7b',
        purpose: 'Primary reasoning and complex decision-making',
        maxTokens: 4096,
        temperature: 0.7,
        topP: 0.9,
        keepAliveMinutes: 30,
      },
      subconscious: {
        name: 'qwen2.5:1.5b',
        purpose: 'Background pattern recognition and association',
        maxTokens: 2048,
        temperature: 0.5,
        topP: 0.85,
        keepAliveMinutes: 15,
      },
      utility: {
        name: 'qwen2.5:3b',
        purpose: 'General-purpose tasks, classification, summarization',
        maxTokens: 2048,
        temperature: 0.6,
        topP: 0.9,
        keepAliveMinutes: 20,
      },
      repair: {
        name: 'qwen2.5:0.5b',
        purpose: 'Fast self-healing diagnostics and micro-corrections',
        maxTokens: 1024,
        temperature: 0.3,
        topP: 0.8,
        keepAliveMinutes: 60,
      },
    },
    requestTimeoutMs: 120000,
    maxConcurrentRequests: 4,
    retryAttempts: 2,
    retryDelayMs: 1000,
  },
  promptTemplates: {
    'building-assist': {
      system: [
        'You are a building assistant for the Concord virtual world platform.',
        'Help users design, refine, and troubleshoot structures using available',
        'materials and physics constraints. Be concise and constructive.',
      ].join(' '),
      model: 'utility',
      maxTokens: 1024,
      temperature: 0.7,
    },
    'validation-explain': {
      system: [
        'You are a validation analyst. Explain why a DTU passed or failed',
        'validation checks in clear, non-technical language. Reference specific',
        'constraints and suggest corrective actions when applicable.',
      ].join(' '),
      model: 'conscious',
      maxTokens: 2048,
      temperature: 0.5,
    },
    'quest-generate': {
      system: [
        'You are a quest designer for the Concord platform. Generate creative,',
        'balanced quests that encourage exploration, collaboration, and learning.',
        'Include objectives, rewards, difficulty tiers, and narrative hooks.',
      ].join(' '),
      model: 'conscious',
      maxTokens: 4096,
      temperature: 0.85,
    },
  },
};

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

module.exports = {
  services,
  eventBus,
  jobQueues,
  cache,
  edgeCache,
  security,
  analytics,
  knowledgeGraph,
  search,
  observability,
  devops,
  mlOps,
};
