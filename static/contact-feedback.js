/* Ordinary contact presentation: no physics impulses, damage or camera changes. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiaoContactFeedback = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CONFIG = Object.freeze({ maxEffects: 20, poseEnd: 0.34, reactionGroup: 0.055, splashGroup: 0.035 });
  const clamp = n => Math.max(0, Math.min(1, n));
  const smooth = n => { n = clamp(n); return n * n * (3 - 2 * n); };
  const pulse = (t, start, peak, end) => t <= start || t >= end ? 0
    : t < peak ? smooth((t - start) / (peak - start)) : 1 - smooth((t - peak) / (end - peak));
  const unit = (x, y) => {
    const length = Math.hypot(x, y);
    return length > 1e-7 ? { x: x / length, y: y / length } : { x: 1, y: 0 };
  };

  function create(event, { radius = 40, reducedMotion = false } = {}) {
    const centers = event.centers || [];
    let axis;
    if (event.wall && centers.length) axis = unit(centers[0].x - event.x, centers[0].y - event.y);
    else if (centers.length > 1) axis = unit(centers[1].x - centers[0].x, centers[1].y - centers[0].y);
    else axis = unit(Number.isFinite(event.normal?.x) ? event.normal.x : 1,
      Number.isFinite(event.normal?.y) ? event.normal.y : 0);
    const speed = Number.isFinite(event.speed) ? Math.max(0, event.speed) : 0;
    const strength = Math.sqrt(clamp(speed / 1200));
    return { x: event.x, y: event.y, axis, wall: Boolean(event.wall),
      ringIds: [...(event.ringIds || [])], radius, speed, strength, reducedMotion,
      age: 0, duration: reducedMotion ? 0.22 : 0.42 + 0.18 * strength };
  }

  function pose(track, age, reducedMotion = track.reducedMotion) {
    if (age < 0 || age >= CONFIG.poseEnd) return { frame: 0, along: 1, across: 1, lean: 0 };
    const frame = age < 0.11 ? 1 : 2;
    if (reducedMotion) return { frame, along: 1, across: 1, lean: 0 };
    const strength = track.strength;
    const press = pulse(age, 0, 0.018, 0.09);
    const rebound = pulse(age, 0.055, 0.10, 0.21);
    const settle = pulse(age, 0.16, 0.22, CONFIG.poseEnd);
    const along = 1 - (0.025 + 0.16 * strength) * press
      + (0.009 + 0.055 * strength) * rebound - 0.018 * strength * settle;
    return { frame, along, across: Math.pow(1 / along, 0.65),
      lean: (0.018 + 0.035 * strength) * (rebound - press) };
  }

  function reaction(previous, track) {
    // A glancing follow-up must not cancel the stronger compression still
    // happening on this body. Each physical contact keeps its own water event.
    if (previous?.ordinary && previous.age < CONFIG.reactionGroup
      && previous.strength >= track.strength) return previous;
    return { age: track.age, strength: track.strength, ordinary: track,
      angle: Math.atan2(track.axis.y, track.axis.x) };
  }

  function compact(effects) {
    const result = [];
    for (const effect of effects) {
      const grouped = result.findIndex(other =>
        other.wall === effect.wall && Math.abs(other.age - effect.age) <= CONFIG.splashGroup
        && Math.hypot(other.x - effect.x, other.y - effect.y) < Math.min(other.radius, effect.radius) * 0.6);
      if (grouped < 0) result.push(effect);
      else if (effect.strength >= result[grouped].strength) result[grouped] = effect;
    }
    return result.slice(-CONFIG.maxEffects);
  }

  function sample(track, age) {
    const result = { rings: [], drops: [] };
    if (age < 0 || age >= track.duration) return result;
    const q = track.strength, scale = track.radius / 40, reduced = track.reducedMotion;
    const rings = reduced || q < 0.5 ? 1 : 2;
    for (let i = 0; i < rings; i += 1) {
      const elapsed = age - i * 0.065;
      if (elapsed < 0) continue;
      const u = clamp(elapsed / (track.duration - i * 0.065));
      result.rings.push({ x: track.x, y: track.y + 4 * scale,
        radius: (5 + u * (reduced ? 14 : 17 + 23 * q)) * scale, squash: 0.42,
        alpha: (reduced ? 0.25 : (0.3 + 0.42 * q) * (i ? 0.52 : 1)) * (1 - u) ** 1.6 });
    }
    if (reduced || q < 0.08 || age >= 0.29) return result;
    const base = Math.atan2(track.axis.y, track.axis.x);
    const count = q < 0.4 ? 4 : 8;
    for (let i = 0; i < count; i += 1) {
      // Wall normals point into the pool; ring contacts squeeze water sideways.
      const angle = track.wall ? base + (i / (count - 1) - 0.5) * 1.8
        : base + (i < count / 2 ? Math.PI / 2 : -Math.PI / 2)
          + ((i % (count / 2)) / Math.max(1, count / 2 - 1) - 0.5) * 0.8;
      const travel = (4 + age * (65 + 125 * q) * (i % 2 ? 0.85 : 1)) * scale;
      const lift = ((35 + 45 * q) * age - 170 * age ** 2) * scale;
      const x = track.x + Math.cos(angle) * travel;
      const y = track.y + Math.sin(angle) * travel - lift;
      result.drops.push({ x, y, size: (q > 0.65 && i % 2 === 0 ? 4 : 2) * scale,
        alpha: (0.55 + 0.4 * q) * (1 - age / 0.29) ** 0.65,
        layer: y >= track.y - 2 * scale ? 'front' : 'back' });
    }
    return result;
  }
  return { CONFIG, create, pose, reaction, compact, sample };
});
