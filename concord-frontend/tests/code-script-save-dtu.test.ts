/**
 * F8 narrowed (R3 re-review of PR #1707) — Scratch Save's promised DTU.
 *
 * The save always kept its artifact half (lens.create stores the script,
 * indexed and listed). The DTU half was missing: the only DTU produced
 * was the generic lens-exhaust shadow ("Lens:code create script" — an
 * envelope about the create action), never the script itself as a
 * content-bearing DTU in the member's library, though the Save button's
 * title promises exactly that object.
 *
 * These tests pin the composition (scriptDtu.ts — the canonical
 * dtu.create / dtu.update calls, modelled on codeRunReport's run-report
 * DTU) and the panel wiring (handleSave's two phases, the read-back
 * discipline, the link stamp, the honest DTU-half failure).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  scriptDtuCreateCall,
  scriptDtuUpdateCall,
  scriptDtuTags,
  savedArtifactId,
  dtuRunRefused,
} from '@/components/code/scriptDtu';

const here = dirname(fileURLToPath(import.meta.url));
const panel = readFileSync(resolve(here, '../components/code/CodeEditorWorkspacePanel.tsx'), 'utf8');

const facts = {
  name: 'helper.py',
  language: 'python',
  scriptType: 'snippet',
  content: 'print("hello")\n',
  artifactId: 'lart_123',
};

describe('scriptDtuCreateCall — the script itself as a DTU', () => {
  it('composes the canonical dtu.create with the full source as content', () => {
    const call = scriptDtuCreateCall(facts);
    expect(call?.domain).toBe('dtu');
    expect(call?.action).toBe('create');
    const input = call?.input as Record<string, unknown>;
    expect(input.title).toBe('helper.py');
    expect(input.content).toBe('print("hello")\n');
    expect(input.source).toBe('code-lens:scratch-save');
    const machine = input.machine as Record<string, unknown>;
    expect(machine.kind).toBe('code_script');
    expect(machine.artifactId).toBe('lart_123');
    expect(machine.language).toBe('python');
    expect((input.meta as Record<string, unknown>).visibility).toBe('private');
  });
  it('never truncates the source — intact is the done-state', () => {
    const big = 'x'.repeat(20000);
    const call = scriptDtuCreateCall({ ...facts, content: big });
    expect((call?.input as Record<string, unknown>).content).toBe(big);
  });
  it('refuses to compose without a name', () => {
    expect(scriptDtuCreateCall({ ...facts, name: '  ' })).toBeNull();
  });
  it('tags name the lens, the kind, the type, and the language — deduped', () => {
    expect(scriptDtuTags(facts)).toEqual(['code', 'script', 'snippet', 'python']);
    expect(scriptDtuTags({ ...facts, scriptType: 'script' })).toEqual(['code', 'script', 'python']);
  });
});

describe('scriptDtuUpdateCall — a re-save updates, never duplicates', () => {
  it('targets the linked DTU with the new source', () => {
    const call = scriptDtuUpdateCall({ ...facts, dtuId: 'dtu_9', content: 'print(2)\n' });
    expect(call?.domain).toBe('dtu');
    expect(call?.action).toBe('update');
    const input = call?.input as Record<string, unknown>;
    expect(input.id).toBe('dtu_9');
    expect(input.content).toBe('print(2)\n');
    expect(input.title).toBe('helper.py');
  });
  it('refuses without a DTU id', () => {
    expect(scriptDtuUpdateCall({ ...facts, dtuId: '' })).toBeNull();
  });
});

describe('envelope helpers', () => {
  it('savedArtifactId reads the id out of either envelope shape', () => {
    expect(savedArtifactId({ artifact: { id: 'a1' } })).toBe('a1');
    expect(savedArtifactId({ data: { artifact: { id: 'a2' } } })).toBe('a2');
    expect(savedArtifactId({})).toBe('');
    expect(savedArtifactId(null)).toBe('');
  });
  it('dtuRunRefused reads refusal at either envelope level, and only refusal', () => {
    expect(dtuRunRefused({ ok: false })).toBe(true);
    expect(dtuRunRefused({ data: { ok: false } })).toBe(true);
    expect(dtuRunRefused({ ok: true, data: { ok: true } })).toBe(false);
    expect(dtuRunRefused(null)).toBe(false);
  });
});

describe('panel wiring (source assertions)', () => {
  it('handleSave is two phases: the artifact create, then the DTU', () => {
    const saveAt = panel.indexOf('await saveScript({');
    const dtuAt = panel.indexOf('scriptDtuCreateCall(facts)');
    expect(saveAt).toBeGreaterThan(-1);
    expect(dtuAt).toBeGreaterThan(saveAt);
    expect(panel).toContain('scriptDtuUpdateCall({ ...facts, dtuId })');
  });
  it('the mint is read-back-confirmed before the save claims it', () => {
    expect(panel).toContain('dtuRecordId(created.data)');
    expect(panel).toContain('dtuReadBackCall(id)');
    expect(panel).toContain('dtuReadBackMatches(id, back.data)');
  });
  it('the success flash fires only after the DTU phase succeeds', () => {
    const phase2 = panel.slice(panel.indexOf('Phase 2'), panel.indexOf("'[Code] DTU save failed:'"));
    expect(phase2).toContain('setSaveFlash');
    const dtuCatch = panel.slice(panel.indexOf("'[Code] DTU save failed:'"));
    expect(dtuCatch).not.toContain('setSaveFlash');
  });
  it('a DTU-half failure is named as the DTU step, with the artifact’s safety stated', () => {
    expect(panel).toContain('the library DTU was not');
    expect(panel).toContain('The script itself is saved; save again to retry the DTU.');
  });
  it('the link is persisted on the artifact and read back on open', () => {
    expect(panel).toContain('await updateScript({ id: artifactId, data: { dtuId } })');
    expect(panel).toContain('dtuId: data?.dtuId');
    expect(panel).toContain('...(tab.dtuId ? { dtuId: tab.dtuId } : {})');
  });
});
