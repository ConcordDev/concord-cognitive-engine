// Unit + render coverage for the database lens helpers: role gate, byte/uptime formatting,
// CSV/JSON export, status/metric/bar-chart cards and the connection-test wording.

import React from 'react';
import { describe, expect, it, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import {
  canUseDbAdmin, formatBytes, formatUptime, exportCSV, exportJSON, StatusCard, MetricCard, MiniBarChart,
  connectionTestMessage, isRemotePostgresConnection,
} from '../db-utils';

afterEach(() => cleanup());

describe('db-utils helpers', () => {
  it('gates the admin tools by role', () => {
    expect(canUseDbAdmin({ role: 'owner' })).toBe(true);
    expect(canUseDbAdmin({ role: 'founder' })).toBe(true);
    expect(canUseDbAdmin({ role: 'member' })).toBe(false);
    expect(canUseDbAdmin({})).toBe(false);
    expect(canUseDbAdmin(null)).toBe(false);
  });

  it('formats bytes and uptime across every unit boundary', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1_048_576)).toBe('5.0 MB');
    expect(formatBytes(3 * 1_073_741_824)).toBe('3.00 GB');
    expect(formatUptime()).toBe('0s');
    expect(formatUptime(45)).toBe('45s');
    expect(formatUptime(125)).toBe('2m 5s');
    expect(formatUptime(7260)).toBe('2h 1m');
  });

  it('exports CSV with quoting and JSON through a download link', async () => {
    const blobs: Blob[] = [];
    (URL as unknown as { createObjectURL: (b: Blob) => string }).createObjectURL = (b) => { blobs.push(b); return 'blob:x'; };
    (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    exportCSV(['a', 'b'], [{ a: 'x,y', b: 'say "hi"' }, { a: null, b: 'line\nbreak' }, { a: 1, b: undefined }]);
    exportJSON([{ a: 1 }]);
    expect(click).toHaveBeenCalledTimes(2);
    const csv = await blobs[0].text();
    expect(csv).toContain('"x,y"');
    expect(csv).toContain('"say ""hi"""');
    expect(await blobs[1].text()).toContain('"a": 1');
    click.mockRestore();
  });

  it('renders the cards for every status', () => {
    const { container } = render(
      <div>
        {(['success', 'warning', 'error', 'neutral'] as const).map((s) => <StatusCard key={s} title={`T-${s}`} value={`V-${s}`} icon={<i />} status={s} detail={s === 'success' ? 'ok detail' : undefined} />)}
        <MetricCard label="Rows" value={42} />
        <MiniBarChart data={[1, 4, 2.5]} label="Queries" color="bg-cyan-400" />
        <MiniBarChart data={[]} label="Empty" color="bg-red-400" />
      </div>,
    );
    expect(screen.getByText('V-success')).toBeTruthy();
    expect(screen.getByText('ok detail')).toBeTruthy();
    expect(screen.getByText('Rows')).toBeTruthy();
    expect(container.textContent).toContain('2.5');
  });

  it('words every connection-test outcome honestly', () => {
    expect(connectionTestMessage({ connected: true, datasets: 3 }).msg).toMatch(/Workspace copy readable — 3 dataset/);
    expect(connectionTestMessage({ connected: true }).msg).toMatch(/0 dataset/);
    expect(connectionTestMessage({ connected: false, scope: 'remote', remoteTest: 'not_wired_for_engine' }).msg).toMatch(/not wired/);
    expect(connectionTestMessage({ connected: false, scope: 'remote', remoteTest: 'not_wired_for_engine', message: 'custom' }).msg).toBe('custom');
    const ok = connectionTestMessage({ connected: true, scope: 'remote', hostname: 'db.example', serverVersion: '16.1', latencyMs: 42 });
    expect(ok.kind).toBe('ok');
    expect(ok.msg).toMatch(/db\.example/);
    expect(connectionTestMessage({ connected: true, scope: 'remote' }).msg).toMatch(/remote server/);
    for (const [stage, re] of [['guard', /refused before dialing/], ['credentials', /password/], ['auth', /refused those credentials/], ['connect', /Could not reach/], ['other', /Test failed/]] as const) {
      const r = connectionTestMessage({ connected: false, scope: 'remote', stage });
      expect(r.kind).toBe('err');
      expect(r.msg).toMatch(re);
    }
    expect(connectionTestMessage({ connected: false, scope: 'remote', stage: 'auth', error: 'bad pw' }).msg).toMatch(/bad pw/);
    expect(connectionTestMessage({ connected: false, scope: 'remote', stage: 'credentials', error: 'unreadable' }).msg).toBe('unreadable');
    expect(connectionTestMessage({ connected: false, scope: 'remote', stage: 'zzz', error: 'boom' }).msg).toBe('boom');
  });

  it('detects remote postgres connections', () => {
    expect(isRemotePostgresConnection({ engine: 'postgresql', host: 'db.example' })).toBe(true);
    expect(isRemotePostgresConnection({ engine: 'postgresql', host: 'local' })).toBe(false);
    expect(isRemotePostgresConnection({ engine: 'postgresql', host: '  ' })).toBe(false);
    expect(isRemotePostgresConnection({ engine: 'sqlite', host: 'db.example' })).toBe(false);
  });
});
