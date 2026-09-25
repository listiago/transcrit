export function wav(frames: Int16Array[], sampleRate: number): ArrayBuffer;
export class AudioSegments {
  constructor(sampleRate: number, onSegment: (bytes: ArrayBuffer, duration: number) => void);
  push(pcm: Int16Array): number;
  flush(): void;
}
