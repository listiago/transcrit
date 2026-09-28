// Use captured sample time, not UI timers: suspending a window cannot manufacture
// a silence timeout. A brief click or silence before speaking never arms it.
export class SilenceDetector {
  constructor(sampleRate, seconds) {
    this.voiceRequired = Math.ceil(sampleRate * 0.2);
    this.silenceRequired = Math.round(sampleRate * seconds);
    this.voiceSamples = 0;
    this.silentSamples = 0;
    this.heardVoice = false;
    this.finished = false;
  }
  push(rms, samples) {
    if (this.finished || !Number.isFinite(rms) || !Number.isInteger(samples) || samples <= 0) return false;
    if (rms >= 0.008) {
      this.voiceSamples += samples;
      if (this.voiceSamples >= this.voiceRequired) this.heardVoice = true;
      this.silentSamples = 0;
    } else {
      this.voiceSamples = 0;
      if (this.heardVoice) this.silentSamples += samples;
    }
    if (this.heardVoice && this.silentSamples >= this.silenceRequired) {
      this.finished = true;
      return true;
    }
    return false;
  }
}
