/* Cached pixel refraction of the existing water image; no independent animation loop. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./water-surface.js'));
  else root.MiaoWaterSurfaceRenderer = factory(root.MiaoWaterSurface);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (W) {
  'use strict';
  function create(source, bounds, options) {
    const scale = Math.min(1, 640 / source.width, 480 / source.height);
    const w = Math.max(1, Math.round(source.width * scale)), h = Math.max(1, Math.round(source.height * scale));
    let working = source;
    if (scale < 1) {
      working = document.createElement('canvas'); working.width = w; working.height = h;
      const sampler = working.getContext('2d'); sampler.imageSmoothingEnabled = false;
      sampler.drawImage(source, 0, 0, w, h);
    }
    const field = W.create(w, h, bounds, options);
    const input = working.getContext('2d').getImageData(0, 0, w, h);
    const tint = field.config.tint, color = parseInt(field.config.color.slice(1), 16);
    const tr = color >> 16, tg = color >> 8 & 255, tb = color & 255;
    for (let i = 0; i < input.data.length; i += 4) {
      input.data[i] = Math.round(input.data[i] * (1 - tint) + tr * tint);
      input.data[i + 1] = Math.round(input.data[i + 1] * (1 - tint) + tg * tint);
      input.data[i + 2] = Math.round(input.data[i + 2] * (1 - tint) + tb * tint);
    }
    const pixels = new Uint32Array(input.data.buffer);
    const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
    const painter = canvas.getContext('2d'), frame = painter.createImageData(w, h);
    const out = new Uint32Array(frame.data.buffer), dx = new Float32Array(w * h), dy = new Float32Array(w * h);
    let slot = -1, updates = 0, sample = null, failed = false;
    const clamp = (v, max) => Math.max(0, Math.min(max, v));

    function update(time, sources) {
      const next = Math.floor(Math.max(0, time) * field.config.rate + 1e-7);
      if (slot === next) return;
      sample = W.sample(field, next / field.config.rate, sources);
      dx.fill(0); dy.fill(0);
      for (const s of sample.disturbances) {
        const left = Math.max(0, Math.floor(s.x - s.rx)), right = Math.min(w - 1, Math.ceil(s.x + s.rx));
        const top = Math.max(0, Math.floor(s.y - s.ry)), bottom = Math.min(h - 1, Math.ceil(s.y + s.ry));
        for (let y = top; y <= bottom; y++) {
          for (let x = left; x <= right; x++) {
            const nx = (x - s.x) / s.rx, ny = (y - s.y) / s.ry, r2 = nx * nx + ny * ny;
            if (r2 >= 1 || r2 < 0.0001) continue;
            const r = Math.sqrt(r2), wave = Math.sin(r * 10 - s.age * 15) * (1 - r2) ** 2 * s.strength * 1.8;
            const i = y * w + x;
            dx[i] += nx / r * wave; dy[i] += ny / r * wave * 0.7;
          }
        }
      }
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const sx = clamp(Math.round(x + sample.rowX[y] + sample.colX[x] + dx[i]), w - 1);
          const sy = clamp(Math.round(y + sample.rowY[y] + sample.colY[x] + dy[i]), h - 1);
          const pixel = pixels[sy * w + sx], light = Math.round(sample.rowLight[y] + sample.colLight[x]);
          const r = clamp((pixel & 255) + light, 255), g = clamp((pixel >> 8 & 255) + light, 255);
          const b = clamp((pixel >> 16 & 255) + light, 255);
          out[i] = (255 << 24) | (b << 16) | (g << 8) | r;
        }
      }
      painter.putImageData(frame, 0, 0);
      slot = next; updates++;
    }

    return {
      reset() { slot = -1; },
      snapshot() { return { frame: slot, updates, failed, width: w, height: h, rate: field.config.rate,
        preset: field.config.preset, period: field.config.period,
        disturbances: sample?.disturbances.length || 0, glints: sample?.glints.length || 0,
        wavelets: sample?.wavelets.length || 0, cycle: sample?.cycle || 0 }; },
      draw(target, time, sources) {
        if (failed) { target.drawImage(source, bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top); return; }
        target.save();
        try {
          update(time, sources);
          target.drawImage(canvas, bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
          for (const wave of sample.wavelets) {
            const steps = Math.ceil(wave.width / 1.5);
            for (let i = 0; i <= steps; i++) {
              if (wave.breakup > 0.65 && (i % 17 > 12 || (i < 4 && i % 2 === 0))) continue;
              const n = i / steps - 0.5;
              const x = Math.round((wave.x + n * wave.width) / 2) * 2;
              const y = Math.round((wave.y - wave.height * (1 - 4 * n * n)
                + Math.sin(n * Math.PI * 2 + wave.bend) * wave.height * 0.22) / 2) * 2;
              target.globalAlpha = wave.alpha * 0.65;
              target.fillStyle = field.config.crestShade; target.fillRect(x, y + 2, 2, 2);
              target.globalAlpha = wave.alpha;
              target.fillStyle = field.config.crestColor; target.fillRect(x, y, 2, 2);
            }
          }
          target.fillStyle = '#efffff';
          for (const glint of sample.glints) {
            const x = Math.round(glint.x / 2) * 2, y = Math.round(glint.y / 2) * 2;
            target.globalAlpha = glint.alpha;
            target.fillRect(x - 2, y, 6, 2);
            if (glint.size > 1) target.fillRect(x, y - 2, 2, 6);
          }
        } catch {
          failed = true;
          target.drawImage(source, bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
        } finally { target.restore(); }
      },
    };
  }
  return { create };
});
