// Read an artifact upload body.
//
// The art page used to POST multipart/form-data (FormData). The upload
// route read the raw stream and treated Content-Type as the file MIME, so
// multipart/form-data failed the allowlist with a bare 400. Both shapes
// are accepted here:
//   - raw file bytes, Content-Type: file.type, plus x-filename / x-title / x-domain
//   - multipart/form-data with file or files fields and domain / title fields
//
// Failures are { ok:false, status:4xx, error } with a sentence the UI can show.

function decodeHeader(value) {
  const s = String(value || "");
  if (!s) return "";
  try { return decodeURIComponent(s); } catch { return s; }
}

export function parseMultipart(buffer, contentType) {
  const header = String(contentType || "");
  if (!/multipart\/form-data/i.test(header)) {
    return { ok: false, status: 400, error: "Expected a multipart upload body." };
  }
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(header);
  if (!match) {
    return {
      ok: false,
      status: 400,
      error: "Multipart upload is missing a boundary. Send the file bytes with Content-Type set to the file type and x-filename, x-title, and x-domain headers.",
    };
  }
  const boundary = (match[1] || match[2]).trim();
  const delim = Buffer.from(`--${boundary}`);
  const files = [];
  const fields = {};
  let start = buffer.indexOf(delim);
  if (start < 0) {
    return { ok: false, status: 400, error: "Multipart body did not contain the declared boundary." };
  }
  while (start >= 0 && start < buffer.length) {
    let partStart = start + delim.length;
    if (buffer[partStart] === 45 && buffer[partStart + 1] === 45) break;
    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) partStart += 2;
    else if (buffer[partStart] === 10) partStart += 1;
    const next = buffer.indexOf(delim, partStart);
    if (next < 0) break;
    let partEnd = next;
    if (partEnd >= 2 && buffer[partEnd - 2] === 13 && buffer[partEnd - 1] === 10) partEnd -= 2;
    else if (partEnd >= 1 && buffer[partEnd - 1] === 10) partEnd -= 1;
    const part = buffer.subarray(partStart, partEnd);
    const crlf = part.indexOf("\r\n\r\n");
    const lf = crlf >= 0 ? -1 : part.indexOf("\n\n");
    const sepAt = crlf >= 0 ? crlf : lf;
    const sepLen = crlf >= 0 ? 4 : 2;
    if (sepAt < 0) { start = next; continue; }
    const head = part.subarray(0, sepAt).toString("utf8");
    const body = part.subarray(sepAt + sepLen);
    const nameMatch = /name="([^"]+)"/i.exec(head) || /name=([^;\r\n]+)/i.exec(head);
    const filenameMatch = /filename="([^"]*)"/i.exec(head) || /filename=([^;\r\n]+)/i.exec(head);
    const typeMatch = /content-type:\s*([^\r\n;]+)/i.exec(head);
    const name = nameMatch ? nameMatch[1].trim().replace(/^"|"$/g, "") : "";
    if (filenameMatch) {
      const filename = filenameMatch[1].trim().replace(/^"|"$/g, "") || "upload";
      files.push({
        field: name || "file",
        filename,
        contentType: (typeMatch ? typeMatch[1].trim() : "application/octet-stream").toLowerCase(),
        buffer: Buffer.from(body),
      });
    } else if (name) {
      fields[name] = body.toString("utf8").replace(/\0/g, "").trim();
    }
    start = next;
  }
  if (!files.length) {
    return { ok: false, status: 400, error: "No file was included in the upload." };
  }
  return { ok: true, files, fields };
}

export async function readUploadRequest(req) {
  const contentType = String(req.headers?.["content-type"] || "");
  const chunks = [];
  try {
    for await (const chunk of req) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
  } catch (err) {
    return { ok: false, status: 400, error: `Could not read the upload body: ${err?.message || err}` };
  }
  const buffer = chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
  if (!buffer.length) {
    return {
      ok: false,
      status: 400,
      error: "Upload body was empty. Send the raw file with Content-Type set to the file type and x-filename, x-title, and x-domain headers, or a multipart form with a file field.",
    };
  }
  if (/multipart\/form-data/i.test(contentType)) {
    const parsed = parseMultipart(buffer, contentType);
    if (!parsed.ok) return parsed;
    const domain = parsed.fields.domain || decodeHeader(req.headers?.["x-domain"]);
    const title = parsed.fields.title || decodeHeader(req.headers?.["x-title"]);
    return { ok: true, files: parsed.files, domain, title };
  }
  const mime = contentType.split(";")[0].trim().toLowerCase();
  if (!mime || mime === "application/json" || mime === "application/x-www-form-urlencoded" || mime === "text/plain") {
    return {
      ok: false,
      status: 400,
      error: "Upload expected the raw file body (Content-Type: the file type, for example image/png) with x-filename, x-title, and x-domain headers, or multipart/form-data. A form or JSON body was received instead.",
    };
  }
  const filename = decodeHeader(req.headers?.["x-filename"]) || `upload_${Date.now()}`;
  const title = decodeHeader(req.headers?.["x-title"]) || filename;
  const domain = decodeHeader(req.headers?.["x-domain"]);
  return {
    ok: true,
    files: [{ field: "file", filename, contentType: mime, buffer }],
    domain,
    title,
  };
}
