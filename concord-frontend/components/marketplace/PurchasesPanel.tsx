'use client';

import { motion } from 'framer-motion';
import { Download } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useUIStore } from '@/store/ui';
import { useMarketplace } from './MarketplaceProvider';
import { LICENSE_TIERS, formatPrice, typeIcon } from './types';

export function PurchasesPanel() {
  const m = useMarketplace();

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-4">
      {m.purchases.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <Download className="w-10 h-10 mx-auto mb-3 opacity-40" />
          <p className="font-medium">No purchases yet</p>
        </div>
      ) : (
        m.purchases.map((p) => {
          const tier = LICENSE_TIERS.find((t) => t.id === p.license);
          const Icon = typeIcon(p.item.type);
          return (
            <div key={p.id} className="panel p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-lg bg-lattice-deep flex items-center justify-center shrink-0">
                <Icon className="w-5 h-5 text-gray-400" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-medium text-sm truncate">{p.item.title}</p>
                <div className="flex items-center gap-2 text-xs text-gray-400">
                  <span>{p.item.creator.name}</span>
                  <span className="text-gray-600">|</span>
                  <span className={tier?.color}>{tier?.name} License</span>
                  <span className="text-gray-600">|</span>
                  <span>{new Date(p.purchasedAt).toLocaleDateString()}</span>
                </div>
              </div>
              <span className="text-sm text-gray-400 tabular-nums">{formatPrice(p.price)}</span>
              <button
                onClick={async () => {
                  if (p.item.type !== 'plugin') {
                    useUIStore.getState().addToast({
                      type: 'info',
                      message: `${p.item.title} doesn't have automated delivery yet — this item type has no fulfillment path wired up. Reach out to ${p.item.creator.name} for the files.`,
                    });
                    return;
                  }
                  useUIStore.getState().addToast({
                    type: 'info',
                    message: `Installing ${p.item.title}...`,
                  });
                  try {
                    const res = await api.post('/api/marketplace/install', {
                      pluginId: p.item.id,
                      listingId: p.item.id,
                    });
                    if (res.data?.ok === true) {
                      useUIStore.getState().addToast({
                        type: 'success',
                        message: `${p.item.title} installed successfully`,
                      });
                    } else {
                      useUIStore.getState().addToast({
                        type: 'error',
                        message: res.data?.error
                          ? `Failed to install ${p.item.title}: ${res.data.error}`
                          : `Failed to install ${p.item.title}`,
                      });
                    }
                  } catch (e) {
                    console.error('Marketplace install failed:', e);
                    const backendMsg = (e as { response?: { data?: { error?: string } } })
                      ?.response?.data?.error;
                    useUIStore.getState().addToast({
                      type: 'error',
                      message: backendMsg
                        ? `Failed to install ${p.item.title}: ${backendMsg}`
                        : `Failed to install ${p.item.title}`,
                    });
                  }
                }}
                className="btn-neon small flex items-center gap-1 text-sm"
              >
                <Download className="w-3.5 h-3.5" /> Download
              </button>
            </div>
          );
        })
      )}
    </motion.div>
  );
}
