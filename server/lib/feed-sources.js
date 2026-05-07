/**
 * Feed Sources — Default Feed Registry for All Lenses
 *
 * Each source defines: id, domain, type, url, interval, parser, tags, enabled.
 * These are registered with the feed manager at startup.
 * Admin can enable/disable, adjust intervals, and add custom feeds.
 */

// ── FINANCE LENS ──────────────────────────────────────────────────────────────

export const FINANCE_FEEDS = [
  {
    id: "finance-yahoo-sp500",
    name: "S&P 500 (Yahoo Finance)",
    domain: "finance",
    type: "json",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/%5EGSPC?interval=1d&range=1d",
    interval: 60000,
    parser: "yahoo-finance",
    tags: ["stocks", "market", "sp500", "live"],
    enabled: true,
    headers: { "User-Agent": "ConcordOS/2.0" },
  },
  {
    id: "finance-yahoo-nasdaq",
    name: "NASDAQ (Yahoo Finance)",
    domain: "finance",
    type: "json",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/%5EIXIC?interval=1d&range=1d",
    interval: 60000,
    parser: "yahoo-finance",
    tags: ["stocks", "market", "nasdaq", "live"],
    enabled: true,
    headers: { "User-Agent": "ConcordOS/2.0" },
  },
  {
    id: "finance-yahoo-dow",
    name: "DOW (Yahoo Finance)",
    domain: "finance",
    type: "json",
    url: "https://query1.finance.yahoo.com/v8/finance/chart/%5EDJI?interval=1d&range=1d",
    interval: 60000,
    parser: "yahoo-finance",
    tags: ["stocks", "market", "dow", "live"],
    enabled: true,
    headers: { "User-Agent": "ConcordOS/2.0" },
  },
  {
    id: "finance-coingecko-top10",
    name: "Top Crypto (CoinGecko)",
    domain: "finance",
    type: "json",
    url: "https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum,solana,cardano,polkadot,ripple,dogecoin,chainlink,avalanche-2,polygon-ecosystem-token&vs_currencies=usd&include_24hr_change=true&include_market_cap=true",
    interval: 60000,
    parser: "coingecko",
    tags: ["crypto", "market", "live"],
    enabled: true,
  },
  {
    id: "finance-fred-rates",
    name: "FRED Interest Rates",
    domain: "finance",
    type: "json",
    url: "https://api.worldbank.org/v2/country/US/indicator/FR.INR.RINR?format=json&per_page=3&date=2022:2026",
    interval: 86400000,
    parser: "world-bank",
    tags: ["interest-rates", "economics", "federal-reserve"],
    enabled: true,
  },
  {
    id: "finance-sec-edgar",
    name: "SEC EDGAR Recent Filings",
    domain: "finance",
    type: "rss",
    url: "https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent&type=10-K&dateb=&owner=include&count=10&search_text=&action=getcurrent&output=atom",
    interval: 3600000,
    parser: "generic",
    tags: ["sec", "filings", "regulatory"],
    enabled: true,
  },
];

// ── NEWS / JOURNALISM LENS ───────────────────────────────────────────────────

export const NEWS_FEEDS = [
  {
    id: "news-reuters-top",
    name: "Reuters Top News",
    domain: "news",
    type: "rss",
    url: "https://feeds.reuters.com/reuters/topNews",
    interval: 900000,
    tags: ["news", "reuters", "world"],
    enabled: true,
  },
  {
    id: "news-bbc-world",
    name: "BBC World News",
    domain: "news",
    type: "rss",
    url: "https://feeds.bbci.co.uk/news/world/rss.xml",
    interval: 900000,
    tags: ["news", "bbc", "world"],
    enabled: true,
  },
  {
    id: "news-npr-top",
    name: "NPR Top Stories",
    domain: "news",
    type: "rss",
    url: "https://feeds.npr.org/1001/rss.xml",
    interval: 900000,
    tags: ["news", "npr", "us"],
    enabled: true,
  },
  {
    id: "news-ap-top",
    name: "AP News Top Stories",
    domain: "news",
    type: "rss",
    url: "https://rsshub.app/apnews/topics/apf-topnews",
    interval: 900000,
    tags: ["news", "ap", "world"],
    enabled: true,
  },
  {
    id: "news-techcrunch",
    name: "TechCrunch",
    domain: "news",
    type: "rss",
    url: "https://techcrunch.com/feed/",
    interval: 900000,
    tags: ["news", "tech", "startups"],
    enabled: true,
  },
  {
    id: "news-arstechnica",
    name: "Ars Technica",
    domain: "news",
    type: "rss",
    url: "https://feeds.arstechnica.com/arstechnica/index",
    interval: 900000,
    tags: ["news", "tech", "science"],
    enabled: true,
  },
  {
    id: "news-theverge",
    name: "The Verge",
    domain: "news",
    type: "rss",
    url: "https://www.theverge.com/rss/index.xml",
    interval: 900000,
    tags: ["news", "tech", "culture"],
    enabled: true,
  },
];

// ── SPORTS LENS ──────────────────────────────────────────────────────────────

export const SPORTS_FEEDS = [
  {
    id: "sports-espn-top",
    name: "ESPN Top Headlines",
    domain: "sports",
    type: "rss",
    url: "https://www.espn.com/espn/rss/news",
    interval: 60000,
    tags: ["sports", "espn", "live"],
    enabled: true,
  },
  {
    id: "sports-espn-nba",
    name: "ESPN NBA",
    domain: "sports",
    type: "rss",
    url: "https://www.espn.com/espn/rss/nba/news",
    interval: 60000,
    tags: ["sports", "nba", "basketball"],
    enabled: true,
  },
  {
    id: "sports-espn-nfl",
    name: "ESPN NFL",
    domain: "sports",
    type: "rss",
    url: "https://www.espn.com/espn/rss/nfl/news",
    interval: 60000,
    tags: ["sports", "nfl", "football"],
    enabled: true,
  },
  {
    id: "sports-espn-mlb",
    name: "ESPN MLB",
    domain: "sports",
    type: "rss",
    url: "https://www.espn.com/espn/rss/mlb/news",
    interval: 60000,
    tags: ["sports", "mlb", "baseball"],
    enabled: true,
  },
  {
    id: "sports-espn-nhl",
    name: "ESPN NHL",
    domain: "sports",
    type: "rss",
    url: "https://www.espn.com/espn/rss/nhl/news",
    interval: 60000,
    tags: ["sports", "nhl", "hockey"],
    enabled: true,
  },
  {
    id: "sports-espn-soccer",
    name: "ESPN Soccer",
    domain: "sports",
    type: "rss",
    url: "https://www.espn.com/espn/rss/soccer/news",
    interval: 60000,
    tags: ["sports", "soccer", "mls", "premier-league"],
    enabled: true,
  },
];

// ── WEATHER / ENVIRONMENTAL LENS ─────────────────────────────────────────────

export const WEATHER_FEEDS = [
  {
    id: "weather-openmeteo-default",
    name: "Open-Meteo Current Weather",
    domain: "weather",
    type: "json",
    url: "https://api.open-meteo.com/v1/forecast?latitude=40.7&longitude=-74.0&current=temperature_2m,apparent_temperature,wind_speed_10m,precipitation,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_sum&timezone=auto",
    interval: 1800000,
    parser: "open-meteo",
    tags: ["weather", "forecast", "current"],
    enabled: true,
  },
  {
    id: "weather-noaa-alerts",
    name: "NOAA Severe Weather Alerts",
    domain: "weather",
    type: "rss",
    url: "https://alerts.weather.gov/cap/us.php?x=0",
    interval: 900000,
    tags: ["weather", "alerts", "severe", "noaa"],
    enabled: true,
  },
  {
    id: "weather-airnow-aqi",
    name: "AirNow Air Quality",
    domain: "weather",
    type: "rss",
    url: "https://www.airnow.gov/rss/aqi-daily.xml",
    interval: 3600000,
    tags: ["air-quality", "aqi", "environment"],
    enabled: true,
  },
  {
    id: "weather-usgs-earthquakes",
    name: "USGS Earthquakes (M2.5+, Past Hour)",
    domain: "weather",
    type: "json",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/2.5_hour.geojson",
    interval: 900000,
    parser: "usgs-earthquake",
    tags: ["earthquake", "seismic", "usgs"],
    enabled: true,
  },
];

// ── MUSIC LENS ───────────────────────────────────────────────────────────────

export const MUSIC_FEEDS = [
  {
    id: "music-pitchfork",
    name: "Pitchfork Reviews",
    domain: "music",
    type: "rss",
    url: "https://pitchfork.com/feed/feed-album-reviews/rss",
    interval: 3600000,
    tags: ["music", "reviews", "albums"],
    enabled: true,
  },
  {
    id: "music-stereogum",
    name: "Stereogum",
    domain: "music",
    type: "rss",
    url: "https://www.stereogum.com/feed/",
    interval: 3600000,
    tags: ["music", "news", "indie"],
    enabled: true,
  },
];

// ── HEALTHCARE LENS ──────────────────────────────────────────────────────────

export const HEALTHCARE_FEEDS = [
  {
    id: "health-who-outbreaks",
    name: "WHO Disease Outbreak News",
    domain: "healthcare",
    type: "rss",
    url: "https://www.who.int/feeds/entity/don/en/rss.xml",
    interval: 86400000,
    tags: ["health", "who", "outbreaks", "disease"],
    enabled: true,
  },
  {
    id: "health-fda-recalls",
    name: "FDA Drug Recalls",
    domain: "healthcare",
    type: "rss",
    url: "https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/drug-safety/rss.xml",
    interval: 21600000,
    tags: ["health", "fda", "drug-recalls", "safety"],
    enabled: true,
  },
  {
    id: "health-cdc-advisories",
    name: "CDC Health Advisories",
    domain: "healthcare",
    type: "rss",
    url: "https://tools.cdc.gov/api/v2/resources/media/rss/132608.rss",
    interval: 86400000,
    tags: ["health", "cdc", "advisories"],
    enabled: true,
  },
  {
    id: "health-pubmed-trending",
    name: "PubMed Trending Papers",
    domain: "healthcare",
    type: "rss",
    url: "https://pubmed.ncbi.nlm.nih.gov/trending/rss/",
    interval: 86400000,
    tags: ["health", "pubmed", "research", "medical"],
    enabled: true,
  },
];

// ── LEGAL LENS ───────────────────────────────────────────────────────────────

export const LEGAL_FEEDS = [
  {
    id: "legal-scotusblog",
    name: "SCOTUSblog",
    domain: "legal",
    type: "rss",
    url: "https://www.scotusblog.com/feed/",
    interval: 3600000,
    tags: ["legal", "scotus", "supreme-court"],
    enabled: true,
  },
  {
    id: "legal-lawfare",
    name: "Lawfare Blog",
    domain: "legal",
    type: "rss",
    url: "https://www.lawfaremedia.org/feed",
    interval: 3600000,
    tags: ["legal", "national-security", "policy"],
    enabled: true,
  },
  {
    id: "legal-federal-register",
    name: "Federal Register (New Rules)",
    domain: "legal",
    type: "rss",
    url: "https://www.federalregister.gov/documents/search.rss?conditions%5Btype%5D%5B%5D=RULE",
    interval: 86400000,
    tags: ["legal", "regulations", "federal-register"],
    enabled: true,
  },
];

// ── REAL ESTATE LENS ─────────────────────────────────────────────────────────

export const REAL_ESTATE_FEEDS = [
  {
    id: "realestate-fred-housing",
    name: "FRED Housing Price Index",
    domain: "real-estate",
    type: "json",
    url: "https://api.worldbank.org/v2/country/US/indicator/FP.CPI.TOTL.ZG?format=json&per_page=5&date=2020:2026",
    interval: 2592000000,
    parser: "world-bank",
    tags: ["real-estate", "housing", "prices"],
    enabled: true,
  },
];

// ── TRADES LENS ──────────────────────────────────────────────────────────────

export const TRADES_FEEDS = [
  {
    id: "trades-osha-bulletins",
    name: "OSHA Safety Bulletins",
    domain: "trades",
    type: "rss",
    url: "https://www.osha.gov/rss/quicktakes.xml",
    interval: 604800000,
    tags: ["trades", "osha", "safety"],
    enabled: true,
  },
];

// ── AGRICULTURE LENS ─────────────────────────────────────────────────────────

export const AGRICULTURE_FEEDS = [
  {
    id: "ag-usda-news",
    name: "USDA News Releases",
    domain: "agriculture",
    type: "rss",
    url: "https://www.usda.gov/rss/latest-releases.xml",
    interval: 86400000,
    tags: ["agriculture", "usda", "crops", "policy"],
    enabled: true,
  },
  {
    id: "ag-noaa-climate",
    name: "NOAA Agricultural Climate",
    domain: "agriculture",
    type: "rss",
    url: "https://www.climate.gov/feeds/all",
    interval: 21600000,
    tags: ["agriculture", "weather", "climate", "noaa"],
    enabled: true,
  },
];

// ── ENERGY LENS ──────────────────────────────────────────────────────────────

export const ENERGY_FEEDS = [
  {
    id: "energy-eia-news",
    name: "EIA Today in Energy",
    domain: "energy",
    type: "rss",
    url: "https://www.eia.gov/rss/todayinenergy.xml",
    interval: 86400000,
    tags: ["energy", "eia", "oil", "gas", "electricity"],
    enabled: true,
  },
  {
    id: "energy-solar-nrel",
    name: "NREL News",
    domain: "energy",
    type: "rss",
    url: "https://www.nrel.gov/news/rss.xml",
    interval: 86400000,
    tags: ["energy", "solar", "renewable", "nrel"],
    enabled: true,
  },
];

// ── SCIENCE / RESEARCH LENS ─────────────────────────────────────────────────

export const SCIENCE_FEEDS = [
  {
    id: "science-arxiv-cs-ai",
    name: "arXiv CS.AI",
    domain: "science",
    type: "rss",
    url: "https://export.arxiv.org/api/query?search_query=cat:cs.AI&sortBy=submittedDate&sortOrder=descending&max_results=10",
    interval: 21600000,
    tags: ["science", "arxiv", "ai", "cs"],
    enabled: true,
  },
  {
    id: "science-arxiv-cs-lg",
    name: "arXiv CS.LG (Machine Learning)",
    domain: "science",
    type: "rss",
    url: "https://export.arxiv.org/api/query?search_query=cat:cs.LG&sortBy=submittedDate&sortOrder=descending&max_results=10",
    interval: 21600000,
    tags: ["science", "arxiv", "ml", "cs"],
    enabled: true,
  },
  {
    id: "science-arxiv-physics",
    name: "arXiv Physics",
    domain: "science",
    type: "rss",
    url: "https://export.arxiv.org/api/query?search_query=cat:physics&sortBy=submittedDate&sortOrder=descending&max_results=10",
    interval: 21600000,
    tags: ["science", "arxiv", "physics"],
    enabled: true,
  },
  {
    id: "science-arxiv-math",
    name: "arXiv Math",
    domain: "science",
    type: "rss",
    url: "https://export.arxiv.org/api/query?search_query=cat:math&sortBy=submittedDate&sortOrder=descending&max_results=10",
    interval: 21600000,
    tags: ["science", "arxiv", "math"],
    enabled: true,
  },
  {
    id: "science-nature-news",
    name: "Nature News",
    domain: "science",
    type: "rss",
    url: "https://www.nature.com/nature.rss",
    interval: 86400000,
    tags: ["science", "nature", "research"],
    enabled: true,
  },
];

// ── SPACE / ASTRONOMY LENS ──────────────────────────────────────────────────

export const SPACE_FEEDS = [
  {
    id: "space-nasa-apod",
    name: "NASA Astronomy Picture of the Day",
    domain: "space",
    type: "json",
    url: "https://api.nasa.gov/planetary/apod?api_key=DEMO_KEY",
    interval: 86400000,
    parser: "nasa-apod",
    tags: ["space", "nasa", "astronomy", "apod"],
    enabled: true,
  },
  {
    id: "space-spaceflight-now",
    name: "SpaceFlight Now Launch Schedule",
    domain: "space",
    type: "rss",
    url: "https://spaceflightnow.com/feed/",
    interval: 21600000,
    tags: ["space", "launches", "rockets"],
    enabled: true,
  },
  {
    id: "space-noaa-spaceweather",
    name: "NOAA Space Weather",
    domain: "space",
    type: "rss",
    url: "https://www.swpc.noaa.gov/content/news-archive/rss.xml",
    interval: 3600000,
    tags: ["space", "solar", "geomagnetic", "noaa"],
    enabled: true,
  },
];

// ── TECHNOLOGY / CODE LENS ──────────────────────────────────────────────────

export const TECHNOLOGY_FEEDS = [
  {
    id: "tech-hackernews-top",
    name: "Hacker News Top Stories",
    domain: "technology",
    type: "json",
    url: "https://hacker-news.firebaseio.com/v0/topstories.json",
    interval: 1800000,
    parser: "hackernews",
    tags: ["tech", "hackernews", "programming"],
    enabled: true,
    // Note: HN requires fetching individual stories after getting IDs
    // The parser handles the top-level array of IDs; we fetch details separately
  },
  {
    id: "tech-devto-top",
    name: "Dev.to Top Posts",
    domain: "technology",
    type: "rss",
    url: "https://dev.to/feed",
    interval: 3600000,
    tags: ["tech", "devto", "programming"],
    enabled: true,
  },
];

// ── ENVIRONMENTAL LENS ──────────────────────────────────────────────────────

export const ENVIRONMENTAL_FEEDS = [
  {
    id: "env-epa-news",
    name: "EPA News Releases",
    domain: "environment",
    type: "rss",
    url: "https://www.epa.gov/newsreleases/search/rss",
    interval: 86400000,
    tags: ["environment", "epa", "air-quality", "policy"],
    enabled: true,
  },
  {
    id: "env-usgs-water",
    name: "USGS Water Resources",
    domain: "environment",
    type: "rss",
    url: "https://water.usgs.gov/wsc/a_rss.xml",
    interval: 86400000,
    tags: ["environment", "water", "usgs"],
    enabled: true,
  },
];

// ── GEOLOGY LENS ────────────────────────────────────────────────────────────

export const GEOLOGY_FEEDS = [
  {
    id: "geology-usgs-quakes-significant",
    name: "USGS Significant Earthquakes",
    domain: "geology",
    type: "json",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/significant_day.geojson",
    interval: 300000,
    parser: "usgs-earthquake",
    tags: ["geology", "earthquake", "seismic", "significant"],
    enabled: true,
  },
  {
    id: "geology-usgs-quakes-all",
    name: "USGS All M4.5+ Earthquakes (Past Day)",
    domain: "geology",
    type: "json",
    url: "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson",
    interval: 300000,
    parser: "usgs-earthquake",
    tags: ["geology", "earthquake", "seismic"],
    enabled: true,
  },
  {
    id: "geology-volcano-alerts",
    name: "USGS Volcano Alerts",
    domain: "geology",
    type: "rss",
    url: "https://volcanoes.usgs.gov/rss/vhpcap.xml",
    interval: 3600000,
    tags: ["geology", "volcano", "alerts", "usgs"],
    enabled: true,
  },
];

// ── OCEAN LENS ──────────────────────────────────────────────────────────────

export const OCEAN_FEEDS = [
  {
    id: "ocean-noaa-news",
    name: "NOAA Ocean Service News",
    domain: "ocean",
    type: "rss",
    url: "https://oceanservice.noaa.gov/rss/news.xml",
    interval: 86400000,
    tags: ["ocean", "noaa", "marine"],
    enabled: true,
  },
];

// ── TRANSPORTATION LENS ─────────────────────────────────────────────────────

export const TRANSPORTATION_FEEDS = [
  {
    id: "transport-faa-notams",
    name: "FAA Safety Briefing",
    domain: "transportation",
    type: "rss",
    url: "https://www.faa.gov/newsroom/rss",
    interval: 1800000,
    tags: ["transportation", "faa", "aviation", "safety"],
    enabled: true,
  },
];

// ── GLOBAL LENS ─────────────────────────────────────────────────────────────

export const GLOBAL_FEEDS = [
  {
    id: "global-worldbank-data",
    name: "World Bank GDP Data",
    domain: "global",
    type: "json",
    url: "https://api.worldbank.org/v2/country/all/indicator/NY.GDP.MKTP.CD?format=json&per_page=20&date=2022:2026",
    interval: 2592000000,
    parser: "world-bank",
    tags: ["global", "economics", "gdp", "world-bank"],
    enabled: true,
  },
  {
    id: "global-owid-news",
    name: "Our World in Data",
    domain: "global",
    type: "rss",
    url: "https://ourworldindata.org/atom.xml",
    interval: 86400000,
    tags: ["global", "data", "research", "development"],
    enabled: true,
  },
];

// ══════════════════════════════════════════════════════════════════════════════
// AGGREGATED EXPORT
// ══════════════════════════════════════════════════════════════════════════════

export const ALL_DEFAULT_FEEDS = [
  ...FINANCE_FEEDS,
  ...NEWS_FEEDS,
  ...SPORTS_FEEDS,
  ...WEATHER_FEEDS,
  ...MUSIC_FEEDS,
  ...HEALTHCARE_FEEDS,
  ...LEGAL_FEEDS,
  ...REAL_ESTATE_FEEDS,
  ...TRADES_FEEDS,
  ...AGRICULTURE_FEEDS,
  ...ENERGY_FEEDS,
  ...SCIENCE_FEEDS,
  ...SPACE_FEEDS,
  ...TECHNOLOGY_FEEDS,
  ...ENVIRONMENTAL_FEEDS,
  ...GEOLOGY_FEEDS,
  ...OCEAN_FEEDS,
  ...TRANSPORTATION_FEEDS,
  ...GLOBAL_FEEDS,
];

export const FEED_DOMAINS = [
  "finance", "news", "sports", "weather", "music",
  "healthcare", "legal", "real-estate", "trades",
  "agriculture", "energy", "science", "space",
  "technology", "environment", "geology", "ocean",
  "transportation", "global",
];

export default ALL_DEFAULT_FEEDS;
