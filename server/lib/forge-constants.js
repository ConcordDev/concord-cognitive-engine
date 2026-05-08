/**
 * Forge Constants — Polyglot Monolith Template Engine
 *
 * Defines the 13-section template architecture, default configurations,
 * section metadata, repair cortex thresholds, and thread manager parameters.
 *
 * Part of the Code lens. Every constant here is frozen.
 */

// ═══════════════════════════════════════════════════════════════════════════
// SECTION DEFINITIONS — The 13 chapters of every Forge app
// ═══════════════════════════════════════════════════════════════════════════

export const FORGE_SECTIONS = Object.freeze([
  {
    id: "dependencies",
    number: 1,
    label: "Dependencies",
    description: "Pre-loaded packages — HTTP, database, auth, payments, WebSocket, SSR, testing, logging",
    required: true,
    language: "typescript",
  },
  {
    id: "config",
    number: 2,
    label: "Config",
    description: "Single config object — port, database, JWT, Stripe, CORS, rate limits, session, Concord flag",
    required: true,
    language: "typescript",
  },
  {
    id: "database",
    number: 3,
    label: "Database Schema",
    description: "Declarative table definitions with auto-migration on boot",
    required: true,
    language: "typescript",
  },
  {
    id: "auth",
    number: 4,
    label: "Auth Subsystem",
    description: "Registration, login, logout, password reset, JWT, session management, route protection",
    required: true,
    language: "typescript",
  },
  {
    id: "payments",
    number: 5,
    label: "Payments Subsystem",
    description: "Stripe checkout, webhooks, subscriptions, one-time payments, refunds",
    required: false,
    language: "typescript",
  },
  {
    id: "api",
    number: 6,
    label: "API Subsystem",
    description: "Business logic routes with automatic validation, error handling, and logging",
    required: true,
    language: "typescript",
  },
  {
    id: "frontend",
    number: 7,
    label: "Frontend Subsystem",
    description: "Server-side rendered HTML with hydration — components as functions, inline styles, zero build step",
    required: true,
    language: "typescript",
  },
  {
    id: "websocket",
    number: 8,
    label: "WebSocket Subsystem",
    description: "Real-time channels, rooms, broadcast, private messaging with event handlers",
    required: false,
    language: "typescript",
  },
  {
    id: "jobs",
    number: 9,
    label: "Background Jobs",
    description: "Scheduled tasks, queue processing, cron-like functionality in worker threads",
    required: false,
    language: "typescript",
  },
  {
    id: "threads",
    number: 10,
    label: "Thread Manager",
    description: "Dynamic thread allocation — monitors load, rebalances capacity across subsystems per tick",
    required: true,
    language: "typescript",
  },
  {
    id: "testing",
    number: 11,
    label: "Testing",
    description: "Built-in test runner — tests live next to code, one command, coverage included",
    required: true,
    language: "typescript",
  },
  {
    id: "deployment",
    number: 12,
    label: "Deployment",
    description: "Single command deploy — health checks, graceful shutdown, restart logic, optional Dockerfile",
    required: true,
    language: "typescript",
  },
  {
    id: "repair",
    number: 13,
    label: "Repair Cortex",
    description: "Self-healing immune system — Prophet (predict), Surgeon (fix), Guardian (validate). Cannot be disabled.",
    required: true,
    language: "typescript",
    immutable: true,
  },
]);

// ═══════════════════════════════════════════════════════════════════════════
// DEFAULT CONFIG TEMPLATE — What ships in Section 2
// ═══════════════════════════════════════════════════════════════════════════

export const FORGE_DEFAULT_CONFIG = Object.freeze({
  appName: "my-forge-app",
  port: 3000,
  host: "0.0.0.0",
  database: {
    driver: "sqlite",
    path: "./data/app.db",
    postgresUrl: null,
    poolSize: 10,
    migrateOnBoot: true,
  },
  auth: {
    jwtSecret: "CHANGE_ME_IN_PRODUCTION",
    jwtExpiry: "24h",
    bcryptRounds: 12,
    sessionDuration: "7d",
    maxSessions: 5,
  },
  stripe: {
    secretKey: "",
    publishableKey: "",
    webhookSecret: "",
    currency: "usd",
  },
  cors: {
    origins: ["http://localhost:3000"],
    credentials: true,
  },
  rateLimits: {
    windowMs: 15 * 60 * 1000,
    maxRequests: 100,
  },
  websocket: {
    enabled: true,
    pingInterval: 30000,
    maxPayload: 1024 * 1024,
  },
  threads: {
    tickIntervalMs: 1000,
    minThreads: 2,
    maxThreads: 16,
    rebalanceThreshold: 0.7,
    cpuPinning: false,
  },
  repair: {
    enabled: true,
    sensitivityThreshold: 0.85,
    prophetTickMultiplier: 1,
    surgeonAutoApply: true,
    guardianWatchWindowMs: 60000,
    maxAutoRepairsPerHour: 10,
  },
  concordNode: false,
  concordMesh: {
    repairDTUPropagation: true,
    marketplaceConnectivity: false,
    dtuFormatVersion: "3.0",
  },
  deployment: {
    healthCheckPath: "/health",
    gracefulShutdownMs: 10000,
    autoRestart: true,
    generateDockerfile: false,
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// THREAD MANAGER CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export const THREAD_MANAGER = Object.freeze({
  SUBSYSTEM_WEIGHTS: {
    api: 3,
    frontend: 2,
    websocket: 2,
    jobs: 1,
    auth: 1,
    payments: 1,
    database: 2,
    repair: 1,
  },
  LOAD_THRESHOLDS: {
    idle: 0.1,
    low: 0.3,
    moderate: 0.5,
    high: 0.7,
    critical: 0.9,
  },
  REBALANCE_STRATEGY: {
    borrowFromIdle: true,
    prioritizeAPI: true,
    reserveForRepair: true,
    minRepairThreads: 1,
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// REPAIR CORTEX CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export const REPAIR_CORTEX = Object.freeze({
  PHASES: {
    PROPHET: {
      label: "Prophet",
      description: "Predictive anomaly detection — flags issues before they become failures",
      metrics: [
        "errorRate", "responseTime", "memoryLeaks", "connectionPoolExhaustion",
        "queueDepth", "threadStarvation", "diskIO", "networkLatency",
      ],
      anomalyWindow: 60,
      trendAnalysisDepth: 300,
    },
    SURGEON: {
      label: "Surgeon",
      description: "Root cause diagnosis and automated fix generation with test validation",
      maxFixAttempts: 3,
      requireTestPass: true,
      rollbackOnFailure: true,
    },
    GUARDIAN: {
      label: "Guardian",
      description: "Post-fix regression monitoring and repair knowledge base management",
      monitorDurationMs: 60000,
      regressionThreshold: 0.05,
      escalateOnRollback: true,
    },
  },
  DTU_SCHEMA: {
    type: "repair_event",
    layers: ["human", "core", "machine"],
    fields: [
      "errorSignature", "rootCauseDiagnosis", "fixApplied",
      "testResultsBefore", "testResultsAfter", "subsystemAffected",
      "timestamp", "severity", "repairDuration",
    ],
  },
  AVOIDANCE_PATTERNS: {
    enabled: true,
    maxPatterns: 1000,
    decayAfterDays: 90,
  },
  COLLECTIVE_IMMUNITY: {
    meshPropagation: true,
    preemptivePatchEnabled: true,
    trustThreshold: 0.8,
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// POLYGLOT BRIDGE CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

export const POLYGLOT_BRIDGE = Object.freeze({
  SUPPORTED_LANGUAGES: ["typescript", "python", "rust", "go"],
  COMMUNICATION: {
    method: "shared_memory",
    fallback: "ipc",
    bufferSize: 1024 * 1024 * 16,
    serializationOverhead: false,
  },
  PYTHON_BRIDGE: {
    executable: "python3",
    sharedMemoryKey: "forge_py_shm",
    autoInstallDeps: true,
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// APP TEMPLATES — Premium marketplace templates
// ═══════════════════════════════════════════════════════════════════════════

export const FORGE_TEMPLATES = Object.freeze({
  blank: {
    id: "blank",
    label: "Blank App",
    description: "Empty template with all 13 sections — you fill in the business logic",
    price: 0,
    sections: ["dependencies", "config", "database", "auth", "payments", "api", "frontend", "websocket", "jobs", "threads", "testing", "deployment", "repair"],
  },
  saas: {
    id: "saas",
    label: "SaaS Starter",
    description: "Multi-tenant SaaS with auth, billing, teams, and admin dashboard",
    price: 20,
    sections: ["dependencies", "config", "database", "auth", "payments", "api", "frontend", "websocket", "jobs", "threads", "testing", "deployment", "repair"],
    prefilledDomainTables: ["teams", "invitations", "subscriptions", "features", "audit_log"],
  },
  ecommerce: {
    id: "ecommerce",
    label: "E-Commerce",
    description: "Product catalog, cart, checkout, inventory, order management",
    price: 20,
    sections: ["dependencies", "config", "database", "auth", "payments", "api", "frontend", "websocket", "jobs", "threads", "testing", "deployment", "repair"],
    prefilledDomainTables: ["products", "categories", "cart_items", "orders", "order_items", "inventory", "reviews"],
  },
  social: {
    id: "social",
    label: "Social Platform",
    description: "User profiles, posts, comments, likes, follow system, notifications, feed",
    price: 20,
    sections: ["dependencies", "config", "database", "auth", "payments", "api", "frontend", "websocket", "jobs", "threads", "testing", "deployment", "repair"],
    prefilledDomainTables: ["profiles", "posts", "comments", "likes", "follows", "notifications", "feeds"],
  },
  api_only: {
    id: "api_only",
    label: "API-Only Service",
    description: "Headless API with auth, rate limiting, and documentation",
    price: 0,
    sections: ["dependencies", "config", "database", "auth", "api", "threads", "testing", "deployment", "repair"],
  },
  realtime: {
    id: "realtime",
    label: "Realtime App",
    description: "Chat, collaboration, or live dashboard with WebSocket-first architecture",
    price: 15,
    sections: ["dependencies", "config", "database", "auth", "api", "frontend", "websocket", "threads", "testing", "deployment", "repair"],
    prefilledDomainTables: ["channels", "messages", "presence", "rooms"],
  },
});

// ═══════════════════════════════════════════════════════════════════════════
// MARKETPLACE INTEGRATION
// ═══════════════════════════════════════════════════════════════════════════

export const FORGE_MARKETPLACE = Object.freeze({
  contentType: "forge_template",
  creatorShare: 0.90,
  platformFee: 0.10,
  dtuTypes: [
    { type: "forge_app_template", description: "Complete Forge app template with pre-built subsystems", price: { min: 0, max: 50, unit: "one-time" } },
    { type: "forge_subsystem_pack", description: "Custom subsystem implementations (auth providers, payment gateways, etc.)", price: { min: 5, max: 25, unit: "one-time" } },
    { type: "forge_repair_pattern", description: "Repair cortex pattern packs from production-tested apps", price: { min: 2, max: 15, unit: "one-time" } },
    { type: "forge_polyglot_bridge", description: "Language bridge implementations (Python ML, Rust compute, etc.)", price: { min: 10, max: 40, unit: "one-time" } },
  ],
});
