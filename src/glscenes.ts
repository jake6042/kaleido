import { paletteRgb, resolvePalette } from "./palette";
import { BAND_COUNT, clamp } from "./spectrum";
import type { SceneMode, VizSettings, VizState } from "./visualizer";

const TAU = Math.PI * 2;
const STAR_COUNT = 220;
const MAX_SYMMETRY = 24;
const BLOOM_LEVELS = 5;
const STAR_STRIDE = 8;

const FULLSCREEN_VS = `#version 300 es
void main() {
  vec2 pos = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(pos * 2.0 - 1.0, 0.0, 1.0);
}
`;

const TUNNEL_FS = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uResolution;
uniform float uTime;
uniform float uDt;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uEnergy;
uniform float uLoud;
uniform float uKick;
uniform float uSnare;
uniform float uHat;
uniform float uSmear;
uniform float uIntensity;
uniform float uSymmetry;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
out vec4 fragColor;

const float TAU = 6.28318530718;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = uv * 2.0 - 1.0;
  float aspect = uResolution.x / uResolution.y;
  p.x *= aspect;
  float sr = length(p);
  float sa = atan(p.y, p.x);

  float sym = max(3.0, floor(uSymmetry + 0.5));
  float zoomSpeed = min(0.72, (0.16 + uLoud * 0.38 + uHigh * 0.06 + uKick * 0.16) * uIntensity);
  float dir = 0.35 + 0.65 * sin(uTime * 0.13);
  float rot = (0.16 + uMid * 0.12 + uSnare * 0.16) * uDt * dir;
  float zoom = exp(zoomSpeed * uDt);
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 q = mat2(cs, -sn, sn, cs) * (p / zoom);

  float warp = (0.1 + uBass * 1.05 + uSnare * 0.25) * uIntensity;
  float r = length(q);
  float a = atan(q.y, q.x);
  a += sin(r * 7.0 - uTime * 0.9) * warp * 0.38;
  a += sin(uTime * 0.33 + r * 2.0) * uBass * 0.22;
  r += sin(a * 3.0 + uTime * 0.6) * warp * 0.045;

  float slice = TAU / sym;
  a = mod(a, slice);
  a = abs(a - slice * 0.5);
  q = vec2(cos(a), sin(a)) * r;
  q.x /= aspect;
  vec2 suv = clamp(q * 0.5 + 0.5, vec2(0.002), vec2(0.998));

  float halfLife = mix(0.07, 0.9, clamp(uSmear, 0.0, 1.0));
  float persist = exp(-uDt / halfLife);
  vec3 prev = texture(uPrev, suv).rgb;
  float prevPeak = max(max(prev.r, prev.g), prev.b);
  prev *= persist / (1.0 + prevPeak * 0.45);
  prev *= smoothstep(1.35, 0.2, sr);

  float fold = abs(sin(sa * sym * 0.5));
  float blades = pow(fold, 16.0);
  float travel = fract(sr * (2.2 + uBass * 1.4) - uTime * (0.18 + uHigh * 0.25));
  float spoke = sa * sym;
  vec2 ring = vec2(cos(spoke), sin(spoke));
  float ridges = smoothstep(0.72, 0.98, noise(ring * 2.0 + vec2(uTime * 0.15, travel * 5.0)));
  float near = exp(-sr * 1.15);
  float hueT = 0.5 + 0.5 * sin(sa * 2.0 + uTime * 0.45);
  vec3 tint = mix(uColorA, uColorB, hueT);
  tint = mix(tint, uColorC, clamp(uHigh * 0.8 + ridges * 0.4, 0.0, 1.0));

  vec3 add = tint * (0.28 + near) * (blades * (0.42 + uHigh * 0.35 + uHat * 0.45) + ridges * (0.3 + uEnergy * 0.4));
  add += tint * uKick * (blades * 0.85 + exp(-sr * sr * 8.0) * 0.28);
  add += tint * uHat * ridges * 0.5;
  add *= (0.45 + uLoud * 0.7) * (0.8 + uIntensity * 0.35);

  vec3 col = prev + add;
  float peak = max(max(col.r, col.g), col.b);
  col /= 1.0 + max(peak - 1.35, 0.0);
  fragColor = vec4(col, 1.0);
}
`;

const LIQUID_FS = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uResolution;
uniform float uFlow;
uniform float uDt;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uKick;
uniform float uSnare;
uniform float uHat;
uniform float uLoud;
uniform float uSmear;
uniform float uIntensity;
uniform float uSymmetry;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
out vec4 fragColor;

float hash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  mat2 m = mat2(0.80, 0.60, -0.60, 0.80);
  for (int i = 0; i < 3; i++) {
    v += a * noise(p);
    p = m * p * 2.03;
    a *= 0.5;
  }
  return v;
}

void main() {
  vec2 fragUv = gl_FragCoord.xy / uResolution;
  vec2 uv = fragUv - 0.5;
  float aspect = uResolution.x / uResolution.y;
  uv.x *= aspect;
  float sym = clamp((uSymmetry - 4.0) / 12.0, 0.0, 1.0);
  float scale = mix(0.85, 2.35, sym);
  float amp = (0.12 + uLoud * 0.9 + uBass * 0.4 + uSnare * 0.25) * mix(0.82, 1.25, clamp((uIntensity - 0.5) / 1.3, 0.0, 1.0));
  vec2 wind = vec2(sin(uFlow * 0.23), cos(uFlow * 0.19));
  vec2 base = uv * scale + wind * 0.35;

  vec2 warp = vec2(
    fbm(base + vec2(uFlow * 0.31, -uFlow * 0.22)),
    fbm(base + vec2(4.2, -uFlow * 0.27))
  );
  vec2 q = base + (warp - 0.5) * amp;
  q += (vec2(
    noise(uv * scale * 3.4 + uFlow * 0.55),
    noise(uv * scale * 3.4 - uFlow * 0.41 + 2.0)
  ) - 0.5) * (uHigh * 0.16 + uHat * 0.28) * uIntensity;

  float n = fbm(q + vec2(fbm(q + wind), fbm(q - wind.yx)) * (0.55 + uMid * 0.65));
  float n2 = fbm(q * 1.35 - wind * 0.8 + n * 1.4);
  float shade = smoothstep(0.12, 0.88, n2);
  vec3 fresh = mix(uColorA, uColorB, shade);
  float sheen = smoothstep(0.48, 0.92, n);
  fresh = mix(fresh, uColorC, sheen * (0.22 + uHigh * 0.55 + uKick * 0.5));
  float ink = smoothstep(0.18, 0.82, n2);
  fresh *= 0.03 + ink * (0.72 + uKick * 0.45);

  vec2 flow = ((warp - 0.5) * amp) / max(scale, 0.001);
  vec2 delta = vec2(flow.x / aspect, flow.y);
  float smear = clamp(uSmear, 0.0, 1.0);
  float speed = mix(0.55, 2.4, smear);
  vec2 advectUv = clamp(fragUv - delta * uDt * speed, vec2(0.002), vec2(0.998));
  vec3 prev = texture(uPrev, advectUv).rgb;
  float keep = mix(0.28, 0.86, smear);
  vec3 col = mix(fresh, prev, keep);
  float peak = max(max(col.r, col.g), col.b);
  col /= 1.0 + max(peak - 1.2, 0.0);
  fragColor = vec4(col, 1.0);
}
`;

const MANDALA_FS = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform sampler2D uBands;
uniform vec2 uResolution;
uniform float uTime;
uniform float uDt;
uniform float uBass;
uniform float uKick;
uniform float uSnare;
uniform float uHat;
uniform float uLoud;
uniform float uSmear;
uniform float uIntensity;
uniform float uSymmetry;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform vec4 uShockR;
uniform vec4 uShockA;
out vec4 fragColor;

const float TAU = 6.28318530718;
const float PI = 3.14159265359;

float bandAt(float t) {
  float x = clamp(t, 0.0, 1.0) * 71.0;
  float i = floor(x);
  float f = x - i;
  float a = texelFetch(uBands, ivec2(int(i), 0), 0).r;
  float b = texelFetch(uBands, ivec2(int(min(i + 1.0, 71.0)), 0), 0).r;
  return mix(a, b, f);
}

vec2 petalLayer(float folded, float r, float slice, float reach, float shift) {
  float guess = clamp(r / max(reach, 0.001), 0.0, 1.0);
  float mag = bandAt(fract(guess + shift));
  float inner = reach * 0.08;
  float outer = reach * (0.08 + 0.5 + mag * 0.48 * uIntensity);
  float t = clamp((r - inner) / max(outer - inner, 0.001), 0.0, 1.0);
  mag = bandAt(fract(t + shift));
  outer = reach * (0.08 + 0.46 + mag * 0.52 * uIntensity);
  t = clamp((r - inner) / max(outer - inner, 0.001), 0.0, 1.0);
  float halfAng = sin(t * PI) * slice * 0.46 * (0.28 + mag * 0.85) * (0.82 + uSnare * 0.35);
  float ang = 1.0 - smoothstep(max(halfAng * 0.2, 0.001), max(halfAng, 0.001), folded);
  float rad = smoothstep(inner, inner + reach * 0.045, r) * (1.0 - smoothstep(outer * 0.9, outer, r));
  float rim = smoothstep(halfAng * 0.42, halfAng * 0.9, folded) * (1.0 - smoothstep(halfAng * 0.9, halfAng, folded));
  return vec2(ang * rad, rim * rad);
}

float shockRing(float radius, float life, float r) {
  if (life <= 0.0 || radius <= 0.0) return 0.0;
  float width = 0.005 + (1.0 - life) * 0.014;
  return smoothstep(width, 0.0, abs(r - radius)) * life;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = uv * 2.0 - 1.0;
  float aspect = uResolution.x / uResolution.y;
  p.x *= aspect;
  float sr = length(p);
  float zoom = exp((0.028 + uKick * 0.1) * uDt);
  float rot = (0.08 + uSnare * 0.16) * uDt;
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 q = mat2(cs, -sn, sn, cs) * (p / zoom);
  q.x /= aspect;
  vec2 suv = clamp(q * 0.5 + 0.5, vec2(0.002), vec2(0.998));
  float halfLife = mix(0.045, 0.7, clamp(uSmear, 0.0, 1.0));
  float persist = exp(-uDt / halfLife);
  vec3 prev = texture(uPrev, suv).rgb;
  float prevPeak = max(max(prev.r, prev.g), prev.b);
  prev *= persist / (1.0 + prevPeak * 0.28);
  prev *= smoothstep(1.5, 0.15, sr);

  float unit = min(aspect, 1.0);
  vec2 uvp = p / unit;
  float r = length(uvp);
  float a = atan(uvp.y, uvp.x);
  float sym = max(3.0, floor(uSymmetry + 0.5));
  float slice = TAU / sym;
  float spin = uTime * 0.16;
  float reach = 0.58 + uLoud * 0.34 + uBass * 0.1 * uIntensity;

  float folded = abs(mod(a - spin, slice) - slice * 0.5);
  vec2 layer = petalLayer(folded, r, slice, reach, 0.0);
  float folded2 = abs(mod(a + spin * 1.35 + 0.4, slice) - slice * 0.5);
  vec2 layer2 = petalLayer(folded2, r, slice, reach * 0.52, 0.23);

  float tCol = clamp(r / reach, 0.0, 1.0);
  float mag = bandAt(tCol);
  vec3 tint = mix(uColorA, uColorB, tCol);
  tint = mix(tint, uColorC, mag * 0.7);
  vec3 col = prev;
  col += tint * layer.x * (0.26 + mag * 0.7);
  col += mix(tint, vec3(1.0), 0.3) * layer.y * (0.5 + uHat * 0.45);
  col += mix(uColorB, uColorC, tCol) * layer2.x * 0.36;
  col += mix(uColorA, vec3(1.0), 0.2) * layer2.y * 0.28;

  float bars = abs(sin(folded / max(slice, 0.001) * 36.0));
  float barGate = smoothstep(0.78, 0.97, bars) * layer.x;
  float barT = clamp(folded / max(slice * 0.5, 0.001), 0.0, 1.0);
  float barMag = bandAt(barT);
  float barEnd = 0.14 + barMag * reach * 0.66 * uIntensity;
  float bar = barGate * smoothstep(0.08, 0.14, r) * (1.0 - smoothstep(barEnd - 0.02, barEnd, r));
  col += mix(uColorA, uColorC, barT) * bar * (0.35 + barMag);

  for (int i = 0; i < 4; i++) {
    float fi = float(i);
    float rr = 0.18 + fi * 0.16;
    float wob = sin(a * sym + uTime * 1.5 + fi * 1.3) * (0.01 + bandAt(fi / 4.0) * 0.022);
    float ring = smoothstep(0.012, 0.0, abs(r - rr - wob));
    col += mix(uColorA, uColorB, fi / 3.0) * ring * 0.34;
  }

  float polyA = mod(a + uTime * 0.32, slice);
  float polyMag = bandAt(polyA / slice);
  float polyR = 0.34 * (1.0 + uBass * 0.08) * (1.0 + polyMag * 0.16 * uIntensity);
  float polyR2 = 0.58 * (1.0 + polyMag * 0.1);
  col += uColorC * smoothstep(0.012, 0.0, abs(r - polyR)) * 0.42;
  col += uColorB * smoothstep(0.01, 0.0, abs(r - polyR2)) * 0.22;

  col += mix(uColorA, uColorC, 0.45) * shockRing(uShockR.x, uShockA.x, r);
  col += mix(uColorA, uColorC, 0.45) * shockRing(uShockR.y, uShockA.y, r) * 0.85;
  col += mix(uColorB, uColorC, 0.4) * shockRing(uShockR.z, uShockA.z, r) * 0.7;
  col += mix(uColorB, uColorC, 0.4) * shockRing(uShockR.w, uShockA.w, r) * 0.55;

  vec2 sp = uvp * (7.5 + uHat * 5.0);
  vec2 id = floor(sp);
  vec2 gv = fract(sp) - 0.5;
  float h = fract(sin(dot(id, vec2(127.1, 311.7))) * 43758.5453);
  float spark = smoothstep(0.11, 0.0, length(gv)) * step(0.8, h);
  col += mix(uColorC, vec3(1.0), 0.45) * spark * (0.08 + uHat * 1.15);

  float coreR = 0.02 + uBass * 0.03 * uIntensity + uKick * 0.022;
  float core = exp(-r * r / max(coreR * coreR * 2.4, 0.0001));
  col += mix(uColorA, vec3(1.0), 0.72) * core;

  float peak = max(max(col.r, col.g), col.b);
  col /= 1.0 + max(peak - 1.35, 0.0);
  fragColor = vec4(col, 1.0);
}
`;

const HALO_FS = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform sampler2D uBands;
uniform vec2 uResolution;
uniform float uTime;
uniform float uDt;
uniform float uKick;
uniform float uSnare;
uniform float uLoud;
uniform float uSmear;
uniform float uIntensity;
uniform float uSymmetry;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
out vec4 fragColor;

const float TAU = 6.28318530718;

float bandAt(float t) {
  float x = clamp(t, 0.0, 1.0) * 71.0;
  float i = floor(x);
  float f = x - i;
  float a = texelFetch(uBands, ivec2(int(i), 0), 0).r;
  float b = texelFetch(uBands, ivec2(int(min(i + 1.0, 71.0)), 0), 0).r;
  return mix(a, b, f);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = uv * 2.0 - 1.0;
  float aspect = uResolution.x / uResolution.y;
  p.x *= aspect;
  float sr = length(p);
  float zoom = exp((0.022 + uKick * 0.08) * uDt);
  float rot = (0.06 + uSnare * 0.14) * uDt;
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 q = mat2(cs, -sn, sn, cs) * (p / zoom);
  q.x /= aspect;
  vec2 suv = clamp(q * 0.5 + 0.5, vec2(0.002), vec2(0.998));
  float halfLife = mix(0.06, 0.85, clamp(uSmear, 0.0, 1.0));
  vec3 prev = texture(uPrev, suv).rgb * exp(-uDt / halfLife);
  prev *= smoothstep(1.45, 0.2, sr);

  float unit = min(aspect, 1.0);
  vec2 uvp = p / unit;
  float r = length(uvp);
  float a = atan(uvp.y, uvp.x);
  float sym = max(3.0, floor(uSymmetry + 0.5));
  float slice = TAU / sym;
  float folded = abs(mod(a - uTime * 0.12, slice) - slice * 0.5);
  float t = clamp(folded / max(slice * 0.5, 0.001), 0.0, 1.0);
  float mag = bandAt(t);
  float loud = clamp(uLoud, 0.0, 1.0);
  float gain = mix(0.75, 1.35, clamp((uIntensity - 0.5) / 1.3, 0.0, 1.0));
  float inner = 0.2 + loud * 0.1;
  float outer = inner + (0.05 + mag * (0.42 + loud * 0.5)) * gain;
  float cells = mix(16.0, 56.0, clamp((sym - 4.0) / 12.0, 0.0, 1.0));
  float gap = smoothstep(0.06, 0.2, abs(fract(t * cells) - 0.5));
  float bar = smoothstep(inner, inner + 0.012, r) * (1.0 - smoothstep(outer, outer + 0.02, r)) * gap;
  float tip = smoothstep(outer - 0.045, outer, r) * bar;
  vec3 tint = mix(uColorA, uColorB, t);
  tint = mix(tint, uColorC, mag * 0.75);
  vec3 col = prev;
  col += tint * bar * (0.22 + mag * 0.95 + loud * 0.45);
  col += mix(tint, vec3(1.0), 0.35) * tip * (0.35 + uKick);
  float pulse = 0.18 + (1.0 - uKick) * (0.25 + loud * 0.45);
  col += mix(uColorA, uColorC, 0.4) * smoothstep(0.018, 0.0, abs(r - pulse)) * (0.25 + uKick + loud * 0.35);
  float core = exp(-r * r / max(0.012 + loud * 0.05, 0.0008));
  col += mix(uColorB, vec3(1.0), 0.55) * core * (0.25 + loud * 0.9);
  float peak = max(max(col.r, col.g), col.b);
  col /= 1.0 + max(peak - 1.35, 0.0);
  fragColor = vec4(col, 1.0);
}
`;

const WEAVE_FS = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform sampler2D uBands;
uniform vec2 uResolution;
uniform float uTime;
uniform float uFlow;
uniform float uDt;
uniform float uKick;
uniform float uLoud;
uniform float uSmear;
uniform float uIntensity;
uniform float uSymmetry;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
out vec4 fragColor;

float bandAt(float t) {
  float x = clamp(t, 0.0, 1.0) * 71.0;
  float i = floor(x);
  float f = x - i;
  float a = texelFetch(uBands, ivec2(int(i), 0), 0).r;
  float b = texelFetch(uBands, ivec2(int(min(i + 1.0, 71.0)), 0), 0).r;
  return mix(a, b, f);
}

void main() {
  vec2 fragUv = gl_FragCoord.xy / uResolution;
  vec2 uv = fragUv - 0.5;
  float aspect = uResolution.x / uResolution.y;
  uv.x *= aspect;
  float sym = max(4.0, floor(uSymmetry + 0.5));
  float drift = (0.1 + uLoud * 0.22 + uKick * 0.06) * uDt;
  vec2 prevUv = clamp(fragUv - vec2(drift / aspect, sin(uTime * 0.4) * drift * 0.25), vec2(0.002), vec2(0.998));
  float halfLife = mix(0.08, 1.05, clamp(uSmear, 0.0, 1.0));
  vec3 col = texture(uPrev, prevUv).rgb * exp(-uDt / halfLife);
  float loud = clamp(uLoud, 0.0, 1.0);
  float gain = mix(0.8, 1.4, clamp((uIntensity - 0.5) / 1.3, 0.0, 1.0));
  float x = uv.x * (0.85 + sym * 0.08);

  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float t = fi / 6.0;
    float mag = bandAt(t);
    float amp = (0.035 + mag * (0.16 + loud * 0.22)) * gain;
    float y0 = (fi - 3.0) * (0.11 + loud * 0.035);
    float wave = sin(x * (1.6 + fi * 0.28) + uTime * (0.45 + mag * 0.8) + uFlow) * amp;
    wave += sin(x * (4.5 + sym * 0.15) - uTime * 1.3 + fi * 1.7) * mag * (0.03 + loud * 0.05);
    float d = abs(uv.y - y0 - wave);
    float line = smoothstep(0.016 + mag * 0.012, 0.0, d);
    vec3 tint = mix(uColorA, uColorB, t);
    tint = mix(tint, uColorC, 0.35 + 0.4 * sin(x + fi));
    col += tint * line * (0.18 + mag * 0.9 + loud * 0.4);
  }

  float peak = max(max(col.r, col.g), col.b);
  col /= 1.0 + max(peak - 1.25, 0.0);
  fragColor = vec4(col, 1.0);
}
`;

const FEEDBACK_FS = `#version 300 es
precision highp float;
uniform sampler2D uPrev;
uniform vec2 uResolution;
uniform float uDt;
uniform float uSmear;
uniform float uKick;
uniform float uSnare;
uniform vec3 uColorA;
uniform vec3 uColorB;
out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 p = uv * 2.0 - 1.0;
  float aspect = uResolution.x / uResolution.y;
  p.x *= aspect;
  float sr = length(p);
  float zoom = exp((0.03 + uKick * 0.1) * uDt);
  float rot = uSnare * 0.18 * uDt;
  float cs = cos(rot);
  float sn = sin(rot);
  vec2 q = mat2(cs, -sn, sn, cs) * (p / zoom);
  q.x /= aspect;
  vec2 suv = clamp(q * 0.5 + 0.5, vec2(0.002), vec2(0.998));
  float halfLife = mix(0.08, 0.9, clamp(uSmear, 0.0, 1.0));
  float persist = exp(-uDt / halfLife);
  vec3 prev = texture(uPrev, suv).rgb * persist;
  prev *= smoothstep(1.45, 0.12, sr);
  float glow = (0.035 + uKick * 0.7) * exp(-sr * sr * 2.8);
  prev += mix(uColorA, uColorB, 0.45) * glow * (1.0 - persist);
  fragColor = vec4(prev, 1.0);
}
`;

const KAWASE_FS = `#version 300 es
precision highp float;
uniform sampler2D uSrc;
uniform vec2 uDstResolution;
uniform vec2 uSrcTexel;
uniform float uThreshold;
uniform float uRadius;
uniform float uGain;
out vec4 fragColor;

void main() {
  vec2 uv = gl_FragCoord.xy / uDstResolution;
  vec2 o = uSrcTexel * uRadius;
  vec3 c = texture(uSrc, uv).rgb * 4.0;
  c += texture(uSrc, uv + vec2(o.x, o.y)).rgb;
  c += texture(uSrc, uv + vec2(-o.x, o.y)).rgb;
  c += texture(uSrc, uv + vec2(o.x, -o.y)).rgb;
  c += texture(uSrc, uv + vec2(-o.x, -o.y)).rgb;
  c /= 8.0;
  if (uThreshold > 0.0) {
    float lum = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c *= smoothstep(uThreshold, uThreshold + 0.4, lum);
  }
  fragColor = vec4(c * uGain, 1.0);
}
`;

const PRESENT_FS = `#version 300 es
precision highp float;
uniform sampler2D uScene;
uniform sampler2D uBloom;
uniform vec2 uResolution;
uniform float uZoom;
uniform float uKick;
uniform float uTime;
uniform float uAmount;
out vec4 fragColor;

vec3 aces(vec3 x) {
  const float a = 2.51;
  const float b = 0.03;
  const float c = 2.43;
  const float d = 0.59;
  const float e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float zoom = max(uZoom, 0.85);
  vec2 centered = (uv - 0.5) / zoom + 0.5;
  vec2 ca = (centered - 0.5) * (0.0014 + uKick * 0.0012);
  vec3 scene = vec3(
    texture(uScene, centered + ca).r,
    texture(uScene, centered).g,
    texture(uScene, centered - ca).b
  );
  vec3 bloom = texture(uBloom, centered).rgb;
  vec3 col = scene + bloom * uAmount;
  vec2 p = uv * 2.0 - 1.0;
  p.x *= uResolution.x / uResolution.y;
  float vig = smoothstep(1.38, 0.32, length(p));
  col *= mix(0.74, 1.0, vig);
  col = aces(col * 1.12);
  float n = hash(gl_FragCoord.xy);
  col += (n - 0.5) / 255.0;
  fragColor = vec4(col, 1.0);
}
`;

const STAR_VS = `#version 300 es
layout(location = 0) in vec2 aPos;
layout(location = 1) in vec4 aColor;
layout(location = 2) in vec2 aUv;
uniform vec2 uResolution;
out vec4 vColor;
out vec2 vUv;
void main() {
  vec2 clip = (aPos / uResolution) * 2.0 - 1.0;
  clip.y = -clip.y;
  gl_Position = vec4(clip, 0.0, 1.0);
  vColor = aColor;
  vUv = aUv;
}
`;

const STAR_FS = `#version 300 es
precision highp float;
in vec4 vColor;
in vec2 vUv;
out vec4 fragColor;
void main() {
  float along = smoothstep(0.0, 0.7, vUv.x);
  float across = 1.0 - smoothstep(0.02, 0.5, abs(vUv.y - 0.5));
  float mask = along * across;
  fragColor = vec4(vColor.rgb, vColor.a * mask);
}
`;

interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
}

interface Session {
  w: number;
  h: number;
  mode: SceneMode | "";
  targets: [Target, Target] | null;
  bloom: Target[] | null;
  ping: number;
  stars: Float32Array | null;
}

interface Gpu {
  gl: WebGL2RenderingContext;
  canvas: HTMLCanvasElement;
  internal: number;
  tunnel: WebGLProgram;
  liquid: WebGLProgram;
  mandala: WebGLProgram;
  halo: WebGLProgram;
  weave: WebGLProgram;
  present: WebGLProgram;
  feedback: WebGLProgram;
  kawase: WebGLProgram;
  stars: WebGLProgram;
  emptyVao: WebGLVertexArrayObject;
  starVao: WebGLVertexArrayObject;
  starBuf: WebGLBuffer;
  starData: Float32Array;
  bands: WebGLTexture;
}

let sessions = new WeakMap<VizState, Session>();
const shockR = new Float32Array(4);
const shockA = new Float32Array(4);
let gpu: Gpu | null = null;
let gpuFailed = false;

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Couldn't create a shader.");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? "shader error";
    gl.deleteShader(shader);
    throw new Error(log);
  }
  return shader;
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Couldn't create a program.");
  const vert = compile(gl, gl.VERTEX_SHADER, vs);
  const frag = compile(gl, gl.FRAGMENT_SHADER, fs);
  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? "link error";
    gl.deleteProgram(program);
    throw new Error(log);
  }
  return program;
}

function floatInternal(gl: WebGL2RenderingContext): number | null {
  const renderable = gl.getExtension("EXT_color_buffer_float") ?? gl.getExtension("EXT_color_buffer_half_float");
  const linear = gl.getExtension("OES_texture_float_linear");
  if (!renderable || !linear) return null;
  return gl.RGBA16F;
}

function ensureGpu(): Gpu | null {
  if (gpu) return gpu;
  if (gpuFailed) return null;
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: false,
    });
    if (!gl) throw new Error("WebGL2 is not available.");
    canvas.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      gpu = null;
      sessions = new WeakMap();
    });
    if ("drawingBufferColorSpace" in gl) gl.drawingBufferColorSpace = "srgb";
    const emptyVao = gl.createVertexArray();
    const starVao = gl.createVertexArray();
    const starBuf = gl.createBuffer();
    const bands = gl.createTexture();
    if (!emptyVao || !starVao || !starBuf || !bands) throw new Error("Couldn't allocate WebGL buffers.");
    gl.bindTexture(gl.TEXTURE_2D, bands);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, BAND_COUNT, 1, 0, gl.RED, gl.FLOAT, new Float32Array(BAND_COUNT));
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    let internal = floatInternal(gl) ?? gl.RGBA8;
    if (internal !== gl.RGBA8) {
      try {
        const probe = makeTarget(gl, 4, 4, internal);
        destroyTargets(gl, [probe]);
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      } catch {
        internal = gl.RGBA8;
      }
    }
    const starFloats = STAR_COUNT * MAX_SYMMETRY * 6 * STAR_STRIDE;
    gpu = {
      gl,
      canvas,
      internal,
      tunnel: link(gl, FULLSCREEN_VS, TUNNEL_FS),
      liquid: link(gl, FULLSCREEN_VS, LIQUID_FS),
      mandala: link(gl, FULLSCREEN_VS, MANDALA_FS),
      halo: link(gl, FULLSCREEN_VS, HALO_FS),
      weave: link(gl, FULLSCREEN_VS, WEAVE_FS),
      present: link(gl, FULLSCREEN_VS, PRESENT_FS),
      feedback: link(gl, FULLSCREEN_VS, FEEDBACK_FS),
      kawase: link(gl, FULLSCREEN_VS, KAWASE_FS),
      stars: link(gl, STAR_VS, STAR_FS),
      emptyVao,
      starVao,
      starBuf,
      starData: new Float32Array(starFloats),
      bands,
    };
    gl.bindVertexArray(starVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, starBuf);
    gl.bufferData(gl.ARRAY_BUFFER, gpu.starData.byteLength, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, STAR_STRIDE * 4, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 4, gl.FLOAT, false, STAR_STRIDE * 4, 8);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 2, gl.FLOAT, false, STAR_STRIDE * 4, 24);
    gl.bindVertexArray(null);
    return gpu;
  } catch (error) {
    gpuFailed = true;
    console.error(error);
    return null;
  }
}

function makeTarget(gl: WebGL2RenderingContext, width: number, height: number, internal: number): Target {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new Error("Couldn't allocate a frame buffer.");
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, internal, width, height);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error("Frame buffer is incomplete.");
  }
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);
  return { tex, fbo };
}

function destroyTargets(gl: WebGL2RenderingContext, targets: readonly Target[]): void {
  for (const target of targets) {
    gl.deleteFramebuffer(target.fbo);
    gl.deleteTexture(target.tex);
  }
}

function makeBloom(gl: WebGL2RenderingContext, width: number, height: number, internal: number): Target[] {
  const targets: Target[] = [];
  for (let level = 0; level < BLOOM_LEVELS; level++) {
    targets.push(makeTarget(gl, Math.max(2, width >> (level + 1)), Math.max(2, height >> (level + 1)), internal));
  }
  return targets;
}

function sessionFor(state: VizState): Session {
  let session = sessions.get(state);
  if (!session) {
    session = { w: 0, h: 0, mode: "", targets: null, bloom: null, ping: 0, stars: null };
    sessions.set(state, session);
  }
  return session;
}

function ensureFramebuffers(api: Gpu, session: Session, width: number, height: number, mode: SceneMode): void {
  const { gl } = api;
  const sizeChanged = session.w !== width || session.h !== height;
  const modeChanged = session.mode !== mode;
  if (session.targets && session.bloom && !sizeChanged && !modeChanged) return;
  if (session.targets && (sizeChanged || modeChanged)) {
    destroyTargets(gl, session.targets);
    session.targets = null;
  }
  if (session.bloom && sizeChanged) {
    destroyTargets(gl, session.bloom);
    session.bloom = null;
  }
  if (!session.targets) {
    session.targets = [makeTarget(gl, width, height, api.internal), makeTarget(gl, width, height, api.internal)];
    session.ping = 0;
  }
  if (!session.bloom) session.bloom = makeBloom(gl, width, height, api.internal);
  session.w = width;
  session.h = height;
  session.mode = mode;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

function drawFullscreen(gl: WebGL2RenderingContext, vao: WebGLVertexArrayObject): void {
  gl.bindVertexArray(vao);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(null);
}

function bindCommon(
  gl: WebGL2RenderingContext,
  program: WebGLProgram,
  width: number,
  height: number,
  dt: number,
  settings: VizSettings,
  state: VizState,
): void {
  const loc = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  gl.uniform2f(loc("uResolution"), width, height);
  gl.uniform1f(loc("uTime"), state.time);
  gl.uniform1f(loc("uFlow"), state.flow);
  gl.uniform1f(loc("uDt"), dt);
  gl.uniform1f(loc("uBass"), state.bass);
  gl.uniform1f(loc("uMid"), state.mid);
  gl.uniform1f(loc("uHigh"), state.high);
  gl.uniform1f(loc("uEnergy"), state.energy);
  gl.uniform1f(loc("uKick"), state.kick);
  gl.uniform1f(loc("uSnare"), state.snare);
  gl.uniform1f(loc("uHat"), state.hat);
  gl.uniform1f(loc("uLoud"), state.loud);
  gl.uniform1f(loc("uSmear"), settings.smear);
  gl.uniform1f(loc("uIntensity"), settings.intensity);
  gl.uniform1f(loc("uSymmetry"), settings.symmetry);
}

function uploadColors(gl: WebGL2RenderingContext, program: WebGLProgram, colors: ReturnType<typeof paletteRgb>): void {
  const loc = (name: string): WebGLUniformLocation | null => gl.getUniformLocation(program, name);
  gl.uniform3f(loc("uColorA"), colors.a[0] / 255, colors.a[1] / 255, colors.a[2] / 255);
  gl.uniform3f(loc("uColorB"), colors.b[0] / 255, colors.b[1] / 255, colors.b[2] / 255);
  gl.uniform3f(loc("uColorC"), colors.c[0] / 255, colors.c[1] / 255, colors.c[2] / 255);
}

function fillShocks(state: VizState): void {
  shockR.fill(0);
  shockA.fill(0);
  const count = Math.min(4, state.shocks.length);
  for (let i = 0; i < count; i++) {
    shockR[i] = state.shocks[i].radius;
    shockA[i] = Math.max(0, state.shocks[i].life);
  }
}

function uploadBands(gl: WebGL2RenderingContext, tex: WebGLTexture, bands: Float32Array): void {
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, BAND_COUNT, 1, gl.RED, gl.FLOAT, bands);
}

function blitKawase(
  api: Gpu,
  src: WebGLTexture,
  dst: Target,
  dstW: number,
  dstH: number,
  srcW: number,
  srcH: number,
  threshold: number,
  radius: number,
  gain: number,
  additive: boolean,
): void {
  const { gl } = api;
  gl.bindFramebuffer(gl.FRAMEBUFFER, dst.fbo);
  gl.viewport(0, 0, dstW, dstH);
  if (additive) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
  } else {
    gl.disable(gl.BLEND);
  }
  gl.useProgram(api.kawase);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, src);
  gl.uniform1i(gl.getUniformLocation(api.kawase, "uSrc"), 0);
  gl.uniform2f(gl.getUniformLocation(api.kawase, "uDstResolution"), dstW, dstH);
  gl.uniform2f(gl.getUniformLocation(api.kawase, "uSrcTexel"), 1 / srcW, 1 / srcH);
  gl.uniform1f(gl.getUniformLocation(api.kawase, "uThreshold"), threshold);
  gl.uniform1f(gl.getUniformLocation(api.kawase, "uRadius"), radius);
  gl.uniform1f(gl.getUniformLocation(api.kawase, "uGain"), gain);
  drawFullscreen(gl, api.emptyVao);
  if (additive) gl.disable(gl.BLEND);
}

function present(api: Gpu, scene: WebGLTexture, bloom: WebGLTexture, width: number, height: number, settings: VizSettings, state: VizState): void {
  const { gl } = api;
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, width, height);
  gl.disable(gl.BLEND);
  gl.useProgram(api.present);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, scene);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, bloom);
  gl.uniform1i(gl.getUniformLocation(api.present, "uScene"), 0);
  gl.uniform1i(gl.getUniformLocation(api.present, "uBloom"), 1);
  gl.uniform2f(gl.getUniformLocation(api.present, "uResolution"), width, height);
  gl.uniform1f(gl.getUniformLocation(api.present, "uZoom"), state.zoom + state.punch);
  gl.uniform1f(gl.getUniformLocation(api.present, "uKick"), state.kick);
  gl.uniform1f(gl.getUniformLocation(api.present, "uTime"), state.time);
  gl.uniform1f(gl.getUniformLocation(api.present, "uAmount"), Math.min(1.05, 0.22 + state.loud * 0.28 + settings.intensity * 0.12 + state.kick * 0.06));
  drawFullscreen(gl, api.emptyVao);
  gl.activeTexture(gl.TEXTURE0);
}

function finish(api: Gpu, session: Session, source: WebGLTexture, width: number, height: number, settings: VizSettings, state: VizState): void {
  const bloom = session.bloom;
  if (!bloom) return;
  let src = source;
  let srcW = width;
  let srcH = height;
  for (let level = 0; level < BLOOM_LEVELS; level++) {
    const dstW = Math.max(2, width >> (level + 1));
    const dstH = Math.max(2, height >> (level + 1));
    blitKawase(api, src, bloom[level], dstW, dstH, srcW, srcH, level === 0 ? 0.78 : 0, 1, 1, false);
    src = bloom[level].tex;
    srcW = dstW;
    srcH = dstH;
  }
  for (let level = BLOOM_LEVELS - 2; level >= 0; level--) {
    const dstW = Math.max(2, width >> (level + 1));
    const dstH = Math.max(2, height >> (level + 1));
    const upW = Math.max(2, width >> (level + 2));
    const upH = Math.max(2, height >> (level + 2));
    blitKawase(api, bloom[level + 1].tex, bloom[level], dstW, dstH, upW, upH, 0, 0.5, 0.58, true);
  }
  present(api, source, bloom[0].tex, width, height, settings, state);
}

function renderFeedbackScene(
  api: Gpu,
  session: Session,
  program: WebGLProgram,
  width: number,
  height: number,
  dt: number,
  settings: VizSettings,
  state: VizState,
  beforeDraw: (gl: WebGL2RenderingContext) => void,
): WebGLTexture | null {
  const { gl } = api;
  ensureFramebuffers(api, session, width, height, settings.mode);
  const targets = session.targets;
  if (!targets) return null;
  const read = session.ping;
  const write = 1 - read;
  gl.bindFramebuffer(gl.FRAMEBUFFER, targets[write].fbo);
  gl.viewport(0, 0, width, height);
  gl.disable(gl.BLEND);
  gl.useProgram(program);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, targets[read].tex);
  gl.uniform1i(gl.getUniformLocation(program, "uPrev"), 0);
  bindCommon(gl, program, width, height, dt, settings, state);
  uploadColors(gl, program, paletteRgb(resolvePalette(settings.palette, settings.custom), 0));
  beforeDraw(gl);
  drawFullscreen(gl, api.emptyVao);
  session.ping = write;
  return targets[write].tex;
}

function renderTunnel(
  api: Gpu,
  session: Session,
  width: number,
  height: number,
  dt: number,
  settings: VizSettings,
  state: VizState,
): WebGLTexture | null {
  return renderFeedbackScene(api, session, api.tunnel, width, height, dt, settings, state, () => undefined);
}

function renderLiquid(
  api: Gpu,
  session: Session,
  width: number,
  height: number,
  dt: number,
  settings: VizSettings,
  state: VizState,
): WebGLTexture | null {
  return renderFeedbackScene(api, session, api.liquid, width, height, dt, settings, state, () => undefined);
}

function bindBands(gl: WebGL2RenderingContext, program: WebGLProgram, api: Gpu, bands: Float32Array): void {
  uploadBands(gl, api.bands, bands);
  gl.uniform1i(gl.getUniformLocation(program, "uBands"), 1);
}

function renderMandala(
  api: Gpu,
  session: Session,
  width: number,
  height: number,
  dt: number,
  settings: VizSettings,
  state: VizState,
): WebGLTexture | null {
  return renderFeedbackScene(api, session, api.mandala, width, height, dt, settings, state, (gl) => {
    bindBands(gl, api.mandala, api, state.smooth);
    fillShocks(state);
    gl.uniform4fv(gl.getUniformLocation(api.mandala, "uShockR"), shockR);
    gl.uniform4fv(gl.getUniformLocation(api.mandala, "uShockA"), shockA);
  });
}

function renderHalo(
  api: Gpu,
  session: Session,
  width: number,
  height: number,
  dt: number,
  settings: VizSettings,
  state: VizState,
): WebGLTexture | null {
  return renderFeedbackScene(api, session, api.halo, width, height, dt, settings, state, (gl) => {
    bindBands(gl, api.halo, api, state.smooth);
  });
}

function renderWeave(
  api: Gpu,
  session: Session,
  width: number,
  height: number,
  dt: number,
  settings: VizSettings,
  state: VizState,
): WebGLTexture | null {
  return renderFeedbackScene(api, session, api.weave, width, height, dt, settings, state, (gl) => {
    bindBands(gl, api.weave, api, state.smooth);
  });
}

function ensureStars(session: Session): Float32Array {
  if (session.stars) return session.stars;
  const stars = new Float32Array(STAR_COUNT * 4);
  for (let i = 0; i < STAR_COUNT; i++) {
    const angle = Math.random() * TAU;
    const radius = Math.sqrt(Math.random()) * 0.94 + 0.02;
    const offset = i * 4;
    stars[offset] = Math.cos(angle) * radius;
    stars[offset + 1] = Math.sin(angle) * radius;
    stars[offset + 2] = Math.random();
    stars[offset + 3] = Math.random();
  }
  session.stars = stars;
  return stars;
}

function pushStreak(
  data: Float32Array,
  cursor: number,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  half: number,
  r: number,
  g: number,
  b: number,
  a: number,
): number {
  let dx = x1 - x0;
  let dy = y1 - y0;
  const len = Math.hypot(dx, dy);
  if (len < 0.001) {
    dx = half;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }
  const px = -dy * half;
  const py = dx * half;
  const corners: ReadonlyArray<readonly [number, number, number, number]> = [
    [x0 + px, y0 + py, 0, 0],
    [x0 - px, y0 - py, 0, 1],
    [x1 - px, y1 - py, 1, 1],
    [x0 + px, y0 + py, 0, 0],
    [x1 - px, y1 - py, 1, 1],
    [x1 + px, y1 + py, 1, 0],
  ];
  for (let i = 0; i < corners.length; i++) {
    const corner = corners[i];
    data[cursor++] = corner[0];
    data[cursor++] = corner[1];
    data[cursor++] = r;
    data[cursor++] = g;
    data[cursor++] = b;
    data[cursor++] = a;
    data[cursor++] = corner[2];
    data[cursor++] = corner[3];
  }
  return cursor;
}

function renderStarfield(
  api: Gpu,
  session: Session,
  width: number,
  height: number,
  dt: number,
  settings: VizSettings,
  state: VizState,
): WebGLTexture | null {
  const { gl } = api;
  ensureFramebuffers(api, session, width, height, "starfield");
  const targets = session.targets;
  if (!targets) return null;
  const read = session.ping;
  const write = 1 - read;
  const colors = paletteRgb(resolvePalette(settings.palette, settings.custom), 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, targets[write].fbo);
  gl.viewport(0, 0, width, height);
  gl.disable(gl.BLEND);
  gl.useProgram(api.feedback);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, targets[read].tex);
  gl.uniform1i(gl.getUniformLocation(api.feedback, "uPrev"), 0);
  bindCommon(gl, api.feedback, width, height, dt, settings, state);
  uploadColors(gl, api.feedback, colors);
  drawFullscreen(gl, api.emptyVao);

  const stars = ensureStars(session);
  const symmetry = clamp(Math.round(settings.symmetry), 3, MAX_SYMMETRY);
  const rate = 0.08 + state.loud * 0.32 * settings.intensity + state.bass * 0.08 + state.kick * 0.1;
  const trail = 0.02 + clamp(settings.smear, 0, 1) * 0.26;
  const spin = state.time * (0.05 + state.mid * 0.03);
    const span = Math.min(width, height) * 0.55;
  const cx = width * 0.5;
  const cy = height * 0.5;
  const alphaScale = 1 / Math.sqrt(symmetry);
  const data = api.starData;
  let cursor = 0;
  const limit = data.length - STAR_STRIDE * 6;

  for (let i = 0; i < STAR_COUNT; i++) {
    const offset = i * 4;
    const personal = 0.38 + stars[offset + 3] * 0.95;
    let z = stars[offset + 2] - rate * personal * dt;
    if (z < 0.025) {
      const angle = Math.random() * TAU;
      const radius = Math.sqrt(Math.random()) * 0.94 + 0.02;
      stars[offset] = Math.cos(angle) * radius;
      stars[offset + 1] = Math.sin(angle) * radius;
      stars[offset + 3] = Math.random();
      z = 1;
    }
    stars[offset + 2] = z;
    const zTail = Math.min(1.35, z + rate * personal * trail);
    const near = 1 - z;
    const seed = stars[offset + 3];
    const rgb = seed < 0.33 ? colors.a : seed < 0.66 ? colors.b : colors.c;
    const flash = state.kick;
    const r = (rgb[0] / 255) * (1 - flash * 0.2) + flash * 0.55;
    const g = (rgb[1] / 255) * (1 - flash * 0.2) + flash * 0.55;
    const b = (rgb[2] / 255) * (1 - flash * 0.2) + flash * 0.55;
    const alpha = Math.min(1, (0.2 + near * 1.05) * (0.5 + flash * 0.45 + state.hat * 0.2) * (0.45 + state.high * 0.28)) * alphaScale;
    const half = (0.85 + near * 3.2 * settings.intensity) * (1 + flash * 0.8);
    const x = stars[offset];
    const y = stars[offset + 1];

    for (let arm = 0; arm < symmetry; arm++) {
      if (cursor > limit) break;
      const ang = spin + (arm / symmetry) * TAU;
      const cs = Math.cos(ang);
      const sn = Math.sin(ang);
      const rx = x * cs - y * sn;
      const ry = x * sn + y * cs;
      const hx = cx + (rx / z) * span;
      const hy = cy + (ry / z) * span;
      const tx = cx + (rx / zTail) * span;
      const ty = cy + (ry / zTail) * span;
      if (hx < -80 && tx < -80) continue;
      if (hy < -80 && ty < -80) continue;
      if (hx > width + 80 && tx > width + 80) continue;
      if (hy > height + 80 && ty > height + 80) continue;
      cursor = pushStreak(data, cursor, tx, ty, hx, hy, half, r, g, b, alpha);
    }
  }

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE);
  gl.useProgram(api.stars);
  gl.uniform2f(gl.getUniformLocation(api.stars, "uResolution"), width, height);
  gl.bindVertexArray(api.starVao);
  gl.bindBuffer(gl.ARRAY_BUFFER, api.starBuf);
  if (cursor > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data.subarray(0, cursor));
  gl.drawArrays(gl.TRIANGLES, 0, cursor / STAR_STRIDE);
  gl.bindVertexArray(null);
  gl.disable(gl.BLEND);
  session.ping = write;
  return targets[write].tex;
}

export function compositeScene(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dt: number,
  settings: VizSettings,
  state: VizState,
): boolean {
  const api = ensureGpu();
  if (!api || width < 2 || height < 2) return false;
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
  const { gl, canvas } = api;
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const session = sessionFor(state);
  let source: WebGLTexture | null = null;
  if (settings.mode === "tunnel") source = renderTunnel(api, session, width, height, dt, settings, state);
  else if (settings.mode === "liquid") source = renderLiquid(api, session, width, height, dt, settings, state);
  else if (settings.mode === "starfield") source = renderStarfield(api, session, width, height, dt, settings, state);
  else if (settings.mode === "halo") source = renderHalo(api, session, width, height, dt, settings, state);
  else if (settings.mode === "weave") source = renderWeave(api, session, width, height, dt, settings, state);
  else source = renderMandala(api, session, width, height, dt, settings, state);
  if (!source) {
    ctx.restore();
    return false;
  }
  finish(api, session, source, width, height, settings, state);
  gl.flush();
  ctx.drawImage(canvas, 0, 0, width, height);
  ctx.restore();
  return true;
}

export function gpuAvailable(): boolean {
  return ensureGpu() !== null;
}

export function releaseScene(state: VizState): void {
  const session = sessions.get(state);
  const gl = gpu?.gl;
  if (!session || !gl) return;
  if (session.targets) destroyTargets(gl, session.targets);
  if (session.bloom) destroyTargets(gl, session.bloom);
  sessions.delete(state);
}
