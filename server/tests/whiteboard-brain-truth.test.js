// Whiteboard S7 — brain macros read both element models
// (server/tests/whiteboard-brain-truth.test.js).
// Pins: ai-summarize-board / ai-cluster-stickies see sketch
// notecards (type 'notecard'), not only Collab stickies
// (kind 'sticky'); an empty transcript never reaches the brain.
import { describe, it, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const resolveFromHere = (p) => {
  try { return fileURLToPath(new URL(p, import.meta.url)); } catch { return p; }
};
const domDir = path.dirname(resolveFromHere('../domains/_test_resolve_marker.js'));
async function loadDomainFile(rel) {
  const candidates = [
    resolveFromHere(rel),
    path.join(process.cwd(), 'server', rel.replace('../', '')),
    path.join(process.cwd(), rel.replace('../', '')),
  ];
  for (const c of candidates) {
    try { await import(c); return true; } catch { /* next */ }
  }
  return false;
}
void domDir; void readFileSync;

const { registerWhiteboardDomain } = await import('../domains/whiteboard.js').catch(async () => {
  await loadDomainFile('../domains/whiteboard.js');
  return import('../domains/whiteboard.js');
});

const registry = new Map();
const registerLensAction = (domain, name, fn) => registry.set(name, fn);
before(() => {
  globalThis._concordSTATE = {};
  globalThis.STATE = globalThis._concordSTATE;
  registerWhiteboardDomain({ registerLensAction });
});
const ctx = { actor: { userId: 'u1' }, userId: 'u1' };
const call = (name, params, c = ctx) => registry.get(name)(c, { data: params }, params);

describe('whiteboard brain truth (S7)', () => {
  it('summarize and cluster read sketch notecards', async () => {
    const saved = await call('board-save', {
      title: 'sketch board',
      scene: { elements: [
        { id: 'n1', type: 'notecard', x: 0, y: 0, width: 180, height: 120, text: 'ship the beta release' },
        { id: 'n2', type: 'notecard', x: 200, y: 0, width: 180, height: 120, text: 'ship the beta docs' },
        { id: 'n3', type: 'notecard', x: 400, y: 0, width: 180, height: 120, text: 'fix the login bug' },
        { id: 'r1', type: 'rectangle', x: 0, y: 200, width: 300, height: 200 },
      ], appState: {} },
    });
    const id = saved.result.board.id;
    const sum = await call('ai-summarize-board', { boardId: id });
    assert.equal(sum.result.source, 'deterministic');
    assert.match(sum.result.summary, /3 sticky notes/);
    assert.match(sum.result.summary, /1 frame/);
    const cl = await call('ai-cluster-stickies', { boardId: id });
    assert.ok(cl.result.clusters.length >= 1);
  });

  it('an empty transcript never reaches the brain', async () => {
    const saved = await call('board-save', {
      title: 'shapes only',
      scene: { elements: [
        { id: 'r1', type: 'rectangle', x: 0, y: 0, width: 100, height: 80 },
        { id: 'e1', type: 'ellipse', x: 50, y: 50, width: 60, height: 60 },
      ], appState: {} },
    });
    let brainCalls = 0;
    const brainCtx = { ...ctx, llm: { chat: async () => { brainCalls += 1; return { content: '{"summary":"fragment","actionItems":[]}' }; } } };
    const sum = await call('ai-summarize-board', { boardId: saved.result.board.id }, brainCtx);
    assert.equal(brainCalls, 0);
    assert.equal(sum.result.source, 'deterministic');
  });
});
