import { PALETTES, parsePalette, type Palette } from "./palette";
import type { Follow } from "./spectrum";
import type { SceneMode } from "./visualizer";

export interface Look {
  name: string;
  mode: SceneMode;
  symmetry: number;
  smear: number;
  intensity: number;
  palette: number;
  custom?: Palette;
  follow: Follow;
}

export const BUILTIN_LOOKS: readonly Look[] = [
  { name: "Acid Temple", mode: "tunnel", symmetry: 8, smear: 0.84, intensity: 1.45, palette: 0, follow: "all" },
  { name: "Deep Void", mode: "starfield", symmetry: 7, smear: 0.62, intensity: 0.85, palette: 3, follow: "all" },
  { name: "Aurora Drift", mode: "liquid", symmetry: 6, smear: 0.92, intensity: 1.05, palette: 1, follow: "all" },
  { name: "Magma Burst", mode: "mandala", symmetry: 12, smear: 0.38, intensity: 1.6, palette: 2, follow: "all" },
  { name: "Halo Choir", mode: "halo", symmetry: 6, smear: 0.58, intensity: 1.25, palette: 4, follow: "all" },
  { name: "Silk Weave", mode: "weave", symmetry: 8, smear: 0.8, intensity: 1.15, palette: 5, follow: "all" },
];

const STORAGE_KEY = "kaleido.looks.v1";

function isMode(value: unknown): value is SceneMode {
  return value === "mandala" || value === "tunnel" || value === "liquid" || value === "starfield" || value === "halo" || value === "weave";
}

function isFollow(value: unknown): value is Follow {
  return value === "all" || value === "low" || value === "high";
}

function num(value: unknown, min: number, max: number, fallback: number): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

export function loadCustomLooks(): Look[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const looks: Look[] = [];
    for (const item of parsed) {
      if (!item || typeof item !== "object") continue;
      const row = item as Record<string, unknown>;
      if (typeof row.name !== "string" || !isMode(row.mode)) continue;
      const name = row.name.trim().slice(0, 40);
      if (!name) continue;
      const look: Look = {
        name,
        mode: row.mode,
        symmetry: Math.round(num(row.symmetry, 4, 16, 8)),
        smear: num(row.smear, 0, 1, 0.68),
        intensity: num(row.intensity, 0.5, 1.8, 1.1),
        palette: Math.round(num(row.palette, -1, PALETTES.length - 1, 0)),
        follow: isFollow(row.follow) ? row.follow : "all",
      };
      if (look.palette < 0) {
        const custom = parsePalette(row.custom);
        if (custom) look.custom = custom;
        else look.palette = 0;
      }
      looks.push(look);
    }
    return looks;
  } catch {
    return [];
  }
}

function writeLooks(looks: Look[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(looks));
    return true;
  } catch {
    return false;
  }
}

export function upsertCustomLook(look: Look): boolean {
  const looks = loadCustomLooks().filter((item) => item.name.toLowerCase() !== look.name.toLowerCase());
  looks.push(look);
  return writeLooks(looks);
}

export function removeCustomLook(name: string): boolean {
  const looks = loadCustomLooks().filter((item) => item.name.toLowerCase() !== name.trim().toLowerCase());
  return writeLooks(looks);
}

export function resolveLook(id: string): Look | null {
  if (id.startsWith("builtin:")) {
    const name = id.slice("builtin:".length);
    return BUILTIN_LOOKS.find((look) => look.name === name) ?? null;
  }
  if (id.startsWith("custom:")) {
    const name = id.slice("custom:".length);
    return loadCustomLooks().find((look) => look.name === name) ?? null;
  }
  return null;
}

export function isBuiltinName(name: string): boolean {
  const key = name.trim().toLowerCase();
  return BUILTIN_LOOKS.some((look) => look.name.toLowerCase() === key);
}
