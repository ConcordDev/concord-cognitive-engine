// server/lib/sourced-inputs.js
//
// Opt-in, provenance-tagged lookups that a lens action can use to fill a
// missing input from a real published series (the "adapter rule": sourced
// values enter as declared inputs, never as silent defaults). Each returns
// { ok:true, value, unit, provenance } or { ok:false, reason }. API keys are
// read from env and never echoed in provenance.

async function getJson(url) {
  const r = await globalThis.fetch(url);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
}

/** Latest non-missing observation of a FRED series (FRED_API_KEY). */
export async function fredLatest(seriesId) {
  const key = process.env.FRED_API_KEY;
  if (!key) return { ok: false, reason: "FRED_API_KEY not set" };
  const base = "https://api.stlouisfed.org/fred/series/observations";
  try {
    const data = await getJson(`${base}?series_id=${encodeURIComponent(seriesId)}&api_key=${encodeURIComponent(key)}&file_type=json&sort_order=desc&limit=10`);
    const obs = (data.observations || []).find((o) => o.value !== "." && Number.isFinite(Number(o.value)));
    if (!obs) return { ok: false, reason: `no observations for ${seriesId}` };
    return { ok: true, value: Number(obs.value), provenance: { source: "FRED (Federal Reserve Bank of St. Louis)", seriesId, observationDate: obs.date, url: `https://fred.stlouisfed.org/series/${seriesId}` } };
  } catch (e) {
    return { ok: false, reason: `FRED unavailable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Latest EIA average retail electricity price for a state/sector, in $/kWh (EIA_API_KEY). */
export async function eiaRetailPrice(state, sector = "RES") {
  const key = process.env.EIA_API_KEY;
  if (!key) return { ok: false, reason: "EIA_API_KEY not set" };
  const st = String(state || "").toUpperCase();
  if (!/^[A-Z]{2}$/.test(st)) return { ok: false, reason: "state must be a 2-letter code" };
  const base = "https://api.eia.gov/v2/electricity/retail-sales/data/";
  try {
    const data = await getJson(`${base}?api_key=${encodeURIComponent(key)}&frequency=monthly&data[0]=price&facets[stateid][]=${st}&facets[sectorid][]=${encodeURIComponent(sector)}&sort[0][column]=period&sort[0][direction]=desc&offset=0&length=1`);
    const row = data?.response?.data?.[0];
    const cents = row ? parseFloat(row.price) : NaN;
    if (!Number.isFinite(cents)) return { ok: false, reason: `no EIA price for ${st}/${sector}` };
    return { ok: true, value: Math.round(cents * 10) / 1000, unit: "USD/kWh", provenance: { source: "U.S. EIA electricity retail sales (average price)", state: st, sector, period: row.period, priceCentsPerKwh: cents, url: base } };
  } catch (e) {
    return { ok: false, reason: `EIA unavailable: ${e instanceof Error ? e.message : String(e)}` };
  }
}

/** Open-Meteo daily forecast (keyless): [{date, highTemp °F, precipInches}]. */
export async function openMeteoDailyForecast(lat, lng, days = 7) {
  const la = Number(lat), lo = Number(lng);
  if (!(Number.isFinite(la) && Math.abs(la) <= 90 && Number.isFinite(lo) && Math.abs(lo) <= 180)) return { ok: false, reason: "valid lat/lng required" };
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${la}&longitude=${lo}&daily=temperature_2m_max,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&forecast_days=${Math.max(1, Math.min(16, days))}&timezone=auto`;
  try {
    const data = await getJson(url);
    const d = data?.daily || {};
    const out = (d.time || []).map((t, i) => ({ date: t, highTemp: d.temperature_2m_max?.[i] ?? null, precipInches: d.precipitation_sum?.[i] ?? null }));
    return { ok: true, value: out, provenance: { source: "Open-Meteo forecast API", url, lat: la, lng: lo } };
  } catch (e) {
    return { ok: false, reason: `Open-Meteo unavailable: ${e instanceof Error ? e.message : String(e)}` };
  }
}
