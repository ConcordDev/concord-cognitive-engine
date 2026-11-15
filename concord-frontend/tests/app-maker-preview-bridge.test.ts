/**
 * FIX-app-maker-001 S3 — the parent-side preview bridge handler.
 *
 * The preview frame is an opaque origin holding no credentials; this
 * handler is the trust surface. Pins: foreign sources are dropped
 * silently · schema violations are dropped · an oversize config is
 * refused BY REPLY without a server call · a valid request forwards to
 * previewBridge under the session id and replies with the rows · a
 * server refusal replies ok:false carrying its error. Plus source
 * assertions that LivePreview actually mounts the handler and the
 * frame sandbox is flipped (allow-scripts, never allow-same-origin).
 */
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { handlePreviewBridgeMessage, type PreviewBridgeReply } from '@/lib/app-maker/preview-bridge';

const FRAME = { name: 'preview-frame' };
const PROJECT = 'proj_1';
const SESSION = 'pv_test';

function harness(runImpl?: (name: string, params: Record<string, unknown>) => Promise<{ ok: boolean; result: unknown; error: string | null }>) {
  const replies: PreviewBridgeReply[] = [];
  const run = vi.fn(runImpl || (async () => ({ ok: true, result: { rows: [{ id: 'r1' }] }, error: null })));
  const args = (over: Partial<Parameters<typeof handlePreviewBridgeMessage>[0]> = {}) => ({
    source: FRAME,
    frameWindow: FRAME,
    data: { kind: 'am-bridge', v: 1, requestId: 'am1', projectId: PROJECT, action: 'create_row', table: 'Customers', config: { name: 'Ada' } },
    projectId: PROJECT,
    sessionId: SESSION,
    run,
    reply: (r: PreviewBridgeReply) => replies.push(r),
    ...over,
  });
  return { replies, run, args };
}

describe('app-maker preview bridge handler (FIX-app-maker-001 S3)', () => {
  it('drops messages that are not from the preview frame', async () => {
    const h = harness();
    const handled = await handlePreviewBridgeMessage(h.args({ source: { name: 'other' } }));
    expect(handled).toBe(false);
    expect(h.run).not.toHaveBeenCalled();
    expect(h.replies).toHaveLength(0);
  });

  it('drops wrong kind, wrong version, and another project\'s messages', async () => {
    const h = harness();
    const base = { kind: 'am-bridge', v: 1, requestId: 'am1', projectId: PROJECT, action: 'create_row', table: 'Customers', config: {} };
    expect(await handlePreviewBridgeMessage(h.args({ data: { ...base, kind: 'other' } }))).toBe(false);
    expect(await handlePreviewBridgeMessage(h.args({ data: { ...base, v: 2 } }))).toBe(false);
    expect(await handlePreviewBridgeMessage(h.args({ data: { ...base, projectId: 'proj_other' } }))).toBe(false);
    expect(h.run).not.toHaveBeenCalled();
    expect(h.replies).toHaveLength(0);
  });

  it('drops actions outside the allowlist', async () => {
    const h = harness();
    const handled = await handlePreviewBridgeMessage(h.args({
      data: { kind: 'am-bridge', v: 1, requestId: 'am1', projectId: PROJECT, action: 'call_api', table: 'Customers', config: {} },
    }));
    expect(handled).toBe(false);
    expect(h.run).not.toHaveBeenCalled();
  });

  it('refuses an oversize config by reply, without a server call', async () => {
    const h = harness();
    const handled = await handlePreviewBridgeMessage(h.args({
      data: { kind: 'am-bridge', v: 1, requestId: 'am9', projectId: PROJECT, action: 'create_row', table: 'Customers', config: { blob: 'x'.repeat(20000) } },
    }));
    expect(handled).toBe(true);
    expect(h.run).not.toHaveBeenCalled();
    expect(h.replies).toEqual([{ kind: 'am-bridge-reply', v: 1, requestId: 'am9', ok: false, error: 'bridge request too large' }]);
  });

  it('forwards a valid request under the session id and replies with the rows', async () => {
    const h = harness();
    const handled = await handlePreviewBridgeMessage(h.args());
    expect(handled).toBe(true);
    expect(h.run).toHaveBeenCalledWith('previewBridge', {
      projectId: PROJECT, sessionId: SESSION, action: 'create_row', table: 'Customers', config: { name: 'Ada' },
    });
    expect(h.replies).toEqual([{ kind: 'am-bridge-reply', v: 1, requestId: 'am1', ok: true, table: 'Customers', rows: [{ id: 'r1' }] }]);
  });

  it('a server refusal replies ok:false carrying its error; a thrown run falls back honestly', async () => {
    const refused = harness(async () => ({ ok: false, result: null, error: 'table_not_found' }));
    await handlePreviewBridgeMessage(refused.args());
    expect(refused.replies[0]).toMatchObject({ ok: false, error: 'table_not_found' });

    const thrown = harness(async () => { throw new Error('boom'); });
    await handlePreviewBridgeMessage(thrown.args());
    expect(thrown.replies[0]).toMatchObject({ ok: false, error: 'preview data store unavailable' });
  });

  it('LivePreview mounts the handler and the frame sandbox is flipped', () => {
    const src = readFileSync(join(process.cwd(), 'components/app-maker/AppBuilderStudio.tsx'), 'utf8');
    expect(src).toContain('sandbox="allow-scripts"');
    expect(src).not.toContain('sandbox="allow-same-origin"');
    expect(src).toContain('handlePreviewBridgeMessage');
    expect(src).toContain('live preview — workflows run here; table data is a preview copy');
    expect(src).toContain('Reset preview');
    expect(src).not.toContain("don't run here");
  });
});
