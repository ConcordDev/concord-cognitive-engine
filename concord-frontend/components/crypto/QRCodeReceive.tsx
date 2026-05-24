'use client';

import { useEffect, useState } from 'react';
import { Copy, Check, Loader2, Download } from 'lucide-react';

interface QRCodeReceiveProps {
  address: string;
  label?: string;
  amount?: string;
  symbol?: string;
  size?: number;
}

/**
 * QR code receive panel — generates a scannable QR via `qrcode` lib +
 * shows address with copy-to-clipboard + amount-encoded URI when set.
 *
 * Format: bare address for safety. If amount is set, builds an
 * EIP-681-style `ethereum:<address>?value=<amt>` URI for chains that
 * support it; otherwise the QR encodes the raw address.
 */
export function QRCodeReceive({ address, label, amount, symbol, size = 240 }: QRCodeReceiveProps) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const QR = await import('qrcode');
        const uri = buildPaymentURI(address, amount, symbol);
        const url = await QR.toDataURL(uri, {
          width: size,
          margin: 1,
          color: { dark: '#e2e8f0', light: '#0d111700' },
          errorCorrectionLevel: 'M',
        });
        if (!cancelled) setDataUrl(url);
      } catch (e) {
        console.error('[QR] generation failed', e);
        if (!cancelled) setDataUrl(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [address, amount, symbol, size]);

  function copyAddr() {
    navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function downloadQR() {
    if (!dataUrl) return;
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = `qr-${address.slice(0, 8)}.png`;
    a.click();
  }

  return (
    <div className="space-y-3">
      {label && <p className="text-xs text-gray-400">{label}</p>}
      <div className="flex flex-col items-center gap-3 p-4 bg-[#0a0e17] border border-cyan-500/20 rounded-lg">
        <div className="relative bg-black/30 rounded p-2" style={{ width: size + 16, height: size + 16 }}>
          {loading ? (
            <div className="flex items-center justify-center w-full h-full">
              <Loader2 className="w-6 h-6 text-cyan-400 animate-spin" />
            </div>
          ) : dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={dataUrl} alt={`QR code for ${address}`} className="w-full h-full" />
          ) : (
            <div className="flex items-center justify-center w-full h-full text-xs text-red-400">QR failed</div>
          )}
        </div>
        <div className="w-full text-center">
          <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-1">{symbol || 'Address'}</div>
          <div className="font-mono text-xs text-cyan-200 break-all max-w-md mx-auto">{address}</div>
        </div>
        {amount && (
          <div className="text-sm text-yellow-300 font-bold">
            Requesting {amount} {symbol}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            onClick={copyAddr}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-cyan-500 text-black font-bold hover:bg-cyan-400 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied' : 'Copy address'}
          </button>
          <button
            onClick={downloadQR}
            disabled={!dataUrl}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs rounded border border-white/10 text-gray-300 hover:text-white hover:bg-white/5 disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5" /> Save QR
          </button>
        </div>
        <p className="text-[10px] text-gray-400 text-center max-w-xs">
          Only send {symbol || 'tokens'} on the matching network to this address. Sending other assets will lose them.
        </p>
      </div>
    </div>
  );
}

function buildPaymentURI(address: string, amount?: string, symbol?: string): string {
  if (!amount || !symbol) return address;
  // EIP-681 for EVM, otherwise bare
  const isEvm = address.startsWith('0x') && address.length === 42;
  if (isEvm) {
    return `ethereum:${address}?value=${amount}`;
  }
  return address;
}

export default QRCodeReceive;
