export function wav(frames, sampleRate) {
  const length = frames.reduce((sum, frame) => sum + frame.length, 0);
  const bytes = new ArrayBuffer(44 + length * 2), view = new DataView(bytes);
  const ascii = (offset, text) => [...text].forEach((letter, i) => view.setUint8(offset + i, letter.charCodeAt(0)));
  ascii(0, 'RIFF'); view.setUint32(4, 36 + length * 2, true); ascii(8, 'WAVE'); ascii(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true); view.setUint16(34, 16, true); ascii(36, 'data'); view.setUint32(40, length * 2, true);
  let offset = 44;
  for (const frame of frames) for (const sample of frame) { view.setInt16(offset, sample, true); offset += 2; }
  return bytes;
}

export class AudioSegments {
  constructor(sampleRate, onSegment) {
    this.sampleRate = sampleRate; this.onSegment = onSegment;
    this.frames = []; this.samples = 0; this.silence = 0; this.voiced = false;
  }
  push(pcm) {
    const rms = Math.sqrt(pcm.reduce((sum, value) => sum + (value / 32768) ** 2, 0) / pcm.length);
    const voice = rms >= 0.008;
    this.frames.push(pcm); this.samples += pcm.length;
    if (voice) { this.voiced = true; this.silence = 0; } else this.silence += pcm.length;
    // Keep a short lead-in during silence, without paying to transcribe an idle microphone.
    if (!this.voiced) while (this.frames.length > 2) this.samples -= this.frames.shift().length;
    if (this.voiced && (this.samples >= this.sampleRate * 10 || (this.samples >= this.sampleRate * 2 && this.silence >= this.sampleRate * 0.65))) this.flush();
    return rms;
  }
  flush() {
    if (this.voiced) {
      // Keep a very short final syllable instead of sending a near-empty WAV.
      const padding = Math.max(0, Math.ceil(this.sampleRate * .3) - this.samples);
      const frames = padding ? [...this.frames, new Int16Array(padding)] : this.frames;
      this.onSegment(wav(frames, this.sampleRate), (this.samples + padding) / this.sampleRate);
    }
    this.frames = []; this.samples = 0; this.silence = 0; this.voiced = false;
  }
}
