import { fft, hannWindow } from "./fft";

export const BAND_COUNT = 72;
const MIN_DB = -78;
const MAX_DB = -16;

export interface Spectrum {
  bands: Float32Array;
  bass: number;
  mid: number;
  high: number;
  energy: number;
  flux: number;
  loud: number;
  kick: number;
  snare: number;
  hat: number;
  gain: number;
  level: number;
  clock: number;
}

export interface FftWorkspace {
  size: number;
  re: Float32Array;
  im: Float32Array;
  hann: Float32Array;
  mags: Float32Array;
}

export function createSpectrum(): Spectrum {
  return {
    bands: new Float32Array(BAND_COUNT),
    bass: 0,
    mid: 0,
    high: 0,
    energy: 0,
    flux: 0,
    loud: 0,
    kick: 0,
    snare: 0,
    hat: 0,
    gain: 1,
    level: 0.38,
    clock: -1,
  };
}

export function createWorkspace(size = 2048): FftWorkspace {
  return {
    size,
    re: new Float32Array(size),
    im: new Float32Array(size),
    hann: hannWindow(size),
    mags: new Float32Array(size >> 1),
  };
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function mixMono(buffer: AudioBuffer): Float32Array {
  const n = buffer.length;
  const mono = new Float32Array(n);
  const channels = buffer.numberOfChannels;
  const gain = 1 / channels;
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += data[i] * gain;
  }
  return mono;
}

export function waveformPeaks(buffer: AudioBuffer, buckets: number): Float32Array {
  const data = buffer.getChannelData(0);
  const peaks = new Float32Array(buckets);
  const step = Math.max(1, Math.floor(data.length / buckets));
  for (let i = 0; i < buckets; i++) {
    const start = i * step;
    let peak = 0;
    const end = Math.min(data.length, start + step);
    for (let j = start; j < end; j += 8) {
      const v = Math.abs(data[j]);
      if (v > peak) peak = v;
    }
    peaks[i] = peak;
  }
  return peaks;
}

function fillLogBands(mags: ArrayLike<number>, bands: Float32Array): void {
  const n = mags.length;
  const count = bands.length;
  for (let i = 0; i < count; i++) {
    const start = Math.pow(n - 1, i / count);
    const end = Math.pow(n - 1, (i + 1) / count);
    const a = Math.max(1, Math.floor(start));
    const b = Math.min(n, Math.max(a + 1, Math.ceil(end)));
    let peak = 0;
    let sumSq = 0;
    let bins = 0;
    for (let k = a; k < b; k++) {
      const mag = mags[k];
      sumSq += mag * mag;
      bins += 1;
      if (mag > peak) peak = mag;
    }
    const mean = bins > 0 ? Math.sqrt(sumSq / bins) : 0;
    const combined = Math.max(peak, mean * 2.6);
    const db = 20 * Math.log10(combined + 1e-8);
    bands[i] = clamp((db - MIN_DB) / (MAX_DB - MIN_DB), 0, 1);
  }
}

const GAIN_TARGET = 0.55;

function advanceClock(spec: Spectrum, time: number): number {
  const prev = spec.clock;
  spec.clock = time;
  if (prev < 0) return 1 / 60;
  const raw = time - prev;
  if (!(raw > 0 && raw < 0.5)) return 1 / 60;
  return Math.min(raw, 0.05);
}

function applyGain(spec: Spectrum, dt: number, loud: number): void {
  const follow = 1 - Math.exp(-dt / 2.4);
  spec.level += (loud - spec.level) * follow;
  const desired = clamp(GAIN_TARGET / Math.max(spec.level, 0.12), 0.9, 2.4);
  const chase = 1 - Math.exp(-dt / 0.7);
  spec.gain += (desired - spec.gain) * chase;
  const gain = spec.gain;
  if (gain === 1) return;
  const bands = spec.bands;
  for (let i = 0; i < bands.length; i++) bands[i] = clamp(bands[i] * gain, 0, 1);
}

function bandHz(index: number, count: number, sampleRate: number, fftSize: number): number {
  const bins = Math.max(2, fftSize >> 1);
  const bin = Math.pow(bins - 1, (index + 0.5) / count);
  return (bin * sampleRate) / fftSize;
}

function groupEnergy(
  bands: Float32Array,
  prev: Float32Array,
  sampleRate: number,
  fftSize: number,
  lowHz: number,
  highHz: number,
): { level: number; flux: number } {
  let peak = 0;
  let sumSq = 0;
  let flux = 0;
  let count = 0;
  for (let i = 0; i < bands.length; i++) {
    const hz = bandHz(i, bands.length, sampleRate, fftSize);
    if (hz < lowHz || hz >= highHz) continue;
    const value = bands[i];
    peak = Math.max(peak, value);
    sumSq += value * value;
    const delta = value - prev[i];
    if (delta > flux) flux = delta;
    count += 1;
  }
  if (count === 0) return { level: 0, flux: 0 };
  const mean = Math.sqrt(sumSq / count);
  return { level: clamp(Math.max(peak, mean * 1.8), 0, 1), flux };
}

function mapRms(rms: number): number {
  const db = 20 * Math.log10(rms + 1e-8);
  return clamp((db + 46) / 36, 0, 1);
}

export type Follow = "all" | "low" | "high";

export function applyFollow(spec: Spectrum, follow: Follow): void {
  if (follow === "all") return;
  if (follow === "low") {
    spec.mid *= 0.22;
    spec.high *= 0.08;
    spec.snare *= 0.2;
    spec.hat *= 0.1;
    spec.energy = spec.bass;
    spec.loud = spec.bass;
    return;
  }
  spec.bass *= 0.16;
  spec.kick *= 0.16;
  spec.mid *= 0.42;
  spec.energy = Math.min(1, spec.high * 0.72 + spec.mid * 0.28);
  spec.loud = spec.energy;
}

function shapeOnset(flux: number, level: number, fluxGate: number, levelGate: number): number {
  if (level < levelGate || flux < fluxGate) return 0;
  return clamp((flux - fluxGate) / 0.12, 0, 1);
}

function writeGroups(spec: Spectrum, prev: Float32Array, sampleRate: number, fftSize: number, rms: number, storePrev: boolean): number {
  const bands = spec.bands;
  const bass = groupEnergy(bands, prev, sampleRate, fftSize, 28, 220);
  const mid = groupEnergy(bands, prev, sampleRate, fftSize, 220, 2800);
  const high = groupEnergy(bands, prev, sampleRate, fftSize, 2800, 14000);
  let energy = 0;
  let flux = 0;
  for (let i = 0; i < bands.length; i++) {
    const value = bands[i];
    energy += value;
    const delta = value - prev[i];
    if (delta > 0) flux += delta;
    if (storePrev) prev[i] = value;
  }
  spec.bass = bass.level;
  spec.mid = mid.level;
  spec.high = high.level;
  spec.energy = energy / bands.length;
  spec.flux = flux / bands.length;
  spec.loud = clamp(mapRms(rms) * 0.48 + bass.level * 0.2 + mid.level * 0.22 + high.level * 0.1, 0, 1);
  spec.kick = shapeOnset(bass.flux, bass.level, 0.028, 0.08);
  spec.snare = shapeOnset(mid.flux, mid.level, 0.022, 0.06);
  spec.hat = shapeOnset(high.flux, high.level, 0.018, 0.05);
  return spec.loud;
}

export function summarize(spec: Spectrum, prev: Float32Array, dt: number, sampleRate = 44100, fftSize = 2048, rms = 0.02): void {
  const heard = writeGroups(spec, prev, sampleRate, fftSize, rms, false);
  applyGain(spec, dt, heard);
  writeGroups(spec, prev, sampleRate, fftSize, rms, true);
}

function idlePulse(phase: number, at: number, width: number): number {
  const direct = Math.abs(phase - at);
  const wrapped = Math.min(direct, 4 - direct);
  if (wrapped > width) return 0;
  return 1 - wrapped / width;
}

export function analyzeFrame(
  mono: Float32Array,
  sampleRate: number,
  time: number,
  ws: FftWorkspace,
  prev: Float32Array,
  out: Spectrum,
): void {
  const { size, re, im, hann, mags } = ws;
  const center = Math.floor(time * sampleRate);
  const start = center - (size >> 1);
  const length = mono.length;
  let sumSq = 0;
  for (let i = 0; i < size; i++) {
    const index = start + i;
    const sample = index >= 0 && index < length ? mono[index] : 0;
    sumSq += sample * sample;
    re[i] = sample * hann[i];
    im[i] = 0;
  }
  fft(re, im);
  const half = size >> 1;
  const scale = 2 / size;
  for (let k = 0; k < half; k++) mags[k] = Math.hypot(re[k], im[k]) * scale;
  fillLogBands(mags, out.bands);
  summarize(out, prev, advanceClock(out, time), sampleRate, size, Math.sqrt(sumSq / size));
}

export function idleSpectrum(time: number, prev: Float32Array, out: Spectrum): void {
  const bands = out.bands;
  for (let i = 0; i < bands.length; i++) {
    const wave =
      0.22 +
      0.16 * Math.sin(time * 0.65 + i * 0.28) +
      0.1 * Math.sin(time * 1.35 + i * 0.11) * Math.sin(time * 0.4 + i);
    bands[i] = clamp(wave, 0, 1);
  }
  summarize(out, prev, advanceClock(out, time));
  const beat = (time * 2) % 4;
  out.kick = Math.max(out.kick, Math.max(idlePulse(beat, 0, 0.08), idlePulse(beat, 2, 0.08)));
  out.snare = Math.max(out.snare, Math.max(idlePulse(beat, 1, 0.07), idlePulse(beat, 3, 0.07)) * 0.9);
  const hatPhase = (time * 8) % 1;
  out.hat = Math.max(out.hat, hatPhase < 0.08 ? (1 - hatPhase / 0.08) * 0.62 : 0);
}
