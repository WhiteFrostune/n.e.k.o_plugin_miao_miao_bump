(function () {
  'use strict';
  const P = window.MiaoPhysics;
  const mapChoice = window.MiaoMaps.resolve(new URLSearchParams(location.search).get('map') || window.MiaoMaps.DEFAULT_ID);
  const map = mapChoice.map;
  const { width: WIDTH, height: HEIGHT } = map.world;
  const I = window.MiaoI18n;
  const A = window.MiaoArt;
  const B = window.MiaoBattle;
  const S = window.MiaoSound;
  const $ = id => document.getElementById(id);
  const canvas = $('pool');
  const ctx = canvas.getContext('2d');
  const colors = [
    { main: '#eea449', dark: '#b8793e', light: '#fff0ca' },
    { main: '#edca60', dark: '#a88642', light: '#fff6cf' },
    { main: '#b6a5dc', dark: '#8d7caf', light: '#f1ebff' },
  ];
  let world;
  let match = null;
  let aiWait = 0;
  let combatEffects = [];
  let retreats = [];
  let selected = 0;
  let drag = null;
  let lastTime = 0;
  let raf = 0;
  let destroyed = false;
  let suspended = document.hidden;
  let effects = [];
  let trails = new Map();
  const characterKeys = ['juzi', 'pudding', 'milkcap'];
  let art = [null, null, null];
  let poolArt = null;
  let floatImages = [];
  let reactions = new Map();
  let previewFrame = 0;
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const listeners = new AbortController();
  let observer;

  function toWorld(event) {
    const rect = canvas.getBoundingClientRect();
    return { x: (event.clientX - rect.left) * WIDTH / rect.width, y: (event.clientY - rect.top) * HEIGHT / rect.height };
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
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    if ($('game-mode').value === 'battle') {
      if (!match) { if (world) world.destroy(); match = new B.Match({ map }); }
      else match.reset();
      world = match.world;
    } else {
      if (match) { match.destroy(); match = null; world = null; }
      if (!world) world = new P.PoolWorld({ map });
      world.reset($('layout').value);
    }
    selected = 0;
    effects = [];
    combatEffects = [];
    retreats = [];
    aiWait = 0;
    trails = new Map();
    reactions.clear();
    lastTime = 0;
    syncControls();
  }

  function pointerDown(event) {
    if (event.button !== 0 || !event.isPrimary || world.moving || suspended || drag) return;
    if (match && (match.phase !== 'ready' || match.side !== 0)) return;
    const point = toWorld(event);
    const rings = world.snapshot();
    // Prefer physical floats; visible character pixels follow front-to-back drawing order.
    const ring = rings.find(item => Math.hypot(item.x - point.x, item.y - point.y) <= P.RADIUS)
      || rings.slice().sort((a, b) => b.y - a.y || b.id - a.id)
        .find(item => art[item.id % 3]?.contains(point.x - item.x, point.y - item.y));
    if (!ring) return;
    if (match && !match.canLaunch(ring.id)) return;
    S.unlock();
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
    if (vector.power > 0) launchShot(selected, vector);
    syncControls();
  }

  function launchShot(id, vector) {
    if (match ? match.launch(id, vector) : world.launch(id, vector)) {
      selected = id;
      trails = new Map();
      effects = [];
      reactions.clear();
      aiWait = 0;
      S.play('launch');
      return true;
    }
    return false;
  }

  function syncControls() {
    for (const key of Object.keys(P.DEFAULTS)) {
      $(key).value = world.params[key];
      $(`${key}-value`).value = key === 'maxSpeed' ? `${world.params[key]} px/s` : world.params[key].toFixed(2);
    }
    const ring = world.snapshot().find(item => item.id === selected);
    $('mass').value = ring ? ring.mass : 1;
    $('mass-value').value = `${(ring ? ring.mass : 1).toFixed(2)}×`;
    const role = selected % 3;
    const cat = match?.actors.find(item => item.id === selected);
    $('selected-name').textContent = `${cat ? (cat.team === 0 ? '◆ ' : '● ') : ''}${I.t(`character.${role}`)}`;
    $('selected-name').style.color = cat?.team === 1 ? '#a15e67' : colors[role].dark;
    $('selected-stats').textContent = cat ? `${I.t('battle.hp')} ${cat.hp}/${cat.maxHp} · ${I.t('battle.attack')} ${cat.attack}` : '';
    if (cat) $('selected-stats').textContent += ` · ${I.t(cat.hp <= 0 ? 'battle.defeated' : cat.usedThisRound ? 'battle.acted' : 'battle.available')}`;
    $('selected-skill').hidden = !match;
    $('selected-skill').textContent = match ? `${I.t(`skill.${role}.name`)} · ${I.t(`skill.${role}.brief`)}` : '';
    $('character-stats').textContent = $('selected-stats').textContent;
    $('skill-description').textContent = match ? I.t(`skill.${role}.description`) : I.t('battle.practiceNote');
    $('layout-wrap').hidden = Boolean(match);
    $('layout').disabled = Boolean(match);
    $('tuning-note').textContent = I.t(match ? 'battle.tuningNote' : 'ui.tuningHint');
    $('reset').textContent = I.t(match ? 'battle.restart' : 'ui.reset');
    $('play-hint').textContent = I.t(match ? 'battle.hint' : 'ui.hint');
    $('sound-toggle').textContent = I.t(S.enabled ? 'ui.soundOn' : 'ui.soundOff');
    $('sound-toggle').setAttribute('aria-pressed', S.enabled);
    $('layout-note').textContent = I.t(`note.${world.layout}`);
    $('art-title').textContent = `${I.t('ui.artStudy')} · ${I.t(`character.${role}`)}`;
    $('art-note').textContent = I.t(art[role] ? 'ui.artNote' : 'ui.artMissing');
    drawPreview();
    updateStatus();
  }

  function drawPreview() {
    const preview = $('character-preview');
    const context = preview.getContext('2d');
    context.clearRect(0, 0, preview.width, preview.height);
    context.save(); context.translate(96, 128); context.scale(1.25, 1.25);
    context.imageSmoothingEnabled = false;
    const role = selected % 3;
    context.drawImage(floatImages[role], -P.RADIUS, -P.RADIUS, P.RADIUS * 2, P.RADIUS * 2);
    if (art[role]) art[role].draw(context, previewFrame);
    context.restore();
    document.querySelectorAll('[data-pose]').forEach(button => {
      button.setAttribute('aria-pressed', Number(button.dataset.pose) === previewFrame);
      button.disabled = !art[role];
    });
  }

  function updateStatus() {
    let state = world.fault ? 'error' : suspended ? 'paused' : drag ? 'aiming' : world.moving ? 'moving' : world.elapsed > 0 ? 'settled' : 'idle';
    if (match && !world.fault && !suspended && !drag) {
      state = match.phase === 'over' ? (match.winner === 0 ? 'win' : match.winner === 1 ? 'lose' : 'draw')
        : world.moving ? (match.side === 0 ? 'playerMoving' : 'enemyMoving') : match.side === 0 ? 'playerTurn' : 'enemyTurn';
    }
    const status = I.t(`state.${state}`);
    if ($('state').textContent !== status) $('state').textContent = status;
    $('state').dataset.state = world.moving ? 'moving' : 'idle';
    $('tuning-fields').disabled = world.moving || Boolean(match);
    canvas.classList.toggle('moving', world.moving);
    $('team-status').hidden = !match;
    $('round-status').hidden = !match;
    if (match) {
      $('round-status').textContent = `${I.t('battle.round')} ${match.round} · ${I.t(match.roundStarter === 0 ? 'battle.ally' : 'battle.enemy')} ${I.t('battle.first')}`;
      $('team-status').textContent = `${I.t('battle.actionsLeft')} ◆ ${match.available(0).length} · ● ${match.available(1).length}`;
    }
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
    if (poolArt) poolArt.draw(ctx);
    else A.drawPoolFallback(ctx, map);
  }

  function drawRing(ring, ghost = false) {
    const role = ring.id % 3;
    const palette = colors[role];
    const cat = match?.actors.find(item => item.id === ring.id);
    ctx.save(); ctx.translate(Math.round(ring.x / 2) * 2, Math.round(ring.y / 2) * 2);
    if (ghost) ctx.globalAlpha = Math.max(0, 1 - ring.age / 0.5);
    else if (cat && cat.hp <= 0) ctx.globalAlpha = 0.45;
    circle(0, 6, P.RADIUS + 2, '#39799225');
    if (ring.id === selected && !world.moving && (!match || match.canLaunch(ring.id))) {
      ctx.lineWidth = 2; ctx.setLineDash([4, 5]);
      circle(0, 0, P.RADIUS + 8, null, '#467c9b'); ctx.setLineDash([]);
    }
    const reaction = reactions.get(ring.id);
    const pose = A.reactionAt(cat?.hp === 0 ? 0 : reaction ? reaction.age : 1, reaction ? reaction.strength : 0, reducedMotion);
    const angle = reaction ? reaction.angle : 0;
    const drawFloat = frontOnly => {
      ctx.save(); ctx.rotate(angle); ctx.scale(pose.along, pose.across); ctx.rotate(-angle);
      ctx.imageSmoothingEnabled = false;
      if (frontOnly) ctx.drawImage(floatImages[role], 0, 25, 32, 7,
        -P.RADIUS, P.RADIUS * 0.5625, P.RADIUS * 2, P.RADIUS * 0.4375);
      else ctx.drawImage(floatImages[role], -P.RADIUS, -P.RADIUS, P.RADIUS * 2, P.RADIUS * 2);
      ctx.restore();
    };
    drawFloat(false);
    if (art[role]) {
      art[role].draw(ctx, pose.frame, pose.lean * (Math.cos(angle) >= 0 ? 1 : -1));
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
    const name = `${cat ? (cat.team === 0 ? '◆ ' : '● ') : ''}${I.t(`character.${role}`)}${cat?.usedThisRound && cat.hp > 0 ? ' ✓' : ''}`;
    ctx.font = '600 13px "Segoe UI", "Microsoft YaHei", sans-serif';
    const width = ctx.measureText(name).width + 20;
    roundRect(-width / 2, P.RADIUS + 9, width, 23, 7, '#f9ffffe8');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = cat ? (cat.team === 0 ? '#336b94' : '#a14d62') : palette.dark;
    ctx.fillText(name, 0, P.RADIUS + 21);
    if (cat && !ghost) {
      const hpY = Math.max(-108, 8 - ring.y);
      ctx.fillStyle = '#fff9ef'; ctx.fillRect(-31, hpY, 62, 10);
      ctx.fillStyle = '#dbe2e7'; ctx.fillRect(-29, hpY + 2, 58, 6);
      ctx.fillStyle = cat.team === 0 ? '#4186b4' : '#ca7385';
      ctx.fillRect(-29, hpY + 2, Math.round(58 * cat.hp / cat.maxHp), 6);
      if (cat.hp === 0) { ctx.fillStyle = '#59667d'; ctx.font = 'bold 18px sans-serif'; ctx.fillText('×', 0, hpY + 18); }
    }
    ctx.restore();
  }

  function drawAim(rings) {
    if (!drag) return;
    const vector = P.launchVector(drag.start, drag.end, world.params.maxSpeed);
    if (!vector.power) return;
    const origin = rings.find(ring => ring.id === selected);
    const contact = P.firstContact(origin, vector, rings, selected, map);
    if (!contact) return;
    const d = contact.direction;
    ctx.save(); ctx.strokeStyle = '#335e80'; ctx.lineWidth = 2; ctx.setLineDash([6, 7]); ctx.globalAlpha = 0.6;
    ctx.beginPath(); ctx.moveTo(origin.x, origin.y); ctx.lineTo(contact.x, contact.y); ctx.stroke();
    circle(contact.x, contact.y, P.RADIUS, null, '#416d89');
    if (contact.type === 'wall') {
      const dot = d.x * contact.normal.x + d.y * contact.normal.y;
      const reflected = { x: d.x - 2 * dot * contact.normal.x, y: d.y - 2 * dot * contact.normal.y };
      const next = P.firstContact({ x: contact.x + reflected.x * 0.01, y: contact.y + reflected.y * 0.01 }, reflected, rings, selected, map);
      const length = Math.min(130, next ? next.distance : 130);
      ctx.globalAlpha = 0.35; ctx.beginPath(); ctx.moveTo(contact.x, contact.y);
      ctx.lineTo(contact.x + reflected.x * length, contact.y + reflected.y * length); ctx.stroke();
    }
    ctx.setLineDash([]); ctx.globalAlpha = 1; ctx.strokeStyle = '#3a7496'; ctx.lineWidth = 5;
    const length = (art[selected % 3] ? 96 : P.RADIUS + 15) + vector.power * 70;
    const end = { x: origin.x + d.x * length, y: origin.y + d.y * length };
    ctx.beginPath(); ctx.moveTo(origin.x + d.x * (P.RADIUS + 7), origin.y + d.y * (P.RADIUS + 7)); ctx.lineTo(end.x, end.y); ctx.stroke();
    ctx.fillStyle = '#3a7496'; ctx.beginPath(); ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - d.x * 12 - d.y * 7, end.y - d.y * 12 + d.x * 7);
    ctx.lineTo(end.x - d.x * 12 + d.y * 7, end.y - d.y * 12 - d.x * 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
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
    rings.sort((a, b) => a.y - b.y || a.id - b.id).forEach(ring => drawRing(ring));
    for (const ghost of retreats) drawRing(ghost, true);
    for (const effect of combatEffects) {
      ctx.save(); ctx.globalAlpha = Math.max(0, 1 - effect.age / 1.1);
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.font = 'bold 20px "Segoe UI", "Microsoft YaHei", sans-serif';
      ctx.lineWidth = 4; ctx.strokeStyle = '#fffef6';
      const text = `−${effect.damage}`;
      const x = Math.max(72, Math.min(WIDTH - 72, effect.x));
      const y = Math.max(64, effect.y - 120 - effect.age * 30);
      ctx.strokeText(text, x, y); ctx.fillStyle = '#ad4d61'; ctx.fillText(text, x, y);
      if (effect.guard) {
        ctx.font = 'bold 12px "Segoe UI", "Microsoft YaHei", sans-serif';
        ctx.fillStyle = '#6355a8'; ctx.fillText(I.t('battle.guard'), x, y + 22);
      }
      ctx.restore();
    }
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
      const previousPhase = match?.phase;
      if (match) match.advance(dt); else world.advance(dt);
      for (const impact of world.drainImpacts()) {
        effects.push({ ...impact, age: 0 });
        for (const id of impact.ringIds) reactions.set(id, {
          age: 0, strength: Math.min(1, impact.speed / 1000),
          angle: Math.atan2(impact.normal.y, impact.normal.x),
        });
        S.play('hit', impact.speed / 1600);
      }
      let combatChanged = false;
      for (const event of match?.drainEvents() || []) {
        if (event.type === 'damage') {
          const ring = world.snapshot().find(item => item.id === event.id);
          if (ring) combatEffects.push({ ...event, x: ring.x, y: ring.y, age: 0 });
          for (const id of [event.id, event.attacker]) {
            const previous = reactions.get(id);
            reactions.set(id, { age: 0, strength: previous?.strength ?? 0.3, angle: previous?.angle ?? 0 });
          }
          if (event.guard) S.play('guard');
          combatChanged = true;
        } else if (event.type === 'retreat') retreats.push({ ...event, age: 0 });
        else if (event.type === 'result') {
          $('result-title').textContent = I.t(`state.${event.winner === 0 ? 'win' : event.winner === 1 ? 'lose' : 'draw'}`);
          $('result-note').textContent = I.t('battle.resultNote');
          $('result-dialog').showModal();
          S.play('result');
        }
      }
      combatEffects = combatEffects.map(item => ({ ...item, age: item.age + dt / 1000 })).filter(item => item.age < 1.1).slice(-16);
      retreats = retreats.map(item => ({ ...item, age: item.age + dt / 1000 })).filter(item => item.age < 0.5);
      if (match?.phase === 'ready' && match.side === 1 && !document.querySelector('dialog[open]')) {
        aiWait += dt / 1000;
        if (aiWait >= 0.55) {
          const shot = B.chooseShot(match.snapshot(), world.params);
          if (shot) { launchShot(shot.id, shot); combatChanged = true; }
        }
      }
      if (match?.phase === 'ready' && match.side === 0 && !match.canLaunch(selected)) {
        selected = match.available(0)[0]?.id ?? selected;
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
      if (wasMoving !== world.moving || previousPhase !== match?.phase || combatChanged) syncControls();
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
    S.destroy();
  }

  async function boot() {
    await I.init();
    document.querySelector('.canvas-wrap').style.setProperty('--pool-ratio', WIDTH / HEIGHT);
    document.querySelector('.canvas-wrap').style.setProperty('--pool-height-width', `${100 * WIDTH / HEIGHT}cqh`);
    $('map-note').hidden = !mapChoice.fallback;
    floatImages = colors.map(A.floatImage);
    const loaded = await Promise.allSettled([
      ...characterKeys.map(key => A.load(key)), A.loadPool(map),
    ]);
    // An unavailable character falls back independently; other sprites remain usable.
    art = loaded.slice(0, characterKeys.length).map(result => result.status === 'fulfilled' ? result.value : null);
    poolArt = loaded[characterKeys.length].status === 'fulfilled' ? loaded[characterKeys.length].value : null;
    $('game-mode').value = new URLSearchParams(location.search).get('mode') === 'practice' ? 'practice' : 'battle';
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
    listen($('play-again'), 'click', reset);
    listen($('game-mode'), 'change', reset);
    listen($('sound-toggle'), 'click', () => { S.toggle(); syncControls(); });
    listen($('layout'), 'change', reset);
    for (const [button, panel] of [['show-art', 'art-dialog'], ['show-tuning', 'tuning-dialog']]) {
      listen($(button), 'click', () => { cancelAim(); $(panel).showModal(); });
    }
    document.querySelectorAll('[data-close]').forEach(button => listen(button, 'click', () => {
      $(button.dataset.close).close();
    }));
    document.querySelectorAll('[data-pose]').forEach(button => listen(button, 'click', () => {
      previewFrame = Number(button.dataset.pose);
      drawPreview();
    }));
    for (const key of Object.keys(P.DEFAULTS)) {
      listen($(key), 'input', () => { if (!match) world.setParams({ [key]: Number($(key).value) }); syncControls(); });
    }
    listen($('mass'), 'input', () => { if (!match) world.setMass(selected, Number($('mass').value)); syncControls(); });
    listen($('defaults'), 'click', () => {
      if (match) return;
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
      mode: match ? 'battle' : 'practice', battle: match ? match.snapshot() : null,
      elapsed: world.elapsed, collisions: world.count, fault: world.fault,
      params: { ...world.params }, rings: world.snapshot(), destroyed,
      map: { id: map.id, nameKey: map.nameKey, requestedId: mapChoice.requestedId, fallback: mapChoice.fallback,
        loaded: Boolean(poolArt), width: WIDTH, height: HEIGHT, bounds: { ...map.world.bounds },
        spawns: map.spawns, spawnRegions: map.spawnRegions },
      art: {
        loaded: Boolean(art[0]), frameCount: art[0] ? art[0].metadata.frames.length : 0, previewFrame,
        pixelGrid: art[0] ? art[0].metadata.pixelGrid : null, collisionRadius: P.RADIUS,
        characters: characterKeys.map((key, id) => ({
          id, key, loaded: Boolean(art[id]), frameCount: art[id]?.metadata.frames.length ?? 0,
          activeFrame: A.reactionAt(reactions.get(id)?.age ?? 1).frame,
        })),
        activeFrame: A.reactionAt(reactions.get(0)?.age ?? 1).frame,
        reactingIds: [...reactions.keys()], showBoundaries: $('show-hitboxes').checked,
      },
    }) });
    reset();
    raf = requestAnimationFrame(frame);
  }

  boot().catch(() => {
    $('load-error').hidden = false;
    $('load-error').textContent = I.t('ui.loadError') === 'ui.loadError'
      ? 'Unable to load the playground. Please reload this page.' : I.t('ui.loadError');
  });
})();
