/* global window, document */
/**
 * Browser Engine — Playwright-Based Browser Automation for Concord
 *
 * Provides JS-rendered page fetching, screenshots, data extraction, form filling,
 * and infinite-scroll capture via a shared headless Chromium instance.
 *
 * Singleton pattern: one browser instance shared across all requests.
 * Auto-cleanup on process exit (SIGINT, SIGTERM, beforeExit).
 *
 * All public methods return structured results with provenance metadata
 * (source URL, timestamps, engine version) suitable for DTU creation.
 */

import logger from "../logger.js";
import { fetchPublicUrl } from "./public-fetch.js";

// ── Constants ────────────────────────────────────────────────────────────────

const ENGINE_VERSION = "1.0.0";
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const MAX_SCROLL_ITERATIONS = 50;
const SCROLL_PAUSE_MS = 1500;
const MAX_PAGE_CONTENT_BYTES = 10 * 1024 * 1024; // 10 MB safety cap
const FETCH_FALLBACK_TIMEOUT_MS = 10_000;
const FETCH_FALLBACK_MAX_BYTES = 1_500_000;
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ConcordOS/2.0";

// ── Singleton State ──────────────────────────────────────────────────────────

/** @type {import('playwright').Browser | null} */
let _browser = null;

/** @type {Promise<import('playwright').Browser> | null} */
let _browserLaunchPromise = null;

/** @type {boolean} */
let _cleanupRegistered = false;

/** @type {(() => Promise<import('playwright').Browser>) | null} */
let _ensureBrowserOverride = null;

/**
 * TEST-ONLY: force fetchRenderedPage's browser launch to succeed or throw
 * without starting Chromium. Pass null to restore the real launcher.
 * @param {(() => Promise<import('playwright').Browser>) | null} fn
 */
export function __setEnsureBrowserForTests(fn) {
  _ensureBrowserOverride = typeof fn === "function" ? fn : null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/**
 * Lazily import playwright. Allows the server to start even when
 * playwright browsers are not installed — errors surface only when
 * BrowserEngine methods are actually called.
 */
async function getPlaywright() {
  try {
    const pw = await import("playwright");
    return pw.default || pw;
  } catch (err) {
    throw new Error(
      `Playwright is not available: ${err.message}. Install with: npm install playwright && npx playwright install chromium`
    );
  }
}

/**
 * Get or launch the shared browser instance.
 * Uses a launch-promise guard to avoid concurrent launches.
 */
async function ensureBrowser() {
  if (_browser?.isConnected()) return _browser;

  // If a launch is already in flight, wait for it
  if (_browserLaunchPromise) {
    _browser = await _browserLaunchPromise;
    if (_browser?.isConnected()) return _browser;
  }

  _browserLaunchPromise = (async () => {
    const pw = await getPlaywright();
    logger.info?.("[browser-engine] Launching headless Chromium");
    const browser = await pw.chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
      ],
    });
    registerCleanup(browser);
    return browser;
  })();

  try {
    _browser = await _browserLaunchPromise;
  } finally {
    _browserLaunchPromise = null;
  }

  return _browser;
}

/**
 * Register process-exit cleanup handlers (once).
 */
function registerCleanup(browser) {
  if (_cleanupRegistered) return;
  _cleanupRegistered = true;

  const cleanup = async () => {
    try {
      if (browser?.isConnected()) {
        logger.info?.("[browser-engine] Closing browser on process exit");
        await browser.close();
      }
    } catch (_e) {
      /* best-effort */
    }
    _browser = null;
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);
  process.on("beforeExit", cleanup);
}

/**
 * Create a fresh page with standard settings.
 * @param {import('playwright').Browser} browser
 * @param {object} opts
 * @returns {Promise<import('playwright').Page>}
 */
async function createPage(browser, opts = {}) {
  const context = await browser.newContext({
    viewport: opts.viewport || DEFAULT_VIEWPORT,
    userAgent: opts.userAgent || USER_AGENT,
    ignoreHTTPSErrors: true,
    javaScriptEnabled: opts.javaScriptEnabled !== false,
  });

  // Block heavy resources when we only need text content
  if (opts.blockMedia) {
    await context.route(
      /\.(png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf|eot|mp4|webm|ogg|mp3)$/i,
      (route) => route.abort()
    );
  }

  const page = await context.newPage();
  page.setDefaultTimeout(opts.timeout || DEFAULT_TIMEOUT);
  return page;
}

/**
 * Build provenance metadata for every result.
 */
function provenance(url, extra = {}) {
  return {
    sourceUrl: url,
    fetchedAt: new Date().toISOString(),
    via: "browser-engine",
    engineVersion: ENGINE_VERSION,
    rendered: true,
    ...extra,
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// BrowserEngine Class
// ══════════════════════════════════════════════════════════════════════════════

export class BrowserEngine {
  /**
   * @param {object} [config]
   * @param {number} [config.timeout] - Default navigation timeout in ms
   * @param {{width: number, height: number}} [config.viewport] - Default viewport
   */
  constructor(config = {}) {
    this.timeout = config.timeout || DEFAULT_TIMEOUT;
    this.viewport = config.viewport || DEFAULT_VIEWPORT;
  }

  /**
   * Fetch a fully JS-rendered page. Returns the final HTML and extracted
   * text content after all scripts have executed.
   *
   * @param {string} url - URL to fetch
   * @param {object} [options]
   * @param {number} [options.timeout] - Navigation timeout
   * @param {string} [options.waitFor] - CSS selector to wait for before capturing
   * @returns {Promise<{ok: boolean, html: string, text: string, title: string, provenance: object}>}
   */
  async fetchRenderedPage(url, options = {}) {
    if (!url) throw new Error("url is required");
    let browser;
    try {
      const launch = _ensureBrowserOverride || ensureBrowser;
      browser = await launch();
    } catch (err) {
      if (isChromiumUnavailable(err)) {
        logger.warn?.(`[browser-engine] Chromium unavailable; using fetch fallback for ${url}: ${err?.message}`);
        return fetchHtmlFallback(url, options);
      }
      return {
        ok: false,
        error: err?.message || String(err),
        url,
        provenance: provenance(url, { error: err?.message, rendered: false }),
      };
    }
    const page = await createPage(browser, {
      timeout: options.timeout || this.timeout,
      viewport: this.viewport,
      blockMedia: true,
    });

    try {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: options.timeout || this.timeout,
      });

      if (options.waitFor) {
        await page.waitForSelector(options.waitFor, {
          timeout: Math.min(options.timeout || this.timeout, 15_000),
        });
      }

      const html = await page.content();
      const title = await page.title();
      const text = await page.evaluate(() => {
        // Remove script/style tags before extracting text
         
        const clone = document.body.cloneNode(true);
        for (const el of clone.querySelectorAll("script, style, noscript")) {
          el.remove();
        }
        return clone.innerText || clone.textContent || "";
      });

      // Safety cap
      const cappedHtml =
        html.length > MAX_PAGE_CONTENT_BYTES
          ? html.slice(0, MAX_PAGE_CONTENT_BYTES)
          : html;
      const cappedText =
        text.length > MAX_PAGE_CONTENT_BYTES
          ? text.slice(0, MAX_PAGE_CONTENT_BYTES)
          : text;

      return {
        ok: true,
        html: cappedHtml,
        text: cappedText,
        title,
        url,
        provenance: provenance(url, { contentLength: cappedHtml.length }),
      };
    } catch (err) {
      logger.warn?.("[browser-engine] fetchRenderedPage failed", {
        url,
        error: err.message,
      });
      return {
        ok: false,
        error: err.message,
        url,
        provenance: provenance(url, { error: err.message }),
      };
    } finally {
      await page.context().close().catch(() => {});
    }
  }

  /**
   * Capture a screenshot of a URL.
   *
   * @param {string} url
   * @param {object} [options]
   * @param {boolean} [options.fullPage] - Capture full page (default: false)
   * @param {number} [options.timeout]
   * @param {{width: number, height: number}} [options.viewport]
   * @param {string} [options.waitFor] - CSS selector to wait for
   * @returns {Promise<{ok: boolean, buffer: Buffer, mimeType: string, provenance: object}>}
   */
  async screenshot(url, options = {}) {
    if (!url) throw new Error("url is required");
    const browser = await ensureBrowser();
    const page = await createPage(browser, {
      timeout: options.timeout || this.timeout,
      viewport: options.viewport || this.viewport,
    });

    try {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: options.timeout || this.timeout,
      });

      if (options.waitFor) {
        await page.waitForSelector(options.waitFor, {
          timeout: Math.min(options.timeout || this.timeout, 15_000),
        });
      }

      const buffer = await page.screenshot({
        fullPage: options.fullPage || false,
        type: "png",
      });

      return {
        ok: true,
        buffer,
        mimeType: "image/png",
        provenance: provenance(url, { bytes: buffer.length }),
      };
    } catch (err) {
      logger.warn?.("[browser-engine] screenshot failed", {
        url,
        error: err.message,
      });
      return {
        ok: false,
        error: err.message,
        url,
        provenance: provenance(url, { error: err.message }),
      };
    } finally {
      await page.context().close().catch(() => {});
    }
  }

  /**
   * Extract specific data from a page using CSS selectors.
   *
   * @param {string} url
   * @param {Object<string, string>} selectors - Map of name → CSS selector
   * @param {object} [options]
   * @param {number} [options.timeout]
   * @param {string} [options.waitFor] - CSS selector to wait for before extracting
   * @returns {Promise<{ok: boolean, data: Object<string, string[]>, provenance: object}>}
   */
  async extractData(url, selectors, options = {}) {
    if (!url) throw new Error("url is required");
    if (!selectors || typeof selectors !== "object") {
      throw new Error("selectors must be an object mapping names to CSS selectors");
    }
    const browser = await ensureBrowser();
    const page = await createPage(browser, {
      timeout: options.timeout || this.timeout,
      viewport: this.viewport,
      blockMedia: true,
    });

    try {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: options.timeout || this.timeout,
      });

      if (options.waitFor) {
        await page.waitForSelector(options.waitFor, {
          timeout: Math.min(options.timeout || this.timeout, 15_000),
        });
      }

      const data = {};
      for (const [name, selector] of Object.entries(selectors)) {
        try {
          data[name] = await page.$$eval(selector, (els) =>
            els.map((el) => ({
              text: (el.innerText || el.textContent || "").trim(),
              href: el.href || null,
              src: el.src || null,
              html: el.innerHTML?.slice(0, 2000) || "",
            }))
          );
        } catch (_e) {
          data[name] = [];
        }
      }

      return {
        ok: true,
        data,
        url,
        provenance: provenance(url, {
          selectorCount: Object.keys(selectors).length,
        }),
      };
    } catch (err) {
      logger.warn?.("[browser-engine] extractData failed", {
        url,
        error: err.message,
      });
      return {
        ok: false,
        error: err.message,
        url,
        provenance: provenance(url, { error: err.message }),
      };
    } finally {
      await page.context().close().catch(() => {});
    }
  }

  /**
   * Fill and submit a form on a page.
   *
   * @param {string} url
   * @param {Array<{selector: string, value: string, type?: string}>} fields
   * @param {object} [options]
   * @param {string} [options.submitSelector] - Selector for submit button (default: auto-detect)
   * @param {number} [options.timeout]
   * @returns {Promise<{ok: boolean, finalUrl: string, title: string, text: string, provenance: object}>}
   */
  async fillForm(url, fields, options = {}) {
    if (!url) throw new Error("url is required");
    if (!Array.isArray(fields) || fields.length === 0) {
      throw new Error("fields must be a non-empty array of {selector, value}");
    }
    const browser = await ensureBrowser();
    const page = await createPage(browser, {
      timeout: options.timeout || this.timeout,
      viewport: this.viewport,
    });

    try {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: options.timeout || this.timeout,
      });

      // Fill each field
      for (const field of fields) {
        const { selector, value, type } = field;
        if (!selector || value === undefined) continue;

        if (type === "select") {
          await page.selectOption(selector, value);
        } else if (type === "checkbox") {
          const checked = await page.$eval(selector, (el) => el.checked);
          if ((value === "true" || value === true) !== checked) {
            await page.click(selector);
          }
        } else if (type === "file") {
          await page.setInputFiles(selector, value);
        } else {
          await page.fill(selector, String(value));
        }
      }

      // Submit
      const submitSelector =
        options.submitSelector ||
        'button[type="submit"], input[type="submit"], form button:last-of-type';

      await page.click(submitSelector);

      // Wait for navigation or network idle after submit
      await page
        .waitForLoadState("networkidle", { timeout: 15_000 })
        .catch(() => {});

      const finalUrl = page.url();
      const title = await page.title();
      const text = await page.evaluate(() => {
         
        const clone = document.body.cloneNode(true);
        for (const el of clone.querySelectorAll("script, style, noscript")) {
          el.remove();
        }
        return (clone.innerText || clone.textContent || "").slice(0, 50_000);
      });

      return {
        ok: true,
        finalUrl,
        title,
        text,
        provenance: provenance(url, { finalUrl, formFields: fields.length }),
      };
    } catch (err) {
      logger.warn?.("[browser-engine] fillForm failed", {
        url,
        error: err.message,
      });
      return {
        ok: false,
        error: err.message,
        url,
        provenance: provenance(url, { error: err.message }),
      };
    } finally {
      await page.context().close().catch(() => {});
    }
  }

  /**
   * Scroll a page incrementally (infinite-scroll capture), collecting content
   * as new elements load. Returns accumulated text and page snapshots.
   *
   * @param {string} url
   * @param {object} [options]
   * @param {number} [options.maxScrolls] - Max scroll iterations (default: 50)
   * @param {number} [options.scrollPauseMs] - Pause between scrolls (default: 1500)
   * @param {number} [options.timeout]
   * @param {string} [options.itemSelector] - CSS selector for individual items to collect
   * @returns {Promise<{ok: boolean, items: string[], totalHeight: number, scrolls: number, provenance: object}>}
   */
  async scrollAndCapture(url, options = {}) {
    if (!url) throw new Error("url is required");
    const browser = await ensureBrowser();
    const page = await createPage(browser, {
      timeout: options.timeout || this.timeout,
      viewport: this.viewport,
    });

    const maxScrolls = Math.min(
      options.maxScrolls || MAX_SCROLL_ITERATIONS,
      MAX_SCROLL_ITERATIONS
    );
    const pauseMs = options.scrollPauseMs || SCROLL_PAUSE_MS;

    try {
      await page.goto(url, {
        waitUntil: "networkidle",
        timeout: options.timeout || this.timeout,
      });

      let previousHeight = 0;
      let scrollCount = 0;
      const items = [];
      const seenTexts = new Set();

      for (let i = 0; i < maxScrolls; i++) {
        // Collect items if selector provided
        if (options.itemSelector) {
          const newItems = await page.$$eval(
            options.itemSelector,
            (els) => els.map((el) => (el.innerText || el.textContent || "").trim())
          );
          for (const item of newItems) {
            if (item && !seenTexts.has(item)) {
              seenTexts.add(item);
              items.push(item);
            }
          }
        }

        // Scroll to bottom
        const currentHeight = await page.evaluate(() => {
           
          window.scrollTo(0, document.body.scrollHeight);
           
          return document.body.scrollHeight;
        });

        scrollCount++;

        // If height hasn't changed, content is fully loaded
        if (currentHeight === previousHeight) break;
        previousHeight = currentHeight;

        // Wait for new content to load
        await page.waitForTimeout(pauseMs);
      }

      // Final collection pass
      if (options.itemSelector) {
        const finalItems = await page.$$eval(
          options.itemSelector,
          (els) => els.map((el) => (el.innerText || el.textContent || "").trim())
        );
        for (const item of finalItems) {
          if (item && !seenTexts.has(item)) {
            seenTexts.add(item);
            items.push(item);
          }
        }
      }

      // If no item selector, grab full page text
      if (!options.itemSelector) {
        const fullText = await page.evaluate(() => {
           
          const clone = document.body.cloneNode(true);
          for (const el of clone.querySelectorAll("script, style, noscript")) {
            el.remove();
          }
          return (clone.innerText || clone.textContent || "").trim();
        });
        items.push(fullText.slice(0, MAX_PAGE_CONTENT_BYTES));
      }

      return {
        ok: true,
        items,
        totalHeight: previousHeight,
        scrolls: scrollCount,
        url,
        provenance: provenance(url, {
          scrolls: scrollCount,
          itemCount: items.length,
          totalHeight: previousHeight,
        }),
      };
    } catch (err) {
      logger.warn?.("[browser-engine] scrollAndCapture failed", {
        url,
        error: err.message,
      });
      return {
        ok: false,
        error: err.message,
        url,
        provenance: provenance(url, { error: err.message }),
      };
    } finally {
      await page.context().close().catch(() => {});
    }
  }

  /**
   * Gracefully close the shared browser instance.
   * Call this during server shutdown for clean cleanup.
   */
  async close() {
    if (_browser?.isConnected()) {
      logger.info?.("[browser-engine] Closing browser instance");
      await _browser.close().catch(() => {});
      _browser = null;
    }
  }

  /**
   * Check if the browser instance is currently active.
   */
  isActive() {
    return _browser?.isConnected() || false;
  }
}

// ══════════════════════════════════════════════════════════════════════════════
// Module-Level Singleton Export
// ══════════════════════════════════════════════════════════════════════════════

/** Shared singleton instance with default config */
export const browserEngine = new BrowserEngine();

/**
 * The engine instance callers (browse_url) already expect. Chromium may
 * still be absent; fetchRenderedPage falls back to a plain HTTP fetch then.
 */
export function getBrowserEngine() {
  return browserEngine;
}

function isChromiumUnavailable(err) {
  const msg = String(err?.message || err || "");
  return /playwright is not available|executable doesn't exist|failed to launch|browsertype\.launch/i.test(msg);
}

function decodeHtmlEntities(s) {
  return String(s)
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#0*39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => safeCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => safeCodePoint(parseInt(d, 10)))
    .replace(/&amp;/gi, "&");
}

function safeCodePoint(n) {
  if (!Number.isFinite(n) || n <= 0 || n > 0x10FFFF) return "";
  try { return String.fromCodePoint(n); } catch { return ""; }
}

/**
 * Readable text from a raw HTML document. Drops script/style/head chrome
 * and decodes the common entities. No DOM parser — this is the Chromium-less path.
 */
export function extractReadableText(html) {
  const src = String(html || "");
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(src);
  const title = titleMatch
    ? decodeHtmlEntities(titleMatch[1].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim()
    : "";
  const text = decodeHtmlEntities(
    src
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<head[\s\S]*?<\/head>/gi, " ")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<(?:br|\/p|\/div|\/h[1-6]|\/li|\/tr|\/blockquote|\/section|\/article)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[ \t]+\n/g, "\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { title, text };
}

async function readBodyCapped(res, maxBytes) {
  const reader = res?.body && typeof res.body.getReader === "function" ? res.body.getReader() : null;
  if (!reader) {
    const buf = Buffer.from(await res.arrayBuffer());
    const capped = buf.subarray(0, maxBytes);
    return { html: capped.toString("utf8"), truncated: buf.length > maxBytes, bytes: capped.length };
  }
  const chunks = [];
  let received = 0;
  let truncated = false;
  while (received < maxBytes) {
    const { done, value } = await reader.read();
    if (done) break;
    const bytes = Buffer.from(value);
    const room = maxBytes - received;
    if (bytes.length > room) {
      chunks.push(bytes.subarray(0, room));
      received += room;
      truncated = true;
      break;
    }
    chunks.push(bytes);
    received += bytes.length;
  }
  try { await reader.cancel(); } catch { /* producer may already be done */ }
  return { html: Buffer.concat(chunks).toString("utf8"), truncated, bytes: received };
}

/**
 * Plain HTTP fetch + tag strip, used when Playwright Chromium is not installed.
 * The result is labeled as a fetch fallback (not a JS-rendered page).
 */
export async function fetchHtmlFallback(url, options = {}) {
  const timeoutMs = Number(options.timeout) > 0 ? Number(options.timeout) : FETCH_FALLBACK_TIMEOUT_MS;
  const maxBytes = Number(options.maxBytes) > 0 ? Number(options.maxBytes) : FETCH_FALLBACK_MAX_BYTES;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetchPublicUrl(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,text/plain;q=0.9,*/*;q=0.1",
      },
    }, typeof options.fetchImpl === "function" ? { fetchImpl: options.fetchImpl } : {});
    if (!res?.ok) {
      const status = res?.status ?? "error";
      return {
        ok: false,
        error: `fetch fallback HTTP ${status}`,
        url,
        fallback: "fetch",
        label: "fetch fallback",
        provenance: provenance(url, { via: "fetch-fallback", rendered: false, label: "fetch fallback", error: `HTTP ${status}` }),
      };
    }
    const { html, truncated, bytes } = await readBodyCapped(res, maxBytes);
    const { title, text } = extractReadableText(html);
    return {
      ok: true,
      html,
      text,
      title,
      url,
      truncated,
      fallback: "fetch",
      label: "fetch fallback",
      provenance: provenance(url, {
        via: "fetch-fallback",
        rendered: false,
        label: "fetch fallback",
        contentLength: bytes,
        truncated,
      }),
    };
  } catch (err) {
    const aborted = err?.name === "AbortError" || ctrl.signal.aborted;
    const message = aborted
      ? `fetch fallback timeout after ${timeoutMs}ms`
      : `fetch fallback failed: ${err?.message || err}`;
    return {
      ok: false,
      error: message,
      url,
      fallback: "fetch",
      label: "fetch fallback",
      provenance: provenance(url, { via: "fetch-fallback", rendered: false, label: "fetch fallback", error: message }),
    };
  } finally {
    clearTimeout(timer);
  }
}

export default BrowserEngine;
