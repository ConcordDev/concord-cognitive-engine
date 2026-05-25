'use client';

import { useEffect, useState } from 'react';
import { lensRun } from '@/lib/api/client';
import type { CQAnnotatedFile, CQIssue, CQScan } from './types';
import { CQ_SEVERITY_STYLE } from './types';

export function AnnotatedSource({
  scan,
  onIssueTracked,
}: {
  scan: CQScan | null;
  onIssueTracked: () => void;
}) {
  const [files, setFiles] = useState<CQAnnotatedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tracking, setTracking] = useState<string | null>(null);

  useEffect(() => {
    if (!scan) {
      setFiles([]);
      return;
    }
    let cancelled = false;
    setBusy(true);
    setError(null);
    lensRun<{ files: CQAnnotatedFile[] }>('code-quality', 'annotate', { scanId: scan.scanId })
      .then((r) => {
        if (cancelled) return;
        if (r.data.ok && r.data.result) setFiles(r.data.result.files);
        else setError(r.data.error || 'annotate failed');
      })
      .finally(() => {
        if (!cancelled) setBusy(false);
      });
    return () => {
      cancelled = true;
    };
  }, [scan]);

  async function track(
    file: string,
    line: number,
    issue: CQAnnotatedFile['annotations'][number]['issues'][number],
  ) {
    const key = `${file}:${line}:${issue.rule}`;
    setTracking(key);
    try {
      const r = await lensRun<{ issue: CQIssue }>('code-quality', 'trackIssue', {
        rule: issue.rule,
        severity: issue.severity,
        message: issue.message,
        file,
        line,
        scanId: scan?.scanId,
      });
      if (r.data.ok) onIssueTracked();
      else setError(r.data.error || 'trackIssue failed');
    } finally {
      setTracking(null);
    }
  }

  if (!scan) {
    return <p className="text-sm text-gray-400">Analyze a file to see per-line annotations.</p>;
  }
  if (busy) return <p className="text-sm text-gray-400">Loading annotations…</p>;
  if (error) return <p className="text-sm text-red-400">{error}</p>;

  return (
    <div className="space-y-4">
      {files.map((f) => (
        <div key={f.file} className="rounded border border-gray-800">
          <div className="flex items-center justify-between border-b border-gray-800 px-3 py-1.5 bg-black/40">
            <span className="font-mono text-sm text-gray-200">{f.file}</span>
            <span className="text-xs text-gray-400">
              {f.annotationCount} annotated line{f.annotationCount === 1 ? '' : 's'} · {f.totalLines} lines
            </span>
          </div>
          {f.annotations.length === 0 ? (
            <p className="px-3 py-3 text-sm text-emerald-400">No issues — clean file.</p>
          ) : (
            <div className="divide-y divide-gray-900">
              {f.annotations.map((a) => (
                <div key={a.line} className="px-3 py-2">
                  <div className="flex items-start gap-3">
                    <span className="font-mono text-xs text-gray-400 mt-0.5 w-10 shrink-0 text-right">
                      L{a.line}
                    </span>
                    <pre className="font-mono text-xs text-gray-400 overflow-x-auto flex-1 whitespace-pre-wrap break-all">
                      {a.context || '(empty)'}
                    </pre>
                  </div>
                  <div className="mt-1.5 ml-13 space-y-1.5">
                    {a.issues.map((iss, idx) => {
                      const key = `${f.file}:${a.line}:${iss.rule}`;
                      return (
                        <div
                          key={`${iss.rule}-${idx}`}
                          className={`rounded border px-2 py-1.5 ${CQ_SEVERITY_STYLE[iss.severity]}`}
                        >
                          <div className="flex flex-wrap items-center gap-2 text-xs">
                            <span className="font-mono uppercase tracking-wider">{iss.severity}</span>
                            <span className="font-mono text-gray-300">{iss.rule}</span>
                            <span className="font-mono text-gray-400">col {iss.column}</span>
                            <button
                              onClick={() => track(f.file, a.line, iss)}
                              disabled={tracking === key}
                              className="ml-auto px-2 py-0.5 rounded border border-gray-600 text-gray-300 hover:border-gray-400 text-[11px] disabled:opacity-50"
                            >
                              {tracking === key ? 'Tracking…' : 'Track issue'}
                            </button>
                          </div>
                          <p className="mt-1 text-sm text-gray-100">{iss.message}</p>
                          {iss.fixHint && (
                            <p className="mt-0.5 text-xs text-emerald-400">fix: {iss.fixHint}</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
