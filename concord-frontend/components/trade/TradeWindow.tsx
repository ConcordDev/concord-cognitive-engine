'use client';

/**
 * Player-to-player trade window — Phase 8 of polish-to-ten.
 *
 * Two-pane offer review with both-sides-confirm gate. Wires to:
 *   - POST /api/player-trade/:id/offer
 *   - POST /api/player-trade/:id/ready
 *   - POST /api/player-trade/:id/cancel
 *   - WebSocket events: trade:offer_updated, trade:other_ready, trade:complete, trade:cancelled
 */

import { useCallback, useEffect, useState } from 'react';
import { subscribe } from '@/lib/realtime/socket';
import { useUIStore } from '@/store/ui';

interface OfferItem {
  inventoryId: string;
  quantity: number;
  itemName?: string;
}

interface Offer {
  items: OfferItem[];
  sparks: number;
  cc: number;
}

const EMPTY_OFFER: Offer = { items: [], sparks: 0, cc: 0 };

export interface TradeWindowProps {
  tradeId: string;
  myUserId: string;
  initiatorId: string;
  recipientId: string;
  onClose: () => void;
}

export function TradeWindow({ tradeId, myUserId, initiatorId, recipientId, onClose }: TradeWindowProps) {
  const [myOffer, setMyOffer] = useState<Offer>(EMPTY_OFFER);
  const [theirOffer, setTheirOffer] = useState<Offer>(EMPTY_OFFER);
  const [myReady, setMyReady] = useState(false);
  const [theirReady, setTheirReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isComplete, setIsComplete] = useState(false);

  const isInitiator = myUserId === initiatorId;
  const otherUserId = isInitiator ? recipientId : initiatorId;

  // Receive other party's updates via WebSocket.
  useEffect(() => {
    const addToast = useUIStore.getState().addToast;

    const offUpdate = subscribe<{ tradeId: string; bySide: string; offer: Offer }>(
      'trade:offer_updated',
      (msg) => {
        if (msg.tradeId !== tradeId) return;
        // Other party changing their offer un-readies BOTH (server-side rule).
        setTheirOffer(msg.offer);
        setMyReady(false);
        setTheirReady(false);
      },
    );

    const offReady = subscribe<{ tradeId: string }>('trade:other_ready', (msg) => {
      if (msg.tradeId !== tradeId) return;
      setTheirReady(true);
    });

    const offComplete = subscribe<{ tradeId: string; received: Offer }>('trade:complete', (msg) => {
      if (msg.tradeId !== tradeId) return;
      setIsComplete(true);
      addToast({
        type: 'success',
        message: `Trade complete — received ${msg.received.items.length} item(s) and ${msg.received.cc} CC`,
        duration: 6000,
      });
    });

    const offCancel = subscribe<{ tradeId: string; by: string }>('trade:cancelled', (msg) => {
      if (msg.tradeId !== tradeId) return;
      const byMe = msg.by === myUserId;
      addToast({
        type: 'warning',
        message: byMe ? 'Trade cancelled' : 'The other party cancelled the trade',
        duration: 5000,
      });
      onClose();
    });

    return () => {
      offUpdate();
      offReady();
      offComplete();
      offCancel();
    };
  }, [tradeId, myUserId, onClose]);

  const submitOffer = useCallback(async (next: Offer) => {
    setMyOffer(next);
    // Changing the offer un-readies both sides.
    setMyReady(false);
    setTheirReady(false);
    setError(null);
    try {
      const res = await fetch(`/api/player-trade/${tradeId}/offer`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(next),
      });
      const json = await res.json();
      if (!json.ok) setError(json.error || 'offer_failed');
    } catch (e) {
      setError(String(e));
    }
  }, [tradeId]);

  const handleReady = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch(`/api/player-trade/${tradeId}/ready`, { method: 'POST' });
      const json = await res.json();
      if (!json.ok) {
        setError(json.error || 'ready_failed');
        return;
      }
      setMyReady(true);
      if (json.complete) setIsComplete(true);
    } catch (e) {
      setError(String(e));
    }
  }, [tradeId]);

  const handleCancel = useCallback(async () => {
    try {
      await fetch(`/api/player-trade/${tradeId}/cancel`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: 'user_cancelled' }),
      });
    } catch {
      // server already cancelled; just close
    }
    onClose();
  }, [tradeId, onClose]);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/70" data-testid="trade-window">
      <div className="bg-gray-900 border border-gray-700 rounded-lg p-6 w-full max-w-2xl shadow-2xl">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-bold text-cyan-300">
            Trading with <span className="text-white">{otherUserId.slice(0, 8)}</span>
          </h2>
          <span className="text-xs text-gray-500">{tradeId.slice(0, 8)}</span>
        </div>

        <div className="grid grid-cols-2 gap-4 mb-4">
          <OfferPane
            title="Your offer"
            offer={myOffer}
            editable={!myReady && !isComplete}
            onChange={submitOffer}
          />
          <OfferPane
            title="Their offer"
            offer={theirOffer}
            editable={false}
            ready={theirReady}
          />
        </div>

        {error && <div className="text-red-400 text-xs mb-3">{error}</div>}

        <div className="flex justify-between items-center">
          <button
            onClick={handleCancel}
            className="px-4 py-2 rounded bg-gray-800 text-gray-300 hover:bg-gray-700 text-sm"
          >
            Cancel
          </button>
          <button
            onClick={handleReady}
            disabled={myReady || isComplete}
            className={
              myReady
                ? 'px-4 py-2 rounded bg-green-700 text-white text-sm font-semibold cursor-not-allowed'
                : 'px-4 py-2 rounded bg-cyan-600 text-white hover:bg-cyan-500 text-sm font-semibold'
            }
          >
            {isComplete ? 'Complete ✓' : myReady ? 'Ready ✓ (waiting on them)' : 'Ready'}
          </button>
        </div>
      </div>
    </div>
  );
}

function OfferPane({
  title,
  offer,
  editable,
  ready,
  onChange,
}: {
  title: string;
  offer: Offer;
  editable: boolean;
  ready?: boolean;
  onChange?: (next: Offer) => void;
}) {
  return (
    <div className="bg-gray-800/60 border border-gray-700 rounded p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-semibold text-gray-300">{title}</h3>
        {ready !== undefined && (
          <span className={ready ? 'text-green-400 text-xs' : 'text-gray-500 text-xs'}>
            {ready ? '✓ Ready' : 'Editing…'}
          </span>
        )}
      </div>
      <div className="space-y-1 text-xs text-gray-300 min-h-[60px]">
        {offer.items.length === 0 && offer.cc === 0 && offer.sparks === 0 && (
          <div className="text-gray-500 italic">Nothing offered</div>
        )}
        {offer.items.map((it) => (
          <div key={it.inventoryId} className="flex justify-between">
            <span>{it.itemName || it.inventoryId.slice(0, 8)}</span>
            <span className="text-gray-400">×{it.quantity}</span>
          </div>
        ))}
        {offer.cc > 0 && <div className="text-yellow-400">{offer.cc} CC</div>}
        {offer.sparks > 0 && <div className="text-amber-300">{offer.sparks} sparks</div>}
      </div>
      {editable && onChange && (
        <div className="mt-2 pt-2 border-t border-gray-700 text-[10px] text-gray-500">
          Drag inventory items here (TODO: inventory picker integration). Edit
          coin amounts via the inventory lens.
        </div>
      )}
    </div>
  );
}
