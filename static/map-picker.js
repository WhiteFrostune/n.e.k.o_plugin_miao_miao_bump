(() => {
  'use strict';

  const element = id => document.getElementById(id);

  function init(translate, initialMapId) {
    const dialog = element('map-picker');
    const opener = element('choose-map');
    const list = element('map-choices');
    const preview = element('map-preview');
    const geometry = element('map-geometry');
    const maps = MiaoMaps.list();
    const cards = new Map();
    const pictures = new Map();
    let selected = MiaoMaps.get(initialMapId);
    let candidate = selected;

    function loadPicture(map) {
      if (!pictures.has(map.id)) {
        const loaded = MiaoArt.loadPool(map, { dynamicWater: false }).catch(() => null);
        pictures.set(map.id, loaded.then(art => {
          const canvas = document.createElement('canvas');
          const { width, height } = map.world;
          const scale = Math.min(1, 720 / Math.max(width, height));
          canvas.width = Math.round(width * scale);
          canvas.height = Math.round(height * scale);
          const context = canvas.getContext('2d');
          context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
          if (art) art.draw(context);
          else MiaoArt.drawPoolFallback(context, map);
          return canvas;
        }));
      }
      return pictures.get(map.id);
    }

    function copyPicture(source, target) {
      target.width = source.width;
      target.height = source.height;
      target.getContext('2d').drawImage(source, 0, 0);
    }

    function showMap(map) {
      candidate = map;
      for (const [id, card] of cards) card.setAttribute('aria-pressed', String(id === map.id));
      element('map-preview-name').textContent = translate(map.nameKey);
      element('map-preview-info').textContent = `矩形水池 · ${map.spawns[0].length} 对 ${map.spawns[1].length}`;

      const { width, height } = map.world;
      geometry.style.setProperty('--map-aspect', width / height);
      const markers = map.spawns.flatMap((points, team) => points.map(({ x, y }, index) => {
        const marker = document.createElement('span');
        marker.className = `map-marker ${team === 0 ? 'map-team-ally' : 'map-team-rival'}`;
        marker.style.left = `${x / width * 100}%`;
        marker.style.top = `${y / height * 100}%`;
        marker.textContent = String(index + 1);
        marker.setAttribute('role', 'img');
        marker.setAttribute('aria-label', `${team === 0 ? '我方' : '对手'} ${index + 1} 号出生点`);
        return marker;
      }));
      element('map-markers').replaceChildren(...markers);
      preview.hidden = true;
      loadPicture(map).then(picture => {
        if (candidate !== map) return;
        copyPicture(picture, preview);
        preview.hidden = false;
      });
    }

    for (const map of maps) {
      const item = document.createElement('li');
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'map-choice';
      card.dataset.map = map.id;
      const thumb = document.createElement('canvas');
      thumb.setAttribute('aria-hidden', 'true');
      const name = document.createElement('strong');
      name.textContent = translate(map.nameKey);
      card.append(thumb, name);
      item.append(card);
      list.append(item);
      cards.set(map.id, card);
      card.addEventListener('click', () => showMap(map));
      loadPicture(map).then(picture => copyPicture(picture, thumb));
    }

    const updateLobby = () => { element('current-map-name').textContent = translate(selected.nameKey); };
    updateLobby();
    opener.disabled = false;
    opener.addEventListener('click', () => {
      showMap(selected);
      dialog.showModal();
      cards.get(selected.id).focus();
    });
    element('map-picker-back').addEventListener('click', () => dialog.close());
    element('map-picker-confirm').addEventListener('click', () => {
      selected = candidate;
      updateLobby();
      dialog.close();
    });
    return () => selected;
  }

  window.MiaoMapPicker = Object.freeze({ init });
})();
