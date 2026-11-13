import { AudioEngine, isAudioFile, sampleIdle } from "./audio";
import { EXPORT_FPS, ExportCancelled, exportVisualization } from "./exporter";
import { gpuAvailable, releaseScene } from "./glscenes";
import { BUILTIN_LOOKS, isBuiltinName, loadCustomLooks, removeCustomLook, resolveLook, upsertCustomLook, type Look } from "./looks";
import {
  PALETTES,
  hexToRgb,
  isBuiltinPaletteName,
  loadDraftPalette,
  loadSavedPalettes,
  paletteRgb,
  removeSavedPalette,
  retintStops,
  rgbToHex,
  rgbToHsl,
  saveDraftPalette,
  upsertSavedPalette,
  type Palette,
  type Rgb,
} from "./palette";
import { createSpectrum } from "./spectrum";
import { createVizState, renderFrame, type Follow, type SceneMode, type VizSettings } from "./visualizer";

function must<T extends Element>(selector: string): T {
  const element = document.querySelector(selector);
  if (!element) throw new Error(`Missing ${selector}`);
  return element as T;
}

const stage = must<HTMLCanvasElement>("#stage");
const fileInput = must<HTMLInputElement>("#file");
const openButton = must<HTMLButtonElement>("#open");
const playButton = must<HTMLButtonElement>("#play");
const saveLookButton = must<HTMLButtonElement>("#savelook");
const saveButton = must<HTMLButtonElement>("#save");
const fullButton = must<HTMLButtonElement>("#full");
const cancelButton = must<HTMLButtonElement>("#cancel");
const seek = must<HTMLInputElement>("#seek");
const volume = must<HTMLInputElement>("#volume");
const symmetry = must<HTMLInputElement>("#symmetry");
const smear = must<HTMLInputElement>("#smear");
const intensity = must<HTMLInputElement>("#intensity");
const palette = must<HTMLSelectElement>("#palette");
const follow = must<HTMLSelectElement>("#follow");
const mode = must<HTMLSelectElement>("#mode");
const lookSelect = must<HTMLSelectElement>("#look");
const resolution = must<HTMLSelectElement>("#resolution");
const symval = must<HTMLElement>("#symval");
const smearVal = must<HTMLElement>("#smearval");
const intensityVal = must<HTMLElement>("#intensityval");
const elapsed = must<HTMLElement>("#elapsed");
const total = must<HTMLElement>("#total");
const spanLabel = must<HTMLElement>("#span");
const crop = must<HTMLElement>("#crop");
const cropBefore = must<HTMLElement>("#crop-before");
const cropAfter = must<HTMLElement>("#crop-after");
const cropInHandle = must<HTMLButtonElement>("#crop-in");
const cropOutHandle = must<HTMLButtonElement>("#crop-out");
const markIn = must<HTMLButtonElement>("#mark-in");
const markOut = must<HTMLButtonElement>("#mark-out");
const stopButton = must<HTMLButtonElement>("#stop");
const muteButton = must<HTMLButtonElement>("#mute");
const gotoIn = must<HTMLButtonElement>("#goto-in");
const gotoOut = must<HTMLButtonElement>("#goto-out");
const previewButton = must<HTMLButtonElement>("#preview");
const loopButton = must<HTMLButtonElement>("#loop");
const resetRangeButton = must<HTMLButtonElement>("#reset-range");
const playhead = must<HTMLElement>("#playhead");
const exportMeta = must<HTMLElement>("#export-meta");
const exportWhole = must<HTMLElement>("#export-whole");
const lookNameRow = must<HTMLElement>("#look-name-row");
const lookNameInput = must<HTMLInputElement>("#look-name");
const lookNameSave = must<HTMLButtonElement>("#look-name-save");
const lookNameCancel = must<HTMLButtonElement>("#look-name-cancel");
const paletteNameRow = must<HTMLElement>("#palette-name-row");
const paletteNameInput = must<HTMLInputElement>("#palette-name");
const paletteNameSave = must<HTMLButtonElement>("#palette-name-save");
const paletteNameCancel = must<HTMLButtonElement>("#palette-name-cancel");
const deleteLookButton = must<HTMLButtonElement>("#deletelook");
const resetLookButton = must<HTMLButtonElement>("#reset-look");
const paletteCustom = must<HTMLElement>("#palette-custom");
const paletteSwatch = must<HTMLElement>("#palette-swatch");
const palHue = must<HTMLInputElement>("#pal-hue");
const palSpan = must<HTMLInputElement>("#pal-span");
const palSat = must<HTMLInputElement>("#pal-sat");
const palLight = must<HTMLInputElement>("#pal-light");
const palHueVal = must<HTMLElement>("#pal-hue-val");
const palSpanVal = must<HTMLElement>("#pal-span-val");
const palSatVal = must<HTMLElement>("#pal-sat-val");
const palLightVal = must<HTMLElement>("#pal-light-val");
const palColorA = must<HTMLInputElement>("#pal-a");
const palColorB = must<HTMLInputElement>("#pal-b");
const palColorC = must<HTMLInputElement>("#pal-c");
const savePaletteButton = must<HTMLButtonElement>("#savepalette");
const deletePaletteButton = must<HTMLButtonElement>("#deletepalette");
const now = must<HTMLElement>("#now");
const veil = must<HTMLElement>("#dropveil");
const toastEl = must<HTMLElement>("#toast");
const exporting = must<HTMLElement>("#exporting");
const meterbar = must<HTMLElement>("#meterbar");
const meterlabel = must<HTMLElement>("#meterlabel");
const wave = must<HTMLCanvasElement>("#wave");

const ctx = stage.getContext("2d", { alpha: false, colorSpace: "srgb" });
const waveCtx = wave.getContext("2d");
if (!ctx || !waveCtx) throw new Error("Canvas is not available.");
const draw = ctx;
const waveDraw = waveCtx;

const settings: VizSettings = {
  mode: mode.value as SceneMode,
  symmetry: Number(symmetry.value),
  smear: Number(smear.value),
  intensity: Number(intensity.value),
  palette: Number(palette.value),
  custom: loadDraftPalette(),
  follow: follow.value as Follow,
};
const state = createVizState();
const idle = createSpectrum();
const idlePrev = new Float32Array(idle.bands.length);

let engine: AudioEngine | null = null;
let live = true;
let last = performance.now();
let scrubbing = false;
let busy = false;
let cancelExport = false;
let toastTimer = 0;
let cropIn = 0;
let cropOut = 0;
let cropDrag: "in" | "out" | null = null;
let rangePreview = false;
let loopRange = false;
let heldVolume = 0.9;
let windowHidden = false;
let fullscreenShown = false;
let sessionReady = false;
let storageNote = false;
let persistTimer = 0;
const MIN_EXPORT = 0.25;
const SESSION_KEY = "kaleido.session.v1";
const MODES: readonly SceneMode[] = ["mandala", "tunnel", "liquid", "starfield", "halo", "weave"];

function toast(message: string): void {
  toastEl.textContent = message;
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => {
    toastEl.hidden = true;
  }, 4600);
}

function storageFailed(): void {
  if (storageNote) return;
  storageNote = true;
  toast("This browser blocked saving in local storage.");
}

function rememberDraft(palette: Palette): void {
  if (!saveDraftPalette(palette)) storageFailed();
}

interface SessionSettings {
  mode: SceneMode;
  symmetry: number;
  smear: number;
  intensity: number;
  follow: Follow;
  palette: string;
  look: string;
}

function loadSession(): SessionSettings | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const row = JSON.parse(raw) as Record<string, unknown>;
    const mode = row.mode;
    const follow = row.follow;
    if (typeof mode !== "string" || !MODES.includes(mode as SceneMode)) return null;
    if (follow !== "all" && follow !== "low" && follow !== "high") return null;
    const symmetry = Number(row.symmetry);
    const smear = Number(row.smear);
    const intensity = Number(row.intensity);
    if (!Number.isFinite(symmetry) || !Number.isFinite(smear) || !Number.isFinite(intensity)) return null;
    return {
      mode: mode as SceneMode,
      symmetry: Math.round(Math.min(16, Math.max(4, symmetry))),
      smear: Math.min(1, Math.max(0, smear)),
      intensity: Math.min(1.8, Math.max(0.5, intensity)),
      follow,
      palette: typeof row.palette === "string" ? row.palette : "0",
      look: typeof row.look === "string" ? row.look : "",
    };
  } catch {
    return null;
  }
}

function persistSession(): void {
  if (!sessionReady) return;
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    const payload: SessionSettings = {
      mode: settings.mode,
      symmetry: settings.symmetry,
      smear: settings.smear,
      intensity: settings.intensity,
      follow: settings.follow,
      palette: palette.value,
      look: lookSelect.value,
    };
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(payload));
    } catch {
      storageFailed();
    }
  }, 160);
}

function applyChrome(): void {
  const hide = document.fullscreenElement ? !fullscreenShown : windowHidden;
  document.body.classList.toggle("is-clean", hide);
}

function toggleChrome(): void {
  if (document.fullscreenElement) fullscreenShown = !fullscreenShown;
  else windowHidden = !windowHidden;
  applyChrome();
  if (document.body.classList.contains("is-clean")) toast("Panels hidden. Press H to show them.");
}

function setPageLocked(locked: boolean): void {
  document.querySelector("#menus")?.toggleAttribute("inert", locked);
  if (locked && document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

function fileStem(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return cleaned.slice(0, 80) || "kaleido";
}

function typingTarget(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  if (target instanceof HTMLInputElement) {
    const kind = target.type;
    return kind === "text" || kind === "search" || kind === "number" || kind === "email" || kind === "password" || kind === "color";
  }
  return target instanceof HTMLElement && target.isContentEditable;
}

function setLoop(on: boolean): void {
  loopRange = on;
  loopButton.setAttribute("aria-pressed", on ? "true" : "false");
  loopButton.textContent = on ? "Looping" : "Loop";
}

function disarm(button: HTMLButtonElement): void {
  button.dataset.armed = "";
  button.textContent = "Delete";
}

function armDelete(button: HTMLButtonElement, action: () => void): void {
  if (button.disabled) return;
  if (button.dataset.armed !== "yes") {
    button.dataset.armed = "yes";
    button.textContent = "Sure?";
    window.setTimeout(() => {
      if (button.dataset.armed === "yes") disarm(button);
    }, 2800);
    return;
  }
  disarm(button);
  action();
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const whole = Math.floor(seconds);
  const mins = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function engineOrCreate(): AudioEngine {
  if (!engine) {
    engine = new AudioEngine();
    engine.setVolume(Number(volume.value));
    engine.element.addEventListener("play", syncTransport);
    engine.element.addEventListener("pause", syncTransport);
    engine.element.addEventListener("ended", () => {
      if (loopRange && !rangePreview && engine && !busy) {
        engine.element.currentTime = cropIn;
        void engine.play().catch(() => {
          setLoop(false);
          toast("Press Play again to start audio.");
        });
      }
      syncTransport();
    });
    engine.element.addEventListener("durationchange", syncTransport);
  }
  return engine;
}

function paintWave(peaks: Float32Array | null): void {
  const width = wave.width;
  const height = wave.height;
  waveDraw.clearRect(0, 0, width, height);
  if (!peaks) return;
  const gradient = waveDraw.createLinearGradient(0, 0, width, 0);
  gradient.addColorStop(0, "rgba(255, 62, 200, 0.85)");
  gradient.addColorStop(0.5, "rgba(255, 229, 106, 0.8)");
  gradient.addColorStop(1, "rgba(103, 255, 228, 0.85)");
  waveDraw.fillStyle = gradient;
  const mid = height / 2;
  for (let i = 0; i < peaks.length; i++) {
    const bar = Math.max(1, peaks[i] * (height * 0.86));
    const x = (i / peaks.length) * width;
    waveDraw.fillRect(x, mid - bar / 2, Math.max(1.2, width / peaks.length - 0.6), bar);
  }
}

function syncTransport(): void {
  const audio = engine?.element;
  const duration = audio && Number.isFinite(audio.duration) ? audio.duration : 0;
  if (!scrubbing) {
    seek.max = String(duration);
    seek.value = String(audio?.currentTime ?? 0);
  }
  elapsed.textContent = formatTime(audio?.currentTime ?? 0);
  total.textContent = formatTime(duration);
  const loaded = Boolean(engine?.buffer);
  document.body.classList.toggle("has-track", loaded);
  playButton.disabled = busy || !loaded;
  stopButton.disabled = busy || !loaded;
  saveButton.disabled = busy || !loaded;
  seek.disabled = busy || !loaded;
  openButton.disabled = busy;
  playButton.textContent = audio && !audio.paused ? "Pause" : "Play";
  if (engine?.name) now.textContent = engine.name;
  paintCrop();
}

function trackDuration(): number {
  const duration = engine?.buffer?.duration ?? 0;
  return Number.isFinite(duration) ? duration : 0;
}

function resetCrop(): void {
  cropIn = 0;
  cropOut = trackDuration();
  paintCrop();
}

function setCropIn(time: number): void {
  const duration = trackDuration();
  if (duration <= MIN_EXPORT) return;
  cropIn = Math.min(Math.max(0, time), Math.max(0, cropOut - MIN_EXPORT));
  paintCrop();
}

function setCropOut(time: number): void {
  const duration = trackDuration();
  if (duration <= MIN_EXPORT) return;
  cropOut = Math.max(Math.min(duration, time), Math.min(duration, cropIn + MIN_EXPORT));
  paintCrop();
}

function paintCrop(): void {
  const duration = trackDuration();
  const ready = duration > MIN_EXPORT && !busy;
  crop.hidden = duration <= 0;
  markIn.disabled = !ready;
  markOut.disabled = !ready;
  gotoIn.disabled = !ready;
  gotoOut.disabled = !ready;
  previewButton.disabled = !ready;
  loopButton.disabled = !ready;
  resetRangeButton.disabled = !ready;
  cropInHandle.disabled = !ready;
  cropOutHandle.disabled = !ready;
  paintPlayhead();
  if (duration <= 0) {
    spanLabel.textContent = "0:00–0:00";
    exportMeta.textContent = "0:00 · 0 frames";
    exportWhole.hidden = true;
    saveButton.textContent = "Save MP4";
    return;
  }
  const inPct = (cropIn / duration) * 100;
  const outPct = (cropOut / duration) * 100;
  cropBefore.style.width = `${inPct}%`;
  cropAfter.style.left = `${outPct}%`;
  cropAfter.style.right = "0";
  cropInHandle.style.left = `${inPct}%`;
  cropOutHandle.style.left = `${outPct}%`;
  const span = Math.max(0, cropOut - cropIn);
  const frames = Math.max(1, Math.ceil(span * EXPORT_FPS));
  spanLabel.textContent = `${formatTime(cropIn)}–${formatTime(cropOut)} · ${formatTime(span)}`;
  exportMeta.textContent = `${formatTime(span)} · ${frames.toLocaleString()} frames`;
  exportWhole.hidden = !(cropIn <= 0.05 && duration - cropOut <= 0.05);
  saveButton.textContent = `Save MP4 · ${formatTime(span)}`;
}

function paintPlayhead(): void {
  const duration = trackDuration();
  const time = engine?.element.currentTime ?? 0;
  if (duration <= 0) {
    playhead.hidden = true;
    return;
  }
  playhead.hidden = false;
  playhead.style.left = `${(Math.min(duration, Math.max(0, time)) / duration) * 100}%`;
}

function holdRange(): void {
  if (!engine?.buffer || scrubbing || busy) return;
  const time = engine.element.currentTime;
  if (rangePreview && time >= cropOut - 0.015) {
    rangePreview = false;
    engine.pause();
    const duration = trackDuration();
    engine.element.currentTime = Number.isFinite(duration) ? Math.min(cropOut, duration) : cropOut;
    return;
  }
  if (loopRange && !rangePreview && !engine.element.paused && time >= cropOut - 0.015) {
    engine.element.currentTime = cropIn;
  }
}

function timeAt(clientX: number): number {
  const rect = seek.parentElement?.getBoundingClientRect();
  const duration = trackDuration();
  if (!rect || rect.width <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  return ratio * duration;
}

function resize(): void {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  let width = Math.max(1, Math.floor(window.innerWidth * dpr));
  let height = Math.max(1, Math.floor(window.innerHeight * dpr));
  const limit = 1920;
  const longest = Math.max(width, height);
  if (longest > limit) {
    const scale = limit / longest;
    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }
  if (stage.width === width && stage.height === height) return;
  stage.width = width;
  stage.height = height;
  draw.fillStyle = "#000";
  draw.fillRect(0, 0, width, height);
}

function blitPreview(frame: HTMLCanvasElement): void {
  const scale = Math.min(stage.width / frame.width, stage.height / frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  const x = (stage.width - width) / 2;
  const y = (stage.height - height) / 2;
  draw.fillStyle = "#000";
  draw.fillRect(0, 0, stage.width, stage.height);
  draw.drawImage(frame, x, y, width, height);
}

function loop(nowMs: number): void {
  if (!live) return;
  const dt = Math.min(0.05, (nowMs - last) / 1000);
  last = nowMs;
  resize();
  const spectrum = engine?.mono
    ? engine.sample(engine.element.currentTime || 0)
    : sampleIdle(state.time, idlePrev, idle);
  const audioTime = engine?.buffer ? engine.element.currentTime || 0 : undefined;
  renderFrame(draw, stage.width, stage.height, dt, spectrum, settings, state, audioTime === undefined ? undefined : { time: audioTime });
  holdRange();
  if (!scrubbing && engine?.buffer) {
    elapsed.textContent = formatTime(engine.element.currentTime);
    seek.value = String(engine.element.currentTime);
    paintPlayhead();
  }
  requestAnimationFrame(loop);
}

async function openFile(file: File): Promise<void> {
  if (!isAudioFile(file)) {
    toast("That doesn't look like an audio file.");
    return;
  }
  const audio = engineOrCreate();
  if (!navigator.userActivation || navigator.userActivation.isActive) audio.unlock();
  openButton.disabled = true;
  now.textContent = "Decoding…";
  try {
    await audio.loadFile(file);
    releaseScene(state);
    state.hue = 0;
    state.hueTarget = 0;
    state.seenMode = "";
    paintWave(audio.peaks);
    resetCrop();
    syncTransport();
    document.title = `${audio.name} — Kaleido`;
    try {
      await audio.play();
    } catch {
      syncTransport();
    }
  } catch (error) {
    now.textContent = "Drop MP3, WAV, FLAC, OGG, M4A, or other audio";
    toast(error instanceof Error ? error.message : "Couldn't open that file.");
  } finally {
    syncTransport();
  }
}

async function togglePlay(): Promise<void> {
  if (!engine?.buffer) return;
  rangePreview = false;
  if (engine.element.paused) {
    if (loopRange) {
      const time = engine.element.currentTime;
      const duration = trackDuration();
      const end = Number.isFinite(duration) ? Math.min(cropOut, duration) : cropOut;
      if (time < cropIn || time >= end - 0.02) engine.element.currentTime = cropIn;
    }
    try {
      await engine.play();
    } catch {
      toast("Press Play again to start audio.");
    }
  } else {
    engine.pause();
  }
  syncTransport();
}

function download(blob: Blob, filename: string): void {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function saveMp4(): Promise<void> {
  if (!engine?.buffer || !engine.mono || busy) return;
  if (typeof VideoEncoder === "undefined") {
    toast("MP4 export needs Chrome or Edge.");
    return;
  }
  const [width, height] = resolution.value.split("x").map((part) => Number(part));
  if (!width || !height) return;

  busy = true;
  cancelExport = false;
  setPageLocked(true);
  engine.pause();
  syncTransport();
  live = false;
  exporting.hidden = false;
  meterbar.style.width = "0%";
  meterlabel.textContent = "Preparing";
  openButton.disabled = true;

  try {
    const blob = await exportVisualization({
      audio: engine.buffer,
      mono: engine.mono,
      settings: { ...settings, custom: { ...settings.custom } },
      width,
      height,
      fps: EXPORT_FPS,
      title: engine.name || "Kaleido",
      start: cropIn,
      end: cropOut,
      shouldCancel: () => cancelExport,
      onPreview: blitPreview,
      onProgress: (ratio, label) => {
        meterbar.style.width = `${Math.round(ratio * 100)}%`;
        meterlabel.textContent = label;
      },
    });
    download(blob, `${fileStem(engine.name || "kaleido")}.mp4`);
    toast(`Saved ${formatBytes(blob.size)}`);
  } catch (error) {
    if (error instanceof ExportCancelled) toast("Export cancelled.");
    else toast(error instanceof Error ? error.message : "Export failed.");
  } finally {
    busy = false;
    setPageLocked(false);
    exporting.hidden = true;
    live = true;
    last = performance.now();
    syncTransport();
    requestAnimationFrame(loop);
  }
}

openButton.addEventListener("click", () => {
  engineOrCreate().unlock();
  fileInput.click();
});
fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  if (!file) return;
  // iOS invalidates the chosen File if the input is cleared before it is read.
  void openFile(file).finally(() => {
    fileInput.value = "";
  });
});
playButton.addEventListener("click", () => void togglePlay());
saveButton.addEventListener("click", () => void saveMp4());
cancelButton.addEventListener("click", () => {
  cancelExport = true;
  meterlabel.textContent = "Cancelling";
});
fullButton.addEventListener("click", () => {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen();
});
document.addEventListener("fullscreenchange", () => {
  const on = Boolean(document.fullscreenElement);
  if (!on) fullscreenShown = false;
  applyChrome();
  fullButton.textContent = on ? "Exit full screen" : "Full screen";
  if (on) toast("Panels hidden. Press H to show them.");
});
window.addEventListener("beforeunload", (event) => {
  if (!busy) return;
  event.preventDefault();
  event.returnValue = "";
});
stage.addEventListener("dblclick", () => fullButton.click());

function rebuildLooks(selected = lookSelect.value): void {
  const custom = loadCustomLooks();
  lookSelect.replaceChildren();
  lookSelect.add(new Option("Custom", ""));
  const presets = document.createElement("optgroup");
  presets.label = "Presets";
  for (const look of BUILTIN_LOOKS) presets.append(new Option(look.name, `builtin:${look.name}`));
  lookSelect.append(presets);
  if (custom.length > 0) {
    const saved = document.createElement("optgroup");
    saved.label = "Saved";
    for (const look of custom) saved.append(new Option(look.name, `custom:${look.name}`));
    lookSelect.append(saved);
  }
  lookSelect.value = selected;
  if (lookSelect.value !== selected) lookSelect.value = "";
  syncLookTools();
}

function syncLookTools(): void {
  const custom = lookSelect.value.startsWith("custom:");
  deleteLookButton.disabled = !custom;
  if (!custom) disarm(deleteLookButton);
}

let paletteEditName = "";

function readPaletteSliders(): Palette {
  return {
    name: "Custom",
    hue: Number(palHue.value),
    span: Number(palSpan.value),
    sat: Number(palSat.value),
    light: Number(palLight.value),
  };
}

function paintSwatch(pal: Palette): void {
  const colors = paletteRgb(pal, 0);
  const css = (rgb: Rgb): string => `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]})`;
  paletteSwatch.style.background = `linear-gradient(90deg, ${css(colors.a)}, ${css(colors.b)}, ${css(colors.c)})`;
}

function syncPickers(pal: Palette): void {
  const colors = paletteRgb(pal, 0);
  palColorA.value = rgbToHex(colors.a);
  palColorB.value = rgbToHex(colors.b);
  palColorC.value = rgbToHex(colors.c);
}

function writePaletteSliders(pal: Palette, includePickers = true): void {
  palHue.value = String(Math.round(pal.hue));
  palSpan.value = String(Math.round(pal.span));
  palSat.value = String(Math.round(pal.sat));
  palLight.value = String(Math.round(pal.light));
  palHueVal.textContent = palHue.value;
  palSpanVal.textContent = palSpan.value;
  palSatVal.textContent = palSat.value;
  palLightVal.textContent = palLight.value;
  paintSwatch(pal);
  if (includePickers) syncPickers(pal);
}

function sameStops(a?: Palette["stops"], b?: Palette["stops"]): boolean {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return a.every((rgb, index) => rgb[0] === b[index][0] && rgb[1] === b[index][1] && rgb[2] === b[index][2]);
}

function paletteSelection(index: number, custom: Palette): string {
  if (index >= 0) return String(index);
  const saved = loadSavedPalettes().find((item) =>
    Math.round(item.hue) === Math.round(custom.hue) &&
    Math.round(item.span) === Math.round(custom.span) &&
    Math.round(item.sat) === Math.round(custom.sat) &&
    Math.round(item.light) === Math.round(custom.light) &&
    sameStops(item.stops, custom.stops)
  );
  return saved ? `saved:${saved.name}` : "custom";
}

function rebuildPalettes(selected = palette.value): void {
  const saved = loadSavedPalettes();
  palette.replaceChildren();
  const presets = document.createElement("optgroup");
  presets.label = "Presets";
  PALETTES.forEach((item, index) => presets.append(new Option(item.name, String(index))));
  palette.append(presets);
  palette.append(new Option("Custom", "custom"));
  if (saved.length > 0) {
    const group = document.createElement("optgroup");
    group.label = "Saved";
    for (const item of saved) group.append(new Option(item.name, `saved:${item.name}`));
    palette.append(group);
  }
  palette.value = selected;
  if (palette.value !== selected) palette.value = "custom";
  syncPalettePanel();
}

function syncPalettePanel(): void {
  const customOn = settings.palette < 0;
  paletteCustom.hidden = !customOn;
  const shown = customOn ? settings.custom : (PALETTES[settings.palette] ?? PALETTES[0]);
  syncPickers(shown);
  if (customOn) paintSwatch(settings.custom);
  deletePaletteButton.disabled = !palette.value.startsWith("saved:");
  if (deletePaletteButton.disabled) disarm(deletePaletteButton);
}

function applyLook(look: Look): void {
  settings.mode = look.mode;
  settings.symmetry = look.symmetry;
  settings.smear = look.smear;
  settings.intensity = look.intensity;
  settings.palette = look.palette;
  settings.follow = look.follow;
  if (look.palette < 0 && look.custom) {
    settings.custom = { ...look.custom, name: "Custom" };
    writePaletteSliders(settings.custom);
    rememberDraft(settings.custom);
  }
  mode.value = look.mode;
  symmetry.value = String(look.symmetry);
  symval.textContent = String(look.symmetry);
  smear.value = String(look.smear);
  smearVal.textContent = smear.value;
  intensity.value = String(look.intensity);
  intensityVal.textContent = intensity.value;
  palette.value = paletteSelection(settings.palette, settings.custom);
  paletteEditName = palette.value.startsWith("saved:") ? palette.value.slice("saved:".length) : "";
  follow.value = look.follow;
  syncPalettePanel();
  showPalette();
  persistSession();
  warnNoGpu();
}

function markCustom(): void {
  if (lookSelect.value) lookSelect.value = "";
  syncLookTools();
  persistSession();
}

function showPalette(): void {
  releaseScene(state);
}

const defaultLook: Look = {
  name: "Default",
  mode: "mandala",
  symmetry: 8,
  smear: 0.68,
  intensity: 1.1,
  palette: 0,
  follow: "all",
};

volume.addEventListener("input", () => {
  const level = Number(volume.value);
  if (level > 0) {
    heldVolume = level;
    muteButton.textContent = "Mute";
    muteButton.setAttribute("aria-pressed", "false");
  }
  engine?.setVolume(level);
});
symmetry.addEventListener("input", () => {
  settings.symmetry = Number(symmetry.value);
  symval.textContent = String(settings.symmetry);
  markCustom();
});
smear.addEventListener("input", () => {
  settings.smear = Number(smear.value);
  smearVal.textContent = smear.value;
  markCustom();
});
intensity.addEventListener("input", () => {
  settings.intensity = Number(intensity.value);
  intensityVal.textContent = intensity.value;
  markCustom();
});
palette.addEventListener("change", () => {
  const value = palette.value;
  if (value === "custom") {
    paletteEditName = "";
    settings.palette = -1;
    rememberDraft(settings.custom);
    syncPickers(settings.custom);
  } else if (value.startsWith("saved:")) {
    const name = value.slice("saved:".length);
    const found = loadSavedPalettes().find((item) => item.name === name);
    if (!found) {
      palette.value = "custom";
      paletteEditName = "";
      settings.palette = -1;
      settings.custom = readPaletteSliders();
    } else {
      paletteEditName = found.name;
      settings.palette = -1;
      settings.custom = { ...found };
      writePaletteSliders(settings.custom);
      rememberDraft(settings.custom);
    }
  } else {
    paletteEditName = "";
    const index = Number(value);
    settings.palette = Number.isFinite(index) ? index : 0;
  }
  syncPalettePanel();
  markCustom();
  showPalette();
});
for (const input of [palHue, palSpan, palSat, palLight]) {
  input.addEventListener("input", () => {
    if (palette.value.startsWith("saved:")) paletteEditName = palette.value.slice("saved:".length);
    const previous = settings.custom;
    const next = readPaletteSliders();
    if (previous.stops) next.stops = retintStops(previous.stops, previous, next);
    settings.custom = next;
    settings.palette = -1;
    syncPickers(settings.custom);
    palHueVal.textContent = palHue.value;
    palSpanVal.textContent = palSpan.value;
    palSatVal.textContent = palSat.value;
    palLightVal.textContent = palLight.value;
    paintSwatch(settings.custom);
    rememberDraft(settings.custom);
    if (palette.value !== "custom") palette.value = "custom";
    syncPalettePanel();
    markCustom();
    showPalette();
  });
}
function chosenName(input: HTMLInputElement, builtin: (name: string) => boolean, builtInMessage: string): string | null {
  const name = input.value.trim();
  if (!name) {
    toast("Add a name first.");
    input.focus();
    return null;
  }
  if (name.length > 40) {
    toast("Use a shorter name.");
    input.focus();
    return null;
  }
  if (builtin(name)) {
    toast(builtInMessage);
    input.focus();
    return null;
  }
  return name;
}
function closePaletteNamer(): void {
  paletteNameRow.hidden = true;
}
savePaletteButton.addEventListener("click", () => {
  paletteNameInput.value = paletteEditName;
  paletteNameRow.hidden = false;
  paletteNameInput.focus();
  paletteNameInput.select();
});
paletteNameCancel.addEventListener("click", closePaletteNamer);
paletteNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    paletteNameSave.click();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closePaletteNamer();
  }
});
paletteNameSave.addEventListener("click", () => {
  const name = chosenName(paletteNameInput, isBuiltinPaletteName, "Built-in palettes stay as they are. Pick another name.");
  if (!name) return;
  const saved = { ...settings.custom, ...readPaletteSliders(), name };
  if (settings.custom.stops) saved.stops = settings.custom.stops;
  settings.custom = saved;
  settings.palette = -1;
  rememberDraft(saved);
  if (!upsertSavedPalette(saved)) {
    storageFailed();
    return;
  }
  paletteEditName = name;
  closePaletteNamer();
  rebuildPalettes(`saved:${name}`);
  markCustom();
  toast(`Saved ${name}`);
});
deletePaletteButton.addEventListener("click", () => {
  armDelete(deletePaletteButton, () => {
    const id = palette.value;
    if (!id.startsWith("saved:")) return;
    const name = id.slice("saved:".length);
    if (!removeSavedPalette(name)) {
      storageFailed();
      return;
    }
    paletteEditName = "";
    settings.palette = -1;
    settings.custom = { ...settings.custom, name: "Custom" };
    rememberDraft(settings.custom);
    rebuildPalettes("custom");
    markCustom();
    toast(`Removed ${name}`);
  });
});
follow.addEventListener("change", () => {
  settings.follow = follow.value as Follow;
  markCustom();
});
for (const input of [palColorA, palColorB, palColorC]) {
  input.addEventListener("input", () => {
    const stops: [Rgb, Rgb, Rgb] = [
      hexToRgb(palColorA.value) ?? [255, 255, 255],
      hexToRgb(palColorB.value) ?? [255, 255, 255],
      hexToRgb(palColorC.value) ?? [255, 255, 255],
    ];
    const base = rgbToHsl(stops[0]);
    const end = rgbToHsl(stops[2]);
    settings.custom = {
      name: "Custom",
      hue: base.h,
      span: (end.h - base.h + 360) % 360,
      sat: base.s,
      light: Math.max(28, Math.min(82, base.l)),
      stops,
    };
    settings.palette = -1;
    writePaletteSliders(settings.custom, false);
    rememberDraft(settings.custom);
    if (palette.value !== "custom") {
      if (palette.value.startsWith("saved:")) paletteEditName = palette.value.slice("saved:".length);
      palette.value = "custom";
    }
    syncPalettePanel();
    markCustom();
    showPalette();
  });
}
function warnNoGpu(): void {
  if (settings.mode !== "mandala" && !gpuAvailable()) toast("This browser has no WebGL2, so every scene draws as Mandala.");
}

mode.addEventListener("change", () => {
  settings.mode = mode.value as SceneMode;
  markCustom();
  warnNoGpu();
});
lookSelect.addEventListener("change", () => {
  const look = resolveLook(lookSelect.value);
  if (look) applyLook(look);
  else persistSession();
  syncLookTools();
});
function closeLookNamer(): void {
  lookNameRow.hidden = true;
}
saveLookButton.addEventListener("click", () => {
  lookNameInput.value = "";
  lookNameRow.hidden = false;
  lookNameInput.focus();
});
lookNameCancel.addEventListener("click", closeLookNamer);
lookNameInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    lookNameSave.click();
  } else if (event.key === "Escape") {
    event.preventDefault();
    closeLookNamer();
  }
});
lookNameSave.addEventListener("click", () => {
  const name = chosenName(lookNameInput, isBuiltinName, "Built-in looks stay as they are. Pick another name.");
  if (!name) return;
  const savedLook: Look = {
    name,
    mode: settings.mode,
    symmetry: settings.symmetry,
    smear: settings.smear,
    intensity: settings.intensity,
    palette: settings.palette < 0 ? -1 : settings.palette,
    follow: settings.follow,
  };
  if (savedLook.palette < 0) savedLook.custom = { ...settings.custom, name: "Custom" };
  if (!upsertCustomLook(savedLook)) {
    storageFailed();
    return;
  }
  closeLookNamer();
  rebuildLooks(`custom:${name}`);
  persistSession();
  toast(`Saved ${name}`);
});
deleteLookButton.addEventListener("click", () => {
  armDelete(deleteLookButton, () => {
    const id = lookSelect.value;
    if (!id.startsWith("custom:")) return;
    const name = id.slice("custom:".length);
    if (!removeCustomLook(name)) {
      storageFailed();
      return;
    }
    rebuildLooks("");
    persistSession();
    toast(`Removed ${name}`);
  });
});
resetLookButton.addEventListener("click", () => {
  applyLook(defaultLook);
  lookSelect.value = "";
  syncLookTools();
  persistSession();
});

function dragCrop(which: "in" | "out", event: PointerEvent): void {
  if (busy || !engine?.buffer) return;
  event.preventDefault();
  event.stopPropagation();
  cropDrag = which;
  (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  if (which === "in") setCropIn(timeAt(event.clientX));
  else setCropOut(timeAt(event.clientX));
}

cropInHandle.addEventListener("pointerdown", (event) => dragCrop("in", event));
cropOutHandle.addEventListener("pointerdown", (event) => dragCrop("out", event));
for (const handle of [cropInHandle, cropOutHandle]) {
  handle.addEventListener("pointermove", (event) => {
    if (!cropDrag) return;
    if (cropDrag === "in") setCropIn(timeAt(event.clientX));
    else setCropOut(timeAt(event.clientX));
  });
  handle.addEventListener("pointerup", () => {
    cropDrag = null;
  });
  handle.addEventListener("pointercancel", () => {
    cropDrag = null;
  });
}
markIn.addEventListener("click", () => {
  if (engine?.buffer) setCropIn(engine.element.currentTime);
});
markOut.addEventListener("click", () => {
  if (engine?.buffer) setCropOut(engine.element.currentTime);
});

function seekTo(time: number): void {
  if (!engine?.buffer) return;
  rangePreview = false;
  const duration = trackDuration();
  engine.element.currentTime = Math.min(Math.max(0, time), duration || 0);
  syncTransport();
}

stopButton.addEventListener("click", () => {
  if (!engine?.buffer) return;
  rangePreview = false;
  engine.pause();
  seekTo(0);
});
gotoIn.addEventListener("click", () => seekTo(cropIn));
gotoOut.addEventListener("click", () => seekTo(cropOut));
resetRangeButton.addEventListener("click", () => {
  rangePreview = false;
  resetCrop();
});
previewButton.addEventListener("click", () => {
  if (!engine?.buffer || busy) return;
  rangePreview = true;
  engine.element.currentTime = cropIn;
  void engine.play().catch(() => {
    rangePreview = false;
    toast("Press Play again to start audio.");
  });
});
muteButton.addEventListener("click", () => {
  const muted = muteButton.getAttribute("aria-pressed") === "true";
  if (muted) {
    volume.value = String(heldVolume || 0.9);
    muteButton.textContent = "Mute";
    muteButton.setAttribute("aria-pressed", "false");
  } else {
    heldVolume = Number(volume.value) || heldVolume || 0.9;
    volume.value = "0";
    muteButton.textContent = "Unmute";
    muteButton.setAttribute("aria-pressed", "true");
  }
  engine?.setVolume(Number(volume.value));
});

seek.addEventListener("pointerdown", () => {
  scrubbing = true;
});
window.addEventListener("pointerup", () => {
  scrubbing = false;
});
seek.addEventListener("pointercancel", () => {
  scrubbing = false;
});
window.addEventListener("pointercancel", () => {
  scrubbing = false;
});
loopButton.addEventListener("click", () => {
  if (!engine?.buffer || busy) return;
  setLoop(!loopRange);
});
seek.addEventListener("input", () => {
  if (!engine) return;
  rangePreview = false;
  engine.element.currentTime = Number(seek.value);
  elapsed.textContent = formatTime(engine.element.currentTime);
  paintPlayhead();
});

window.addEventListener("keydown", (event) => {
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  if (typingTarget(event.target)) return;
  if (event.code === "KeyH") {
    event.preventDefault();
    toggleChrome();
    return;
  }
  if (!engine?.buffer || busy) return;
  const onSlider = event.target instanceof HTMLInputElement && event.target.type === "range" && event.target !== seek;
  if (event.code === "Space") {
    event.preventDefault();
    void togglePlay();
  } else if (event.code === "KeyI") {
    event.preventDefault();
    setCropIn(engine.element.currentTime);
  } else if (event.code === "KeyO") {
    event.preventDefault();
    setCropOut(engine.element.currentTime);
  } else if (!onSlider && (event.code === "ArrowLeft" || event.code === "ArrowRight")) {
    event.preventDefault();
    const step = event.shiftKey ? 5 : 1;
    const direction = event.code === "ArrowLeft" ? -1 : 1;
    seekTo(engine.element.currentTime + direction * step);
  }
});

let dragDepth = 0;
window.addEventListener("dragenter", (event) => {
  event.preventDefault();
  dragDepth += 1;
  veil.hidden = false;
});
window.addEventListener("dragover", (event) => event.preventDefault());
window.addEventListener("dragleave", () => {
  dragDepth = Math.max(0, dragDepth - 1);
  if (dragDepth === 0) veil.hidden = true;
});
window.addEventListener("drop", (event) => {
  event.preventDefault();
  dragDepth = 0;
  veil.hidden = true;
  const file = event.dataTransfer?.files?.[0];
  if (file && !busy) void openFile(file);
});

const MENU_KEY = "kaleido.menus.v2";
const MENU_WIDTH: Record<string, number> = { play: 760, look: 320, export: 320 };

interface MenuLayout {
  collapsed: boolean;
  width: number;
  height: number | null;
  x: number;
  y: number;
}

const MOBILE_LAYOUT = "(hover: none) and (pointer: coarse), (max-width: 820px)";
const DOCK_KEY = "kaleido.dock.v1";

function setupDock(menus: HTMLElement[]): void {
  const tabs = [...document.querySelectorAll<HTMLButtonElement>(".dock-tab")];
  const toggle = must<HTMLButtonElement>("#dock-toggle");
  const label = must<HTMLElement>("#dock-toggle-label");
  let panel = "play";
  let min = false;
  try {
    const saved = JSON.parse(localStorage.getItem(DOCK_KEY) ?? "{}") as { panel?: unknown; min?: unknown };
    if (saved.panel === "play" || saved.panel === "look" || saved.panel === "export") panel = saved.panel;
    min = saved.min === true;
  } catch {
    panel = "play";
    min = false;
  }

  const persist = (): void => {
    try {
      localStorage.setItem(DOCK_KEY, JSON.stringify({ panel, min }));
    } catch {
      storageFailed();
    }
  };

  const render = (): void => {
    document.body.classList.add("is-dock-ready");
    document.body.classList.toggle("is-dock-min", min);
    toggle.setAttribute("aria-expanded", String(!min));
    label.textContent = min ? "Controls" : "Hide";
    for (const menu of menus) {
      menu.classList.toggle("is-dock-open", menu.dataset.menu === panel);
    }
    for (const tab of tabs) {
      const on = tab.dataset.dock === panel;
      tab.classList.toggle("is-on", on);
      tab.setAttribute("aria-pressed", String(on));
    }
  };

  toggle.addEventListener("click", () => {
    min = !min;
    render();
    persist();
  });
  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const id = tab.dataset.dock;
      if (id !== "play" && id !== "look" && id !== "export") return;
      panel = id;
      min = false;
      render();
      persist();
    });
  }
  render();
}

function setupMenus(): void {
  const menus = [...document.querySelectorAll<HTMLElement>(".menu")];
  const mobileMedia = window.matchMedia(MOBILE_LAYOUT);
  let stored: Record<string, Partial<MenuLayout>> = {};
  try {
    stored = JSON.parse(localStorage.getItem(MENU_KEY) ?? "{}") as Record<string, Partial<MenuLayout>>;
  } catch {
    stored = {};
  }

  const persist = (): void => {
    if (mobileMedia.matches) return;
    const next: Record<string, MenuLayout> = {};
    for (const menu of menus) {
      const id = menu.dataset.menu;
      if (!id) continue;
      const rect = menu.getBoundingClientRect();
      const height = Number(menu.dataset.height);
      next[id] = {
        collapsed: menu.classList.contains("is-collapsed"),
        width: Math.round(rect.width),
        height: Number.isFinite(height) && height > 0 ? height : null,
        x: Math.round(rect.left),
        y: Math.round(rect.top),
      };
    }
    stored = next;
    try {
      localStorage.setItem(MENU_KEY, JSON.stringify(next));
    } catch {
      storageFailed();
    }
  };

  interface Anchor {
    fromLeft: number;
    fromTop: number;
    fromRight: number;
    fromBottom: number;
    stickRight: boolean;
    stickBottom: boolean;
    centered: boolean;
  }

  const anchor = new WeakMap<HTMLElement, Anchor>();

  const keepOnScreen = (menu: HTMLElement): void => {
    const rect = menu.getBoundingClientRect();
    const left = Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - rect.width - 8));
    const top = Math.min(Math.max(8, rect.top), Math.max(8, window.innerHeight - Math.min(rect.height, 40) - 8));
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  };

  const remember = (menu: HTMLElement): void => {
    const rect = menu.getBoundingClientRect();
    const fromLeft = rect.left;
    const fromTop = rect.top;
    const fromRight = window.innerWidth - rect.right;
    const fromBottom = window.innerHeight - rect.bottom;
    anchor.set(menu, {
      fromLeft,
      fromTop,
      fromRight,
      fromBottom,
      stickRight: fromRight < 72 && fromRight + 24 < fromLeft,
      stickBottom: fromBottom < 72 && fromBottom + 24 < fromTop,
      centered: Math.abs(fromLeft - fromRight) < 48,
    });
  };

  const applyAnchor = (menu: HTMLElement): void => {
    const point = anchor.get(menu);
    if (!point) return;
    const rect = menu.getBoundingClientRect();
    const left = point.centered
      ? (window.innerWidth - rect.width) / 2
      : point.stickRight
        ? window.innerWidth - rect.width - point.fromRight
        : point.fromLeft;
    const top = point.stickBottom
      ? window.innerHeight - rect.height - point.fromBottom
      : point.fromTop;
    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
    keepOnScreen(menu);
  };

  const toggleCollapsed = (menu: HTMLElement): void => {
    const before = menu.getBoundingClientRect();
    const stickBottom = anchor.get(menu)?.stickBottom ?? false;
    const collapsed = menu.classList.toggle("is-collapsed");
    menu.querySelector(".menu-toggle")?.setAttribute("aria-expanded", String(!collapsed));
    if (collapsed) {
      menu.classList.remove("is-sized");
      menu.style.height = "";
    } else if (menu.dataset.height) {
      menu.style.height = `${menu.dataset.height}px`;
      menu.classList.add("is-sized");
    }
    if (stickBottom) {
      const next = menu.getBoundingClientRect();
      menu.style.top = `${Math.round(before.bottom - next.height)}px`;
    }
    remember(menu);
    persist();
  };

  const placeDefaults = (): void => {
    const margin = 16;
    const play = document.querySelector<HTMLElement>("#menu-play");
    const look = document.querySelector<HTMLElement>("#menu-look");
    const exp = document.querySelector<HTMLElement>("#menu-export");
    if (!play || !look || !exp) return;
    const playW = Math.min(MENU_WIDTH.play, window.innerWidth - margin * 2);
    const sideW = Math.min(MENU_WIDTH.look, Math.max(220, window.innerWidth - margin * 2));
    play.style.width = `${playW}px`;
    look.style.width = `${sideW}px`;
    exp.style.width = `${sideW}px`;
    const playH = play.getBoundingClientRect().height;
    const lookH = look.getBoundingClientRect().height;
    play.style.left = `${Math.max(margin, (window.innerWidth - playW) / 2)}px`;
    play.style.top = `${Math.max(margin, window.innerHeight - playH - margin)}px`;
    const sideX = Math.max(margin, window.innerWidth - sideW - margin);
    look.style.left = `${sideX}px`;
    look.style.top = `${margin}px`;
    const exportTop = margin + lookH + 10;
    const exportH = exp.getBoundingClientRect().height;
    exp.style.left = `${sideX}px`;
    exp.style.top = `${Math.min(exportTop, Math.max(margin, window.innerHeight - exportH - margin))}px`;
  };

  let menuZ = 5;
  const raiseMenu = (menu: HTMLElement): void => {
    menuZ += 1;
    menu.style.zIndex = String(menuZ);
  };
  const menuLayer: Record<string, number> = { play: 3, look: 4, export: 5 };

  const layoutMenu = (menu: HTMLElement): void => {
    const id = menu.dataset.menu ?? "";
    const saved = stored[id];
    if (mobileMedia.matches) {
      menu.style.left = "";
      menu.style.top = "";
      menu.style.width = "";
      menu.style.height = "";
      menu.style.zIndex = "";
      menu.classList.remove("is-collapsed", "is-sized");
      menu.querySelector(".menu-toggle")?.setAttribute("aria-expanded", "true");
      return;
    }
    menu.style.zIndex = String(menuLayer[id] ?? 3);
    const maxWidth = Math.max(220, window.innerWidth - 16);
    const width = Math.min(maxWidth, Math.max(220, Number(saved?.width) || MENU_WIDTH[id] || 320));
    menu.style.width = `${width}px`;
    const rawHeight = Number(saved?.height);
    const height = Number.isFinite(rawHeight) && rawHeight > 0
      ? Math.min(window.innerHeight * 0.7, Math.max(120, rawHeight))
      : null;
    menu.classList.toggle("is-collapsed", Boolean(saved?.collapsed));
    if (height) menu.dataset.height = String(height);
    const openSized = Boolean(height) && !saved?.collapsed;
    menu.classList.toggle("is-sized", openSized);
    menu.style.height = openSized && height ? `${height}px` : "";
    menu.querySelector(".menu-toggle")?.setAttribute("aria-expanded", String(!saved?.collapsed));
    if (Number.isFinite(Number(saved?.x)) && Number.isFinite(Number(saved?.y))) {
      menu.style.left = `${Number(saved.x)}px`;
      menu.style.top = `${Number(saved.y)}px`;
    }
  };

  for (const menu of menus) {
    menu.addEventListener("pointerdown", () => {
      if (mobileMedia.matches) return;
      raiseMenu(menu);
    });
    layoutMenu(menu);

    const bar = menu.querySelector<HTMLElement>(".menu-bar");
    bar?.addEventListener("pointerdown", (event) => {
      if (mobileMedia.matches) return;
      if (event.button !== 0) return;
      const pointerId = event.pointerId;
      const startX = event.clientX;
      const startY = event.clientY;
      const origin = menu.getBoundingClientRect();
      let moved = false;
      const move = (ev: PointerEvent): void => {
        if (ev.pointerId !== pointerId) return;
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!moved && Math.hypot(dx, dy) < 5) return;
        if (!moved) {
          moved = true;
          bar.setPointerCapture(pointerId);
        }
        menu.style.left = `${Math.round(origin.left + dx)}px`;
        menu.style.top = `${Math.round(origin.top + dy)}px`;
        keepOnScreen(menu);
      };
      const finish = (ev: PointerEvent): void => {
        if (ev.pointerId !== pointerId) return;
        bar.removeEventListener("pointermove", move);
        bar.removeEventListener("pointerup", finish);
        bar.removeEventListener("pointercancel", finish);
        if (!moved) {
          toggleCollapsed(menu);
          return;
        }
        remember(menu);
        persist();
        bar.addEventListener("click", (click) => {
          click.preventDefault();
          click.stopPropagation();
        }, { capture: true, once: true });
      };
      bar.addEventListener("pointermove", move);
      bar.addEventListener("pointerup", finish);
      bar.addEventListener("pointercancel", finish);
    });
    bar?.addEventListener("keydown", (event) => {
      if (mobileMedia.matches) return;
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      toggleCollapsed(menu);
    });

    const handle = menu.querySelector<HTMLButtonElement>(".menu-resize");
    handle?.addEventListener("pointerdown", (event) => {
      if (mobileMedia.matches) return;
      event.preventDefault();
      event.stopPropagation();
      handle.setPointerCapture(event.pointerId);
      const startX = event.clientX;
      const startY = event.clientY;
      const startW = menu.getBoundingClientRect().width;
      const startH = menu.getBoundingClientRect().height;
      const move = (ev: PointerEvent): void => {
        const nextW = Math.min(window.innerWidth - 16, Math.max(220, startW + ev.clientX - startX));
        const nextH = Math.min(window.innerHeight * 0.7, Math.max(120, startH + ev.clientY - startY));
        menu.style.width = `${nextW}px`;
        menu.style.height = `${nextH}px`;
        menu.classList.add("is-sized");
        menu.dataset.height = String(Math.round(nextH));
      };
      const stop = (): void => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", stop);
        handle.removeEventListener("pointercancel", stop);
        remember(menu);
        persist();
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", stop);
      handle.addEventListener("pointercancel", stop);
    });
  }

  const settleDesktop = (): void => {
    if (mobileMedia.matches) return;
    const placed = menus.every((menu) => menu.style.left && menu.style.top);
    if (!placed) placeDefaults();
    for (const menu of menus) {
      keepOnScreen(menu);
      remember(menu);
    }
  };
  settleDesktop();

  let relayoutFrame = 0;
  const relayout = (): void => {
    if (mobileMedia.matches) return;
    cancelAnimationFrame(relayoutFrame);
    relayoutFrame = requestAnimationFrame(() => {
      for (const menu of menus) applyAnchor(menu);
    });
  };
  window.addEventListener("resize", relayout);
  document.addEventListener("fullscreenchange", relayout);
  mobileMedia.addEventListener("change", () => {
    for (const menu of menus) layoutMenu(menu);
    settleDesktop();
  });
  setupDock(menus);
}

function applyStoredSession(session: SessionSettings): void {
  settings.mode = session.mode;
  settings.symmetry = session.symmetry;
  settings.smear = session.smear;
  settings.intensity = session.intensity;
  settings.follow = session.follow;
  mode.value = session.mode;
  symmetry.value = String(session.symmetry);
  symval.textContent = String(session.symmetry);
  smear.value = String(session.smear);
  smearVal.textContent = smear.value;
  intensity.value = String(session.intensity);
  intensityVal.textContent = intensity.value;
  follow.value = session.follow;
  if (session.palette.startsWith("saved:")) {
    const name = session.palette.slice("saved:".length);
    const found = loadSavedPalettes().find((item) => item.name === name);
    settings.palette = -1;
    if (found) {
      settings.custom = { ...found };
      paletteEditName = found.name;
    }
  } else if (session.palette === "custom") {
    settings.palette = -1;
  } else {
    const index = Number(session.palette);
    settings.palette = Number.isInteger(index) && index >= 0 && index < PALETTES.length ? index : 0;
  }
}

setupMenus();
window.addEventListener("resize", resize);
resize();
paintWave(null);
const session = loadSession();
if (session) applyStoredSession(session);
rebuildLooks(session?.look ?? "");
writePaletteSliders(settings.custom);
rebuildPalettes(session?.palette ?? (settings.palette >= 0 ? String(settings.palette) : "custom"));
sessionReady = true;
syncTransport();
requestAnimationFrame(loop);
