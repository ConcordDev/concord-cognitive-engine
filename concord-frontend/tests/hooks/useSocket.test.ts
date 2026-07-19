import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';

// Create mock socket instance
const mockSocketInstance = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  removeAllListeners: vi.fn(),
  connected: false,
  // lib/realtime/socket.ts registers reconnect-attempt diagnostics on the
  // underlying Manager instance (`socket.io.on('reconnect_attempt', ...)`),
  // not on the socket itself — real socket.io-client sockets always carry
  // this. Without it here, getSocket() throws on the `.io.on` call.
  io: {
    on: vi.fn(),
    off: vi.fn(),
  },
};

// Mock socket.io-client
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocketInstance),
}));

import { useSocket, useResonanceSocket, useDTUSocket } from '@/hooks/useSocket';
import { io } from 'socket.io-client';

const mockedIo = vi.mocked(io);
const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
const wrapper = ({ children }: { children: React.ReactNode }) =>
  React.createElement(QueryClientProvider, { client: qc }, children);

describe('useSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketInstance.connected = false;
    mockSocketInstance.on.mockReset();
    mockSocketInstance.off.mockReset();
    mockSocketInstance.emit.mockReset();
    mockSocketInstance.connect.mockReset();
    mockSocketInstance.disconnect.mockReset();
    mockSocketInstance.removeAllListeners.mockReset();
  });

  it('initializes a socket with default options', () => {
    renderHook(() => useSocket(),  { wrapper });

    expect(mockedIo).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        autoConnect: false,
        reconnection: true,
        // lib/realtime/socket.ts's getSocket() singleton hardcodes
        // reconnectionAttempts: Infinity ("we retry forever now") — the
        // hook's own `reconnectionAttempts` option never reaches this
        // io() call (getSocket() takes no config), so this asserts the
        // real singleton default, not the hook's unrelated param default.
        reconnectionAttempts: Infinity,
        reconnectionDelay: 1000,
        transports: ['websocket', 'polling'],
        withCredentials: true,
      })
    );
  });

  it('passes custom options through to socket behavior', () => {
    // getSocket() is a singleton — io() is called once with fixed config.
    // Custom options control hook behavior (e.g. autoConnect triggers socket.connect())
    renderHook(() =>
      useSocket({
        autoConnect: true,
        reconnection: false,
        reconnectionAttempts: 3,
        reconnectionDelay: 500,
      }),
      { wrapper }
    );

    // With autoConnect=true and socket not connected, the hook calls socket.connect()
    expect(mockSocketInstance.connect).toHaveBeenCalled();
  });

  it('starts disconnected', () => {
    const { result } = renderHook(() => useSocket(),  { wrapper });

    expect(result.current.isConnected).toBe(false);
  });

  it('registers connect, disconnect, and connect_error handlers', () => {
    renderHook(() => useSocket(),  { wrapper });

    expect(mockSocketInstance.on).toHaveBeenCalledWith(
      'connect',
      expect.any(Function)
    );
    expect(mockSocketInstance.on).toHaveBeenCalledWith(
      'disconnect',
      expect.any(Function)
    );
    expect(mockSocketInstance.on).toHaveBeenCalledWith(
      'connect_error',
      expect.any(Function)
    );
  });

  it('sets isConnected=true on connect event', () => {
    const { result } = renderHook(() => useSocket(),  { wrapper });

    // Find the connect handler and call it
    const connectCall = mockSocketInstance.on.mock.calls.find(
      (call) => call[0] === 'connect'
    );
    expect(connectCall).toBeTruthy();

    act(() => {
      connectCall![1]();
    });

    expect(result.current.isConnected).toBe(true);
  });

  it('sets isConnected=false on disconnect event', () => {
    const { result } = renderHook(() => useSocket(),  { wrapper });

    // Simulate connect
    const connectCall = mockSocketInstance.on.mock.calls.find(
      (call) => call[0] === 'connect'
    );
    act(() => {
      connectCall![1]();
    });
    expect(result.current.isConnected).toBe(true);

    // Simulate disconnect
    const disconnectCall = mockSocketInstance.on.mock.calls.find(
      (call) => call[0] === 'disconnect'
    );
    act(() => {
      disconnectCall![1]();
    });

    expect(result.current.isConnected).toBe(false);
  });

  it('sets isConnected=false on connect_error event', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const { result } = renderHook(() => useSocket(),  { wrapper });

    // Simulate connect first
    const connectCall = mockSocketInstance.on.mock.calls.find(
      (call) => call[0] === 'connect'
    );
    act(() => {
      connectCall![1]();
    });

    // Simulate connect_error
    const errorCall = mockSocketInstance.on.mock.calls.find(
      (call) => call[0] === 'connect_error'
    );
    act(() => {
      errorCall![1]({ message: 'Connection refused' });
    });

    expect(result.current.isConnected).toBe(false);
    errorSpy.mockRestore();
  });

  it('connect() calls socket.connect when not connected', () => {
    const { result } = renderHook(() => useSocket(),  { wrapper });
    mockSocketInstance.connected = false;

    act(() => {
      result.current.connect();
    });

    expect(mockSocketInstance.connect).toHaveBeenCalled();
  });

  it('connect() does not call socket.connect when already connected', () => {
    const { result } = renderHook(() => useSocket(),  { wrapper });
    mockSocketInstance.connected = true;

    act(() => {
      result.current.connect();
    });

    expect(mockSocketInstance.connect).not.toHaveBeenCalled();
  });

  it('disconnect() calls socket.disconnect when connected', () => {
    const { result } = renderHook(() => useSocket(),  { wrapper });
    mockSocketInstance.connected = true;

    act(() => {
      result.current.disconnect();
    });

    expect(mockSocketInstance.disconnect).toHaveBeenCalled();
  });

  it('disconnect() does not call socket.disconnect when not connected', () => {
    const { result } = renderHook(() => useSocket(),  { wrapper });
    mockSocketInstance.connected = false;

    act(() => {
      result.current.disconnect();
    });

    expect(mockSocketInstance.disconnect).not.toHaveBeenCalled();
  });

  it('emit() calls socket.emit when connected', () => {
    const { result } = renderHook(() => useSocket(),  { wrapper });
    mockSocketInstance.connected = true;

    act(() => {
      result.current.emit('test-event', { foo: 'bar' });
    });

    expect(mockSocketInstance.emit).toHaveBeenCalledWith('test-event', {
      foo: 'bar',
    });
  });

  it('emit() does not call socket.emit when not connected', () => {
    const { result } = renderHook(() => useSocket(),  { wrapper });
    mockSocketInstance.connected = false;

    act(() => {
      result.current.emit('test-event', { foo: 'bar' });
    });

    expect(mockSocketInstance.emit).not.toHaveBeenCalled();
  });

  it('on() registers a listener on the socket', () => {
    const { result } = renderHook(() => useSocket(),  { wrapper });
    const callback = vi.fn();

    act(() => {
      result.current.on('custom-event', callback);
    });

    expect(mockSocketInstance.on).toHaveBeenCalledWith(
      'custom-event',
      callback
    );
  });

  it('off() unregisters a listener with callback from the socket', () => {
    const { result } = renderHook(() => useSocket(),  { wrapper });
    const callback = vi.fn();

    act(() => {
      result.current.off('custom-event', callback);
    });

    expect(mockSocketInstance.off).toHaveBeenCalledWith(
      'custom-event',
      callback
    );
  });

  it('off() unregisters a listener without callback from the socket', () => {
    const { result } = renderHook(() => useSocket(),  { wrapper });

    act(() => {
      result.current.off('custom-event');
    });

    expect(mockSocketInstance.off).toHaveBeenCalledWith('custom-event');
  });

  it('cleans up on unmount', () => {
    const { unmount } = renderHook(() => useSocket(),  { wrapper });

    // The hook registers 'connect', 'disconnect', 'connect_error' + all forwarded events
    // On unmount, it calls socket.off() for each individually (shared singleton — no disconnect)
    const _onCallCount = mockSocketInstance.on.mock.calls.length;

    unmount();

    // Each .on() call should have a corresponding .off() call on cleanup
    expect(mockSocketInstance.off.mock.calls.length).toBeGreaterThanOrEqual(3);
    // Verify connect/disconnect/connect_error listeners were removed
    expect(mockSocketInstance.off).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockSocketInstance.off).toHaveBeenCalledWith('disconnect', expect.any(Function));
    expect(mockSocketInstance.off).toHaveBeenCalledWith('connect_error', expect.any(Function));
  });
});

describe('useResonanceSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketInstance.connected = false;
    mockSocketInstance.on.mockReset();
    mockSocketInstance.off.mockReset();
  });

  it('returns initial state with null resonanceData', () => {
    const { result } = renderHook(() => useResonanceSocket(),  { wrapper });

    expect(result.current.resonanceData).toBeNull();
    expect(result.current.isConnected).toBe(false);
  });

  it('subscribes to resonance:update event', () => {
    renderHook(() => useResonanceSocket(),  { wrapper });

    // The hook calls on('resonance:update', handler) via useSocket's on()
    // Since useSocket's on() delegates to socket.on(), we check that
    expect(mockSocketInstance.on).toHaveBeenCalledWith(
      'resonance:update',
      expect.any(Function)
    );
  });

  it('cleans up on unmount via individual off() calls', () => {
    const { unmount } = renderHook(() => useResonanceSocket(),  { wrapper });

    unmount();

    // useSocket cleanup removes per-component listeners (connect/disconnect/connect_error)
    // FORWARDED_EVENTS (including resonance:update) are now registered globally once, not per-component
    expect(mockSocketInstance.off).toHaveBeenCalledWith('connect', expect.any(Function));
    expect(mockSocketInstance.off).toHaveBeenCalledWith('disconnect', expect.any(Function));
    expect(mockSocketInstance.off).toHaveBeenCalledWith('connect_error', expect.any(Function));
  });
});

describe('useDTUSocket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSocketInstance.connected = false;
    mockSocketInstance.emit.mockReset();
  });

  it('returns expected interface', () => {
    const { result } = renderHook(() => useDTUSocket(),  { wrapper });

    expect(result.current.isConnected).toBe(false);
    expect(typeof result.current.subscribeToDTU).toBe('function');
    expect(typeof result.current.unsubscribeFromDTU).toBe('function');
    expect(typeof result.current.onDTUUpdate).toBe('function');
    expect(typeof result.current.offDTUUpdate).toBe('function');
  });

  it('subscribeToDTU emits dtu:subscribe', () => {
    const { result } = renderHook(() => useDTUSocket(),  { wrapper });
    mockSocketInstance.connected = true;

    act(() => {
      result.current.subscribeToDTU('dtu-123');
    });

    expect(mockSocketInstance.emit).toHaveBeenCalledWith('dtu:subscribe', {
      dtuId: 'dtu-123',
    });
  });

  it('unsubscribeFromDTU emits dtu:unsubscribe', () => {
    const { result } = renderHook(() => useDTUSocket(),  { wrapper });
    mockSocketInstance.connected = true;

    act(() => {
      result.current.unsubscribeFromDTU('dtu-456');
    });

    expect(mockSocketInstance.emit).toHaveBeenCalledWith('dtu:unsubscribe', {
      dtuId: 'dtu-456',
    });
  });
});
