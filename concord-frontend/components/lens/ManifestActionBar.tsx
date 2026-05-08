'use client';

/**
 * ManifestActionBar — auto-renders a LensActionBar derived from the
 * lens's manifest entry. Reads lensId from <LensShell> context, looks
 * up `manifest.actions: string[]`, and turns each action into a button
 * that calls `runDomain(domain, action)` via apiHelpers.
 *
 * The point: every lens with a manifest entry gets primary verbs in
 * its chrome with zero per-lens code. Lenses that need bespoke action
 * wiring still use <LensActionBar /> directly with a hand-built array.
 *
 * Use:
 *   <ManifestActionBar />               // inside a <LensShell>
 *   <ManifestActionBar lensId="chat" /> // outside one (rare)
 *   <ManifestActionBar onAction={(action, result) => …} />  // hook results
 */

import { useMemo, useState } from 'react';
import {
  Play, Plus, FileDown, RefreshCw, Trash2, Pencil, ListPlus,
  Search, Send, Mic, Image as ImageIcon, Code, Sparkles, Compass,
  CheckSquare, Settings, Wand2, Activity, Hammer, Tag, MessageSquare,
} from 'lucide-react';

import { apiHelpers } from '@/lib/api/client';
import { getLensManifest } from '@/lib/lenses/manifest';
import { useUIStore } from '@/store/ui';
import { LensActionBar, type LensAction } from './LensActionBar';
import { useLensShell } from './LensShell';

// Lightweight icon map keyed by common verb prefixes / synonyms. Falls
// back to a generic Sparkles icon if nothing matches.
const ACTION_ICONS: Array<[RegExp, React.ReactElement]> = [
  [/^(send|chat|message|reply)/i, <Send className="w-4 h-4" key="send" />],
  [/^(record|capture|mic|listen)/i, <Mic className="w-4 h-4" key="mic" />],
  [/^(image|photo|gallery|preview)/i, <ImageIcon className="w-4 h-4" key="img" />],
  [/^(execute|run|test|simulate)/i, <Play className="w-4 h-4" key="play" />],
  [/^(format|lint|review|refactor|fix)/i, <Code className="w-4 h-4" key="code" />],
  [/^(create|new|add|forge|spawn)/i, <Plus className="w-4 h-4" key="plus" />],
  [/^(export|download|publish|emit)/i, <FileDown className="w-4 h-4" key="exp" />],
  [/^(refresh|reload|sync|update|reindex)/i, <RefreshCw className="w-4 h-4" key="refresh" />],
  [/^(delete|remove|withdraw|archive|prune)/i, <Trash2 className="w-4 h-4" key="del" />],
  [/^(edit|rename|customize|tune)/i, <Pencil className="w-4 h-4" key="edit" />],
  [/^(list|browse|catalog|inventory)/i, <ListPlus className="w-4 h-4" key="list" />],
  [/^(search|query|find|lookup)/i, <Search className="w-4 h-4" key="search" />],
  [/^(branch|merge|fork)/i, <CheckSquare className="w-4 h-4" key="branch" />],
  [/^(explore|navigate|teleport|jump|warp)/i, <Compass className="w-4 h-4" key="compass" />],
  [/^(generate|synth|compose|render)/i, <Wand2 className="w-4 h-4" key="wand" />],
  [/^(build|construct|craft|forge_)/i, <Hammer className="w-4 h-4" key="hammer" />],
  [/^(tag|label|classify|categorize)/i, <Tag className="w-4 h-4" key="tag" />],
  [/^(analyze|summarize|insight)/i, <Sparkles className="w-4 h-4" key="sparkle" />],
  [/^(monitor|observe|status|health)/i, <Activity className="w-4 h-4" key="activity" />],
  [/^(configure|setup|set)/i, <Settings className="w-4 h-4" key="settings" />],
  [/^(comment|discuss|annotate)/i, <MessageSquare className="w-4 h-4" key="msg" />],
];

function iconFor(action: string): React.ReactElement {
  for (const [re, icon] of ACTION_ICONS) {
    if (re.test(action)) return icon;
  }
  return <Sparkles className="w-4 h-4" />;
}

function humanize(action: string): string {
  return action
    .replace(/[-_]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .trim();
}

export interface ManifestActionBarProps {
  /** Override the lens id (default: read from <LensShell>). */
  lensId?: string;
  /** Called after a successful action. Receives the action name + macro result. */
  onAction?: (action: string, result: unknown) => void;
  /** Hide actions matching any of these names (e.g. ["delete"]). */
  exclude?: string[];
  /** Promote one action to primary. Defaults to "create" if present, else first. */
  primary?: string;
  /** Cap at N actions. Defaults to 6 to keep the bar readable. */
  limit?: number;
  className?: string;
}

export function ManifestActionBar({
  lensId: lensIdProp,
  onAction,
  exclude = [],
  primary,
  limit = 6,
  className,
}: ManifestActionBarProps) {
  // Allow standalone use; otherwise pull from LensShell.
  let resolvedLensId = lensIdProp;
  if (!resolvedLensId) {
    try {
      resolvedLensId = useLensShell().lensId; // eslint-disable-line react-hooks/rules-of-hooks
    } catch {
      // No LensShell context — caller must pass lensId.
      resolvedLensId = undefined;
    }
  }

  const addToast = useUIStore((s) => s.addToast);
  const [running, setRunning] = useState<string | null>(null);

  const actions = useMemo<LensAction[]>(() => {
    if (!resolvedLensId) return [];
    const manifest = getLensManifest(resolvedLensId);
    if (!manifest) return [];
    const list = (manifest.actions || []).filter((a) => !exclude.includes(a)).slice(0, limit);
    if (list.length === 0) return [];
    const primaryAction = primary || (list.includes('create') ? 'create' : list[0]);
    return list.map((action) => ({
      id: `manifest:${action}`,
      label: humanize(action),
      icon: iconFor(action),
      primary: action === primaryAction,
      disabled: running != null && running !== action,
      onClick: async () => {
        if (running) return;
        setRunning(action);
        try {
          const res = await apiHelpers.lens.runDomain(manifest.domain, action, {});
          const body = (res as { data?: { ok?: boolean; error?: string; result?: unknown } }).data;
          if (body?.ok === false && body.error) {
            addToast({ type: 'error', message: body.error, duration: 6000 });
          } else {
            addToast({
              type: 'info',
              message: `${humanize(action)} — ok`,
              duration: 3000,
            });
            onAction?.(action, body?.result ?? body);
          }
        } catch (e) {
          addToast({
            type: 'error',
            message: e instanceof Error ? e.message : 'Action failed',
            duration: 6000,
          });
        } finally {
          setRunning(null);
        }
      },
    }));
  }, [resolvedLensId, exclude, primary, limit, running, onAction, addToast]);

  if (actions.length === 0) return null;
  return <LensActionBar actions={actions} className={className} />;
}

export default ManifestActionBar;
