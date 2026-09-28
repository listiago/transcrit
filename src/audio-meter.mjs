// Eight actual frequency bands, from low voice frequencies to upper harmonics.
const EDGES = [80, 180, 320, 550, 900, 1500, 2500, 4200, 7500];
export function meterBands(spectrum, sampleRate, fftSize, rms) {
  if (rms < 0.003) return Array(8).fill(0);
  return EDGES.slice(0, -1).map((low, index) => {
    const start = Math.max(1, Math.floor(low * fftSize / sampleRate));
    const end = Math.min(spectrum.length, Math.ceil(EDGES[index + 1] * fftSize / sampleRate));
    let peak = 0;
    for (let bin = start; bin < end; bin++) peak = Math.max(peak, spectrum[bin]);
    return Math.min(1, (peak / 255) ** 1.7);
  });
}
