'use client';

import { useEffect, useState } from 'react';
import { Award, Loader2, Copy } from 'lucide-react';
import { lensRun } from '@/lib/api/client';

interface Cert { id: string; courseTitle: string; institution: string; instructor: string; issuedAt: string; verificationCode: string }

export function CertificatesPanel() {
  const [certs, setCerts] = useState<Cert[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => { refresh(); }, []);

  async function refresh() {
    setLoading(true);
    try {
      const res = await lensRun({ domain: 'education', action: 'certificates-list', input: {} });
      setCerts((res.data?.result?.certificates || []) as Cert[]);
    } catch (e) { console.error('[Certs] failed', e); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-[#0d1117] border border-amber-500/20 rounded-lg overflow-hidden">
      <header className="px-4 py-2 border-b border-white/10 flex items-center gap-2">
        <Award className="w-4 h-4 text-amber-400" />
        <span className="text-xs uppercase font-semibold text-gray-300 tracking-wider">Certificates earned</span>
        <span className="ml-auto text-[10px] text-gray-400">{certs.length}</span>
      </header>
      <div className="max-h-96 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-gray-400"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : certs.length === 0 ? (
          <div className="px-3 py-10 text-center text-xs text-gray-400"><Award className="w-6 h-6 mx-auto mb-2 opacity-30" />No certificates yet. Complete a course to earn one.</div>
        ) : (
          <ul className="divide-y divide-white/5">
            {certs.map(c => (
              <li key={c.id} className="px-3 py-3 hover:bg-white/[0.03]">
                <div className="rounded-md border border-amber-500/20 bg-gradient-to-br from-amber-500/5 to-violet-500/5 p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <Award className="w-5 h-5 text-amber-400" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-semibold text-white truncate">{c.courseTitle}</div>
                      <div className="text-[10px] text-gray-400">{c.institution || 'Concord University'}{c.instructor ? ` · ${c.instructor}` : ''}</div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-[11px] font-mono">
                    <span className="text-gray-400">Verification:</span>
                    <span className="text-amber-300">{c.verificationCode}</span>
                    <button aria-label="Copy" onClick={() => navigator.clipboard?.writeText(c.verificationCode)} className="text-gray-400 hover:text-cyan-300"><Copy className="w-3 h-3" /></button>
                    <span className="ml-auto text-gray-400">Issued {new Date(c.issuedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export default CertificatesPanel;
