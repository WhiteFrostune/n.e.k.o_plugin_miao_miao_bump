/* Small pixel water shapes, independently replaceable from the entrance poses. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiaoLandingWaterRenderer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const pixel = n => Math.round(n / 2) * 2;
  function draw(ctx, state, layer) {
    ctx.save();
    if (layer === 'back') {
      for (const ring of state.rings) {
        ctx.globalAlpha = ring.alpha;
        const steps = Math.ceil(ring.radius * Math.PI);
        for (let i = 0; i < steps; i += 1) {
          // Brief gaps soften the rings without blur or a large opaque disk.
          if (i % 23 > 18) continue;
          const angle = Math.PI * 2 * i / steps;
          const x = pixel(ring.x + Math.cos(angle) * ring.radius);
          const y = pixel(ring.y + Math.sin(angle) * ring.radius * ring.squash);
          ctx.fillStyle = '#67cfdf'; ctx.fillRect(x, y + 2, 2, 2);
          ctx.fillStyle = '#ebffff'; ctx.fillRect(x, y, 2, 2);
        }
      }
    }
    for (const drop of state.drops) {
      if (drop.layer !== layer) continue;
      const x = pixel(drop.x), y = pixel(drop.y), size = Math.max(2, pixel(drop.size));
      ctx.globalAlpha = drop.alpha;
      ctx.fillStyle = '#64c9df'; ctx.fillRect(x - size / 2, y, size, size);
      ctx.fillStyle = '#f3ffff'; ctx.fillRect(x - size / 2, y - 2, size, size);
      if (size > 2) ctx.fillRect(x, y - 4, 2, 2);
    }
    ctx.restore();
  }
  return { draw };
});
