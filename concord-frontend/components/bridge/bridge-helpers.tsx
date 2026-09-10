import type { ReactNode } from 'react';
import {
  MessageSquare, Baby, Skull, Shield, Search, Eye,
} from 'lucide-react';

export function EmptyCard({ icon, message, hint }: { icon: ReactNode; message: string; hint: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-64 text-center">
      <div className="w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center mb-4 text-zinc-400">{icon}</div>
      <p className="text-zinc-400 font-medium">{message}</p>
      <p className="text-sm text-zinc-600 mt-1 max-w-md">{hint}</p>
    </div>
  );
}

export function VerdictBadge({ verdict }: { verdict: string }) {
  const colors: Record<string, string> = {
    accept: 'bg-green-500/20 text-green-400',
    modify: 'bg-amber-500/20 text-amber-400',
    quarantine: 'bg-red-500/20 text-red-400',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded-full ${colors[verdict] || 'bg-zinc-700 text-zinc-400'}`}>
      {verdict}
    </span>
  );
}

export function actionIcon(action: string) {
  if (action.includes('debate')) return <MessageSquare className="w-4 h-4 text-amber-400" />;
  if (action.includes('birth') || action.includes('awaken')) return <Baby className="w-4 h-4 text-green-400" />;
  if (action.includes('death') || action.includes('dormant')) return <Skull className="w-4 h-4 text-red-400" />;
  if (action.includes('validation') || action.includes('submit')) return <Shield className="w-4 h-4 text-blue-400" />;
  if (action.includes('query') || action.includes('response')) return <Search className="w-4 h-4 text-purple-400" />;
  return <Eye className="w-4 h-4 text-zinc-400" />;
}

export function formatAction(action: string): string {
  return action.replace(/\./g, ' → ').replace(/_/g, ' ');
}
