(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./motion.js'),require('./unseat-renderer.js'),require('./water-surface-renderer.js'));
  else root.MiaoArt = factory(root.MiaoMotion,root.MiaoUnseatRenderer,root.MiaoWaterSurfaceRenderer);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (M,U,Water) {
  'use strict';

  function flightAt(event, age, map, reducedMotion = false) {
    return M.sampleFlight(M.createFlight(event, { reducedMotion }), age, map);
  }

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

  async function load(character = 'juzi', artSet = 'concept-v2', knockoutSet = 'classic') {
    const selected = artSet === 'classic' ? 'classic' : 'concept-v2';
    try {
      return await loadCharacter(character, selected, knockoutSet);
    } catch (error) {
      if (selected === 'classic') throw error;
      const fallback = await loadCharacter(character, 'classic');
      fallback.fallbackFrom = selected;
      return fallback;
    }
  }

  async function loadCharacter(character, artSet, knockoutSet = 'classic') {
    const directory = artSet === 'classic' ? 'assets' : 'assets/characters/concept-v2';
    const metadataUrl = new URL(`${directory}/${character}.json`, document.baseURI);
    const response = await fetch(metadataUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Character metadata unavailable');
    const metadata = await response.json();
    metadata.artSet = artSet;
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
    let knockout = null;
    if (metadata.knockout) {
      try { knockout = await loadKnockout(new URL(metadata.knockout, metadataUrl)); }
      catch { /* Optional split art fails as a unit; preserve the existing character. */ }
    }
    let knockoutPoses = null;
    if (knockout && metadata.knockoutPoses) {
      try { knockoutPoses = await loadKnockoutPoses(new URL(metadata.knockoutPoses, metadataUrl)); }
      catch { /* Missing optional poses preserve the old split knockout as a unit. */ }
    }

    let unseat=null;
    if(knockout&&metadata.unseat&&U){
      try{unseat=await U.load(new URL(metadata.unseat,metadataUrl));}
      catch{ /* Optional study art must not break normal cats or old knockouts. */ }
    }
    const classicKnockout = { knockout, knockoutPoses, unseat };
    metadata.knockoutSetUsed='classic';
    if(knockoutSet==='swim-v2'&&metadata.knockoutV2&&metadata.unseatV2&&U){
      try{
        const [split,poses]=await Promise.all([
          loadKnockout(new URL(metadata.knockoutV2,metadataUrl)),
          U.load(new URL(metadata.unseatV2,metadataUrl))]);
        // Replace the pair atomically: a new body must never borrow an old ring.
        knockout=split;unseat=poses;knockoutPoses=null;
        metadata.knockoutSetUsed='swim-v2';
      }catch{ /* Keep old optional art and the normal character fully usable. */ }
    }
    let opening = null;
    if (metadata.opening) {
      try { opening = await loadOpening(new URL(metadata.opening, metadataUrl)); }
      catch { /* Missing opening art skips the entrance without blocking play. */ }
    }
    return {
      metadata,
      knockout,
      knockoutPoses,
      unseat,
      classicKnockout,
      opening,
      drawPortrait(context) {
        const frame = frames[0];
        // Keep the head-top cat and face on the same sampled game-pixel grid.
        // Optional metadata lets replacement art adjust its own portrait crop.
        const crop = metadata.portraitBox || { x: 0, y: 0, width: frame.width, height: Math.min(frame.width, frame.height) };
        const resolution = metadata.portraitResolution || 48;
        if (context.canvas.width !== resolution || context.canvas.height !== resolution) {
          context.canvas.width = resolution;
          context.canvas.height = resolution;
        }
        context.clearRect(0, 0, context.canvas.width, context.canvas.height);
        context.imageSmoothingEnabled = false;
        context.drawImage(frame, crop.x, crop.y, crop.width, crop.height, 0, 0, context.canvas.width, context.canvas.height);
      },
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

  async function loadOpening(metadataUrl) {
    const response = await fetch(metadataUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Opening pose metadata unavailable');
    const metadata = await response.json();
    const image = new Image();
    image.src = new URL(metadata.image, metadataUrl).href;
    await image.decode();
    const frames = {};
    for (const id of ['ring', 'jump', 'catch']) {
      const { source, box, outline } = metadata.frames[id];
      const [x, y, width, height] = source;
      const sprite = document.createElement('canvas');
      sprite.width = box[2]; sprite.height = box[3];
      const target = sprite.getContext('2d');
      target.imageSmoothingEnabled = false;
      if (outline) {
        target.beginPath();
        outline.forEach(([px, py], i) => {
          const sx = px * sprite.width / width, sy = py * sprite.height / height;
          if (i === 0) target.moveTo(sx, sy); else target.lineTo(sx, sy);
        });
        target.closePath(); target.clip();
      }
      target.drawImage(image, x, y, width, height, 0, 0, sprite.width, sprite.height);
      const pixels = target.getImageData(0, 0, sprite.width, sprite.height);
      for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = pixels.data[i] < 128 ? 0 : 255;
      target.putImageData(pixels, 0, 0);
      frames[id] = { sprite, box };
    }
    return { draw(context, id) {
      const { sprite, box } = frames[id];
      context.imageSmoothingEnabled = false;
      context.drawImage(sprite, ...box);
    } };
  }

  async function loadKnockoutPoses(metadataUrl) {
    const response=await fetch(metadataUrl,{cache:'no-cache'});
    if(!response.ok)throw new Error('Knockout poses unavailable');
    const metadata=await response.json();
    if(!Array.isArray(metadata.frames)||metadata.frames.length!==3
      || !['impact','extend','tuck'].every(id=>metadata.frames.some(frame=>frame.id===id))
      || ![metadata.headRestY,metadata.headWidthInWorld,metadata.pivotBelowHead].every(Number.isFinite)
      || metadata.headWidthInWorld<=0)throw new Error('Invalid knockout pose registration');
    const image=new Image();image.src=new URL(metadata.image,metadataUrl).href;await image.decode();
    const sprites=new Map(metadata.frames.map(frame=>{
      const s=frame.source,a=frame.headAnchor;
      if(!s||!a||![s.x,s.y,s.width,s.height,a.x,a.y,frame.headWidth].every(Number.isFinite)
        || s.x<0||s.y<0||s.width<=0||s.height<=0||frame.headWidth<=0||frame.headWidth>s.width
        || s.x+s.width>image.naturalWidth||s.y+s.height>image.naturalHeight
        || a.x<s.x||a.x>s.x+s.width||a.y<s.y||a.y>s.y+s.height)throw new Error('Invalid knockout pose crop');
      const sprite=document.createElement('canvas');sprite.width=96;sprite.height=Math.round(96*s.height/s.width);
      const target=sprite.getContext('2d');target.imageSmoothingEnabled=false;
      target.drawImage(image,s.x,s.y,s.width,s.height,0,0,sprite.width,sprite.height);
      const pixels=target.getImageData(0,0,sprite.width,sprite.height);
      for(let i=3;i<pixels.data.length;i+=4)pixels.data[i]=pixels.data[i]<128?0:255;
      target.putImageData(pixels,0,0);
      const scale=metadata.headWidthInWorld/frame.headWidth;
      return [frame.id,{sprite,box:{x:(s.x-a.x)*scale,y:(s.y-a.y)*scale,width:s.width*scale,height:s.height*scale}}];
    }));
    return {headRestY:metadata.headRestY,pivotBelowHead:metadata.pivotBelowHead,
      draw(context,id){const {sprite,box}=sprites.get(id);context.save();context.imageSmoothingEnabled=false;
        context.drawImage(sprite,box.x,box.y,box.width,box.height);context.restore();}};
  }

  async function loadKnockout(metadataUrl) {
    const response = await fetch(metadataUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Knockout metadata unavailable');
    const metadata = await response.json();
    if (!Array.isArray(metadata.parts) || metadata.parts.length !== 2
      || !['float', 'character'].every(id => metadata.parts.some(part => part.id === id))) {
      throw new Error('Incomplete split character');
    }
    const sprites = await Promise.all(metadata.parts.map(async part => {
      const source = part.source, grid = part.pixelGrid, box = part.drawBox, flight = part.flight;
      if (!source || !grid || !box || !flight
        || ![source.x, source.y, source.width, source.height, box.x, box.y, box.width, box.height,
            flight.delay, flight.departure, flight.drift, flight.turn, flight.growth,
            flight.squeezeX, flight.squeezeY].every(Number.isFinite)
        || source.x < 0 || source.y < 0 || source.width <= 0 || source.height <= 0 || box.width <= 0 || box.height <= 0
        || ![grid.width, grid.height].every(n => Number.isInteger(n) && n > 0 && n <= 256)
          || flight.delay < 0 || flight.delay > 0.2 || flight.departure <= flight.delay || flight.departure > 1
          || flight.drift < 0 || flight.drift > 1 || Math.abs(flight.turn) > Math.PI
          || flight.growth < 0 || flight.growth > 1
          || flight.squeezeX < 0 || flight.squeezeX > 0.7
          || flight.squeezeY < 0 || flight.squeezeY > 0.7) throw new Error('Invalid split art');
      const image = new Image(); image.src = new URL(part.image, metadataUrl).href; await image.decode();
      if (source.x + source.width > image.naturalWidth || source.y + source.height > image.naturalHeight) {
        throw new Error('Split art crop outside image');
      }
      const sprite = document.createElement('canvas'); sprite.width = grid.width; sprite.height = grid.height;
      const target = sprite.getContext('2d'); target.imageSmoothingEnabled = false;
      target.drawImage(image, source.x, source.y, source.width, source.height, 0, 0, grid.width, grid.height);
      const pixels = target.getImageData(0, 0, grid.width, grid.height);
      for (let i = 3; i < pixels.data.length; i += 4) pixels.data[i] = pixels.data[i] < 128 ? 0 : 255;
      target.putImageData(pixels, 0, 0);
      return { id: part.id, sprite, box };
    }));
    return {
      parts: metadata.parts,
      draw(context, id) {
        const { sprite, box } = sprites.find(part => part.id === id);
        context.save(); context.imageSmoothingEnabled = false;
        context.drawImage(sprite, box.x, box.y, box.width, box.height); context.restore();
      },
    };
  }

  async function loadUiSurfaces() {
    const url = new URL('assets/ui/side-surfaces.json', document.baseURI);
    const response = await fetch(url, { cache: 'no-cache' });
    if (!response.ok) throw new Error('UI surfaces unavailable');
    const definitions = await response.json();
    const entries = await Promise.all(Object.entries(definitions).map(async ([name, asset]) => {
      const image = new Image();
      image.src = new URL(asset.image, url).href;
      await image.decode();
      const { x, y, width, height } = asset.crop;
      if (![x, y, width, height].every(Number.isFinite) || x < 0 || y < 0 || width <= 0 || height <= 0
        || x + width > image.naturalWidth || y + height > image.naturalHeight) throw new Error('Invalid UI crop');
      // Sample source artwork at runtime, preserving the original PNG files.
      const surface = document.createElement('canvas');
      surface.width = width; surface.height = height;
      surface.getContext('2d').drawImage(image, x, y, width, height, 0, 0, width, height);
      return [name, `url("${surface.toDataURL()}")`];
    }));
    return Object.fromEntries(entries);
  }

  async function loadPool(definition, { classicWater = false, dynamicWater = true } = {}) {
    if (!definition.art) throw new Error('Map uses procedural art');
    const { bounds, width, height } = definition.world;
    const metadataUrl = new URL(definition.art.metadata, document.baseURI);
    const response = await fetch(metadataUrl, { cache: 'no-cache' });
    if (!response.ok) throw new Error('Pool metadata unavailable');
    const metadata = await response.json();
    const image = new Image();
    image.src = new URL(metadata.image, metadataUrl).href;
    await image.decode();
    const grid = metadata.pixelGrid;
    const slices = metadata.sourceSlices;
    const water = metadata.waterTexture;
    if (!grid || ![grid.width, grid.height].every(n => Number.isInteger(n) && n > 0 && n <= 2048)
      || !slices || ![slices.left, slices.right, slices.top, slices.bottom].every(Number.isFinite)
      || slices.left <= 0 || slices.left >= slices.right || slices.right >= image.naturalWidth
      || slices.top <= 0 || slices.top >= slices.bottom || slices.bottom >= image.naturalHeight
      || !water || ![water.x, water.y, water.width, water.height].every(Number.isFinite)
      || water.x < 0 || water.y < 0 || water.width <= 0 || water.height <= 0
      || water.x + water.width > image.naturalWidth || water.y + water.height > image.naturalHeight) {
      throw new Error('Invalid pool art geometry');
    }
    const map = document.createElement('canvas');
    const scale = Math.min(grid.width / width, grid.height / height);
    map.width = Math.max(1, Math.round(width * scale));
    map.height = Math.max(1, Math.round(height * scale));
    const context = map.getContext('2d');
    context.imageSmoothingEnabled = false;
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
    context.drawImage(image, water.x, water.y, water.width, water.height,
      dx[1], dy[1], dx[2] - dx[1], dy[2] - dy[1]);
    context.strokeStyle = '#438eaa'; context.lineWidth = 1;
    context.strokeRect(dx[1] - 0.5, dy[1] - 0.5, dx[2] - dx[1] + 1, dy[2] - dy[1] + 1);
    let surface = null;
    if (metadata.waterSurface && !classicWater) {
      try {
        const source = metadata.waterSurface;
        const size = source.pixelGrid;
        if (!size || ![size.width, size.height].every(n => Number.isInteger(n) && n >= 64 && n <= 2048)) {
          throw new Error('Invalid water surface grid');
        }
        const texture = new Image();
        texture.src = new URL(source.image, metadataUrl).href;
        await texture.decode();
        surface = document.createElement('canvas');
        surface.width = size.width; surface.height = size.height;
        const painter = surface.getContext('2d');
        painter.imageSmoothingEnabled = false;
        painter.drawImage(texture, 0, 0, surface.width, surface.height);
      } catch {
        // An independent surface is optional: keep the original rim and water.
        surface = null;
      }
    }
    let animation = null;
    if (surface && dynamicWater && metadata.waterSurface.motion?.enabled && Water) {
      try { animation = Water.create(surface, bounds, metadata.waterSurface.motion); }
      catch { /* Unsupported pixel access keeps the approved static water usable. */ }
    }
    return {
      waterStyle: surface ? 'clear-v2' : 'classic',
      dynamicWater: Boolean(animation),
      resetWater() { animation?.reset(); },
      waterState() { return animation?.snapshot() || null; },
      draw(target, { time = 0, sources = [], reducedMotion = false } = {}) {
        target.save();
        target.imageSmoothingEnabled = false;
        target.drawImage(map, 0, 0, width, height);
        if (surface) {
          // Warp locally in a cached surface; the rim and original image remain fixed.
          target.beginPath(); target.rect(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top); target.clip();
          if (animation && !reducedMotion) animation.draw(target, time, sources);
          else target.drawImage(surface, bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
        }
        target.restore();
      },
    };
  }

  function drawPoolFallback(context, definition) {
    const { width, height, bounds: b } = definition.world;
    const w = b.right - b.left, h = b.bottom - b.top;
    const box = (x, y, bw, bh, radius, color) => {
      context.beginPath(); context.roundRect(x, y, bw, bh, radius);
      context.fillStyle = color; context.fill();
    };
    context.save();
    context.fillStyle = '#e7eff0'; context.fillRect(0, 0, width, height);
    context.lineWidth = 1; context.strokeStyle = '#d5e2e6';
    for (let x = 0; x < width; x += 32) { context.beginPath(); context.moveTo(x, 0); context.lineTo(x, height); context.stroke(); }
    for (let y = 0; y < height; y += 32) { context.beginPath(); context.moveTo(0, y); context.lineTo(width, y); context.stroke(); }
    box(b.left - 29, b.top - 25, w + 58, h + 60, 30, '#92bcca');
    box(b.left - 29, b.top - 32, w + 58, h + 60, 30, '#70b5d1');
    box(b.left - 17, b.top - 19, w + 34, h + 34, 20, '#eaf9fb');
    context.fillStyle = '#79cbdc'; context.fillRect(b.left, b.top, w, h);
    context.fillStyle = '#9fdfe7'; context.fillRect(b.left + 4, b.top + 4, w - 8, h - 8);
    context.strokeStyle = '#d2f5f4'; context.globalAlpha = 0.37;
    for (let x = b.left + 28; x < b.right - 4; x += 52) {
      context.beginPath(); context.moveTo(x, b.top + 4); context.lineTo(x, b.bottom - 4); context.stroke();
    }
    for (let y = b.top + 28; y < b.bottom - 4; y += 52) {
      context.beginPath(); context.moveTo(b.left + 4, y); context.lineTo(b.right - 4, y); context.stroke();
    }
    context.restore();
  }

  return { load, loadPool, loadUiSurfaces, drawPoolFallback, reactionAt, floatImage, flightAt };
});
