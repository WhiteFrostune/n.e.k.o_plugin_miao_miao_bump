/* Short pixel crescents and paired wake edges, painted under all characters. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiaoWaterWakeRenderer = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const pixel = n => Math.round(n / 2) * 2;
  function dot(ctx, x, y) {
    const px = pixel(x), py = pixel(y);
    ctx.fillStyle = '#188faf'; ctx.fillRect(px, py + 2, 2, 2);
    ctx.fillStyle = '#f6ffff'; ctx.fillRect(px, py, 2, 2);
  }
  function draw(ctx, marks) {
    ctx.save();
    for (const mark of marks) {
      const px = -mark.dy, py = mark.dx;
      ctx.globalAlpha = mark.alpha;
      for (const side of [-1, 1]) {
        const steps = Math.max(6, Math.ceil(mark.length / 1.5));
        for (let i = 0; i <= steps; i += 1) {
          if (i === steps - 1 && mark.age > 0.16) continue;
          const t = i / steps, rear = mark.rear + mark.length * t;
          const width = side * (mark.width + mark.spread * t * t);
          dot(ctx, mark.x - mark.dx * rear + px * width,
            mark.y - mark.dy * rear * 0.6 + py * width * 0.55);
        }
      }
      if (!mark.ripple) continue;
      ctx.globalAlpha = mark.alpha * 0.55;
      const radius = mark.radius * 0.9 + mark.expansion;
      for (let i = 0; i <= 34; i += 1) {
        if (i % 13 > 10) continue;
        const angle = -1.1 + 2.2 * i / 34;
        dot(ctx, mark.x - mark.dx * radius * Math.cos(angle) + px * radius * Math.sin(angle),
          mark.y - mark.dy * radius * Math.cos(angle) * 0.6 + py * radius * Math.sin(angle) * 0.55);
      }
    }
    ctx.restore();
  }
  return { draw };
});
