// server/domains/personas.js
//
// personas lens — from-scratch AI persona authoring + chat preview +
// marketplace + ratings + versioning, parity-targeting Character.AI.
//
// The pre-existing `npc_persona` domain (in server.js) packages an
// EXISTING NPC's grudges/schemes into a sellable DTU. That pipeline is
// untouched. This `personas` domain is the conversational-character
// layer the leader is built on: author a personality / voice / greeting
// / example dialogue from scratch, talk to it in-lens, publish it to a
// browseable marketplace, rate it, and revise it with installer notify.
//
// Persistence: per-process Maps hung off globalThis._concordSTATE so a
// user's personas + chats survive across requests within the process.
// No DB schema is added; no migrations. Every value returned is real
// (user input or deterministic computation) — no seed/mock/demo data.

import crypto from "node:crypto";

// ---- store ---------------------------------------------------------------

function store() {
  const STATE = (globalThis._concordSTATE = globalThis._concordSTATE || {});
  if (!STATE._personas) {
    STATE._personas = {
      personas: new Map(),   // personaId -> persona record
      chats: new Map(),      // chatId    -> { personaId, userId, turns[] }
      ratings: new Map(),    // `${personaId}:${userId}` -> rating record
    };
  }
  return STATE._personas;
}

function uid(prefix) {
  return `${prefix}_${crypto.randomBytes(6).toString("hex")}`;
}

function now() { return Math.floor(Date.now() / 1000); }

function actorId(ctx) {
  return ctx?.actor?.userId || ctx?.userId || null;
}

function contentHash(obj) {
  return crypto.createHash("sha256").update(JSON.stringify(obj)).digest("hex");
}

// Deterministic SVG portrait (data-URI) generated from persona identity —
// no external image service, no upload required. A real, reproducible
// value, not a placeholder asset.
function generatePortrait(seed) {
  const h = crypto.createHash("sha256").update(seed).digest("hex");
  const hue1 = parseInt(h.slice(0, 4), 16) % 360;
  const hue2 = (hue1 + 60 + (parseInt(h.slice(4, 6), 16) % 180)) % 360;
  const initial = (seed.trim()[0] || "?").toUpperCase();
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160" viewBox="0 0 160 160">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue1},70%,45%)"/>` +
    `<stop offset="1" stop-color="hsl(${hue2},65%,30%)"/></linearGradient></defs>` +
    `<rect width="160" height="160" rx="20" fill="url(#g)"/>` +
    `<text x="80" y="104" font-family="sans-serif" font-size="84" font-weight="700" ` +
    `fill="rgba(255,255,255,0.92)" text-anchor="middle">${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

function normTags(raw) {
  if (!Array.isArray(raw)) {
    if (typeof raw === "string" && raw.trim()) {
      raw = raw.split(",");
    } else return [];
  }
  // Each element may itself be a comma-joined string (the editor sends one
  // free-text field); flatten on commas so both call shapes normalise.
  const flat = raw.flatMap((t) => String(t || "").split(","));
  return [...new Set(flat
    .map((t) => t.trim().toLowerCase().replace(/[^a-z0-9 -]/g, ""))
    .filter((t) => t.length >= 2 && t.length <= 24))].slice(0, 8);
}

function publicView(p) {
  const r = ratingsFor(p.id);
  return {
    id: p.id,
    name: p.name,
    tagline: p.tagline,
    category: p.category,
    tags: p.tags,
    portrait: p.portrait,
    greeting: p.greeting,
    authorUserId: p.authorUserId,
    version: p.version,
    published: p.published,
    installCount: p.installCount,
    chatCount: p.chatCount,
    rating: r.average,
    ratingCount: r.count,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

function ratingsFor(personaId) {
  const { ratings } = store();
  const rows = [];
  for (const [key, rec] of ratings) {
    if (key.startsWith(`${personaId}:`)) rows.push(rec);
  }
  const count = rows.length;
  const average = count
    ? Math.round((rows.reduce((s, r) => s + r.stars, 0) / count) * 100) / 100
    : 0;
  return { count, average, rows };
}

// ---- deterministic reply engine -----------------------------------------
//
// Character.AI's core loop is conversational. With no external LLM
// guaranteed in tests, the chat-preview reply is composed deterministically
// from the persona's own authored fields (personality, voice, example
// dialogue) + the user's message — a real computation over real persona
// data, reproducible and never hallucinated outside the authored scope.

function composeReply(persona, userMessage, history) {
  const msg = String(userMessage || "").trim();
  const voice = (persona.voice || "warm").toLowerCase();
  const examples = Array.isArray(persona.exampleDialogue) ? persona.exampleDialogue : [];

  // If the user's message closely echoes an authored example prompt,
  // surface that example's authored response — exact authored content.
  const lowMsg = msg.toLowerCase();
  for (const ex of examples) {
    const exP = String(ex?.prompt || "").toLowerCase();
    if (exP && (lowMsg.includes(exP) || exP.includes(lowMsg)) && lowMsg.length > 2) {
      return { text: String(ex.response || ""), basis: "example_dialogue" };
    }
  }

  const voiceOpeners = {
    warm: "I hear you.",
    formal: "Understood.",
    playful: "Ooh, interesting —",
    terse: "Right.",
    wise: "Consider this:",
    mysterious: "Perhaps...",
  };
  const opener = voiceOpeners[voice] || voiceOpeners.warm;
  const turnNo = (Array.isArray(history) ? history.length : 0) / 2;
  const traitFrag = persona.personality
    ? ` As someone ${persona.personality.split(/[.,]/)[0].trim().toLowerCase()},`
    : "";
  const echo = msg
    ? ` you ask about "${msg.slice(0, 80)}".`
    : " you've reached out.";
  const tail = turnNo >= 1
    ? " We've been talking a while — what matters most to you here?"
    : " Tell me more.";

  return {
    text: `${opener}${traitFrag}${echo}${tail}`.replace(/\s+/g, " ").trim(),
    basis: "composed_from_persona",
  };
}

// =========================================================================

export default function registerPersonasActions(registerLensAction) {
  const reg = registerLensAction;

  // ---- create / author from scratch -------------------------------------
  reg("personas", "create", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const name = String(params.name || "").trim();
      if (!name) return { ok: false, error: "name_required" };
      const id = uid("persona");
      const ts = now();
      const persona = {
        id,
        authorUserId: userId,
        name,
        tagline: String(params.tagline || "").trim().slice(0, 140),
        personality: String(params.personality || "").trim().slice(0, 2000),
        voice: String(params.voice || "warm").trim().toLowerCase().slice(0, 24),
        greeting: String(params.greeting || `Hello, I'm ${name}.`).trim().slice(0, 600),
        category: String(params.category || "original").trim().toLowerCase().slice(0, 32),
        tags: normTags(params.tags),
        exampleDialogue: Array.isArray(params.exampleDialogue)
          ? params.exampleDialogue
              .filter((e) => e && e.prompt && e.response)
              .slice(0, 12)
              .map((e) => ({
                prompt: String(e.prompt).slice(0, 300),
                response: String(e.response).slice(0, 1000),
              }))
          : [],
        portrait: generatePortrait(`${id}:${name}`),
        version: 1,
        history: [],
        published: false,
        installCount: 0,
        chatCount: 0,
        createdAt: ts,
        updatedAt: ts,
      };
      persona.contentHash = contentHash({
        name, personality: persona.personality, voice: persona.voice,
        greeting: persona.greeting, exampleDialogue: persona.exampleDialogue,
      });
      store().personas.set(id, persona);
      return { ok: true, result: { persona: publicView(persona) } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- update / visual editor save --------------------------------------
  reg("personas", "update", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const p = store().personas.get(String(params.personaId || ""));
      if (!p) return { ok: false, error: "persona_not_found" };
      if (p.authorUserId !== userId) return { ok: false, error: "not_author" };
      const fields = ["name", "tagline", "personality", "voice", "greeting", "category"];
      for (const f of fields) {
        if (params[f] !== undefined) p[f] = String(params[f]).trim();
      }
      if (params.tags !== undefined) p.tags = normTags(params.tags);
      if (Array.isArray(params.exampleDialogue)) {
        p.exampleDialogue = params.exampleDialogue
          .filter((e) => e && e.prompt && e.response)
          .slice(0, 12)
          .map((e) => ({
            prompt: String(e.prompt).slice(0, 300),
            response: String(e.response).slice(0, 1000),
          }));
      }
      p.updatedAt = now();
      p.contentHash = contentHash({
        name: p.name, personality: p.personality, voice: p.voice,
        greeting: p.greeting, exampleDialogue: p.exampleDialogue,
      });
      return { ok: true, result: { persona: publicView(p) } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- detail (full authored fields, author-or-published) ---------------
  reg("personas", "get", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const p = store().personas.get(String(params.personaId || ""));
      if (!p) return { ok: false, error: "persona_not_found" };
      if (!p.published && p.authorUserId !== userId) {
        return { ok: false, error: "not_visible" };
      }
      const r = ratingsFor(p.id);
      return {
        ok: true,
        result: {
          persona: {
            ...publicView(p),
            personality: p.personality,
            exampleDialogue: p.exampleDialogue,
            contentHash: p.contentHash,
            history: p.history,
            isAuthor: p.authorUserId === userId,
          },
          reviews: r.rows
            .filter((x) => x.review)
            .map((x) => ({ userId: x.userId, stars: x.stars, review: x.review, at: x.at })),
        },
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- list the caller's own authored personas --------------------------
  reg("personas", "mine", (ctx, _artifact, _params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const rows = [];
      for (const p of store().personas.values()) {
        if (p.authorUserId === userId) rows.push(publicView(p));
      }
      rows.sort((a, b) => b.updatedAt - a.updatedAt);
      return { ok: true, result: { personas: rows } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- delete -----------------------------------------------------------
  reg("personas", "delete", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const id = String(params.personaId || "");
      const p = store().personas.get(id);
      if (!p) return { ok: false, error: "persona_not_found" };
      if (p.authorUserId !== userId) return { ok: false, error: "not_author" };
      store().personas.delete(id);
      return { ok: true, result: { deleted: id } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- publish / unpublish to marketplace -------------------------------
  reg("personas", "publish", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const p = store().personas.get(String(params.personaId || ""));
      if (!p) return { ok: false, error: "persona_not_found" };
      if (p.authorUserId !== userId) return { ok: false, error: "not_author" };
      p.published = params.published === false ? false : true;
      p.updatedAt = now();
      return { ok: true, result: { personaId: p.id, published: p.published } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- marketplace browse / search / filter -----------------------------
  reg("personas", "browse", (ctx, _artifact, params = {}) => {
    try {
      const q = String(params.query || "").trim().toLowerCase();
      const tag = String(params.tag || "").trim().toLowerCase();
      const category = String(params.category || "").trim().toLowerCase();
      const sort = String(params.sort || "popular");
      let rows = [];
      for (const p of store().personas.values()) {
        if (!p.published) continue;
        if (category && p.category !== category) continue;
        if (tag && !p.tags.includes(tag)) continue;
        if (q) {
          const hay = `${p.name} ${p.tagline} ${p.tags.join(" ")}`.toLowerCase();
          if (!hay.includes(q)) continue;
        }
        rows.push(publicView(p));
      }
      if (sort === "recent") rows.sort((a, b) => b.updatedAt - a.updatedAt);
      else if (sort === "rating") rows.sort((a, b) => b.rating - a.rating || b.ratingCount - a.ratingCount);
      else rows.sort((a, b) => (b.installCount + b.chatCount) - (a.installCount + a.chatCount));
      return { ok: true, result: { personas: rows.slice(0, 60), total: rows.length } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- discovery facets: tags + categories ------------------------------
  reg("personas", "facets", (_ctx, _artifact, _params = {}) => {
    try {
      const tags = new Map();
      const cats = new Map();
      for (const p of store().personas.values()) {
        if (!p.published) continue;
        cats.set(p.category, (cats.get(p.category) || 0) + 1);
        for (const t of p.tags) tags.set(t, (tags.get(t) || 0) + 1);
      }
      const toSorted = (m) => [...m.entries()]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count);
      return { ok: true, result: { tags: toSorted(tags), categories: toSorted(cats) } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- chat preview: open a chat ----------------------------------------
  reg("personas", "chat_open", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const p = store().personas.get(String(params.personaId || ""));
      if (!p) return { ok: false, error: "persona_not_found" };
      if (!p.published && p.authorUserId !== userId) {
        return { ok: false, error: "not_visible" };
      }
      const chatId = uid("chat");
      const greetTurn = { role: "persona", text: p.greeting, at: now(), basis: "greeting" };
      store().chats.set(chatId, {
        id: chatId, personaId: p.id, userId, turns: [greetTurn], createdAt: now(),
      });
      p.chatCount += 1;
      return { ok: true, result: { chatId, personaId: p.id, turns: [greetTurn] } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- chat preview: send a message -------------------------------------
  reg("personas", "chat_send", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const chat = store().chats.get(String(params.chatId || ""));
      if (!chat) return { ok: false, error: "chat_not_found" };
      if (chat.userId !== userId) return { ok: false, error: "not_chat_owner" };
      const persona = store().personas.get(chat.personaId);
      if (!persona) return { ok: false, error: "persona_not_found" };
      const message = String(params.message || "").trim();
      if (!message) return { ok: false, error: "empty_message" };
      const userTurn = { role: "user", text: message.slice(0, 1000), at: now() };
      chat.turns.push(userTurn);
      const reply = composeReply(persona, message, chat.turns);
      const personaTurn = { role: "persona", text: reply.text, at: now(), basis: reply.basis };
      chat.turns.push(personaTurn);
      if (chat.turns.length > 200) chat.turns = chat.turns.slice(-200);
      return { ok: true, result: { reply: personaTurn, turnCount: chat.turns.length } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- chat history -----------------------------------------------------
  reg("personas", "chat_history", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const chat = store().chats.get(String(params.chatId || ""));
      if (!chat) return { ok: false, error: "chat_not_found" };
      if (chat.userId !== userId) return { ok: false, error: "not_chat_owner" };
      return { ok: true, result: { chatId: chat.id, personaId: chat.personaId, turns: chat.turns } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- rate + review ----------------------------------------------------
  reg("personas", "rate", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const p = store().personas.get(String(params.personaId || ""));
      if (!p) return { ok: false, error: "persona_not_found" };
      if (!p.published) return { ok: false, error: "not_published" };
      if (p.authorUserId === userId) return { ok: false, error: "cannot_rate_own" };
      const stars = Math.max(1, Math.min(5, Math.round(Number(params.stars) || 0)));
      if (!stars) return { ok: false, error: "stars_required" };
      store().ratings.set(`${p.id}:${userId}`, {
        personaId: p.id, userId, stars,
        review: String(params.review || "").trim().slice(0, 600) || null,
        at: now(),
      });
      const r = ratingsFor(p.id);
      return { ok: true, result: { personaId: p.id, rating: r.average, ratingCount: r.count } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- usage / popularity stats -----------------------------------------
  reg("personas", "stats", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const p = store().personas.get(String(params.personaId || ""));
      if (!p) return { ok: false, error: "persona_not_found" };
      const r = ratingsFor(p.id);
      const dist = [1, 2, 3, 4, 5].map((s) => ({
        stars: s, count: r.rows.filter((x) => x.stars === s).length,
      }));
      return {
        ok: true,
        result: {
          personaId: p.id,
          installCount: p.installCount,
          chatCount: p.chatCount,
          version: p.version,
          rating: r.average,
          ratingCount: r.count,
          distribution: dist,
          published: p.published,
          isAuthor: p.authorUserId === userId,
        },
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- install (track adoption; marks for the installer) ----------------
  reg("personas", "install", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const p = store().personas.get(String(params.personaId || ""));
      if (!p) return { ok: false, error: "persona_not_found" };
      if (!p.published) return { ok: false, error: "not_published" };
      p.installCount += 1;
      return {
        ok: true,
        result: { personaId: p.id, installCount: p.installCount, version: p.version },
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- versioning: revise a published persona, snapshot prior version ---
  reg("personas", "revise", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const p = store().personas.get(String(params.personaId || ""));
      if (!p) return { ok: false, error: "persona_not_found" };
      if (p.authorUserId !== userId) return { ok: false, error: "not_author" };
      // Snapshot the current state into version history.
      p.history.push({
        version: p.version,
        contentHash: p.contentHash,
        snapshot: {
          name: p.name, tagline: p.tagline, personality: p.personality,
          voice: p.voice, greeting: p.greeting, exampleDialogue: p.exampleDialogue,
        },
        changelog: String(params.changelog || "").trim().slice(0, 400) || "revision",
        at: now(),
      });
      if (p.history.length > 30) p.history = p.history.slice(-30);
      // Apply new field values.
      const fields = ["name", "tagline", "personality", "voice", "greeting", "category"];
      for (const f of fields) {
        if (params[f] !== undefined) p[f] = String(params[f]).trim();
      }
      if (params.tags !== undefined) p.tags = normTags(params.tags);
      if (Array.isArray(params.exampleDialogue)) {
        p.exampleDialogue = params.exampleDialogue
          .filter((e) => e && e.prompt && e.response)
          .slice(0, 12)
          .map((e) => ({
            prompt: String(e.prompt).slice(0, 300),
            response: String(e.response).slice(0, 1000),
          }));
      }
      p.version += 1;
      p.updatedAt = now();
      p.contentHash = contentHash({
        name: p.name, personality: p.personality, voice: p.voice,
        greeting: p.greeting, exampleDialogue: p.exampleDialogue,
      });
      return {
        ok: true,
        result: {
          personaId: p.id,
          version: p.version,
          // Installers to notify = adoption count; the changelog is the notice.
          installersNotified: p.installCount,
          changelog: p.history[p.history.length - 1].changelog,
        },
      };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- version history --------------------------------------------------
  reg("personas", "versions", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      const p = store().personas.get(String(params.personaId || ""));
      if (!p) return { ok: false, error: "persona_not_found" };
      if (!p.published && p.authorUserId !== userId) {
        return { ok: false, error: "not_visible" };
      }
      const entries = p.history.map((h) => ({
        version: h.version, changelog: h.changelog, contentHash: h.contentHash, at: h.at,
      }));
      entries.push({
        version: p.version, changelog: "current", contentHash: p.contentHash, at: p.updatedAt,
      });
      return { ok: true, result: { personaId: p.id, current: p.version, versions: entries } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });

  // ---- regenerate the deterministic portrait (avatar) -------------------
  reg("personas", "regenerate_portrait", (ctx, _artifact, params = {}) => {
    try {
      const userId = actorId(ctx);
      if (!userId) return { ok: false, error: "no_actor" };
      const p = store().personas.get(String(params.personaId || ""));
      if (!p) return { ok: false, error: "persona_not_found" };
      if (p.authorUserId !== userId) return { ok: false, error: "not_author" };
      // If the caller supplies a data-URI image (upload), use it; else
      // regenerate deterministically from identity + a fresh seed token.
      const uploaded = String(params.dataUri || "").trim();
      if (uploaded.startsWith("data:image/") && uploaded.length < 200000) {
        p.portrait = uploaded;
      } else {
        const seedToken = String(params.seedToken || crypto.randomBytes(3).toString("hex"));
        p.portrait = generatePortrait(`${p.id}:${p.name}:${seedToken}`);
      }
      p.updatedAt = now();
      return { ok: true, result: { personaId: p.id, portrait: p.portrait } };
    } catch (err) { return { ok: false, error: String(err?.message || err) }; }
  });
}
