/**
 * The one way into ConKay's workspace from anywhere else in Concord — Chat's
 * ConKay mode, the ⌘J overlay, and every "Open in ConKay" handoff. All of
 * them land on /lenses/conkay and its per-workspace study, never on a second
 * copy of ConKay.
 */

export interface ConKayHandoff {
  /** A request to send as soon as the workspace opens. */
  ask?: string;
  /** A DTU to open and reason about in the workspace. */
  dtu?: string;
  /** The DTU's title, shown in the handed-off request. */
  title?: string;
  /** A specific ConKay workspace (agent project id). */
  ws?: string;
}

export const CONKAY_WORKSPACE_PATH = '/lenses/conkay';

export function conkayWorkspaceHref(h: ConKayHandoff = {}): string {
  const q = new URLSearchParams();
  if (h.ws) q.set('ws', h.ws);
  const ask = (h.ask || '').trim();
  if (ask) q.set('ask', ask.slice(0, 2000));
  if (h.dtu) {
    q.set('dtu', h.dtu);
    if (h.title) q.set('title', h.title.slice(0, 200));
  }
  const s = q.toString();
  return s ? `${CONKAY_WORKSPACE_PATH}?${s}` : CONKAY_WORKSPACE_PATH;
}
