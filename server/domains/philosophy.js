// server/domains/philosophy.js
import { cachedFetchJson } from "../lib/external-fetch.js";
import { lookupUserIdentity } from "../lib/user-identity.js";

import { advisory } from "../lib/lens-inputs.js";

export default function registerPhilosophyActions(registerLensAction) {
  registerLensAction("philosophy", "argumentMap", advisory("structural text helper; no logical validity proof", (ctx, artifact, _params) => { const premises = artifact.data?.premises || []; const conclusion = artifact.data?.conclusion || ""; if (premises.length === 0) return { ok: true, result: { message: "Add premises and conclusion to map argument." } }; const valid = premises.length >= 2 && conclusion; const soundness = valid ? (premises.every(p => p.supported !== false) ? "sound" : "valid-but-unsound") : "invalid"; return { ok: true, result: { premises: premises.map((p,i) => ({ number: i+1, text: typeof p === "string" ? p : p.text, supported: p.supported !== false })), conclusion, premiseCount: premises.length, validity: valid ? "valid" : "invalid", soundness, form: premises.length === 2 ? "syllogism" : "complex-argument" } }; }));
  registerLensAction("philosophy", "thoughtExperiment", advisory("structural text helper; no logical validity proof", (ctx, artifact, _params) => { const data = artifact.data || {}; const scenario = data.scenario || ""; const variables = data.variables || []; return { ok: true, result: { scenario: scenario.slice(0,300), variables: variables.map(v => ({ name: v.name || v, values: v.values || ["A","B"] })), permutations: Math.pow(2, variables.length), methodNote: "Consider each permutation — does your intuition change?", frameworks: ["Consequentialism: What outcome is best?", "Deontology: What rule applies?", "Virtue Ethics: What would a virtuous person do?"] } }; }));
  registerLensAction("philosophy", "dialecticSynthesis", advisory("structural text helper; no logical validity proof", (ctx, artifact, _params) => { const thesis = artifact.data?.thesis || ""; const antithesis = artifact.data?.antithesis || ""; if (!thesis || !antithesis) return { ok: true, result: { message: "Provide thesis and antithesis for dialectic synthesis." } }; return { ok: true, result: { thesis, antithesis, method: "Hegelian dialectic", steps: ["Identify the core truth in the thesis", "Identify the core truth in the antithesis", "Find where they genuinely conflict", "Synthesize: what position preserves both truths?"], synthesis: "Requires human reasoning — the framework guides but cannot replace philosophical judgment" } }; }));
  registerLensAction("philosophy", "ethicalFramework", (ctx, artifact, _params) => { const dilemma = artifact.data?.dilemma || ""; const frameworks = { utilitarian: "Choose the action producing greatest good for greatest number", deontological: "Act only according to rules you could will to be universal", virtue: "Act as a person of good character would act", care: "Prioritize relationships and responsiveness to others needs", rights: "Protect individual rights even at cost to majority", justice: "Ensure fair distribution of benefits and burdens" }; return { ok: true, result: { dilemma: dilemma.slice(0,200), frameworks: Object.entries(frameworks).map(([k,v]) => ({ framework: k, principle: v })), note: "Different frameworks may give different answers — that is the nature of ethics" } }; });

  // ─── Are.na-shape idea-curation substrate (per-user, STATE-backed) ───
  // Channels of blocks (text / link / quote); a block can be connected
  // to multiple channels.

  function getPhiloState() {
    const STATE = globalThis._concordSTATE;
    if (!STATE) return null;
    if (!STATE.philosophyLens) STATE.philosophyLens = {};
    const s = STATE.philosophyLens;
    if (!(s.channels instanceof Map)) s.channels = new Map(); // userId -> Array<channel>
    if (!(s.blocks instanceof Map)) s.blocks = new Map();     // userId -> Array<block>
    if (!(s.debates instanceof Map)) s.debates = new Map();   // userId -> Array<debateThread>
    if (!(s.references instanceof Map)) s.references = new Map(); // userId -> Array<refPage>
    return s;
  }
  function savePhilo() {
    if (typeof globalThis._concordSaveStateDebounced === "function") {
      try { globalThis._concordSaveStateDebounced(); } catch (_e) { /* best effort */ }
    }
  }
  const phId = (p) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const phNow = () => new Date().toISOString();
  const phActor = (ctx) => ctx?.actor?.userId || ctx?.userId || "anon";
  const phClean = (v, max = 4000) => String(v == null ? "" : v).trim().slice(0, max);
  const phChannels = (s, userId) => { if (!s.channels.has(userId)) s.channels.set(userId, []); return s.channels.get(userId); };
  const phBlocks = (s, userId) => { if (!s.blocks.has(userId)) s.blocks.set(userId, []); return s.blocks.get(userId); };
  const phDebates = (s, userId) => { if (!s.debates.has(userId)) s.debates.set(userId, []); return s.debates.get(userId); };
  const phReferences = (s, userId) => { if (!s.references.has(userId)) s.references.set(userId, []); return s.references.get(userId); };
  const BLOCK_KINDS = ["text", "link", "quote", "image", "embed"];

  // Resolve a channel the actor may read on the public/collab grid
  // (owner, public, or listed collaborator). block-grid, block-embed, and
  // collaborator-list use this. Private detail and block writes use
  // phResolveCurated — being public does not grant block-add, delete,
  // publish, or collaborator management.
  function phResolveChannel(s, userId, channelId) {
    const own = phChannels(s, userId).find((c) => c.id === channelId);
    if (own) return { channel: own, ownerId: userId, role: "owner" };
    for (const [ownerId, list] of s.channels.entries()) {
      const c = list.find((x) => x.id === channelId);
      if (c && (c.public === true || (Array.isArray(c.collaborators) && c.collaborators.includes(userId)))) {
        const role = Array.isArray(c.collaborators) && c.collaborators.includes(userId) ? "collaborator" : "public";
        return { channel: c, ownerId, role };
      }
    }
    return null;
  }

  // Owner, or a listed collaborator. Public-only viewers are not curators.
  function phResolveCurated(s, userId, channelId) {
    const own = phChannels(s, userId).find((c) => c.id === channelId);
    if (own) return { channel: own, ownerId: userId, role: "owner" };
    for (const [ownerId, list] of s.channels.entries()) {
      if (ownerId === userId) continue;
      const c = list.find((x) => x.id === channelId);
      if (c && Array.isArray(c.collaborators) && c.collaborators.includes(userId)) {
        return { channel: c, ownerId, role: "collaborator" };
      }
    }
    return null;
  }

  function phDb(ctx) {
    return ctx?.db || globalThis._concordSTATE?.db || null;
  }

  // lookupUserIdentity reads the users table. No username and no display
  // name means the id is not a row (or the table cannot be read).
  function phUserOnFile(ctx, userId) {
    const ident = lookupUserIdentity(phDb(ctx), userId);
    return Boolean(ident && (ident.username || ident.displayName));
  }

  // Display name or @handle. Never the raw user id — a stored name that
  // is the id is not a public label.
  function phPublicName(ctx, userId) {
    const ident = lookupUserIdentity(phDb(ctx), userId);
    const display = typeof ident?.displayName === "string" ? ident.displayName.trim() : "";
    const handle = typeof ident?.username === "string" ? ident.username.trim() : "";
    if (display && display !== userId) return display;
    if (handle && handle !== userId) return handle;
    return null;
  }

  registerLensAction("philosophy", "channel-create", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const title = phClean(params.title, 160);
    if (!title) return { ok: false, error: "channel title required" };
    const channel = {
      id: phId("ch"), title,
      description: phClean(params.description, 600),
      createdAt: phNow(),
    };
    phChannels(s, phActor(ctx)).push(channel);
    savePhilo();
    return { ok: true, result: { channel } };
  });

  registerLensAction("philosophy", "channel-list", (ctx, _a, _params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const describe = (c, ownerId, role) => ({
      ...c,
      role,
      blockCount: phBlocks(s, ownerId).filter((b) => b.channelIds.includes(c.id)).length,
    });
    const channels = phChannels(s, userId).map((c) => describe(c, userId, "owner"));
    for (const [ownerId, list] of s.channels.entries()) {
      if (ownerId === userId) continue;
      for (const c of list) {
        if (Array.isArray(c.collaborators) && c.collaborators.includes(userId)) {
          channels.push(describe(c, ownerId, "collaborator"));
        }
      }
    }
    return { ok: true, result: { channels, count: channels.length } };
  });

  registerLensAction("philosophy", "channel-detail", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const resolved = phResolveCurated(s, userId, params.id);
    if (!resolved) return { ok: false, error: "channel not found" };
    const blocks = phBlocks(s, resolved.ownerId)
      .filter((b) => b.channelIds.includes(resolved.channel.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((b) => {
        // author stays on the stored block so delete can tell whose it is.
        // The payload only carries canDelete — not another user's raw id.
        const { author, ...rest } = b;
        return { ...rest, canDelete: resolved.ownerId === userId || author === userId };
      });
    return { ok: true, result: { channel: { ...resolved.channel, role: resolved.role }, blocks } };
  });

  registerLensAction("philosophy", "channel-delete", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const arr = phChannels(s, userId);
    const i = arr.findIndex((c) => c.id === params.id);
    if (i < 0) return { ok: false, error: "channel not found" };
    arr.splice(i, 1);
    const blocks = phBlocks(s, userId);
    for (const b of blocks) b.channelIds = b.channelIds.filter((cid) => cid !== params.id);
    s.blocks.set(userId, blocks.filter((b) => b.channelIds.length > 0));
    savePhilo();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("philosophy", "block-add", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const resolved = phResolveCurated(s, userId, params.channelId);
    if (!resolved) return { ok: false, error: "channel not found" };
    const content = phClean(params.content, 8000);
    if (!content) return { ok: false, error: "block content required" };
    const kind = BLOCK_KINDS.includes(params.kind) ? params.kind : "text";
    const block = {
      id: phId("bk"), kind, content,
      source: phClean(params.source, 300) || null,
      imageUrl: phClean(params.imageUrl, 1000) || null,
      embed: params.embed && typeof params.embed === "object" ? params.embed : null,
      channelIds: [resolved.channel.id],
      author: userId,
      createdAt: phNow(),
    };
    phBlocks(s, resolved.ownerId).push(block);
    savePhilo();
    return { ok: true, result: { block } };
  });

  registerLensAction("philosophy", "block-connect", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const block = phBlocks(s, userId).find((b) => b.id === params.blockId);
    if (!block) return { ok: false, error: "block not found" };
    const channel = phChannels(s, userId).find((c) => c.id === params.channelId);
    if (!channel) return { ok: false, error: "channel not found" };
    if (params.disconnect === true) {
      block.channelIds = block.channelIds.filter((cid) => cid !== channel.id);
      if (block.channelIds.length === 0) {
        s.blocks.set(userId, phBlocks(s, userId).filter((b) => b.id !== block.id));
      }
    } else if (!block.channelIds.includes(channel.id)) {
      block.channelIds.push(channel.id);
    }
    savePhilo();
    return { ok: true, result: { blockId: block.id, channelIds: block.channelIds } };
  });

  registerLensAction("philosophy", "block-delete", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    // Owner store: the channel owner can delete any block kept on their channels,
    // including ones a collaborator added (those are stored under the owner).
    const own = phBlocks(s, userId);
    const i = own.findIndex((b) => b.id === params.id);
    if (i >= 0) {
      own.splice(i, 1);
      savePhilo();
      return { ok: true, result: { deleted: params.id } };
    }
    // Collaborator: may delete only a block they authored, on a channel they curate.
    for (const [ownerId, channels] of s.channels.entries()) {
      if (ownerId === userId) continue;
      const curatedIds = new Set(
        channels
          .filter((c) => Array.isArray(c.collaborators) && c.collaborators.includes(userId))
          .map((c) => c.id),
      );
      if (curatedIds.size === 0) continue;
      const blocks = phBlocks(s, ownerId);
      const j = blocks.findIndex((b) => b.id === params.id);
      if (j < 0) continue;
      const block = blocks[j];
      const onCurated = Array.isArray(block.channelIds) && block.channelIds.some((cid) => curatedIds.has(cid));
      if (!onCurated) continue;
      if (block.author !== userId) return { ok: false, error: "only the author can delete this block" };
      blocks.splice(j, 1);
      savePhilo();
      return { ok: true, result: { deleted: params.id } };
    }
    return { ok: false, error: "block not found" };
  });

  registerLensAction("philosophy", "philosophy-search", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = phClean(params.query, 100).toLowerCase();
    if (!q) return { ok: false, error: "query required" };
    const userId = phActor(ctx);
    const channels = phChannels(s, userId).filter((c) => c.title.toLowerCase().includes(q) || (c.description || "").toLowerCase().includes(q));
    const blocks = phBlocks(s, userId)
      .filter((b) => b.content.toLowerCase().includes(q))
      .map((b) => ({ id: b.id, kind: b.kind, excerpt: b.content.slice(0, 160), channelIds: b.channelIds }));
    return { ok: true, result: { channels, blocks, count: channels.length + blocks.length } };
  });

  registerLensAction("philosophy", "philosophy-dashboard", (ctx, _a, _params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const blocks = phBlocks(s, userId);
    return {
      ok: true,
      result: {
        channels: phChannels(s, userId).length,
        blocks: blocks.length,
        connectedBlocks: blocks.filter((b) => b.channelIds.length > 1).length,
        byKind: {
          text: blocks.filter((b) => b.kind === "text").length,
          link: blocks.filter((b) => b.kind === "link").length,
          quote: blocks.filter((b) => b.kind === "quote").length,
          image: blocks.filter((b) => b.kind === "image").length,
          embed: blocks.filter((b) => b.kind === "embed").length,
        },
      },
    };
  });

  // ─── Visual block grid with images ──────────────────────────────────
  // block-add already accepts kind="image" + imageUrl. This macro
  // returns ONLY the image blocks of a channel, masonry-ready.
  registerLensAction("philosophy", "block-grid", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const resolved = phResolveChannel(s, userId, params.channelId);
    if (!resolved) return { ok: false, error: "channel not found" };
    const blocks = phBlocks(s, resolved.ownerId)
      .filter((b) => b.channelIds.includes(resolved.channel.id))
      .map((b) => ({
        id: b.id, kind: b.kind, content: b.content,
        imageUrl: b.imageUrl || (b.embed && b.embed.thumbnail) || null,
        source: b.source, embed: b.embed || null,
        channelCount: b.channelIds.length, createdAt: b.createdAt,
        canDelete: resolved.ownerId === userId || b.author === userId,
      }))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { channelId: resolved.channel.id, blocks, count: blocks.length } };
  });

  // ─── Block embeds — rich link previews from Wikipedia REST API ──────
  registerLensAction("philosophy", "block-embed", async (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const resolved = phResolveChannel(s, userId, params.channelId);
    if (!resolved) return { ok: false, error: "channel not found" };
    const title = phClean(params.title, 200);
    if (!title) return { ok: false, error: "embed title required" };
    const lang = /^[a-z]{2,3}$/.test(String(params.lang || "")) ? params.lang : "en";
    try {
      const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
      const data = await cachedFetchJson(url, { ttlMs: 6 * 60 * 60 * 1000 });
      if (!data || !data.title) return { ok: false, error: "no Wikipedia entry found" };
      const embed = {
        provider: "wikipedia",
        title: data.title,
        extract: (data.extract || "").slice(0, 600),
        thumbnail: data.thumbnail && data.thumbnail.source ? data.thumbnail.source : null,
        url: data.content_urls && data.content_urls.desktop ? data.content_urls.desktop.page : null,
      };
      const block = {
        id: phId("bk"), kind: "embed",
        content: embed.title,
        source: embed.url, imageUrl: embed.thumbnail, embed,
        channelIds: [resolved.channel.id],
        author: userId,
        createdAt: phNow(),
      };
      phBlocks(s, resolved.ownerId).push(block);
      savePhilo();
      return { ok: true, result: { block } };
    } catch (e) {
      return { ok: false, error: `Wikipedia unreachable: ${String(e?.message || e)}` };
    }
  });

  // ─── Channel publish / public discovery ─────────────────────────────
  registerLensAction("philosophy", "channel-publish", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const channel = phChannels(s, userId).find((c) => c.id === params.id);
    if (!channel) return { ok: false, error: "channel not found" };
    channel.public = params.public === false ? false : true;
    channel.publishedAt = channel.public ? phNow() : null;
    savePhilo();
    return { ok: true, result: { id: channel.id, public: channel.public } };
  });

  registerLensAction("philosophy", "public-channels", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const q = phClean(params.query, 100).toLowerCase();
    const out = [];
    for (const [ownerId, list] of s.channels.entries()) {
      for (const c of list) {
        if (c.public !== true) continue;
        if (q && !c.title.toLowerCase().includes(q) && !(c.description || "").toLowerCase().includes(q)) continue;
        const blockCount = phBlocks(s, ownerId).filter((b) => b.channelIds.includes(c.id)).length;
        out.push({
          id: c.id, title: c.title, description: c.description || "",
          ownerId, blockCount,
          collaboratorCount: Array.isArray(c.collaborators) ? c.collaborators.length : 0,
          publishedAt: c.publishedAt || c.createdAt,
        });
      }
    }
    out.sort((a, b) => String(b.publishedAt).localeCompare(String(a.publishedAt)));
    return { ok: true, result: { channels: out, count: out.length } };
  });

  registerLensAction("philosophy", "public-channel-detail", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let found = null;
    for (const [ownerId, list] of s.channels.entries()) {
      const c = list.find((x) => x.id === params.id && x.public === true);
      if (c) { found = { channel: c, ownerId }; break; }
    }
    if (!found) return { ok: false, error: "public channel not found" };
    const blocks = phBlocks(s, found.ownerId)
      .filter((b) => b.channelIds.includes(found.channel.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { channel: found.channel, ownerId: found.ownerId, blocks } };
  });

  // ─── Channel collaborators ──────────────────────────────────────────
  registerLensAction("philosophy", "channel-collaborator-add", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const channel = phChannels(s, userId).find((c) => c.id === params.id);
    if (!channel) return { ok: false, error: "channel not found" };
    const who = phClean(params.userId, 100);
    if (!who) return { ok: false, error: "collaborator userId required" };
    if (who === userId) return { ok: false, error: "owner is already a curator" };
    if (!phUserOnFile(ctx, who)) return { ok: false, error: "user not found" };
    if (!Array.isArray(channel.collaborators)) channel.collaborators = [];
    if (!channel.collaborators.includes(who)) channel.collaborators.push(who);
    savePhilo();
    return { ok: true, result: { id: channel.id, collaborators: channel.collaborators } };
  });

  registerLensAction("philosophy", "channel-collaborator-remove", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const channel = phChannels(s, userId).find((c) => c.id === params.id);
    if (!channel) return { ok: false, error: "channel not found" };
    if (Array.isArray(channel.collaborators)) {
      channel.collaborators = channel.collaborators.filter((u) => u !== params.userId);
    }
    savePhilo();
    return { ok: true, result: { id: channel.id, collaborators: channel.collaborators || [] } };
  });

  registerLensAction("philosophy", "channel-collaborator-list", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const resolved = phResolveChannel(s, userId, params.id);
    if (!resolved) return { ok: false, error: "channel not found" };
    return {
      ok: true,
      result: {
        id: resolved.channel.id,
        ownerId: resolved.ownerId,
        collaborators: Array.isArray(resolved.channel.collaborators) ? resolved.channel.collaborators : [],
      },
    };
  });

  // ─── Concept / thinker reference pages (IEP-style encyclopedia) ──────
  registerLensAction("philosophy", "reference-page", async (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const topic = phClean(params.topic, 200);
    if (!topic) return { ok: false, error: "topic required" };
    const kind = ["concept", "thinker"].includes(params.kind) ? params.kind : "concept";
    const lang = /^[a-z]{2,3}$/.test(String(params.lang || "")) ? params.lang : "en";
    try {
      const sumUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
      const summary = await cachedFetchJson(sumUrl, { ttlMs: 6 * 60 * 60 * 1000 });
      if (!summary || !summary.title) return { ok: false, error: "no Wikipedia entry found" };
      let related = [];
      try {
        const relUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/related/${encodeURIComponent(topic)}`;
        const rel = await cachedFetchJson(relUrl, { ttlMs: 6 * 60 * 60 * 1000 });
        if (rel && Array.isArray(rel.pages)) {
          related = rel.pages.slice(0, 8).map((p) => ({
            title: p.title,
            extract: (p.extract || "").slice(0, 160),
            thumbnail: p.thumbnail && p.thumbnail.source ? p.thumbnail.source : null,
          }));
        }
      } catch (_relErr) { /* related is optional */ }
      const page = {
        id: phId("ref"), kind, topic,
        title: summary.title,
        description: summary.description || "",
        extract: (summary.extract || "").slice(0, 2000),
        thumbnail: summary.thumbnail && summary.thumbnail.source ? summary.thumbnail.source : null,
        url: summary.content_urls && summary.content_urls.desktop ? summary.content_urls.desktop.page : null,
        related,
        savedAt: phNow(),
      };
      if (params.save === true) {
        const arr = phReferences(s, phActor(ctx));
        const dup = arr.findIndex((r) => r.title === page.title && r.kind === kind);
        if (dup >= 0) arr.splice(dup, 1);
        arr.unshift(page);
        if (arr.length > 100) arr.length = 100;
        savePhilo();
      }
      return { ok: true, result: { page, saved: params.save === true } };
    } catch (e) {
      return { ok: false, error: `Wikipedia unreachable: ${String(e?.message || e)}` };
    }
  });

  registerLensAction("philosophy", "reference-list", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    let arr = phReferences(s, phActor(ctx));
    if (params.kind === "concept" || params.kind === "thinker") {
      arr = arr.filter((r) => r.kind === params.kind);
    }
    return { ok: true, result: { references: arr, count: arr.length } };
  });

  registerLensAction("philosophy", "reference-delete", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const arr = phReferences(s, phActor(ctx));
    const i = arr.findIndex((r) => r.id === params.id);
    if (i < 0) return { ok: false, error: "reference not found" };
    arr.splice(i, 1);
    savePhilo();
    return { ok: true, result: { deleted: params.id } };
  });

  // ─── Connections graph — channels + blocks as a network ─────────────
  registerLensAction("philosophy", "connections-graph", (ctx, _a, _params = {}) => {
  try {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const channels = phChannels(s, userId);
    const blocks = phBlocks(s, userId);
    const nodes = [];
    const edges = [];
    for (const c of channels) {
      nodes.push({ id: c.id, label: c.title, type: "channel", public: c.public === true });
    }
    for (const b of blocks) {
      const label = b.kind === "embed" || b.kind === "image"
        ? (b.content || b.kind)
        : b.content.slice(0, 48);
      nodes.push({ id: b.id, label, type: "block", kind: b.kind });
      for (const cid of b.channelIds) {
        edges.push({ from: cid, to: b.id });
      }
    }
    // Channel-to-channel links: shared blocks bridge two channels.
    const bridges = [];
    for (const b of blocks) {
      if (b.channelIds.length < 2) continue;
      for (let i = 0; i < b.channelIds.length; i++) {
        for (let j = i + 1; j < b.channelIds.length; j++) {
          bridges.push({ a: b.channelIds[i], b: b.channelIds[j], via: b.id });
        }
      }
    }
    return {
      ok: true,
      result: {
        nodes, edges, bridges,
        channelCount: channels.length,
        blockCount: blocks.length,
        crossConnectedBlocks: blocks.filter((b) => b.channelIds.length > 1).length,
      },
    };
    } catch (e) { return { ok: false, error: "handler_error", message: String(e?.message || e) }; }
});

  // ─── Argument debate threads ────────────────────────────────────────
  // Same visibility model as channels: private unless the owner sets
  // public === true (at create, or later via debate-publish). A stored
  // thread with no public flag is private. List/detail payloads never
  // include a raw user id — authorName is a display name or null, and
  // mine tells the caller whether the row is theirs ("you").

  function phDebatePostView(post, viewerId, ctx) {
    return {
      id: post.id,
      stance: post.stance,
      body: post.body,
      targetPremise: post.targetPremise || null,
      replyTo: post.replyTo || null,
      createdAt: post.createdAt,
      authorName: phPublicName(ctx, post.author),
      mine: post.author === viewerId,
    };
  }

  function phDebateView(thread, viewerId, ctx) {
    const posts = Array.isArray(thread.posts) ? thread.posts.map((p) => phDebatePostView(p, viewerId, ctx)) : [];
    return {
      id: thread.id,
      title: thread.title,
      claim: thread.claim,
      branch: thread.branch,
      status: thread.status,
      resolution: thread.resolution || null,
      public: thread.public === true,
      createdAt: thread.createdAt,
      postCount: posts.length,
      posts,
      authorName: phPublicName(ctx, thread.author),
      mine: thread.author === viewerId,
    };
  }

  function phDebateSummary(thread, viewerId, ctx) {
    return {
      id: thread.id,
      title: thread.title,
      claim: thread.claim,
      branch: thread.branch,
      status: thread.status,
      public: thread.public === true,
      postCount: Array.isArray(thread.posts) ? thread.posts.length : 0,
      createdAt: thread.createdAt,
      authorName: phPublicName(ctx, thread.author),
      mine: thread.author === viewerId,
    };
  }

  function phFindDebate(s, threadId) {
    if (!threadId) return null;
    for (const [ownerId, list] of s.debates.entries()) {
      const thread = list.find((x) => x.id === threadId);
      if (thread) return { thread, ownerId };
    }
    return null;
  }

  // Owner, or public. Missing public flag is private. Not-found (rather
  // than forbidden) matches channel-detail so a private id is indistinguishable
  // from an unknown one.
  function phCanReadDebate(found, viewerId) {
    if (!found) return false;
    if (found.ownerId === viewerId || found.thread.author === viewerId) return true;
    return found.thread.public === true;
  }

  registerLensAction("philosophy", "debate-create", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const title = phClean(params.title, 200);
    if (!title) return { ok: false, error: "debate title required" };
    const claim = phClean(params.claim, 2000);
    if (!claim) return { ok: false, error: "central claim required" };
    const thread = {
      id: phId("dbt"), title, claim,
      branch: phClean(params.branch, 60) || "other",
      author: userId,
      posts: [],
      status: "open",
      public: params.public === true,
      createdAt: phNow(),
    };
    phDebates(s, userId).unshift(thread);
    savePhilo();
    return { ok: true, result: { thread: phDebateView(thread, userId, ctx) } };
  });

  const DEBATE_STANCES = ["support", "object", "rebut", "clarify"];
  registerLensAction("philosophy", "debate-post", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const found = phFindDebate(s, params.threadId);
    if (!phCanReadDebate(found, userId)) return { ok: false, error: "debate thread not found" };
    const body = phClean(params.body, 4000);
    if (!body) return { ok: false, error: "post body required" };
    const stance = DEBATE_STANCES.includes(params.stance) ? params.stance : "clarify";
    const post = {
      id: phId("dp"), stance, body,
      targetPremise: phClean(params.targetPremise, 600) || null,
      author: userId,
      replyTo: phClean(params.replyTo, 60) || null,
      createdAt: phNow(),
    };
    found.thread.posts.push(post);
    savePhilo();
    return {
      ok: true,
      result: {
        threadId: found.thread.id,
        post: phDebatePostView(post, userId, ctx),
        postCount: found.thread.posts.length,
      },
    };
  });

  registerLensAction("philosophy", "debate-detail", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const found = phFindDebate(s, params.id);
    if (!phCanReadDebate(found, userId)) return { ok: false, error: "debate thread not found" };
    const tally = { support: 0, object: 0, rebut: 0, clarify: 0 };
    for (const p of found.thread.posts) { if (tally[p.stance] != null) tally[p.stance]++; }
    return { ok: true, result: { thread: phDebateView(found.thread, userId, ctx), tally } };
  });

  registerLensAction("philosophy", "debate-list", (ctx, _a, _params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const out = [];
    for (const [ownerId, list] of s.debates.entries()) {
      for (const t of list) {
        if (ownerId !== userId && t.author !== userId && t.public !== true) continue;
        out.push(phDebateSummary(t, userId, ctx));
      }
    }
    out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { threads: out, count: out.length } };
  });

  registerLensAction("philosophy", "debate-publish", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const thread = phDebates(s, userId).find((t) => t.id === params.id);
    if (!thread) return { ok: false, error: "debate thread not found" };
    thread.public = params.public === true;
    savePhilo();
    return { ok: true, result: { id: thread.id, public: thread.public === true } };
  });

  registerLensAction("philosophy", "debate-delete", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const arr = phDebates(s, userId);
    const i = arr.findIndex((t) => t.id === params.id);
    if (i < 0) return { ok: false, error: "debate thread not found" };
    arr.splice(i, 1);
    savePhilo();
    return { ok: true, result: { deleted: params.id } };
  });

  registerLensAction("philosophy", "debate-resolve", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const thread = phDebates(s, userId).find((t) => t.id === params.id);
    if (!thread) return { ok: false, error: "debate thread not found (must be author)" };
    thread.status = params.status === "open" ? "open" : "resolved";
    thread.resolution = phClean(params.resolution, 2000) || null;
    savePhilo();
    return { ok: true, result: { id: thread.id, status: thread.status } };
  });
}
