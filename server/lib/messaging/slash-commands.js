// server/lib/messaging/slash-commands.js
//
// Message lens Sprint B #16 — slash command parser. Same shape as
// lib/code/slash-commands.js (Code Sprint B #9). Built-ins dispatch
// to existing macros (real ones, no stubs). Custom skills resolved
// from kind='code_skill' DTUs (shared substrate with code lens).

const BUILTINS = [
  {
    name: "summarize",
    description: "AI-summarise the current thread. /summarize",
    parse(_args, ctx) {
      return { domain: "messaging", macro: "summarize_thread", input: { conversationId: ctx?.conversationId } };
    },
  },
  {
    name: "translate",
    description: "Translate a message. /translate <messageId> <targetLang>",
    parse(args) {
      return { domain: "messaging", macro: "translate", input: { messageId: args[0], targetLang: args[1] } };
    },
  },
  {
    name: "draft",
    description: "AI-draft a message in your voice. /draft <prompt>",
    parse(args, ctx) {
      return { domain: "messaging", macro: "compose_in_my_voice", input: {
        conversationId: ctx?.conversationId, prompt: args.join(" "),
      }};
    },
  },
  {
    name: "schedule",
    description: "Schedule send. /schedule <iso_ts> <body...>",
    parse(args, ctx) {
      const iso = args[0];
      const ts = iso ? Math.floor(new Date(iso).getTime() / 1000) : NaN;
      return { domain: "messaging", macro: "msg_post", input: {
        conversationId: ctx?.conversationId, body: args.slice(1).join(" "),
        scheduledFor: Number.isFinite(ts) ? ts : null,
      }};
    },
  },
  {
    name: "remind",
    description: "Set a reminder. /remind <iso_ts> <body...>",
    parse(args, ctx) {
      // For now reminders are scheduled messages addressed to self
      return { domain: "messaging", macro: "msg_post", input: {
        conversationId: ctx?.conversationId,
        body: `⏰ Reminder: ${args.slice(1).join(" ")}`,
        scheduledFor: args[0] ? Math.floor(new Date(args[0]).getTime() / 1000) : null,
      }};
    },
  },
  {
    name: "poll",
    description: "Inline poll. /poll <question> | <opt1> | <opt2> | ...",
    parse(args, ctx) {
      const parts = args.join(" ").split("|").map((s) => s.trim()).filter(Boolean);
      const question = parts[0];
      const options = parts.slice(1);
      const body = `📊 **Poll:** ${question}\n${options.map((o, i) => `  ${i + 1}. ${o}`).join("\n")}`;
      return { domain: "messaging", macro: "msg_post", input: {
        conversationId: ctx?.conversationId, body,
      }};
    },
  },
  {
    name: "snooze",
    description: "Snooze the current thread. /snooze <iso_ts>",
    parse(args, ctx) {
      const ts = args[0] ? Math.floor(new Date(args[0]).getTime() / 1000) : null;
      return { domain: "messaging", macro: "thread_snooze", input: {
        conversationId: ctx?.conversationId, snoozedUntil: ts,
      }};
    },
  },
  {
    name: "pin",
    description: "Pin a message. /pin <messageId>",
    parse(args) { return { domain: "messaging", macro: "msg_pin", input: { id: args[0], pin: true } }; },
  },
  {
    name: "search",
    description: "Search messages. /search <query>",
    parse(args) { return { domain: "messaging", macro: "search_messages", input: { query: args.join(" ") } }; },
  },
  {
    name: "triage",
    description: "Triage your unread inbox. /triage",
    parse() { return { domain: "messaging", macro: "triage_inbox", input: {} }; },
  },
  {
    name: "help",
    description: "List slash commands. /help",
    parse() { return { domain: "_meta", macro: "help", input: {} }; },
  },
];

function tokenise(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++;
    if (i >= s.length) break;
    if (s[i] === '"') {
      i++;
      let buf = "";
      while (i < s.length && s[i] !== '"') {
        if (s[i] === "\\" && i + 1 < s.length) { buf += s[i + 1]; i += 2; continue; }
        buf += s[i++];
      }
      i++; out.push(buf);
    } else {
      let buf = "";
      while (i < s.length && !/\s/.test(s[i])) buf += s[i++];
      out.push(buf);
    }
  }
  return out;
}

export function parseSlash(line, ctx = {}) {
  if (!line || typeof line !== "string") return { error: "empty" };
  const t = line.trim();
  if (!t.startsWith("/")) return { error: "not_a_slash_command" };
  const parts = tokenise(t.slice(1));
  if (parts.length === 0) return { error: "empty_command" };
  const name = parts[0];
  const args = parts.slice(1);
  if (name === "help") {
    return { domain: "_meta", macro: "help", input: { builtins: BUILTINS.map(({ name, description }) => ({ name, description })) } };
  }
  const builtin = BUILTINS.find((b) => b.name === name);
  if (builtin) {
    const out = builtin.parse(args, ctx);
    return out.error ? out : { ...out, source: "builtin" };
  }
  return { error: "unknown_command", name };
}

export function listBuiltins() {
  return BUILTINS.map(({ name, description }) => ({ name, description }));
}
