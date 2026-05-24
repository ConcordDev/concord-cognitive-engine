// Minimal type stub for the `simple-peer` package — the project doesn't
// install `@types/simple-peer`, and we only need a small slice of its
// API surface for `TelehealthVideoCall.tsx`. This stub is intentionally
// narrow: if the file starts using more of simple-peer's API, extend
// here rather than pulling in the full @types package.

declare module 'simple-peer' {
  namespace SimplePeer {
    type SignalData =
      | { type: 'offer' | 'answer'; sdp: string }
      | { type?: undefined; candidate: unknown };

    interface Options {
      initiator?: boolean;
      trickle?: boolean;
      stream?: MediaStream;
      config?: { iceServers?: Array<{ urls: string | string[] }> };
    }

    type EventHandler = (...args: unknown[]) => void;

    interface Instance {
      on(event: 'signal', listener: (data: SignalData) => void): this;
      on(event: 'stream', listener: (stream: MediaStream) => void): this;
      on(event: 'connect', listener: () => void): this;
      on(event: 'close', listener: () => void): this;
      on(event: 'error', listener: (err: Error) => void): this;
      on(event: 'data', listener: (data: Uint8Array) => void): this;
      on(event: string, listener: EventHandler): this;
      signal(data: SignalData): void;
      send(data: string | Uint8Array): void;
      destroy(): void;
      readonly destroyed: boolean;
    }
  }

  // The default export is the constructor.
  class SimplePeer implements SimplePeer.Instance {
    constructor(opts?: SimplePeer.Options);
    on(event: 'signal', listener: (data: SimplePeer.SignalData) => void): this;
    on(event: 'stream', listener: (stream: MediaStream) => void): this;
    on(event: 'connect', listener: () => void): this;
    on(event: 'close', listener: () => void): this;
    on(event: 'error', listener: (err: Error) => void): this;
    on(event: 'data', listener: (data: Uint8Array) => void): this;
    on(event: string, listener: SimplePeer.EventHandler): this;
    signal(data: SimplePeer.SignalData): void;
    send(data: string | Uint8Array): void;
    destroy(): void;
    readonly destroyed: boolean;
  }

  export = SimplePeer;
}
