import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Create mock socket instance
const mockSocketInstance = {
  on: vi.fn(),
  off: vi.fn(),
  emit: vi.fn(),
  connect: vi.fn(),
  disconnect: vi.fn(),
  connected: false,
  id: 'test-socket-id',
  auth: {} as Record<string, unknown>,
  // socket.ts registers reconnect-attempt diagnostics on the underlying
  // Manager instance (`socket.io.on('reconnect_attempt', ...)`), not on the
  // socket itself — real socket.io-client sockets always carry this. Without
  // it here, getSocket() throws on the `.io.on` call under test.
  io: {
    on: vi.fn(),
    off: vi.fn(),
  },
};

// Mock socket.io-client
vi.mock('socket.io-client', () => ({
  io: vi.fn(() => mockSocketInstance),
}));

// Mock the offline db clock sync
vi.mock('../offline/db', () => ({
  updateClockOffset: vi.fn(),
}));

// We need to reset the module-level socket variable between tests
// by resetting the module each time
let socketModule: typeof import('@/lib/realtime/socket');

describe('socket', () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    mockSocketInstance.connected = false;
    mockSocketInstance.on.mockClear();
    mockSocketInstance.off.mockClear();
    mockSocketInstance.emit.mockClear();
    mockSocketInstance.connect.mockClear();
    mockSocketInstance.disconnect.mockClear();

    // Reset module to get fresh socket = null state
    vi.resetModules();
    socketModule = await import('@/lib/realtime/socket');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe('getSocket', () => {
    it('returns a socket instance', () => {
      const socket = socketModule.getSocket();
      expect(socket).toBeDefined();
    });

    it('returns the same instance on subsequent calls', () => {
      const s1 = socketModule.getSocket();
      const s2 = socketModule.getSocket();
      expect(s1).toBe(s2);
    });

    it('registers connect, disconnect, connect_error, and hello event handlers', () => {
      socketModule.getSocket();
      const events = mockSocketInstance.on.mock.calls.map((c: unknown[]) => c[0]);
      expect(events).toContain('connect');
      expect(events).toContain('disconnect');
      expect(events).toContain('connect_error');
      expect(events).toContain('hello');
    });
  });

  describe('connectSocket', () => {
    it('calls connect on the socket when not connected', () => {
      mockSocketInstance.connected = false;
      socketModule.connectSocket();
      expect(mockSocketInstance.connect).toHaveBeenCalled();
    });

    it('does not call connect if already connected', () => {
      mockSocketInstance.connected = true;
      socketModule.connectSocket();
      expect(mockSocketInstance.connect).not.toHaveBeenCalled();
    });
  });

  describe('disconnectSocket', () => {
    it('calls disconnect when socket is connected', () => {
      socketModule.getSocket(); // Ensure socket is created
      mockSocketInstance.connected = true;
      socketModule.disconnectSocket();
      expect(mockSocketInstance.disconnect).toHaveBeenCalled();
    });

    it('does not call disconnect when socket is not connected', () => {
      socketModule.getSocket();
      mockSocketInstance.connected = false;
      socketModule.disconnectSocket();
      expect(mockSocketInstance.disconnect).not.toHaveBeenCalled();
    });
  });

  describe('subscribe', () => {
    it('registers an event listener and returns unsubscribe function', () => {
      const callback = vi.fn();
      const unsub = socketModule.subscribe('dtu:created', callback);

      expect(mockSocketInstance.on).toHaveBeenCalledWith('dtu:created', expect.any(Function));
      expect(typeof unsub).toBe('function');

      unsub();
      expect(mockSocketInstance.off).toHaveBeenCalledWith('dtu:created', expect.any(Function));
    });

    it('calls callback with event data', () => {
      const callback = vi.fn();
      socketModule.subscribe('dtu:created', callback);

      // Find the orderedCallback that was registered
      const registeredCallback = mockSocketInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'dtu:created'
      )?.[1];

      // Simulate receiving data
      registeredCallback?.({ hello: 'world' });
      expect(callback).toHaveBeenCalledWith({ hello: 'world' });
    });

    it('discards stale events based on sequence numbers', () => {
      const callback = vi.fn();
      socketModule.subscribe('dtu:updated', callback);

      const registeredCallback = mockSocketInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'dtu:updated'
      )?.[1];

      // Send event with seq 5
      registeredCallback?.({ _seq: 5, data: 'first' });
      expect(callback).toHaveBeenCalledTimes(1);

      // Send event with seq 3 (stale)
      registeredCallback?.({ _seq: 3, data: 'stale' });
      expect(callback).toHaveBeenCalledTimes(1); // Not called again

      // Send event with seq 6 (fresh)
      registeredCallback?.({ _seq: 6, data: 'fresh' });
      expect(callback).toHaveBeenCalledTimes(2);
    });

    it('allows events without sequence numbers', () => {
      const callback = vi.fn();
      socketModule.subscribe('system:alert', callback);

      const registeredCallback = mockSocketInstance.on.mock.calls.find(
        (c: unknown[]) => c[0] === 'system:alert'
      )?.[1];

      registeredCallback?.({ message: 'alert!' });
      registeredCallback?.({ message: 'another!' });
      expect(callback).toHaveBeenCalledTimes(2);
    });
  });

  describe('emit', () => {
    it('emits event when socket is connected', () => {
      socketModule.getSocket();
      mockSocketInstance.connected = true;
      socketModule.emit('room:join', { room: 'test' });
      expect(mockSocketInstance.emit).toHaveBeenCalledWith('room:join', { room: 'test' });
    });

    it('does not emit when socket is not connected', () => {
      socketModule.getSocket();
      mockSocketInstance.connected = false;
      socketModule.emit('room:join', { room: 'test' });
      expect(mockSocketInstance.emit).not.toHaveBeenCalled();
    });
  });

  describe('joinRoom / leaveRoom', () => {
    it('joinRoom emits room:join when connected', () => {
      socketModule.getSocket();
      mockSocketInstance.connected = true;
      socketModule.joinRoom('my-room');
      expect(mockSocketInstance.emit).toHaveBeenCalledWith('room:join', { room: 'my-room' });
    });

    it('leaveRoom emits room:leave when connected', () => {
      socketModule.getSocket();
      mockSocketInstance.connected = true;
      socketModule.leaveRoom('my-room');
      expect(mockSocketInstance.emit).toHaveBeenCalledWith('room:leave', { room: 'my-room' });
    });
  });

  describe('reconnectSocket', () => {
    it('debounces reconnection', () => {
      vi.useFakeTimers();
      socketModule.getSocket();
      mockSocketInstance.connected = true;

      socketModule.reconnectSocket();
      socketModule.reconnectSocket();
      socketModule.reconnectSocket();

      // Should not have disconnected yet (debounced)
      expect(mockSocketInstance.disconnect).not.toHaveBeenCalled();

      // Advance past debounce
      vi.advanceTimersByTime(2001);

      expect(mockSocketInstance.disconnect).toHaveBeenCalledTimes(1);
      expect(mockSocketInstance.connect).toHaveBeenCalled();
    });
  });

  describe('getLastSequence', () => {
    it('returns 0 for unseen events', () => {
      const seq = socketModule.getLastSequence('dtu:created');
      expect(seq).toBe(0);
    });

    it('returns all sequence numbers when no event specified', () => {
      const allSeqs = socketModule.getLastSequence();
      expect(typeof allSeqs).toBe('object');
    });
  });

  describe('getLastCorrelationId', () => {
    it('returns undefined (consumers extract _rid directly)', () => {
      const rid = socketModule.getLastCorrelationId('dtu:created');
      expect(rid).toBeUndefined();
    });
  });
});
