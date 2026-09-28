export class SilenceDetector {
  constructor(sampleRate: number, seconds: number);
  push(rms: number, samples: number): boolean;
}
