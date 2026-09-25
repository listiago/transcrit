const { randomUUID } = require('node:crypto');
const { validateAudio, noSpeechError } = require('./core.cjs');

// One ordered queue per recording. Completed chunks are never submitted again.
class DictationSession {
  constructor(transcribe, onPreview) {
    this.id = randomUUID(); this.transcribe = transcribe; this.onPreview = onPreview;
    this.chunks = []; this.parts = []; this.next = 0; this.bytes = 0;
    this.controller = new AbortController(); this.error = ''; this.closed = false;
  }
  get text() { return this.parts.join(' '); }
  emit() { if (!this.controller.signal.aborted) this.onPreview({ text: this.text, pending: this.chunks.length, previewError: this.error }); }
  append(input) {
    if (this.closed || this.controller.signal.aborted) throw new Error('Esta gravação já terminou.');
    if (input.sequence !== this.next) throw new Error('A sequência do áudio foi interrompida. Grave novamente.');
    const audio = validateAudio({ ...input, name: 'trecho.wav', source: 'mic' });
    const b = audio.bytes;
    if (b.length > 2_000_000 || b.toString('ascii', 0, 4) !== 'RIFF' || b.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Trecho de áudio inválido.');
    if (this.bytes + b.length > 65_000_000) throw new Error('Limite de gravação atingido. Conclua este ditado.');
    this.next++; this.bytes += b.length; this.chunks.push(audio); this.emit(); this.pump();
  }
  pump() {
    if (this.running || this.error || this.controller.signal.aborted) return;
    this.running = this.drain().finally(() => { this.running = undefined; if (this.chunks.length && !this.error) this.pump(); });
  }
  async drain() {
    while (this.chunks.length && !this.controller.signal.aborted) {
      try {
        const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(120000)]);
        const text = await this.transcribe(this.chunks[0], signal, this.text);
        if (this.controller.signal.aborted) return;
        if (text.trim()) this.parts.push(text.trim());
        this.chunks.shift(); this.emit();
      } catch (error) { this.failure = error; this.error = error.message; this.emit(); return; }
    }
  }
  async finish(retry = false) {
    this.closed = true;
    if (retry) { this.error = ''; this.failure = undefined; }
    this.pump();
    while (this.running) await this.running;
    if (this.controller.signal.aborted) throw new Error('Transcrição cancelada.');
    if (this.error) throw this.failure;
    if (!this.text) throw noSpeechError();
    return this.text;
  }
  cancel() { this.controller.abort(); this.chunks = []; this.parts = []; }
}
module.exports = { DictationSession };
