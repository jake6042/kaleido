import {
  analyzeFrame,
  BAND_COUNT,
  createSpectrum,
  createWorkspace,
  idleSpectrum,
  mixMono,
  waveformPeaks,
  type Spectrum,
} from "./spectrum";

const AUDIO_EXT = /\.(mp3|wav|wave|ogg|oga|flac|m4a|aac|mp4|webm|opus|aiff|aif|caf)$/i;
const DECODE_LIMIT_MS = 90_000;

export function isAudioFile(file: File): boolean {
  return file.type.startsWith("audio/") || file.type === "video/mp4" || AUDIO_EXT.test(file.name);
}

function decodeError(error: unknown): Error {
  if (error instanceof Error && /too long/i.test(error.message)) return error;
  return new Error("Couldn't decode that file. Try MP3, WAV, FLAC, OGG, or M4A.");
}

function settleDecode(context: BaseAudioContext, bytes: ArrayBuffer): Promise<AudioBuffer> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      fail(new Error("Decoding took too long. Try a shorter file."));
    }, DECODE_LIMIT_MS);

    function succeed(buffer: AudioBuffer): void {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      resolve(buffer);
    }

    function fail(error: unknown): void {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      reject(decodeError(error));
    }

    try {
      // Safari still requires the callback form. Other browsers return a promise too.
      const pending = context.decodeAudioData(bytes, succeed, () => {
        fail(new Error("Couldn't decode that file."));
      });
      if (pending && typeof pending.then === "function") void pending.then(succeed, fail);
    } catch (error) {
      fail(error);
    }
  });
}

async function decodeFile(bytes: ArrayBuffer, sampleRate: number): Promise<AudioBuffer> {
  const rate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 44100;
  // The playback context is suspended while a phone's file picker is open, and
  // decodeAudioData on that context never settles. An offline context is not gated
  // by the same playback lock.
  let context: BaseAudioContext;
  try {
    context = new OfflineAudioContext(1, 1, rate);
  } catch {
    context = new AudioContext({ sampleRate: rate });
  }
  try {
    return await settleDecode(context, bytes);
  } finally {
    const close = (context as AudioContext).close;
    if (typeof close === "function") await close.call(context).catch(() => undefined);
  }
}

export class AudioEngine {
  readonly context: AudioContext;
  readonly element: HTMLAudioElement;
  readonly gain: GainNode;
  buffer: AudioBuffer | null = null;
  mono: Float32Array | null = null;
  peaks: Float32Array | null = null;
  name = "";
  private url: string | null = null;
  private connected = false;
  private readonly live = createSpectrum();
  private readonly livePrev = new Float32Array(BAND_COUNT);
  private readonly workspace = createWorkspace();

  constructor() {
    this.context = new AudioContext();
    this.element = new Audio();
    this.element.preload = "auto";
    this.gain = this.context.createGain();
    this.gain.gain.value = 0.9;
  }

  private connectGraph(): void {
    if (this.connected) return;
    const source = this.context.createMediaElementSource(this.element);
    source.connect(this.gain);
    this.gain.connect(this.context.destination);
    this.connected = true;
  }

  /** Call from a tap or click. Phones ignore resume() once that gesture is over. */
  unlock(): void {
    this.connectGraph();
    if (this.context.state === "running") return;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    void this.context.resume().catch(() => undefined);
    try {
      const silent = this.context.createBuffer(1, 1, this.context.sampleRate);
      const node = this.context.createBufferSource();
      node.buffer = silent;
      node.connect(this.context.destination);
      node.start(0);
    } catch {
      // The context can reject an unlock buffer once playback is already allowed.
    }
  }

  async ensureRunning(): Promise<void> {
    this.connectGraph();
    if (this.context.state === "running") return;
    if (navigator.userActivation && !navigator.userActivation.isActive) {
      throw new Error("Tap Play to start audio.");
    }
    let failed = false;
    await Promise.race([
      this.context.resume().then(
        () => undefined,
        () => {
          failed = true;
        },
      ),
      new Promise<void>((resolve) => {
        window.setTimeout(resolve, 2000);
      }),
    ]);
    const state = this.context.state as AudioContextState;
    if (failed || state !== "running") {
      throw new Error("Tap Play to start audio.");
    }
  }

  setVolume(value: number): void {
    this.gain.gain.value = value;
  }

  private adopt(buffer: AudioBuffer, name: string, source: Blob): void {
    this.buffer = buffer;
    this.mono = mixMono(buffer);
    this.peaks = waveformPeaks(buffer, 220);
    this.name = name;
    if (this.url) URL.revokeObjectURL(this.url);
    this.url = URL.createObjectURL(source);
    this.element.src = this.url;
    this.livePrev.fill(0);
  }

  async loadFile(file: File): Promise<void> {
    let bytes: ArrayBuffer;
    try {
      bytes = await file.arrayBuffer();
    } catch {
      throw new Error("Couldn't read that file.");
    }
    if (bytes.byteLength === 0) throw new Error("That file is empty.");
    const decoded = await decodeFile(bytes, this.context.sampleRate);
    const name = file.name.replace(/\.[^.]+$/, "") || "Audio";
    this.adopt(decoded, name, file);
  }

  async play(): Promise<void> {
    await this.ensureRunning();
    if (this.element.ended) this.element.currentTime = 0;
    await this.element.play();
  }

  pause(): void {
    this.element.pause();
  }

  sample(time: number): Spectrum {
    if (!this.mono || !this.buffer) {
      throw new Error("No audio loaded");
    }
    analyzeFrame(this.mono, this.buffer.sampleRate, time, this.workspace, this.livePrev, this.live);
    return this.live;
  }
}

export function sampleIdle(time: number, prev: Float32Array, out: Spectrum): Spectrum {
  idleSpectrum(time, prev, out);
  return out;
}
