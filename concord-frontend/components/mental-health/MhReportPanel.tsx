'use client';

/**
 * MhReportPanel — compiles a shareable self-tracking summary (mood, sleep,
 * mindfulness, worksheets, gratitude) over a chosen window and lets the
 * user download it as text or CSV for a care provider.
 */

import { useCallback, useState } from 'react';
import { Loader2, FileText, Download } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface ReportSummary {
  periodDays: number; from: string; to: string;
  moodEntries: number; avgMood: number | null; lowestMood: number | null; highestMood: number | null;
  sleepNights: number; avgSleepHours: number | null;
  mindfulnessSessions: number; mindfulnessMinutes: number;
  worksheetsCompleted: number; gratitudeEntries: number;
}
interface ReportResult { summary: ReportSummary; csv: string; text: string }

const RANGES = [7, 30, 90] as const;

export function MhReportPanel() {
  const [days, setDays] = useState<typeof RANGES[number]>(30);
  const [report, setReport] = useState<ReportResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = useCallback(async () => {
    setLoading(true);
    setError(null);
    const r = await lensRun('mental-health', 'therapist-report', { days });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); setLoading(false); return; }
    setReport((r.data?.result as ReportResult | null) || null);
    setLoading(false);
  }, [days]);

  const download = (content: string, ext: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mental-health-report-${new Date().toISOString().slice(0, 10)}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = report?.summary;

  return (
    <div className="space-y-3">
      <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300">
        <FileText className="w-3.5 h-3.5 text-sky-400" /> Report for a care provider
      </h3>

      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 flex items-center gap-2">
        <span className="text-[11px] text-zinc-400">Period</span>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r} type="button" onClick={() => setDays(r)}
              className={r === days
                ? 'px-2.5 py-1 text-[11px] rounded-lg bg-sky-600 text-white'
                : 'px-2.5 py-1 text-[11px] rounded-lg bg-zinc-800 text-zinc-300 hover:bg-zinc-700'}>
              {r}d
            </button>
          ))}
        </div>
        <button type="button" onClick={generate} disabled={loading}
          className="ml-auto px-3 py-1 text-xs bg-sky-600 hover:bg-sky-500 disabled:opacity-40 text-white rounded-lg">
          {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Generate'}
        </button>
      </div>

      {s && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {[
              { label: 'Mood entries', value: s.moodEntries },
              { label: 'Avg mood', value: s.avgMood ?? '—' },
              { label: 'Mood range', value: s.lowestMood != null ? `${s.lowestMood}–${s.highestMood}` : '—' },
              { label: 'Sleep nights', value: s.sleepNights },
              { label: 'Avg sleep', value: s.avgSleepHours != null ? `${s.avgSleepHours}h` : '—' },
              { label: 'Mindful min', value: s.mindfulnessMinutes },
              { label: 'Worksheets', value: s.worksheetsCompleted },
              { label: 'Gratitude', value: s.gratitudeEntries },
            ].map((c) => (
              <div key={c.label} className="bg-zinc-900/70 border border-zinc-800 rounded-lg p-2 text-center">
                <p className="text-base font-bold text-zinc-100">{c.value}</p>
                <p className="text-[10px] text-zinc-400 uppercase">{c.label}</p>
              </div>
            ))}
          </div>

          <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
            <p className="text-[10px] text-zinc-400 uppercase mb-1">Report preview · {s.from} → {s.to}</p>
            <pre className="whitespace-pre-wrap font-sans text-[11px] text-zinc-300 leading-relaxed max-h-48 overflow-y-auto">
              {report.text}
            </pre>
          </div>

          <div className="flex gap-2">
            <button type="button" onClick={() => download(report.text, 'txt', 'text/plain')}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
              <Download className="w-3.5 h-3.5" /> Text
            </button>
            <button type="button" onClick={() => download(report.csv, 'csv', 'text/csv')}
              className="flex items-center gap-1 px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-200 rounded-lg">
              <Download className="w-3.5 h-3.5" /> Mood CSV
            </button>
          </div>
          <p className="text-[10px] text-zinc-400 italic">
            Self-reported tracking data, not a clinical assessment. Share only with people you trust.
          </p>
        </>
      )}

      {!s && !loading && (
        <p className="text-[11px] text-zinc-400 italic py-4 text-center">
          Generate a report to summarize your tracking for a therapist or doctor.
        </p>
      )}
    </div>
  );
}
