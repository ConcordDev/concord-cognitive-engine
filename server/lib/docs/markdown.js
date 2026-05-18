// server/lib/docs/markdown.js
//
// Docs Sprint A — deterministic HTML ↔ Markdown converter + word count
// + backref extractor. No third-party deps; the converter handles the
// subset of HTML the Tiptap BlockEditor produces (headings, paragraphs,
// lists, task lists, blockquotes, code blocks, tables, inline marks,
// links, images, dividers). Round-trip preserves the source elements
// the editor cares about; less-common HTML degrades gracefully to
// plain text.

const VOID_TAGS = new Set(["br", "hr", "img", "input", "meta", "link"]);

function _stripTags(s) {
  // Replace tags with a single space so block-level boundaries don't
  // mash neighbouring words together (e.g. </h1><p>).
  return String(s || "").replace(/<[^>]*>/g, " ");
}

function _decode(s) {
  return String(s || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function _encode(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/**
 * Lightweight tokeniser. Returns a flat array of {kind, tag, attrs, text}
 * tokens. Self-closing tags emit a single token with kind='void'.
 */
function _tokenise(html) {
  const out = [];
  const tagRe = /<\/?([a-z][a-z0-9]*)\b([^>]*)>|([^<]+)/gi;
  let m;
  while ((m = tagRe.exec(html)) !== null) {
    if (m[3]) {
      out.push({ kind: "text", text: _decode(m[3]) });
      continue;
    }
    const isClose = m[0].startsWith("</");
    const tag = m[1].toLowerCase();
    const attrsRaw = m[2] || "";
    const attrs = {};
    attrsRaw.replace(/([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*"([^"]*)"/g, (_a, k, v) => {
      attrs[k.toLowerCase()] = _decode(v);
    });
    if (VOID_TAGS.has(tag) || /\/>$/.test(m[0])) {
      out.push({ kind: "void", tag, attrs });
    } else if (isClose) {
      out.push({ kind: "close", tag });
    } else {
      out.push({ kind: "open", tag, attrs });
    }
  }
  return out;
}

/**
 * Render inline marks into markdown. Operates on a small slice of tokens
 * spanning one inline run (between block boundaries).
 */
function _renderInline(tokens) {
  let out = "";
  for (const t of tokens) {
    if (t.kind === "text") {
      out += t.text;
    } else if (t.kind === "void" && t.tag === "br") {
      out += "  \n";
    } else if (t.kind === "void" && t.tag === "img") {
      const alt = t.attrs.alt || "";
      const src = t.attrs.src || "";
      out += `![${alt}](${src})`;
    } else if (t.kind === "open" && t.tag === "a") {
      // greedy: collect until matching </a>
      out += "[";
    } else if (t.kind === "close" && t.tag === "a") {
      out += `](${tokensCurrentHref || ""})`;
      tokensCurrentHref = "";
    } else if (t.kind === "open" && (t.tag === "strong" || t.tag === "b")) {
      out += "**";
    } else if (t.kind === "close" && (t.tag === "strong" || t.tag === "b")) {
      out += "**";
    } else if (t.kind === "open" && (t.tag === "em" || t.tag === "i")) {
      out += "*";
    } else if (t.kind === "close" && (t.tag === "em" || t.tag === "i")) {
      out += "*";
    } else if (t.kind === "open" && t.tag === "code") {
      out += "`";
    } else if (t.kind === "close" && t.tag === "code") {
      out += "`";
    } else if (t.kind === "open" && (t.tag === "s" || t.tag === "del" || t.tag === "strike")) {
      out += "~~";
    } else if (t.kind === "close" && (t.tag === "s" || t.tag === "del" || t.tag === "strike")) {
      out += "~~";
    } else if (t.kind === "open" && t.tag === "mark") {
      out += "==";
    } else if (t.kind === "close" && t.tag === "mark") {
      out += "==";
    }
    // unknown inline tags drop their wrapper but keep text
  }
  return out;
}
let tokensCurrentHref = ""; // single-thread state; html parser is sync

/**
 * Convert HTML → Markdown (CommonMark + GFM tables + task lists).
 */
export function htmlToMarkdown(html) {
  if (!html || typeof html !== "string") return "";
  const tokens = _tokenise(html.replace(/\r\n?/g, "\n"));
  const out = [];
  let i = 0;

  const collectInline = (closeTag) => {
    const slice = [];
    while (i < tokens.length) {
      const t = tokens[i];
      if (t.kind === "close" && t.tag === closeTag) { i++; break; }
      // capture href as we walk so _renderInline can emit it
      if (t.kind === "open" && t.tag === "a") tokensCurrentHref = t.attrs.href || "";
      slice.push(t);
      i++;
    }
    return _renderInline(slice).trim();
  };

  const collectBlockText = (closeTag) => {
    return collectInline(closeTag).replace(/\s+\n/g, "\n").trim();
  };

  while (i < tokens.length) {
    const t = tokens[i];
    if (t.kind === "text") {
      const txt = t.text.trim();
      if (txt) out.push(txt);
      i++;
      continue;
    }
    if (t.kind === "open") {
      const tag = t.tag;
      if (tag === "h1" || tag === "h2" || tag === "h3" || tag === "h4" || tag === "h5" || tag === "h6") {
        const level = Number(tag[1]);
        i++;
        out.push("#".repeat(level) + " " + collectBlockText(tag));
        out.push("");
      } else if (tag === "p") {
        i++;
        const body = collectBlockText("p");
        if (body) { out.push(body); out.push(""); }
      } else if (tag === "blockquote") {
        i++;
        const body = collectBlockText("blockquote");
        if (body) {
          out.push(body.split("\n").map((l) => "> " + l).join("\n"));
          out.push("");
        }
      } else if (tag === "pre") {
        // capture <pre><code class="language-xxx">...</code></pre>
        i++;
        let lang = "";
        let body = "";
        while (i < tokens.length) {
          const x = tokens[i];
          if (x.kind === "close" && x.tag === "pre") { i++; break; }
          if (x.kind === "open" && x.tag === "code") {
            const cls = x.attrs.class || "";
            const langMatch = cls.match(/language-([a-z0-9_+-]+)/i);
            if (langMatch) lang = langMatch[1];
            i++;
            while (i < tokens.length) {
              const y = tokens[i];
              if (y.kind === "close" && y.tag === "code") { i++; break; }
              if (y.kind === "text") body += y.text;
              else if (y.kind === "void" && y.tag === "br") body += "\n";
              i++;
            }
          } else if (x.kind === "text") {
            body += x.text;
            i++;
          } else {
            i++;
          }
        }
        out.push("```" + lang);
        out.push(body.replace(/\n+$/, ""));
        out.push("```");
        out.push("");
      } else if (tag === "ul" || tag === "ol") {
        const ordered = tag === "ol";
        i++;
        let idx = 1;
        while (i < tokens.length) {
          const x = tokens[i];
          if (x.kind === "close" && x.tag === tag) { i++; break; }
          if (x.kind === "open" && x.tag === "li") {
            // task list detection: <li data-type="taskItem" data-checked="true">
            // attr keys are lowercased by the tokeniser; values are preserved
            // so we lower-case the comparison side for robustness.
            const isTask = String(x.attrs["data-type"] || "").toLowerCase() === "taskitem";
            const checked = String(x.attrs["data-checked"] || "").toLowerCase() === "true";
            i++;
            const liBody = collectBlockText("li");
            const cleaned = liBody.replace(/\n+/g, " ").trim();
            const prefix = ordered ? `${idx}. ` : "- ";
            const taskMark = isTask ? (checked ? "[x] " : "[ ] ") : "";
            out.push(prefix + taskMark + cleaned);
            if (ordered) idx++;
          } else {
            i++;
          }
        }
        out.push("");
      } else if (tag === "hr") {
        out.push("---");
        out.push("");
        i++;
      } else if (tag === "table") {
        i++;
        const rows = [];
        let headerRow = null;
        while (i < tokens.length) {
          const x = tokens[i];
          if (x.kind === "close" && x.tag === "table") { i++; break; }
          if (x.kind === "open" && x.tag === "tr") {
            i++;
            const cells = [];
            let isHeader = false;
            while (i < tokens.length) {
              const y = tokens[i];
              if (y.kind === "close" && y.tag === "tr") { i++; break; }
              if (y.kind === "open" && (y.tag === "th" || y.tag === "td")) {
                if (y.tag === "th") isHeader = true;
                i++;
                cells.push(collectBlockText(y.tag).replace(/\n+/g, " "));
              } else {
                i++;
              }
            }
            if (isHeader && !headerRow) headerRow = cells;
            else rows.push(cells);
          } else {
            i++;
          }
        }
        if (headerRow) {
          out.push("| " + headerRow.join(" | ") + " |");
          out.push("| " + headerRow.map(() => "---").join(" | ") + " |");
        }
        for (const r of rows) out.push("| " + r.join(" | ") + " |");
        out.push("");
      } else {
        i++;
      }
    } else if (t.kind === "void" && t.tag === "hr") {
      out.push("---"); out.push(""); i++;
    } else if (t.kind === "void" && t.tag === "br") {
      out.push(""); i++;
    } else {
      i++;
    }
  }

  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

/**
 * Convert Markdown → HTML. Minimal CommonMark-ish path supporting
 * headings, paragraphs, blockquotes, fenced code, lists (with task
 * items), bold/italic/code inline marks, links, images, tables, hr.
 */
export function markdownToHtml(md) {
  if (!md || typeof md !== "string") return "";
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out = [];
  let i = 0;

  const renderInline = (s) => {
    let r = _encode(s);
    // images first (before links)
    r = r.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_a, alt, src) => `<img src="${src}" alt="${alt}" />`);
    // links
    r = r.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g, (_a, lbl, href) => `<a href="${href}">${lbl}</a>`);
    // bold
    r = r.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    r = r.replace(/__([^_]+)__/g, "<strong>$1</strong>");
    // italic
    r = r.replace(/(^|\W)\*([^*]+)\*(\W|$)/g, "$1<em>$2</em>$3");
    r = r.replace(/(^|\W)_([^_]+)_(\W|$)/g, "$1<em>$2</em>$3");
    // strikethrough
    r = r.replace(/~~([^~]+)~~/g, "<s>$1</s>");
    // inline code
    r = r.replace(/`([^`]+)`/g, "<code>$1</code>");
    // highlight (==text==)
    r = r.replace(/==([^=]+)==/g, "<mark>$1</mark>");
    return r;
  };

  while (i < lines.length) {
    const line = lines[i];
    if (/^---+\s*$/.test(line)) { out.push("<hr />"); i++; continue; }
    // Fenced code
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const lang = fence[1] || "";
      const body = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i])) { body.push(lines[i]); i++; }
      i++; // skip closing fence
      const cls = lang ? ` class="language-${lang}"` : "";
      out.push(`<pre><code${cls}>${_encode(body.join("\n"))}</code></pre>`);
      continue;
    }
    // Heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      out.push(`<h${level}>${renderInline(h[2])}</h${level}>`);
      i++; continue;
    }
    // Blockquote
    if (line.startsWith("> ")) {
      const body = [];
      while (i < lines.length && lines[i].startsWith("> ")) {
        body.push(lines[i].slice(2));
        i++;
      }
      out.push(`<blockquote><p>${body.map(renderInline).join("<br />")}</p></blockquote>`);
      continue;
    }
    // Table (header + separator + rows)
    if (/^\|.+\|$/.test(line) && i + 1 < lines.length && /^\|[\s\-:|]+\|$/.test(lines[i + 1])) {
      const headerCells = line.slice(1, -1).split("|").map((s) => s.trim());
      i += 2; // skip separator
      const rows = [];
      while (i < lines.length && /^\|.+\|$/.test(lines[i])) {
        rows.push(lines[i].slice(1, -1).split("|").map((s) => s.trim()));
        i++;
      }
      let tbl = "<table><tbody>";
      tbl += "<tr>" + headerCells.map((c) => `<th>${renderInline(c)}</th>`).join("") + "</tr>";
      for (const r of rows) tbl += "<tr>" + r.map((c) => `<td>${renderInline(c)}</td>`).join("") + "</tr>";
      tbl += "</tbody></table>";
      out.push(tbl);
      continue;
    }
    // List (unordered, ordered, task)
    const listMatch = line.match(/^(\s*)([-*+]|\d+\.)\s+(\[[ x]\]\s+)?(.*)$/);
    if (listMatch) {
      const ordered = /^\d/.test(listMatch[2]);
      const items = [];
      while (i < lines.length) {
        const m = lines[i].match(/^(\s*)([-*+]|\d+\.)\s+(\[[ x]\]\s+)?(.*)$/);
        if (!m) break;
        const task = m[3] ? (m[3].includes("x") ? "checked" : "unchecked") : null;
        items.push({ body: m[4], task });
        i++;
      }
      const tag = ordered ? "ol" : "ul";
      const isTask = items.some((x) => x.task);
      const attr = isTask ? ' data-type="taskList"' : "";
      let html = `<${tag}${attr}>`;
      for (const it of items) {
        if (it.task) {
          const checked = it.task === "checked";
          html += `<li data-type="taskItem" data-checked="${checked}"><p>${renderInline(it.body)}</p></li>`;
        } else {
          html += `<li><p>${renderInline(it.body)}</p></li>`;
        }
      }
      html += `</${tag}>`;
      out.push(html);
      continue;
    }
    // Paragraph
    if (line.trim() === "") { i++; continue; }
    // collect consecutive non-empty lines into a paragraph
    const paraLines = [line];
    i++;
    while (i < lines.length && lines[i].trim() !== ""
      && !/^[#>`|]/.test(lines[i])
      && !/^(\s*)([-*+]|\d+\.)\s+/.test(lines[i])) {
      paraLines.push(lines[i]);
      i++;
    }
    out.push(`<p>${paraLines.map(renderInline).join("<br />")}</p>`);
  }

  return out.join("\n");
}

/**
 * Word count from HTML by stripping tags and counting non-empty tokens.
 */
export function computeWordCount(html) {
  const text = _stripTags(html).replace(/&nbsp;/g, " ").replace(/&[a-z]+;/g, " ");
  const words = text.trim().split(/\s+/).filter((w) => w.length > 0);
  return words.length;
}

/**
 * Extract backrefs from HTML content. Three patterns:
 *   - Anchor href="dtu:..." or href="doc:..." or href="/lenses/..."
 *   - Wiki-style [[Label|doc:id]] or [[Label|dtu:id]] (rendered as <a>
 *     by frontend before save)
 *   - Plain href to internal /docs/<id> URLs
 */
export function extractBackrefs(html) {
  const out = [];
  if (!html) return out;
  const aRe = /<a\b[^>]*\bhref="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
  let m; let position = 0;
  while ((m = aRe.exec(html)) !== null) {
    const href = m[1];
    const label = _decode(m[2]);
    position = m.index;
    if (href.startsWith("doc:")) {
      out.push({ kind: "doc", docId: href, label, position });
    } else if (href.startsWith("dtu:")) {
      out.push({ kind: "dtu", dtuId: href, label, position });
    } else if (href.startsWith("/lenses/")) {
      out.push({ kind: "lens", uri: href, label, position });
    } else if (href.startsWith("/docs/")) {
      const docId = href.replace(/^\/docs\//, "");
      out.push({ kind: "doc", docId, label, position });
    } else if (/^https?:\/\//.test(href)) {
      out.push({ kind: "external", uri: href, label, position });
    }
  }
  return out;
}

/**
 * Plain-text outline (h1/h2/h3 only) for the document outline panel.
 */
export function extractOutline(html) {
  const out = [];
  if (!html) return out;
  const re = /<(h[1-3])>([^<]+)<\/\1>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    out.push({ level: Number(m[1][1]), text: _decode(m[2]).trim() });
  }
  return out;
}
