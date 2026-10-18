// Place name from a weather ask. "NYC weather" used to fall through to the
// default location (Poughkeepsie) because only "in/for/at <place>" was read,
// and "weather in NYC today" geocoded "NYC today".

const TIME_TAIL_RE = /\s+(?:right now|now|today|tonight|tomorrow(?:\s+(?:morning|afternoon|night))?|this\s+(?:morning|afternoon|evening|week|weekend)|next\s+week|later|currently|please|pls|like)\b.*$/i;
const FILLER = new Set(`what what's whats how how's hows is it the a will be going to gonna like
  weather forecast temperature temp temps rain raining snow snowing wind windy hot cold outside
  current currently right now today tonight tomorrow this week weekend morning afternoon evening
  tell me give show check get please pls me for in at of and do i need an umbrella jacket`.split(/\s+/).filter(Boolean));

const ALIASES = new Map([
  ["nyc", "New York City"], ["ny city", "New York City"], ["new york", "New York City"], ["manhattan", "New York City"],
  ["la", "Los Angeles"], ["sf", "San Francisco"], ["dc", "Washington, D.C."], ["washington dc", "Washington, D.C."],
  ["philly", "Philadelphia"], ["vegas", "Las Vegas"], ["nola", "New Orleans"], ["atl", "Atlanta"], ["chi", "Chicago"],
]);

function clean(place) {
  let p = String(place || "").replace(TIME_TAIL_RE, "").replace(/[?!.]+$/g, "").replace(/\s{2,}/g, " ").trim();
  p = p.replace(/^(?:the\s+)/i, "");
  const alias = ALIASES.get(p.toLowerCase().replace(/\./g, "").replace(/,/g, "").trim());
  return alias || p;
}

export function extractWeatherLocation(s) {
  const text = String(s || "");
  const m = text.match(/\b(?:in|for|at)\s+([a-zA-Z][^,.;!?]{1,60}(?:,\s*[a-zA-Z][^,.;!?]{1,30})?)/i);
  if (m) {
    const p = clean(m[1]);
    if (p && !FILLER.has(p.toLowerCase())) return p;
  }
  // "NYC weather", "weather Boston tomorrow", "Chicago forecast"
  const words = text.replace(/[^a-zA-Z.,'\s-]/g, " ").split(/\s+/).filter(Boolean);
  const rest = words.filter((w) => !FILLER.has(w.toLowerCase().replace(/[.,']+$/g, "").replace(/'s$/, "")));
  const p = clean(rest.join(" ").replace(/^[,\s]+|[,\s]+$/g, ""));
  return p.length >= 2 && p.length <= 60 ? p : "";
}
