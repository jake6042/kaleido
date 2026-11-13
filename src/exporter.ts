import {
  AudioBufferSource,
  BufferTarget,
  CanvasSource,
  Mp4OutputFormat,
  Output,
  Quality,
  canEncodeAudio,
  canEncodeVideo,
} from "mediabunny";
import { releaseScene } from "./glscenes";
import { analyzeFrame, BAND_COUNT, createSpectrum, createWorkspace } from "./spectrum";
import { createVizState, renderFrame, type VizSettings } from "./visualizer";

export const EXPORT_FPS = 30;

export class ExportCancelled extends Error {
  constructor() {
    super("Export cancelled");
    this.name = "ExportCancelled";
  }
}

export interface ExportJob {
  audio: AudioBuffer;
  mono: Float32Array;
  settings: VizSettings;
  width: number;
  height: number;
  fps: number;
  title: string;
  start: number;
  end: number;
  onProgress: (ratio: number, label: string) => void;
  onPreview: (canvas: HTMLCanvasElement) => void;
  shouldCancel: () => boolean;
}

function yieldToUi(): Promise<void> {
  const yieldNow = globalThis.scheduler?.yield;
  if (typeof yieldNow === "function") return yieldNow.call(globalThis.scheduler);
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function ensureExportFonts(): Promise<void> {
  await Promise.all([
    document.fonts.load("800 34px Syne"),
    document.fonts.load("340 13px Outfit"),
  ]);
  await document.fonts.ready;
}

function ellipsize(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (ctx.measureText(text).width <= maxWidth) return text;
  const ellipsis = "…";
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    const candidate = text.slice(0, mid) + ellipsis;
    if (ctx.measureText(candidate).width <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  const kept = lo > 0 ? text.slice(0, lo) : "";
  return kept + ellipsis;
}

function drawExportWatermark(ctx: CanvasRenderingContext2D, width: number, height: number, fileName: string): void {
  const scale = Math.min(width, height) / 720;
  const wordmarkPx = 34 * scale;
  const namePx = 13 * scale;
  const gap = 8 * scale;
  const insetX = 26 * scale;
  const insetY = 22 * scale;
  const margin = 26 * scale;
  const maxWidth = Math.max(8, width - insetX - margin);

  ctx.save();
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.font = `800 ${wordmarkPx}px Syne, sans-serif`;
  ctx.letterSpacing = `${-0.05 * wordmarkPx}px`;
  const brand = "Kaleido";
  const brandWidth = Math.min(ctx.measureText(brand).width, maxWidth);
  const angle = (100 * Math.PI) / 180;
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  const gradient = ctx.createLinearGradient(insetX, insetY, insetX + dx * brandWidth, insetY + dy * brandWidth);
  gradient.addColorStop(0, "#ff3ec8");
  gradient.addColorStop(0.46, "#ffe56a");
  gradient.addColorStop(1, "#67ffe4");
  ctx.fillStyle = gradient;
  ctx.fillText(brand, insetX, insetY);

  const nameY = insetY + wordmarkPx * 0.9 + gap;
  ctx.font = `340 ${namePx}px Outfit, "Segoe UI", sans-serif`;
  ctx.letterSpacing = `${0.04 * namePx}px`;
  ctx.fillStyle = "rgba(244, 239, 230, 0.62)";
  ctx.fillText(ellipsize(ctx, fileName, maxWidth), insetX, nameY);
  ctx.restore();
  ctx.letterSpacing = "0px";
}

function sliceBuffer(buffer: AudioBuffer, start: number, seconds: number): AudioBuffer | null {
  const rate = buffer.sampleRate;
  const startFrame = Math.min(buffer.length, Math.floor(start * rate));
  const frames = Math.min(buffer.length - startFrame, Math.ceil(seconds * rate));
  if (frames <= 0) return null;
  const out = new AudioBuffer({
    length: frames,
    numberOfChannels: buffer.numberOfChannels,
    sampleRate: rate,
  });
  for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
    out.getChannelData(channel).set(buffer.getChannelData(channel).subarray(startFrame, startFrame + frames));
  }
  return out;
}

export async function exportVisualization(job: ExportJob): Promise<Blob> {
  const { audio, mono, settings, width, height, fps, title } = job;
  const clipStart = Math.min(Math.max(0, job.start), audio.duration);
  const clipEnd = Math.min(Math.max(clipStart, job.end), audio.duration);
  const span = Math.max(1 / fps, clipEnd - clipStart);
  const videoQuality = new Quality({ bitrate: Math.round(width * height * 8) });
  const audioQuality = new Quality({ bitrate: 192_000 });
  const sampleRate = audio.sampleRate === 44100 || audio.sampleRate === 48000 ? audio.sampleRate : 48000;
  const latencyMode = "quality" as const;
  let hardwareAcceleration: "prefer-software" | "no-preference" = "prefer-software";

  const audioOk = await canEncodeAudio("aac", { numberOfChannels: 2, sampleRate, quality: audioQuality });
  let videoOk = await canEncodeVideo("avc", {
    width,
    height,
    quality: videoQuality,
    frameRate: fps,
    hardwareAcceleration,
    latencyMode,
  });
  if (!videoOk) {
    hardwareAcceleration = "no-preference";
    videoOk = await canEncodeVideo("avc", {
      width,
      height,
      quality: videoQuality,
      frameRate: fps,
      hardwareAcceleration,
      latencyMode,
    });
  }
  if (!videoOk || !audioOk) {
    throw new Error("This browser can't encode MP4. Open Kaleido in Chrome or Edge.");
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { alpha: false, colorSpace: "srgb" });
  if (!ctx) throw new Error("Couldn't create the export canvas.");
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, width, height);

  const target = new BufferTarget();
  const output = new Output({
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target,
  });
  const video = new CanvasSource(canvas, {
    codec: "avc",
    quality: videoQuality,
    keyFrameInterval: 2,
    hardwareAcceleration,
    latencyMode,
    onEncoderConfig(config) {
      const tagged = config as VideoEncoderConfig & {
        colorSpace?: {
          primaries: "bt709";
          transfer: "iec61966-2-1";
          matrix: "bt709";
          fullRange: boolean;
        };
      };
      tagged.colorSpace = {
        primaries: "bt709",
        transfer: "iec61966-2-1",
        matrix: "bt709",
        fullRange: true,
      };
    },
  });
  const audioSource = new AudioBufferSource({
    codec: "aac",
    quality: audioQuality,
    transform: {
      numberOfChannels: 2,
      sampleRate,
    },
  });
  output.addVideoTrack(video, { frameRate: fps });
  output.addAudioTrack(audioSource);
  output.setMetadataTags({ title: `${title} — Kaleido` });

  const cancelIfNeeded = (): void => {
    if (job.shouldCancel()) throw new ExportCancelled();
  };

  const encodeClip = async (): Promise<Blob> => {
    job.onProgress(0.02, "Encoding audio");

    const sliceSeconds = 2;
    for (let time = clipStart; time < clipEnd - 1e-4; time += sliceSeconds) {
      cancelIfNeeded();
      const piece = sliceBuffer(audio, time, Math.min(sliceSeconds, clipEnd - time));
      if (!piece) break;
      await audioSource.add(piece);
      const ratio = Math.min(1, (time + sliceSeconds - clipStart) / span);
      job.onProgress(0.02 + ratio * 0.08, "Encoding audio");
      await yieldToUi();
    }
    audioSource.close();

    const state = createVizState();
    const spectrum = createSpectrum();
    const prev = new Float32Array(BAND_COUNT);
    const workspace = createWorkspace();
    const frameCount = Math.max(1, Math.ceil(span * fps));
    const frameDuration = 1 / fps;

    try {
      await ensureExportFonts();
      const primeWindow = 2.5;
      const primeStart = Math.max(0, clipStart - primeWindow);
      state.time = primeStart;
      state.flow = primeStart * (0.16 + 0.4 * settings.intensity);
      if (clipStart - primeStart > frameDuration) {
        job.onProgress(0.1, "Matching playback");
        let primed = primeStart;
        let lastYield = 0;
        while (primed < clipStart - 1e-4) {
          cancelIfNeeded();
          const dt = Math.min(frameDuration, clipStart - primed);
          const sourceTime = primed + dt * 0.5;
          analyzeFrame(mono, audio.sampleRate, sourceTime, workspace, prev, spectrum);
          renderFrame(ctx, width, height, dt, spectrum, settings, state, { time: sourceTime });
          primed += dt;
          const now = performance.now();
          if (now - lastYield > 100) {
            lastYield = now;
            const span = Math.max(frameDuration, clipStart - primeStart);
            job.onProgress(0.1 + ((primed - primeStart) / span) * 0.04, "Matching playback");
            job.onPreview(canvas);
            await yieldToUi();
          }
        }
      }
      let lastUiUpdate = 0;
      for (let index = 0; index < frameCount; index++) {
        cancelIfNeeded();
        const time = index * frameDuration;
        const sourceTime = Math.min(clipEnd, clipStart + time + frameDuration * 0.5);
        analyzeFrame(mono, audio.sampleRate, sourceTime, workspace, prev, spectrum);
        renderFrame(ctx, width, height, frameDuration, spectrum, settings, state, { time: clipStart + time });

        const intro = Math.min(0.35, span * 0.12);
        const outro = Math.min(0.5, span * 0.18);
        let veil = 0;
        if (time < intro) veil = 1 - time / intro;
        const remaining = span - time;
        if (remaining < outro) veil = Math.max(veil, 1 - remaining / outro);
        if (veil > 0) {
          ctx.globalCompositeOperation = "source-over";
          ctx.globalAlpha = 1;
          ctx.fillStyle = `rgba(0,0,0,${veil})`;
          ctx.fillRect(0, 0, width, height);
        }
        drawExportWatermark(ctx, width, height, title);

        await video.add(time, frameDuration);

        const now = performance.now();
        if (index === frameCount - 1 || now - lastUiUpdate > 100) {
          lastUiUpdate = now;
          job.onPreview(canvas);
          const ratio = (index + 1) / frameCount;
          job.onProgress(0.14 + ratio * 0.85, `Rendering ${index + 1} / ${frameCount}`);
          await yieldToUi();
        }
      }

      video.close();
      job.onProgress(0.99, "Finishing file");
      await output.finalize();
    } finally {
      releaseScene(state);
    }
    if (!target.buffer) throw new Error("Export produced an empty file.");

    const bytes = new Uint8Array(target.buffer);
    const brand = String.fromCharCode(bytes[4] ?? 0, bytes[5] ?? 0, bytes[6] ?? 0, bytes[7] ?? 0);
    if (brand !== "ftyp") throw new Error("Export did not produce a valid MP4.");
    return new Blob([target.buffer], { type: "video/mp4" });
  };

  await output.start();
  try {
    return await encodeClip();
  } catch (error) {
    await output.cancel().catch(() => undefined);
    throw error;
  }
}
