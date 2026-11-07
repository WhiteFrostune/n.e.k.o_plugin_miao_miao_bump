/* Reusable presentation tracks. No sprites, DOM, physics or battle mutations. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiaoMotion = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const KNOCKOUT = Object.freeze({ duration: 1.1, reducedDuration: 0.25, launchEnd: 0.14, fadeStart: 0.84, splitBlend: 0.065 });
  const LANDING = Object.freeze({ ringIn: 0.42, jump: 0.29, touch: 0.70, sink: 0.79, rebound: 0.93, duration: 1.09 });
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const smooth = t => t * t * (3 - 2 * t);

  function sampleLanding(age, entryOffset, radius = 40) {
    const { ringIn, jump, touch, sink, rebound, duration } = LANDING;
    const t = clamp(age, 0, duration);
    const scale = radius / 40;
    const direction = entryOffset > 0 ? -1 : 1;
    const progress = (start, end) => smooth(clamp((t - start) / (end - start), 0, 1));
    if (t < touch) {
      const glide = (1 - clamp(t / ringIn, 0, 1)) ** 2;
      const ring = { x: entryOffset * glide, y: -14 * scale * glide, angle: direction * -0.20 * glide };
      if (t < jump) return { ring, pose: 'ring', direction };
      const travel = (t - jump) / (touch - jump);
      return { ring, pose: 'jump', direction, body: {
        x: entryOffset * (1 - travel) ** 1.08,
        y: -(30 * (1 - travel) + 43 * 4 * travel * (1 - travel)) * scale,
        angle: direction * (0.18 * travel - 0.13) * (1 - travel),
      } };
    }
    const press = progress(touch, sink) - progress(sink, rebound);
    const lift = progress(sink, rebound) - progress(rebound, duration);
    return {
      pose: 'catch', direction,
      body: { x: 0, y: (10 * press - 5 * lift) * scale, angle: direction * (0.085 * press - 0.035 * lift) },
    };
  }

  function resolveMotion(preference, systemReduced) {
    const mode = ['full', 'reduce'].includes(preference) ? preference : 'system';
    return { preference: mode, reduced: mode === 'reduce' || (mode === 'system' && Boolean(systemReduced)) };
  }

  function createFlight(event, { spriteBox, radius = 40, reducedMotion = false } = {}) {
    const direction = event.direction || { x: 1, y: 0 };
    const length = Math.hypot(direction.x, direction.y);
    const unit = length > 1e-7 && Number.isFinite(length)
      ? { x: direction.x / length, y: direction.y / length } : { x: 1, y: 0 };
    const box = spriteBox || { x: -radius, y: -radius, width: radius * 2, height: radius * 2 };
    return {
      ...event, age: 0, direction: unit, reducedMotion,
      duration: Number.isFinite(event.duration) && event.duration > 0 ? event.duration
        : reducedMotion ? KNOCKOUT.reducedDuration : KNOCKOUT.duration,
      // Rotate about the visual centre, including old art with a separate float.
      pivotX: box.x + box.width / 2, pivotY: box.y + box.height / 2,
      extent: Math.hypot(box.width, box.height) / 2 + radius,
    };
  }

  function sampleFlight(track, age, map, viewport = null) {
    if (track.ejection && !track.reducedMotion) return sampleEjection(track, age, map, viewport);
    const t = clamp(age / track.duration, 0, 1);
    const d = track.direction;
    const screen = viewport || { left: 0, top: 0, right: map.world.width, bottom: map.world.height };
    const margin = track.extent;
    const distances = [];
    if (d.x > 1e-7) distances.push((screen.right + margin - track.x) / d.x);
    if (d.x < -1e-7) distances.push((screen.left - margin - track.x) / d.x);
    if (d.y > 1e-7) distances.push((screen.bottom + margin - track.y) / d.y);
    if (d.y < -1e-7) distances.push((screen.top - margin - track.y) / d.y);
    if (track.reducedMotion) {
      return { x: track.x + d.x * 24 * t, y: track.y + d.y * 24 * t,
        shadowX: track.x + d.x * 24 * t, shadowY: track.y + d.y * 24 * t,
        rotation: 0, scale: 1 - 0.05 * t, alpha: 1 - t, lift: 0 };
    }
    // A short readable launch precedes acceleration. Stay opaque until departure.
    const launch = clamp(t / KNOCKOUT.launchEnd, 0, 1);
    const travel = clamp((t - KNOCKOUT.launchEnd) / (1 - KNOCKOUT.launchEnd), 0, 1);
    const distance = Math.max(80, Math.min(...distances));
    const progress = 0.12 * travel + 0.88 * travel * travel;
    const lift = Math.min(map.world.width, map.world.height) * 0.24 * (track.arcMultiplier ?? 1) * 4 * travel * (1 - travel)
      + Math.sin(Math.PI * launch) * 8;
    const x = track.x + d.x * distance * progress;
    const groundY = track.y + d.y * distance * progress;
    return { x, y: groundY - lift, shadowX: x, shadowY: groundY, lift,
      rotation: (d.x < 0 ? -1 : 1) * Math.PI * 1.25 * travel * (track.spinMultiplier ?? 1),
      scale: 1 + Math.sin(Math.PI * launch) * 0.12 - 0.48 * smooth(travel),
      alpha: 1 - smooth(clamp((t - KNOCKOUT.fadeStart) / (1 - KNOCKOUT.fadeStart), 0, 1)) };
  }

  // Screen projection of one impact: shared horizontal impulse, separate lift and drag.
  // Leave while still rising; a knockout must not appear to land back in the pool.
  function sampleEjection(track, age, map, viewport) {
    const screen = viewport || { left: 0, top: 0, right: map.world.width, bottom: map.world.height };
    const motion = track.ejection;
    const delay = motion.delay;
    const active = clamp((age / track.duration - delay) / (motion.departure - delay), 0, 1);
    const u = active;
    const drift = motion.drift * map.world.width * (1.35 * u - 0.35 * u * u);
    const groundX = track.x + track.direction.x * drift;
    const groundY = track.y + track.direction.y * map.world.height * 0.16 * u;
    const rise = Math.max(map.world.height * 0.6,
      track.y - screen.top + track.extent * 2 + map.world.height * 0.16);
    const lift = rise * (1.1 * u - 0.1 * u * u);
    const turn = 1 - Math.pow(1 - u, 2.5);
    const sign = track.direction.x < 0 ? -1 : 1;
    const scale = 1 + motion.growth * Math.sin(u * Math.PI / 2);
    const outside = groundY - lift < screen.top - track.extent * scale;
    return { x: groundX, y: groundY - lift, shadowX: groundX, shadowY: groundY, lift,
      rotation: sign * motion.turn * turn,
      scale,
      // A small perspective turn, never a mirrored face or repeated flat pinwheel.
      stretchX: 1 - motion.squeezeX * Math.sin(Math.PI * turn),
      stretchY: 1 - motion.squeezeY * Math.sin(Math.PI * turn),
      alpha: outside ? 1 - smooth(clamp((u - 0.9) / 0.1, 0, 1)) : 1 };
  }

  function createFlightParts(event, definitions, { radius = 40, reducedMotion = false } = {}) {
    const base = createFlight(event, { radius, reducedMotion });
    return definitions.map(part => ({
      ...createFlight({ ...event, direction: { ...base.direction } },
        { spriteBox: part.drawBox, radius, reducedMotion }),
      partId: part.id, ejection: { ...part.flight },
    }));
  }

  return { KNOCKOUT, LANDING, resolveMotion, sampleLanding, createFlight, sampleFlight, createFlightParts };
});
