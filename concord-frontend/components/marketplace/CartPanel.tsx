'use client';

import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check, ShoppingCart, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useMarketplace } from './MarketplaceProvider';
import { LICENSE_TIERS, formatPrice, typeIcon, type LicensePrice } from './types';

export function CartPanel() {
  const m = useMarketplace();
  const [showCheckoutConfirm, setShowCheckoutConfirm] = useState(false);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      {m.cart.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <ShoppingCart className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">Your cart is empty</p>
          <p className="text-sm mt-1">Browse the marketplace to find creative assets.</p>
          <button onClick={() => m.setTab('browse')} className="btn-neon purple mt-4 text-sm">
            Browse Marketplace
          </button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {m.cart.map((ci) => {
              const Icon = typeIcon(ci.item.type);
              return (
                <div key={ci.item.id} className="panel p-4 flex items-center gap-4">
                  <div className="w-12 h-12 rounded-lg bg-lattice-deep flex items-center justify-center shrink-0">
                    <Icon className="w-5 h-5 text-gray-400" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{ci.item.title}</p>
                    <p className="text-xs text-gray-400">
                      {ci.item.creator.name} -- {ci.item.type}
                    </p>
                  </div>
                  <select
                    value={ci.license}
                    onChange={(e) => m.updateCartLicense(ci.item.id, e.target.value)}
                    className="px-2 py-1.5 bg-lattice-surface border border-lattice-border rounded-lg text-sm"
                  >
                    {LICENSE_TIERS.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} - {formatPrice(ci.item.prices[t.id as keyof LicensePrice])}
                      </option>
                    ))}
                  </select>
                  <span className="text-neon-green font-bold w-16 text-right tabular-nums">
                    {formatPrice(ci.price)}
                  </span>
                  <button
                    onClick={() => m.removeFromCart(ci.item.id)}
                    className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
                    aria-label="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>

          <div className="panel p-5 space-y-3">
            <div className="flex items-center justify-between text-sm text-gray-400 tabular-nums">
              <span>
                Subtotal ({m.cart.length} item{m.cart.length !== 1 ? 's' : ''})
              </span>
              <span>{formatPrice(m.cartTotal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm text-gray-400 tabular-nums">
              <span>Platform fee ({(m.marketplaceFeeRate * 100).toFixed(0)}%)</span>
              <span>
                {formatPrice(Math.round(m.cartTotal * m.marketplaceFeeRate * 100) / 100)}
              </span>
            </div>
            <div className="border-t border-lattice-border pt-3 flex items-center justify-between">
              <span className="font-bold">Total</span>
              <span className="text-neon-green text-xl font-bold tabular-nums">
                {formatPrice(m.cartTotal)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-gray-400 tabular-nums">
              <span>Your balance</span>
              <span className={cn(m.userBalance < m.cartTotal ? 'text-red-400' : 'text-gray-400')}>
                {formatPrice(m.userBalance)}
              </span>
            </div>
            {m.checkoutError && (
              <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
                {m.checkoutError}
              </p>
            )}
            <button
              onClick={() => setShowCheckoutConfirm(true)}
              disabled={m.checkoutLoading || m.cart.length === 0 || m.userBalance < m.cartTotal}
              className={cn(
                'btn-neon purple w-full py-3 text-sm font-semibold flex items-center justify-center gap-2',
                (m.checkoutLoading || m.userBalance < m.cartTotal) && 'opacity-50 cursor-not-allowed'
              )}
            >
              {m.checkoutLoading ? (
                <>
                  <span className="animate-spin">⟳</span> Processing...
                </>
              ) : m.userBalance < m.cartTotal ? (
                <>Insufficient balance</>
              ) : (
                <>
                  <Check className="w-4 h-4" /> Checkout
                </>
              )}
            </button>

            <AnimatePresence>
              {showCheckoutConfirm && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
                  onClick={() => setShowCheckoutConfirm(false)}
                >
                  <motion.div
                    initial={{ scale: 0.95, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.95, opacity: 0 }}
                    className="bg-lattice-bg border border-lattice-border rounded-xl w-full max-w-md p-6 space-y-4"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <h3 className="text-lg font-bold">Confirm Purchase</h3>
                    <div className="space-y-2 text-sm text-gray-400 tabular-nums">
                      {m.cart.map((ci) => (
                        <div key={ci.item.id} className="flex items-center justify-between">
                          <span className="truncate">
                            {ci.item.title} ({ci.license})
                          </span>
                          <span className="text-neon-green font-mono">{formatPrice(ci.price)}</span>
                        </div>
                      ))}
                      <div className="border-t border-lattice-border pt-2 space-y-1">
                        <div className="flex items-center justify-between text-gray-400 text-xs">
                          <span>Platform fee ({(m.marketplaceFeeRate * 100).toFixed(0)}%)</span>
                          <span>
                            {formatPrice(
                              Math.round(m.cartTotal * m.marketplaceFeeRate * 100) / 100
                            )}
                          </span>
                        </div>
                        <div className="flex items-center justify-between font-bold text-white">
                          <span>Total</span>
                          <span className="text-neon-green">{formatPrice(m.cartTotal)}</span>
                        </div>
                      </div>
                    </div>
                    {m.checkoutError && (
                      <p className="text-xs text-red-400 bg-red-400/10 rounded-lg px-3 py-2">
                        {m.checkoutError}
                      </p>
                    )}
                    <div className="flex items-center justify-end gap-2 pt-2">
                      <button
                        onClick={() => {
                          setShowCheckoutConfirm(false);
                          m.setCheckoutError(null);
                        }}
                        className="px-4 py-2 text-sm text-gray-400 hover:text-white transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          setShowCheckoutConfirm(false);
                          void m.handleCheckout();
                        }}
                        disabled={m.checkoutLoading}
                        className={cn(
                          'btn-neon purple text-sm',
                          m.checkoutLoading && 'opacity-50 cursor-not-allowed'
                        )}
                      >
                        {m.checkoutLoading ? 'Processing...' : 'Confirm Purchase'}
                      </button>
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </motion.div>
  );
}
