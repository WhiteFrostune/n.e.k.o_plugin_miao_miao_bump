(function () {
  'use strict';
  const P = window.MiaoPhysics;
  const mapChoice = window.MiaoMaps.resolve(new URLSearchParams(location.search).get('map') || window.MiaoMaps.DEFAULT_ID);
  const map = mapChoice.map;
  const { width: WIDTH, height: HEIGHT } = map.world;
  const I = window.MiaoI18n;
  const A = window.MiaoArt;
  const M = window.MiaoMotion;
  const LW = window.MiaoLandingWater, LWR = window.MiaoLandingWaterRenderer;
  const NC = window.MiaoContactFeedback;
  const WW = window.MiaoWaterWake, WWR = window.MiaoWaterWakeRenderer;
  const K = window.MiaoKnockoutAction;
  const KR = window.MiaoKnockoutRenderer;
  const U = window.MiaoUnseatAction, UR = window.MiaoUnseatRenderer, C = window.MiaoKnockoutCamera;
  const IM = window.MiaoUnseatMomentum;
  const IB = window.MiaoImpactBeat;
  const IC = window.MiaoImpactContact, ICR = window.MiaoImpactContactRenderer;
  const B = window.MiaoBattle;
  const lineupParams = new URLSearchParams(location.search);
  const fullPlaytest = document.documentElement.hasAttribute('data-full-playtest');
  // Test previews can load the game with a base URL pointing at the real page.
  const basePath = new URL(document.baseURI).pathname;
  const isMainPage = fullPlaytest || basePath === location.pathname || basePath === `${location.pathname}/`;
  const development = Boolean(document.getElementById('motion-mode'));
  const savePreviewChoices = development && !fullPlaytest;
  const previewParams = development ? lineupParams : new URLSearchParams();
  const traitDuration = { guard: 0.48, bounce: 0.32, heavy: 0.32 };
  // Development pages keep their explicit presentation profiles.
  const knockoutPreview = ['knockout', 'costume', 'camera', 'contact', 'flight', 'feedback', 'pace', 'camera-rate', 'chain']
    .some(key => previewParams.has(key));
  const allyRoster = lineupParams.get('ally')?.split(',');
  const rivalRoster = lineupParams.get('rival')?.split(',');
  const rolesBySlot = [...B.roleOrder(allyRoster), ...B.roleOrder(rivalRoster)];
  const S = window.MiaoSound;
  const $ = id => document.getElementById(id);
  const canvas = $('pool');
  const ctx = canvas.getContext('2d');
  const poolContext = ctx;
  const flightCanvas = $('knockout-layer');
  const flightContext = flightCanvas.getContext('2d');
  let flightView;
  const colors = [
    { main: '#eea449', dark: '#b8793e', light: '#fff0ca' },
    { main: '#edca60', dark: '#a88642', light: '#fff6cf' },
    { main: '#b6a5dc', dark: '#8d7caf', light: '#f1ebff' },
  ];
  let world;
  let match = null;
  const roleFor = id => match ? rolesBySlot[id] : id % 3;
  const paletteFor = role => colors[role] ?? colors[0];
  // Deliberately not persisted: a fresh page always starts with normal damage.
  let testOneHit = false;
  let aiWait = 0;
  const traitEffects = new Map();
  let retreats = [];
  const landings = new Map();
  const landingWaters = new Map();
  let cameraBeat = null;
  let impactBeat = null;
  let impactUsedThisAction = false;
  let cameraUsedThisAction = false;
  const continuousChain = previewParams.get('chain') !== 'legacy';
  const coordinatedChain = !['legacy','early'].includes(previewParams.get('chain'));
  const relayChain = !['legacy','early','coordinated'].includes(previewParams.get('chain'));
  const readableCameraRate = previewParams.get('camera-rate') === 'readable';
  const impactFeedback = knockoutPreview ? previewParams.get('feedback') === 'impact' : true;
  const impactPace = knockoutPreview ? previewParams.get('pace') : 'impact-read';
  let contactEnabled = knockoutPreview ? previewParams.get('contact') === 'accent' : true;
  const alignedFlight = knockoutPreview ? previewParams.get('flight') === 'aligned' : true;
  let contactEffects = [];
  let normalEffects = [];
  let selected = 0;
  let drag = null;
  let lastTime = 0;
  let raf = 0;
  let destroyed = false;
  let suspended = document.hidden;
  let effects = [];
  let waterWakes = WW.create();
  const characterKeys = B.ROLES.map(role => role.key);
  // Old sheets remain available independently of the new default art.
  const characterArtSet = previewParams.get('art') === 'classic' ? 'classic' : 'concept-v2';
  const knockoutArtSet = !knockoutPreview || previewParams.get('costume') === 'swim-v2' ? 'swim-v2' : 'classic';
  let art = [null, null, null];
  let poolArt = null;
  let floatImages = [];
  let reactions = new Map();
  let previewFrame = 0;
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const requestedMotion = previewParams.get('motion');
  let savedMotion;
  try { savedMotion = savePreviewChoices && localStorage.getItem('miao-bump-motion'); } catch { /* Private storage may be unavailable. */ }
  let motionState = M.resolveMotion(requestedMotion || savedMotion || (savePreviewChoices ? 'system' : 'full'), motionQuery.matches);
  let reducedMotion = motionState.reduced;
  let savedKnockout;
  try { savedKnockout=savePreviewChoices && localStorage.getItem('miao-bump-knockout'); } catch { /* In-page choice works without storage. */ }
  let knockoutVersion = previewParams.get('knockout') || savedKnockout || (knockoutPreview ? 'impact' : 'unseat-inertia');
  const knockoutVersions=['unseat-inertia','unseat-inertia-fixed','unseat','unseat-fixed','legacy'];
  knockoutVersion = knockoutVersions.includes(knockoutVersion) ? knockoutVersion : 'impact';
  let savedCamera;
  try { savedCamera=savePreviewChoices && localStorage.getItem('miao-bump-camera'); } catch { /* In-page choice still works. */ }
  const requestedCamera = previewParams.get('camera') || savedCamera || (knockoutPreview ? 'gentle' : 'release');
  let cameraStyle=['release','focus','quick'].includes(requestedCamera)?requestedCamera:'gentle';
  const listeners = new AbortController();
  let observer;
  let rosterStamp = '';
  const titleArt = $('title-art');
  const markTitleReady = () => { titleArt.parentElement.dataset.logoReady = String(titleArt.naturalWidth > 0); };
  titleArt.addEventListener('load', markTitleReady, { signal: listeners.signal });
  titleArt.addEventListener('error', markTitleReady, { signal: listeners.signal });
  if (titleArt.complete) markTitleReady();

  function buildScoreboard() {
    for (let id = 0; id < 6; id += 1) {
      const role = rolesBySlot[id];
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'cat-portrait'; button.dataset.id = id;
      const frame = document.createElement('span'); frame.className = 'portrait-frame';
      const portrait = document.createElement('canvas'); portrait.width = 48; portrait.height = 48;
      portrait.setAttribute('aria-hidden', 'true');
      const fallback = document.createElement('span'); fallback.className = 'portrait-fallback';
      fallback.setAttribute('aria-hidden', 'true');
      const mark = document.createElement('span'); mark.className = 'portrait-mark'; mark.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span'); label.className = 'portrait-label';
      if (art[role]) art[role].drawPortrait(portrait.getContext('2d'));
      portrait.hidden = !art[role]; fallback.hidden = Boolean(art[role]);
      frame.append(portrait, fallback, mark); button.append(frame, label);
      $(id < 3 ? 'ally-roster' : 'enemy-roster').append(button);
      listen(button, 'click', () => {
        if (suspended || drag || !match?.canLaunch(id) || match.side !== 0) return;
        cancelAim(); selected = id; syncControls();
      });
    }
  }

  function actorStatus(cat) {
    if (cat.removed || cat.hp <= 0) return 'waiting';
    if (landings.has(cat.id)) return 'entering';
    return cat.usedThisRound ? 'acted' : 'available';
  }

  function actorStatusLabel(cat) {
    const status = actorStatus(cat);
    return I.t(`battle.${status === 'waiting' ? 'defeated' : status}`);
  }

  function updateScoreboard() {
    $('scoreboard').dataset.mode = match ? 'battle' : 'practice';
    $('scoreboard').setAttribute('aria-label', I.t(match ? 'hud.scoreboard' : 'mode.practice'));
    for (const id of ['ally-panel', 'enemy-panel', 'round-status', 'target-status', 'first-status', 'team-status', 'score-status']) $(id).hidden = !match;
    if (!match) { rosterStamp = ''; return; }
    const stamp = [I.locale, match.round, match.side, match.phase, selected, suspended,
      ...match.scores, match.targetScore, ...match.actors.flatMap(cat => [cat.hp, cat.usedThisRound, cat.removed]),
      ...landings.keys()].join('|');
    if (stamp === rosterStamp) return;
    rosterStamp = stamp;
    $('scoreboard').dataset.side = match.side;
    $('scoreboard').dataset.phase = match.phase;
    $('round-status').textContent = `${I.t('battle.round')} ${match.round}`;
    $('first-status').textContent = `${I.t(match.roundStarter === 0 ? 'battle.ally' : 'battle.enemy')} · ${I.t('battle.first')}`;
    $('target-status').textContent = I.t('hud.target').replace('{score}', match.targetScore);
    $('team-status').textContent = `${I.t('battle.actionsLeft')} ◆ ${match.available(0).length} · ● ${match.available(1).length}`;
    $('score-status').textContent = `◆ ${match.scores[0]} : ${match.scores[1]} ● · ${I.t('battle.target')} ${match.targetScore}`;
    for (const [team, name] of [[0, 'ally'], [1, 'enemy']]) {
      $(`${name}-score`).textContent = match.scores[team];
      $(`${name}-actions`).textContent = I.t('hud.actions').replace('{count}', match.available(team).length);
    }
    document.querySelectorAll('.score-target').forEach(element => { element.textContent = `/ ${match.targetScore}`; });
    document.querySelectorAll('.cat-portrait').forEach(button => {
      const cat = match.actors[Number(button.dataset.id)];
      const waiting = cat.removed || cat.hp <= 0;
      const status = actorStatus(cat);
      const stateLabel = actorStatusLabel(cat);
      const character = I.t(`character.${cat.role}`);
      const description = `${I.t(cat.team === 0 ? 'battle.ally' : 'battle.enemy')} · ${character} · ${stateLabel} · ${I.t('battle.hp')} ${cat.hp}/${cat.maxHp}`;
      button.dataset.status = status;
      button.dataset.selected = selected === cat.id;
      button.setAttribute('aria-pressed', selected === cat.id);
      button.setAttribute('aria-label', description); button.title = description;
      button.disabled = cat.team !== 0 || suspended || !match.canLaunch(cat.id);
      button.querySelector('.portrait-label').textContent = waiting ? I.t('battle.defeated') : character;
      button.querySelector('.portrait-fallback').textContent = character;
      const mark = button.querySelector('.portrait-mark');
      mark.hidden = status === 'available'; mark.textContent = waiting ? '×' : status === 'entering' ? '…' : '✓';
    });
  }

  function toWorld(event) {
    const rect = canvas.getBoundingClientRect();
    return C.unproject({ x: (event.clientX - rect.left) * WIDTH / rect.width,
      y: (event.clientY - rect.top) * HEIGHT / rect.height },cameraProjection());
  }

  function cameraPoseAt(beat,age) {
    if(!beat)return {x:WIDTH/2,y:HEIGHT/2,zoom:1};
    const options={width:WIDTH,height:HEIGHT,origin:beat,direction:beat.direction,timing:beat.timing};
    if(beat.impactRead){
      const releaseAt=beat.track.config.releaseAt;
      const sceneAge=IB.sceneTime(age,beat.clockProfile);
      const body=IM.sample(beat.track,releaseAt*.78,beat.view).body;
      return C.release(age,{...options,origin:C.impactReadOrigin(beat,body,sceneAge,releaseAt)});
    }
    if(['gentle','focus','release'].includes(beat.style)){
      const {track,view}=beat,engine=track.inertia?IM:U;
      const followStart=beat.timing?.followAfterRelease?(track.config??engine.CONFIG).releaseAt:0;
      const start=engine.sample(track,followStart,view).body;
      const sceneAge=['focus','release'].includes(beat.style)?IB.sceneTime(age,beat.clockProfile??beat.style):age;
      const body=engine.sample(track,C.followTime(sceneAge,followStart),view).body;
      return (beat.style==='release'?C.release:beat.style==='focus'?C.focus:C.gentle)(age,
        {...options,follow:{x:body.x-start.x,y:body.y-start.y}});
    }
    return C.live(age,options);
  }

  function cameraProjectionAt(beat,age) {
    if(beat?.relay){
      const shot=beat.relay,t=age-shot.start;
      if(t<shot.holdUntil)return C.relay(shot.pan,t);
      return C.overview(shot.return,t-shot.holdUntil);
    }
    if(beat?.overview&&age>=beat.overview.start){
      return C.overview(beat.overview,age-beat.overview.start);
    }
    return C.projection(cameraPoseAt(beat,age),WIDTH,HEIGHT);
  }
  function cameraProjection(){return cameraProjectionAt(cameraBeat,cameraBeat?.age??0);}

  function relayCamera(event) {
    const age=cameraBeat.age,h=1e-5,from=cameraProjection();
    const next=cameraProjectionAt(cameraBeat,age+h);
    const velocity=Object.fromEntries(['scale','x','y'].map(k=>[k,(next[k]-from[k])/h]));
    const previous=cameraBeat.cluster;
    const clustered=previous&&age-previous.at<IB.RELAY.groupWindow;
    const count=clustered?previous.count+1:1;
    const origin={x:clustered?(previous.x*previous.count+event.x)/count:event.x,
      y:clustered?(previous.y*previous.count+event.y)/count:event.y};
    cameraBeat.cluster={...origin,count,at:age};
    const to=C.projection((cameraBeat.style==='release'?C.release:C.focus)(.3,
      {width:WIDTH,height:HEIGHT,origin,timing:cameraBeat.timing}),WIDTH,HEIGHT);
    const pan=C.createRelay(from,velocity,to,{width:WIDTH,height:HEIGHT,duration:.18});
    // Simultaneous hits share a composition. Later hits move its focus, then
    // hold through separation before the final pullback. No identity reset.
    cameraBeat.relay={start:age,pan,holdUntil:.42,
      return:C.createOverview(to,{},{width:WIDTH,height:HEIGHT,duration:.42})};
    delete cameraBeat.overview;
  }

  function handCameraToOverview() {
    if(!cameraBeat||cameraBeat.overview)return;
    // Keep the first unseating readable before widening for later knockouts.
    // Derive its wall time from the captured clock profile rather than mixing
    // the pose's scene seconds with the camera's real seconds.
    const release=cameraBeat.track.config?.releaseAt??
      (cameraBeat.track.inertia?IM.CONFIG.releaseAt:U.CONFIG.releaseAt);
    const timed=['focus','release'].includes(cameraBeat.style);
    const readableAt=(timed?IB.realTime(release,cameraBeat.clockProfile??cameraBeat.style):release)+.04;
    const start=Math.max(cameraBeat.age,coordinatedChain?readableAt:.09),h=1e-5;
    const from=C.projection(cameraPoseAt(cameraBeat,start),WIDTH,HEIGHT);
    const next=C.projection(cameraPoseAt(cameraBeat,start+h),WIDTH,HEIGHT);
    const velocity=Object.fromEntries(['scale','x','y'].map(k=>[k,(next[k]-from[k])/h]));
    cameraBeat.overview={...C.createOverview(from,velocity,{width:WIDTH,height:HEIGHT}),start};
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    // Chrome uses its own reference proportions. Resizing the map must never
    // feed back into header/footer width or their typography.
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(rect.width * dpr));
    canvas.height = Math.max(1, Math.round(rect.height * dpr));
    flightCanvas.width = Math.max(1, Math.round(window.innerWidth * dpr));
    flightCanvas.height = Math.max(1, Math.round(window.innerHeight * dpr));
    const scaleX = rect.width / WIDTH, scaleY = rect.height / HEIGHT;
    flightView = { dpr, left: rect.left, top: rect.top, scaleX, scaleY,
      bounds: { left: -rect.left / scaleX, top: -rect.top / scaleY,
        right: (window.innerWidth - rect.left) / scaleX, bottom: (window.innerHeight - rect.top) / scaleY } };
    // Resizing clears canvas pixels. Repaint even when the animation clock is paused.
    if (world) draw();
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

  function beginEntrance(cat, delay = 0) {
    if (reducedMotion || !cat || !art[cat.role]?.opening) return false;
    landings.set(cat.id, -delay);
    landingWaters.set(cat.id, { ...LW.create(cat, P.RADIUS), age: -delay });
    return true;
  }

  function reset() {
    cancelAim();
    $('round-score').hidden = true;
    document.querySelectorAll('dialog[open]').forEach(dialog => dialog.close());
    if ($('game-mode').value === 'battle') {
      if (!match) { if (world) world.destroy(); match = new B.Match({ map, reducedMotion, allyRoster, rivalRoster }); }
      else match.reset();
      match.testOneHit = testOneHit;
      configurePresentation();
      world = match.world;
    } else {
      if (match) { match.destroy(); match = null; world = null; }
      if (!world) world = new P.PoolWorld({ map });
      world.reset($('layout').value);
    }
    selected = 0;
    effects = [];
    traitEffects.clear();
    retreats = [];
    landings.clear();
    landingWaters.clear();
    if (match) {
      for (const cat of match.actors) {
        beginEntrance(cat, cat.slot * 0.06 + (cat.team === 0 ? 0 : 0.09));
      }
    }
    cameraBeat = null;
    impactBeat = null; impactUsedThisAction = false; cameraUsedThisAction = false;
    contactEffects = [];
    normalEffects = [];
    aiWait = 0;
    waterWakes = WW.create();
    WW.prime(waterWakes, world.snapshot());
    poolArt?.resetWater();
    reactions.clear();
    lastTime = 0;
    syncControls();
  }

  function showRoundScore(round) {
    const cue = $('round-score');
    $('round-score-number').textContent = `${I.t('battle.round')} ${round}`;
    $('round-score-ally').textContent = match.scores[0];
    $('round-score-rival').textContent = match.scores[1];
    cue.dataset.motion = reducedMotion ? 'reduced' : 'full';
    cue.hidden = false;
  }

  function showMatchResult(winner) {
    $('round-score').hidden = true;
    const dialog = $('result-dialog');
    const outcome = winner === 0 ? 'win' : winner === 1 ? 'lose' : 'draw';
    const [ally, rival] = match.scores;
    dialog.dataset.outcome = outcome;
    dialog.dataset.motion = reducedMotion ? 'reduced' : 'full';
    $('result-title').textContent = I.t(outcome === 'draw' ? 'state.draw' : `result.${outcome}`);
    $('result-note').textContent = `${I.t('battle.ally')} ${ally} : ${rival} ${I.t('battle.enemy')}`;
    $('result-meta').textContent = `${I.t(map.nameKey)} · ${I.t('battle.round')} ${match.round}`;
    $('result-reveal-ally').textContent = ally;
    $('result-reveal-rival').textContent = rival;
    $('result-lineup').replaceChildren(...match.actors.filter(cat => cat.team === 0).map(cat => {
      const item = document.createElement('li');
      const name = document.createElement('strong');
      name.textContent = I.t(`character.${cat.role}`);
      const sprite = art[cat.role];
      if (sprite) {
        const card = document.createElement('canvas');
        card.width = 144;
        card.height = 144;
        card.setAttribute('aria-hidden', 'true');
        const context = card.getContext('2d');
        const box = sprite.metadata.drawBox;
        const scale = Math.min(128 / box.width, 128 / box.height);
        context.translate(card.width / 2 - (box.x + box.width / 2) * scale, 135 - (box.y + box.height) * scale);
        context.scale(scale, scale);
        sprite.draw(context);
        item.append(card);
      }
      item.append(name);
      return item;
    }));
    dialog.showModal();
  }

  function returnToPreparation() {
    const destination = new URL('preparation.html', fullPlaytest ? location.href : document.baseURI);
    if (development) {
      destination.search = location.search;
      destination.searchParams.delete('opening');
    }
    destination.searchParams.set('locale', I.locale);
    destination.searchParams.set('map', map.id);
    for (const [team, key] of ['ally', 'rival'].entries()) {
      const roster = rolesBySlot.slice(team * 3, team * 3 + 3).map(role => B.ROLES[role].key);
      destination.searchParams.set(key, roster.join(','));
    }
    location.replace(destination);
  }

  function pointerDown(event) {
    if (event.button !== 0 || !event.isPrimary || world.moving || suspended || drag) return;
    if (match && (match.phase !== 'ready' || match.side !== 0)) return;
    const point = toWorld(event);
    const rings = world.snapshot();
    // Prefer physical floats; visible character pixels follow front-to-back drawing order.
    const ring = rings.find(item => Math.hypot(item.x - point.x, item.y - point.y) <= P.RADIUS)
      || rings.slice().sort((a, b) => b.y - a.y || b.id - a.id)
        .find(item => art[roleFor(item.id)]?.contains(point.x - item.x, point.y - item.y));
    if (!ring) return;
    if (match && !match.canLaunch(ring.id)) return;
    $('round-score').hidden = true;
    landings.clear();
    landingWaters.clear();
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
      landings.clear();
      landingWaters.clear();
      impactUsedThisAction = false;
      cameraUsedThisAction = false;
      selected = id;
      WW.prime(waterWakes, world.snapshot());
      effects = [];
      contactEffects = [];
      normalEffects = [];
      reactions.clear();
      aiWait = 0;
      S.play('launch');
      return true;
    }
    return false;
  }

  function syncControls() {
    if (development) syncDevelopmentControls();
    const role = roleFor(selected);
    const cat = match?.actors.find(item => item.id === selected);
    $('selected-portrait').hidden = !art[role];
    $('selected-fallback').hidden = Boolean(art[role]);
    $('selected-fallback').textContent = I.t(`character.${role}`);
    if (art[role]) art[role].drawPortrait($('selected-portrait').getContext('2d'));
    $('selected-name').textContent = I.t(`character.${role}`);
    $('selected-name').style.color = cat?.team === 1 ? '#a15e67' : paletteFor(role).dark;
    $('selected-stats').textContent = cat ? `HP ${cat.hp}/${cat.maxHp}　|　${I.t('battle.attack')} ${cat.attack}` : '';
    $('selected-health-wrap').hidden = !cat;
    $('selected-attack-wrap').hidden = !cat;
    if (cat) {
      const hp = Math.max(0, Math.min(cat.maxHp, cat.hp));
      $('selected-health').textContent = `HP ${hp}/${cat.maxHp}`;
      $('selected-healthbar').max = cat.maxHp;
      $('selected-healthbar').value = hp;
      $('selected-healthbar').setAttribute('aria-valuetext', `HP ${hp}/${cat.maxHp}`);
      $('selected-attack').textContent = `${I.t('battle.attack')} ${cat.attack}`;
    }
    $('selected-skill').hidden = !match;
    $('selected-skill').textContent = match ? I.t(`skill.${role}.name`) : '';
    $('selected-skill').parentElement.hidden = !match;
    $('character-stats').textContent = $('selected-stats').textContent;
    $('skill-description').textContent = match ? I.t(`skill.${role}.description`) : I.t('battle.practiceNote');
    $('layout-wrap').hidden = Boolean(match);
    $('layout').disabled = Boolean(match);
    $('reset-label').textContent = I.t(match ? 'skin.restart' : 'ui.reset');
    $('play-hint').textContent = I.t(match ? 'battle.hint' : 'ui.hint');
    $('launch-hint-copy').textContent = I.t(match && testOneHit ? 'test.oneHitActive' : 'ui.launchHint');
    $('sound-label').textContent = I.t(S.enabled ? 'skin.soundOn' : 'skin.soundOff');
    $('sound-icon').src = `assets/ui/icons/fa-solid/${S.enabled ? 'volume-high' : 'volume-xmark'}.svg`;
    $('sound-toggle').setAttribute('aria-pressed', S.enabled);
    $('layout-note').textContent = I.t(`note.${world.layout}`);
    $('show-art').title = I.t(development ? 'ui.expression' : 'ui.artStudy');
    $('art-title').textContent = `${I.t('ui.artStudy')} · ${I.t(`character.${role}`)}`;
    drawPreview();
    updateStatus();
  }

  function syncDevelopmentControls() {
    syncMotionControls();
    for (const key of Object.keys(P.DEFAULTS)) {
      $(key).value = world.params[key];
      $(`${key}-value`).value = key === 'maxSpeed' ? `${world.params[key]} px/s` : world.params[key].toFixed(2);
    }
    const ring = world.snapshot().find(item => item.id === selected);
    $('mass').value = ring ? ring.mass : 1;
    $('mass-value').value = `${(ring ? ring.mass : 1).toFixed(2)}×`;
    $('test-one-hit').checked = testOneHit;
    $('test-one-hit').disabled = !match;
    $('tuning-note').textContent = I.t(match ? 'battle.tuningNote' : 'ui.tuningHint');
    $('art-note').textContent = I.t(art[roleFor(selected)] ? 'ui.artNote' : 'ui.artMissing');
  }

  function syncMotionControls() {
    if (!development) return;
    $('motion-mode').value = motionState.preference;
    $('knockout-version').value = knockoutVersion;
    $('camera-style').value = cameraStyle;
    $('camera-style').disabled = !['unseat','unseat-inertia'].includes(knockoutVersion);
    $('impact-contact').checked = contactEnabled;
    $('impact-contact').disabled = reducedMotion || !knockoutVersion.startsWith('unseat-inertia');
    const prefix = motionState.preference === 'system' ? 'motion.system' : 'motion';
    $('motion-status').textContent = I.t(`${prefix}.${reducedMotion ? 'reducedStatus' : 'fullStatus'}`);
  }

  function configurePresentation() {
    if (!match) return;
    match.flightDuration = reducedMotion ? M.KNOCKOUT.reducedDuration : M.KNOCKOUT.duration;
    match.flightDurations = characterKeys.map((_, role) => {
      const sprite = knockoutArt(role);
      if (reducedMotion) return match.flightDuration;
      if (knockoutVersion.startsWith('unseat') && sprite?.unseat) return U.CONFIG.duration;
      if (knockoutVersion !== 'legacy' && sprite?.knockoutPoses) return K.IMPACT.duration;
      return match.flightDuration;
    });
  }

  function knockoutArt(role) {
    const sprite = art[role];
    if (!knockoutVersion.startsWith('unseat') && sprite?.metadata.knockoutSetUsed === 'swim-v2') {
      return { ...sprite, ...sprite.classicKnockout };
    }
    return sprite;
  }

  function applyKnockoutVersion(version, persist = false) {
    knockoutVersion=knockoutVersions.includes(version)?version:'impact';
    configurePresentation();
    if(persist)try{localStorage.setItem('miao-bump-knockout',knockoutVersion);}catch{ /* Keep in-page choice. */ }
    syncMotionControls();
  }

  function applyMotionPreference(preference, persist = false) {
    motionState = M.resolveMotion(preference, motionQuery.matches);
    reducedMotion = motionState.reduced;
    if(reducedMotion){
      cameraBeat=null;impactBeat=null;contactEffects=[];normalEffects=[];landings.clear();landingWaters.clear();
      waterWakes = WW.create();
      for (const [id, reaction] of reactions) if (reaction.ordinary) reactions.delete(id);
    }
    // Existing tracks keep their original duration. Only future knockouts use the new choice.
    configurePresentation();
    if (persist) {
      try { localStorage.setItem('miao-bump-motion', motionState.preference); } catch { /* Keep the in-page choice. */ }
    }
    syncMotionControls();
  }

  function drawPreview() {
    const preview = $('character-preview');
    const context = preview.getContext('2d');
    context.clearRect(0, 0, preview.width, preview.height);
    const role = roleFor(selected);
    context.save();
    if (art[role]?.metadata.integratedFloat) {
      const box = art[role].metadata.drawBox;
      const scale = Math.min((preview.width - 20) / box.width, (preview.height - 16) / box.height);
      context.translate(preview.width / 2 - (box.x + box.width / 2) * scale, 8 - box.y * scale);
      context.scale(scale, scale);
    } else { context.translate(96, 128); context.scale(1.25, 1.25); }
    context.imageSmoothingEnabled = false;
    if (!art[role]?.metadata.integratedFloat) {
      context.drawImage(floatImages[role], -P.RADIUS, -P.RADIUS, P.RADIUS * 2, P.RADIUS * 2);
    }
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
        : match.phase === 'resolving' ? 'resolving' : world.moving ? (match.side === 0 ? 'playerMoving' : 'enemyMoving')
          : landings.size ? 'entering' : match.side === 0 ? 'playerTurn' : 'enemyTurn';
    }
    const status = state === 'aiming' && match ? I.t('hud.aiming') : I.t(`${match && ['playerTurn', 'enemyTurn', 'playerMoving', 'enemyMoving'].includes(state) ? 'hud' : 'state'}.${state}`);
    if ($('state').textContent !== status) $('state').textContent = status;
    $('state').dataset.state = world.moving ? 'moving' : 'idle';
    if (development) $('tuning-fields').disabled = world.moving || Boolean(match);
    canvas.classList.toggle('moving', world.moving);
    updateScoreboard();
    const selectedCat = match?.actors.find(cat => cat.id === selected);
    $('selected-turn').textContent = selectedCat ? actorStatusLabel(selectedCat) : '';
    $('pause-cover').hidden = !suspended;
  }

  function roundRect(x, y, width, height, radius, fill, stroke) {
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, radius);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.strokeStyle = stroke; ctx.stroke(); }
  }

  function paintCircle(context, x, y, radius, fill, stroke) {
    context.beginPath(); context.arc(x, y, radius, 0, Math.PI * 2);
    if (fill) { context.fillStyle = fill; context.fill(); }
    if (stroke) { context.strokeStyle = stroke; context.stroke(); }
  }
  const circle = (...args) => paintCircle(ctx, ...args);

  function drawPool(wakeMarks) {
    const sources = [];
    if (poolArt?.dynamicWater && !reducedMotion) {
      for (const track of normalEffects) sources.push({ x: track.x, y: track.y,
        age: track.age, strength: track.strength * 0.8, radius: P.RADIUS * 1.4 });
      for (const track of landingWaters.values()) sources.push({ x: track.x, y: track.y,
        age: track.age - M.LANDING.touch, strength: 0.8, radius: P.RADIUS * 1.6 });
      const moving = new Map();
      for (const mark of wakeMarks) {
        if (mark.age < 0.12 && (!moving.has(mark.id) || moving.get(mark.id).age > mark.age)) moving.set(mark.id, mark);
      }
      for (const mark of moving.values()) sources.push({ x: mark.x, y: mark.y,
        age: mark.age, strength: mark.strength * 0.35, radius: P.RADIUS * 1.3 });
    }
    if (poolArt) poolArt.draw(ctx, { time: waterWakes.time, sources, reducedMotion });
    else A.drawPoolFallback(ctx, map);
  }

  function drawOpening(ring, role, age, ctx) {
    const side = ring.id < 3 ? -1 : 1;
    const edge = side < 0 ? map.world.bounds.left : map.world.bounds.right;
    const pose = M.sampleLanding(age, edge - ring.x + side * 14, P.RADIUS);
    const opening = art[role].opening;
    if (pose.ring) {
      ctx.save();
      ctx.translate(Math.round(pose.ring.x), Math.round(pose.ring.y));
      ctx.rotate(pose.ring.angle);
      opening.draw(ctx, 'ring');
      ctx.restore();
    }
    if (!pose.body) return;
    ctx.save();
    ctx.translate(Math.round(pose.body.x), Math.round(pose.body.y));
    ctx.rotate(pose.body.angle);
    if (pose.pose === 'jump') ctx.scale(pose.direction, 1);
    opening.draw(ctx, pose.pose);
    ctx.restore();
  }

  function reactionPose(id) {
    const reaction = reactions.get(id);
    const pose = reaction?.ordinary ? NC.pose(reaction.ordinary, reaction.age, reducedMotion)
      : A.reactionAt(reaction?.age ?? 1, reaction?.strength ?? 0, reducedMotion);
    if (traitEffects.get(id)?.kind !== 'heavy') return pose;
    return { ...pose, along: 1 + (pose.along - 1) * 0.45,
      across: 1 + (pose.across - 1) * 0.45, lean: pose.lean * 0.45 };
  }

  function drawRing(ring, ghost = false, ctx = poolContext) {
    const circle = (...args) => paintCircle(ctx, ...args);
    const role = roleFor(ring.id);
    const palette = paletteFor(role);
    const cat = match?.actors.find(item => item.id === ring.id);
    const integratedFloat = Boolean(art[role]?.metadata.integratedFloat);
    ctx.save(); ctx.translate(Math.round(ring.x / 2) * 2, Math.round(ring.y / 2) * 2);
    const landingAge = ghost ? undefined : landings.get(ring.id);
    if (landingAge !== undefined) {
      drawOpening(ring, role, landingAge, ctx);
      ctx.restore();
      return;
    }
    if (!ghost) {
      if (integratedFloat) {
        ctx.beginPath(); ctx.ellipse(0, 6, P.RADIUS + 2, 22, 0, 0, Math.PI * 2);
        ctx.fillStyle = '#39799225'; ctx.fill();
      } else circle(0, 6, P.RADIUS + 2, '#39799225');
    }
    if (!ghost && ring.id === selected && !world.moving && (!match || match.canLaunch(ring.id))) {
      ctx.lineWidth = 2; ctx.setLineDash([4, 5]);
      circle(0, 0, P.RADIUS + 8, null, '#467c9b'); ctx.setLineDash([]);
    }
    const reaction = reactions.get(ring.id);
    const pose = cat?.hp === 0 ? A.reactionAt(0, 0, reducedMotion) : reactionPose(ring.id);
    const angle = reaction ? reaction.angle : 0;
    ctx.save();
    const drawFloat = frontOnly => {
      ctx.save(); ctx.rotate(angle); ctx.scale(pose.along, pose.across); ctx.rotate(-angle);
      ctx.imageSmoothingEnabled = false;
      if (frontOnly) ctx.drawImage(floatImages[role], 0, 25, 32, 7,
        -P.RADIUS, P.RADIUS * 0.5625, P.RADIUS * 2, P.RADIUS * 0.4375);
      else ctx.drawImage(floatImages[role], -P.RADIUS, -P.RADIUS, P.RADIUS * 2, P.RADIUS * 2);
      ctx.restore();
    };
    if (!integratedFloat) drawFloat(false);
    if (art[role]) {
      if (integratedFloat) {
        ctx.save(); ctx.rotate(angle); ctx.scale(pose.along, pose.across); ctx.rotate(-angle);
        art[role].draw(ctx, pose.frame);
        ctx.restore();
      } else art[role].draw(ctx, pose.frame, pose.lean * (Math.cos(angle) >= 0 ? 1 : -1));
      if (!integratedFloat) drawFloat(true);
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
    ctx.restore();
    if (ghost) { ctx.restore(); return; }
    const name = `${cat ? (cat.team === 0 ? '◆ ' : '● ') : ''}${I.t(`character.${role}`)}${cat?.usedThisRound && cat.hp > 0 ? ' ✓' : ''}`;
    const nameY = art[role]?.metadata.hud?.nameY ?? P.RADIUS + 9;
    ctx.font = '600 13px "Segoe UI", "Microsoft YaHei", sans-serif';
    const width = ctx.measureText(name).width + 20;
    roundRect(-width / 2, nameY, width, 23, 7, '#f9ffffe8');
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillStyle = cat ? (cat.team === 0 ? '#336b94' : '#a14d62') : palette.dark;
    ctx.fillText(name, 0, nameY + 12);
    if (cat && !ghost) {
      const hpY = healthBarOffset(ring, role);
      ctx.fillStyle = '#fff9ef'; ctx.fillRect(-31, hpY, 62, 10);
      ctx.fillStyle = '#dbe2e7'; ctx.fillRect(-29, hpY + 2, 58, 6);
      ctx.fillStyle = cat.team === 0 ? '#4186b4' : '#ca7385';
      ctx.fillRect(-29, hpY + 2, Math.round(58 * cat.hp / cat.maxHp), 6);
      if (cat.hp === 0) { ctx.fillStyle = '#59667d'; ctx.font = 'bold 18px sans-serif'; ctx.fillText('×', 0, hpY + 18); }
    }
    ctx.restore();
  }

  function healthBarOffset(ring, role) {
    return Math.max(art[role]?.metadata.hud?.healthY ?? -108, 8 - ring.y);
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
    const length = (art[roleFor(selected)] ? 96 : P.RADIUS + 15) + vector.power * 70;
    const end = { x: origin.x + d.x * length, y: origin.y + d.y * length };
    ctx.beginPath(); ctx.moveTo(origin.x + d.x * (P.RADIUS + 7), origin.y + d.y * (P.RADIUS + 7)); ctx.lineTo(end.x, end.y); ctx.stroke();
    ctx.fillStyle = '#3a7496'; ctx.beginPath(); ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - d.x * 12 - d.y * 7, end.y - d.y * 12 + d.x * 7);
    ctx.lineTo(end.x - d.x * 12 + d.y * 7, end.y - d.y * 12 - d.x * 7); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function unseatState(ghost) {
    const state=(ghost.unseat.inertia?IM:U).sample(ghost.unseat,ghost.age,ghost.sampleBounds);
    return ghost.contactAccent&&!reducedMotion?IC.apply(state,ghost.unseat,{impact:ghost.impactFeedback}):state;
  }

  function drawContact(layer,context=ctx) {
    if(!contactEffects.length||reducedMotion)return;
    const b=map.world.bounds,p=cameraProjection();
    const left=Math.max(b.left,-p.x/p.scale),top=Math.max(b.top,-p.y/p.scale);
    const right=Math.min(b.right,(WIDTH-p.x)/p.scale),bottom=Math.min(b.bottom,(HEIGHT-p.y)/p.scale);
    context.save();context.beginPath();context.rect(left,top,right-left,bottom-top);context.clip();
    for(const effect of contactEffects)ICR[layer](context,IC.sample(effect,effect.age));
    context.restore();
  }

  function drawLandingWater(layer) {
    if (reducedMotion || !landingWaters.size) return;
    const b = map.world.bounds;
    ctx.save();
    ctx.beginPath(); ctx.rect(b.left, b.top, b.right - b.left, b.bottom - b.top); ctx.clip();
    for (const track of landingWaters.values()) LWR.draw(ctx, LW.sample(track, track.age), layer);
    ctx.restore();
  }

  function drawNormalWater(layer, tracks = normalEffects) {
    if (!tracks.length) return;
    const b = map.world.bounds;
    ctx.save();
    ctx.beginPath(); ctx.rect(b.left, b.top, b.right - b.left, b.bottom - b.top); ctx.clip();
    for (const track of tracks) LWR.draw(ctx, NC.sample(track, track.age), layer);
    ctx.restore();
  }

  function startTrait(id, kind, contact) {
    traitEffects.set(id, { kind, age: 0, contact });
  }

  function drawTraits(rings) {
    if (!traitEffects.size) return;
    const water = map.world.bounds;
    ctx.save();
    ctx.beginPath();
    ctx.rect(water.left, water.top, water.right - water.left, water.bottom - water.top);
    ctx.clip();
    for (const [id, effect] of traitEffects) {
      const ring = rings.find(item => item.id === id);
      if (!ring) continue;
      const progress = effect.age / traitDuration[effect.kind];
      ctx.save();
      ctx.globalAlpha = Math.min(1, (1 - progress) * 1.7);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.beginPath();
      if (effect.kind === 'bounce') {
        const { x, y, axis } = effect.contact;
        ctx.translate(x, y);
        ctx.rotate(Math.atan2(axis.y, axis.x));
        for (const offset of [0, 19, 38]) {
          const lead = 13 + offset + progress * 16;
          ctx.moveTo(lead - 10, -10); ctx.lineTo(lead, 0); ctx.lineTo(lead - 10, 10);
        }
        ctx.strokeStyle = '#19766d';
      } else {
        ctx.translate(ring.x, ring.y);
        if (effect.kind === 'guard') {
          ctx.ellipse(0, -24, 58 + progress * 8, 39 + progress * 7, 0, 0, Math.PI * 2);
          ctx.fillStyle = '#c9c3ff66';
          ctx.fill();
          ctx.strokeStyle = '#7774ce';
        } else {
          ctx.ellipse(0, 10, 45 + progress * 17, 17 + progress * 5, 0, 0, Math.PI);
          ctx.strokeStyle = '#c17b36';
        }
      }
      ctx.lineWidth = 6;
      ctx.stroke();
      ctx.strokeStyle = '#fff8cf';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function draw() {
    ctx.setTransform(canvas.width / WIDTH, 0, 0, canvas.height / HEIGHT, 0, 0);
    ctx.clearRect(0, 0, WIDTH, HEIGHT);
    const camera=cameraProjection();
    ctx.save();ctx.translate(camera.x,camera.y);ctx.scale(camera.scale,camera.scale);
    const wakeMarks = WW.sample(waterWakes);
    drawPool(wakeMarks);
    const waterBounds = map.world.bounds;
    ctx.save();
    ctx.beginPath(); ctx.rect(waterBounds.left, waterBounds.top,
      waterBounds.right - waterBounds.left, waterBounds.bottom - waterBounds.top); ctx.clip();
    WWR.draw(ctx, wakeMarks);
    ctx.restore();
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
    drawContact('water');
    drawLandingWater('back');
    drawNormalWater('back');
    const rings = world.snapshot();
    drawAim(rings);
    drawTraits(rings);
    const hitFocus=cameraBeat?.impactRead&&!cameraBeat.relay&&!cameraBeat.overview ? cameraBeat : null;
    const frontWater = normalEffects.slice().sort((a, b) => a.y - b.y);
    let waterIndex = 0;
    rings.sort((a, b) => a.y - b.y || a.id - b.id).forEach(ring => {
      const behind = [];
      while (waterIndex < frontWater.length && frontWater[waterIndex].y < ring.y - 1) {
        behind.push(frontWater[waterIndex++]);
      }
      drawNormalWater('front', behind);
      ctx.globalAlpha=hitFocus&&ring.id!==hitFocus.attacker ? 1-.32*(camera.scale-1)/hitFocus.timing.zoom : 1;
      drawRing(ring);
    });
    ctx.globalAlpha=1;
    drawLandingWater('front');
    drawNormalWater('front', frontWater.slice(waterIndex));
    flightContext.setTransform(1, 0, 0, 1, 0, 0);
    flightContext.clearRect(0, 0, flightCanvas.width, flightCanvas.height);
    const view = flightView;
    flightContext.setTransform(view.dpr * view.scaleX * camera.scale, 0, 0, view.dpr * view.scaleY * camera.scale,
      view.dpr * (view.left+view.scaleX*camera.x), view.dpr * (view.top+view.scaleY*camera.y));
    for (const ghost of retreats) {
      if(ghost.unseat) {
        const state=unseatState(ghost);
        if(ghost.contactAccent&&!reducedMotion){
          ICR.streaks(flightContext,IC.trail(ghost.unseat,ghost.age,
            age=>IM.sample(ghost.unseat,age,ghost.sampleBounds)));
        }
        const b=map.world.bounds;
        ctx.save();ctx.beginPath();ctx.rect(b.left,b.top,b.right-b.left,b.bottom-b.top);ctx.clip();
        ctx.globalAlpha=state.shadow.alpha;ctx.fillStyle='#356d87';ctx.beginPath();
        ctx.ellipse(state.shadow.x,state.shadow.y+8,36,11,0,0,Math.PI*2);ctx.fill();ctx.restore();
        UR.draw(flightContext,ghost.sprite,state,ghost,view.bounds);
        continue;
      }
      if(ghost.action) {
        const state=K.sample(ghost.action,ghost.age,view.bounds);
        const b=map.world.bounds;
        ctx.save();ctx.beginPath();ctx.rect(b.left,b.top,b.right-b.left,b.bottom-b.top);ctx.clip();
        ctx.globalAlpha=state.shadow.alpha;ctx.fillStyle='#356d87';ctx.beginPath();
        ctx.ellipse(state.shadow.x,state.shadow.y+8,36,11,0,0,Math.PI*2);ctx.fill();ctx.restore();
        KR.draw(flightContext,ghost.sprite,state,ghost,view.bounds);
        continue;
      }
      const splitArt = ghost.sprite?.knockout;
      const split = Boolean(splitArt && ghost.parts);
      const lead = split ? ghost.parts.find(part => part.partId === 'character') : ghost;
      const flight = M.sampleFlight(lead, ghost.age, map, view.bounds);
      ctx.save();
      const b = map.world.bounds;
      ctx.beginPath(); ctx.rect(b.left, b.top, b.right - b.left, b.bottom - b.top); ctx.clip();
      ctx.globalAlpha = flight.alpha * 0.2 * Math.max(0, 1 - flight.lift / 200);
      ctx.fillStyle = '#356d87'; ctx.beginPath();
      ctx.ellipse(flight.shadowX, flight.shadowY + 8, P.RADIUS * flight.scale, 12 * flight.scale, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      // Viewport-sized transparent layer: the pool cannot crop a departing cat.
      // Rotate about its art centre while preserving the original float anchor.
      const blendT = split && !ghost.reducedMotion ? Math.min(1, ghost.age / M.KNOCKOUT.splitBlend) : 1;
      const blend = blendT * blendT * (3 - 2 * blendT);
      if (split && blend < 1) {
        flightContext.save();
        flightContext.translate(ghost.x + ghost.direction.x * 12 * blend,
          ghost.y + ghost.direction.y * 4 * blend - 16 * blend);
        flightContext.globalAlpha = 1 - blend;
        drawRing({ ...ghost, x: 0, y: 0 }, true, flightContext);
        flightContext.restore();
      }
      const pieces = split ? ghost.parts : [ghost];
      for (const piece of pieces) {
        const pose = split ? M.sampleFlight(piece, ghost.age, map, view.bounds) : flight;
        flightContext.save();
        if (split && piece.partId === 'character' && !ghost.reducedMotion && ghost.age < 0.14) {
          // The previously submerged legs emerge through the waterline, not on top of the ring.
          flightContext.beginPath();
          flightContext.rect(view.bounds.left, view.bounds.top,
            view.bounds.right - view.bounds.left, Math.max(0, ghost.y + 6 - view.bounds.top));
          flightContext.clip();
        }
        flightContext.translate(Math.round(pose.x / 2) * 2 + piece.pivotX,
          Math.round(pose.y / 2) * 2 + piece.pivotY);
        flightContext.rotate(pose.rotation);
        flightContext.scale(pose.scale * (pose.stretchX ?? 1), pose.scale * (pose.stretchY ?? 1));
        flightContext.translate(-piece.pivotX, -piece.pivotY); flightContext.globalAlpha = pose.alpha * (split ? blend : 1);
        if (split) splitArt.draw(flightContext, piece.partId);
        else drawRing({ ...ghost, x: 0, y: 0 }, true, flightContext);
        flightContext.restore();
      }
    }
    drawContact('flash',flightContext);
    if ($('show-hitboxes')?.checked === true) {
      ctx.save(); ctx.strokeStyle = '#bd526b'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      rings.forEach(ring => { circle(ring.x, ring.y, P.RADIUS, null, '#bd526b'); });
      ctx.restore();
    }
    ctx.restore();
  }

  function advanceScene(dt,wallDt=dt) {
      normalEffects = normalEffects.filter(track => (track.age += dt / 1000) < track.duration);
    for (const [id, effect] of traitEffects) {
      effect.age += dt / 1000;
      if (effect.age >= traitDuration[effect.kind]) traitEffects.delete(id);
    }
      if(cameraBeat){
        const focus=['focus','release'].includes(cameraBeat.style);
        cameraBeat.age+=(focus?wallDt:dt)/1000;
        const end=cameraBeat.style==='release'?(cameraBeat.timing??C.RELEASE).end:focus?C.FOCUS.end:U.CONFIG.duration;
        const overviewEnd=cameraBeat.overview?cameraBeat.overview.start+cameraBeat.overview.duration:0;
        const relayEnd=cameraBeat.relay?cameraBeat.relay.start+cameraBeat.relay.holdUntil+cameraBeat.relay.return.duration:0;
        if(cameraBeat.age>=(relayEnd||Math.max(end,overviewEnd)))cameraBeat=null;
      }
      retreats = retreats.map(item => ({ ...item, age: item.age + dt / 1000 })).filter(item => item.age < item.duration - 1e-8);
      for (const [id, age] of landings) {
        const next = age + wallDt / 1000;
        if (next >= M.LANDING.duration) landings.delete(id);
        else landings.set(id, next);
      }
      for (const [id, track] of landingWaters) {
        track.age += wallDt / 1000;
        if (track.age >= track.duration) landingWaters.delete(id);
      }
      for (const [id, reaction] of reactions) {
        reaction.age += dt / 1000;
        if (reaction.age >= 0.48) reactions.delete(id);
      }
      const wasMoving = world.moving;
      const previousPhase = match?.phase;
      if (match) match.advance(dt); else world.advance(dt);
      for (const impact of world.drainImpacts()) {
        S.play('hit', impact.speed / 1600);
      }
      for (const impact of world.drainVisualContacts()) {
        // A lethal contact already has the approved knockout treatment.
        if (match && impact.ringIds.some(id => match.actors[id]?.removed)) continue;
        const track = NC.create(impact, { radius: P.RADIUS, reducedMotion });
        track.age = Math.max(0, world.elapsed - impact.simulationTime);
        normalEffects.push(track);
        if (track.wall && match?.actors[impact.ringId]?.wallBonus > 0) {
          startTrait(impact.ringId, 'bounce', track);
        }
        for (const id of impact.ringIds) {
          landings.delete(id);
          landingWaters.delete(id);
          reactions.set(id, NC.reaction(reactions.get(id), track));
        }
      }
      normalEffects = NC.compact(normalEffects);
      let combatChanged = false;
      for (const event of match?.drainEvents() || []) {
        if (event.type === 'damage') {
          if (event.guard) startTrait(event.id, 'guard');
          else if (match.actors[event.id]?.role === 0 && !match.actors[event.id].removed) startTrait(event.id, 'heavy');
          for (const id of [event.id, event.attacker]) {
            const previous = reactions.get(id);
            reactions.set(id, { ...previous, age: previous?.ordinary ? previous.age : 0,
              strength: previous?.strength ?? 0.3, angle: previous?.angle ?? 0 });
          }
          if (event.guard) S.play('guard');
          combatChanged = true;
        } else if (event.type === 'retreat') {
          traitEffects.delete(event.id);
          if(!relayChain&&continuousChain&&cameraUsedThisAction)handCameraToOverview();
          const box = art[event.role]?.metadata.drawBox;
          // Include the independent float when an older character sheet is used.
          const spriteBox = box ? { x: Math.min(box.x, -P.RADIUS), y: Math.min(box.y, -P.RADIUS),
            width: Math.max(box.x + box.width, P.RADIUS) - Math.min(box.x, -P.RADIUS),
            height: Math.max(box.y + box.height, P.RADIUS) - Math.min(box.y, -P.RADIUS) } : null;
          const ghost = M.createFlight(event, { spriteBox, radius: P.RADIUS, reducedMotion });
          const sprite = knockoutArt(event.role);
          ghost.sprite = sprite;
          if (sprite?.knockout) {
            ghost.parts = M.createFlightParts(event, sprite.knockout.parts, { radius: P.RADIUS, reducedMotion });
          }
          if(!reducedMotion && knockoutVersion.startsWith('unseat') && sprite?.unseat) {
            const engine=knockoutVersion.startsWith('unseat-inertia')?IM:U;
            ghost.unseat=engine.create(event,{radius:P.RADIUS,faceRestY:sprite.unseat.faceRestY,
              profile:cameraStyle,alignedFlight});
            if(ghost.unseat.inertia)ghost.age=IM.elapsedSince(event,world.elapsed);
            ghost.sampleBounds={...flightView.bounds};
            ghost.impactFeedback=impactFeedback&&cameraStyle==='release';
            ghost.contactAccent=contactEnabled&&ghost.unseat.inertia;
            const impactRead=ghost.impactFeedback&&ghost.unseat.inertia&&impactPace==='impact-read';
            const departureAt=ghost.impactFeedback?IM.RELEASE.releaseAt:.12;
            if(ghost.contactAccent){
              const effect=IC.create({...event,direction:ghost.direction},
                {radius:P.RADIUS,impact:ghost.impactFeedback,departureAt,showApproach:impactRead,
                  departure:IM.sample(ghost.unseat,departureAt,ghost.sampleBounds).ring});
              // This frame has already consumed dt before the new event. The
              // common effect advance below must not age its flash a step early.
              if(ghost.impactFeedback)effect.age=ghost.age-dt/1000;
              contactEffects.push(effect);
            }
            const relay=relayChain&&['focus','release'].includes(cameraStyle);
            const unseatPace=ghost.impactFeedback&&impactPace==='unseat';
            const contactPace=ghost.impactFeedback&&ghost.unseat.inertia&&impactPace==='contact';
            const clockProfile=unseatPace?'impact-unseat':ghost.impactFeedback?'impact':cameraStyle;
            const focusPoint=ghost.impactFeedback&&event.contactPoint?
              (contactPace||impactRead?event.contactPoint:{x:event.x*.6+event.contactPoint.x*.4,y:event.y*.6+event.contactPoint.y*.4}):event;
            if(relay&&['unseat','unseat-inertia'].includes(knockoutVersion)&&cameraBeat){
              relayCamera(focusPoint);
              if(impactBeat)IB.reaccent(impactBeat);
              else impactBeat=IB.followup(clockProfile);
            }else if(['unseat','unseat-inertia'].includes(knockoutVersion)&&!cameraBeat&&(relay||!continuousChain||!cameraUsedThisAction)){
              cameraUsedThisAction=true;
              const focus=['focus','release'].includes(cameraStyle)&&(relay||(!impactUsedThisAction&&!impactBeat));
              if(focus){
                if(relay&&impactUsedThisAction){
                  if(impactBeat)IB.reaccent(impactBeat);else impactBeat=IB.followup(clockProfile);
                }else impactBeat=IB.create(clockProfile);
                impactUsedThisAction=true;
              }
              const timing=impactRead&&focus ? C.impactReadTiming(IB.realTime(departureAt,clockProfile))
                : contactPace ? C.CONTACT_IMPACT_RELEASE : unseatPace ? C.UNSEAT_IMPACT_RELEASE : ghost.impactFeedback
                ? (readableCameraRate ? C.READABLE_IMPACT_RELEASE : C.IMPACT_RELEASE)
                : (readableCameraRate ? C.READABLE_RELEASE : C.RELEASE);
              cameraBeat={x:focusPoint.x,y:focusPoint.y,direction:{...ghost.direction},age:focus?0:ghost.age,
                style:['focus','release'].includes(cameraStyle)&&!focus?'gentle':cameraStyle,
                clockProfile,timing,impactRead:impactRead&&focus,attacker:event.attacker,
                track:ghost.unseat,view:{...ghost.sampleBounds},cluster:{x:focusPoint.x,y:focusPoint.y,count:1,at:0}};
            }
          } else if(!reducedMotion && knockoutVersion!=='legacy' && sprite?.knockoutPoses) {
            ghost.action=K.create(event,{radius:P.RADIUS,config:{...K.IMPACT,duration:event.duration,
              headRestY:sprite.knockoutPoses.headRestY}});
          }
          retreats.push(ghost);
          landings.delete(event.id);
          landingWaters.delete(event.id);
          effects.push({ x: event.x, y: event.y, speed: 1200, normal: event.direction, age: 0 });
          S.play('retreat');
          combatChanged = true;
        } else if (event.type === 'respawn') {
          const cat = match.actors.find(item => item.id === event.id);
          if (!beginEntrance(cat)) {
            effects.push({ x: event.x, y: event.y, speed: 400, normal: { x: 0, y: 1 }, age: 0 });
          }
          reactions.delete(event.id);
          S.play('respawn');
          combatChanged = true;
        } else if (event.type === 'round') {
          showRoundScore(event.round);
          combatChanged = true;
        } else if (event.type === 'result') {
          showMatchResult(event.winner);
          S.play('result');
        }
      }
      if (match?.phase === 'ready' && match.side === 1 && !landings.size && !document.querySelector('dialog[open]')) {
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
      contactEffects=contactEffects.map(item=>({...item,age:item.age+dt/1000})).filter(item=>item.age<item.duration).slice(-8);
      WW.advance(waterWakes, world.snapshot(), dt / 1000,
        { radius: P.RADIUS, blockedIds: landings.keys(), reducedMotion });
      if (wasMoving !== world.moving || previousPhase !== match?.phase || combatChanged) syncControls();
  }

  function frame(time) {
    if (destroyed) return;
    const dt = lastTime ? Math.max(0,Math.min(time - lastTime, 100)) : 0;
    lastTime = time;
    if (!suspended && !$('restart-dialog').open) {
      const precise=impactBeat||(!reducedMotion&&['focus','release'].includes(cameraStyle)&&
        ['unseat','unseat-inertia'].includes(knockoutVersion));
      if(precise&&dt>0){
        // Drain contacts at physics-step granularity. A lethal hit can start its
        // beat inside a long display frame instead of after all its motion ran.
        let remaining=dt;
        while(remaining>1e-8){
          const wallDt=Math.min(P.STEP_MS,remaining),sceneDt=IB.advance(impactBeat,wallDt);
          advanceScene(sceneDt,wallDt);
          if(IB.finished(impactBeat))impactBeat=null;
          remaining-=wallDt;
        }
      } else advanceScene(dt,dt);
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

  function startOpeningFrameLoop() {
    if (lineupParams.get('opening') !== 'versus' || !match || reducedMotion || suspended) {
      raf = requestAnimationFrame(frame);
      return;
    }
    const cue = $('versus-cue');
    const workspace = $('workspace');
    $('versus-ally-name').textContent = I.t('hud.ally');
    $('versus-rival-name').textContent = I.t('opponent.name');
    for (const [team, id] of ['versus-ally-cats', 'versus-rival-cats'].entries()) {
      const faces = match.actors.filter(cat => cat.team === team).map(cat => {
        const portrait = document.createElement('canvas');
        portrait.width = 48;
        portrait.height = 48;
        art[cat.role]?.drawPortrait(portrait.getContext('2d'));
        return portrait;
      });
      $(id).replaceChildren(...faces);
    }
    // Paint the actual pool and hold the initial pose until the wipe ends.
    draw();
    workspace.inert = true;
    const versusDurationMs = 1600;
    cue.style.setProperty('--versus-duration', `${versusDurationMs}ms`);
    cue.hidden = false;
    const fallback = setTimeout(finish, versusDurationMs + 140);
    cue.addEventListener('animationend', onAnimationEnd);

    function onAnimationEnd(event) {
      if (event.target === cue) finish();
    }
    function finish() {
      clearTimeout(fallback);
      cue.removeEventListener('animationend', onAnimationEnd);
      cue.hidden = true;
      workspace.inert = false;
      if (!destroyed) raf = requestAnimationFrame(frame);
    }
  }

  function destroy() {
    if (destroyed) return;
    destroyed = true;
    cancelAim();
    cancelAnimationFrame(raf);
    listeners.abort();
    observer.disconnect();
    world.destroy();
    retreats = [];
    effects = [];
    traitEffects.clear();
    reactions.clear();
    aiWait = 0;
    landings.clear();
    landingWaters.clear();
    cameraBeat = null;
    impactBeat = null; impactUsedThisAction = false; cameraUsedThisAction = false;
    contactEffects = [];
    normalEffects = [];
    waterWakes = WW.create();
    flightContext.setTransform(1, 0, 0, 1, 0, 0);
    flightContext.clearRect(0, 0, flightCanvas.width, flightCanvas.height);
    S.destroy();
  }

  async function boot() {
    await I.init();
    if (isMainPage && lineupParams.get('mode') !== 'practice'
      && performance.getEntriesByType('navigation')[0]?.type === 'reload') {
      returnToPreparation();
      return;
    }
    document.querySelector('.canvas-wrap').style.setProperty('--pool-ratio', WIDTH / HEIGHT);
    document.querySelector('.canvas-wrap').style.setProperty('--pool-height-width', `${100 * WIDTH / HEIGHT}cqh`);
    document.querySelector('.stage-slot').style.setProperty('--map-aspect', WIDTH / HEIGHT);
    $('map-note').hidden = !mapChoice.fallback;
    floatImages = characterKeys.map((_, role) => A.floatImage(paletteFor(role)));
    const loaded = await Promise.allSettled([
      ...characterKeys.map(key => A.load(key, characterArtSet, knockoutArtSet)),
      A.loadPool(map, { classicWater: previewParams.get('water') === 'classic',
        dynamicWater: previewParams.get('water-motion') !== 'static' }), A.loadUiSurfaces(),
    ]);
    // An unavailable character falls back independently; other sprites remain usable.
    art = loaded.slice(0, characterKeys.length).map(result => result.status === 'fulfilled' ? result.value : null);
    poolArt = loaded[characterKeys.length].status === 'fulfilled' ? loaded[characterKeys.length].value : null;
    const surfaces = loaded[characterKeys.length + 1];
    if (surfaces.status === 'fulfilled') {
      for (const [name, source] of Object.entries(surfaces.value)) document.documentElement.style.setProperty(`--hud-${name}`, source);
    }
    buildScoreboard();
    $('game-mode').value = new URLSearchParams(location.search).get('mode') === 'practice' ? 'practice' : 'battle';
    $('workspace').hidden = false;
    observer = new ResizeObserver(resize); observer.observe(canvas); resize();
    listen(window, 'resize', resize);
    listen(window, 'scroll', resize, { passive: true });
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
    listen($('reset'), 'click', () => {
      if (!match) { reset(); return; }
      cancelAim();
      $('restart-dialog').showModal();
    });
    listen($('confirm-restart'), 'click', reset);
    listen($('round-score'), 'animationend', event => { event.currentTarget.hidden = true; });
    listen($('play-again'), 'click', reset);
    listen($('result-back'), 'click', returnToPreparation);
    listen($('result-dialog'), 'cancel', event => event.preventDefault());
    listen($('game-mode'), 'change', () => {
      if (isMainPage) {
        const url = new URL(location.href);
        url.searchParams.set('mode', $('game-mode').value);
        history.replaceState(history.state, '', url);
      }
      reset();
    });
    listen($('sound-toggle'), 'click', () => { S.toggle(); syncControls(); });
    if (development) {
      listen($('motion-mode'), 'change', () => applyMotionPreference($('motion-mode').value, savePreviewChoices));
      listen($('knockout-version'), 'change', () => applyKnockoutVersion($('knockout-version').value, savePreviewChoices));
      listen($('camera-style'), 'change', () => {
        cameraStyle=['release','focus','quick'].includes($('camera-style').value)?$('camera-style').value:'gentle';
        if (savePreviewChoices) {
          try { localStorage.setItem('miao-bump-camera',cameraStyle); } catch { /* Keep in-page choice. */ }
        }
        syncMotionControls();
      });
      listen($('impact-contact'),'change',()=>{
        contactEnabled=$('impact-contact').checked;
        syncMotionControls();
      });
      listen($('test-one-hit'), 'change', () => {
        testOneHit = Boolean(match && $('test-one-hit').checked);
        if (match) match.testOneHit = testOneHit;
        syncControls();
      });
    }
    listen(motionQuery, 'change', () => {
      if (motionState.preference === 'system') applyMotionPreference('system');
    });
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
    if (development) {
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
    }
    listen($('language'), 'change', async () => {
      $('language').disabled = true;
      try { await I.load($('language').value); syncControls(); }
      catch { $('language').value = I.locale; }
      finally { $('language').disabled = false; }
    });
    window.miaoPlayground = Object.freeze({ snapshot: () => ({
      selected, layout: world.layout, moving: world.moving, aiming: Boolean(drag), suspended,
      traits: [...traitEffects].map(([id, { kind, age }]) => ({ id, kind, age })),
      motion: { ...motionState, systemReduced: motionQuery.matches, knockoutVersion, cameraStyle,
        activeCameraStyle:cameraBeat?.style??null,continuousChain,coordinatedChain,relayChain,readableCameraRate,impactFeedback,cameraUsedThisAction,
        overview:cameraBeat?.overview?{...cameraBeat.overview}:null,
        relay:cameraBeat?.relay?{start:cameraBeat.relay.start,holdUntil:cameraBeat.relay.holdUntil,target:{...cameraBeat.relay.pan.to},cluster:{...cameraBeat.cluster}}:null,
        impactBeat:impactBeat?IB.sampleBeat(impactBeat):null,impactUsedThisAction,
        alignedFlight,contactEnabled,contactEffects:contactEffects.map(e=>({...e})),
        camera:cameraProjection(),cameraAge:cameraBeat?.age??null },
      mode: match ? 'battle' : 'practice', battle: match ? match.snapshot() : null,
      opening: [...landings].map(([id, age]) => ({ id, age })),
      entranceWater: [...landingWaters.values()].map(track => ({
        id: track.id, age: track.age, ...LW.sample(track, track.age),
      })),
      ordinaryContacts: normalEffects.map(track => ({
        x: track.x, y: track.y, age: track.age, wall: track.wall, speed: track.speed,
        strength: track.strength, axis: { ...track.axis }, ringIds: [...track.ringIds],
        pose: NC.pose(track, track.age, reducedMotion), ...NC.sample(track, track.age),
      })),
      waterWake: { time: waterWakes.time, marks: WW.sample(waterWakes) },
      waterSurface: { mode: reducedMotion ? 'reduced' : poolArt?.dynamicWater && !poolArt.waterState()?.failed ? 'dynamic' : 'static',
        time: waterWakes.time, ...(poolArt?.waterState() || {}) },
      flights: retreats.map(({ sprite, ...item }) => {
        const action=item.unseat?unseatState(item):item.action?K.sample(item.action,item.age,flightView.bounds):null;
        return { ...item, direction: { ...item.direction }, version:item.unseat?(item.unseat.inertia?'unseat-inertia':'unseat'):action?'impact':'legacy', pose:action?.pose??'single',
          ...(action?{...action.body,rotation:action.body.angle}:
            M.sampleFlight(item.parts?.find(part => part.partId === 'character') || item,item.age,map,flightView.bounds)),
          parts:action?[{partId:'character',...action.body,rotation:action.body.angle},
            {partId:'float',...action.ring,rotation:action.ring.angle}]:
            item.parts?.map(part=>({...part,...M.sampleFlight(part,item.age,map,flightView.bounds)}))??[] };
      }),
      elapsed: world.elapsed, collisions: world.count, fault: world.fault,
      params: { ...world.params }, rings: world.snapshot(), destroyed,
      map: { id: map.id, nameKey: map.nameKey, requestedId: mapChoice.requestedId, fallback: mapChoice.fallback,
        loaded: Boolean(poolArt), width: WIDTH, height: HEIGHT, bounds: { ...map.world.bounds },
        spawns: map.spawns, spawnRegions: map.spawnRegions },
      art: {
        requestedSet: characterArtSet,
        loaded: Boolean(art[0]), frameCount: art[0] ? art[0].metadata.frames.length : 0, previewFrame,
        pixelGrid: art[0] ? art[0].metadata.pixelGrid : null, collisionRadius: P.RADIUS,
        characters: characterKeys.map((key, id) => ({
          id, key, loaded: Boolean(art[id]), frameCount: art[id]?.metadata.frames.length ?? 0,
          set: art[id]?.metadata.artSet ?? null, fallbackFrom: art[id]?.fallbackFrom ?? null,
          splitKnockout: Boolean(art[id]?.knockout),
          knockoutPoses: Boolean(art[id]?.knockoutPoses),
          unseat: Boolean(art[id]?.unseat),
          entrance: Boolean(art[id]?.opening),
          knockoutSet: art[id]?.metadata.knockoutSetUsed ?? null,
          activeFrame: reactionPose(id).frame,
        })),
        activeFrame: reactionPose(0).frame,
        reactingIds: [...reactions.keys()], showBoundaries: $('show-hitboxes')?.checked === true,
      },
    }) });
    reset();
    startOpeningFrameLoop();
  }

  boot().catch(error => {
    console.error('Unable to initialize Miao Miao Bump', error);
    $('load-error').hidden = false;
    $('load-error').textContent = I.t('ui.loadError') === 'ui.loadError'
      ? 'Unable to load the playground. Please reload this page.' : I.t('ui.loadError');
  });
})();
