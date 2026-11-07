/* Deterministic local water refraction, independent of images, clocks and physics. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiaoWaterSurface = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const finite = (n, fallback) => Number.isFinite(n) ? n : fallback;
  function settings(raw = {}) {
    return { rate: clamp(finite(raw.rate, 24), 12, 30),
      preset: raw.preset === 'pool-loop' ? 'pool-loop' : 'gentle',
      period: clamp(finite(raw.period, 6), 4, 12),
      waveOpacity: clamp(finite(raw.waveOpacity, 0.44), 0, 0.7),
      waveScale: clamp(finite(raw.waveScale, 1), 0.5, 2),
      direction: Array.isArray(raw.direction) && raw.direction.length === 2
        && raw.direction.every(Number.isFinite) && Math.hypot(...raw.direction) > 0.01
        ? raw.direction.map(v => v / Math.hypot(...raw.direction)) : [0.94, -0.34],
      crestColor: /^#[0-9a-f]{6}$/i.test(raw.crestColor || '') ? raw.crestColor : '#e4fcff',
      crestShade: /^#[0-9a-f]{6}$/i.test(raw.crestShade || '') ? raw.crestShade : '#279fb9',
      amplitude: clamp(finite(raw.amplitude, 2.2), 0, 4),
      speed: clamp(finite(raw.speed, 1), 0, 2),
      tint: clamp(finite(raw.tint, 0.21), 0, 0.35),
      glints: clamp(finite(raw.glints, 0.42), 0, 0.7),
      color: /^#[0-9a-f]{6}$/i.test(raw.color || '') ? raw.color : '#32c8df',
      maxDisturbances: 12 };
  }
  const noise = n => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };

  function create(width, height, bounds, raw) {
    const config = settings(raw);
    const count = clamp(Math.round((bounds.right - bounds.left) * (bounds.bottom - bounds.top) / 42000), 8, 24);
    const glints = Array.from({ length: count }, (_, i) => ({
      x: bounds.left + (0.04 + 0.92 * noise(i + 7)) * (bounds.right - bounds.left),
      y: bounds.top + (0.05 + 0.9 * noise(i + 43)) * (bounds.bottom - bounds.top),
      phase: noise(i + 91), period: 3.8 + noise(i + 137) * 4.2, size: i % 4 === 0 ? 2 : 1,
    }));
    const bw = bounds.right - bounds.left, bh = bounds.bottom - bounds.top;
    const waveCount = clamp(Math.round(bw * bh / 36000), 8, 28);
    const columns = Math.ceil(Math.sqrt(waveCount * bw / bh)), rows = Math.ceil(waveCount / columns);
    const waves = Array.from({ length: waveCount }, (_, i) => ({
      x: bounds.left + (i % columns + 0.22 + noise(i + 211) * 0.56) * bw / columns,
      y: bounds.top + (Math.floor(i / columns) + 0.22 + noise(i + 257) * 0.56) * bh / rows,
      width: Math.min(bw * 0.22, 62 + noise(i + 311) * 52) * config.waveScale,
      height: (3.5 + noise(i + 379) * 4) * config.waveScale,
      phase: (i / waveCount + noise(i + 419) * 0.18) % 1,
      duration: 0.36 + noise(i + 467) * 0.12, variation: noise(i + 509),
    }));
    return { width, height, bounds: { ...bounds }, config, glints, waves };
  }

  function sample(field, time, sources = []) {
    const { width: w, height: h, bounds: b, config: c } = field;
    const elapsed = Math.max(0, finite(time, 0)) * c.speed, a = c.amplitude;
    const loop = c.preset === 'pool-loop', cycle = (elapsed % c.period) / c.period;
    const t = loop ? cycle * Math.PI * 2 : elapsed;
    const rowX = new Float32Array(h), rowY = new Float32Array(h), rowLight = new Float32Array(h);
    const colX = new Float32Array(w), colY = new Float32Array(w), colLight = new Float32Array(w);
    for (let y = 0; y < h; y++) {
      const n = y / Math.max(1, h - 1), edge = Math.sin(n * Math.PI) ** 2;
      rowX[y] = a * edge * (Math.sin(n * 14.1 + t * (loop ? 1 : 0.72)) + 0.34 * Math.sin(n * 23.7 - t * (loop ? 2 : 0.39)));
      rowY[y] = a * 0.18 * edge * Math.sin(n * 11.7 + t * (loop ? 1 : 0.43));
      rowLight[y] = 1.7 * Math.sin(n * 7.9 + t * (loop ? 1 : 0.51));
    }
    for (let x = 0; x < w; x++) {
      const n = x / Math.max(1, w - 1), edge = Math.sin(n * Math.PI) ** 2;
      colY[x] = a * 0.63 * edge * (Math.sin(n * 17.3 + t * (loop ? 1 : 0.56)) + 0.28 * Math.sin(n * 29.1 - t * (loop ? 2 : 0.31)));
      colX[x] = a * 0.22 * edge * Math.sin(n * 10.3 - t * (loop ? 1 : 0.37));
      colLight[x] = 1.5 * Math.cos(n * 9.7 - t * (loop ? 1 : 0.33));
    }
    const sx = w / (b.right - b.left), sy = h / (b.bottom - b.top);
    const disturbances = sources.filter(s => [s.x, s.y, s.age, s.strength].every(Number.isFinite)
      && s.age >= 0 && s.age < 0.65 && s.strength > 0)
      .sort((a, b) => a.age - b.age).slice(0, c.maxDisturbances).map(s => ({
        x: (s.x - b.left) * sx, y: (s.y - b.top) * sy,
        rx: clamp(finite(s.radius, 55), 8, 120) * sx, ry: clamp(finite(s.radius, 55), 8, 120) * sy,
        age: s.age, strength: clamp(s.strength, 0, 1) * (1 - s.age / 0.65),
      }));
    const glints = field.glints.map(g => {
      const phase = ((loop ? cycle : t / g.period) + g.phase) % 1;
      const pulse = Math.max(0, Math.sin(Math.PI * clamp((phase - 0.18) / 0.64, 0, 1)));
      return { x: g.x + Math.sin(t * (loop ? 1 : 0.32) + g.phase * 6) * 2,
        y: g.y + Math.cos(t * (loop ? 1 : 0.29) + g.phase * 9) * 1.5,
        size: g.size, alpha: c.glints * pulse ** 6 };
    }).filter(g => g.alpha > 0.04);
    const wavelets = loop ? field.waves.map(wave => {
      const phase = (cycle + wave.phase) % 1, u = clamp(phase / wave.duration, 0, 1);
      const alpha = phase < wave.duration ? c.waveOpacity * Math.sin(u * Math.PI) ** 1.4 : 0;
      return {
        x: wave.x + c.direction[0] * (u - 0.5) * 30 * c.waveScale,
        y: wave.y + c.direction[1] * (u - 0.5) * 20 * c.waveScale + Math.sin(u * Math.PI * 2) * 1.8,
        width: wave.width * (0.72 + 0.5 * u), height: wave.height * (1 - 0.35 * u),
        bend: u * Math.PI + wave.variation * Math.PI, alpha, breakup: u,
      };
    }).filter(wave => wave.alpha > 0.015) : [];
    return { frame: Math.floor(Math.max(0, finite(time, 0)) * c.rate + 1e-7),
      rowX, rowY, rowLight, colX, colY, colLight, disturbances, glints, wavelets, cycle };
  }
  return { settings, create, sample };
});
