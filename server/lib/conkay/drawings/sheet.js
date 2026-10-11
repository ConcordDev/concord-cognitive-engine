// server/lib/conkay/drawings/sheet.js
//
// A drawing sheet as plain data, and two writers for it: SVG and PDF. A sheet
// is { size: [w, h] (mm), items: [...] } with items in sheet millimetres,
// origin at the bottom-left, y up:
//   { t: "line", pts: [[x, y], ...], w, style }   style: solid | hidden | centre | phantom | thin
//   { t: "rect", x, y, w, h, lw, fill }
//   { t: "circle", cx, cy, r, lw, style }
//   { t: "arrow", x, y, dx, dy }                   filled arrowhead at (x, y) pointing along (dx, dy)
//   { t: "text", x, y, s, size, anchor, bold }     anchor: start | middle | end
// Both writers are deterministic (no dates, no random ids): the same sheet
// gives the same bytes. Text is ASCII only (the PDF uses the standard
// Helvetica fonts without embedding), so callers pass ASCII.

const MM_PT = 72 / 25.4;
const n2 = (v) => (Math.round(v * 100) / 100).toString();

export const LINE_STYLES = Object.freeze({
  solid: { w: 0.5, dash: null },
  thin: { w: 0.25, dash: null },
  hidden: { w: 0.25, dash: [2, 1] },
  centre: { w: 0.18, dash: [6, 1, 1, 1] },
  phantom: { w: 0.18, dash: [5, 1, 1, 1, 1, 1] },
});

export function ascii(s) {
  return String(s ?? "").replace(/[–—]/g, "-").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/±/g, "+/-").replace(/×/g, "x").replace(/°/g, " deg").replace(/[^\x20-\x7e]/g, "?");
}

/** Approximate Helvetica text width (mm) for layout / truncation: 0.55 em average (a little wide on purpose). */
export function textWidth(s, size) {
  return ascii(s).length * size * 0.55;
}

export function fitText(s, size, maxW) {
  const t = ascii(s);
  if (textWidth(t, size) <= maxW) return t;
  const n = Math.max(1, Math.floor(maxW / (size * 0.55)) - 3);
  return `${t.slice(0, n)}...`;
}

const esc = (s) => ascii(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** SVG of one sheet (mm units, y flipped). meta is embedded as JSON in <metadata>. */
export function toSvg(sheet, meta = {}) {
  const [W, H] = sheet.size;
  const Y = (y) => n2(H - y);
  const out = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}mm" height="${H}mm" viewBox="0 0 ${W} ${H}">`,
    `<metadata id="conkay-drawing">${esc(JSON.stringify(meta))}</metadata>`,
    `<rect x="0" y="0" width="${W}" height="${H}" fill="#ffffff"/>`,
  ];
  for (const it of sheet.items) {
    if (it.t === "line") {
      const st = LINE_STYLES[it.style || "solid"];
      const w = it.w ?? st.w;
      const dash = st.dash ? ` stroke-dasharray="${st.dash.join(",")}"` : "";
      out.push(`<polyline fill="none" stroke="#000" stroke-width="${n2(w)}" stroke-linecap="round" stroke-linejoin="round"${dash} points="${it.pts.map(([x, y]) => `${n2(x)},${Y(y)}`).join(" ")}"/>`);
    } else if (it.t === "rect") {
      out.push(`<rect x="${n2(it.x)}" y="${Y(it.y + it.h)}" width="${n2(it.w)}" height="${n2(it.h)}" fill="${it.fill || "none"}" stroke="#000" stroke-width="${n2(it.lw ?? 0.35)}"/>`);
    } else if (it.t === "circle") {
      const st = LINE_STYLES[it.style || "solid"];
      const dash = st.dash ? ` stroke-dasharray="${st.dash.join(",")}"` : "";
      out.push(`<circle cx="${n2(it.cx)}" cy="${Y(it.cy)}" r="${n2(it.r)}" fill="none" stroke="#000" stroke-width="${n2(it.lw ?? st.w)}"${dash}/>`);
    } else if (it.t === "arrow") {
      const [a, b, c] = arrowPts(it);
      out.push(`<polygon fill="#000" points="${[a, b, c].map(([x, y]) => `${n2(x)},${Y(y)}`).join(" ")}"/>`);
    } else if (it.t === "text") {
      const anchor = it.anchor || "start";
      out.push(`<text x="${n2(it.x)}" y="${Y(it.y)}" font-family="Helvetica, Arial, sans-serif" font-size="${n2(it.size || 2.5)}"${it.bold ? ` font-weight="bold"` : ""} text-anchor="${anchor}">${esc(it.s)}</text>`);
    }
  }
  out.push("</svg>");
  return out.join("\n") + "\n";
}

function arrowPts({ x, y, dx, dy, len = 2.5, half = 0.6 }) {
  const l = Math.hypot(dx, dy) || 1;
  const ux = dx / l, uy = dy / l;
  return [[x, y], [x - ux * len - uy * half, y - uy * len + ux * half], [x - ux * len + uy * half, y - uy * len - ux * half]];
}

const pdfStr = (s) => `(${ascii(s).replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)")})`;

/** One PDF (Buffer) with one page per sheet. meta goes in the document's Info dictionary (Keywords, as JSON). */
export function toPdf(sheets, meta = {}) {
  const objs = [];
  const add = (body) => { objs.push(body); return objs.length; };
  const fontR = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");
  const fontB = add("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>");
  const pageIds = [];
  const content = [];
  for (const sheet of sheets) {
    const [W, H] = sheet.size;
    const ops = ["1 J 1 j"];
    const P = (v) => n2(v * MM_PT);
    for (const it of sheet.items) {
      if (it.t === "line") {
        const st = LINE_STYLES[it.style || "solid"];
        ops.push(`${P(it.w ?? st.w)} w [${(st.dash || []).map(P).join(" ")}] 0 d`);
        ops.push(it.pts.map(([x, y], i) => `${P(x)} ${P(y)} ${i ? "l" : "m"}`).join(" ") + " S");
      } else if (it.t === "rect") {
        ops.push(`${P(it.lw ?? 0.35)} w [] 0 d ${P(it.x)} ${P(it.y)} ${P(it.w)} ${P(it.h)} re S`);
      } else if (it.t === "circle") {
        const st = LINE_STYLES[it.style || "solid"];
        const k = 0.5522847498 * it.r;
        const { cx, cy, r } = it;
        ops.push(`${P(it.lw ?? st.w)} w [${(st.dash || []).map(P).join(" ")}] 0 d`);
        ops.push(`${P(cx + r)} ${P(cy)} m ${P(cx + r)} ${P(cy + k)} ${P(cx + k)} ${P(cy + r)} ${P(cx)} ${P(cy + r)} c ${P(cx - k)} ${P(cy + r)} ${P(cx - r)} ${P(cy + k)} ${P(cx - r)} ${P(cy)} c ${P(cx - r)} ${P(cy - k)} ${P(cx - k)} ${P(cy - r)} ${P(cx)} ${P(cy - r)} c ${P(cx + k)} ${P(cy - r)} ${P(cx + r)} ${P(cy - k)} ${P(cx + r)} ${P(cy)} c S`);
      } else if (it.t === "arrow") {
        const [a, b, c] = arrowPts(it);
        ops.push(`${P(a[0])} ${P(a[1])} m ${P(b[0])} ${P(b[1])} l ${P(c[0])} ${P(c[1])} l h f`);
      } else if (it.t === "text") {
        const size = it.size || 2.5;
        const w = textWidth(it.s, size);
        const x = it.anchor === "middle" ? it.x - w / 2 : it.anchor === "end" ? it.x - w : it.x;
        ops.push(`BT /${it.bold ? "F2" : "F1"} ${P(size)} Tf ${P(x)} ${P(it.y)} Td ${pdfStr(it.s)} Tj ET`);
      }
    }
    const stream = ops.join("\n");
    content.push({ W, H, stream });
  }
  // objects: fonts (1, 2), then per page: content stream, page; then pages, info, catalog
  const firstPage = objs.length + 1;
  const pagesObj = firstPage + content.length * 2;
  for (const c of content) {
    const sid = add(`<< /Length ${Buffer.byteLength(c.stream, "latin1")} >>\nstream\n${c.stream}\nendstream`);
    pageIds.push(add(`<< /Type /Page /Parent ${pagesObj} 0 R /MediaBox [0 0 ${n2(c.W * MM_PT)} ${n2(c.H * MM_PT)}] /Resources << /Font << /F1 ${fontR} 0 R /F2 ${fontB} 0 R >> >> /Contents ${sid} 0 R >>`));
  }
  add(`<< /Type /Pages /Kids [${pageIds.map((i) => `${i} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
  const info = add(`<< /Title ${pdfStr(meta.title || "ConKay drawing")} /Producer ${pdfStr(meta.producer || "ConKay drawing.ga")} /Keywords ${pdfStr(JSON.stringify(meta))} >>`);
  const catalog = add(`<< /Type /Catalog /Pages ${pagesObj} 0 R >>`);
  let pdf = "%PDF-1.4\n%\xe2\xe3\xcf\xd3\n";
  const offsets = [];
  objs.forEach((body, i) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, "latin1");
}
