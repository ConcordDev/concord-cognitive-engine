/* Generated from lib/daw/worklets/capture-tap.ts by scripts/build-worklets.mjs. Do not edit. */
const g = globalThis;
class CaptureTapProcessor extends AudioWorkletProcessor {
    armed = false;
    gen = 0;
    constructor() {
        super();
        this.port.onmessage = (ev) => {
            const data = ev.data;
            if (!data || data.type !== 'arm')
                return;
            this.armed = !!data.on;
            if (typeof data.gen === 'number')
                this.gen = data.gen;
            if (!this.armed)
                this.port.postMessage({ type: 'disarmed', gen: this.gen });
        };
    }
    process(inputs) {
        if (!this.armed)
            return true;
        const input = inputs[0];
        if (!input || input.length === 0 || !input[0] || input[0].length === 0)
            return true;
        const channels = [];
        const transfers = [];
        for (let c = 0; c < input.length; c++) {
            const src = input[c];
            const copy = new Float32Array(src.length);
            copy.set(src);
            channels.push(copy);
            transfers.push(copy.buffer);
        }
        this.port.postMessage({ type: 'block', gen: this.gen, time: g.currentTime, channels }, transfers);
        return true;
    }
}
g.registerProcessor('concord-capture-tap', CaptureTapProcessor);
export {};
