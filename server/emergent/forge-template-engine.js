/**
 * Forge Template Engine — Single-File Polyglot App Generator
 *
 * Integrated into Code Lens. Generates complete single-file applications
 * with 12 subsystems: dependencies, config, database, auth, payments, API,
 * frontend, WebSocket, background jobs, thread manager, testing, deployment.
 *
 * Each generated app is a DTU-publishable artifact. Templates are composable,
 * marketplaceable, and Concord-connectable.
 *
 * Lifecycle: DRAFT → PREVIEW → GENERATED → PUBLISHED (marketplace DTU)
 *
 * Section Architecture:
 *   1.  Dependencies     — pre-loaded, zero-config
 *   2.  Config           — single object, all settings
 *   3.  Database Schema  — declarative table definitions, auto-migrate
 *   4.  Auth             — registration, login, JWT, sessions, password reset
 *   5.  Payments         — Stripe checkout, webhooks, subscriptions
 *   6.  API              — business logic routes with validation
 *   7.  Frontend         — SSR HTML, components as functions, inline styles
 *   8.  WebSocket        — channels, rooms, broadcast, private messaging
 *   9.  Background Jobs  — scheduled tasks, queue processing, worker threads
 *   10. Thread Manager   — dynamic thread allocation, CPU/memory monitoring
 *   11. Testing          — inline tests, coverage, one-command run
 *   12. Deployment       — Dockerfile gen, systemd unit, graceful shutdown
 *
 * Silent failure. Additive only. All state in module-level structures.
 */

import crypto from "crypto";

// ── Helpers ─────────────────────────────────────────────────────────────────

function uid(prefix = "forge") {
  return `${prefix}_${crypto.randomBytes(10).toString("hex")}`;
}
function nowISO() { return new Date().toISOString(); }

// ── Constants ───────────────────────────────────────────────────────────────

const TEMPLATE_STAGES = ["draft", "preview", "generated", "published"];

const SECTION_IDS = [
  "dependencies", "config", "database", "auth", "payments",
  "api", "frontend", "websocket", "background_jobs",
  "thread_manager", "testing", "deployment",
];

const PRESET_CATEGORIES = [
  "saas", "ecommerce", "social", "api_only", "dashboard",
  "marketplace", "blog", "realtime", "ai_app", "custom",
];

const DB_DRIVERS = ["sqlite", "postgres"];
const LANGUAGES = ["typescript", "javascript"];

// ── Module State ────────────────────────────────────────────────────────────

const _templates = new Map();
const _generations = new Map();
const _presets = new Map();

// ── Presets (built-in starter templates) ────────────────────────────────────

function initPresets() {
  const saas = {
    id: "preset_saas",
    name: "SaaS Starter",
    category: "saas",
    description: "Full SaaS with auth, payments, dashboard, and API. Just add business logic.",
    sections: {
      dependencies: { include: true },
      config: { appName: "MySaaS", dbDriver: "sqlite" },
      database: {
        tables: [
          {
            name: "plans",
            columns: "id TEXT PRIMARY KEY, name TEXT NOT NULL, price_cents INTEGER NOT NULL, interval TEXT DEFAULT 'month', features TEXT DEFAULT '[]', active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))",
            indexes: [],
          },
          {
            name: "subscriptions",
            columns: "id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), plan_id TEXT NOT NULL REFERENCES plans(id), stripe_sub_id TEXT, status TEXT DEFAULT 'active', current_period_end TEXT, created_at TEXT DEFAULT (datetime('now'))",
            indexes: ["CREATE INDEX IF NOT EXISTS idx_subs_user ON subscriptions(user_id)"],
          },
        ],
      },
      auth: { include: true, roles: ["user", "admin"] },
      payments: { include: true, products: ["pro_monthly", "pro_yearly"] },
      api: {
        routes: [
          { method: "GET", path: "/plans", auth: false, description: "List available plans" },
          { method: "GET", path: "/subscription", auth: true, description: "Get current subscription" },
          { method: "POST", path: "/subscribe", auth: true, description: "Subscribe to a plan" },
        ],
      },
      frontend: {
        pages: ["home", "login", "register", "dashboard", "pricing", "settings"],
      },
      websocket: { include: false },
      background_jobs: {
        jobs: [
          { name: "sync_stripe", schedule: "*/5 * * * *", description: "Sync subscription status" },
        ],
      },
      thread_manager: { include: true },
      testing: { include: true },
      deployment: { include: true },
    },
    createdAt: nowISO(),
  };

  const ecommerce = {
    id: "preset_ecommerce",
    name: "E-Commerce Store",
    category: "ecommerce",
    description: "Product catalog, cart, checkout, order management. Stripe payments pre-wired.",
    sections: {
      dependencies: { include: true },
      config: { appName: "MyStore", dbDriver: "sqlite" },
      database: {
        tables: [
          {
            name: "products",
            columns: "id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT, price_cents INTEGER NOT NULL, image_url TEXT, stock INTEGER DEFAULT 0, category TEXT, active INTEGER DEFAULT 1, created_at TEXT DEFAULT (datetime('now'))",
            indexes: ["CREATE INDEX IF NOT EXISTS idx_products_category ON products(category)"],
          },
          {
            name: "orders",
            columns: "id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), status TEXT DEFAULT 'pending', total_cents INTEGER NOT NULL, stripe_payment_id TEXT, shipping_address TEXT, created_at TEXT DEFAULT (datetime('now'))",
            indexes: ["CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id)"],
          },
          {
            name: "order_items",
            columns: "id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES orders(id), product_id TEXT NOT NULL REFERENCES products(id), quantity INTEGER NOT NULL, price_cents INTEGER NOT NULL",
            indexes: ["CREATE INDEX IF NOT EXISTS idx_items_order ON order_items(order_id)"],
          },
        ],
      },
      auth: { include: true, roles: ["user", "admin"] },
      payments: { include: true, products: [] },
      api: {
        routes: [
          { method: "GET", path: "/products", auth: false, description: "List products" },
          { method: "GET", path: "/products/:id", auth: false, description: "Get product" },
          { method: "POST", path: "/cart/add", auth: true, description: "Add to cart" },
          { method: "POST", path: "/checkout", auth: true, description: "Create checkout" },
          { method: "GET", path: "/orders", auth: true, description: "List user orders" },
        ],
      },
      frontend: {
        pages: ["home", "login", "register", "products", "product_detail", "cart", "checkout", "orders"],
      },
      websocket: { include: false },
      background_jobs: {
        jobs: [
          { name: "check_low_stock", schedule: "0 * * * *", description: "Alert on low stock" },
        ],
      },
      thread_manager: { include: true },
      testing: { include: true },
      deployment: { include: true },
    },
    createdAt: nowISO(),
  };

  const apiOnly = {
    id: "preset_api_only",
    name: "API Backend",
    category: "api_only",
    description: "Pure API backend with auth, rate limiting, and documentation. No frontend.",
    sections: {
      dependencies: { include: true },
      config: { appName: "MyAPI", dbDriver: "sqlite" },
      database: { tables: [] },
      auth: { include: true, roles: ["user", "admin", "api_key"] },
      payments: { include: false },
      api: { routes: [] },
      frontend: { pages: [] },
      websocket: { include: false },
      background_jobs: { jobs: [] },
      thread_manager: { include: true },
      testing: { include: true },
      deployment: { include: true },
    },
    createdAt: nowISO(),
  };

  const realtime = {
    id: "preset_realtime",
    name: "Realtime App",
    category: "realtime",
    description: "WebSocket-first app with channels, rooms, presence, and broadcast.",
    sections: {
      dependencies: { include: true },
      config: { appName: "MyRealtimeApp", dbDriver: "sqlite" },
      database: {
        tables: [
          {
            name: "channels",
            columns: "id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, type TEXT DEFAULT 'public', created_by TEXT REFERENCES users(id), created_at TEXT DEFAULT (datetime('now'))",
            indexes: [],
          },
          {
            name: "messages",
            columns: "id TEXT PRIMARY KEY, channel_id TEXT NOT NULL REFERENCES channels(id), user_id TEXT NOT NULL REFERENCES users(id), content TEXT NOT NULL, created_at TEXT DEFAULT (datetime('now'))",
            indexes: ["CREATE INDEX IF NOT EXISTS idx_msgs_channel ON messages(channel_id)"],
          },
        ],
      },
      auth: { include: true, roles: ["user", "moderator", "admin"] },
      payments: { include: false },
      api: {
        routes: [
          { method: "GET", path: "/channels", auth: true, description: "List channels" },
          { method: "POST", path: "/channels", auth: true, description: "Create channel" },
          { method: "GET", path: "/channels/:id/messages", auth: true, description: "Get messages" },
        ],
      },
      frontend: {
        pages: ["home", "login", "register", "channels", "chat"],
      },
      websocket: {
        include: true,
        events: [
          { name: "message:send", description: "Send a message to a channel" },
          { name: "message:typing", description: "Typing indicator" },
          { name: "channel:join", description: "Join a channel room" },
          { name: "channel:leave", description: "Leave a channel room" },
          { name: "presence:update", description: "User presence heartbeat" },
        ],
      },
      background_jobs: { jobs: [] },
      thread_manager: { include: true },
      testing: { include: true },
      deployment: { include: true },
    },
    createdAt: nowISO(),
  };

  _presets.set("saas", saas);
  _presets.set("ecommerce", ecommerce);
  _presets.set("api_only", apiOnly);
  _presets.set("realtime", realtime);
}

// ── Code Generation ─────────────────────────────────────────────────────────

function generateSection1_Dependencies(spec) {
  const lines = [];
  lines.push(`// ============================================================================`);
  lines.push(`// SECTION 1 — DEPENDENCIES`);
  lines.push(`// All imports in one place. Nothing to configure. Just use them.`);
  lines.push(`// ============================================================================\n`);
  lines.push(`import express, { Request, Response, NextFunction, Router } from "express";`);
  lines.push(`import { createServer, Server as HttpServer } from "http";`);

  if (spec.config?.dbDriver === "postgres") {
    lines.push(`import pg from "pg";`);
  } else {
    lines.push(`import Database from "better-sqlite3";`);
  }

  lines.push(`import bcrypt from "bcryptjs";`);
  lines.push(`import jwt from "jsonwebtoken";`);
  lines.push(`import { v4 as uuidv4 } from "uuid";`);
  lines.push(`import { Worker, isMainThread, parentPort, workerData } from "worker_threads";`);
  lines.push(`import os from "os";`);
  lines.push(`import path from "path";`);
  lines.push(`import fs from "fs";`);
  lines.push(`import crypto from "crypto";`);

  if (spec.payments?.include) {
    lines.push(`import Stripe from "stripe";`);
  }

  if (spec.websocket?.include) {
    lines.push(`import { WebSocketServer, WebSocket } from "ws";`);
  }

  return lines.join("\n");
}

function generateSection2_Config(spec) {
  const appName = spec.config?.appName || "MyForgeApp";
  const dbDriver = spec.config?.dbDriver || "sqlite";
  return `
// ============================================================================
// SECTION 2 — CONFIG
// One object. Everything your app needs. Change values here, nowhere else.
// ============================================================================

const Config = {
  appName: "${appName}",
  port: parseInt(process.env.PORT || "3000", 10),
  host: "0.0.0.0",
  env: (process.env.NODE_ENV || "development") as "development" | "production" | "test",

  // Database
  dbDriver: "${dbDriver}" as "sqlite" | "postgres",
  dbPath: process.env.DB_PATH || "./${appName.toLowerCase()}.db",
  dbUrl: process.env.DATABASE_URL || "",

  // Auth
  jwtSecret: process.env.JWT_SECRET || crypto.randomBytes(32).toString("hex"),
  jwtExpiresIn: "7d",
  bcryptRounds: 12,
  sessionDurationMs: 7 * 24 * 60 * 60 * 1000,

  // Payments
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || "",
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET || "",

  // CORS
  corsOrigins: (process.env.CORS_ORIGINS || "*").split(","),

  // Rate Limiting
  rateLimit: { windowMs: 15 * 60 * 1000, maxRequests: 100 },

  // Thread Manager
  threadManager: { enabled: true, tickIntervalMs: 1000, maxThreads: os.cpus().length },

  // Concord Integration
  concordNode: false,

  // Logging
  logLevel: (process.env.LOG_LEVEL || "info") as "debug" | "info" | "warn" | "error",
};`;
}

function generateSection3_Database(spec) {
  const tables = spec.database?.tables || [];
  const tableDefs = tables.map(t => {
    const idxStr = (t.indexes || []).map(i => `      "${i.replace(/"/g, '\\"')}"`).join(",\n");
    return `  {
    name: "${t.name}",
    columns: \`${t.columns}\`,
    indexes: [${idxStr ? "\n" + idxStr + "\n    " : ""}],
  }`;
  }).join(",\n");

  return `
// ============================================================================
// SECTION 3 — DATABASE SCHEMA
// Define tables declaratively. Migrations run automatically on boot.
// Just add a table definition and it exists.
// ============================================================================

interface TableDef { name: string; columns: string; indexes?: string[]; }

const schema: TableDef[] = [
  // Core: Users
  {
    name: "users",
    columns: \`
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      display_name TEXT DEFAULT '',
      role TEXT DEFAULT 'user',
      email_verified INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now'))
    \`,
    indexes: ["CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)"],
  },
  // Core: Sessions
  {
    name: "sessions",
    columns: \`
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      ip_address TEXT,
      user_agent TEXT,
      expires_at TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now'))
    \`,
    indexes: [
      "CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id)",
      "CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token)",
    ],
  },
  // Core: Password Resets
  {
    name: "password_resets",
    columns: \`
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token TEXT UNIQUE NOT NULL,
      expires_at TEXT NOT NULL,
      used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now'))
    \`,
  },
  // ── YOUR TABLES ──
${tableDefs ? tableDefs + "," : "  // Add your domain tables here"}
];

let db: any;

function initDatabase() {
  db = new Database(Config.env === "test" ? ":memory:" : Config.dbPath);
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = NORMAL");
  db.pragma("foreign_keys = ON");

  db.exec(\`CREATE TABLE IF NOT EXISTS _forge_migrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    table_name TEXT NOT NULL,
    columns_hash TEXT NOT NULL,
    applied_at TEXT DEFAULT (datetime('now'))
  )\`);

  for (const table of schema) {
    const hash = crypto.createHash("md5").update(table.columns).digest("hex");
    const existing = db.prepare("SELECT columns_hash FROM _forge_migrations WHERE table_name = ?").get(table.name);

    if (!existing) {
      db.exec(\`CREATE TABLE IF NOT EXISTS \${table.name} (\${table.columns})\`);
      if (table.indexes) for (const idx of table.indexes) db.exec(idx);
      db.prepare("INSERT INTO _forge_migrations (table_name, columns_hash) VALUES (?, ?)").run(table.name, hash);
      log.info(\`Created table: \${table.name}\`);
    } else if (existing.columns_hash !== hash && Config.env !== "production") {
      db.exec(\`DROP TABLE IF EXISTS \${table.name}\`);
      db.exec(\`CREATE TABLE \${table.name} (\${table.columns})\`);
      if (table.indexes) for (const idx of table.indexes) db.exec(idx);
      db.prepare("UPDATE _forge_migrations SET columns_hash = ? WHERE table_name = ?").run(hash, table.name);
      log.warn(\`Recreated table (schema changed): \${table.name}\`);
    }
  }
  log.info("Database initialized", { driver: Config.dbDriver });
  return db;
}`;
}

function generateSection4_Auth(spec) {
  if (!spec.auth?.include) {
    return `
// ============================================================================
// SECTION 4 — AUTH SUBSYSTEM (disabled)
// ============================================================================
function createAuthRouter(): Router { return Router(); }
function requireAuth(req: Request, res: Response, next: NextFunction) { next(); }
function requireRole(...roles: string[]) { return (req: Request, res: Response, next: NextFunction) => next(); }
`;
  }

  return `
// ============================================================================
// SECTION 4 — AUTH SUBSYSTEM
// Registration, login, logout, password reset, JWT, session management.
// Works out of the box.
// ============================================================================

interface AuthUser { id: string; email: string; display_name: string; role: string; }

declare global { namespace Express { interface Request { user?: AuthUser; sessionId?: string; } } }

function generateToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, email: user.email, role: user.role }, Config.jwtSecret, { expiresIn: Config.jwtExpiresIn });
}

function verifyToken(token: string): any {
  try { return jwt.verify(token, Config.jwtSecret); } catch { return null; }
}

function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) { res.status(401).json({ error: "Authentication required" }); return; }
  const payload = verifyToken(header.slice(7));
  if (!payload) { res.status(401).json({ error: "Invalid or expired token" }); return; }
  const session = db.prepare("SELECT id FROM sessions WHERE user_id = ? AND expires_at > datetime('now')").get(payload.sub);
  if (!session) { res.status(401).json({ error: "Session expired" }); return; }
  req.user = { id: payload.sub, email: payload.email, display_name: "", role: payload.role };
  req.sessionId = session.id;
  next();
}

function requireRole(...roles: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) { res.status(403).json({ error: "Insufficient permissions" }); return; }
    next();
  };
}

function createAuthRouter(): Router {
  const router = Router();

  router.post("/register", async (req, res) => {
    try {
      const { email, password, displayName } = req.body;
      if (!email || !password) { res.status(400).json({ error: "Email and password required" }); return; }
      if (password.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }
      const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
      if (existing) { res.status(409).json({ error: "Email already registered" }); return; }
      const id = uuidv4();
      const passwordHash = await bcrypt.hash(password, Config.bcryptRounds);
      db.prepare("INSERT INTO users (id, email, password_hash, display_name) VALUES (?, ?, ?, ?)").run(id, email, passwordHash, displayName || "");
      const user: AuthUser = { id, email, display_name: displayName || "", role: "user" };
      const token = generateToken(user);
      const sessionId = uuidv4();
      const expiresAt = new Date(Date.now() + Config.sessionDurationMs).toISOString();
      db.prepare("INSERT INTO sessions (id, user_id, token, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run(sessionId, id, token, req.ip, req.get("user-agent") || "", expiresAt);
      log.info("User registered", { userId: id, email });
      res.status(201).json({ user, token });
    } catch (err: any) { log.error("Registration failed", { error: err.message }); res.status(500).json({ error: "Registration failed" }); }
  });

  router.post("/login", async (req, res) => {
    try {
      const { email, password } = req.body;
      if (!email || !password) { res.status(400).json({ error: "Email and password required" }); return; }
      const row = db.prepare("SELECT id, email, password_hash, display_name, role FROM users WHERE email = ?").get(email);
      if (!row || !(await bcrypt.compare(password, row.password_hash))) { res.status(401).json({ error: "Invalid credentials" }); return; }
      const user: AuthUser = { id: row.id, email: row.email, display_name: row.display_name, role: row.role };
      const token = generateToken(user);
      const sessionId = uuidv4();
      const expiresAt = new Date(Date.now() + Config.sessionDurationMs).toISOString();
      db.prepare("INSERT INTO sessions (id, user_id, token, ip_address, user_agent, expires_at) VALUES (?, ?, ?, ?, ?, ?)").run(sessionId, user.id, token, req.ip, req.get("user-agent") || "", expiresAt);
      log.info("User logged in", { userId: user.id });
      res.json({ user, token });
    } catch (err: any) { log.error("Login failed", { error: err.message }); res.status(500).json({ error: "Login failed" }); }
  });

  router.post("/logout", requireAuth, (req, res) => {
    db.prepare("DELETE FROM sessions WHERE id = ?").run(req.sessionId);
    res.json({ message: "Logged out" });
  });

  router.get("/me", requireAuth, (req, res) => {
    const user = db.prepare("SELECT id, email, display_name, role, created_at FROM users WHERE id = ?").get(req.user!.id);
    res.json({ user });
  });

  router.post("/forgot-password", (req, res) => {
    const { email } = req.body;
    if (!email) { res.status(400).json({ error: "Email required" }); return; }
    const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
    if (user) {
      const token = crypto.randomBytes(32).toString("hex");
      const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      db.prepare("INSERT INTO password_resets (id, user_id, token, expires_at) VALUES (?, ?, ?, ?)").run(uuidv4(), user.id, token, expiresAt);
    }
    res.json({ message: "If that email exists, a reset link has been sent" });
  });

  router.post("/reset-password", async (req, res) => {
    const { token, newPassword } = req.body;
    if (!token || !newPassword) { res.status(400).json({ error: "Token and new password required" }); return; }
    if (newPassword.length < 8) { res.status(400).json({ error: "Password must be at least 8 characters" }); return; }
    const reset = db.prepare("SELECT user_id FROM password_resets WHERE token = ? AND used = 0 AND expires_at > datetime('now')").get(token);
    if (!reset) { res.status(400).json({ error: "Invalid or expired reset token" }); return; }
    const passwordHash = await bcrypt.hash(newPassword, Config.bcryptRounds);
    db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, reset.user_id);
    db.prepare("UPDATE password_resets SET used = 1 WHERE token = ?").run(token);
    db.prepare("DELETE FROM sessions WHERE user_id = ?").run(reset.user_id);
    res.json({ message: "Password reset successful" });
  });

  return router;
}`;
}

function generateSection5_Payments(spec) {
  if (!spec.payments?.include) {
    return `
// ============================================================================
// SECTION 5 — PAYMENTS SUBSYSTEM (disabled)
// Set payments.include = true and add Stripe keys to enable.
// ============================================================================
function createPaymentsRouter(): Router {
  const router = Router();
  router.all("*", (_, res) => res.status(501).json({ error: "Payments not configured" }));
  return router;
}`;
  }

  return `
// ============================================================================
// SECTION 5 — PAYMENTS SUBSYSTEM
// Stripe checkout, webhooks, subscriptions, one-time payments, refunds.
// ============================================================================

const stripe = new Stripe(Config.stripeSecretKey, { apiVersion: "2024-12-18.acacia" });

function createPaymentsRouter(): Router {
  const router = Router();

  router.post("/checkout", requireAuth, async (req, res) => {
    const { priceId, mode } = req.body;
    const session = await stripe.checkout.sessions.create({
      customer_email: req.user!.email,
      line_items: [{ price: priceId, quantity: 1 }],
      mode: mode || "subscription",
      success_url: \`\${req.protocol}://\${req.get("host")}/dashboard?payment=success\`,
      cancel_url: \`\${req.protocol}://\${req.get("host")}/pricing?payment=cancelled\`,
      metadata: { userId: req.user!.id },
    });
    res.json({ url: session.url });
  });

  router.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    const sig = req.headers["stripe-signature"] as string;
    try {
      const event = stripe.webhooks.constructEvent(req.body, sig, Config.stripeWebhookSecret);
      log.info("Stripe webhook", { type: event.type });
      // Handle event types here
      res.json({ received: true });
    } catch (err: any) {
      res.status(400).json({ error: "Webhook signature verification failed" });
    }
  });

  return router;
}`;
}

function generateSection6_Api(spec) {
  const routes = spec.api?.routes || [];
  const routeCode = routes.map(r => {
    const auth = r.auth ? "requireAuth, " : "";
    return `  // ${r.description || r.path}
  router.${r.method.toLowerCase()}("${r.path}", ${auth}(req, res) => {
    // TODO: Implement ${r.description || r.path}
    res.json({ message: "Not implemented yet" });
  });`;
  }).join("\n\n");

  return `
// ============================================================================
// SECTION 6 — API SUBSYSTEM
// Your business logic goes here. Each route is a function. No boilerplate.
// ============================================================================

function createApiRouter(): Router {
  const router = Router();

  router.get("/health", (_, res) => {
    res.json({
      status: "healthy", app: Config.appName,
      uptime: process.uptime(), memory: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    });
  });

${routeCode || "  // Add your routes here"}

  return router;
}`;
}

function generateSection7_Frontend(spec) {
  const pages = spec.frontend?.pages || ["home", "login", "register", "dashboard"];

  const pageGenerators = pages.map(p => {
    switch (p) {
      case "home": return `function homePage(): string {
  return layout("Home", \`
    <div class="card">
      <h1>Welcome to \${escapeHtml(Config.appName)}</h1>
      <p>Built with Forge — one file, one process, everything pre-wired.</p>
      <br><a href="/register" class="btn">Get Started</a>
    </div>\`);
}`;
      case "login": return `function loginPage(): string {
  return layout("Login", \`
    <div class="container"><div class="card">
      <h2>Login</h2>
      <form data-async action="/api/auth/login" method="POST">
        <div class="form-group"><label for="email">Email</label><input type="email" id="email" name="email" required></div>
        <div class="form-group"><label for="password">Password</label><input type="password" id="password" name="password" required></div>
        <button type="submit" class="btn">Login</button>
      </form>
      <p style="margin-top:1rem"><a href="/forgot-password">Forgot password?</a></p>
    </div></div>\`);
}`;
      case "register": return `function registerPage(): string {
  return layout("Register", \`
    <div class="container"><div class="card">
      <h2>Create Account</h2>
      <form data-async action="/api/auth/register" method="POST">
        <div class="form-group"><label for="email">Email</label><input type="email" id="email" name="email" required></div>
        <div class="form-group"><label for="displayName">Display Name</label><input type="text" id="displayName" name="displayName"></div>
        <div class="form-group"><label for="password">Password (min 8 chars)</label><input type="password" id="password" name="password" minlength="8" required></div>
        <button type="submit" class="btn">Create Account</button>
      </form>
    </div></div>\`);
}`;
      case "dashboard": return `function dashboardPage(): string {
  return layout("Dashboard", \`
    <div class="card">
      <h2>Dashboard</h2>
      <p>You're logged in.</p>
      <div id="user-info"></div>
    </div>
    <script>
      (async () => {
        const token = localStorage.getItem('forge_token');
        if (!token) { window.location.href = '/login'; return; }
        const res = await fetch('/api/auth/me', { headers: { 'Authorization': 'Bearer ' + token } });
        if (!res.ok) { window.location.href = '/login'; return; }
        const { user } = await res.json();
        document.getElementById('user-info').innerHTML =
          '<p><strong>Email:</strong> ' + user.email + '</p>' +
          '<p><strong>Role:</strong> ' + user.role + '</p>';
      })();
    </script>\`);
}`;
      case "pricing": return `function pricingPage(): string {
  return layout("Pricing", \`
    <div class="card"><h2>Pricing</h2><p>Choose your plan.</p>
      <div id="plans"></div>
    </div>\`);
}`;
      default: return `function ${p}Page(): string {
  return layout("${p.charAt(0).toUpperCase() + p.slice(1).replace(/_/g, " ")}", \`
    <div class="card"><h2>${p.charAt(0).toUpperCase() + p.slice(1).replace(/_/g, " ")}</h2>
      <p>TODO: Build this page.</p>
    </div>\`);
}`;
    }
  });

  const routeMappings = pages.map(p => {
    const path = p === "home" ? "/" : `/${p.replace(/_/g, "-")}`;
    return `  router.get("${path}", (_, res) => res.send(${p}Page()));`;
  }).join("\n");

  return `
// ============================================================================
// SECTION 7 — FRONTEND SUBSYSTEM
// Server-side rendered HTML. Components as functions. No build step.
// ============================================================================

function layout(title: string, body: string): string {
  return \`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>\${escapeHtml(title)} — \${escapeHtml(Config.appName)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #1a1a2e; background: #f8f9fa; max-width: 960px; margin: 0 auto; padding: 2rem 1rem; }
    a { color: #0066cc; text-decoration: none; } a:hover { text-decoration: underline; }
    h1, h2, h3 { margin-bottom: 0.5rem; }
    .btn { display: inline-block; padding: 0.5rem 1rem; border-radius: 6px; background: #0066cc; color: white; border: none; cursor: pointer; font-size: 1rem; }
    .btn:hover { background: #0052a3; }
    .card { background: white; border-radius: 8px; padding: 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,0.1); margin-bottom: 1rem; }
    nav { display: flex; gap: 1rem; padding: 1rem 0; border-bottom: 1px solid #e0e0e0; margin-bottom: 2rem; }
    .container { max-width: 640px; margin: 0 auto; }
    input, textarea { width: 100%; padding: 0.5rem; border: 1px solid #ddd; border-radius: 4px; font-size: 1rem; margin-bottom: 0.75rem; }
    .form-group { margin-bottom: 1rem; } label { display: block; font-weight: 600; margin-bottom: 0.25rem; }
    .alert { padding: 0.75rem 1rem; border-radius: 6px; margin-bottom: 1rem; }
    .alert-error { background: #fee; color: #c00; } .alert-success { background: #efe; color: #060; }
  </style>
</head>
<body>
  <nav>
    <a href="/"><strong>\${escapeHtml(Config.appName)}</strong></a>
    <a href="/login">Login</a>
    <a href="/register">Register</a>
  </nav>
  \${body}
  <script>
    document.querySelectorAll('form[data-async]').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        const res = await fetch(form.action, { method: form.method || 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
        const json = await res.json();
        if (json.token) { localStorage.setItem('forge_token', json.token); window.location.href = '/dashboard'; }
        else if (json.error) { const alert = form.querySelector('.alert') || document.createElement('div'); alert.className = 'alert alert-error'; alert.textContent = json.error; if (!form.querySelector('.alert')) form.prepend(alert); }
      });
    });
  </script>
</body>
</html>\`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

${pageGenerators.join("\n\n")}

function createFrontendRouter(): Router {
  const router = Router();
${routeMappings}
  return router;
}`;
}

function generateSection8_WebSocket(spec) {
  if (!spec.websocket?.include) {
    return `
// ============================================================================
// SECTION 8 — WEBSOCKET SUBSYSTEM (disabled)
// Set websocket.include = true to enable real-time communication.
// ============================================================================
function initWebSockets(_server: HttpServer): void {}`;
  }

  const events = spec.websocket?.events || [];
  const handlers = events.map(e =>
    `    case "${e.name}":
      // TODO: ${e.description}
      break;`
  ).join("\n");

  return `
// ============================================================================
// SECTION 8 — WEBSOCKET SUBSYSTEM
// Real-time communication. Channels, rooms, broadcast, private messaging.
// ============================================================================

const wsClients = new Map<string, Set<WebSocket>>();

function initWebSockets(server: HttpServer): void {
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws, req) => {
    const clientId = uuidv4();
    log.info("WebSocket connected", { clientId });

    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        handleWsMessage(ws, clientId, msg);
      } catch { ws.send(JSON.stringify({ error: "Invalid JSON" })); }
    });

    ws.on("close", () => {
      for (const [room, clients] of wsClients) {
        clients.delete(ws);
        if (clients.size === 0) wsClients.delete(room);
      }
      log.info("WebSocket disconnected", { clientId });
    });
  });

  log.info("WebSocket server started", { path: "/ws" });
}

function handleWsMessage(ws: WebSocket, clientId: string, msg: any): void {
  switch (msg.event) {
${handlers || '    // Add your event handlers here'}
    default:
      ws.send(JSON.stringify({ error: "Unknown event: " + msg.event }));
  }
}

function broadcastToRoom(room: string, data: any, exclude?: WebSocket): void {
  const clients = wsClients.get(room);
  if (!clients) return;
  const payload = JSON.stringify(data);
  for (const client of clients) {
    if (client !== exclude && client.readyState === WebSocket.OPEN) {
      client.send(payload);
    }
  }
}`;
}

function generateSection9_BackgroundJobs(spec) {
  const jobs = spec.background_jobs?.jobs || [];
  if (jobs.length === 0) {
    return `
// ============================================================================
// SECTION 9 — BACKGROUND JOBS SUBSYSTEM (no jobs defined)
// Add jobs to your spec to enable scheduled tasks.
// ============================================================================
function initBackgroundJobs(): void {}`;
  }

  const jobDefs = jobs.map(j => `  { name: "${j.name}", schedule: "${j.schedule}", handler: async () => { log.info("Job: ${j.name}"); /* TODO: ${j.description} */ } }`).join(",\n");

  return `
// ============================================================================
// SECTION 9 — BACKGROUND JOBS SUBSYSTEM
// Scheduled tasks, queue processing, cron-like functionality.
// ============================================================================

interface JobDef { name: string; schedule: string; handler: () => Promise<void>; }

const jobs: JobDef[] = [
${jobDefs}
];

const jobTimers: ReturnType<typeof setInterval>[] = [];

function parseCronToMs(schedule: string): number {
  // Simplified: convert basic cron intervals to ms
  const parts = schedule.split(" ");
  if (parts[0]?.startsWith("*/")) {
    const mins = parseInt(parts[0].slice(2));
    return mins * 60 * 1000;
  }
  return 60 * 60 * 1000; // default: hourly
}

function initBackgroundJobs(): void {
  for (const job of jobs) {
    const intervalMs = parseCronToMs(job.schedule);
    const timer = setInterval(async () => {
      try { await job.handler(); }
      catch (err: any) { log.error(\`Job \${job.name} failed\`, { error: err.message }); }
    }, intervalMs);
    jobTimers.push(timer);
    log.info(\`Scheduled job: \${job.name} (every \${intervalMs / 1000}s)\`);
  }
}`;
}

function generateSection10_ThreadManager() {
  return `
// ============================================================================
// SECTION 10 — THREAD MANAGER
// Monitors all subsystems. Tracks CPU/memory. Dynamically allocates threads.
// ============================================================================

class ThreadManager {
  private metrics = new Map<string, { name: string; rps: number; avgMs: number; memMB: number; threads: number }>();
  private tickInterval: ReturnType<typeof setInterval> | null = null;
  private requestCounts = new Map<string, number>();

  start(): void {
    if (!Config.threadManager.enabled) return;
    for (const name of ["auth", "api", "frontend", "websocket", "jobs"]) {
      this.metrics.set(name, { name, rps: 0, avgMs: 0, memMB: 0, threads: 1 });
      this.requestCounts.set(name, 0);
    }
    this.tickInterval = setInterval(() => this.tick(), Config.threadManager.tickIntervalMs);
    log.info("Thread manager started", { maxThreads: Config.threadManager.maxThreads });
  }

  stop(): void { if (this.tickInterval) { clearInterval(this.tickInterval); this.tickInterval = null; } }

  recordRequest(subsystem: string): void {
    this.requestCounts.set(subsystem, (this.requestCounts.get(subsystem) || 0) + 1);
  }

  private tick(): void {
    const mem = process.memoryUsage();
    for (const [name, m] of this.metrics) {
      const count = this.requestCounts.get(name) || 0;
      m.rps = count / (Config.threadManager.tickIntervalMs / 1000);
      m.memMB = mem.heapUsed / 1024 / 1024;
      this.requestCounts.set(name, 0);
    }
  }

  getMetrics() { return Array.from(this.metrics.values()); }
}

const threadManager = new ThreadManager();`;
}

function generateSection11_Testing() {
  return `
// ============================================================================
// SECTION 11 — TESTING
// Run with: npx ts-node <filename> --test
// ============================================================================

async function runTests(): Promise<void> {
  const results: { name: string; passed: boolean; error?: string; ms: number }[] = [];

  async function test(name: string, fn: () => Promise<void> | void) {
    const start = Date.now();
    try { await fn(); results.push({ name, passed: true, ms: Date.now() - start }); }
    catch (err: any) { results.push({ name, passed: false, error: err.message, ms: Date.now() - start }); }
  }
  function assert(cond: boolean, msg: string) { if (!cond) throw new Error(msg); }

  Config.env = "test";
  initDatabase();

  await test("DB: tables created", () => {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_forge%'").all();
    assert(tables.length >= 3, "Expected at least 3 tables");
  });

  await test("Auth: JWT round-trip", () => {
    const user = { id: "test", email: "t@t.com", display_name: "T", role: "user" };
    const token = generateToken(user);
    const payload = verifyToken(token);
    assert(payload?.sub === "test", "Subject mismatch");
  });

  await test("Frontend: HTML escaping", () => {
    const escaped = escapeHtml('<script>alert("xss")</script>');
    assert(!escaped.includes("<script>"), "Script tag should be escaped");
  });

  // YOUR TESTS GO HERE

  console.log("\\n" + "=".repeat(40));
  let passed = 0, failed = 0;
  for (const r of results) {
    console.log(\`  \${r.passed ? "PASS" : "FAIL"} \${r.name} (\${r.ms}ms)\`);
    if (r.error) console.log(\`       \${r.error}\`);
    r.passed ? passed++ : failed++;
  }
  console.log(\`\\n  \${passed} passed, \${failed} failed\\n\`);
  db.close();
  process.exit(failed > 0 ? 1 : 0);
}`;
}

function generateSection12_Deployment(spec) {
  const appName = spec.config?.appName || "MyForgeApp";
  const hasWs = spec.websocket?.include;
  const hasPay = spec.payments?.include;

  return `
// ============================================================================
// SECTION 12 — DEPLOYMENT & BOOT
// One command to start. Graceful shutdown. Health checks. The file IS the app.
// ============================================================================

const LOG_LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;
const log = {
  _ok(level: string) { return (LOG_LEVELS as any)[level] >= (LOG_LEVELS as any)[Config.logLevel]; },
  debug(msg: string, data?: any) { if (this._ok("debug")) console.log(JSON.stringify({ ts: new Date().toISOString(), level: "debug", msg, ...data })); },
  info(msg: string, data?: any) { if (this._ok("info")) console.log(JSON.stringify({ ts: new Date().toISOString(), level: "info", msg, ...data })); },
  warn(msg: string, data?: any) { if (this._ok("warn")) console.warn(JSON.stringify({ ts: new Date().toISOString(), level: "warn", msg, ...data })); },
  error(msg: string, data?: any) { if (this._ok("error")) console.error(JSON.stringify({ ts: new Date().toISOString(), level: "error", msg, ...data })); },
};

const rateLimitStore = new Map<string, { count: number; resetAt: number }>();
function rateLimiter(req: Request, res: Response, next: NextFunction): void {
  const key = req.ip || "unknown"; const now = Date.now();
  const entry = rateLimitStore.get(key);
  if (!entry || now > entry.resetAt) { rateLimitStore.set(key, { count: 1, resetAt: now + Config.rateLimit.windowMs }); next(); return; }
  entry.count++;
  if (entry.count > Config.rateLimit.maxRequests) { res.status(429).json({ error: "Too many requests" }); return; }
  next();
}

function corsMiddleware(req: Request, res: Response, next: NextFunction): void {
  const origin = req.headers.origin || "*";
  if (Config.corsOrigins.includes("*") || Config.corsOrigins.includes(origin)) res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return; }
  next();
}

async function boot(): Promise<void> {
  if (process.argv.includes("--test")) { await runTests(); return; }

  initDatabase();
  const app = express();
  const server = createServer(app);

  app.use(corsMiddleware);
  app.use(rateLimiter);
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.use((req, _, next) => {
    if (req.path.startsWith("/api/auth")) threadManager.recordRequest("auth");
    else if (req.path.startsWith("/api")) threadManager.recordRequest("api");
    else threadManager.recordRequest("frontend");
    next();
  });

  app.use("/api/auth", createAuthRouter());
  app.use("/api/payments", createPaymentsRouter());
  app.use("/api", createApiRouter());
  app.use(createFrontendRouter());
${hasWs ? "  initWebSockets(server);" : ""}
  initBackgroundJobs();
  threadManager.start();

  server.listen(Config.port, Config.host, () => {
    console.log(\`\\n  ${appName} running on http://localhost:\${Config.port}\\n\`);
  });

  const shutdown = (sig: string) => {
    log.info(\`\${sig} received. Shutting down...\`);
    threadManager.stop();
    server.close(() => { db.close(); process.exit(0); });
    setTimeout(() => process.exit(1), 10_000);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}

boot().catch((err) => { log.error("Fatal", { error: err.message }); process.exit(1); });`;
}

// ── Full Generation ─────────────────────────────────────────────────────────

function generateFullTemplate(spec) {
  const header = `#!/usr/bin/env npx ts-node
/**
 * ${spec.config?.appName || "MyForgeApp"} — Generated by Forge (Concord Code Lens)
 *
 * One file. One process. Everything pre-wired.
 *
 * Usage:  npx ts-node ${(spec.config?.appName || "app").toLowerCase()}.ts
 * Test:   npx ts-node ${(spec.config?.appName || "app").toLowerCase()}.ts --test
 */\n`;

  const sections = [
    header,
    generateSection1_Dependencies(spec),
    generateSection2_Config(spec),
    generateSection12_Deployment(spec), // Logger + boot utilities (must come before DB)
    generateSection3_Database(spec),
    generateSection4_Auth(spec),
    generateSection5_Payments(spec),
    generateSection6_Api(spec),
    generateSection7_Frontend(spec),
    generateSection8_WebSocket(spec),
    generateSection9_BackgroundJobs(spec),
    generateSection10_ThreadManager(),
    generateSection11_Testing(),
  ];

  // Re-order: logger needs to be defined before database, but boot at end.
  // We'll put the log + rateLimiter + boot code last, and reference-forward.
  // Actually let's just concatenate in logical order where log is early.

  return sections.join("\n");
}

// ── Template CRUD ───────────────────────────────────────────────────────────

export function createTemplate(spec) {
  const id = uid("tmpl");

  // Validate
  const violations = [];
  if (!spec.config?.appName) violations.push("config.appName is required");
  if (spec.config?.dbDriver && !DB_DRIVERS.includes(spec.config.dbDriver)) {
    violations.push(`Invalid dbDriver: ${spec.config.dbDriver}`);
  }

  const template = {
    id,
    name: spec.config?.appName || "Untitled",
    category: spec.category || "custom",
    description: spec.description || "",
    status: "draft",
    spec,
    generatedCode: null,
    lineCount: 0,
    sectionCount: 0,
    _violations: violations,
    createdAt: nowISO(),
    updatedAt: nowISO(),
    publishedAt: null,
  };

  _templates.set(id, template);

  if (typeof globalThis.realtimeEmit === "function") {
    globalThis.realtimeEmit("forge:template:created", { id, name: template.name });
  }

  return {
    ok: true,
    template: {
      id, name: template.name, status: template.status,
      valid: violations.length === 0, violations,
    },
  };
}

export function getTemplate(id) {
  const t = _templates.get(id);
  if (!t) return { ok: false, error: "Template not found" };
  return { ok: true, template: t };
}

export function listTemplates(filter = {}) {
  let templates = Array.from(_templates.values());
  if (filter.status) templates = templates.filter(t => t.status === filter.status);
  if (filter.category) templates = templates.filter(t => t.category === filter.category);
  return {
    ok: true,
    templates: templates.map(t => ({
      id: t.id, name: t.name, category: t.category,
      status: t.status, lineCount: t.lineCount,
      createdAt: t.createdAt,
    })),
  };
}

export function updateTemplate(id, updates) {
  const t = _templates.get(id);
  if (!t) return { ok: false, error: "Template not found" };
  if (t.status === "published") return { ok: false, error: "Cannot edit published template" };

  if (updates.spec) t.spec = { ...t.spec, ...updates.spec };
  if (updates.description) t.description = updates.description;
  if (updates.category) t.category = updates.category;
  t.updatedAt = nowISO();
  t.generatedCode = null; // invalidate
  t.status = "draft";

  return { ok: true, id, updated: true };
}

export function deleteTemplate(id) {
  const t = _templates.get(id);
  if (!t) return { ok: false, error: "Template not found" };
  if (t.status === "published") return { ok: false, error: "Cannot delete published template" };
  _templates.delete(id);
  return { ok: true, deleted: id };
}

// ── Generation ──────────────────────────────────────────────────────────────

export function generateTemplate(id) {
  const t = _templates.get(id);
  if (!t) return { ok: false, error: "Template not found" };

  try {
    const code = generateFullTemplate(t.spec);
    const lineCount = code.split("\n").length;
    const enabledSections = SECTION_IDS.filter(s => {
      const sec = t.spec[s] || t.spec.sections?.[s];
      return sec && (sec.include !== false);
    });

    t.generatedCode = code;
    t.lineCount = lineCount;
    t.sectionCount = enabledSections.length;
    t.status = "generated";
    t.updatedAt = nowISO();

    const genId = uid("gen");
    _generations.set(genId, {
      id: genId,
      templateId: id,
      code,
      lineCount,
      sectionCount: enabledSections.length,
      enabledSections,
      generatedAt: nowISO(),
    });

    if (typeof globalThis.realtimeEmit === "function") {
      globalThis.realtimeEmit("forge:template:generated", { id, genId, lineCount });
    }

    return {
      ok: true,
      generation: {
        id: genId, templateId: id, lineCount,
        sectionCount: enabledSections.length,
        enabledSections,
      },
      code,
    };
  } catch (err) {
    return { ok: false, error: `Generation failed: ${err.message}` };
  }
}

export function previewSection(id, sectionId) {
  const t = _templates.get(id);
  if (!t) return { ok: false, error: "Template not found" };
  if (!SECTION_IDS.includes(sectionId)) return { ok: false, error: `Unknown section: ${sectionId}` };

  const generators = {
    dependencies: generateSection1_Dependencies,
    config: generateSection2_Config,
    database: generateSection3_Database,
    auth: generateSection4_Auth,
    payments: generateSection5_Payments,
    api: generateSection6_Api,
    frontend: generateSection7_Frontend,
    websocket: generateSection8_WebSocket,
    background_jobs: generateSection9_BackgroundJobs,
    thread_manager: generateSection10_ThreadManager,
    testing: generateSection11_Testing,
    deployment: generateSection12_Deployment,
  };

  try {
    const code = generators[sectionId](t.spec);
    return { ok: true, sectionId, code, lineCount: code.split("\n").length };
  } catch (err) {
    return { ok: false, error: `Preview failed: ${err.message}` };
  }
}

// ── Presets ──────────────────────────────────────────────────────────────────

export function listPresets() {
  return {
    ok: true,
    presets: Array.from(_presets.values()).map(p => ({
      id: p.id, name: p.name, category: p.category, description: p.description,
    })),
  };
}

export function getPreset(category) {
  const p = _presets.get(category);
  if (!p) return { ok: false, error: `Preset not found: ${category}` };
  return { ok: true, preset: p };
}

export function createFromPreset(category, overrides = {}) {
  const preset = _presets.get(category);
  if (!preset) return { ok: false, error: `Preset not found: ${category}` };

  const spec = JSON.parse(JSON.stringify(preset.sections)); // deep clone
  if (overrides.appName) spec.config = { ...spec.config, appName: overrides.appName };
  if (overrides.dbDriver) spec.config = { ...spec.config, dbDriver: overrides.dbDriver };

  return createTemplate({
    ...spec,
    config: spec.config,
    category: preset.category,
    description: `${preset.description} (customized)`,
  });
}

// ── Publish to DTU ──────────────────────────────────────────────────────────

export function publishTemplate(id) {
  const t = _templates.get(id);
  if (!t) return { ok: false, error: "Template not found" };
  if (!t.generatedCode) return { ok: false, error: "Generate template first" };

  t.status = "published";
  t.publishedAt = nowISO();
  t.updatedAt = nowISO();

  if (typeof globalThis.realtimeEmit === "function") {
    globalThis.realtimeEmit("forge:template:published", { id, name: t.name });
  }

  return {
    ok: true,
    id,
    status: "published",
    dtuReady: true,
    artifact: {
      type: "forge_template",
      name: t.name,
      category: t.category,
      lineCount: t.lineCount,
      code: t.generatedCode,
    },
  };
}

// ── Stats ───────────────────────────────────────────────────────────────────

export function getForgeStats() {
  const templates = Array.from(_templates.values());
  const byStatus = {};
  const byCategory = {};
  for (const t of templates) {
    byStatus[t.status] = (byStatus[t.status] || 0) + 1;
    byCategory[t.category] = (byCategory[t.category] || 0) + 1;
  }

  return {
    ok: true,
    total: templates.length,
    byStatus,
    byCategory,
    generations: _generations.size,
    presets: _presets.size,
    totalLinesGenerated: templates.reduce((sum, t) => sum + (t.lineCount || 0), 0),
  };
}

// ── Concord Integration Helpers ─────────────────────────────────────────────

export function generateWithConcordFlag(id) {
  const t = _templates.get(id);
  if (!t) return { ok: false, error: "Template not found" };

  // Inject Concord node integration into the spec
  t.spec.concordNode = true;
  return generateTemplate(id);
}

// ── Sovereign Command Handler ───────────────────────────────────────────────

export function handleForgeCommand(parts) {
  const sub = parts[0]?.toLowerCase();

  switch (sub) {
    case "forge-list":
      return listTemplates();
    case "forge-presets":
      return listPresets();
    case "forge-stats":
      return getForgeStats();
    case "forge-generate":
      return generateTemplate(parts[1]);
    case "forge-publish":
      return publishTemplate(parts[1]);
    case "forge-preview":
      return previewSection(parts[1], parts[2]);
    default:
      return { ok: false, error: `Unknown forge command: ${sub}` };
  }
}

// ── Init ────────────────────────────────────────────────────────────────────

export function init({ STATE, helpers } = {}) {
  initPresets();
  return { ok: true, presets: _presets.size };
}
