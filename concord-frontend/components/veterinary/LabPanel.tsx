'use client';

import { useCallback, useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import { FlaskConical, Plus, Loader2, Trash2, ExternalLink, AlertTriangle } from 'lucide-react';
import { VetLabResult, LAB_KINDS, LAB_FLAGS } from './vet-types';

const FLAG_COLOR: Record<string, string> = {
  normal: 'text-green-400 bg-green-400/10',
  abnormal: 'text-yellow-400 bg-yellow-400/10',
  critical: 'text-red-400 bg-red-400/10',
  pending: 'text-blue-400 bg-blue-400/10',
};

export function LabPanel() {
  const [results, setResults] = useState<VetLabResult[]>([]);
  const [abnormal, setAbnormal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [patientName, setPatientName] = useState('');
  const [kind, setKind] = useState('bloodwork');
  const [title, setTitle] = useState('');
  const [findings, setFindings] = useState('');
  const [attachmentUrl, setAttachmentUrl] = useState('');
  const [flag, setFlag] = useState('pending');
  const [date, setDate] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('veterinary', 'lab-list', {});
    if (r.data.ok && r.data.result) {
      const res = r.data.result as { results: VetLabResult[]; abnormal: number };
      setResults(res.results || []);
      setAbnormal(res.abnormal || 0);
      setError(null);
    } else {
      setError(r.data.error || 'failed to load lab results');
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const attach = async () => {
    if (!patientName.trim()) return;
    setBusy(true);
    const r = await lensRun('veterinary', 'lab-attach', {
      patientName,
      kind,
      title,
      findings,
      attachmentUrl,
      flag,
      date,
    });
    setBusy(false);
    if (r.data.ok) {
      setPatientName('');
      setTitle('');
      setFindings('');
      setAttachmentUrl('');
      setFlag('pending');
      setDate('');
      await load();
    } else {
      setError(r.data.error || 'failed to attach result');
    }
  };

  const del = async (id: string) => {
    await lensRun('veterinary', 'lab-delete', { id });
    await load();
  };

  return (
    <div className="space-y-4">
      {abnormal > 0 && (
        <div className="flex items-center gap-2 rounded border border-yellow-500/30 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-300">
          <AlertTriangle className="h-4 w-4" /> {abnormal} abnormal/critical result
          {abnormal > 1 ? 's' : ''} need review.
        </div>
      )}

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-3 space-y-2">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          <input
            value={patientName}
            onChange={(e) => setPatientName(e.target.value)}
            placeholder="Patient name *"
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
          />
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
          >
            {LAB_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
          <select
            value={flag}
            onChange={(e) => setFlag(e.target.value)}
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
          >
            {LAB_FLAGS.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Result title"
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={date}
            onChange={(e) => setDate(e.target.value)}
            type="date"
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
          />
          <input
            value={attachmentUrl}
            onChange={(e) => setAttachmentUrl(e.target.value)}
            placeholder="Attachment URL"
            className="rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
          />
        </div>
        <textarea
          value={findings}
          onChange={(e) => setFindings(e.target.value)}
          placeholder="Findings / interpretation"
          rows={2}
          className="w-full rounded border border-zinc-800 bg-zinc-900 px-2 py-1.5 text-sm text-white"
        />
        <button
          onClick={attach}
          disabled={busy || !patientName.trim()}
          className="flex w-full items-center justify-center gap-2 rounded bg-cyan-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Attach lab/imaging result
        </button>
      </div>

      {error && (
        <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading results…
        </div>
      ) : results.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-800 py-8 text-center text-sm text-zinc-400">
          <FlaskConical className="mx-auto mb-2 h-8 w-8 opacity-30" />
          No lab/imaging results attached.
        </div>
      ) : (
        <div className="space-y-2">
          {results.map((r) => (
            <div key={r.id} className="rounded-lg border border-zinc-800 bg-zinc-900 p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold text-white">
                    {r.title}{' '}
                    <span
                      className={`ml-1 rounded px-1.5 py-0.5 text-[10px] ${FLAG_COLOR[r.flag] || ''}`}
                    >
                      {r.flag}
                    </span>
                  </p>
                  <p className="text-xs text-zinc-400">
                    {r.patientName} · {r.kind} · {r.date}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {r.attachmentUrl && (
                    <a
                      href={r.attachmentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-cyan-400"
                      aria-label="Open attachment"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                  <button
                    onClick={() => del(r.id)}
                    aria-label="Delete result"
                    className="rounded p-1 text-zinc-400 hover:bg-zinc-800 hover:text-red-400"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {r.findings && <p className="mt-1 text-xs text-zinc-300">{r.findings}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
