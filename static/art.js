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

  async function load(character = 'juzi') {
    const metadataUrl = new URL(`assets/${character}.json`, document.baseURI);
    const response = await fetch(metadataUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Character metadata unavailable');
    const metadata = await response.json();
    const image = new Image();
    image.src = new URL(metadata.image, metadataUrl).href;
    await image.decode();
    const box = metadata.drawBox;
    // Sample once onto the character's game grid, then enlarge whole pixels.
    // Keeping this separate from the high-DPI screen avoids tiny source details.
    const frames = metadata.frames.map(frame => {
      const sprite = document.createElement('canvas');
      sprite.width = metadata.pixelGrid.width; sprite.height = metadata.pixelGrid.height;
      const target = sprite.getContext('2d');
      target.imageSmoothingEnabled = false;
      target.drawImage(image, frame.x, frame.y, frame.width, frame.height, 0, 0, sprite.width, sprite.height);
      const sampled = target.getImageData(0, 0, sprite.width, sprite.height);
      for (let i = 3; i < sampled.data.length; i += 4) sampled.data[i] = sampled.data[i] < 128 ? 0 : 255;
      target.putImageData(sampled, 0, 0);
      return sprite;
    });
    const hitPixels = frames[0].getContext('2d').getImageData(0, 0, frames[0].width, frames[0].height).data;

    return {
      metadata,
      draw(context, frameIndex = 0, lean = 0) {
        const frame = frames[frameIndex] || frames[0];
        context.save();
        context.imageSmoothingEnabled = false;
        // Pixel-grid translations keep the silhouette crisp while reacting.
        context.translate(Math.round(lean * 24) * 2, 0);
        context.drawImage(frame, box.x, box.y, box.width, box.height);
        context.restore();
      },
      contains(x, y) {
        if (x < box.x || y < box.y || x >= box.x + box.width || y >= box.y + box.height) return false;
        const sourceX = Math.floor((x - box.x) / box.width * frames[0].width);
        const sourceY = Math.floor((y - box.y) / box.height * frames[0].height);
        return hitPixels[(sourceY * frames[0].width + sourceX) * 4 + 3] > 128;
      },
    };
  }

  async function loadPool(bounds, width, height) {
    const metadataUrl = new URL('assets/summer-pool.json', document.baseURI);
    const response = await fetch(metadataUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Pool metadata unavailable');
    const metadata = await response.json();
    const image = new Image();
    image.src = new URL(metadata.image, metadataUrl).href;
    await image.decode();
    const map = document.createElement('canvas');
    map.width = metadata.pixelGrid.width; map.height = metadata.pixelGrid.height;
    const context = map.getContext('2d');
    context.imageSmoothingEnabled = false;
    const slices = metadata.sourceSlices;
    const sx = [0, slices.left, slices.right, image.naturalWidth];
    const sy = [0, slices.top, slices.bottom, image.naturalHeight];
    const dx = [0, bounds.left, bounds.right, width].map(x => x / width * map.width);
    const dy = [0, bounds.top, bounds.bottom, height].map(y => y / height * map.height);
    // Fit the eight rim patches around the authoritative physical water rectangle.
    // Draw only clear water in the center so painted corners never become fake walls.
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 3; column += 1) {
        if (row === 1 && column === 1) continue;
        context.drawImage(image, sx[column], sy[row], sx[column + 1] - sx[column], sy[row + 1] - sy[row],
          dx[column], dy[row], dx[column + 1] - dx[column], dy[row + 1] - dy[row]);
      }
    }
    const water = metadata.waterTexture;
    context.drawImage(image, water.x, water.y, water.width, water.height,
      dx[1], dy[1], dx[2] - dx[1], dy[2] - dy[1]);
    context.strokeStyle = '#438eaa'; context.lineWidth = 1;
    context.strokeRect(dx[1] - 0.5, dy[1] - 0.5, dx[2] - dx[1] + 1, dy[2] - dy[1] + 1);
    return {
      draw(target) {
        target.save();
        target.imageSmoothingEnabled = false;
        target.drawImage(map, 0, 0, width, height);
        target.restore();
      },
    };
  }

  return { load, loadPool, reactionAt, floatImage };
});
