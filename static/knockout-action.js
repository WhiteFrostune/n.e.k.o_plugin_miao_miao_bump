/* Reusable pose-to-pose knockout tracks. No rendering or battle mutations. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiaoKnockoutAction = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const DEFAULTS = Object.freeze({ duration: 1.45, impactEnd: 0.055, extendAt: 0.075,
    tuckAt: 0.235, ringRelease: 0.09, exitAt: 0.7, headRestY: -30 });
  // Keep the approved study preset intact; live impact starts with a stronger
  // directional impulse, then loses speed rather than easing into a self-jump.
  const IMPACT = Object.freeze({ ...DEFAULTS, impactEnd:0.035, extendAt:0.055,
    tuckAt:0.18, ringRelease:0.075, directionalImpact:true });
  const clamp = (x, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, x));
  const smooth = t => t * t * (3 - 2 * t);

  function create(event, { radius = 40, config = DEFAULTS } = {}) {
    const d = event.direction || { x: 1, y: 0 };
    const length = Math.hypot(d.x, d.y);
    return { x: event.x, y: event.y, radius,
      direction: Number.isFinite(length) && length > 1e-7 ? { x: d.x / length, y: d.y / length } : { x: 1, y: 0 },
      config: { ...DEFAULTS, ...config } };
  }

  function flight(track, age, part, viewport) {
    const c = track.config, r = track.radius, d = track.direction;
    const body = part === 'character';
    const release = body ? c.impactEnd : c.ringRelease;
    const time = Math.max(0, age - release);
    const press = Math.sin(Math.PI * clamp(age / c.impactEnd));
    const shared = r * 0.2 * smooth(clamp(age / c.impactEnd));
    const speed = r * (c.directionalImpact ? (body ? 19 : 14) : (body ? 7 : 6.3));
    const liftSpeed = r * (body ? 18 : 16.5);
    const gravity = r * (body ? 8 : 6);
    const drag = c.directionalImpact ? 1.4 : 0.4;
    const carry = c.directionalImpact ? 9 : 1.6;
    const raw = t => ({
      x: track.x + d.x * (r * 0.2 + speed * t / (1 + drag * t)),
      y: track.y + (body ? c.headRestY : 0) + (c.directionalImpact ? d.y*r*0.2 : 0)
        + d.y * r * carry * t / (1 + drag * t)
        - liftSpeed * t + 0.5 * gravity * t * t,
    });
    let x = track.x + d.x * shared;
    let y = track.y + (body ? c.headRestY : 0) + (c.directionalImpact ? d.y * shared : (body ? 4 : 2) * press);
    if (age >= release) ({ x, y } = raw(time));
    const turnTime = Math.max(0, age - (body ? 0.15 : release));
    const turn = body ? 0.92 * (1 - Math.exp(-turnTime * 3.8)) : -2.2 * (1 - Math.exp(-turnTime * 3.2));
    const growth = body ? 0.13 : 0.08;
    const scale = 1 + growth * Math.sin(clamp(age / c.duration) * Math.PI / 2);
    // Physical-looking release is independent of screen size. A late continuation
    // only clears unusually tall viewports, without changing the first key poses.
    const end = raw(c.duration - release);
    const extent = r * (body ? 2.25 : 1.5);
    const correction = Math.max(0, end.y - (viewport.top - extent * (1 + growth) - r));
    y -= correction * smooth(clamp((age - c.exitAt) / (c.duration - c.exitAt)));
    const sign = d.x < 0 ? -1 : 1;
    return { x, y, angle: sign * turn, scale,
      scaleX: c.directionalImpact ? 1 + (0.04*Math.abs(d.y)-0.1*Math.abs(d.x))*press
        : (body ? 1 + 0.065 * press : 1 + 0.12 * press),
      scaleY: c.directionalImpact ? 1 + (0.04*Math.abs(d.x)-0.1*Math.abs(d.y))*press
        : body ? 1 - 0.08 * press : 1 - 0.15 * press,
      alpha: age >= c.duration ? 0 : 1,
      lift: Math.max(0, track.y + (body ? c.headRestY : 0) + d.y * r * carry * time / (1 + drag*time) - y),
    };
  }

  function sample(track, age, viewport = { left: -200, top: -200, right: 1400, bottom: 900 }) {
    const c = track.config, t = clamp(age, 0, c.duration);
    const body = flight(track, t, 'character', viewport);
    const ring = flight(track, t, 'float', viewport);
    const pose = t < c.extendAt ? 'impact' : t < c.tuckAt ? 'extend' : 'tuck';
    return { age: t, duration: c.duration, pose,
      phase: t < c.impactEnd ? 'impact' : t < c.tuckAt ? 'release' : t < c.exitAt ? 'tumble' : 'exit',
      body, ring, frontRim: clamp(1 - (t - c.impactEnd) / 0.105),
      shadow: { x: ring.x, y: track.y + track.direction.y * track.radius * (c.directionalImpact?9:1.6)
          * Math.max(0, t - c.ringRelease) / (1 + (c.directionalImpact?1.4:0)*Math.max(0,t-c.ringRelease)),
        alpha: 0.15 * Math.exp(-body.lift / (track.radius * 1.4)) },
    };
  }

  return { DEFAULTS, IMPACT, create, sample };
});
