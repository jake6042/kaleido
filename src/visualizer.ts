import { compositeScene } from "./glscenes";
import { hsl, hslToRgb, resolvePalette, type Palette } from "./palette";
import { BAND_COUNT, applyFollow, type Follow, type Spectrum, clamp } from "./spectrum";

export type SceneMode = "mandala" | "tunnel" | "liquid" | "starfield" | "halo" | "weave";
export type { Follow };

export interface VizSettings {
  mode: SceneMode;
  symmetry: number;
  intensity: number;
  smear: number;
  palette: number;
  custom: Palette;
  follow: Follow;
}

interface Particle {
  angle: number;
  radius: number;
  spin: number;
  drift: number;
  size: number;
  life: number;
  maxLife: number;
  hueShift: number;
}

interface Shock {
  radius: number;
  speed: number;
  life: number;
  hueShift: number;
  width: number;
}

export interface VizState {
  time: number;
  flow: number;
  hue: number;
  hueTarget: number;
  smooth: Float32Array;
  beat: number;
  kick: number;
  snare: number;
  hat: number;
  kickCool: number;
  snareCool: number;
  hatCool: number;
  zoom: number;
  punch: number;
  bass: number;
  mid: number;
  high: number;
  loud: number;
  energy: number;
  phrase: number;
  section: number;
  sectionCool: number;
  seenMode: SceneMode | "";
  particles: Particle[];
  shocks: Shock[];
}

const TAU = Math.PI * 2;

function activePalette(settings: VizSettings): Palette {
  return resolvePalette(settings.palette, settings.custom);
}

export function createVizState(): VizState {
  return {
    time: 0,
    flow: 0,
    hue: 0,
    hueTarget: 0,
    smooth: new Float32Array(BAND_COUNT),
    beat: 0,
    kick: 0,
    snare: 0,
    hat: 0,
    kickCool: 0,
    snareCool: 0,
    hatCool: 0,
    zoom: 1,
    punch: 0,
    bass: 0,
    mid: 0,
    high: 0,
    loud: 0,
    energy: 0,
    phrase: 0.34,
    section: 0.34,
    sectionCool: 1.2,
    seenMode: "",
    particles: [],
    shocks: [],
  };
}

function decay(value: number, dt: number, tau: number): number {
  return value * Math.exp(-dt / tau);
}

function chase(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function stepParticles(state: VizState, dt: number): void {
  const particles = state.particles;
  let write = 0;
  for (let i = 0; i < particles.length; i++) {
    const particle = particles[i];
    particle.life -= dt;
    particle.angle += particle.spin * dt;
    particle.radius += particle.drift * dt;
    if (particle.life <= 0 || particle.radius > 1.35) continue;
    particles[write++] = particle;
  }
  particles.length = write;
}

function stepShocks(state: VizState, dt: number): void {
  const shocks = state.shocks;
  let write = 0;
  for (let i = 0; i < shocks.length; i++) {
    const shock = shocks[i];
    shock.life -= dt / 0.85;
    shock.radius += shock.speed * dt;
    if (shock.life <= 0 || shock.radius > 1.25) continue;
    shocks[write++] = shock;
  }
  shocks.length = write;
}

function spawnSpark(state: VizState): void {
  const life = 0.32 + Math.random() * 0.38;
  state.particles.push({
    angle: Math.random() * TAU,
    radius: 0.18 + Math.random() * 0.72,
    spin: (Math.random() - 0.5) * 1.4,
    drift: 0.02 + Math.random() * 0.04,
    size: 0.7 + Math.random() * 1.3,
    life,
    maxLife: life,
    hueShift: Math.random() * 24,
  });
  if (state.particles.length > 150) state.particles.splice(0, state.particles.length - 150);
}

function hold(current: number, floor: number, hit: boolean, impulse: number, dt: number, tau: number): number {
  const rested = Math.max(floor, current * Math.exp(-dt / tau));
  if (!hit) return Math.min(1, rested);
  const target = Math.min(1, Math.max(rested, impulse));
  return Math.min(1, chase(current, target, dt, 0.06));
}

function drive(state: VizState, spectrum: Spectrum, settings: VizSettings, dt: number, pinnedTime?: number): void {
  state.kickCool = Math.max(0, state.kickCool - dt);
  state.snareCool = Math.max(0, state.snareCool - dt);
  state.hatCool = Math.max(0, state.hatCool - dt);

  const kickHit = spectrum.kick >= 0.28 && state.kickCool <= 0;
  const snareHit = spectrum.snare >= 0.28 && state.snareCool <= 0;
  const hatHit = spectrum.hat >= 0.26 && state.hatCool <= 0;
  if (kickHit) state.kickCool = 0.1;
  if (snareHit) state.snareCool = 0.09;
  if (hatHit) state.hatCool = 0.055;

  state.bass = chase(state.bass, spectrum.bass, dt, spectrum.bass > state.bass ? 0.09 : 0.28);
  state.mid = chase(state.mid, spectrum.mid, dt, spectrum.mid > state.mid ? 0.09 : 0.28);
  state.high = chase(state.high, spectrum.high, dt, spectrum.high > state.high ? 0.07 : 0.22);
  state.loud = chase(state.loud, spectrum.loud, dt, spectrum.loud > state.loud ? 0.1 : 0.32);
  state.energy = chase(state.energy, spectrum.energy, dt, spectrum.energy > state.energy ? 0.1 : 0.3);
  const presence = 0.42 + state.loud * 0.58;

  state.punch = decay(state.punch, dt, 0.34);
  state.kick = hold(state.kick, state.bass * presence, kickHit, spectrum.kick, dt, 0.2);
  state.snare = hold(state.snare, state.mid * presence, snareHit, spectrum.snare, dt, 0.16);
  state.hat = hold(state.hat, state.high * presence * 0.85, hatHit, spectrum.hat, dt, 0.1);
  if (kickHit) {
    state.punch = Math.min(0.03, state.punch + spectrum.kick * 0.01 * settings.intensity);
    spawnBurst(state, Math.max(state.energy, state.loud));
  }
  if (hatHit) spawnSpark(state);
  state.beat = state.kick;

  const targetZoom = 1 + state.loud * 0.06 * settings.intensity;
  state.zoom = chase(state.zoom, targetZoom, dt, targetZoom > state.zoom ? 0.2 : 0.55);

  state.flow += dt * (0.14 + state.loud * 0.42 * settings.intensity + state.kick * 0.16 + state.snare * 0.08);
  if (pinnedTime === undefined) {
    state.time += dt;
  } else {
    const gap = pinnedTime - state.time;
    if (gap > 0.3 || gap < -0.08) state.time = pinnedTime;
    else if (gap > 0.002) state.time += dt;
  }
  stepShocks(state, dt);
  stepParticles(state, dt);
}

function bandAt(smooth: Float32Array, t: number): number {
  const x = clamp(t, 0, 1) * (smooth.length - 1);
  const i = Math.floor(x);
  const f = x - i;
  const a = smooth[i] ?? 0;
  const b = smooth[Math.min(i + 1, smooth.length - 1)] ?? a;
  return a + (b - a) * f;
}

function spawnBurst(state: VizState, energy: number): void {
  for (let i = 0; i < 12; i++) {
    const life = 0.75 + Math.random() * 1.15;
    state.particles.push({
      angle: Math.random() * TAU,
      radius: 0.04 + Math.random() * 0.06,
      spin: (Math.random() - 0.5) * 2.4,
      drift: 0.16 + energy * 0.62,
      size: 1.5 + Math.random() * 3.4,
      life,
      maxLife: life,
      hueShift: Math.random() * 80 - 40,
    });
  }
  state.shocks.push({
    radius: 0.05,
    speed: 0.48 + energy * 0.75,
    life: 1,
    hueShift: Math.random() * 30,
    width: 2.2 + energy * 5,
  });
  if (state.particles.length > 150) state.particles.splice(0, state.particles.length - 150);
  if (state.shocks.length > 12) state.shocks.splice(0, state.shocks.length - 12);
}

function spawnAmbient(state: VizState): void {
  const life = 1.4 + Math.random() * 1.6;
  state.particles.push({
    angle: Math.random() * TAU,
    radius: 0.12 + Math.random() * 0.2,
    spin: (Math.random() - 0.5) * 0.8,
    drift: 0.04 + Math.random() * 0.08,
    size: 1.2 + Math.random() * 2.2,
    life,
    maxLife: life,
    hueShift: Math.random() * 40,
  });
}

function drawWarpedRing(
  ctx: CanvasRenderingContext2D,
  radius: number,
  amp: number,
  folds: number,
  time: number,
  phase: number,
  bands: Float32Array,
): void {
  const steps = 180;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * TAU;
    const mag = bandAt(bands, (i % steps) / steps);
    const wobble =
      Math.sin(a * folds + time * 1.6 + phase) * amp +
      Math.sin(a * folds * 0.5 - time * 0.8 + phase) * amp * 0.45;
    const r = radius * (1 + mag * 0.12) + wobble * (0.35 + mag);
    const x = Math.cos(a) * r;
    const y = Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.stroke();
}

function petalPath(bands: Float32Array, reach: number, slice: number, intensity: number): Path2D {
  const path = new Path2D();
  const samples = 36;
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const mag = bandAt(bands, t);
    const width = Math.sin(t * Math.PI) * slice * 0.46 * (0.28 + mag * 0.85);
    const rad = reach * (0.08 + t * (0.42 + mag * 0.58 * intensity));
    const x = Math.cos(width) * rad;
    const y = Math.sin(width) * rad;
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  for (let i = samples; i >= 0; i--) {
    const t = i / samples;
    const mag = bandAt(bands, t);
    const width = Math.sin(t * Math.PI) * slice * 0.46 * (0.28 + mag * 0.85);
    const rad = reach * (0.08 + t * (0.42 + mag * 0.58 * intensity));
    path.lineTo(Math.cos(-width) * rad, Math.sin(-width) * rad);
  }
  path.closePath();
  return path;
}

function drawPetals(
  ctx: CanvasRenderingContext2D,
  R: number,
  state: VizState,
  settings: VizSettings,
  spin: number,
  scale: number,
  alpha: number,
): void {
  const pal = activePalette(settings);
  const symmetry = clamp(Math.round(settings.symmetry), 3, 24);
  const slice = TAU / symmetry;
  const reach = R * scale;
  ctx.save();
  ctx.rotate(spin);
  ctx.globalCompositeOperation = "lighter";
  for (let s = 0; s < symmetry; s++) {
    const hue = pal.hue + (s / symmetry) * pal.span;
    ctx.save();
    ctx.rotate(s * slice);
    const petal = petalPath(state.smooth, reach, slice, settings.intensity);
    const gradient = ctx.createLinearGradient(0, 0, reach, 0);
    gradient.addColorStop(0, hsl(hue, pal.sat, 70, 0));
    gradient.addColorStop(0.4, hsl(hue + 16, pal.sat, pal.light, 0.28 * alpha));
    gradient.addColorStop(1, hsl(hue + 42, pal.sat, pal.light, 0.72 * alpha));
    ctx.fillStyle = gradient;
    ctx.fill(petal);
    ctx.lineWidth = Math.max(1, R * 0.0035);
    const offsets: Array<[number, number, number]> = [
      [-1.4, 0, 0],
      [1.1, 0.8, 28],
      [0.2, -1.1, -32],
    ];
    const px = R / 420;
    for (const [ox, oy, shift] of offsets) {
      ctx.save();
      ctx.translate(ox * px, oy * px);
      ctx.strokeStyle = hsl(hue + shift, 100, 68, 0.55 * alpha);
      ctx.stroke(petal);
      ctx.restore();
    }
    const bars = 18;
    for (let i = 0; i < bars; i++) {
      const t = (i + 0.5) / bars;
      const mag = bandAt(state.smooth, t);
      const a = (t - 0.5) * slice * 0.78;
      const r0 = reach * 0.22;
      const r1 = r0 + mag * reach * 0.72 * settings.intensity;
      ctx.strokeStyle = hsl(hue + t * 40, 100, 70, (0.15 + mag * 0.75) * alpha);
      ctx.lineWidth = Math.max(1, R * 0.004 * (0.6 + mag));
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * r0, Math.sin(a) * r0);
      ctx.lineTo(Math.cos(a) * r1, Math.sin(a) * r1);
      ctx.stroke();
    }
    ctx.restore();
  }
  ctx.restore();
}

function drawPolygons(
  ctx: CanvasRenderingContext2D,
  R: number,
  state: VizState,
  settings: VizSettings,
): void {
  const pal = activePalette(settings);
  const sides = clamp(Math.round(settings.symmetry), 3, 24);
  const bass = bandAt(state.smooth, 0.08);
  ctx.globalCompositeOperation = "lighter";
  for (let ring = 0; ring < 2; ring++) {
    const dir = ring === 0 ? 1 : -1;
    const radius = R * (ring === 0 ? 0.34 : 0.58) * (1 + bass * 0.08);
    ctx.save();
    ctx.rotate(state.time * dir * (0.35 + ring * 0.15));
    ctx.beginPath();
    for (let s = 0; s <= sides; s++) {
      const a = (s / sides) * TAU - Math.PI / 2;
      const mag = bandAt(state.smooth, (s % sides) / sides);
      const wob = 1 + mag * 0.16 * settings.intensity;
      const x = Math.cos(a) * radius * wob;
      const y = Math.sin(a) * radius * wob;
      if (s === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = hsl(pal.hue + ring * 48, pal.sat, pal.light, 0.55);
    ctx.lineWidth = Math.max(1, R * 0.003);
    ctx.stroke();
    ctx.restore();
  }
}

function drawRings(
  ctx: CanvasRenderingContext2D,
  R: number,
  state: VizState,
  settings: VizSettings,
): void {
  const pal = activePalette(settings);
  const folds = clamp(Math.round(settings.symmetry), 3, 24);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    const radius = R * (0.18 + t * 0.72);
    const hue = pal.hue + t * pal.span * 0.35;
    ctx.strokeStyle = hsl(hue, pal.sat, pal.light, 0.16 + t * 0.12);
    ctx.lineWidth = Math.max(1, R * 0.0022);
    ctx.save();
    ctx.rotate(state.time * (i % 2 === 0 ? 0.12 : -0.18));
    drawWarpedRing(ctx, radius, R * 0.035, folds, state.time, i * 1.3, state.smooth);
    ctx.restore();
  }
}

function drawParticles(
  ctx: CanvasRenderingContext2D,
  R: number,
  state: VizState,
  settings: VizSettings,
): void {
  const pal = activePalette(settings);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < state.particles.length; i++) {
    const p = state.particles[i];
    const alpha = Math.max(0, p.life / p.maxLife);
    const x = Math.cos(p.angle) * p.radius * R;
    const y = Math.sin(p.angle) * p.radius * R;
    ctx.fillStyle = hsl(pal.hue + p.hueShift, 100, 68, alpha);
    ctx.beginPath();
    ctx.arc(x, y, p.size * (R / 520) * settings.intensity, 0, TAU);
    ctx.fill();
  }
}

function drawShocks(
  ctx: CanvasRenderingContext2D,
  R: number,
  state: VizState,
  settings: VizSettings,
): void {
  const active = activePalette(settings);
  ctx.globalCompositeOperation = "lighter";
  for (let i = 0; i < state.shocks.length; i++) {
    const shock = state.shocks[i];
    ctx.strokeStyle = hsl(active.hue + shock.hueShift, 100, 70, Math.max(0, shock.life) * 0.85);
    ctx.lineWidth = shock.width * (R / 700) * (0.4 + Math.max(0, shock.life));
    ctx.beginPath();
    ctx.arc(0, 0, shock.radius * R, 0, TAU);
    ctx.stroke();
  }
}

function drawCore(
  ctx: CanvasRenderingContext2D,
  R: number,
  state: VizState,
  bass: number,
  settings: VizSettings,
): void {
  const pal = activePalette(settings);
  const radius = R * (0.014 + bass * 0.022 * settings.intensity + state.kick * 0.018);
  const px = R * 0.008;
  const blobs = [
    [-px, 0, 0],
    [px * 0.8, px * 0.5, 40],
    [px * 0.2, -px * 0.7, -36],
  ];
  ctx.globalCompositeOperation = "lighter";
  for (const [ox, oy, shift] of blobs) {
    ctx.fillStyle = hsl(pal.hue + shift, 100, 62, 0.9);
    ctx.beginPath();
    ctx.arc(ox, oy, radius, 0, TAU);
    ctx.fill();
  }
  ctx.fillStyle = hsl(pal.hue, 20, 96, 0.95);
  ctx.beginPath();
  ctx.arc(0, 0, radius * 0.38, 0, TAU);
  ctx.fill();
}

export interface FrameClock {
  time?: number;
}

export function advanceViz(state: VizState, dt: number, spectrum: Spectrum, settings: VizSettings, clock?: FrameClock): void {
  const safeDt = Math.max(0, Math.min(dt, 0.05));
  const bands = spectrum.bands;
  for (let i = 0; i < state.smooth.length; i++) {
    const target = bands[i] ?? 0;
    const tau = target > state.smooth[i] ? 0.08 : 0.24;
    const k = 1 - Math.exp(-safeDt / tau);
    state.smooth[i] += (target - state.smooth[i]) * k;
  }

  applyFollow(spectrum, settings.follow);
  drive(state, spectrum, settings, safeDt, clock?.time);
}

export function renderFrame(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dt: number,
  spectrum: Spectrum,
  settings: VizSettings,
  state: VizState,
  clock?: FrameClock,
): void {
  const safeDt = Math.max(0, Math.min(dt, 0.05));
  advanceViz(state, safeDt, spectrum, settings, clock);

  if (compositeScene(ctx, width, height, safeDt, settings, state)) {
    state.seenMode = settings.mode;
    return;
  }

  // Without WebGL2 every scene falls back to the canvas mandala.
  if (state.particles.length < 28 && Math.random() < safeDt * 8) spawnAmbient(state);
  if (state.seenMode !== "mandala") {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }
  state.seenMode = "mandala";

  const minDim = Math.min(width, height);
  const R = minDim * 0.5;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const fade = 0.12 + (1 - clamp(settings.smear, 0, 1)) * 0.32;
  const tint = hslToRgb(activePalette(settings).hue, 36, 5);

  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = `rgba(${tint[0]}, ${tint[1]}, ${tint[2]}, ${fade})`;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(cx, cy);
  const zoom = state.zoom + state.punch;
  ctx.scale(zoom, zoom);
  ctx.lineCap = "round";
  ctx.lineJoin = "round";

  drawRings(ctx, R, state, settings);
  drawPolygons(ctx, R, state, settings);
  drawPetals(ctx, R, state, settings, state.time * 0.16, 0.96, 1);
  drawPetals(ctx, R, state, settings, -state.time * 0.22 + 0.4, 0.48, 0.55);
  drawShocks(ctx, R, state, settings);
  drawParticles(ctx, R, state, settings);
  drawCore(ctx, R, state, spectrum.bass, settings);
  ctx.restore();

  const vignette = ctx.createRadialGradient(cx, cy, R * 0.35, cx, cy, Math.max(width, height) * 0.62);
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(0,0,0,0.48)");
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, width, height);
}
