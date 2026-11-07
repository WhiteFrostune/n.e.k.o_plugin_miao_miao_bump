/* Distance-sampled water traces. Owns presentation history, never simulation bodies. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiaoWaterWake = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const CONFIG = Object.freeze({ minSpeed: 30, maxMarks: 128, maxTail: 240 });
  const clamp = n => Math.max(0, Math.min(1, n));
  const strength = speed => Math.sqrt(clamp((speed - CONFIG.minSpeed) / 1370));
  const direction = ring => {
    const speed = Math.hypot(ring.vx, ring.vy);
    return { speed, dx: speed ? ring.vx / speed : 1, dy: speed ? ring.vy / speed : 0 };
  };

  function create() {
    return { time: 0, serial: 0, emitters: new Map(), distances: new Map(), marks: [] };
  }

  function prime(state, rings) {
    state.emitters.clear();
    for (const ring of rings) {
      state.emitters.set(ring.id, { x: ring.x, y: ring.y, ...direction(ring), carry: 0 });
      if (!state.distances.has(ring.id)) state.distances.set(ring.id, 0);
    }
  }

  function add(state, id, x, y, d, distance, born, radius) {
    const q = strength(d.speed);
    state.marks.push({ id, x, y, dx: d.dx, dy: d.dy, strength: q,
      radius, distance, born, duration: 0.40 + 0.14 * q, ripple: state.serial++ % 3 === 0 });
  }

  function advance(state, rings, seconds, { radius = 40, blockedIds = [], reducedMotion = false } = {}) {
    const dt = Math.max(0, Math.min(0.1, Number.isFinite(seconds) ? seconds : 0));
    state.time += dt;
    if (reducedMotion) {
      state.marks = []; state.emitters.clear(); state.distances.clear();
      return;
    }
    if (dt === 0) return;
    const blocked = new Set(blockedIds), live = new Set(rings.map(ring => ring.id));
    for (const id of state.emitters.keys()) if (!live.has(id) || blocked.has(id)) state.emitters.delete(id);
    state.marks = state.marks.filter(mark => state.time - mark.born < mark.duration);
    for (const ring of rings) {
      if (blocked.has(ring.id)) continue;
      const d = direction(ring), previous = state.emitters.get(ring.id);
      const end = { x: ring.x, y: ring.y, ...d, carry: 0 };
      let total = state.distances.get(ring.id) || 0;
      if (!previous) {
        state.emitters.set(ring.id, end);
        state.distances.set(ring.id, total);
        if (d.speed >= CONFIG.minSpeed) add(state, ring.id, ring.x, ring.y, d, total, state.time, radius);
        continue;
      }
      const travel = Math.hypot(ring.x - previous.x, ring.y - previous.y);
      const teleport = travel > Math.max(previous.speed, d.speed) * dt * 1.8 + radius;
      if (!teleport) total += travel;
      state.distances.set(ring.id, total);
      if (d.speed < CONFIG.minSpeed) {
        state.emitters.set(ring.id, end);
        continue;
      }
      const turned = previous.speed >= CONFIG.minSpeed && previous.dx * d.dx + previous.dy * d.dy < 0.5;
      if (teleport || turned) {
        // Keep old marks in their old direction; never interpolate across a bounce or respawn.
        add(state, ring.id, ring.x, ring.y, d, total, state.time, radius);
      } else if (travel > 1e-7) {
        const spacing = Math.max(radius * 0.55, d.speed * 0.04);
        const carry = previous.carry % spacing;
        let at = spacing - carry;
        while (at <= travel + 1e-7) {
          const f = clamp(at / travel);
          add(state, ring.id, previous.x + (ring.x - previous.x) * f,
            previous.y + (ring.y - previous.y) * f, d, total - travel + at,
            state.time - dt * (1 - f), radius);
          at += spacing;
        }
        end.carry = Math.max(0, (carry + travel) % spacing);
        if (spacing - end.carry < 1e-7) end.carry = 0;
      } else end.carry = previous.carry;
      state.emitters.set(ring.id, end);
    }
    state.marks = state.marks.filter(mark => (state.distances.get(mark.id) || 0) - mark.distance < CONFIG.maxTail)
      .slice(-CONFIG.maxMarks);
  }

  function sample(state) {
    return state.marks.map(mark => {
      const u = clamp((state.time - mark.born) / mark.duration);
      const gap = Math.max(0, (state.distances.get(mark.id) || 0) - mark.distance);
      const distanceFade = 1 - clamp((gap - 65) / (CONFIG.maxTail - 65));
      return { id: mark.id, x: mark.x, y: mark.y, dx: mark.dx, dy: mark.dy,
        radius: mark.radius, age: state.time - mark.born, strength: mark.strength,
        width: mark.radius * (0.77 + 0.11 * mark.strength) + 8 * u,
        rear: mark.radius * 0.25 + 6 * u,
        length: mark.radius * (0.22 + 0.30 * mark.strength) * (1 - 0.35 * u),
        spread: (4 + 5 * mark.strength) * (0.4 + 0.6 * u),
        alpha: (0.24 + 0.40 * mark.strength) * (1 - u) ** 1.6 * distanceFade,
        ripple: mark.ripple, expansion: 7 * u,
      };
    }).filter(mark => mark.alpha > 0.005);
  }
  return { CONFIG, create, prime, advance, sample };
});
