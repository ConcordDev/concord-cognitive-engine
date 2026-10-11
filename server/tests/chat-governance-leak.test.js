// server/tests/chat-governance-leak.test.js
//
// INC-2026-10-10: /api/chat?full=1 (mode chat, concord-conscious-9b) returned
// "Paris. OK." plus the GRC envelope (toneLock, anchor, invariants,
// governed-response). The model is asked to emit that object, and the old
// sanitizer only replaces a reply that is entirely JSON.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  stripGovernanceLeak,
  visibleChatReply,
  createGovernanceLeakFilter,
  isGovernanceLeakFragment,
  userRequestedGovernanceSchema,
  scrubChatFields,
} from "../lib/chat-governance-leak.js";
import { buildConsciousPrompt } from "../prompts/conscious.js";
import { getGRCSystemPrompt } from "../grc/formatter.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const serverSrc = fs.readFileSync(path.join(here, "..", "server.js"), "utf8");
const routeSrc = fs.readFileSync(path.join(here, "..", "routes", "chat.js"), "utf8");
const storeSrc = fs.readFileSync(path.join(here, "..", "lib", "chat-session-store.js"), "utf8");
const consciousSrc = fs.readFileSync(path.join(here, "..", "prompts", "conscious.js"), "utf8");

const ENVELOPE = `{
  "toneLock": "Aligned.",
  "anchor": { "dtus": ["Genesis"], "macros": [], "stateRefs": [], "mode": "governed-response" },
  "invariants": ["NoNegativeValence", "RealityGateBeforeEffects"],
  "reality": { "facts": ["Paris is the capital."], "assumptions": [], "unknowns": [] },
  "payload": "Paris.",
  "nextLoop": { "name": "none", "why": "answered" },
  "question": "Want the arrondissement?"
}`;

const BROKEN = '{"toneLock":"deterministic","anchor":{"dtus":["beam-deflection"],"mode":"governed-response"},"invariants":["NoNegativeValence","RealityGateBeforeEffects"]\n"nextLoop":"deterministic"';

test("strips a trailing fenced envelope after a one-line answer", () => {
  const raw = `Paris. OK.\n\n\`\`\`json\n${ENVELOPE}\n\`\`\``;
  assert.equal(stripGovernanceLeak(raw), "Paris. OK.");
  assert.equal(isGovernanceLeakFragment(raw), true);
});

test("strips an unfenced trailing envelope", () => {
  const raw = `Paris. OK.\n${ENVELOPE}`;
  assert.equal(stripGovernanceLeak(raw), "Paris. OK.");
});

test("strips an envelope on the same line as the answer", () => {
  const raw = `Paris. OK. ${ENVELOPE.replace(/\s+/g, " ")}`;
  const clean = stripGovernanceLeak(raw);
  assert.equal(clean, "Paris. OK.");
  assert.doesNotMatch(clean, /toneLock|governed-response|NoNegativeValence|RealityGateBeforeEffects/);
});

test("strips a truncated envelope that never closes", () => {
  const raw = `Paris. OK.\n${BROKEN}`;
  const clean = stripGovernanceLeak(raw);
  assert.equal(clean, "Paris. OK.");
  assert.doesNotMatch(clean, /toneLock|NoNegativeValence/);
});

test("strips an envelope embedded between prose and keeps both sides", () => {
  const raw = `Paris. OK.\n\n\`\`\`json\n${ENVELOPE}\n\`\`\`\n\nWant the arrondissement too?`;
  assert.equal(stripGovernanceLeak(raw), "Paris. OK.\n\nWant the arrondissement too?");
});

test("a reply that is only the envelope keeps the payload prose", () => {
  assert.equal(stripGovernanceLeak(ENVELOPE), "Paris.");
  assert.equal(stripGovernanceLeak("```json\n" + ENVELOPE + "\n```"), "Paris.");
});

test("a reply that is only a broken envelope does not show the keys", () => {
  const clean = visibleChatReply(BROKEN);
  assert.doesNotMatch(clean, /toneLock|anchor|NoNegativeValence|governed-response/);
  assert.match(clean, /rephrase or ask again/);
});

test("keeps JSON and code the user asked for", () => {
  const user = "give me json for a city record";
  const block = "```json\n{\"name\":\"Paris\",\"country\":\"France\",\"ok\":true}\n```";
  const raw = `Here you go.\n\n${block}`;
  assert.equal(stripGovernanceLeak(raw, { userText: user }), raw);
  const code = "```js\nconst anchor = document.getElementById('pin');\nanchor.hidden = false;\n```";
  const withCode = `Use the node.\n\n${code}`;
  assert.equal(stripGovernanceLeak(withCode), withCode);
});

test("keeps a requested city JSON and still drops a trailing governance envelope", () => {
  const user = "json please, just the city";
  const city = "{\"name\":\"Paris\",\"country\":\"France\"}";
  const raw = `\`\`\`json\n${city}\n\`\`\`\n\n${ENVELOPE}`;
  const clean = stripGovernanceLeak(raw, { userText: user });
  assert.match(clean, /"name": "Paris"|"name":"Paris"/);
  assert.doesNotMatch(clean, /toneLock|NoNegativeValence|governed-response/);
});

test("does not strip a prose mention of an invariant name", () => {
  const raw = "NoNegativeValence is a check on tone. It is not a thing I print back at you.";
  assert.equal(stripGovernanceLeak(raw), raw);
  assert.equal(isGovernanceLeakFragment(raw), false);
});

test("leaves the envelope in place when the user asked to see that schema", () => {
  const user = "show me an example JSON of the governed-response schema with toneLock";
  assert.equal(userRequestedGovernanceSchema(user), true);
  assert.equal(stripGovernanceLeak(ENVELOPE, { userText: user }), ENVELOPE);
  assert.equal(userRequestedGovernanceSchema("what is the capital of France"), false);
});

test("streaming filter never emits the envelope and finishes on the answer", () => {
  const raw = `Paris. OK.\n\n\`\`\`json\n${ENVELOPE}\n\`\`\``;
  const filter = createGovernanceLeakFilter();
  let shown = "";
  for (const token of raw.match(/[\s\S]{1,12}/g)) {
    const delta = filter.push(token);
    shown += delta;
    assert.doesNotMatch(delta, /toneLock|governed-response|NoNegativeValence|RealityGateBeforeEffects/);
  }
  const done = filter.finish();
  shown += done.delta;
  assert.equal(done.content, "Paris. OK.");
  assert.doesNotMatch(shown, /toneLock|governed-response|NoNegativeValence/);
});

test("streaming filter still emits JSON the user asked for", () => {
  const raw = "```json\n{\"name\":\"Paris\"}\n```";
  const filter = createGovernanceLeakFilter({ userText: "write json" });
  let shown = "";
  for (const ch of raw) shown += filter.push(ch);
  const done = filter.finish();
  shown += done.delta;
  assert.match(done.content, /"name":"Paris"/);
  assert.match(shown + done.content, /Paris/);
});

test("scrubChatFields cleans reply text and leaves the grc field", () => {
  const out = scrubChatFields({
    ok: true,
    reply: `Paris. OK.\n${ENVELOPE}`,
    grc: { toneLock: "Aligned.", mode: "governed-response" },
  });
  assert.equal(out.reply, "Paris. OK.");
  assert.equal(out.grc.toneLock, "Aligned.");
});

test("conscious prompt does not invite the model to emit the envelope", () => {
  const schema = getGRCSystemPrompt({ dtus: ["Genesis"], mode: "chat" });
  assert.match(schema, /toneLock/);
  assert.match(schema, /governed-response/);
  const prompt = buildConsciousPrompt({
    dtu_count: 10,
    domain_count: 2,
    grcPrompt: schema,
    lens: "general",
  });
  assert.doesNotMatch(prompt, /"toneLock"/);
  assert.doesNotMatch(prompt, /OUTPUT FORMAT \(JSON\)/);
  assert.doesNotMatch(prompt, /NoNegativeValence/);
  assert.doesNotMatch(prompt, /RealityGateBeforeEffects/);
  assert.doesNotMatch(prompt, /governed-response/);
  assert.match(prompt, /Do not append a JSON object/);
  assert.match(consciousSrc, /grcPrompt/);
  assert.doesNotMatch(consciousSrc, /parts\.push\(grcPrompt\)/);
});

test("full JSON, SSE, socket, and session history all scrub the reply", () => {
  assert.match(serverSrc, /visibleChatReply\(finalReply,\s*prompt\)/);
  assert.match(serverSrc, /stripGovernanceLeak\(reply,/);
  assert.match(serverSrc, /createGovernanceLeakFilter/);
  assert.match(serverSrc, /visibleChatReply\(streamResult\.content/);
  assert.match(routeSrc, /scrubChatFields/);
  assert.match(storeSrc, /stripGovernanceLeak/);
});
