// INC-31: Expert Mode retrieved the right Wikipedia pages, then answered
// from the ~160-character search blurb (or from nothing — web rows were
// attached after the brain call). The lead extract, which actually
// contains the height / the capital, never reached the prompt.
// Egress is mocked. These tests must not fetch the network.

import { describe, it, before, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import Database from "better-sqlite3";

import registerExpertModeMacros from "../domains/expert-mode.js";
import { up as upMig170 } from "../migrations/170_byo_brain_overrides.js";

const ACTIONS = new Map();
function register(domain, name, fn) {
  ACTIONS.set(`${domain}.${name}`, fn);
}
function call(name, ctx, input = {}) {
  const fn = ACTIONS.get(`expert_mode.${name}`);
  if (!fn) throw new Error(`expert_mode.${name} not registered`);
  return fn(ctx, input);
}

function setupDb() {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE dtus (
      id TEXT PRIMARY KEY,
      title TEXT,
      content TEXT,
      creator_id TEXT,
      scope TEXT NOT NULL DEFAULT 'personal',
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  upMig170(db);
  db.prepare(
    `INSERT INTO dtus (id, title, content, creator_id, scope) VALUES (?, ?, ?, ?, ?)`,
  ).run(
    "dtu_steel",
    "Refractory steel melt cycle calibration",
    "Refractory steel melt cycle calibration tables and analysis.",
    "claudia",
    "public",
  );
  return db;
}

const ctxA = (db) => ({ db, actor: { userId: "user_a" }, userId: "user_a" });

const EIFFEL_SNIPPET = "The Eiffel Tower is a lattice tower on the Champ de Mars in Paris, France. It is named after the engineer Gustave Eiffel.";
const EIFFEL_EXTRACT = `${EIFFEL_SNIPPET} The tower is 330 metres (1,083 ft) tall, about the same height as an 81-storey building, and the tallest structure in Paris.`;
const GUSTAVE_SNIPPET = "Alexandre Gustave Eiffel is best known for the Eiffel Tower, designed by his company.";
const GUSTAVE_EXTRACT = "Alexandre Gustave Eiffel was a French civil engineer and architect.";
const BAIN_TEXT = "A bain-marie heats food with the boiling point of water at sea level in a bath. It is a water bath used in cooking.";

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    json: async () => body,
    text: async () => (typeof body === "string" ? body : JSON.stringify(body)),
  };
}

/**
 * Mock DuckDuckGo, Wikipedia, robots.txt, and the brain.
 * `brainText` is what /api/chat returns. Pass null to record that the
 * brain must not be called.
 */
function installFetch({ search = [], extracts = {}, brainText = null }) {
  const urls = [];
  let prompt = "";
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    urls.push(u);
    if (u.includes("/api/chat")) {
      if (brainText == null) throw new Error("brain should not have been called");
      const body = JSON.parse(init?.body || "{}");
      prompt = (body.messages || []).map((m) => m.content || "").join("\n\n");
      return jsonResponse({
        message: { content: brainText },
        prompt_eval_count: 10,
        eval_count: 8,
      });
    }
    if (u.includes("api.duckduckgo.com")) {
      return jsonResponse({ AbstractText: "", Answer: "", Heading: "" });
    }
    if (u.includes("/robots.txt")) {
      return { ok: true, status: 200, text: async () => "User-agent: *\nAllow: /\n", json: async () => ({}) };
    }
    if (u.includes("list=search")) {
      return jsonResponse({ query: { search } });
    }
    if (u.includes("prop=extracts")) {
      const title = decodeURIComponent(u.split("titles=")[1]?.split("&")[0] || "");
      const extract = extracts[title];
      if (!extract) return jsonResponse({ query: { pages: {} } });
      return jsonResponse({ query: { pages: { 1: { extract } } } });
    }
    return { ok: false, status: 503, json: async () => ({}), text: async () => "" };
  };
  return {
    urls,
    prompt: () => prompt,
  };
}

before(() => {
  registerExpertModeMacros(register);
});

beforeEach(() => {
  globalThis.fetch = async () => {
    throw new Error("network disabled in tests");
  };
  if (globalThis._concordSTATE) delete globalThis._concordSTATE.expertModeLens;
});

afterEach(() => {
  delete globalThis.fetch;
});

const PARIS_SNIPPET = "This is a chronological list of capitals of France.";
const PARIS_EXTRACT = "The capital of France has been Paris since its liberation in 1944. Paris is the capital and largest city of France.";

describe("expert_mode ask grounds the answer in the page extract", () => {
  it("puts the Eiffel Tower height into the answer prompt and cites that source", async () => {
    const net = installFetch({
      search: [
        { title: "Eiffel Tower", snippet: EIFFEL_SNIPPET },
        { title: "Gustave Eiffel", snippet: GUSTAVE_SNIPPET },
      ],
      extracts: {
        "Eiffel Tower": EIFFEL_EXTRACT,
        "Gustave Eiffel": GUSTAVE_EXTRACT,
      },
      brainText: "The Eiffel Tower is 330 metres (1,083 ft) tall [1].",
    });

    const r = await call("ask", ctxA(setupDb()), {
      query: "How tall is the Eiffel Tower?",
      focus: "web",
      useWeb: true,
      maxSources: 4,
    });

    assert.equal(r.ok, true, JSON.stringify(r));
    const prompt = net.prompt();
    assert.ok(prompt.includes("330 metres (1,083 ft)"), "lead extract reached the brain");
    assert.match(prompt, /\[1\] Eiffel Tower/);
    // The search blurb alone does not contain the height. The prompt must.
    assert.ok(!EIFFEL_SNIPPET.includes("330"));
    assert.match(r.turn.answer, /330 metres/);
    assert.match(r.turn.answer, /\[1\]/);
    const eiffel = r.turn.sources.find((s) => s.title === "Eiffel Tower");
    assert.ok(eiffel, "Eiffel Tower is a returned source");
    assert.equal(eiffel.origin, "web");
    assert.ok(!String(eiffel.snippet || "").includes("330"), "the card snippet stays the short search blurb");
    assert.ok(r.turn.sources.every((s) => s.title !== "Capital punishment"));
  });

  it("puts the capital of France into the answer prompt from the page extract", async () => {
    const net = installFetch({
      search: [
        { title: "List of capitals of France", snippet: PARIS_SNIPPET },
        { title: "Paris", snippet: "Paris is the capital and largest city of France." },
      ],
      extracts: {
        "List of capitals of France": PARIS_EXTRACT,
        Paris: "Paris is the capital and largest city of France.",
      },
      brainText: "Paris is the capital of France [1].",
    });

    const r = await call("ask", ctxA(setupDb()), {
      query: "What is the capital of France? Answer in one sentence.",
      focus: "web",
      useWeb: true,
      maxSources: 4,
    });

    assert.equal(r.ok, true, JSON.stringify(r));
    const prompt = net.prompt();
    assert.ok(prompt.includes("The capital of France has been Paris since its liberation in 1944."));
    assert.ok(!PARIS_SNIPPET.includes("Paris"), "the list snippet does not name Paris; the extract does");
    assert.match(r.turn.answer, /Paris is the capital of France \[1\]/);
    assert.ok(!/do not (address|contain)/i.test(r.turn.answer));
    const titles = r.turn.sources.map((s) => s.title);
    assert.ok(titles.includes("List of capitals of France"));
    assert.ok(titles.includes("Paris"));
    assert.ok(titles.every((t) => !/capital punishment/i.test(t)));
  });

  it("does not follow a refusal with an uncited fact the sources never stated", async () => {
    const net = installFetch({
      search: [
        { title: "Bain-marie", snippet: BAIN_TEXT },
      ],
      extracts: { "Bain-marie": BAIN_TEXT },
      brainText: "The sources do not address the boiling point of water. The boiling point of water at sea level is 100 °C.",
    });

    const r = await call("ask", ctxA(setupDb()), {
      query: "What is the boiling point of water at sea level?",
      focus: "web",
      useWeb: true,
      maxSources: 4,
    });

    assert.equal(r.ok, true, JSON.stringify(r));
    const prompt = net.prompt();
    assert.ok(prompt.includes("bain-marie") || prompt.includes("Bain-marie"));
    assert.ok(prompt.includes("water bath"));
    assert.ok(!prompt.includes("100 °C"), "the prompt must not invent a temperature the page did not contain");
    assert.match(r.turn.answer, /do not address/i);
    assert.ok(!r.turn.answer.includes("100"), JSON.stringify(r.turn.answer));
    assert.ok(!/°C/.test(r.turn.answer));
    assert.deepEqual(r.turn.sources.map((s) => s.title), ["Bain-marie"]);
  });

  it("says the sources do not address the question when retrieval returns nothing, and does not call the brain", async () => {
    const net = installFetch({
      search: [],
      brainText: null,
    });

    const r = await call("ask", ctxA(setupDb()), {
      query: "How tall is the Eiffel Tower?",
      focus: "web",
      useWeb: true,
      maxSources: 4,
    });

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(
      r.turn.answer,
      "The sources do not address this question. No factual claim can be made from the retrieved sources.",
    );
    assert.equal(r.turn.sources.length, 0);
    assert.ok(!/Paris|330|Eiffel/.test(r.turn.answer));
    assert.ok(!net.urls.some((u) => u.includes("/api/chat")));
  });
});

const EXAMPLE_HTML = `<!doctype html><html><head><title>Example Domain</title></head>
<body><h1>Example Domain</h1>
<p>This domain is for use in illustrative examples in documents.</p>
</body></html>`;

/**
 * Mock fetch for a URL-in-question grounding path (robots + page + brain).
 * When pageHtml is null the page fetch fails (503 / empty).
 */
function installUrlFetch({ pageHtml, brainText = null, wikiSearch = [] }) {
  const urls = [];
  let prompt = "";
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    urls.push(u);
    if (u.includes("/api/chat")) {
      if (brainText == null) throw new Error("brain should not have been called");
      const body = JSON.parse(init?.body || "{}");
      prompt = (body.messages || []).map((m) => m.content || "").join("\n\n");
      return jsonResponse({
        message: { content: brainText },
        prompt_eval_count: 10,
        eval_count: 8,
      });
    }
    if (u.includes("/robots.txt")) {
      return { ok: true, status: 200, text: async () => "User-agent: *\nAllow: /\n", json: async () => ({}) };
    }
    if (u.includes("example.com") && !u.includes("robots")) {
      if (pageHtml == null) {
        return { ok: false, status: 503, text: async () => "", json: async () => ({}) };
      }
      return {
        ok: true,
        status: 200,
        text: async () => pageHtml,
        json: async () => ({}),
      };
    }
    if (u.includes("api.duckduckgo.com")) {
      return jsonResponse({ AbstractText: "", Answer: "", Heading: "" });
    }
    if (u.includes("list=search")) {
      return jsonResponse({ query: { search: wikiSearch } });
    }
    if (u.includes("prop=extracts")) {
      return jsonResponse({ query: { pages: {} } });
    }
    return { ok: false, status: 503, json: async () => ({}), text: async () => "" };
  };
  return { urls, prompt: () => prompt };
}

describe("expert_mode URL question grounds on the fetched page (F1)", () => {
  it("puts example.com extract in the source list and cites it in the answer", async () => {
    const net = installUrlFetch({
      pageHtml: EXAMPLE_HTML,
      brainText: 'The heading is "Example Domain" [1].',
      // Unrelated wiki hits must NOT be attached when a URL was named.
      wikiSearch: [
        { title: "List of films with post-credits scenes (2020s)", snippet: 'season 2 episode &quot;1893&quot;' },
        { title: "List of Google Easter eggs", snippet: "bruno&quot; referencing Encanto" },
      ],
    });

    const r = await call("ask", ctxA(setupDb()), {
      query: "In one short sentence, what heading does https://example.com show? Quote the heading.",
      focus: "all",
      useWeb: true,
      maxSources: 4,
    });

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.turn.webCount, 1);
    const web = r.turn.sources.filter((s) => s.origin === "web" || s.scope === "web");
    assert.equal(web.length, 1, JSON.stringify(r.turn.sources));
    assert.match(web[0].url, /example\.com/);
    assert.match(web[0].title, /Example Domain/i);
    assert.ok(!/&quot;|&#039;/.test(web[0].snippet || ""));
    assert.match(net.prompt(), /Example Domain/);
    assert.match(r.turn.answer, /Example Domain/);
    assert.match(r.turn.answer, /\[1\]/);
    assert.ok(!r.turn.sources.some((s) => /films with post-credits|Google Easter eggs/i.test(s.title)));
    assert.ok(net.urls.some((u) => u.includes("example.com")));
  });

  it("returns an honest no-source answer when the URL fetch fails (no filler wiki)", async () => {
    const net = installUrlFetch({
      pageHtml: null,
      brainText: null,
      wikiSearch: [
        { title: "List of films with post-credits scenes (2020s)", snippet: 'episode &quot;1893&quot;' },
      ],
    });

    const r = await call("ask", ctxA(setupDb()), {
      query: "What heading does https://example.com show?",
      focus: "all",
      useWeb: true,
      maxSources: 4,
    });

    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.turn.sources.length, 0);
    assert.equal(r.turn.webCount, 0);
    assert.match(r.turn.answer, /could not fetch/i);
    assert.ok(!/&quot;|films with post-credits/i.test(r.turn.answer));
    assert.ok(!net.urls.some((u) => u.includes("/api/chat")));
  });

  it("sources_preview and ask agree on the web source list for a URL question", async () => {
    installUrlFetch({
      pageHtml: EXAMPLE_HTML,
      brainText: 'The heading is "Example Domain" [1].',
    });

    const q = "What heading does https://example.com show?";
    const preview = await call("sources_preview", ctxA(setupDb()), {
      query: q,
      useWeb: true,
      focus: "all",
      maxSources: 4,
    });
    assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.equal(preview.urlAttempted, true);
    assert.equal(preview.urlFetched, 1);
    assert.equal(preview.webCount, 1);
    const previewWeb = preview.sources.filter((s) => s.origin === "web" || s.scope === "web");
    assert.equal(previewWeb.length, 1);
    assert.match(previewWeb[0].url, /example\.com/);

    const asked = await call("ask", ctxA(setupDb()), {
      query: q,
      useWeb: true,
      focus: "all",
      maxSources: 4,
    });
    assert.equal(asked.ok, true, JSON.stringify(asked));
    const askWeb = asked.turn.sources.filter((s) => s.origin === "web" || s.scope === "web");
    assert.equal(askWeb.length, 1);
    assert.equal(askWeb[0].url, previewWeb[0].url);
    assert.equal(askWeb[0].title, previewWeb[0].title);
    assert.equal(askWeb[0].id, previewWeb[0].id);
  });

  it("decodes HTML entities in Wikipedia search snippets", async () => {
    const net = installFetch({
      search: [
        {
          title: "List of Google Easter eggs",
          snippet: 'Shows &quot;Yup, he won.&quot; referencing &#039;I win&#039;',
        },
      ],
      extracts: {
        "List of Google Easter eggs": 'Shows "Yup, he won." referencing \'I win\'',
      },
      brainText: "Google has Easter eggs [1].",
    });

    const r = await call("ask", ctxA(setupDb()), {
      query: "List of Google Easter eggs",
      focus: "all",
      useWeb: true,
      maxSources: 4,
    });

    assert.equal(r.ok, true, JSON.stringify(r));
    const row = r.turn.sources.find((s) => s.title === "List of Google Easter eggs");
    assert.ok(row, JSON.stringify(r.turn.sources));
    assert.ok(!/&quot;|&#039;/.test(row.snippet || ""), row.snippet);
    assert.ok(row.snippet.includes('"') || row.snippet.includes("'"), row.snippet);
    assert.ok(net.prompt().includes("Yup, he won") || net.prompt().includes("Easter"));
  });
});
