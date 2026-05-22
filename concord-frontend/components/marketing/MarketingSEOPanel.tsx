'use client';

/**
 * MarketingSEOPanel — on-page SEO audit tool.
 * Wires: seo-audit, seo-audit-list, seo-audit-delete.
 */

import { useCallback, useEffect, useState } from 'react';
import { Loader2, Globe, Trash2, Check, AlertTriangle } from 'lucide-react';
import { lensRun } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface SeoCheck { label: string; pass: boolean; hint: string | null }
interface SeoAudit {
  id: string; url: string; keyword: string | null; title: string;
  titleLength: number; metaLength: number; wordCount: number;
  keywordCount: number; keywordDensity: number; headings: number;
  images: number; imagesWithAlt: number; checks: SeoCheck[];
  passed: number; total: number; score: number; grade: string; auditedAt: string;
}

const GRADE_COLOR: Record<string, string> = {
  excellent: 'text-emerald-300', good: 'text-blue-300',
  'needs work': 'text-amber-300', poor: 'text-rose-300',
};

export function MarketingSEOPanel() {
  const [audits, setAudits] = useState<SeoAudit[]>([]);
  const [avgScore, setAvgScore] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [url, setUrl] = useState('');
  const [keyword, setKeyword] = useState('');
  const [title, setTitle] = useState('');
  const [metaDescription, setMetaDescription] = useState('');
  const [bodyText, setBodyText] = useState('');
  const [headingCount, setHeadingCount] = useState('');
  const [imageCount, setImageCount] = useState('');
  const [imagesWithAlt, setImagesWithAlt] = useState('');

  const refresh = useCallback(async () => {
    setLoading(true);
    const r = await lensRun('marketing', 'seo-audit-list', {});
    setAudits(r.data?.result?.audits || []);
    setAvgScore(r.data?.result?.avgScore || 0);
    setLoading(false);
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const runAudit = async () => {
    if (!url.trim()) { setError('Page URL is required.'); return; }
    setBusy(true); setError(null);
    const r = await lensRun('marketing', 'seo-audit', {
      url: url.trim(), keyword: keyword.trim(), title: title.trim(),
      metaDescription: metaDescription.trim(), bodyText,
      headingCount: Number(headingCount) || 0,
      imageCount: Number(imageCount) || 0,
      imagesWithAlt: Number(imagesWithAlt) || 0,
    });
    setBusy(false);
    if (r.data?.ok === false) { setError(r.data?.error || 'Audit failed'); return; }
    setUrl(''); setKeyword(''); setTitle(''); setMetaDescription('');
    setBodyText(''); setHeadingCount(''); setImageCount(''); setImagesWithAlt('');
    await refresh();
  };

  const del = async (id: string) => {
    const r = await lensRun('marketing', 'seo-audit-delete', { id });
    if (r.data?.ok === false) { setError(r.data?.error || 'Failed'); return; }
    await refresh();
  };

  if (loading) {
    return <div className="flex items-center justify-center py-10 text-zinc-500"><Loader2 className="w-5 h-5 animate-spin" /></div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-xs text-rose-400 bg-rose-950/40 border border-rose-900/50 rounded-lg px-3 py-2">{error}</div>}

      <h3 className="flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
        <Globe className="w-3.5 h-3.5 text-orange-400" /> On-page SEO audit
        {audits.length > 0 && <span className="text-[10px] text-zinc-500">· avg score {avgScore}</span>}
      </h3>

      {/* Audit input form */}
      <div className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Page URL"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
          <input value={keyword} onChange={(e) => setKeyword(e.target.value)} placeholder="Target keyword"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
        </div>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Page title (<title>)"
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
        <input value={metaDescription} onChange={(e) => setMetaDescription(e.target.value)} placeholder="Meta description"
          className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
        <textarea value={bodyText} onChange={(e) => setBodyText(e.target.value)} rows={4}
          placeholder="Page body text (paste the visible content)" className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-xs text-zinc-100" />
        <div className="grid grid-cols-3 gap-2">
          <input value={headingCount} onChange={(e) => setHeadingCount(e.target.value)} inputMode="numeric" placeholder="Headings"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
          <input value={imageCount} onChange={(e) => setImageCount(e.target.value)} inputMode="numeric" placeholder="Images"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
          <input value={imagesWithAlt} onChange={(e) => setImagesWithAlt(e.target.value)} inputMode="numeric" placeholder="Images w/ alt"
            className="bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-1.5 text-xs text-zinc-100" />
        </div>
        <div className="flex justify-end">
          <button type="button" onClick={runAudit} disabled={busy}
            className={cn('text-xs font-medium rounded-lg px-3 py-1.5 text-white',
              busy ? 'bg-zinc-700' : 'bg-orange-600 hover:bg-orange-500')}>
            {busy ? 'Auditing…' : 'Run audit'}
          </button>
        </div>
      </div>

      {audits.length === 0 ? (
        <p className="text-[11px] text-zinc-500 italic">No audits yet. Run an on-page analysis above.</p>
      ) : (
        <ul className="space-y-2">
          {audits.map((a) => (
            <li key={a.id} className="bg-zinc-900/70 border border-zinc-800 rounded-xl p-3">
              <div className="flex items-center justify-between">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-zinc-100 truncate">{a.url}</p>
                  <p className="text-[11px] text-zinc-500">
                    {a.wordCount} words · {a.keyword ? `"${a.keyword}" ${a.keywordDensity}%` : 'no keyword'} · {a.passed}/{a.total} checks
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={cn('text-lg font-bold', GRADE_COLOR[a.grade] || 'text-zinc-300')}>{a.score}</span>
                  <button type="button" onClick={() => del(a.id)} aria-label="Delete audit"
                    className="text-rose-400 hover:text-rose-300 p-1"><Trash2 className="w-3.5 h-3.5" /></button>
                </div>
              </div>
              <ul className="mt-2 space-y-1">
                {a.checks.map((c) => (
                  <li key={c.label} className="flex items-start gap-1.5 text-[11px]">
                    {c.pass
                      ? <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-px" />
                      : <AlertTriangle className="w-3.5 h-3.5 text-amber-400 shrink-0 mt-px" />}
                    <span className={c.pass ? 'text-zinc-400' : 'text-zinc-300'}>
                      {c.label}{!c.pass && c.hint ? ` — ${c.hint}` : ''}
                    </span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
