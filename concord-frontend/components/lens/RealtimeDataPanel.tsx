'use client';

// React import (hooks used by consumers)

interface RealtimeDataPanelProps {
  domain?: string;
  data: Array<{ domain: string; insight: string; confidence: number; timestamp: string }> | Record<string, unknown> | null;
  isLive?: boolean;
  lastUpdated?: string | null;
  insights?: Array<{ insight: string; confidence: number; timestamp: string }>;
  compact?: boolean;
}

export function RealtimeDataPanel({
  domain = 'general',
  data,
  isLive = false,
  lastUpdated = null,
  insights,
  compact,
}: RealtimeDataPanelProps) {
  // When data is an array of insight objects, render them directly
  if (Array.isArray(data)) {
    if (data.length === 0) {
      return (
        <div className="p-3 rounded-lg bg-zinc-800/50 text-xs text-zinc-500">
          No realtime insights yet
        </div>
      );
    }
    return (
      <div className="rounded-lg bg-zinc-800/50 overflow-hidden">
        <div className="px-3 py-2 bg-zinc-700/50 flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-300">Realtime Insights</span>
          {lastUpdated && (
            <span className="text-[10px] text-zinc-500">
              {new Date(lastUpdated).toLocaleTimeString()}
            </span>
          )}
        </div>
        <div className="p-3 space-y-1 text-xs">
          {data.slice(-5).map((item, idx) => (
            <div key={idx} className="flex items-center justify-between">
              <span className="text-zinc-400 truncate flex-1">{item.insight}</span>
              <span className="text-zinc-600 ml-2 shrink-0">
                {item.domain} · {(item.confidence * 100).toFixed(0)}%
              </span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!data && !insights?.length) {
    return (
      <div className="p-3 rounded-lg bg-zinc-800/50 text-xs text-zinc-500">
        {isLive
          ? `Waiting for ${domain} data...`
          : 'Connect to receive real-time updates'}
      </div>
    );
  }

  if (compact) {
    return (
      <div className="p-2 rounded bg-zinc-800/50 text-xs space-y-1">
        {data && renderCompactData(domain, data)}
        {insights && insights.length > 0 && (
          <div className="text-amber-400/80 truncate">
            Insight: {insights[insights.length - 1].insight}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-zinc-800/50 overflow-hidden">
      <div className="px-3 py-2 bg-zinc-700/50 flex items-center justify-between">
        <span className="text-xs font-medium text-zinc-300">
          Live {domain} Data
        </span>
        {lastUpdated && (
          <span className="text-[10px] text-zinc-500">
            {new Date(lastUpdated).toLocaleTimeString()}
          </span>
        )}
      </div>
      <div className="p-3 space-y-2 text-xs">
        {data && renderDetailedData(domain, data)}
        {insights && insights.length > 0 && (
          <div className="mt-2 pt-2 border-t border-zinc-700">
            <div className="text-[10px] text-zinc-500 mb-1">AI Insights</div>
            {insights.slice(-3).map((i, idx) => (
              <div key={idx} className="text-amber-400/80 text-[11px] mb-1">
                {i.insight} <span className="text-zinc-600">({(i.confidence * 100).toFixed(0)}%)</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function renderCompactData(domain: string, data: Record<string, unknown>) {
  if (domain === 'finance' || domain === 'trades' || domain === 'market') {
    const quotes = data.quotes as Array<{ symbol: string; price: number; changePercent: string }> | undefined;
    if (quotes) {
      return (
        <div className="flex gap-2 flex-wrap">
          {quotes.slice(0, 3).map(q => (
            <span key={q.symbol} className="text-zinc-300">
              {q.symbol.replace('^', '')}:{' '}
              <span className={Number(q.changePercent) >= 0 ? 'text-green-400' : 'text-red-400'}>
                {Number(q.changePercent) >= 0 ? '+' : ''}{q.changePercent}%
              </span>
            </span>
          ))}
        </div>
      );
    }
  }

  if (domain === 'crypto') {
    const coins = data.coins as Array<{ id: string; price: number; change24h: string }> | undefined;
    if (coins) {
      return (
        <div className="flex gap-2 flex-wrap">
          {coins.slice(0, 3).map(c => (
            <span key={c.id} className="text-zinc-300">
              {c.id}: ${c.price?.toLocaleString()}{' '}
              <span className={Number(c.change24h) >= 0 ? 'text-green-400' : 'text-red-400'}>
                {Number(c.change24h) >= 0 ? '+' : ''}{c.change24h}%
              </span>
            </span>
          ))}
        </div>
      );
    }
  }

  if (domain === 'news') {
    const articles = data.articles as Array<{ title: string; source: string }> | undefined;
    if (articles) {
      return <div className="text-zinc-400 truncate">{articles[0]?.title}</div>;
    }
  }

  // RSS-article compact form for the 11 new domains.
  const COMPACT_RSS = new Set([
    'legal', 'government', 'realestate', 'aviation', 'insurance',
    'manufacturing', 'logistics', 'retail', 'fitness', 'agriculture',
    'education',
  ]);
  if (COMPACT_RSS.has(domain)) {
    const articles = data.articles as Array<{ title: string; source?: string }> | undefined;
    if (articles && articles.length > 0) {
      return (
        <div className="text-zinc-400">
          <div className="truncate">{articles[0]?.title}</div>
          <div className="text-zinc-600 text-[10px] truncate">{articles[0]?.source}</div>
        </div>
      );
    }
  }

  if (domain === 'weather' || domain === 'environment' || domain === 'eco') {
    const current = data.current as Record<string, unknown> | undefined;
    if (current) {
      return (
        <span className="text-zinc-300">
          {String(current.temperature_2m || '?')}°C, wind {String(current.wind_speed_10m || '?')} km/h
        </span>
      );
    }
  }

  return <span className="text-zinc-500">Data available</span>;
}

function renderDetailedData(domain: string, data: Record<string, unknown>) {
  if (domain === 'finance' || domain === 'trades' || domain === 'market') {
    const quotes = data.quotes as Array<{ symbol: string; price: number; change: number; changePercent: string; exchange: string }> | undefined;
    if (quotes) {
      return (
        <div className="space-y-1">
          {quotes.map(q => (
            <div key={q.symbol} className="flex justify-between items-center">
              <span className="text-zinc-400">{q.symbol.replace('^', '')}</span>
              <div className="text-right">
                <span className="text-zinc-200">{q.price?.toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                <span className={`ml-2 ${Number(q.changePercent) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {Number(q.changePercent) >= 0 ? '+' : ''}{q.changePercent}%
                </span>
              </div>
            </div>
          ))}
          <div className="text-[10px] text-zinc-600 mt-1">
            Market: {String(data.marketStatus || 'unknown')}
          </div>
        </div>
      );
    }
  }

  if (domain === 'crypto') {
    const coins = data.coins as Array<{ id: string; price: number; change24h: string; marketCap: number }> | undefined;
    if (coins) {
      return (
        <div className="space-y-1">
          {coins.map(c => (
            <div key={c.id} className="flex justify-between items-center">
              <span className="text-zinc-400 capitalize">{c.id}</span>
              <div className="text-right">
                <span className="text-zinc-200">${c.price?.toLocaleString()}</span>
                <span className={`ml-2 ${Number(c.change24h) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {Number(c.change24h) >= 0 ? '+' : ''}{c.change24h}%
                </span>
              </div>
            </div>
          ))}
        </div>
      );
    }
  }

  if (domain === 'news') {
    const articles = data.articles as Array<{ title: string; source: string; pubDate: string }> | undefined;
    if (articles) {
      return (
        <div className="space-y-2">
          {articles.slice(0, 5).map((a, i) => (
            <div key={i}>
              <div className="text-zinc-300">{a.title}</div>
              <div className="text-[10px] text-zinc-500">{a.source} {a.pubDate ? `· ${a.pubDate}` : ''}</div>
            </div>
          ))}
        </div>
      );
    }
  }

  if (domain === 'weather' || domain === 'environment' || domain === 'eco') {
    const current = data.current as Record<string, unknown> | undefined;
    if (current) {
      return (
        <div className="space-y-1">
          <div className="flex justify-between">
            <span className="text-zinc-400">Temperature</span>
            <span className="text-zinc-200">{String(current.temperature_2m || '?')}°C</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Feels like</span>
            <span className="text-zinc-200">{String(current.apparent_temperature || '?')}°C</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Wind</span>
            <span className="text-zinc-200">{String(current.wind_speed_10m || '?')} km/h</span>
          </div>
          <div className="flex justify-between">
            <span className="text-zinc-400">Precipitation</span>
            <span className="text-zinc-200">{String(current.precipitation || '0')} mm</span>
          </div>
        </div>
      );
    }
  }

  if (domain === 'research' || domain === 'science' || domain === 'paper') {
    const papers = data.papers as Array<{ title: string; category: string; published: string }> | undefined;
    if (papers) {
      return (
        <div className="space-y-2">
          {papers.slice(0, 4).map((p, i) => (
            <div key={i}>
              <div className="text-zinc-300 text-[11px]">{p.title}</div>
              <div className="text-[10px] text-zinc-500">{p.category} · {p.published?.slice(0, 10)}</div>
            </div>
          ))}
        </div>
      );
    }
  }

  // RSS-article domains share the same shape — one renderer covers
  // legal / government / realestate / aviation / insurance /
  // manufacturing / logistics / retail / fitness / agriculture /
  // education. Pre-this-fix these hit the generic JSON-dump fallback
  // and looked half-built. Now they render as a tight 4-line article
  // list with clickable source links.
  const RSS_DOMAINS = new Set([
    'legal', 'government', 'realestate', 'aviation', 'insurance',
    'manufacturing', 'logistics', 'retail', 'fitness', 'agriculture',
    'education',
  ]);
  if (RSS_DOMAINS.has(domain)) {
    const articles = data.articles as Array<{ source: string; title: string; link?: string; pubDate?: string; summary?: string }> | undefined;
    if (articles && articles.length > 0) {
      return (
        <div className="space-y-2">
          {articles.slice(0, 4).map((a, i) => (
            <div key={i}>
              {a.link ? (
                <a href={a.link} target="_blank" rel="noopener noreferrer" className="text-zinc-300 text-[11px] hover:text-neon-cyan hover:underline">
                  {a.title}
                </a>
              ) : (
                <div className="text-zinc-300 text-[11px]">{a.title}</div>
              )}
              <div className="text-[10px] text-zinc-500">
                {a.source}{a.pubDate ? ` · ${formatRelativeDate(a.pubDate)}` : ''}
              </div>
            </div>
          ))}
        </div>
      );
    }
  }

  // Generic fallback
  return (
    <div className="text-zinc-400">
      <pre className="text-[10px] overflow-auto max-h-32">
        {JSON.stringify(data, null, 2).slice(0, 500)}
      </pre>
    </div>
  );
}

function formatRelativeDate(input: string): string {
  if (!input) return '';
  const d = new Date(input);
  if (Number.isNaN(d.getTime())) return input.slice(0, 24);
  const ms = Date.now() - d.getTime();
  if (ms < 60_000)      return 'just now';
  if (ms < 3_600_000)   return `${Math.floor(ms / 60_000)}m ago`;
  if (ms < 86_400_000)  return `${Math.floor(ms / 3_600_000)}h ago`;
  if (ms < 604_800_000) return `${Math.floor(ms / 86_400_000)}d ago`;
  return d.toLocaleDateString();
}
