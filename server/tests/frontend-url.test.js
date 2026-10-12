// INC-67 — a template FRONTEND_URL must not be minted into signing links,
// OAuth redirects, CORS allow-lists, or Stripe return URLs.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CANONICAL_FRONTEND_URL,
  DEV_FRONTEND_URL,
  resolveFrontendUrl,
  _resetFrontendUrlWarningForTest,
  setFrontendUrlLogger,
} from "../lib/frontend-url.js";
import { cdnCorsHeaders } from "../lib/cdn-middleware.js";
import registerOAuthRoutes from "../routes/oauth.js";

const ENV_KEYS = [
  "NODE_ENV",
  "FRONTEND_URL",
  "NEXT_PUBLIC_FRONTEND_URL",
  "CONCORD_FRONTEND_URL",
  "NEXT_PUBLIC_API_URL",
];

function withEnv(vars, fn) {
  const prev = {};
  for (const key of ENV_KEYS) prev[key] = process.env[key];
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, vars);
  _resetFrontendUrlWarningForTest();
  setFrontendUrlLogger(null);
  try {
    return fn();
  } finally {
    for (const key of ENV_KEYS) {
      if (prev[key] === undefined) delete process.env[key];
      else process.env[key] = prev[key];
    }
    _resetFrontendUrlWarningForTest();
    setFrontendUrlLogger(null);
  }
}

function capture() {
  const logs = [];
  const logger = (level, event, data) => logs.push({ level, event, data });
  return { logs, logger };
}

describe("resolveFrontendUrl", () => {
  it("rejects template and example hosts and falls back to the canonical origin", () => {
    const bad = [
      "https://yourdomain.com",
      "https://yourdomain.com/",
      "https://www.yourdomain.com/app",
      "https://example.com",
      "https://example.org",
      "https://example.net",
      "http://www.example.com",
    ];
    for (const value of bad) {
      withEnv({ NODE_ENV: "production", FRONTEND_URL: value }, () => {
        const { logs, logger } = capture();
        const url = resolveFrontendUrl({ mode: "public", logger });
        assert.equal(url, CANONICAL_FRONTEND_URL, value);
        assert.equal(logs.length, 1);
        assert.equal(logs[0].level, "error");
        assert.equal(logs[0].event, "frontend_url_placeholder");
        assert.equal(logs[0].data.rejected[0].name, "FRONTEND_URL");
        assert.equal(logs[0].data.rejected[0].reason, "placeholder_host");
      });
    }
  });

  it("rejects localhost in production and keeps it in development", () => {
    withEnv({ NODE_ENV: "production", FRONTEND_URL: "http://localhost:3000" }, () => {
      const { logs, logger } = capture();
      assert.equal(resolveFrontendUrl({ mode: "public", logger }), CANONICAL_FRONTEND_URL);
      assert.equal(logs[0].data.rejected[0].host, "localhost");
    });
    withEnv({ NODE_ENV: "production", FRONTEND_URL: "http://127.0.0.1:5050" }, () => {
      const { logs, logger } = capture();
      assert.equal(resolveFrontendUrl({ mode: "app", logger }), CANONICAL_FRONTEND_URL);
      assert.equal(logs[0].data.rejected[0].host, "127.0.0.1");
    });
    withEnv({ NODE_ENV: "production", CONCORD_FRONTEND_URL: "http://[::1]:3000" }, () => {
      const { logs, logger } = capture();
      assert.equal(resolveFrontendUrl({ mode: "public", logger }), CANONICAL_FRONTEND_URL);
      assert.equal(logs[0].data.rejected[0].host, "::1");
    });
    withEnv({ NODE_ENV: "development", FRONTEND_URL: "http://localhost:3000" }, () => {
      const { logs, logger } = capture();
      assert.equal(resolveFrontendUrl({ mode: "public", logger }), "http://localhost:3000");
      assert.equal(logs.length, 0);
    });
  });

  it("keeps a real origin, including a non-placeholder lookalike host", () => {
    withEnv({ NODE_ENV: "production", FRONTEND_URL: "https://concord-os.org/" }, () => {
      const { logs, logger } = capture();
      assert.equal(resolveFrontendUrl({ mode: "public", logger }), "https://concord-os.org");
      assert.equal(logs.length, 0);
    });
    withEnv({ NODE_ENV: "production", FRONTEND_URL: "https://app.customer.example" }, () => {
      const { logs, logger } = capture();
      assert.equal(resolveFrontendUrl({ mode: "public", logger }), "https://app.customer.example");
      assert.equal(logs.length, 0);
    });
    withEnv({ NODE_ENV: "production", NEXT_PUBLIC_FRONTEND_URL: "https://notexample.com" }, () => {
      assert.equal(resolveFrontendUrl({ mode: "public" }), "https://notexample.com");
    });
  });

  it("skips a placeholder and uses the next real candidate", () => {
    withEnv({
      NODE_ENV: "production",
      FRONTEND_URL: "https://yourdomain.com",
      CONCORD_FRONTEND_URL: "https://concord-os.org",
    }, () => {
      const { logs, logger } = capture();
      assert.equal(resolveFrontendUrl({ mode: "public", logger }), "https://concord-os.org");
      assert.equal(logs.length, 1);
      assert.equal(logs[0].data.rejected[0].name, "FRONTEND_URL");
    });
  });

  it("warns once per bad configuration", () => {
    withEnv({ NODE_ENV: "production", FRONTEND_URL: "https://example.org" }, () => {
      const { logs, logger } = capture();
      resolveFrontendUrl({ mode: "public", logger });
      resolveFrontendUrl({ mode: "public", logger });
      assert.equal(logs.length, 1);
    });
  });

  it("returns null for an unset production app origin and localhost for dev", () => {
    withEnv({ NODE_ENV: "production" }, () => {
      const { logs, logger } = capture();
      assert.equal(resolveFrontendUrl({ mode: "app", logger }), null);
      assert.equal(resolveFrontendUrl({ mode: "public", logger }), CANONICAL_FRONTEND_URL);
      assert.equal(logs.length, 0);
    });
    withEnv({ NODE_ENV: "development" }, () => {
      assert.equal(resolveFrontendUrl({ mode: "app" }), DEV_FRONTEND_URL);
      assert.equal(resolveFrontendUrl({ mode: "public" }), CANONICAL_FRONTEND_URL);
    });
  });

  it("still honors NEXT_PUBLIC_API_URL for billing when no frontend origin is set", () => {
    withEnv({ NODE_ENV: "production", NEXT_PUBLIC_API_URL: "https://billing.concord-os.org" }, () => {
      const { logs, logger } = capture();
      const url = resolveFrontendUrl({ mode: "public", extraEnv: ["NEXT_PUBLIC_API_URL"], logger });
      assert.equal(url, "https://billing.concord-os.org");
      assert.equal(logs.length, 0);
    });
    withEnv({
      NODE_ENV: "production",
      FRONTEND_URL: "https://yourdomain.com",
      NEXT_PUBLIC_API_URL: "https://billing.concord-os.org",
    }, () => {
      const { logs, logger } = capture();
      const url = resolveFrontendUrl({ mode: "public", extraEnv: ["NEXT_PUBLIC_API_URL"], logger });
      assert.equal(url, "https://billing.concord-os.org");
      assert.equal(logs.length, 1);
      assert.equal(logs[0].data.rejected[0].host, "yourdomain.com");
    });
  });

  it("does not put a placeholder host on the CDN allow-list", () => {
    withEnv({ NODE_ENV: "production", FRONTEND_URL: "https://yourdomain.com" }, () => {
      const { logs, logger } = capture();
      setFrontendUrlLogger(logger);
      const mw = cdnCorsHeaders();
      const headers = {};
      const res = { set(name, value) { headers[name.toLowerCase()] = value; } };
      mw({ get: (n) => (n === "Origin" ? "https://yourdomain.com" : ""), path: "/media/clip" }, res, () => {});
      assert.equal(headers["access-control-allow-origin"], undefined);
      const headers2 = {};
      const res2 = { set(name, value) { headers2[name.toLowerCase()] = value; } };
      mw({ get: (n) => (n === "Origin" ? CANONICAL_FRONTEND_URL : ""), path: "/media/clip" }, res2, () => {});
      assert.equal(headers2["access-control-allow-origin"], CANONICAL_FRONTEND_URL);
      assert.ok(logs.some((l) => l.event === "frontend_url_placeholder"));
    });
  });

  it("oauth registration still fails closed when production has no frontend origin", () => {
    withEnv({ NODE_ENV: "production" }, () => {
      const app = { get() {}, post() {}, delete() {} };
      assert.throws(() => registerOAuthRoutes(app, {
        db: null,
        AuthDB: {},
        uid() {},
        createToken() {},
        createRefreshToken() {},
        setAuthCookie() {},
        setRefreshCookie() {},
        auditLog() {},
        structuredLog() {},
        jwt: {},
        _REFRESH_FAMILIES: new Map(),
      }), /FRONTEND_URL or NEXT_PUBLIC_FRONTEND_URL must be set in production/);
    });
  });
});
