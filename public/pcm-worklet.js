class PcmCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.buffer = new Int16Array(Math.round(sampleRate / 10)); this.offset = 0; this.stopped = false;
    this.port.onmessage = event => {
      if (event.data === 'flush') {
        this.stopped = true; this.flush(); this.port.postMessage({ stopped: true });
      }
    };
  }
  flush() {
    if (!this.offset) return;
    const pcm = this.buffer.slice(0, this.offset);
    this.port.postMessage({ pcm }, [pcm.buffer]); this.offset = 0;
  }
  process(inputs) {
    if (this.stopped) return false;
    const channel = inputs[0]?.[0];
    if (channel) for (const sample of channel) {
      this.buffer[this.offset++] = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
      if (this.offset === this.buffer.length) this.flush();
    }
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
