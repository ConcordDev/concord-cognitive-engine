/**
 * VendorUI.tsx — buy/sell UI with faction reputation discounts.
 *
 * Two-column layout: vendor inventory on left, player sellable on right.
 * Prices adjusted by faction reputation (higher rep = lower prices).
 */

import { useState } from 'react';

interface VendorItem {
  id: string;
  name: string;
  icon: string;
  basePrice: number;
  stock: number;
  category: string;
  factionLocked?: string;  // require faction rep to buy
}

interface VendorUIProps {
  vendorName: string;
  vendorFaction: string;
  factionRep: number;
  vendorItems: VendorItem[];
  playerItems: { id: string; name: string; icon: string; sellPrice: number; quantity: number }[];
  playerMoney: number;
  onBuy?: (item: VendorItem, quantity: number) => void;
  onSell?: (itemId: string, quantity: number) => void;
  onClose?: () => void;
}

const REP_DISCOUNT_TIERS = [
  { min: 0,  discount: 0 },
  { min: 25, discount: 0.05 },
  { min: 50, discount: 0.10 },
  { min: 75, discount: 0.20 },
  { min: 100, discount: 0.30 },
];

function getDiscount(rep: number): number {
  let best = 0;
  for (const tier of REP_DISCOUNT_TIERS) {
    if (rep >= tier.min) best = tier.discount;
  }
  return best;
}

export function VendorUI({
  vendorName, vendorFaction, factionRep, vendorItems, playerItems,
  playerMoney, onBuy, onSell, onClose,
}: VendorUIProps) {
  const discount = getDiscount(factionRep);
  const [buyQty, setBuyQty] = useState(1);
  const [sellQty, setSellQty] = useState(1);

  return (
    <div style={{
      position: 'fixed', inset: 0,
      background: 'rgba(0,0,0,0.75)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      zIndex: 300,
    }} data-testid="vendor-ui">
      <div style={{
        background: 'rgba(20, 20, 25, 0.95)',
        border: '2px solid #d98c33',
        borderRadius: 8,
        padding: 16,
        width: 720,
        color: '#e0d8c8',
        fontFamily: 'Georgia, serif',
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
          <span style={{ fontSize: 18, fontWeight: 'bold' }}>{vendorName}</span>
          <span style={{ fontSize: 14, color: '#aaa' }}>
            {vendorFaction} • Rep {factionRep} • {(discount * 100).toFixed(0)}% off
          </span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: '#d98c33', cursor: 'pointer', fontSize: 18 }}>×</button>
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 14 }}>
          <span>Buy</span>
          <span style={{ color: '#d98c33' }}>💰 {playerMoney}</span>
          <span>Sell</span>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Vendor inventory */}
          <div>
            <div style={headerStyle}>Vendor Inventory</div>
            <div style={listStyle}>
              {vendorItems.map((item) => {
                const finalPrice = Math.floor(item.basePrice * (1 - discount));
                const canBuy = !item.factionLocked || factionRep >= 25;
                return (
                  <div key={item.id} style={itemRowStyle}>
                    <span style={{ fontSize: 20 }}>{item.icon}</span>
                    <span style={{ flex: 1 }}>{item.name}</span>
                    <span style={{ color: '#aaa' }}>×{item.stock}</span>
                    <span style={{ color: '#ff8000' }}>{finalPrice}g</span>
                    <button
                      disabled={!canBuy || playerMoney < finalPrice}
                      onClick={() => onBuy?.(item, buyQty)}
                      style={buyButtonStyle(canBuy && playerMoney >= finalPrice)}
                    >
                      Buy
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Player sell */}
          <div>
            <div style={headerStyle}>Your Inventory</div>
            <div style={listStyle}>
              {playerItems.map((item) => (
                <div key={item.id} style={itemRowStyle}>
                  <span style={{ fontSize: 20 }}>{item.icon}</span>
                  <span style={{ flex: 1 }}>{item.name}</span>
                  <span style={{ color: '#aaa' }}>×{item.quantity}</span>
                  <span style={{ color: '#7ed321' }}>{item.sellPrice}g</span>
                  <button
                    onClick={() => onSell?.(item.id, sellQty)}
                    style={sellButtonStyle}
                  >
                    Sell
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: '#888' }}>
          Press ESC to close. Higher faction reputation unlocks better prices.
        </div>
      </div>
    </div>
  );
}

const headerStyle: React.CSSProperties = {
  fontSize: 14, fontWeight: 'bold', color: '#d98c33', marginBottom: 8,
};

const listStyle: React.CSSProperties = {
  maxHeight: 320, overflowY: 'auto',
  border: '1px solid #3a3a45', borderRadius: 4, padding: 4,
};

const itemRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 8,
  padding: '4px 8px', fontSize: 13,
};

const buyButtonStyle = (enabled: boolean): React.CSSProperties => ({
  background: enabled ? '#3a5a3a' : '#3a3a3a',
  color: enabled ? '#fff' : '#888',
  border: 'none', padding: '2px 8px', borderRadius: 3, cursor: enabled ? 'pointer' : 'not-allowed',
});

const sellButtonStyle: React.CSSProperties = {
  background: '#5a3a3a', color: '#fff',
  border: 'none', padding: '2px 8px', borderRadius: 3, cursor: 'pointer',
};

export default VendorUI;
