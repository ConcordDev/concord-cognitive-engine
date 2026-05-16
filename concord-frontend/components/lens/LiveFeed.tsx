'use client';

// LiveFeed — large polished "wire service" rendering of any realtime
// RSS feed payload. Mounted in the 11 RSS-domain lenses (legal /
// government / realestate / aviation / insurance / manufacturing /
// logistics / retail / fitness / agriculture / education) plus
// reusable for the news lens main grid.
//
// Why a shared component: the canonical real-world UI for all of
// these is the same shape — a tight list of headlines + source + age,
// click-through to the original. (Real apps differ in accent color,
// hero treatment, and what side widgets accompany the feed, not in
// the fundamental list shape.) One component covers the floor; per-
// lens main pages can hero-mount individual articles for richer
// treatments.
//
// The component is domain-aware: the accent color, "Live Wire" label,
// and empty-state copy adapt per domain.

import { ExternalLink, Clock, Wifi, WifiOff } from 'lucide-react';

export interface LiveFeedArticle {
  source: string;
  title: string;
  link?: string;
  pubDate?: string;
  summary?: string;
  imageUrl?: string | null;
}

interface LiveFeedProps {
  articles: LiveFeedArticle[] | null | undefined;
  domain: string;
  isLive?: boolean;
  lastUpdated?: string | null;
  limit?: number;
  heroFirst?: boolean;
  className?: string;
}

// Per-domain accent + label + empty-state copy. Stays close to the
// canonical real-world tone for each surface.
const DOMAIN_META: Record<string, { accent: string; label: string; emptyTip: string }> = {
  legal:         { accent: 'border-amber-400/30 text-amber-300',     label: 'Court Wire',           emptyTip: 'CourtListener + Federal Register feeds connecting…' },
  government:    { accent: 'border-blue-400/30 text-blue-300',       label: 'Federal Register',     emptyTip: 'Federal Register + House Clerk feeds connecting…' },
  realestate:    { accent: 'border-emerald-400/30 text-emerald-300', label: 'Housing Wire',         emptyTip: 'HUD + Realtor.com Research feeds connecting…' },
  aviation:      { accent: 'border-sky-400/30 text-sky-300',         label: 'Aviation Safety Wire', emptyTip: 'NTSB + FAA + ASN feeds connecting…' },
  insurance:     { accent: 'border-violet-400/30 text-violet-300',   label: 'Insurance Wire',       emptyTip: 'Treasury FIO + NAIC feeds connecting…' },
  manufacturing: { accent: 'border-orange-400/30 text-orange-300',   label: 'Industry Wire',        emptyTip: 'BLS PPI + Federal Reserve G.17 feeds connecting…' },
  logistics:     { accent: 'border-teal-400/30 text-teal-300',       label: 'Transit Wire',         emptyTip: 'BTS + DOT feeds connecting…' },
  retail:        { accent: 'border-pink-400/30 text-pink-300',       label: 'Retail Wire',          emptyTip: 'BLS CPI + Census Retail feeds connecting…' },
  fitness:       { accent: 'border-lime-400/30 text-lime-300',       label: 'Health & Fitness',     emptyTip: 'CDC + MMWR feeds connecting…' },
  agriculture:   { accent: 'border-green-400/30 text-green-300',     label: 'Ag Wire',              emptyTip: 'USDA AMS + USDA Press feeds connecting…' },
  education:     { accent: 'border-indigo-400/30 text-indigo-300',   label: 'Education Wire',       emptyTip: 'Department of Education + NCES feeds connecting…' },
  news:          { accent: 'border-neon-cyan/30 text-neon-cyan',     label: 'Breaking News',        emptyTip: 'Reuters / BBC / NPR feeds connecting…' },
};

// Shape adapter — callers can pass arxiv papers (category/id/published)
// or WHO health alerts (title/link/pubDate) without mapping manually.
// Returns a normalized LiveFeedArticle[] for the component to render.
export function adaptToLiveFeedArticles(input: Record<string, unknown> | null | undefined): LiveFeedArticle[] {
  if (!input) return [];
  if (Array.isArray((input as { articles?: unknown }).articles)) {
    return (input as { articles: LiveFeedArticle[] }).articles;
  }
  if (Array.isArray((input as { papers?: unknown }).papers)) {
    const papers = (input as { papers: Array<{ title: string; summary?: string; category?: string; id?: string; published?: string }> }).papers;
    return papers.map(p => ({
      source: p.category || 'arXiv',
      title: p.title,
      link: p.id,
      pubDate: p.published,
      summary: p.summary,
    }));
  }
  if (Array.isArray((input as { alerts?: unknown }).alerts)) {
    const alerts = (input as { alerts: Array<{ title: string; link?: string; pubDate?: string }> }).alerts;
    return alerts.map(a => ({
      source: 'WHO',
      title: a.title,
      link: a.link,
      pubDate: a.pubDate,
    }));
  }
  return [];
}

function relTime(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 20);
  const ms = Date.now() - d.getTime();
  if (ms < 60_000)      return 'just now';
  if (ms < 3_600_000)   return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000)  return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 604_800_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return d.toLocaleDateString();
}

export default function LiveFeed({
  articles,
  domain,
  isLive = false,
  lastUpdated = null,
  limit = 12,
  heroFirst = true,
  className = '',
}: LiveFeedProps) {
  const meta = DOMAIN_META[domain] || { accent: 'border-zinc-400/30 text-zinc-300', label: 'Live Wire', emptyTip: 'Realtime feed connecting…' };
  const list = (articles || []).slice(0, limit);
  const hero = heroFirst ? list[0] : null;
  const rest = heroFirst ? list.slice(1) : list;

  return (
    <section className={`rounded-xl border border-white/10 bg-zinc-900/40 backdrop-blur-sm overflow-hidden ${className}`}>
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-gradient-to-r from-zinc-900/60 to-zinc-900/20">
        <div className="flex items-center gap-2">
          <span className={`text-xs font-bold uppercase tracking-wider ${meta.accent.split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>{meta.label}</span>
          {isLive ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-green-400">
              <Wifi className="w-3 h-3 animate-pulse" />
              <span>live</span>
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-zinc-500">
              <WifiOff className="w-3 h-3" />
              <span>offline</span>
            </span>
          )}
        </div>
        {lastUpdated && (
          <span className="text-[10px] text-zinc-500 inline-flex items-center gap-1">
            <Clock className="w-3 h-3" />
            {relTime(lastUpdated)}
          </span>
        )}
      </header>

      {list.length === 0 ? (
        <div className="px-4 py-8 text-center text-xs text-zinc-500">{meta.emptyTip}</div>
      ) : (
        <div className="divide-y divide-white/5">
          {hero && (
            <article className={`p-4 hover:bg-white/[0.02] transition-colors ${meta.accent.split(' ').filter(c => c.startsWith('border-')).join(' ')}`}>
              <div className="flex items-start gap-3">
                {hero.imageUrl && (
                  <div className="shrink-0 w-20 h-20 rounded-md overflow-hidden bg-zinc-800">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={hero.imageUrl} alt="" className="w-full h-full object-cover" loading="lazy" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className={`text-[10px] uppercase tracking-wider mb-1 ${meta.accent.split(' ').filter(c => c.startsWith('text-')).join(' ')}`}>
                    Top story · {hero.source}
                  </div>
                  {hero.link ? (
                    <a href={hero.link} target="_blank" rel="noopener noreferrer" className="block text-base font-semibold text-zinc-100 hover:underline">
                      {hero.title}
                      <ExternalLink className="inline w-3 h-3 ml-1 opacity-50" />
                    </a>
                  ) : (
                    <h2 className="text-base font-semibold text-zinc-100">{hero.title}</h2>
                  )}
                  {hero.summary && (
                    <p className="mt-1.5 text-xs text-zinc-400 line-clamp-2">{hero.summary}</p>
                  )}
                  <div className="mt-1.5 text-[10px] text-zinc-500">{relTime(hero.pubDate)}</div>
                </div>
              </div>
            </article>
          )}

          {rest.map((a, i) => (
            <article key={i} className="px-4 py-3 hover:bg-white/[0.02] transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  {a.link ? (
                    <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-sm text-zinc-200 hover:text-white hover:underline">
                      {a.title}
                    </a>
                  ) : (
                    <span className="text-sm text-zinc-200">{a.title}</span>
                  )}
                  <div className="mt-0.5 text-[10px] text-zinc-500">
                    {a.source}{a.pubDate ? ` · ${relTime(a.pubDate)}` : ''}
                  </div>
                </div>
                {a.link && (
                  <a href={a.link} target="_blank" rel="noopener noreferrer" className="shrink-0 text-zinc-500 hover:text-zinc-300" aria-label="Open">
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
