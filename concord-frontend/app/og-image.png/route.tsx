import { ImageResponse } from 'next/og';

export const runtime = 'edge';

export function GET() {
  return new ImageResponse(
    <div
      style={{
        background: '#050510',
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: 'system-ui, sans-serif',
        padding: '80px',
      }}
    >
      <div
        style={{
          fontSize: 88,
          fontWeight: 800,
          color: '#00f5ff',
          letterSpacing: '-3px',
          marginBottom: 16,
          lineHeight: 1,
        }}
      >
        Concord
      </div>
      <div
        style={{
          fontSize: 32,
          color: '#6b7280',
          marginBottom: 56,
          textAlign: 'center',
        }}
      >
        175+ apps. One platform. Free forever.
      </div>
      <div style={{ display: 'flex', gap: 20 }}>
        {['No ads', 'No subscriptions', 'No data extraction', 'Local AI'].map((tag) => (
          <div
            key={tag}
            style={{
              background: 'rgba(0,245,255,0.08)',
              border: '1px solid rgba(0,245,255,0.25)',
              color: '#00f5ff',
              padding: '12px 24px',
              borderRadius: 12,
              fontSize: 22,
            }}
          >
            {tag}
          </div>
        ))}
      </div>
    </div>,
    { width: 1200, height: 630 }
  );
}
