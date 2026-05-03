// server/lib/tools/computer-use-tool.js
// Computer Use brokered tool — gives the agent loop the ability to take screenshots,
// click, type, scroll, and navigate in a sandboxed browser environment.
//
// Requires: COMPUTER_USE_ENABLED=true + a sandbox (Phase 11).
// Constitutional gate: before_tool hook blocks use without explicit session opt-in.

import { register } from "../agentic/hooks.js";

const ENABLED = process.env.COMPUTER_USE_ENABLED === "true";

/**
 * Tool definition injected into the agent loop.
 * Format matches @concord/inference tool schema.
 */
export const COMPUTER_USE_TOOL_SCHEMA = {
  name: "computer_use",
  description: "Control a sandboxed browser or desktop environment. Take screenshots, click elements, type text, navigate URLs, and extract page content. Requires user consent.",
  inputSchema: {
    type: "object",
    required: ["action"],
    properties: {
      action: {
        type: "string",
        enum: ["screenshot", "click", "type", "scroll", "navigate", "extract_text", "fill_form"],
        description: "The action to perform",
      },
      selector: {
        type: "string",
        description: "CSS selector or text content for click/type/extract actions",
      },
      text: {
        type: "string",
        description: "Text to type (for type/fill_form actions)",
      },
      url: {
        type: "string",
        description: "URL to navigate to",
      },
      scrollDirection: {
        type: "string",
        enum: ["up", "down", "left", "right"],
        description: "Direction to scroll",
      },
      scrollAmount: {
        type: "number",
        description: "Pixels to scroll (default: 300)",
      },
      sandboxId: {
        type: "string",
        description: "Sandbox workspace ID (from Phase 11). Uses default if not specified.",
      },
    },
  },
};

// Register constitutional gate — blocks computer_use without session opt-in
let _hookRegistered = false;
export function registerComputerUseGate() {
  if (_hookRegistered) return;
  _hookRegistered = true;

  register("before_tool", async (context) => {
    if (context.toolName !== "computer_use") return;

    // Check session flag
    if (!context.state?.__chicken3?.computerUseEnabled) {
      return {
        abort: true,
        reason: "computer_use_requires_opt_in: user must enable Computer Use in session settings",
      };
    }

    // Block surveillance-intent actions
    const actionText = `${context.args?.action || ""} ${context.args?.url || ""} ${context.args?.selector || ""}`.toLowerCase();
    const blockedTerms = ["keylog", "monitor", "track", "spy", "surveillance", "credential"];
    for (const term of blockedTerms) {
      if (actionText.includes(term)) {
        return {
          abort: true,
          reason: `computer_use_blocked: action contains prohibited term "${term}"`,
        };
      }
    }
  }, { priority: 5, name: "computer-use-constitutional-gate" });
}

/**
 * Execute a computer use action.
 * Routes to Playwright-backed implementation when available, otherwise returns stub.
 *
 * @param {object} call - ToolCall from agent loop: { name, args }
 * @param {object} opts
 * @param {object} [opts.sandboxManager] - sandbox manager from Phase 11
 * @param {string} [opts.userId]
 * @returns {Promise<string>} JSON string result (agent loop expects string)
 */
export async function executeComputerUse(call, opts = {}) {
  if (!ENABLED) {
    return JSON.stringify({ ok: false, error: "COMPUTER_USE_ENABLED is not set to true" });
  }

  const { action, selector, text, url, scrollDirection, scrollAmount = 300, sandboxId } = call.args || {};

  // Get or create browser context
  let page = null;
  try {
    const playwright = await import("playwright").catch(() => null);
    if (!playwright) {
      return JSON.stringify({ ok: false, error: "playwright_not_installed: run npm install playwright in server/" });
    }

    // In full impl, get browser from sandbox manager.
    // For now: launch ephemeral browser for action.
    const browser = await playwright.chromium.launch({ headless: true });
    const context = await browser.newContext();
    page = await context.newPage();

    let result;
    switch (action) {
      case "navigate":
        if (!url) return JSON.stringify({ ok: false, error: "url_required" });
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        result = { ok: true, currentUrl: page.url(), title: await page.title() };
        break;

      case "screenshot": {
        if (url) await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
        const screenshotBuffer = await page.screenshot({ type: "png" });
        result = { ok: true, screenshotBase64: screenshotBuffer.toString("base64"), currentUrl: page.url() };
        break;
      }

      case "click":
        if (!selector) return JSON.stringify({ ok: false, error: "selector_required" });
        await page.click(selector, { timeout: 5000 });
        result = { ok: true, clicked: selector };
        break;

      case "type":
        if (!selector || !text) return JSON.stringify({ ok: false, error: "selector_and_text_required" });
        await page.fill(selector, text, { timeout: 5000 });
        result = { ok: true, typed: text.length + " chars into " + selector };
        break;

      case "scroll":
        await page.evaluate(({ dir, amt }) => {
          const x = dir === "left" ? -amt : dir === "right" ? amt : 0;
          const y = dir === "up" ? -amt : dir === "down" ? amt : 0;
          // eslint-disable-next-line no-undef -- runs inside Playwright page context
          window.scrollBy(x, y);
        }, { dir: scrollDirection || "down", amt: scrollAmount });
        result = { ok: true, scrolled: `${scrollDirection} ${scrollAmount}px` };
        break;

      case "extract_text": {
        const el = selector ? await page.$(selector) : null;
        const extractedText = el
          ? await el.textContent()
          // eslint-disable-next-line no-undef -- runs inside Playwright page context
          : await page.evaluate(() => document.body.innerText?.slice(0, 5000));
        result = { ok: true, text: extractedText?.trim() || "" };
        break;
      }

      case "fill_form": {
        // Expects selector to be a form selector and text to be JSON of {fieldName: value}
        if (!text) return JSON.stringify({ ok: false, error: "text_required_as_json_form_data" });
        const formData = JSON.parse(text);
        for (const [field, value] of Object.entries(formData)) {
          await page.fill(`[name="${field}"], #${field}`, String(value)).catch(() => {});
        }
        result = { ok: true, filledFields: Object.keys(formData).length };
        break;
      }

      default:
        result = { ok: false, error: `unknown_action: ${action}` };
    }

    await browser.close();
    return JSON.stringify(result);
  } catch (err) {
    if (page) {
      try { await page?.context()?.browser()?.close(); } catch { /* ignore */ }
    }
    return JSON.stringify({ ok: false, error: err?.message || "computer_use_error" });
  }
}

// Auto-register constitutional gate when module loads
registerComputerUseGate();
