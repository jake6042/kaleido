export type Rgb = [number, number, number];

export interface Palette {
  name: string;
  hue: number;
  span: number;
  sat: number;
  light: number;
  stops?: [Rgb, Rgb, Rgb];
}

export const PALETTES: Palette[] = [
  { name: "Acid", hue: 292, span: 310, sat: 100, light: 62 },
  { name: "Aurora", hue: 152, span: 96, sat: 92, light: 58 },
  { name: "Magma", hue: 8, span: 46, sat: 100, light: 57 },
  { name: "Void", hue: 258, span: 72, sat: 88, light: 66 },
  { name: "Tide", hue: 196, span: 70, sat: 92, light: 60 },
  { name: "Bloom", hue: 332, span: 54, sat: 90, light: 64 },
];

export const DEFAULT_CUSTOM: Palette = { name: "Custom", hue: 292, span: 140, sat: 96, light: 62 };

const SAVED_KEY = "kaleido.palettes.v1";
const DRAFT_KEY = "kaleido.palette.draft.v1";

function clampNum(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function finite(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function clampChannel(value: number): number {
  return clampNum(Math.round(value), 0, 255);
}

export function clampPalette(input: Palette): Palette {
  const name = input.name.trim().slice(0, 40) || "Custom";
  const palette: Palette = {
    name,
    hue: clampNum(input.hue, 0, 360),
    span: clampNum(input.span, 0, 360),
    sat: clampNum(input.sat, 0, 100),
    light: clampNum(input.light, 28, 82),
  };
  if (input.stops) palette.stops = input.stops.map((rgb) => [clampChannel(rgb[0]), clampChannel(rgb[1]), clampChannel(rgb[2])] as Rgb) as [Rgb, Rgb, Rgb];
  return palette;
}

export function parsePalette(value: unknown, fallbackName = "Custom"): Palette | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const hue = finite(row.hue);
  const span = finite(row.span);
  const sat = finite(row.sat);
  const light = finite(row.light);
  if (hue === null || span === null || sat === null || light === null) return null;
  const name = typeof row.name === "string" && row.name.trim() ? row.name.trim().slice(0, 40) : fallbackName;
  const palette = clampPalette({ name, hue, span, sat, light });
  const stops = parseStops(row.stops);
  if (stops) palette.stops = stops;
  return palette;
}

function parseStops(value: unknown): [Rgb, Rgb, Rgb] | undefined {
  if (!Array.isArray(value) || value.length !== 3) return undefined;
  const stops: Rgb[] = [];
  for (const item of value) {
    if (!Array.isArray(item) || item.length < 3) return undefined;
    const r = finite(item[0]);
    const g = finite(item[1]);
    const b = finite(item[2]);
    if (r === null || g === null || b === null) return undefined;
    stops.push([clampChannel(r), clampChannel(g), clampChannel(b)]);
  }
  return stops as [Rgb, Rgb, Rgb];
}

export function resolvePalette(index: number, custom: Palette): Palette {
  if (!Number.isFinite(index) || index < 0) return custom;
  return PALETTES[index] ?? PALETTES[0];
}

export function isBuiltinPaletteName(name: string): boolean {
  const key = name.trim().toLowerCase();
  return key === "custom" || PALETTES.some((palette) => palette.name.toLowerCase() === key);
}

export function loadDraftPalette(): Palette {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return { ...DEFAULT_CUSTOM };
    return parsePalette(JSON.parse(raw)) ?? { ...DEFAULT_CUSTOM };
  } catch {
    return { ...DEFAULT_CUSTOM };
  }
}

function writeStorage(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function saveDraftPalette(palette: Palette): boolean {
  const next = clampPalette({ ...palette, name: "Custom" });
  const draft: Record<string, unknown> = {
    hue: next.hue,
    span: next.span,
    sat: next.sat,
    light: next.light,
  };
  if (next.stops) draft.stops = next.stops;
  return writeStorage(DRAFT_KEY, draft);
}

export function loadSavedPalettes(): Palette[] {
  try {
    const raw = localStorage.getItem(SAVED_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const palettes: Palette[] = [];
    for (const item of parsed) {
      const palette = parsePalette(item);
      if (!palette || isBuiltinPaletteName(palette.name)) continue;
      if (palettes.some((existing) => existing.name.toLowerCase() === palette.name.toLowerCase())) continue;
      palettes.push(palette);
    }
    return palettes;
  } catch {
    return [];
  }
}

export function upsertSavedPalette(palette: Palette): boolean {
  const next = clampPalette(palette);
  const palettes = loadSavedPalettes().filter((item) => item.name.toLowerCase() !== next.name.toLowerCase());
  palettes.push(next);
  return writeStorage(SAVED_KEY, palettes);
}

export function removeSavedPalette(name: string): boolean {
  const palettes = loadSavedPalettes().filter((item) => item.name.toLowerCase() !== name.trim().toLowerCase());
  return writeStorage(SAVED_KEY, palettes);
}

export function rgbToHex(rgb: Rgb): string {
  const channel = (value: number): string => clampChannel(value).toString(16).padStart(2, "0");
  return `#${channel(rgb[0])}${channel(rgb[1])}${channel(rgb[2])}`;
}

export function hexToRgb(hex: string): Rgb | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = match[1];
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

export function rgbToHsl(rgb: Rgb): { h: number; s: number; l: number } {
  const r = rgb[0] / 255;
  const g = rgb[1] / 255;
  const b = rgb[2] / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: light * 100 };
  const delta = max - min;
  const sat = light > 0.5 ? delta / (2 - max - min) : delta / (max + min);
  let hue = 0;
  if (max === r) hue = (g - b) / delta + (g < b ? 6 : 0);
  else if (max === g) hue = (b - r) / delta + 2;
  else hue = (r - g) / delta + 4;
  return { h: hue * 60, s: sat * 100, l: light * 100 };
}

export function hsl(h: number, s: number, l: number, a: number): string {
  return `hsla(${((h % 360) + 360) % 360}, ${s}%, ${l}%, ${a})`;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const light = l / 100;
  const c = (1 - Math.abs(2 * light - 1)) * sat;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = light - c / 2;
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

/** Shift hand-picked stops with the sliders instead of replacing them. */
export function retintStops(stops: [Rgb, Rgb, Rgb], prev: Palette, next: Palette): [Rgb, Rgb, Rgb] {
  const hueDelta = next.hue - prev.hue;
  const spanDelta = next.span - prev.span;
  const satDelta = next.sat - prev.sat;
  const lightDelta = next.light - prev.light;
  const spanWeight = [0, 0.45, 1];
  return stops.map((rgb, index) => {
    const color = rgbToHsl(rgb);
    return hslToRgb(
      color.h + hueDelta + spanDelta * spanWeight[index],
      clampNum(color.s + satDelta, 0, 100),
      clampNum(color.l + lightDelta, 0, 100),
    );
  }) as [Rgb, Rgb, Rgb];
}

function rotateRgb(rgb: Rgb, hueShift: number): Rgb {
  if (!hueShift) return rgb;
  const hslColor = rgbToHsl(rgb);
  return hslToRgb(hslColor.h + hueShift, hslColor.s, hslColor.l);
}

export function paletteRgb(pal: Palette, hueShift: number): {
  a: Rgb;
  b: Rgb;
  c: Rgb;
} {
  if (pal.stops) {
    return {
      a: rotateRgb(pal.stops[0], hueShift),
      b: rotateRgb(pal.stops[1], hueShift),
      c: rotateRgb(pal.stops[2], hueShift),
    };
  }
  return {
    a: hslToRgb(pal.hue + hueShift, pal.sat, pal.light),
    b: hslToRgb(pal.hue + hueShift + pal.span * 0.45, pal.sat, pal.light),
    c: hslToRgb(pal.hue + hueShift + pal.span, pal.sat, Math.min(80, pal.light + 10)),
  };
}
