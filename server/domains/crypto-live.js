// server/domains/crypto-live.js
//
// Phase 4 (seventh wave) — CryptoCompare basic price wire (no key).
//
// CryptoCompare's /data/top/totalvolfull endpoint returns the top
// N coins by 24h volume, including current price + market cap + 24h
// change. Free, no API key required. The existing finance lens has a
// CoinGecko top-10 wire; this adds an alternate source for the
// crypto lens specifically + complements with multi-asset price
// lookup (data/pricemultifull).
//
// Wires:
//   crypto.live_top         Top N coins by 24h volume
//   crypto.live_price       Multi-asset prices (BTC,ETH → USD,EUR,…)

const FETCH_TIMEOUT_MS = 8000;
const BASE = "https://min-api.cryptocompare.com";

async function fetchJson(url, opts = {}, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

export default function registerCryptoLiveMacros(register) {
  register("crypto", "live_top", async (_ctx, input = {}) => {
    const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 50);
    const tsym = String(input.tsym || "USD").toUpperCase().slice(0, 5);
    if (!/^[A-Z]{2,5}$/.test(tsym)) return { ok: false, reason: "invalid_tsym" };
    const url = `${BASE}/data/top/totalvolfull?limit=${limit}&tsym=${tsym}`;
    try {
      const data = await fetchJson(url);
      if (data.Response === "Error") {
        return { ok: false, reason: "cryptocompare_error", message: data.Message || null };
      }
      const coins = (data.Data || []).map(d => {
        const info = d.CoinInfo || {};
        const raw = d.RAW?.[tsym] || {};
        const disp = d.DISPLAY?.[tsym] || {};
        return {
          id: info.Id,
          symbol: info.Name,
          fullName: info.FullName,
          imageUrl: info.ImageUrl ? `https://www.cryptocompare.com${info.ImageUrl}` : null,
          price: raw.PRICE ?? null,
          priceDisplay: disp.PRICE || null,
          marketCap: raw.MKTCAP ?? null,
          marketCapDisplay: disp.MKTCAP || null,
          volume24h: raw.TOTALVOLUME24H ?? raw.TOTALVOLUME24HTO ?? null,
          volume24hDisplay: disp.TOTALVOLUME24HTO || null,
          change24h: raw.CHANGE24HOUR ?? null,
          changePct24h: raw.CHANGEPCT24HOUR ?? null,
          high24h: raw.HIGH24HOUR ?? null,
          low24h: raw.LOW24HOUR ?? null,
        };
      });
      return {
        ok: true,
        source: "CryptoCompare",
        fetchedAt: Math.floor(Date.now() / 1000),
        tsym,
        total: coins.length,
        coins,
      };
    } catch (e) {
      return { ok: false, reason: "cryptocompare_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live CryptoCompare top coins by 24h volume" });

  register("crypto", "live_price", async (_ctx, input = {}) => {
    const fsyms = String(input.fsyms || "BTC,ETH,SOL").toUpperCase().slice(0, 200);
    const tsyms = String(input.tsyms || "USD").toUpperCase().slice(0, 80);
    // Basic validation: comma-separated A-Z 2-10 chars.
    if (!fsyms.split(",").every(s => /^[A-Z]{2,10}$/.test(s.trim()))) {
      return { ok: false, reason: "invalid_fsyms" };
    }
    if (!tsyms.split(",").every(s => /^[A-Z]{2,5}$/.test(s.trim()))) {
      return { ok: false, reason: "invalid_tsyms" };
    }
    const url = `${BASE}/data/pricemultifull?fsyms=${fsyms}&tsyms=${tsyms}`;
    try {
      const data = await fetchJson(url);
      if (data.Response === "Error") {
        return { ok: false, reason: "cryptocompare_error", message: data.Message || null };
      }
      const raw = data.RAW || {};
      const disp = data.DISPLAY || {};
      const pairs = [];
      for (const [fsym, byTsym] of Object.entries(raw)) {
        for (const [tsym, q] of Object.entries(byTsym)) {
          const d = disp[fsym]?.[tsym] || {};
          pairs.push({
            from: fsym, to: tsym,
            price: q.PRICE,
            priceDisplay: d.PRICE,
            change24h: q.CHANGE24HOUR,
            changePct24h: q.CHANGEPCT24HOUR,
            change24hDisplay: d.CHANGE24HOUR,
            volume24h: q.VOLUME24HOUR,
            volume24hDisplay: d.VOLUME24HOUR,
            marketCap: q.MKTCAP,
            marketCapDisplay: d.MKTCAP,
          });
        }
      }
      return {
        ok: true,
        source: "CryptoCompare",
        fetchedAt: Math.floor(Date.now() / 1000),
        fsyms: fsyms.split(","),
        tsyms: tsyms.split(","),
        total: pairs.length,
        pairs,
      };
    } catch (e) {
      return { ok: false, reason: "cryptocompare_unreachable", error: String(e?.message || e) };
    }
  }, { note: "live CryptoCompare multi-asset price quotes" });
}
