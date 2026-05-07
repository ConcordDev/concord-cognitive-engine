import logger from '../logger.js';
// server/emergent/realtime-feeds.js
// Centralized real-time data fetching service — runs on heartbeat ticks,
// pushes data via WebSocket (realtimeEmit).
// All external API calls use free/public endpoints with graceful fallback.
//
// Event-to-DTU Bridge Integration:
// Each feed tick now also fires individual items through bridgeEvent()
// to convert live feed data into scoped, CRETI-scored DTUs in the substrate.
// Feed data streams to the frontend AND persists as knowledge simultaneously.

const FEED_CACHE = new Map();
const FEED_ERRORS = new Map();
const MAX_RETRIES = 2;
const FETCH_TIMEOUT = 8000;

// Event-to-DTU bridge callback — set by tickRealTimeFeeds when bridge is available.
// Each tick function checks this and fires individual feed items through the bridge.
// Null when bridge is not wired (graceful fallback — feeds still work without bridge).
let _bridgeEvent = null;

function safeFetch(url, opts = {}) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeout || FETCH_TIMEOUT);
  return fetch(url, { ...opts, signal: ac.signal })
    .finally(() => clearTimeout(t));
}

function cacheGet(key, maxAgeMs = 60000) {
  const entry = FEED_CACHE.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > maxAgeMs) { FEED_CACHE.delete(key); return null; }
  return entry.data;
}

function cacheSet(key, data) {
  FEED_CACHE.set(key, { data, ts: Date.now() });
  if (FEED_CACHE.size > 200) {
    const oldest = FEED_CACHE.keys().next().value;
    FEED_CACHE.delete(oldest);
  }
}

function recordError(feed, error) {
  const errors = FEED_ERRORS.get(feed) || [];
  errors.push({ ts: Date.now(), error: String(error?.message || error) });
  if (errors.length > 10) errors.shift();
  FEED_ERRORS.set(feed, errors);
}

// ── Financial Data (Open-Meteo economic proxy + Yahoo Finance scrape fallback) ──

async function tickFinancialFeeds(STATE, realtimeEmit, callBrain) {
  const cacheKey = "finance:ticker";
  const cached = cacheGet(cacheKey, 60000);
  if (cached) { realtimeEmit("finance:ticker", cached); return; }

  try {
    // Use free Yahoo Finance v8 endpoint for major indices
    const symbols = ["^GSPC", "^DJI", "^IXIC", "^RUT", "^VIX"];
    const quotes = [];

    for (const sym of symbols) {
      try {
        const res = await safeFetch(
          `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d`,
          { headers: { "User-Agent": "ConcordOS/1.0" } }
        );
        if (res.ok) {
          const json = await res.json();
          const meta = json?.chart?.result?.[0]?.meta;
          if (meta) {
            quotes.push({
              symbol: sym,
              price: meta.regularMarketPrice,
              previousClose: meta.previousClose,
              change: meta.regularMarketPrice - meta.previousClose,
              changePercent: ((meta.regularMarketPrice - meta.previousClose) / meta.previousClose * 100).toFixed(2),
              currency: meta.currency,
              exchange: meta.exchangeName,
            });
          }
        }
      } catch (_e) { logger.debug('emergent:realtime-feeds', 'individual symbol failure is ok', { error: _e?.message }); }
    }

    if (quotes.length > 0) {
      const payload = {
        ok: true,
        quotes,
        marketStatus: new Date().getUTCHours() >= 13 && new Date().getUTCHours() < 21 ? "open" : "closed",
        fetchedAt: new Date().toISOString(),
      };
      cacheSet(cacheKey, payload);
      realtimeEmit("finance:ticker", payload);

      // Bridge: each market quote → scoped event DTU
      if (_bridgeEvent) {
        for (const q of quotes) {
          _bridgeEvent({
            type: "market:trade",
            data: { title: `${q.symbol} ${q.changePercent > 0 ? "+" : ""}${q.changePercent}%`, symbol: q.symbol, price: q.price, change: q.change, changePercent: q.changePercent, status: payload.marketStatus },
            source: "yahoo_finance",
            timestamp: payload.fetchedAt,
          }).catch(err => logger.warn?.("[realtime-feeds] bridge event failed:", err?.message || err));
        }
      }
    }
  } catch (e) {
    recordError("finance", e);
  }
}

// ── Crypto Prices (CoinGecko free API) ──

async function tickCryptoFeeds(STATE, realtimeEmit) {
  const cacheKey = "crypto:ticker";
  const cached = cacheGet(cacheKey, 60000);
  if (cached) { realtimeEmit("crypto:ticker", cached); return; }

  try {
    const res = await safeFetch(
      "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,cardano,polkadot&vs_currencies=usd&include_24hr_change=true&include_market_cap=true",
      { headers: { "User-Agent": "ConcordOS/1.0" } }
    );
    if (res.ok) {
      const data = await res.json();
      const coins = Object.entries(data).map(([id, info]) => ({
        id,
        price: info.usd,
        change24h: info.usd_24h_change?.toFixed(2),
        marketCap: info.usd_market_cap,
      }));
      const payload = { ok: true, coins, fetchedAt: new Date().toISOString() };
      cacheSet(cacheKey, payload);
      realtimeEmit("crypto:ticker", payload);

      // Bridge: each crypto quote → scoped event DTU
      if (_bridgeEvent) {
        for (const c of coins) {
          _bridgeEvent({
            type: "market:crypto",
            data: { title: `${c.id} $${c.price}`, coin: c.id, price: c.price, change24h: c.change24h, marketCap: c.marketCap },
            source: "coingecko",
            timestamp: payload.fetchedAt,
          }).catch(err => logger.warn?.("[realtime-feeds] bridge event failed:", err?.message || err));
        }
      }
    }
  } catch (e) {
    recordError("crypto", e);
  }
}

// ── News Feeds (RSS parsing — no API key needed) ──

async function tickNewsFeeds(STATE, realtimeEmit) {
  const cacheKey = "news:update";
  const cached = cacheGet(cacheKey, 120000);
  if (cached) { realtimeEmit("news:update", cached); return; }

  const feeds = [
    { name: "Reuters", url: "https://feeds.reuters.com/reuters/topNews" },
    { name: "BBC", url: "https://feeds.bbci.co.uk/news/rss.xml" },
    { name: "NPR", url: "https://feeds.npr.org/1001/rss.xml" },
  ];

  const articles = [];
  for (const feed of feeds) {
    try {
      const res = await safeFetch(feed.url, { headers: { "User-Agent": "ConcordOS/1.0" } });
      if (res.ok) {
        const text = await res.text();
        // Simple XML item extraction (no dependency needed)
        const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
        for (const item of items.slice(0, 5)) {
          const title = item.match(/<title><!\[CDATA\[(.*?)\]\]>|<title>(.*?)<\/title>/)?.[1] || item.match(/<title>(.*?)<\/title>/)?.[1] || "";
          const link = item.match(/<link>(.*?)<\/link>/)?.[1] || "";
          const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
          if (title) articles.push({ source: feed.name, title: title.replace(/<!\[CDATA\[|\]\]>/g, ""), link, pubDate });
        }
      }
    } catch (_e) { logger.debug('emergent:realtime-feeds', 'individual feed failure is ok', { error: _e?.message }); }
  }

  if (articles.length > 0) {
    const payload = { ok: true, articles: articles.slice(0, 15), fetchedAt: new Date().toISOString() };
    cacheSet(cacheKey, payload);
    realtimeEmit("news:update", payload);

    // Bridge: each news article → scoped event DTU
    // RSS articles are 'reported' — the source said it happened, Concord didn't witness it
    if (_bridgeEvent) {
      for (const article of payload.articles) {
        _bridgeEvent({
          type: "news:politics", // generic news — classifier will determine actual domain
          data: { title: article.title, source: article.source, link: article.link, pubDate: article.pubDate },
          source: article.source?.toLowerCase().replace(/\s/g, "_") || "rss",
          timestamp: article.pubDate ? new Date(article.pubDate).toISOString() : payload.fetchedAt,
        }).catch(err => logger.warn?.("[realtime-feeds] bridge event failed:", err?.message || err));
      }
    }
  }
}

// ── Weather Data (Open-Meteo — completely free, no key needed) ──

async function tickWeatherFeeds(STATE, realtimeEmit) {
  const cacheKey = "weather:update";
  const cached = cacheGet(cacheKey, 300000); // 5 min cache
  if (cached) { realtimeEmit("weather:update", cached); return; }

  // Default location (configurable via STATE.settings)
  const lat = STATE.settings?.weatherLat || 41.7;
  const lon = STATE.settings?.weatherLon || -73.9;

  try {
    const res = await safeFetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,wind_speed_10m,precipitation,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto`
    );
    if (res.ok) {
      const data = await res.json();
      const payload = {
        ok: true,
        current: data.current,
        daily: data.daily,
        location: { lat, lon, timezone: data.timezone },
        fetchedAt: new Date().toISOString(),
      };
      cacheSet(cacheKey, payload);
      realtimeEmit("weather:update", payload);

      // Bridge: weather update → scoped event DTU
      if (_bridgeEvent) {
        _bridgeEvent({
          type: "weather:forecast",
          data: { title: `Weather ${lat},${lon}: ${data.current?.temperature_2m}°`, current: data.current, location: { lat, lon } },
          source: "open_meteo",
          timestamp: payload.fetchedAt,
        }).catch(err => logger.warn?.("[realtime-feeds] bridge event failed:", err?.message || err));
      }
    }
  } catch (e) {
    recordError("weather", e);
  }
}

// ── Scientific Papers (arXiv RSS — free) ──

async function tickResearchFeeds(STATE, realtimeEmit) {
  const cacheKey = "research:update";
  const cached = cacheGet(cacheKey, 600000); // 10 min cache
  if (cached) { realtimeEmit("research:update", cached); return; }

  const categories = ["cs.AI", "cs.CL", "cs.LG"];
  const papers = [];

  for (const cat of categories) {
    try {
      const res = await safeFetch(`https://export.arxiv.org/api/query?search_query=cat:${cat}&sortBy=submittedDate&sortOrder=descending&max_results=5`);
      if (res.ok) {
        const text = await res.text();
        const entries = text.match(/<entry>[\s\S]*?<\/entry>/g) || [];
        for (const entry of entries.slice(0, 3)) {
          const title = entry.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim() || "";
          const summary = entry.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, " ").trim().slice(0, 300) || "";
          const id = entry.match(/<id>(.*?)<\/id>/)?.[1] || "";
          const published = entry.match(/<published>(.*?)<\/published>/)?.[1] || "";
          if (title) papers.push({ category: cat, title, summary, id, published });
        }
      }
    } catch (_e) { logger.debug('emergent:realtime-feeds', 'individual category failure is ok', { error: _e?.message }); }
  }

  if (papers.length > 0) {
    const payload = { ok: true, papers: papers.slice(0, 10), fetchedAt: new Date().toISOString() };
    cacheSet(cacheKey, payload);
    realtimeEmit("research:update", payload);

    // Bridge: each research paper → scoped event DTU
    if (_bridgeEvent) {
      for (const paper of payload.papers) {
        _bridgeEvent({
          type: "research:paper",
          data: { title: paper.title, summary: paper.summary, category: paper.category, arxivId: paper.id, published: paper.published },
          source: "arxiv",
          timestamp: paper.published || payload.fetchedAt,
        }).catch(err => logger.warn?.("[realtime-feeds] bridge event failed:", err?.message || err));
      }
    }
  }
}

// ── Economic Data (World Bank API — free) ──

async function tickEconomyFeeds(STATE, realtimeEmit) {
  const cacheKey = "economy:update";
  const cached = cacheGet(cacheKey, 600000);
  if (cached) { realtimeEmit("economy:update", cached); return; }

  try {
    const indicators = [
      { code: "NY.GDP.MKTP.CD", name: "GDP" },
      { code: "FP.CPI.TOTL.ZG", name: "Inflation" },
      { code: "SL.UEM.TOTL.ZS", name: "Unemployment" },
    ];
    const data = [];
    for (const ind of indicators) {
      try {
        const res = await safeFetch(
          `https://api.worldbank.org/v2/country/US/indicator/${ind.code}?format=json&per_page=3&date=2020:2025`
        );
        if (res.ok) {
          const json = await res.json();
          const values = json?.[1]?.filter(v => v.value != null).slice(0, 3) || [];
          data.push({ indicator: ind.name, code: ind.code, values: values.map(v => ({ year: v.date, value: v.value })) });
        }
      } catch (_e) { logger.debug('emergent:realtime-feeds', 'silent catch', { error: _e?.message }); }
    }
    if (data.length > 0) {
      const payload = { ok: true, indicators: data, fetchedAt: new Date().toISOString() };
      cacheSet(cacheKey, payload);
      realtimeEmit("economy:update", payload);

      // Bridge: economic indicators → scoped event DTU
      if (_bridgeEvent) {
        for (const ind of data) {
          _bridgeEvent({
            type: "news:economics",
            data: { title: `${ind.indicator}: ${ind.values?.[0]?.value || "N/A"} (${ind.values?.[0]?.year || "?"})`, indicator: ind.indicator, code: ind.code, values: ind.values },
            source: "world_bank",
            timestamp: payload.fetchedAt,
          }).catch(err => logger.warn?.("[realtime-feeds] bridge event failed:", err?.message || err));
        }
      }
    }
  } catch (e) {
    recordError("economy", e);
  }
}

// ── Health Alerts (WHO RSS — free) ──

async function tickHealthFeeds(STATE, realtimeEmit) {
  const cacheKey = "health:update";
  const cached = cacheGet(cacheKey, 600000);
  if (cached) { realtimeEmit("health:update", cached); return; }

  try {
    const res = await safeFetch("https://www.who.int/feeds/entity/don/en/rss.xml");
    if (res.ok) {
      const text = await res.text();
      const items = text.match(/<item>[\s\S]*?<\/item>/g) || [];
      const alerts = items.slice(0, 5).map(item => {
        const title = item.match(/<title>(.*?)<\/title>/)?.[1] || "";
        const link = item.match(/<link>(.*?)<\/link>/)?.[1] || "";
        const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || "";
        return { title, link, pubDate };
      }).filter(a => a.title);

      if (alerts.length > 0) {
        const payload = { ok: true, alerts, fetchedAt: new Date().toISOString() };
        cacheSet(cacheKey, payload);
        realtimeEmit("health:update", payload);

        // Bridge: each health alert → scoped event DTU
        if (_bridgeEvent) {
          for (const alert of alerts) {
            _bridgeEvent({
              type: "health:alert",
              data: { title: alert.title, link: alert.link, pubDate: alert.pubDate },
              source: "who",
              timestamp: alert.pubDate ? new Date(alert.pubDate).toISOString() : payload.fetchedAt,
            }).catch(err => logger.warn?.("[realtime-feeds] bridge event failed:", err?.message || err));
          }
        }
      }
    }
  } catch (e) {
    recordError("health", e);
  }
}

// ── Energy Data (EIA API — free with key, fallback to cached) ──

async function tickEnergyFeeds(STATE, realtimeEmit) {
  const cacheKey = "energy:update";
  const cached = cacheGet(cacheKey, 600000);
  if (cached) { realtimeEmit("energy:update", cached); return; }

  // Emit cached placeholder if no live data yet
  const payload = {
    ok: true,
    note: "Energy data requires EIA API key — set EIA_API_KEY in .env",
    fetchedAt: new Date().toISOString(),
  };
  cacheSet(cacheKey, payload);
  realtimeEmit("energy:update", payload);
}

// ── Main tick dispatcher ──

export async function tickRealTimeFeeds(STATE, tickCount, realtimeEmit, callBrain, bridgeEvent) {
  // Set the module-level bridge callback so tick functions can use it
  _bridgeEvent = typeof bridgeEvent === "function" ? bridgeEvent : null;

  const tasks = [];

  // Financial + Crypto — every 5th tick (~75s)
  if (tickCount % 5 === 0) {
    tasks.push(tickFinancialFeeds(STATE, realtimeEmit, callBrain).catch(e => recordError("finance", e)));
    tasks.push(tickCryptoFeeds(STATE, realtimeEmit).catch(e => recordError("crypto", e)));
  }

  // News — every 10th tick (~150s)
  if (tickCount % 10 === 0) {
    tasks.push(tickNewsFeeds(STATE, realtimeEmit).catch(e => recordError("news", e)));
  }

  // Weather — every 20th tick (~5 min)
  if (tickCount % 20 === 0) {
    tasks.push(tickWeatherFeeds(STATE, realtimeEmit).catch(e => recordError("weather", e)));
  }

  // Research — every 100th tick (~25 min)
  if (tickCount % 100 === 0) {
    tasks.push(tickResearchFeeds(STATE, realtimeEmit).catch(e => recordError("research", e)));
  }

  // Economy — every 200th tick (~50 min)
  if (tickCount % 200 === 0) {
    tasks.push(tickEconomyFeeds(STATE, realtimeEmit).catch(e => recordError("economy", e)));
  }

  // Health — every 100th tick
  if (tickCount % 100 === 0) {
    tasks.push(tickHealthFeeds(STATE, realtimeEmit).catch(e => recordError("health", e)));
  }

  // Energy — every 200th tick
  if (tickCount % 200 === 0) {
    tasks.push(tickEnergyFeeds(STATE, realtimeEmit).catch(e => recordError("energy", e)));
  }

  if (tasks.length > 0) {
    await Promise.allSettled(tasks);
  }
}

export function getRealtimeFeedStatus() {
  // Include feed manager status if available
  let feedManagerStatus = null;
  try {
    if (globalThis._feedManager) {
      feedManagerStatus = globalThis._feedManager.getFeedHealthDashboard();
    }
  } catch (_e) { /* feed manager may not be initialized */ }

  return {
    cacheSize: FEED_CACHE.size,
    errors: Object.fromEntries(FEED_ERRORS),
    feeds: ["finance", "crypto", "news", "weather", "research", "economy", "health", "energy"],
    feedManager: feedManagerStatus,
  };
}

export function getRealtimeFeedData(feed) {
  return cacheGet(`${feed}:ticker`, 300000) || cacheGet(`${feed}:update`, 300000) || null;
}
