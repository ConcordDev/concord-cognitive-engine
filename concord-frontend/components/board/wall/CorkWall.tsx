'use client';

/**
 * Board — the Cork Wall. Index cards pinned in columns on a cork wall,
 * shared for real: invite people by username as viewer, editor or admin,
 * see who else has the board open, and watch their changes land live.
 * My tasks gathers your cards from every board. Automations run on every
 * move; templates start new cards.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Plus, Users } from 'lucide-react';
import { LensShell } from '@/components/lens/LensShell';
import { useLensNav } from '@/hooks/useLensNav';
import { useLensCommand } from '@/hooks/useLensCommand';
import { subscribe } from '@/lib/realtime/socket';
import { WallBoard, type Filter } from './WallBoard';
import { CardBack } from './CardBack';
import { ActivityPanel, AutomationsPanel, FlowPanel, MyTasks, SharePanel, TableView, TimelineView } from './Panels';
import { BoardKeepMenu } from '@/components/board/BoardKeepMenu';
import type { WsBoard } from '@/components/board/workspace-types';
import { avatarColour, bx, canEdit, initials, type Board, type BoardDetail, type BoardSummary, type Member, type Role } from './wx';
import { wallFontVars } from './wallFonts';
import './wall.css';

type View = 'wall' | 'timeline' | 'table';
type Drawer = null | 'share' | 'automations' | 'activity' | 'flow';
interface Changed { boardId: string; by?: { id: string; name: string }; words?: string; cardTitle?: string | null; toColumn?: string | null }

export default function CorkWall() {
  useLensNav('board');
  const [boards, setBoards] = useState<BoardSummary[] | null>(null);
  const [listErr, setListErr] = useState<string | null>(null);
  const [current, setCurrent] = useState<string | 'mine' | null>(null);
  const [detail, setDetail] = useState<BoardDetail | null>(null);
  const [detailErr, setDetailErr] = useState<string | null>(null);
  const [view, setView] = useState<View>('wall');
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [openCard, setOpenCard] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>({ text: '', label: '', who: '', due: '' });
  const [here, setHere] = useState<{ userId: string; name: string; you: boolean }[]>([]);
  const [toast, setToast] = useState<string | null>(null);
  const [newBoard, setNewBoard] = useState('');
  const [rev, setRev] = useState(0);
  const [signedOut, setSignedOut] = useState(false);
  const reloadTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4200); return () => clearTimeout(t); }, [toast]);

  const loadList = useCallback(async () => {
    const r = await bx<{ boards: BoardSummary[] }>('board-list');
    if (!r.ok) {
      if (/sign in|sign up to|unauthori[sz]ed|login required|auth_required|status code 401/i.test(r.error || '')) { setSignedOut(true); setBoards([]); return; }
      setListErr(r.error); return;
    }
    setListErr(null); setBoards(r.result!.boards);
    setCurrent((c) => c ?? (r.result!.boards[0]?.id || 'mine'));
  }, []);
  const loadBoard = useCallback(async (id: string) => {
    const r = await bx<BoardDetail>('board-detail', { id });
    if (!r.ok) { setDetailErr(r.error); setDetail(null); return; }
    setDetailErr(null); setDetail(r.result); setRev((x) => x + 1);
  }, []);
  useEffect(() => { void loadList(); }, [loadList]);
  useEffect(() => {
    if (!current || current === 'mine') { setDetail(null); return; }
    setDetail(null); setDrawer(null); setOpenCard(null); setFilter({ text: '', label: '', who: '', due: '' });
    void loadBoard(current);
  }, [current, loadBoard]);

  // Live: a change on a board I'm on, a board shared with me, a board gone.
  const currentRef = useRef(current);
  currentRef.current = current;
  useEffect(() => {
    const offs = [
      subscribe<Changed>('board:changed', (p) => {
        if (p.boardId === currentRef.current) {
          if (reloadTimer.current) clearTimeout(reloadTimer.current);
          reloadTimer.current = setTimeout(() => { void loadBoard(p.boardId); }, 120);
          if (p.by && detailMeRef.current && p.by.id !== detailMeRef.current) setToast(`${p.by.name} ${p.words}${p.cardTitle ? ` "${p.cardTitle}"` : ''}${p.toColumn ? ` to ${p.toColumn}` : ''}`);
        }
        setRev((x) => x + 1);
      }),
      subscribe<Changed>('board:shared', (p) => { void loadList(); if (p.by && p.by.id !== detailMeRef.current) setToast(`${p.by.name} shared a board with you.`); }),
      subscribe<Changed>('board:removed', (p) => { void loadList(); if (p.boardId === currentRef.current) { setCurrent('mine'); setToast('That board was deleted or you were removed from it.'); } }),
    ];
    return () => offs.forEach((f) => f());
  }, [loadBoard, loadList]);
  const detailMeRef = useRef<string | null>(null);
  detailMeRef.current = detail?.me || null;

  // Presence: "I'm here" every 20 s while a board is open.
  useEffect(() => {
    if (!current || current === 'mine') { setHere([]); return; }
    let live = true;
    const ping = async () => { const r = await bx<{ here: { userId: string; name: string; you: boolean }[] }>('board-presence', { boardId: current }); if (live && r.ok) setHere(r.result!.here); };
    void ping();
    const t = setInterval(ping, 20_000);
    return () => { live = false; clearInterval(t); };
  }, [current]);

  useLensCommand([
    { id: 'board-wall', keys: '1', description: 'The wall', category: 'navigation', action: () => setView('wall') },
    { id: 'board-timeline', keys: '2', description: 'Timeline of due dates', category: 'navigation', action: () => setView('timeline') },
    { id: 'board-table', keys: '3', description: 'Table of cards', category: 'navigation', action: () => setView('table') },
    { id: 'board-mine', keys: 'm', description: 'My tasks across every board', category: 'navigation', action: () => setCurrent('mine') },
  ], { lensId: 'board' });

  const board = detail?.board || null;
  const role: Role | null = detail?.role || null;
  const members: Member[] = detail?.members || [];
  const changed = () => { if (board) void loadBoard(board.id); void loadList(); };
  const labelNames = board ? [...new Set([...(board.labelDefs || []).map((d) => d.name), ...board.cards.flatMap((c) => c.labels)])] : [];
  const own = (boards || []).filter((b) => b.role === 'owner');
  const shared = (boards || []).filter((b) => b.role !== 'owner');

  return (
    <LensShell lensId="board" asMain={false}>
      <main className={`cw ${wallFontVars} flex min-h-[calc(100vh-var(--top-bar-height,56px))] flex-col md:flex-row`} data-testid="cork-wall">
        {/* The board list, pinned down the frame */}
        <nav className="flex shrink-0 flex-col gap-1 border-b-4 border-[var(--cw-frame)] bg-[rgba(60,35,12,0.35)] p-3 md:w-[230px] md:border-b-0 md:border-r-4" aria-label="Boards">
          <h1 className="cw-marker cw-on-cork px-1 text-[36px] leading-none">Boards</h1>
          <button type="button" className={`cw-btn mt-2 justify-start ${current === 'mine' ? 'cw-btn-pin' : ''}`} onClick={() => setCurrent('mine')} data-testid="cw-nav-mine">My tasks <span className="ml-auto cw-mono text-[11px] opacity-70">M</span></button>
          {listErr && <p className="cw-error mt-2" role="alert">{listErr}</p>}
          {!boards && !listErr && <div className="cw-skeleton mt-2 h-24" role="status" aria-label="Loading boards" />}
          {own.length > 0 && <p className="cw-on-cork mt-3 px-1 text-[11px] font-extrabold uppercase tracking-widest opacity-80">Yours</p>}
          {own.map((b) => <BoardLink key={b.id} b={b} on={current === b.id} onClick={() => setCurrent(b.id)} />)}
          {shared.length > 0 && <p className="cw-on-cork mt-3 px-1 text-[11px] font-extrabold uppercase tracking-widest opacity-80">Shared with you</p>}
          {shared.map((b) => <BoardLink key={b.id} b={b} on={current === b.id} onClick={() => setCurrent(b.id)} />)}
          {!signedOut && (
            <form className="mt-3 flex gap-1" onSubmit={async (e) => { e.preventDefault(); if (!newBoard.trim()) return; const r = await bx<{ board: Board }>('board-create', { name: newBoard.trim() }); if (!r.ok) { setToast(r.error || 'Not created.'); return; } setNewBoard(''); await loadList(); setCurrent(r.result!.board.id); }}>
              <span className="relative flex-1">
                <input className="cw-input h-8 pr-12" value={newBoard} onChange={(e) => setNewBoard(e.target.value)} placeholder="New board" maxLength={120} aria-label="New board name" data-testid="cw-new-board" />
                {newBoard.length > 0 && <span className="cw-mono pointer-events-none absolute right-2 top-2 text-[10px] text-[var(--cw-muted)]">{newBoard.length}/120</span>}
              </span>
              <button type="submit" className="cw-btn h-8 px-2" disabled={!newBoard.trim()} aria-label="Create board"><Plus className="h-4 w-4" /></button>
            </form>
          )}
        </nav>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {signedOut ? (
            <div className="cw-panel m-6 max-w-md p-6" data-testid="cw-signed-out">
              <p className="cw-marker text-[30px] leading-none">Sign in to pin things up.</p>
              <p className="mt-2 text-[14px] text-[var(--cw-ink-2)]">Boards are yours and the people you share them with; nothing here is public.</p>
            </div>
          ) : current === 'mine' ? (
            <MyTasks refreshKey={rev} onToast={setToast} onOpen={(bid, cid) => { setCurrent(bid); setView('wall'); setTimeout(() => setOpenCard(cid), 0); }} onImported={async (bid) => { await loadList(); setCurrent(bid); }} />
          ) : detailErr ? (
            <p className="cw-error m-6" role="alert">{detailErr}</p>
          ) : !board || !role ? (
            <div className="flex gap-4 p-4">{[0, 1, 2].map((i) => <div key={i} className="cw-skeleton h-64 w-[280px]" />)}</div>
          ) : (
            <>
              <header className="flex flex-wrap items-center gap-3 px-4 pt-4">
                <BoardTitle board={board} editable={role === 'owner' || role === 'admin'} onSaved={changed} onToast={setToast} />
                <span className="flex -space-x-1.5" aria-label={`${members.length} on this board`}>
                  {members.map((m) => {
                    const isHere = here.some((h) => h.userId === m.userId);
                    return <span key={m.userId} className={`cw-avatar ${isHere ? 'cw-here' : ''}`} style={{ background: avatarColour(m.userId) }} title={`${m.name} · ${m.role}${isHere ? ' · here now' : ''}`}>{initials(m.name)}</span>;
                  })}
                </span>
                {here.filter((h) => !h.you).length > 0 && <span className="cw-on-cork text-[12.5px] font-semibold" data-testid="cw-here">{here.filter((h) => !h.you).map((h) => h.name).join(', ')} here now</span>}
                {role !== 'owner' && <span className="cw-on-cork rounded bg-[rgba(40,20,5,0.35)] px-2 py-0.5 text-[11.5px] font-bold capitalize">{role}</span>}
                <span className="ml-auto flex flex-wrap gap-2">
                  <button type="button" className="cw-btn" aria-pressed={drawer === 'flow'} onClick={() => setDrawer(drawer === 'flow' ? null : 'flow')} data-testid="cw-open-flow">Flow</button>
                  <button type="button" className="cw-btn" aria-pressed={drawer === 'activity'} onClick={() => setDrawer(drawer === 'activity' ? null : 'activity')}>Activity</button>
                  <button type="button" className="cw-btn" aria-pressed={drawer === 'automations'} onClick={() => setDrawer(drawer === 'automations' ? null : 'automations')} data-testid="cw-open-automations">Automations</button>
                  <button type="button" className="cw-btn cw-btn-pin" aria-pressed={drawer === 'share'} onClick={() => setDrawer(drawer === 'share' ? null : 'share')} data-testid="cw-open-share"><Users className="h-4 w-4" /> Share</button>
                </span>
              </header>
              <div className="flex flex-wrap items-end gap-2 px-4 pt-3">
                <div role="tablist" aria-label="Views" className="flex gap-1">
                  {(['wall', 'timeline', 'table'] as View[]).map((v, i) => <button key={v} type="button" role="tab" aria-selected={view === v} className="cw-tab" onClick={() => setView(v)}>{v === 'wall' ? 'Wall' : v === 'timeline' ? 'Timeline' : 'Table'} <span className="cw-mono text-[10px] opacity-60">{i + 1}</span></button>)}
                </div>
                {view === 'wall' && (
                  <div className="ml-auto flex flex-wrap items-center gap-2 pb-1" data-testid="cw-filters">
                    <input className="cw-input h-8 w-40" value={filter.text} onChange={(e) => setFilter({ ...filter, text: e.target.value })} placeholder="Find a card" aria-label="Find a card" />
                    {labelNames.length > 0 && <select className="cw-input h-8 w-auto" value={filter.label} onChange={(e) => setFilter({ ...filter, label: e.target.value })} aria-label="Label filter"><option value="">Any label</option>{labelNames.map((l) => <option key={l} value={l}>{l}</option>)}</select>}
                    {members.length > 1 && <select className="cw-input h-8 w-auto" value={filter.who} onChange={(e) => setFilter({ ...filter, who: e.target.value })} aria-label="Person filter"><option value="">Anyone</option>{members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}</select>}
                    <select className="cw-input h-8 w-auto" value={filter.due} onChange={(e) => setFilter({ ...filter, due: e.target.value as Filter['due'] })} aria-label="Due filter"><option value="">Any date</option><option value="overdue">Overdue</option><option value="week">Due this week</option><option value="none">No date</option></select>
                  </div>
                )}
              </div>
              <div className="flex min-h-0 flex-1">
                <div className="min-h-0 min-w-0 flex-1 border-t-4 border-[var(--cw-panel)]">
                  {view === 'wall' && <WallBoard board={board} role={role} members={members} filter={filter} onOpen={setOpenCard} onMoved={(b) => setDetail((d) => (d ? { ...d, board: b } : d))} onChanged={changed} onToast={setToast} />}
                  {view === 'timeline' && <TimelineView board={board} onOpen={setOpenCard} />}
                  {view === 'table' && <TableView board={board} members={members} onOpen={setOpenCard} />}
                  {!canEdit(role) && view === 'wall' && <p className="cw-on-cork px-4 pb-4 text-[12.5px]">You can look and comment on this board; ask its owner to make you an editor to move cards.</p>}
                </div>
                {drawer && (
                  <aside className="cw-panel cw-scroll m-3 w-[min(380px,90vw)] shrink-0 self-start overflow-y-auto p-4 max-md:fixed max-md:inset-x-3 max-md:bottom-3 max-md:z-50 max-md:max-h-[70vh]" aria-label={drawer}>
                    <div className="mb-3 flex items-center justify-between"><h2 className="cw-marker text-[28px] leading-none">{drawer === 'share' ? 'Who\'s on this board' : drawer === 'automations' ? 'Automations' : drawer === 'flow' ? 'Flow' : 'Activity'}</h2><button type="button" className="cw-btn cw-btn-ghost h-8 px-2" onClick={() => setDrawer(null)} aria-label="Close">×</button></div>
                    {drawer === 'share' && <SharePanel board={board} role={role} members={members} me={detail!.me} onChanged={changed} onLeft={() => { setCurrent('mine'); void loadList(); }} onToast={setToast} />}
                    {drawer === 'flow' && <FlowPanel board={board} />}
                    {drawer === 'automations' && <AutomationsPanel board={board} role={role} members={members} onChanged={changed} onToast={setToast} />}
                    {drawer === 'activity' && <><div className="mb-4 border-b border-dashed border-[var(--cw-line)] pb-3"><BoardKeepMenu board={board as unknown as WsBoard} /></div><ActivityPanel boardId={board.id} refreshKey={rev} /></>}
                  </aside>
                )}
              </div>
            </>
          )}
        </div>
        {openCard && board && role && <CardBack board={board} cardId={openCard} role={role} members={members} me={detail!.me} onClose={() => setOpenCard(null)} onChanged={changed} onToast={setToast} />}
        {toast && <div className="cw-toast cw-pinned-in" role="status" data-testid="cw-toast">{toast}</div>}
      </main>
    </LensShell>
  );
}

function BoardLink({ b, on, onClick }: { b: BoardSummary; on: boolean; onClick: () => void }) {
  return (
    <button type="button" className={`cw-btn justify-start text-left transition-colors ${on ? 'cw-btn-pin' : ''}`} onClick={onClick} aria-current={on ? 'page' : undefined} data-testid="cw-board-link">
      <span className="min-w-0 flex-1 truncate">{b.name}</span>
      <span className="cw-mono text-[11px] opacity-70">{b.role !== 'owner' ? b.owner.name : b.cardCount}</span>
    </button>
  );
}

function BoardTitle({ board, editable, onSaved, onToast }: { board: Board; editable: boolean; onSaved: () => void; onToast: (s: string) => void }) {
  const [v, setV] = useState(board.name);
  useEffect(() => setV(board.name), [board.name]);
  if (!editable) return <h2 className="cw-marker cw-on-cork text-[40px] leading-none">{board.name}</h2>;
  return (
    <input className="cw-marker cw-on-cork w-auto min-w-[160px] max-w-[60vw] bg-transparent text-[40px] leading-none outline-none focus:bg-[rgba(40,20,5,0.25)]" value={v} maxLength={120} aria-label="Board name"
      onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
      onBlur={async () => { if (!v.trim() || v === board.name) { setV(board.name); return; } const r = await bx('board-update', { id: board.id, name: v.trim() }); if (!r.ok) { onToast(r.error || 'Not renamed.'); setV(board.name); return; } onSaved(); }} />
  );
}
