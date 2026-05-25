'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import type { CQIssue } from './types';
import { CQ_SEVERITY_STYLE } from './types';

const STATUSES = ['open', 'in-progress', 'resolved', 'wont-fix', 'false-positive'];

const STATUS_STYLE: Record<string, string> = {
  open: 'text-blue-300 bg-blue-300/10',
  'in-progress': 'text-yellow-400 bg-yellow-400/10',
  resolved: 'text-emerald-400 bg-emerald-400/10',
  'wont-fix': 'text-gray-400 bg-gray-400/10',
  'false-positive': 'text-purple-400 bg-purple-400/10',
};

export function IssueWorkflow({ refreshKey }: { refreshKey: number }) {
  const [issues, setIssues] = useState<CQIssue[]>([]);
  const [byStatus, setByStatus] = useState<Record<string, number>>({});
  const [statusFilter, setStatusFilter] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    const r = await lensRun<{ issues: CQIssue[]; byStatus: Record<string, number> }>(
      'code-quality',
      'listIssues',
      statusFilter ? { status: statusFilter } : {},
    );
    if (r.data.ok && r.data.result) {
      setIssues(r.data.result.issues);
      setByStatus(r.data.result.byStatus || {});
    } else {
      setError(r.data.error || 'listIssues failed');
    }
    setBusy(false);
  }, [statusFilter]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  async function update(id: string, patch: Record<string, unknown>) {
    const r = await lensRun<{ issue: CQIssue }>('code-quality', 'updateIssue', {
      id,
      ...patch,
    });
    if (r.data.ok) load();
    else setError(r.data.error || 'updateIssue failed');
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setStatusFilter('')}
          className={`px-2 py-0.5 rounded text-xs border ${
            statusFilter === '' ? 'border-neon-blue text-neon-blue' : 'border-gray-700 text-gray-400'
          }`}
        >
          all ({Object.values(byStatus).reduce((a, b) => a + b, 0)})
        </button>
        {STATUSES.map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-2 py-0.5 rounded text-xs border ${
              statusFilter === s ? 'border-neon-blue text-neon-blue' : 'border-gray-700 text-gray-400'
            }`}
          >
            {s} ({byStatus[s] || 0})
          </button>
        ))}
        {error && <span className="text-sm text-red-400">{error}</span>}
      </div>

      {busy && !issues.length ? (
        <p className="text-sm text-gray-400">Loading issues…</p>
      ) : issues.length === 0 ? (
        <p className="text-sm text-gray-400">
          No tracked issues. Track findings from the Annotations tab to build a workflow.
        </p>
      ) : (
        <div className="space-y-2">
          {issues.map((iss) => (
            <div key={iss.id} className="rounded border border-gray-800 bg-black/30 p-2.5">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span
                  className={`font-mono uppercase px-1.5 rounded border ${CQ_SEVERITY_STYLE[iss.severity]}`}
                >
                  {iss.severity}
                </span>
                <span className="font-mono text-gray-300">{iss.rule}</span>
                {iss.file && (
                  <span className="font-mono text-gray-400">
                    {iss.file}
                    {iss.line != null ? `:${iss.line}` : ''}
                  </span>
                )}
                <span
                  className={`ml-auto font-mono px-1.5 rounded ${STATUS_STYLE[iss.status] || 'text-gray-400 bg-gray-400/10'}`}
                >
                  {iss.status}
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-100">{iss.message}</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={iss.status}
                  onChange={(e) => update(iss.id, { status: e.target.value })}
                  className="bg-black/40 border border-gray-700 rounded px-1.5 py-0.5 text-xs"
                >
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <input
                  type="text"
                  defaultValue={iss.assignee || ''}
                  placeholder="assignee"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      update(iss.id, { assignee: (e.target as HTMLInputElement).value });
                    }
                  }}
                  className="bg-black/40 border border-gray-700 rounded px-1.5 py-0.5 text-xs w-32"
                />
                <span className="text-[11px] text-gray-400">
                  {iss.assignee ? `→ ${iss.assignee}` : 'unassigned'} · enter to save
                </span>
              </div>
              {iss.history.length > 1 && (
                <details className="mt-1.5">
                  <summary className="text-[11px] text-gray-400 cursor-pointer">
                    history ({iss.history.length})
                  </summary>
                  <ul className="mt-1 space-y-0.5 text-[11px] text-gray-400">
                    {iss.history.map((h, i) => (
                      <li key={i} className="font-mono">
                        {h.at.slice(0, 19).replace('T', ' ')} — {h.action}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
