(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.MiaoArt = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  function reactionAt(age, strength = 1, reducedMotion = false) {
    if (age < 0 || age >= 0.48) return { frame: 0, along: 1, across: 1, lean: 0 };
    const amount = Math.max(0, Math.min(1, strength));
    const wave = reducedMotion ? 0 : -0.15 * amount * Math.cos(age * 30) * Math.exp(-age * 10);
    return {
      frame: age < 0.13 ? 1 : 2,
      along: 1 + wave,
      across: 1 / (1 + wave),
      lean: reducedMotion ? 0 : Math.sin(age * 24) * Math.exp(-age * 8) * 0.1 * amount,
    };
  }

  function floatImage(palette) {
    const image = document.createElement('canvas');
    image.width = 32; image.height = 32;
    const context = image.getContext('2d');
    for (let y = 0; y < 32; y += 1) {
      for (let x = 0; x < 32; x += 1) {
        const dx = x - 15.5;
        const dy = y - 15.5;
        const radius = Math.hypot(dx, dy);
        if (radius > 15.5 || radius < 7) continue;
        let color;
        if (radius > 14.1 || radius < 8) color = palette.dark;
        else {
          const sector = Math.floor((Math.atan2(dy, dx) + Math.PI) / (Math.PI / 4));
          color = sector % 2 ? palette.light : palette.main;
          if (dy > 8 && radius > 12) color = palette.main;
        }
        context.fillStyle = color;
        context.fillRect(x, y, 1, 1);
      }
    }
    return image;
  }

  async function load() {
    const metadataUrl = new URL('assets/juzi.json', document.baseURI);
    const response = await fetch(metadataUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Character metadata unavailable');
    const metadata = await response.json();
    const image = new Image();
    image.src = new URL(metadata.image, metadataUrl).href;
    await image.decode();
    const mask = document.createElement('canvas');
    mask.width = image.width; mask.height = image.height;
    const context = mask.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0);
    const pixels = context.getImageData(0, 0, mask.width, mask.height).data;
    const box = metadata.drawBox;

    return {
      metadata,
      draw(context, frameIndex = 0, lean = 0) {
        const frame = metadata.frames[frameIndex] || metadata.frames[0];
        context.save();
        context.imageSmoothingEnabled = false;
        // The hands remain near the float; the head has a small visual recoil.
        context.translate(0, 10);
        context.rotate(lean);
        context.drawImage(image, frame.x, frame.y, frame.width, frame.height,
          box.x, box.y - 10, box.width, box.height);
        context.restore();
      },
      contains(x, y) {
        if (x < box.x || y < box.y || x >= box.x + box.width || y >= box.y + box.height) return false;
        const frame = metadata.frames[0];
        const sourceX = Math.floor(frame.x + (x - box.x) / box.width * frame.width);
        const sourceY = Math.floor(frame.y + (y - box.y) / box.height * frame.height);
        return pixels[(sourceY * image.width + sourceX) * 4 + 3] > 128;
      },
    };
  }

  return { load, reactionAt, floatImage };
});
