(function () {
  'use strict';
  const P = window.MiaoPhysics;
  const I = window.MiaoI18n;
  const A = window.MiaoArt;
  const $ = id => document.getElementById(id);
  const canvas = $('pool');
  const ctx = canvas.getContext('2d');
  const colors = [
    { main: '#eea449', dark: '#b8793e', light: '#fff0ca' },
    { main: '#edca60', dark: '#a88642', light: '#fff6cf' },
    { main: '#b6a5dc', dark: '#8d7caf', light: '#f1ebff' },
  ];
  let world;
  let selected = 0;
  let drag = null;
  let lastTime = 0;
  let raf = 0;
  let destroyed = false;
  let suspended = document.hidden;
  let effects = [];
  let trails = new Map();
  let art = null;
  let floatImages = [];
  let reactions = new Map();
  let previewFrame = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const listeners = new AbortController();
  let observer;

  function toWorld(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * P.WIDTH / rect.width, y: (event.clientY - rect.top) * P.HEIGHT / rect.height };
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
  }

  function listen(target, type, handler, options = {}) {
    target.addEventListener(type, handler, { ...options, signal: listeners.signal });
  }

  function cancelAim() {
    const previous = drag;
    drag = null;
    if (previous && canvas.hasPointerCapture(previous.pointerId)) canvas.releasePointerCapture(previous.pointerId);
    canvas.classList.remove('aiming');
  }

  function reset() {
    cancelAim();
    world.reset($('layout').value);
    selected = 0;
    effects = [];
    trails = new Map();
    reactions.clear();
    lastTime = 0;
    syncControls();
  }

  function pointerDown(event) {
    if (event.button !== 0 || !event.isPrimary || world.moving || suspended || drag) return;
    const point = toWorld(event);
    const rings = world.snapshot();
    // Prefer physical floats; only then consider visible pixels on Juzi's head.
    const ring = rings.find(item => Math.hypot(item.x - point.x, item.y - point.y) <= P.RADIUS)
      || rings.find(item => item.id === 0 && art && art.contains(point.x - item.x, point.y - item.y));
    if (!ring) return;
    event.preventDefault();
    selected = ring.id;
    drag = { start: point, end: point, pointerId: event.pointerId };
    canvas.setPointerCapture(event.pointerId);
    canvas.focus({ preventScroll: true });
    canvas.classList.add('aiming');
    syncControls();
  }

  function pointerUp(event) {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const vector = P.launchVector(drag.start, toWorld(event), world.params.maxSpeed);
    cancelAim();
    if (vector.power > 0 && world.launch(selected, vector)) {
      trails = new Map();
      effects = [];
      reactions.clear();
    }
    syncControls();
  }

  function syncControls() {
    for (const key of Object.keys(P.DEFAULTS)) {
      $(key).value = world.params[key];
      $(`${key}-value`).value = key === 'maxSpeed' ? `${world.params[key]} px/s` : world.params[key].toFixed(2);
    }
    const ring = world.snapshot().find(item => item.id === selected);
    $('mass').value = ring ? ring.mass : 1;
    $('mass-value').value = `${(ring ? ring.mass : 1).toFixed(2)}×`;
    $('selected-name').textContent = I.t(`character.${selected}`);
    $('selected-name').style.color = colors[selected].dark;
    $('layout-note').textContent = I.t(`note.${world.layout}`);
    $('juzi-card').hidden = selected !== 0;
    $('art-note').textContent = I.t(art ? 'ui.artNote' : 'ui.artMissing');
    drawPreview();
    updateStatus();
  }

  function drawPreview() {
    const preview = $('character-preview');
    const context = preview.getContext('2d');
    context.clearRect(0, 0, preview.width, preview.height);
    context.save(); context.translate(96, 128); context.scale(1.25, 1.25);
    context.imageSmoothingEnabled = false;
    context.drawImage(floatImages[0], -P.RADIUS, -P.RADIUS, P.RADIUS * 2, P.RADIUS * 2);
    if (art) art.draw(context, previewFrame);
    context.restore();
    document.querySelectorAll('[data-pose]').forEach(button => {
      button.setAttribute('aria-pressed', Number(button.dataset.pose) === previewFrame);
      button.disabled = !art;
    });
  }

  function updateStatus() {
    const state = world.fault ? 'error' : suspended ? 'paused' : drag ? 'aiming' : world.moving ? 'moving' : world.elapsed > 0 ? 'settled' : 'idle';
    $('state').textContent = I.t(`state.${state}`);
    $('state').dataset.state = world.moving ? 'moving' : 'idle';
    $('tuning-fields').disabled = world.moving;
    canvas.classList.toggle('moving', world.moving);
    $('collision-count').textContent = world.count;
    $('shot-time').textContent = `${world.elapsed.toFixed(1)} s`;
    $('speed').textContent = `${Math.round(world.maxSpeed)} px/s`;
    const power = drag ? P.launchVector(drag.start, drag.end, world.params.maxSpeed).power : 0;
    $('power-value').textContent = `${Math.round(power * 100)}%`;
    $('power-fill').style.width = `${power * 100}%`;
    $('power-meter').setAttribute('aria-valuenow', Math.round(power * 100));
    $('pause-cover').hidden = !suspended;
  }

  function roundRect(x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function circle(x, y, radius, fill, stroke) {
    ctx.beginPath(); ctx.arc(x, y, radius, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function drawPool() {
    ctx.fillStyle = '#e7eff0'; ctx.fillRect(0, 0, P.WIDTH, P.HEIGHT);
    ctx.lineWidth = 1; ctx.strokeStyle = '#d5e2e6';
    for (let x = 0; x < P.WIDTH; x += 32) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, P.HEIGHT); ctx.stroke(); }
    for (let y = 0; y < P.HEIGHT; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(P.WIDTH, y); ctx.stroke(); }
    roundRect(15, 19, 930, 572, 30, '#92bcca');
    roundRect(15, 12, 930, 572, 30, '#70b5d1');
    roundRect(27, 25, 906, 546, 20, '#eaf9fb');
    ctx.fillStyle = '#79cbdc'; ctx.fillRect(44, 44, 872, 512);
    ctx.fillStyle = '#9fdfE7'; ctx.fillRect(48, 48, 864, 504);
    ctx.strokeStyle = '#d2f5f4'; ctx.lineWidth = 1; ctx.globalAlpha = 0.37;
    for (let x = 72; x < 916; x += 52) { ctx.beginPath(); ctx.moveTo(x, 48); ctx.lineTo(x, 552); ctx.stroke(); }
    for (let y = 72; y < 556; y += 52) { ctx.beginPath(); ctx.moveTo(48, y); ctx.lineTo(912, y); ctx.stroke(); }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#b5e9ee';
    for (const [x, y] of [[120, 100], [820, 160], [390, 470], [590, 120], [140, 460]]) {
      ctx.fillRect(x - 5, y - 1, 10, 2); ctx.fillRect(x - 1, y - 5, 2, 10);
    }
    ctx.strokeStyle = '#70b8cf'; ctx.lineWidth = 5;
    for (let x = 150; x < 900; x += 180) {
      ctx.beginPath(); ctx.moveTo(x, 14); ctx.lineTo(x, 39); ctx.moveTo(x, 561); ctx.lineTo(x, 580); ctx.stroke();
    }
    ctx.strokeStyle = '#f8ffff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(60, 34); ctx.lineTo(890, 34); ctx.stroke();
  }

  function drawRing(ring) {
    const palette = colors[ring.id];
    ctx.save(); ctx.translate(Math.round(ring.x / 2) * 2, Math.round(ring.y / 2) * 2);
    circle(0, 6, P.RADIUS + 2, '#39799225');
    if (ring.id === selected && !world.moving) {
      ctx.lineWidth = 2; ctx.setLineDash([4, 5]);
      circle(0, 0, P.RADIUS + 8, null, '#467c9b'); ctx.setLineDash([]);
    }
    const reaction = reactions.get(ring.id);
    const pose = A.reactionAt(reaction ? reaction.age : 1, reaction ? reaction.strength : 0, reducedMotion);
    const angle = reaction ? reaction.angle : 0;
    const drawFloat = frontOnly => {
      ctx.save(); ctx.rotate(angle); ctx.scale(pose.along, pose.across); ctx.rotate(-angle);
      ctx.imageSmoothingEnabled = false;
      if (frontOnly) ctx.drawImage(floatImages[ring.id], 0, 25, 32, 7,
        -P.RADIUS, P.RADIUS * 0.5625, P.RADIUS * 2, P.RADIUS * 0.4375);
      else ctx.drawImage(floatImages[ring.id], -P.RADIUS, -P.RADIUS, P.RADIUS * 2, P.RADIUS * 2);
      ctx.restore();
    };
    drawFloat(false);
    if (ring.id === 0 && art) {
      art.draw(ctx, pose.frame, pose.lean * (Math.cos(angle) >= 0 ? 1 : -1));
      drawFloat(true);
    } else {
      ctx.lineWidth = 1.5; circle(0, 0, 13, '#fffaf0', palette.dark);
      if (pose.frame === 1) {
        ctx.strokeStyle = palette.dark; ctx.beginPath();
        ctx.moveTo(-7, -4); ctx.lineTo(-3, -1); ctx.lineTo(-7, 2);
        ctx.moveTo(7, -4); ctx.lineTo(3, -1); ctx.lineTo(7, 2); ctx.stroke();
      } else {
        circle(-4, -1, 1.6, palette.dark); circle(4, -1, 1.6, palette.dark);
      }
      ctx.beginPath(); ctx.moveTo(-3, 5); ctx.lineTo(0, 7); ctx.lineTo(3, 5); ctx.strokeStyle = palette.dark; ctx.stroke();
    }
    const name = I.t(`character.${ring.id}`);
    ctx.font = '600 13px "Segoe UI", "Microsoft YaHei", sans-serif';
    const width = ctx.measureText(name).width + 20;
    roundRect(-width / 2, P.RADIUS + 9, width, 23, 7, '#f9ffffe8');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = palette.dark; ctx.fillText(name, 0, P.RADIUS + 21);
    ctx.restore();
  }

  function drawAim(rings) {
    if (!drag) return;
    const vector = P.launchVector(drag.start, drag.end, world.params.maxSpeed);
    if (!vector.power) return;
    const origin = rings.find(ring => ring.id === selected);
    const contact = P.firstContact(origin, vector, rings, selected);
    if (!contact) return;
    const d = contact.direction;
    ctx.save(); ctx.strokeStyle = '#335e80'; ctx.lineWidth = 2; ctx.setLineDash([6, 7]); ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(contact.x, contact.y); ctx.stroke();
    circle(contact.x, contact.y, P.RADIUS, null, '#416d89');
    if (contact.type === 'wall') {
      const dot = d.x * contact.normal.x + d.y * contact.normal.y;
      const reflected = { x: d.x - 2 * dot * contact.normal.x, y: d.y - 2 * dot * contact.normal.y };
      const next = P.firstContact({ x: contact.x + reflected.x * 0.01, y: contact.y + reflected.y * 0.01 }, reflected, rings, selected);
      const length = Math.min(130, next ? next.distance : 130);
      ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(contact.x, contact.y);
      ctx.lineTo(contact.x + reflected.x * length, contact.y + reflected.y * length); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.strokeStyle = '#3a7496'; ctx.lineWidth = 5;
    const length = (selected === 0 && art ? 96 : P.RADIUS + 15) + vector.power * 70;
    const end = { x: origin.x + d.x * length, y: origin.y + d.y * length };
    ctx.beginPath(); ctx.moveTo(origin.x + d.x * (P.RADIUS + 7), origin.y + d.y * (P.RADIUS + 7)); ctx.lineTo(end.x, end.y); ctx.stroke();
    ctx.fillStyle = '#3a7496'; ctx.beginPath(); ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - d.x * 12 - d.y * 7, end.y - d.y * 12 + d.x * 7);
    ctx.lineTo(end.x - d.x * 12 + d.y * 7, end.y - d.y * 12 - d.x * 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(canvas.width / P.WIDTH, 0, 0, canvas.height / P.HEIGHT, 0, 0);
    ctx.clearRect(0, 0, P.WIDTH, P.HEIGHT);
    drawPool();
    for (const points of trails.values()) {
      if (points.length < 2) continue;
      ctx.strokeStyle = '#f1ffff'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.globalAlpha = 0.3;
      ctx.beginPath(); points.forEach((point, index) => index ? ctx.lineTo(point.x, point.y) : ctx.moveTo(point.x, point.y)); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const effect of effects) {
      ctx.globalAlpha = Math.max(0, 1 - effect.age / 0.55);
      ctx.lineWidth = 2; circle(effect.x, effect.y, 5 + effect.age * 42, null, '#fffef6');
      const strength = Math.min(1, effect.speed / 1400);
      const drops = reducedMotion ? 3 : 4 + Math.round(strength * 4);
      const direction = Math.atan2(effect.normal.y, effect.normal.x);
      for (let i = 0; i < drops; i += 1) {
        const angle = direction + Math.PI * 2 * i / drops;
        const distance = 6 + effect.age * (reducedMotion ? 16 : 24 + 35 * strength);
        const size = strength > 0.6 ? 4 : 3;
        ctx.fillStyle = '#f4ffff'; ctx.fillRect(effect.x + Math.cos(angle) * distance, effect.y + Math.sin(angle) * distance, size, size);
      }
    }
    ctx.globalAlpha = 1;
    const rings = world.snapshot();
    drawAim(rings);
    rings.sort((a, b) => a.y - b.y || a.id - b.id).forEach(drawRing);
    if ($('show-hitboxes').checked) {
      ctx.save(); ctx.strokeStyle = '#bd526b'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      rings.forEach(ring => { circle(ring.x, ring.y, P.RADIUS, null, '#bd526b'); });
      ctx.restore();
    }
  }

  function frame(time) {
    if (destroyed) return;
    const dt = lastTime ? Math.min(time - lastTime, 100) : 0;
    lastTime = time;
    if (!suspended) {
      for (const [id, reaction] of reactions) {
        reaction.age += dt / 1000;
        if (reaction.age >= 0.48) reactions.delete(id);
      }
      const wasMoving = world.moving;
      world.advance(dt);
      for (const impact of world.drainImpacts()) {
        effects.push({ ...impact, age: 0 });
        for (const id of impact.ringIds) reactions.set(id, {
          age: 0, strength: Math.min(1, impact.speed / 1000),
          angle: Math.atan2(impact.normal.y, impact.normal.x),
        });
      }
      effects = effects.map(item => ({ ...item, age: item.age + dt / 1000 })).filter(item => item.age < 0.55).slice(-35);
      if (world.moving) {
        for (const ring of world.snapshot()) {
          const points = trails.get(ring.id) || [];
          points.push({ x: ring.x, y: ring.y });
          trails.set(ring.id, points.slice(-16));
        }
      } else {
        trails.clear();
      }
      if (wasMoving !== world.moving) syncControls();
    }
    updateStatus(); draw();
    raf = requestAnimationFrame(frame);
  }

  function suspend(value) {
    cancelAim();
    suspended = value;
    lastTime = 0;
    world.accumulator = 0;
    updateStatus();
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAim();
    cancelAnimationFrame(raf);
    listeners.abort();
    observer.disconnect();
    world.destroy();
  }

  async function boot() {
    await I.init();
    floatImages = colors.map(A.floatImage);
    try { art = await A.load(); } catch { /* Keep the collision playground available without the sprite. */ }
    world = new P.PoolWorld();
    $('workspace').hidden = false;
    observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    listen(canvas, 'pointerdown', pointerDown);
    listen(canvas, 'pointermove', event => { if (drag && event.pointerId === drag.pointerId) drag.end = toWorld(event); });
    listen(canvas, 'pointerup', pointerUp);
    listen(canvas, 'pointercancel', cancelAim);
    listen(canvas, 'lostpointercapture', cancelAim);
    listen(canvas, 'contextmenu', event => { event.preventDefault(); cancelAim(); });
    listen(window, 'keydown', event => { if (event.key === 'Escape') cancelAim(); });
    listen(window, 'blur', cancelAim);
    listen(document, 'visibilitychange', () => suspend(document.hidden));
    listen(window, 'pagehide', event => event.persisted ? suspend(true) : destroy());
    listen(window, 'pageshow', () => { if (!destroyed) suspend(document.hidden); });
    listen($('reset'), 'click', reset);
    listen($('layout'), 'change', reset);
    document.querySelectorAll('[data-pose]').forEach(button => listen(button, 'click', () => {
      previewFrame = Number(button.dataset.pose);
      drawPreview();
    }));
    for (const key of Object.keys(P.DEFAULTS)) {
      listen($(key), 'input', () => { world.setParams({ [key]: Number($(key).value) }); syncControls(); });
    }
    listen($('mass'), 'input', () => { world.setMass(selected, Number($('mass').value)); syncControls(); });
    listen($('defaults'), 'click', () => {
      world.setParams(P.DEFAULTS);
      for (const ring of world.snapshot()) world.setMass(ring.id, 1);
      syncControls();
    });
    listen($('language'), 'change', async () => {
      $('language').disabled = true;
      try { await I.load($('language').value); syncControls(); }
      catch { $('language').value = I.locale; }
      finally { $('language').disabled = false; }
    });
    window.miaoPlayground = Object.freeze({ snapshot: () => ({
      selected, layout: world.layout, moving: world.moving, aiming: Boolean(drag), suspended,
      elapsed: world.elapsed, collisions: world.count, fault: world.fault,
      params: { ...world.params }, rings: world.snapshot(), destroyed,
      art: {
        loaded: Boolean(art), frameCount: art ? art.metadata.frames.length : 0, previewFrame,
        pixelGrid: art ? art.metadata.pixelGrid : null, collisionRadius: P.RADIUS,
        activeFrame: A.reactionAt(reactions.get(0)?.age ?? 1).frame,
        reactingIds: [...reactions.keys()], showBoundaries: $('show-hitboxes').checked,
      },
    }) });
    syncControls();
    raf = requestAnimationFrame(frame);
  }

  boot().catch(() => {
    $('load-error').hidden = false;
    $('load-error').textContent = I.t('ui.loadError') === 'ui.loadError'
      ? 'Unable to load the playground. Please reload this page.' : I.t('ui.loadError');
  });
})();
