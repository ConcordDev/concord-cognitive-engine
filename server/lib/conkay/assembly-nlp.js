// server/lib/conkay/assembly-nlp.js
// Fail-closed regex parser for assembly chat revise utterances.
// "build assembly …" / "add beam …" / "move part X …" / "remove part X"

export function parseAssemblyUtterance(text, { parts = [] } = {}) {
  const raw = String(text || '').trim();
  if (!raw) return { ok: false, error: 'empty_text', code: 'EMPTY' };
  const lower = raw.toLowerCase();

  if (/^(list|show)\s+(parts?|assembly)\b/.test(lower) || lower === 'list parts') {
    return { ok: true, action: 'list', text: raw };
  }

  if (/^undo\b/.test(lower) || lower === 'u') {
    return { ok: true, action: 'undo', text: raw };
  }
  if (/^redo\b/.test(lower)) {
    return { ok: true, action: 'redo', text: raw };
  }

  // build assembly [name]
  let m = lower.match(/^build\s+assembly(?:\s+(?:named\s+|called\s+)?(.+))?$/i);
  if (m || /^create\s+assembly\b/.test(lower)) {
    const nameMatch = raw.match(/(?:named|called)\s+([A-Za-z0-9_\- ]{1,64})/i);
    return {
      ok: true,
      action: 'build',
      name: (nameMatch ? nameMatch[1] : m && m[1] ? m[1] : 'assembly').trim().slice(0, 64),
      text: raw,
    };
  }

  // add <design text>
  m = lower.match(/^add\s+(.+)$/);
  if (m) {
    const addText = raw.replace(/^add\s+/i, '').trim();
    // optional "at x,y,z"
    let transform = null;
    const at = addText.match(/\bat\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/i);
    let designText = addText;
    if (at) {
      transform = {
        position: { x: Number(at[1]), y: Number(at[2]), z: Number(at[3]) },
      };
      designText = addText.slice(0, at.index).trim();
    }
    return {
      ok: true,
      action: 'add',
      addText: designText || 'steel I-beam 6m',
      name: undefined,
      transform,
      text: raw,
    };
  }

  // move part <id|name> to x,y,z  OR  move <id|name> by dx,dy,dz
  m = raw.match(/^move\s+(?:part\s+)?(.+?)\s+to\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/i);
  if (m) {
    const ref = m[1].trim();
    const part = resolvePartRef(ref, parts);
    if (!part) return { ok: false, error: `part_not_found:${ref}`, code: 'PART_NOT_FOUND' };
    return {
      ok: true,
      action: 'move',
      partId: part.id,
      partName: part.name,
      transform: { position: { x: Number(m[2]), y: Number(m[3]), z: Number(m[4]) } },
      text: raw,
    };
  }

  m = raw.match(/^move\s+(?:part\s+)?(.+?)\s+by\s+(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/i);
  if (m) {
    const ref = m[1].trim();
    const part = resolvePartRef(ref, parts);
    if (!part) return { ok: false, error: `part_not_found:${ref}`, code: 'PART_NOT_FOUND' };
    const pos = part.transform?.position || { x: 0, y: 0, z: 0 };
    return {
      ok: true,
      action: 'move',
      partId: part.id,
      partName: part.name,
      transform: {
        position: {
          x: Number(pos.x) + Number(m[2]),
          y: Number(pos.y) + Number(m[3]),
          z: Number(pos.z) + Number(m[4]),
        },
      },
      text: raw,
    };
  }

  // remove part <id|name>
  m = raw.match(/^(?:remove|delete)\s+(?:part\s+)?(.+)$/i);
  if (m) {
    const ref = m[1].trim();
    const part = resolvePartRef(ref, parts);
    if (!part) return { ok: false, error: `part_not_found:${ref}`, code: 'PART_NOT_FOUND' };
    return { ok: true, action: 'remove', partId: part.id, partName: part.name, text: raw };
  }

  return {
    ok: false,
    error: 'unrecognized_assembly_utterance — try: build assembly | add <beam…> | move part <id> to x,y,z | remove part <id>',
    code: 'UNRECOGNIZED',
  };
}

function resolvePartRef(ref, parts) {
  if (!ref || !Array.isArray(parts)) return null;
  const r = String(ref).trim().toLowerCase();
  let hit = parts.find((p) => String(p.id).toLowerCase() === r);
  if (hit) return hit;
  hit = parts.find((p) => String(p.name).toLowerCase() === r);
  if (hit) return hit;
  hit = parts.find((p) => String(p.name).toLowerCase().includes(r) || String(p.kind).toLowerCase() === r);
  if (hit) return hit;
  // short uuid prefix
  hit = parts.find((p) => String(p.id).toLowerCase().startsWith(r));
  return hit || null;
}
