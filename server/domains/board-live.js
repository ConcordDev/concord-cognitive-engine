// server/domains/board-live.js
//
// BoardGameGeek hot list, fetched server-side so the browser never calls
// boardgamegeek.com directly (CORS). Fixed upstream URL, no key, no
// user-supplied URL. On any upstream failure it returns
// { ok:false, reason:"upstream_unavailable" } — never invented games.
//
//   board.live_hot   BGG "hot" board games, ranked

const BGG_HOT_URL = "https://boardgamegeek.com/xmlapi2/hot?type=boardgame";
const FETCH_TIMEOUT_MS = 10000;
const USER_AGENT = "ConcordOS/5.0 (+https://concord-os.org; mailto:hello@concord-os.org)";

async function fetchTextWithTimeout(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": USER_AGENT } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

const decodeXml = (s) =>
  String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");

// Value of `<tag ... value="..."/>` inside one <item> body, or undefined.
function valueAttr(itemXml, tag) {
  const m = itemXml.match(new RegExp(`<${tag}\\b[^>]*\\svalue="([^"]*)"`));
  return m ? decodeXml(m[1]) : undefined;
}

// Minimal parser for the BGG xmlapi2 /hot response:
//   <items><item id="1" rank="1"><thumbnail value=".."/><name value=".."/><yearpublished value=".."/></item>…
export function parseBggHot(xml) {
  const games = [];
  const itemRe = /<item\b([^>]*)>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = itemRe.exec(String(xml || ""))) !== null) {
    const attrs = m[1];
    const id = attrs.match(/\bid="([^"]*)"/)?.[1];
    const name = valueAttr(m[2], "name");
    if (!id || !name) continue;
    const rank = Number(attrs.match(/\brank="([^"]*)"/)?.[1] || 0);
    games.push({
      id,
      rank,
      name,
      yearPublished: valueAttr(m[2], "yearpublished"),
      thumbnail: valueAttr(m[2], "thumbnail"),
    });
  }
  return games;
}

export default function registerBoardLiveMacros(register) {
  register("board", "live_hot", async () => {
    try {
      const xml = await fetchTextWithTimeout(BGG_HOT_URL);
      const games = parseBggHot(xml);
      if (games.length === 0) {
        return { ok: false, reason: "upstream_unavailable", error: "boardgamegeek.com returned no items" };
      }
      return {
        ok: true,
        source: "BoardGameGeek",
        fetchedAt: Math.floor(Date.now() / 1000),
        total: games.length,
        games,
      };
    } catch (e) {
      return { ok: false, reason: "upstream_unavailable", error: String(e?.message || e) };
    }
  }, { note: "live BoardGameGeek hot list" });
}

export { BGG_HOT_URL };
