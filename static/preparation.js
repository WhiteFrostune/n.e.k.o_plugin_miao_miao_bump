(async () => {
  'use strict';

  const element = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  if (location.pathname.includes('/plugin/miao_miao_bump/ui/')) await MiaoI18n.init();
  else await MiaoI18n.load(params.get('locale') || 'zh-CN');
  const t = MiaoI18n.t;
  document.title = `备战大厅 · ${t('plugin.name')}`;
  const currentMap = MiaoMapPicker.init(t, params.get('map') || undefined);
  const cats = new Map(MiaoBattle.ROLES.map((role, index) => [role.key, {
    id: role.key,
    name: t(`character.${index}`),
    hp: role.hp,
    attack: role.attack,
    skill: t(`skill.${index}.name`),
    brief: t(`skill.${index}.brief`),
    artKey: role.key,
    artMetadata: role.artMetadata,
    portrait: role.portrait,
    preview: { artKey: role.key, frame: 0 },
  }]));
  const readRoster = side => MiaoBattle.roleOrder(params.get(side)?.split(',')).map(role => MiaoBattle.ROLES[role].key);
  let rivalRoster = params.has('rival') ? readRoster('rival') : MiaoBattle.randomRoster();
  if (!params.has('rival')) {
    // A refresh of this lobby keeps the opponents already shown to the player.
    const lobby = new URL(location.href);
    lobby.searchParams.set('rival', rivalRoster.join(','));
    history.replaceState(history.state, '', lobby);
  }
  let roster = params.has('ally') ? readRoster('ally') : [null, null, null];
  const ally = element('ally-lineup');
  const rival = element('rival-lineup');
  const reroll = element('reroll-rival');
  const hint = element('lobby-hint');
  const start = element('start-match');
  const picker = element('roster-picker');
  const confirm = element('picker-confirm');
  const preview = element('roster-preview');
  const previewMotion = window.MiaoRosterPreview?.create(preview);
  const assets = new Map();
  const choices = new Map();
  let draft;
  let openerSlot = 0;
  let viewedCat;
  let previewRequest = 0;

  function loadArt(key) {
    if (!assets.has(key)) assets.set(key, MiaoArt.load(key, undefined, undefined, cats.get(key)?.artMetadata).catch(() => null));
    return assets.get(key);
  }

  async function drawSlot(canvas, cat) {
    const context = canvas.getContext('2d');
    const art = await loadArt(cat?.artKey ?? rivalRoster[0]);
    context.translate(50, 88);
    if (cat && art) {
      art.draw(context);
    } else if (art?.opening) {
      context.filter = 'hue-rotate(162deg) saturate(1.15)';
      art.opening.draw(context, 'ring');
    } else {
      const ring = MiaoArt.floatImage({ dark: '#235191', main: '#488bdd', light: '#c3ebff' });
      context.imageSmoothingEnabled = false;
      context.drawImage(ring, -40, -26, 80, 44);
    }
  }

  async function showPreview(cat, requested) {
    const request = ++previewRequest;
    const context = preview.getContext('2d');
    previewMotion?.stop();
    context.clearRect(0, 0, preview.width, preview.height);
    if (previewMotion && await previewMotion.play(cat.id, requested)) return;
    if (request !== previewRequest) return;
    if (cat.portrait) {
      const portrait = new Image();
      portrait.src = new URL(cat.portrait, document.baseURI).href;
      try {
        await portrait.decode();
        if (request !== previewRequest) return;
        const scale = Math.min(184 / portrait.height, 260 / portrait.width);
        const width = portrait.width * scale, height = portrait.height * scale;
        context.drawImage(portrait, (preview.width - width) / 2, 192 - height, width, height);
        return;
      } catch { /* Use the match sprite if the standalone portrait fails to load. */ }
    }
    const art = await loadArt(cat.preview.artKey);
    if (!art || request !== previewRequest) return;
    const box = art.metadata.drawBox;
    const scale = Math.min(176 / box.height, 260 / box.width);
    context.save();
    context.translate(preview.width / 2 - (box.x + box.width / 2) * scale, 190 - (box.y + box.height) * scale);
    context.scale(scale, scale);
    art.draw(context, cat.preview.frame);
    context.restore();
  }

  function createSlot(index, cat, interactive) {
    const slot = document.createElement(interactive ? 'button' : 'div');
    slot.className = `slot position-${index + 1}${cat ? ' occupied' : ' empty'}`;
    slot.append(element('slot-template').content.cloneNode(true));
    slot.querySelector('.slot-number').textContent = index + 1;
    slot.querySelector('.slot-name').textContent = cat?.name ?? '空位';
    if (interactive) {
      slot.type = 'button';
      slot.setAttribute('aria-haspopup', 'dialog');
      slot.setAttribute('aria-label', cat ? `${index + 1} 号位，${cat.name}` : `${index + 1} 号位为空，打开选猫`);
      slot.addEventListener('click', () => {
        openerSlot = index;
        draft = roster.filter(Boolean);
        picker.showModal();
        viewedCat = null;
        selectCat(cat?.id ?? 'juzi', { requested: !cat });
        choices.get(viewedCat).button.focus();
      });
    }
    drawSlot(slot.querySelector('canvas'), cat);
    return slot;
  }

  function renderLobby() {
    ally.replaceChildren(...roster.map((id, index) => createSlot(index, cats.get(id), true)));
    const count = roster.filter(Boolean).length;
    element('roster-count').textContent = `已选 ${count}/${roster.length}`;
    for (const [index, pip] of Array.from(element('roster-pips').children).entries()) {
      pip.classList.toggle('filled', index < count);
    }
    start.disabled = count !== roster.length;
    hint.textContent = start.disabled ? '点击带「＋」的泳圈，选择出战猫猫' : '三只猫猫已就位';
  }

  function renderRivals() {
    rival.replaceChildren(...rivalRoster.map((id, index) => createSlot(index, cats.get(id), false)));
  }

  for (const cat of cats.values()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'picker-cat';
    button.dataset.cat = cat.id;
    const portrait = document.createElement('canvas');
    portrait.setAttribute('aria-hidden', 'true');
    const name = document.createElement('strong');
    name.textContent = cat.name;
    const assignment = document.createElement('span');
    assignment.className = 'picker-assignment';
    assignment.setAttribute('aria-hidden', 'true');
    const stats = document.createElement('span');
    stats.className = 'picker-card-stats';
    for (const [icon, value] of [['swords.svg', cat.attack], ['fa-solid/heart.svg', cat.hp]]) {
      const stat = document.createElement('span');
      const image = document.createElement('img');
      image.src = `assets/ui/icons/${icon}`;
      image.alt = '';
      stat.append(image, String(value));
      stats.append(stat);
    }
    stats.setAttribute('aria-hidden', 'true');
    button.append(portrait, name, stats, assignment);
    button.addEventListener('click', () => {
      const seat = draft.indexOf(cat.id);
      if (seat >= 0) draft.splice(seat, 1);
      else if (draft.length < roster.length) draft.push(cat.id);
      selectCat(cat.id, { requested: true });
    });
    loadArt(cat.artKey).then(art => art?.drawPortrait(portrait.getContext('2d')));
    choices.set(cat.id, { button, assignment });
    element('picker-cats').append(button);
  }

  function selectCat(id, { requested = false } = {}) {
    const changed = viewedCat !== id;
    viewedCat = id;
    const cat = cats.get(id);
    for (const [catId, { button, assignment }] of choices) {
      const slot = draft.indexOf(catId);
      button.setAttribute('aria-pressed', String(slot >= 0));
      button.classList.toggle('is-previewed', catId === id);
      const choice = cats.get(catId);
      const status = slot < 0 ? '未上阵' : `已上阵，${slot + 1} 号位`;
      button.setAttribute('aria-label', `${choice.name}，${status}，攻击 ${choice.attack}，生命 ${choice.hp}`);
      assignment.hidden = slot < 0;
      assignment.textContent = slot < 0 ? '' : String(slot + 1);
    }
    element('picker-cat-name').textContent = cat.name;
    element('picker-hp').textContent = cat.hp;
    element('picker-attack').textContent = cat.attack;
    element('picker-skill').textContent = cat.skill;
    element('picker-brief').textContent = cat.brief;
    if (changed || (requested && previewMotion)) showPreview(cat, requested);

    confirm.disabled = draft.length !== roster.length;
    element('picker-count').textContent = `已上阵 ${draft.length}/${roster.length}`;
  }

  confirm.addEventListener('click', () => {
    roster = [...draft];
    renderLobby();
    picker.close();
  });
  element('picker-back').addEventListener('click', () => picker.close());
  picker.addEventListener('close', () => {
    if (picker.open) return;
    previewRequest++;
    previewMotion?.stop();
    ally.children[openerSlot]?.focus();
  });
  function saveLobby() {
    const lobby = new URL(location.href);
    lobby.searchParams.set('map', currentMap().id);
    if (roster.every(id => cats.has(id))) lobby.searchParams.set('ally', roster.join(','));
    lobby.searchParams.set('rival', rivalRoster.join(','));
    // Browser Back can reload the lobby without restoring its in-memory state.
    history.replaceState(history.state, '', lobby);
    return lobby;
  }
  reroll.addEventListener('click', () => {
    let next;
    do {
      next = MiaoBattle.randomRoster();
    } while (next.every(id => rivalRoster.includes(id)));
    rivalRoster = next;
    saveLobby();
    renderRivals();
  });
  start.addEventListener('click', () => {
    if (roster.some(id => !cats.has(id))) return;
    start.disabled = true;
    const lobby = saveLobby();
    const destination = new URL('index.html', lobby);
    for (const key of ['map', 'ally', 'rival']) destination.searchParams.set(key, lobby.searchParams.get(key));
    destination.searchParams.set('locale', MiaoI18n.locale);
    destination.searchParams.set('mode', 'battle');
    destination.searchParams.set('opening', 'versus');
    location.assign(destination);
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted) start.disabled = roster.some(id => !cats.has(id));
  });
  renderRivals();
  reroll.disabled = cats.size <= rivalRoster.length;
  renderLobby();
})().catch(() => {
  document.getElementById('lobby-hint').textContent = '角色资料加载失败，请刷新页面重试';
});
