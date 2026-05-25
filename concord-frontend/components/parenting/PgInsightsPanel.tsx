'use client';

/**
 * PgInsightsPanel — weekly feed/sleep/diaper trends with anomaly flags,
 * plus age-targeted expert developmental content for the child.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  ResponsiveContainer, Bar, Line, ComposedChart, XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';
import { Loader2, TrendingUp, TrendingDown, Minus, AlertTriangle, Info, BookOpen, Sparkles } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface DailyPoint { date: string; feeds: number; sleepMin: number; diapers: number }
interface Anomaly { severity: string; metric: string; text: string }
interface Trends {
  days: number;
  daily: DailyPoint[];
  averages: { feedsPerDay: number; sleepMinPerDay: number; diapersPerDay: number };
  sleepTrend: 'improving' | 'declining' | 'steady';
  anomalies: Anomaly[];
  daysWithData: number;
  note: string | null;
}
interface Article { id: string; text: string }
interface Expert {
  childName: string;
  ageMonths: number;
  topic: string;
  ageRange: string;
  articles: Article[];
  comingNext: { topic: string; atMonths: number } | null;
  note: string;
}

const TREND_ICON = { improving: TrendingUp, declining: TrendingDown, steady: Minus };
const TREND_COLOR = { improving: 'text-emerald-400', declining: 'text-rose-400', steady: 'text-zinc-400' };

export function PgInsightsPanel({ childId }: { childId: string }) {
  const [trends, setTrends] = useState<Trends | null>(null);
  const [expert, setExpert] = useState<Expert | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [t, e] = await Promise.all([
      lensRun('parenting', 'trends-insights', { childId, days: 7 }),
      lensRun('parenting', 'expert-content', { childId }),
    ]);
    setTrends(t.data?.ok === false ? null : (t.data?.result as Trends));
    setExpert(e.data?.ok === false ? null : (e.data?.result as Expert));
    setLoading(false);
  }, [childId]);

  useEffect(() => { void refresh(); }, [refresh]);

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-400"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  const chartData = (trends?.daily || []).map((d) => ({
    date: d.date.slice(5),
    feeds: d.feeds,
    sleepHrs: Math.round((d.sleepMin / 60) * 10) / 10,
    diapers: d.diapers,
  }));

  return (
    <div className="space-y-4">
      {/* Trends */}
      <section>
        <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
          <TrendingUp className="w-3.5 h-3.5 text-rose-400" /> Weekly trends
        </h3>
        {trends && trends.daysWithData > 0 ? (
          <>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <Stat label="Feeds/day" value={trends.averages.feedsPerDay} />
              <Stat label="Sleep/day" value={`${Math.round((trends.averages.sleepMinPerDay / 60) * 10) / 10}h`} />
              <Stat label="Diapers/day" value={trends.averages.diapersPerDay} />
            </div>
            {(() => {
              const Icon = TREND_ICON[trends.sleepTrend];
              return (
                <p className={`flex items-center gap-1 text-[11px] mb-2 ${TREND_COLOR[trends.sleepTrend]}`}>
                  <Icon className="w-3.5 h-3.5" /> Sleep trend: {trends.sleepTrend}
                </p>
              );
            })()}
            <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <ResponsiveContainer width="100%" height={170}>
                <ComposedChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#27272a" />
                  <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#71717a' }} />
                  <YAxis yAxisId="l" tick={{ fontSize: 9, fill: '#71717a' }} width={26} />
                  <YAxis yAxisId="r" orientation="right" tick={{ fontSize: 9, fill: '#71717a' }} width={26} />
                  <Tooltip contentStyle={{ background: '#18181b', border: '1px solid #3f3f46', borderRadius: 8, fontSize: 11 }} />
                  <Bar yAxisId="l" dataKey="feeds" name="Feeds" fill="#38bdf8" radius={[2, 2, 0, 0]} />
                  <Bar yAxisId="l" dataKey="diapers" name="Diapers" fill="#fbbf24" radius={[2, 2, 0, 0]} />
                  <Line yAxisId="r" type="monotone" dataKey="sleepHrs" name="Sleep (h)" stroke="#818cf8" strokeWidth={2} dot={{ r: 2 }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-zinc-400 italic py-4 text-center">
            {trends?.note || 'Log feeds, sleep and diapers for a few days to see trends.'}
          </p>
        )}
      </section>

      {/* Anomalies */}
      {trends && trends.anomalies.length > 0 && (
        <section className="space-y-1.5">
          <h3 className="text-xs font-semibold text-zinc-300">Flagged this week</h3>
          {trends.anomalies.map((a, i) => (
            <div key={i} className={`flex items-start gap-2 rounded-lg border px-3 py-2 ${a.severity === 'watch'
              ? 'border-amber-900/50 bg-amber-950/30' : 'border-zinc-800 bg-zinc-900/70'}`}>
              {a.severity === 'watch'
                ? <AlertTriangle className="w-3.5 h-3.5 text-amber-400 mt-0.5 shrink-0" />
                : <Info className="w-3.5 h-3.5 text-zinc-400 mt-0.5 shrink-0" />}
              <span className="text-[11px] text-zinc-300">{a.text}</span>
            </div>
          ))}
        </section>
      )}

      {/* Expert content */}
      {expert && (
        <section>
          <h3 className="flex items-center gap-1 text-xs font-semibold text-zinc-300 mb-2">
            <BookOpen className="w-3.5 h-3.5 text-rose-400" /> For {expert.childName} · {expert.topic}
          </h3>
          <p className="text-[10px] text-zinc-400 mb-2">Age-targeted developmental guidance ({expert.ageRange}).</p>
          <ul className="space-y-1.5">
            {expert.articles.map((a) => (
              <li key={a.id} className="flex items-start gap-2 bg-zinc-900/70 border border-zinc-800 rounded-lg px-3 py-2">
                <Sparkles className="w-3.5 h-3.5 text-rose-400 mt-0.5 shrink-0" />
                <span className="text-[11px] text-zinc-300">{a.text}</span>
              </li>
            ))}
          </ul>
          {expert.comingNext && (
            <p className="text-[10px] text-zinc-400 mt-2">
              Coming up: <span className="text-zinc-300">{expert.comingNext.topic}</span> around {expert.comingNext.atMonths} months.
            </p>
          )}
          <p className="text-[10px] text-zinc-400 mt-1">{expert.note}</p>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-2.5 text-center">
      <p className="text-base font-bold text-zinc-100">{value}</p>
      <p className="text-[10px] text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}
