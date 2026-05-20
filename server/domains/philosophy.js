// server/domains/philosophy.js
export default function registerPhilosophyActions(registerLensAction) {
  registerLensAction("philosophy", "argumentMap", (ctx, artifact, _params) => { const premises = artifact.data?.premises || []; const conclusion = artifact.data?.conclusion || ""; if (premises.length === 0) return { ok: true, result: { message: "Add premises and conclusion to map argument." } }; const valid = premises.length >= 2 && conclusion; const soundness = valid ? (premises.every(p => p.supported !== false) ? "sound" : "valid-but-unsound") : "invalid"; return { ok: true, result: { premises: premises.map((p,i) => ({ number: i+1, text: typeof p === "string" ? p : p.text, supported: p.supported !== false })), conclusion, premiseCount: premises.length, validity: valid ? "valid" : "invalid", soundness, form: premises.length === 2 ? "syllogism" : "complex-argument" } }; });
  registerLensAction("philosophy", "thoughtExperiment", (ctx, artifact, _params) => { const data = artifact.data || {}; const scenario = data.scenario || ""; const variables = data.variables || []; return { ok: true, result: { scenario: scenario.slice(0,300), variables: variables.map(v => ({ name: v.name || v, values: v.values || ["A","B"] })), permutations: Math.pow(2, variables.length), methodNote: "Consider each permutation — does your intuition change?", frameworks: ["Consequentialism: What outcome is best?", "Deontology: What rule applies?", "Virtue Ethics: What would a virtuous person do?"] } }; });
  registerLensAction("philosophy", "dialecticSynthesis", (ctx, artifact, _params) => { const thesis = artifact.data?.thesis || ""; const antithesis = artifact.data?.antithesis || ""; if (!thesis || !antithesis) return { ok: true, result: { message: "Provide thesis and antithesis for dialectic synthesis." } }; return { ok: true, result: { thesis, antithesis, method: "Hegelian dialectic", steps: ["Identify the core truth in the thesis", "Identify the core truth in the antithesis", "Find where they genuinely conflict", "Synthesize: what position preserves both truths?"], synthesis: "Requires human reasoning — the framework guides but cannot replace philosophical judgment" } }; });
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
  const BLOCK_KINDS = ["text", "link", "quote"];

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
    const blocks = phBlocks(s, userId);
    const channels = phChannels(s, userId).map((c) => ({
      ...c, blockCount: blocks.filter((b) => b.channelIds.includes(c.id)).length,
    }));
    return { ok: true, result: { channels, count: channels.length } };
  });

  registerLensAction("philosophy", "channel-detail", (ctx, _a, params = {}) => {
    const s = getPhiloState(); if (!s) return { ok: false, error: "STATE unavailable" };
    const userId = phActor(ctx);
    const channel = phChannels(s, userId).find((c) => c.id === params.id);
    if (!channel) return { ok: false, error: "channel not found" };
    const blocks = phBlocks(s, userId)
      .filter((b) => b.channelIds.includes(channel.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, result: { channel, blocks } };
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
    const channel = phChannels(s, userId).find((c) => c.id === params.channelId);
    if (!channel) return { ok: false, error: "channel not found" };
    const content = phClean(params.content, 8000);
    if (!content) return { ok: false, error: "block content required" };
    const kind = BLOCK_KINDS.includes(params.kind) ? params.kind : "text";
    const block = {
      id: phId("bk"), kind, content,
      source: phClean(params.source, 300) || null,
      channelIds: [channel.id],
      createdAt: phNow(),
    };
    phBlocks(s, userId).push(block);
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
    const arr = phBlocks(s, userId);
    const i = arr.findIndex((b) => b.id === params.id);
    if (i < 0) return { ok: false, error: "block not found" };
    arr.splice(i, 1);
    savePhilo();
    return { ok: true, result: { deleted: params.id } };
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
        },
      },
    };
  });
}
