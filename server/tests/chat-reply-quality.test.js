// server/tests/chat-reply-quality.test.js
//
// INC-20261010-07. Conversational /api/chat (mode "chat"):
//   (a) the reply cap comes from CONCORD_CHAT_MAX_TOKENS, default 2000
//   (b) a length-truncated completion is finished or trimmed to a sentence
//   (c) a two-turn session sends the prior assistant reply exactly once
//   (d) the chat system prompt keeps the persona formatting rule and does
//       not instruct the model to vomit markdown

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CHAT_MAX_TOKENS_DEFAULT,
  resolveChatMaxTokens,
  finishLengthLimitedReply,
  trimToLastCompleteUnit,
  buildChatHistoryMessages,
  stoppedOnLength,
} from "../lib/chat-reply-policy.js";
import {
  PERSONA_FORMATTING_RULE,
  finalizeConversationalSystemPrompt,
  isConversationalChatMode,
} from "../lib/prompt-registry.js";
import { buildConsciousPrompt } from "../prompts/conscious.js";

const PRIOR_REPLY = "Fire is a reaction. It needs fuel, heat, and oxygen. That's the whole story.";

test("(a) chat max tokens defaults to about 2000 and reads CONCORD_CHAT_MAX_TOKENS", () => {
  const prev = process.env.CONCORD_CHAT_MAX_TOKENS;
  try {
    delete process.env.CONCORD_CHAT_MAX_TOKENS;
    assert.equal(CHAT_MAX_TOKENS_DEFAULT, 2000);
    assert.equal(resolveChatMaxTokens(), 2000);
    assert.equal(resolveChatMaxTokens({ verbosity: 0.5 }), 2000);
    assert.equal(resolveChatMaxTokens({ verbosity: undefined }), 2000);
    assert.equal(resolveChatMaxTokens({ env: "" }), 2000);
    assert.equal(resolveChatMaxTokens({ env: "nope" }), 2000);
    assert.equal(resolveChatMaxTokens({ env: "0" }), 2000);
    assert.equal(resolveChatMaxTokens({ verbosity: 0.5, env: "3200" }), 3200);
    assert.equal(resolveChatMaxTokens({ verbosity: 1, env: "2000" }), 2800);
    assert.equal(resolveChatMaxTokens({ verbosity: 0, env: "2000" }), 1200);
    process.env.CONCORD_CHAT_MAX_TOKENS = "2400";
    assert.equal(resolveChatMaxTokens({ verbosity: 0.5 }), 2400);
    assert.ok(resolveChatMaxTokens({ env: "999999" }) <= 8192);
    assert.ok(resolveChatMaxTokens({ env: "10" }) >= 256);
  } finally {
    if (prev == null) delete process.env.CONCORD_CHAT_MAX_TOKENS;
    else process.env.CONCORD_CHAT_MAX_TOKENS = prev;
  }
});

test("(b) a length-truncated completion is continued or trimmed to a complete sentence", async () => {
  const partial = "Fire is a reaction. It needs fuel and";
  const continued = await finishLengthLimitedReply(partial, {
    doneReason: "length",
    continueOnce: async () => ({ content: "oxygen to keep going.", doneReason: "stop" }),
  });
  assert.equal(continued.continued, true);
  assert.equal(continued.text, "Fire is a reaction. It needs fuel and oxygen to keep going.");
  assert.equal(continued.text.endsWith("."), true);
  assert.doesNotMatch(continued.text, /fuel and$/);

  const echoed = await finishLengthLimitedReply(partial, {
    doneReason: "length",
    continueOnce: async () => ({ content: `${partial} oxygen to keep going.`, doneReason: "stop" }),
  });
  assert.equal(echoed.text, "Fire is a reaction. It needs fuel and oxygen to keep going.");
  assert.equal(echoed.text.split("Fire is a reaction.").length - 1, 1);

  const stillCut = await finishLengthLimitedReply(partial, {
    doneReason: "length",
    continueOnce: async () => ({ content: "heat but then it", doneReason: "length" }),
  });
  assert.equal(stillCut.trimmed, true);
  assert.equal(stillCut.text, "Fire is a reaction.");
  assert.equal(stillCut.text.endsWith("."), true);

  const listy = "Two things matter.\n\n- Fuel must be dry.\n- Oxygen is still\n## And then";
  const trimmedList = await finishLengthLimitedReply(listy, { doneReason: "length" });
  assert.match(trimmedList.text, /Two things matter\./);
  assert.match(trimmedList.text, /Fuel must be dry\./);
  assert.doesNotMatch(trimmedList.text, /Oxygen is still/);
  assert.doesNotMatch(trimmedList.text, /##/);
  assert.equal(trimToLastCompleteUnit(listy), trimmedList.text);

  const untouched = await finishLengthLimitedReply(partial, { doneReason: "stop" });
  assert.equal(untouched.text, partial);
  assert.equal(untouched.trimmed, false);
  assert.equal(stoppedOnLength("Length"), true);
  assert.equal(stoppedOnLength("stop"), false);
});

test("(c) a two-turn session sends the prior assistant reply exactly once, as history", () => {
  const session = [
    { role: "user", content: "Tell me about fire." },
    { role: "assistant", content: PRIOR_REPLY },
    { role: "assistant", content: PRIOR_REPLY },
    { role: "user", content: "Say more about what that means in a kitchen." },
  ];
  const messages = buildChatHistoryMessages(session, "Say more about what that means in a kitchen.");
  const assistants = messages.filter((m) => m.role === "assistant");
  assert.equal(assistants.length, 1);
  assert.equal(assistants[0].content, PRIOR_REPLY);
  assert.equal(messages[messages.length - 1].role, "user");
  assert.equal(messages[messages.length - 1].content, "Say more about what that means in a kitchen.");
  assert.equal(messages.filter((m) => m.role === "user" && m.content === "Tell me about fire.").length, 1);
  const joined = messages.map((m) => m.content).join("\n");
  assert.equal(joined.split(PRIOR_REPLY).length - 1, 1);

  const long = `${PRIOR_REPLY} ${"More detail follows the same point. ".repeat(40)}`;
  assert.ok(long.length > 1500);
  assert.ok(long.length < 8000);
  const withLong = buildChatHistoryMessages(
    [
      { role: "user", content: "Tell me about fire." },
      { role: "assistant", content: long },
      { role: "user", content: "Go on." },
    ],
    "Go on.",
  );
  assert.equal(withLong.filter((m) => m.role === "assistant")[0].content, long.trim());

  const stub = "Alpha is a complete sentence. Beta stops in the middle of";
  const replayed = buildChatHistoryMessages(
    [
      { role: "user", content: "First." },
      { role: "assistant", content: stub },
      { role: "user", content: "Second." },
    ],
    "Second.",
  );
  assert.equal(replayed.find((m) => m.role === "assistant").content, "Alpha is a complete sentence.");
  assert.equal(replayed[replayed.length - 1].role, "user");
});

test("(d) chat-mode system prompt keeps the persona formatting rule and drops markdown encouragement", () => {
  assert.equal(isConversationalChatMode("chat"), true);
  assert.equal(isConversationalChatMode("explore"), true);
  assert.equal(isConversationalChatMode("design"), false);
  assert.equal(isConversationalChatMode("forge"), false);
  assert.equal(isConversationalChatMode("document"), false);

  const built = buildConsciousPrompt({
    lens: "general",
    conversation_history: [{ role: "user", content: "hey" }],
    styleHints: [
      "Communication style preferences (learned from 4 exchanges):",
      "- Bullet lists: prefers structured lists",
      "Adapt your responses to match these preferences naturally.",
    ].join("\n"),
    grcPrompt: "OUTPUT FORMAT (JSON)\nUse markdown headers.",
  });
  const chat = finalizeConversationalSystemPrompt(
    `${built}\n\nUse markdown headers and expand into 3-6 bulleted sub-points.`,
    "chat",
  );
  assert.match(chat, new RegExp(PERSONA_FORMATTING_RULE.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.equal(chat.trim().endsWith("bullet walls."), true);
  assert.doesNotMatch(chat, /Markdown link is fine/i);
  assert.doesNotMatch(chat, /prefers structured lists/i);
  assert.doesNotMatch(chat, /Use markdown headers/i);
  assert.doesNotMatch(chat, /expand into 3-6 bulleted/i);
  assert.doesNotMatch(chat, /OUTPUT FORMAT \(JSON\)/);
  assert.match(chat, /fenced code block/i);
  assert.match(chat, /user asked for a list/i);

  const structured = "Use markdown headers and a bullet list for this design doc.";
  assert.equal(finalizeConversationalSystemPrompt(structured, "design"), structured);
  assert.equal(finalizeConversationalSystemPrompt(structured, "document"), structured);
  assert.equal(finalizeConversationalSystemPrompt(built, "forge"), built);
});
