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

// ── Constants ────────────────────────────────────────────────────────────────

const ENGINE_VERSION = "1.0.0";
const DEFAULT_TIMEOUT = 30_000;
const DEFAULT_VIEWPORT = { width: 1280, height: 720 };
const MAX_SCROLL_ITERATIONS = 50;
const SCROLL_PAUSE_MS = 1500;
const MAX_PAGE_CONTENT_BYTES = 10 * 1024 * 1024; // 10 MB safety cap
const USER_AGENT =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 ConcordOS/2.0";

// ── Singleton State ──────────────────────────────────────────────────────────

/** @type {import('playwright').Browser | null} */
let _browser = null;

/** @type {Promise<import('playwright').Browser> | null} */
let _browserLaunchPromise = null;

/** @type {boolean} */
let _cleanupRegistered = false;

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

export default BrowserEngine;
