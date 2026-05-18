'use client';

import { useCallback } from 'react';
import { callBrowserAgentMacro, type BrowserAction, type BrowserTask } from '@/lib/api/browser-agent';
import {
  PauseCircle, PlayCircle, StopCircle, AlertTriangle, MousePointer, Type, Eye, Camera,
  Navigation, ExternalLink, FileText, Activity, Hash,
} from 'lucide-react';

interface Props { task: BrowserTask; actions: BrowserAction[]; onRefresh: () => void; }

const KIND_ICON: Record<string, React.ReactNode> = {
  navigate: <Navigation className="w-3.5 h-3.5" />,
  click: <MousePointer className="w-3.5 h-3.5" />,
  type: <Type className="w-3.5 h-3.5" />,
  screenshot: <Camera className="w-3.5 h-3.5" />,
  extract: <FileText className="w-3.5 h-3.5" />,
  scroll: <Activity className="w-3.5 h-3.5" />,
  llm_step: <Eye className="w-3.5 h-3.5" />,
  approval: <AlertTriangle className="w-3.5 h-3.5" />,
};

export function BrowserActionStream({ task, actions, onRefresh }: Props) {
  const pause = useCallback(async () => { await callBrowserAgentMacro('task_pause', { id: task.id }); onRefresh(); }, [task.id, onRefresh]);
  const resume = useCallback(async () => { await callBrowserAgentMacro('task_resume', { id: task.id }); onRefresh(); }, [task.id, onRefresh]);
  const cancel = useCallback(async () => {
    if (!confirm('Stop this task? It cannot be resumed.')) return;
    await callBrowserAgentMacro('task_cancel', { id: task.id, note: 'User stopped' });
    onRefresh();
  }, [task.id, onRefresh]);

  const isLive = task.status === 'running' || task.status === 'awaiting_approval';
  const isPaused = task.status === 'paused';

  return (
    <div className="flex flex-col h-full">
      <div className="px-3 py-2 border-b border-white/10 flex items-center gap-2 bg-black/30">
        <div className="text-xs text-white/60 flex-1 truncate">
          <span className="font-mono">{task.id.slice(0, 16)}</span> · {task.goal}
        </div>
        {isLive && (
          <button onClick={pause} className="px-2 py-1 text-xs rounded bg-amber-500/20 hover:bg-amber-500/30 text-amber-200 flex items-center gap-1"><PauseCircle className="w-3 h-3" /> Pause</button>
        )}
        {isPaused && (
          <button onClick={resume} className="px-2 py-1 text-xs rounded bg-green-500/20 hover:bg-green-500/30 text-green-200 flex items-center gap-1"><PlayCircle className="w-3 h-3" /> Resume</button>
        )}
        {(isLive || isPaused) && (
          <button onClick={cancel} className="px-2 py-1 text-xs rounded bg-red-500/20 hover:bg-red-500/30 text-red-300 flex items-center gap-1"><StopCircle className="w-3 h-3" /> Stop</button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3 space-y-1">
        {actions.length === 0 ? (
          <div className="text-center text-white/30 text-sm py-12">
            No actions yet. {task.status === 'pending' && 'Task is queued — agent will start shortly.'}
          </div>
        ) : (
          actions.map((a) => (
            <div key={a.id} className={`flex items-start gap-2 px-2 py-1.5 rounded text-sm ${
              a.destructive ? 'bg-amber-500/5 border border-amber-400/20' :
              !a.success ? 'bg-red-500/5 border border-red-400/20' :
              'hover:bg-white/5'
            }`}>
              <span className="text-white/40 mt-0.5 text-xs font-mono w-8 flex items-center gap-1 flex-shrink-0">
                <Hash className="w-2.5 h-2.5" />{a.step_index}
              </span>
              <span className={`mt-0.5 ${a.destructive ? 'text-amber-300' : 'text-cyan-400'}`}>
                {KIND_ICON[a.kind] || <Activity className="w-3.5 h-3.5" />}
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-white/90 flex items-center gap-2">
                  <span className="font-medium text-xs uppercase text-white/60">{a.kind}</span>
                  {a.url && (
                    <a href={a.url} target="_blank" rel="noreferrer" className="text-cyan-300 hover:text-cyan-200 text-xs truncate inline-flex items-center gap-1">
                      <ExternalLink className="w-2.5 h-2.5 flex-shrink-0" />
                      <span className="truncate max-w-md">{a.url}</span>
                    </a>
                  )}
                </div>
                {a.thought && <div className="text-xs text-white/60 italic mt-0.5">{a.thought}</div>}
                {a.value && <div className="text-xs text-white/70 mt-0.5 font-mono truncate">{a.value}</div>}
                {a.screenshot_url && (
                  <img src={a.screenshot_url} alt="" className="mt-1 max-w-xs rounded border border-white/10 cursor-zoom-in"
                       onClick={() => window.open(a.screenshot_url!, '_blank')} />
                )}
              </div>
              <div className="text-xs text-white/30 text-right flex-shrink-0">
                <div>{a.cost_cents > 0 && `${a.cost_cents}¢`}</div>
                {a.latency_ms != null && <div>{a.latency_ms}ms</div>}
              </div>
            </div>
          ))
        )}
      </div>

      {task.result_summary && (
        <div className="border-t border-white/10 p-3 bg-cyan-500/5">
          <div className="text-xs uppercase tracking-wide text-cyan-300 mb-1">Result</div>
          <div className="text-sm text-white/90 whitespace-pre-wrap">{task.result_summary}</div>
        </div>
      )}
    </div>
  );
}
