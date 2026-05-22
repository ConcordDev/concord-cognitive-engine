'use client';

import { useEffect, useState } from 'react';
import { ClipboardList, Loader2, Clock, User } from 'lucide-react';
import { api } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export interface WorkOrder {
  id: string;
  number: string;
  product: string;
  quantity: number;
  quantityProduced: number;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'queued' | 'in_progress' | 'on_hold' | 'complete';
  dueDate: string;
  assignedTo?: string;
  machine?: string;
}

export function WorkOrderBoard() {
  const [orders, setOrders] = useState<WorkOrder[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    (async () => {
      try {
        const res = await api.post('/api/lens/run', { domain: 'manufacturing', action: 'work-orders', input: {} });
        setOrders((res.data?.result?.orders || []) as WorkOrder[]);
      } catch (e) { console.error(e); }
      finally { setLoading(false); }
    })();
  }, []);

  const byStatus = {
    queued: orders.filter(o => o.status === 'queued'),
    in_progress: orders.filter(o => o.status === 'in_progress'),
    on_hold: orders.filter(o => o.status === 'on_hold'),
    complete: orders.filter(o => o.status === 'complete'),
  };

  return (
    <div className="bg-[#0d1117] border border-cyan-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <ClipboardList className="w-4 h-4 text-cyan-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Work orders</span>
        <span className="ml-auto text-[10px] text-gray-500">{orders.length} active</span>
      </header>
      {loading ? (
        <div className="flex items-center justify-center py-6 text-xs text-gray-500"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2 p-3">
          {(['queued', 'in_progress', 'on_hold', 'complete'] as const).map(s => (
            <div key={s} className="space-y-1.5">
              <div className="text-[10px] uppercase tracking-wider text-gray-500 px-1">{s.replace(/_/g, ' ')} <span className="text-cyan-300">{byStatus[s].length}</span></div>
              {byStatus[s].map(o => {
                const pct = o.quantity > 0 ? (o.quantityProduced / o.quantity) * 100 : 0;
                const days = Math.ceil((new Date(o.dueDate).getTime() - Date.now()) / 86400000);
                return (
                  <div key={o.id} className="p-2 bg-white/[0.02] border border-white/10 rounded text-xs">
                    <div className="flex items-center gap-1.5">
                      <span className="font-mono text-cyan-300">{o.number}</span>
                      <span className={cn('text-[8px] uppercase px-1 py-0.5 rounded font-bold',
                        o.priority === 'urgent' ? 'bg-red-500/30 text-red-200' :
                        o.priority === 'high' ? 'bg-orange-500/30 text-orange-200' :
                        o.priority === 'medium' ? 'bg-yellow-500/30 text-yellow-200' :
                        'bg-gray-500/30 text-gray-200'
                      )}>{o.priority}</span>
                    </div>
                    <div className="text-white mt-0.5 truncate">{o.product}</div>
                    <div className="text-[10px] text-gray-500 mt-1">
                      {o.quantityProduced}/{o.quantity} {o.machine ? `· ${o.machine}` : ''}
                    </div>
                    <div className="h-1 bg-white/10 rounded-full mt-1 overflow-hidden">
                      <div className="h-full bg-cyan-500" style={{ width: `${pct}%` }} />
                    </div>
                    <div className="flex items-center gap-2 text-[9px] text-gray-500 mt-1">
                      <Clock className="w-3 h-3" /> {days < 0 ? <span className="text-red-300">overdue {-days}d</span> : `${days}d`}
                      {o.assignedTo && <span className="inline-flex items-center gap-0.5 ml-auto"><User className="w-3 h-3" /> {o.assignedTo}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
export default WorkOrderBoard;
