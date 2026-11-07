/* Entrance water uses the entrance clock; it never changes battle state. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./motion.js'));
  else root.MiaoLandingWater = factory(root.MiaoMotion);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M) {
  'use strict';
  const WATER = Object.freeze({ duration: 0.72, dropsEnd: 0.43, echoDelay: 0.11 });
  const clamp = t => Math.max(0, Math.min(1, t));

  function create(event, radius = 40) {
    return { id: event.id, x: event.x, y: event.y, radius, age: 0,
      touch: M.LANDING.touch, duration: M.LANDING.touch + WATER.duration };
  }

  function sample(track, age) {
    const t = age - track.touch;
    const result = { rings: [], drops: [] };
    if (t < 0 || t >= WATER.duration) return result;
    const scale = track.radius / 40;
    for (let i = 0; i < 2; i += 1) {
      const elapsed = t - i * WATER.echoDelay;
      if (elapsed < 0) continue;
      const u = clamp(elapsed / (WATER.duration - i * WATER.echoDelay));
      result.rings.push({ x: track.x, y: track.y + 7 * scale,
        radius: track.radius * (0.98 + 0.85 * u), squash: 0.35,
        alpha: (i === 0 ? 0.78 : 0.45) * (1 - u) ** 1.5 });
    }
    if (t < WATER.dropsEnd) {
      for (let i = 0; i < 12; i += 1) {
        const angle = Math.PI * 2 * (i + 0.25) / 12;
        const elapsed = Math.max(0, t - (i % 3) * 0.009);
        const distance = (43 + (70 + i % 3 * 5) * elapsed) * scale;
        const lift = ((74 + i % 3 * 8) * elapsed - 185 * elapsed ** 2) * scale;
        result.drops.push({
          x: track.x + Math.cos(angle) * distance,
          y: track.y + 10 * scale + Math.sin(angle) * distance * 0.40 - lift,
          size: (i % 3 === 0 ? 5 : 4) * scale,
          alpha: (1 - clamp(t / WATER.dropsEnd)) ** 0.65,
          layer: Math.sin(angle) > 0 ? 'front' : 'back',
        });
      }
    }
    return result;
  }
  return { WATER, create, sample };
});
