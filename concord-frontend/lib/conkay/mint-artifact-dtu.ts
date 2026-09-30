/**
 * Mint a ConKay toolbar/vertical artifact DTU into the user's locker.
 * Same shape as chat persistArtifact (POST /api/dtus, kind conkay_artifact).
 * Fire-and-forget safe: never throws into UX; returns { ok, id?, error? }.
 */
import { getApiBase } from '@/lib/api/base';

export type MintConkayArtifactResult = {
  ok: boolean;
  id?: string;
  error?: string;
  status?: number;
};

export type MintConkayArtifactArgs = {
  title: string;
  work: Record<string, unknown>;
  tags?: string[];
};

/** Truncate huge fields (gcode, mesh arrays) before storing in DTU body. */
export function summarizeWorkForDtu(work: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(work || {})) {
    if (v == null) {
      out[k] = v;
      continue;
    }
    if (typeof v === 'string') {
      out[k] = v.length > 4000 ? `${v.slice(0, 4000)}…[truncated ${v.length} chars]` : v;
      continue;
    }
    if (Array.isArray(v)) {
      if (v.length > 64 && typeof v[0] === 'number') {
        out[k] = { _truncated: true, length: v.length, sample: v.slice(0, 8) };
      } else if (v.length > 40) {
        out[k] = { _truncated: true, length: v.length, head: v.slice(0, 8) };
      } else {
        out[k] = v;
      }
      continue;
    }
    if (typeof v === 'object') {
      const obj = v as Record<string, unknown>;
      // Common vertical payloads: gcode / mesh / paths
      if (typeof obj.gcode === 'string' && obj.gcode.length > 500) {
        out[k] = {
          ...summarizeWorkForDtu({ ...obj, gcode: undefined as unknown as string }),
          gcode: {
            bytes: obj.gcode.length,
            path: obj.gcodePath || obj.path || null,
            head: String(obj.gcode).slice(0, 120),
          },
        };
        continue;
      }
      if (obj.mesh && typeof obj.mesh === 'object') {
        const mesh = obj.mesh as Record<string, unknown>;
        const positions = mesh.positions as unknown[] | undefined;
        const indices = mesh.indices as unknown[] | undefined;
        out[k] = {
          ...summarizeWorkForDtu({ ...obj, mesh: undefined as unknown as Record<string, unknown> }),
          mesh: {
            id: mesh.id,
            color: mesh.color,
            positionsCount: Array.isArray(positions) ? positions.length : undefined,
            indicesCount: Array.isArray(indices) ? indices.length : undefined,
          },
        };
        continue;
      }
      try {
        const s = JSON.stringify(obj);
        if (s.length > 12000) {
          out[k] = { _truncated: true, bytes: s.length, preview: s.slice(0, 2000) };
        } else {
          out[k] = obj;
        }
      } catch {
        out[k] = '[unserializable]';
      }
      continue;
    }
    out[k] = v;
  }
  return out;
}

export async function mintConkayArtifactDtu(
  args: MintConkayArtifactArgs,
): Promise<MintConkayArtifactResult> {
  try {
    const title = String(args.title || 'artifact').slice(0, 120);
    const work = summarizeWorkForDtu(args.work || {});
    const actionTag =
      typeof work.action === 'string'
        ? `action:${work.action}`
        : typeof work.label === 'string'
          ? `action:${work.label}`
          : '';
    const channel =
      typeof work.channel === 'string'
        ? work.channel
        : typeof work.vertical === 'string'
          ? 'vertical'
          : 'cad';
    const tags = [
      'conkay',
      'artifact',
      channel,
      actionTag,
      ...(Array.isArray(args.tags) ? args.tags : []),
    ]
      .map((t) => String(t || '').trim())
      .filter(Boolean)
      .filter((t, i, a) => a.indexOf(t) === i);

    const base = getApiBase();
    const res = await fetch(`${base}/api/dtus`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        // source:user — toolbar clicks are user-initiated; skips exact-title
        // duplicate_blocked gate in pipelineCommitDTU (system-only dedup).
        // Unique suffix keeps remints honest even if source is stripped.
        source: 'user',
        title: (() => {
          const baseTitle = title.startsWith('ConKay') ? title : `ConKay · ${title}`;
          const stamp = new Date().toISOString().slice(11, 19).replace(/:/g, '');
          return `${baseTitle} · ${stamp}`.slice(0, 120);
        })(),
        content: `**ConKay task artifact**\n\n\`\`\`json\n${JSON.stringify(work, null, 2)}\n\`\`\``,
        tags,
        kind: 'conkay_artifact',
      }),
    });
    const json = (await res.json().catch(() => ({}))) as {
      ok?: boolean;
      dtu?: { id?: string };
      id?: string;
      error?: string;
    };
    const id = json?.dtu?.id || json?.id;
    if (!res.ok || json?.ok === false) {
      return {
        ok: false,
        status: res.status,
        error: json?.error || `HTTP ${res.status}`,
        id: id || undefined,
      };
    }
    return { ok: true, id: id || undefined, status: res.status };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
