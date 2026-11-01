// INC-152 — the backup-model low-confidence label must reach the user on
// every chat reply path, not just the HTTP JSON/SSE ones. The label is
// decided server-side by lib/answer-confidence.js (covered by
// answer-confidence.test.js); this file pins the WIRING that carries it:
// the socket chat:complete payloads in server.js, the PersistentChatRail
// mapping + render, and the ChatWorkspacePanel mapper (regression guard for
// the paths that already worked). Static checks — no server boot, no network.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const serverJs = readFileSync(join(here, "../server.js"), "utf8");
const rail = readFileSync(join(here, "../../concord-frontend/components/chat/PersistentChatRail.tsx"), "utf8");
const panel = readFileSync(join(here, "../../concord-frontend/components/chat/ChatWorkspacePanel.tsx"), "utf8");

const count = (haystack, needle) => haystack.split(needle).length - 1;

describe("server socket chat:complete payloads carry the label", () => {
  it("streaming emit spreads answerConfidence (ollama-stream)", () => {
    // One occurrence tags the saved session message (pre-existing); the
    // second is the chat:complete payload added for INC-152.
    assert.ok(
      count(serverJs, '...(answerConfidence({ source: "ollama-stream", model: streamResult.model }) || {})') >= 2,
      "streaming chat:complete must spread answerConfidence into its payload",
    );
  });

  it("macro-path emit forwards the tag from the chat.respond result", () => {
    assert.ok(serverJs.includes("result?.answerConfidence"), "macro chat:complete must forward result.answerConfidence");
    assert.ok(serverJs.includes("answerConfidenceReason: result.answerConfidenceReason"));
  });

  it("both fallback system prompts append the small-model guard suffix", () => {
    assert.ok(serverJs.includes("_selfContSystem = system + _selfContBlock + smallModelPromptSuffix(brainModel);"));
    assert.ok(serverJs.includes("_selfContSystem = _directSystem + _selfContBlock + smallModelPromptSuffix(brainModel);"));
  });
});

describe("PersistentChatRail maps and renders the label", () => {
  it("imports LowConfidenceTag", () => {
    assert.ok(rail.includes("import LowConfidenceTag from '@/components/chat/LowConfidenceTag';"));
  });

  it("chat:complete handler maps answerConfidence onto the message", () => {
    assert.ok(rail.includes("answerConfidence: d.answerConfidence || null"));
    assert.ok(rail.includes("answerConfidenceReason: d.answerConfidenceReason || null"));
  });

  it("HTTP fallback maps answerConfidence onto the message", () => {
    assert.ok(rail.includes("answerConfidence: data?.answerConfidence || null"));
    assert.ok(rail.includes("answerConfidenceReason: data?.answerConfidenceReason || null"));
  });

  it("renders the tag for assistant messages", () => {
    assert.ok(rail.includes("<LowConfidenceTag confidence={msg.answerConfidence} reason={msg.answerConfidenceReason} />"));
  });
});

describe("ChatWorkspacePanel paths stay wired (regression guard)", () => {
  it("saved-session hydration maps meta.answerConfidence", () => {
    assert.ok(panel.includes("confidence: meta.answerConfidence === 'low' ? 'low' : undefined"));
  });

  it("central mapper reads answerConfidence from data or meta", () => {
    assert.ok(panel.includes("data.answerConfidence ?? data.meta?.answerConfidence"));
  });

  it("renders LowConfidenceTag from message.confidence", () => {
    assert.ok(panel.includes("<LowConfidenceTag confidence={message.confidence} reason={message.confidenceReason} />"));
  });
});

describe("the label is gated on the Mac fallback, not on the model name", () => {
  const ac = readFileSync(join(here, "../lib/answer-confidence.js"), "utf8");
  const bc = readFileSync(join(here, "../lib/brain-config.js"), "utf8");
  it("answerConfidence and the prompt guard both require isMacFallbackMode()", () => {
    assert.ok(ac.includes('import { getLocalUnifiedModel, isMacFallbackMode } from "./brain-config.js";'));
    assert.equal(count(ac, "if (!isMacFallbackMode())"), 2);
  });
  it("brain-config exports it and recognises the loopback :11480 proxy and BRAINS_MODE", () => {
    assert.ok(bc.includes("export function isMacFallbackMode("));
    assert.ok(bc.includes('"11480"'));
    assert.ok(bc.includes("env.BRAINS_MODE"));
  });
});
