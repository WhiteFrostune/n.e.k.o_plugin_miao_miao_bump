(() => {
  'use strict';

  const base = document.currentScript.src;
  // Entries are [pose, duration in ms, horizontal offset, lift] in sprite pixels.
  const clips = {
    juzi: {
      baseline: 491,
      atlases: [{
        sheet: 'juzi-entrance-key-poses.png',
        cellWidth: 384,
        cellHeight: 512,
        feet: [[182, 484], [193, 485], [194, 485], [194, 485],
          [197, 491], [197, 491], [187, 491], [187, 491]],
      }],
      entrance: [[0, 40, -96], [0, 40, -72], [0, 40, -52], [0, 40, -34],
        [1, 40, -21], [1, 40, -11], [1, 40, -4],
        [2, 120], [3, 160], [4, 380], [5, 300]],
      idle: [[6, 1280], [7, 120], [6, 1040]],
    },
    pudding: {
      baseline: 482,
      atlases: [{
        sheet: 'pudding-entrance-key-poses.png',
        cellWidth: 512,
        cellHeight: 512,
        feet: [[266, 482], [241, 482], [247, 482], [255, 480], [246, 480], [240, 480]],
      }],
      entrance: [[0, 280, -64], [1, 40, -64], [1, 40, -49, 7], [1, 40, -36, 12],
        [1, 40, -25, 14], [1, 40, -16, 15], [1, 40, -9, 14], [1, 40, -4, 12],
        [1, 40, -1, 7], [2, 200], [3, 280]],
      idle: [[4, 1480], [5, 120], [4, 1040]],
    },
    milkcap: {
      baseline: 482,
      atlases: [
        {
          sheet: 'milkcap-key-poses.png',
          cellWidth: 512,
          cellHeight: 512,
          feet: [[236, 481], [218, 481], [234, 480], [245, 481], [253, 482], [253, 482]],
        },
        {
          sheet: 'milkcap-rub-key-poses.png',
          cellWidth: 724,
          cellHeight: 724,
          feet: [[390, 688, 286], [389, 689, 286], [317, 688, 286]],
        },
        {
          sheet: 'milkcap-lowering-key-poses.png',
          cellWidth: 724,
          cellHeight: 724,
          feet: [[407, 681, 296], [362, 681, 300], [317, 681, 304]],
        },
      ],
      entrance: [[0, 240], [1, 240], [2, 520], [6, 210], [7, 160], [8, 230],
        [9, 160], [10, 160], [11, 160]],
      idle: [[4, 1280], [5, 120], [4, 1000]],
    },
  };

  function load(sheet) {
    const image = new Image();
    image.src = new URL(sheet, base);
    return image.decode().then(() => image, () => null);
  }

  async function loadPoses(clip) {
    const atlases = await Promise.all(clip.atlases.map(async ({ sheet, cellWidth, cellHeight, feet }) => {
      const image = await load(sheet);
      if (!image) return null;
      const columns = image.width / cellWidth;
      // Normalize larger sheets to the sizes approved in the standalone preview.
      return feet.map(([footX, footY, previewSize], index) => ({
        image, cellWidth, cellHeight, footX, footY,
        x: index % columns * cellWidth,
        y: Math.floor(index / columns) * cellHeight,
        scaleRatio: previewSize ? previewSize * 512 / (298 * cellHeight) : 1,
      }));
    }));
    return atlases.every(Boolean) ? atlases.flat() : null;
  }

  function create(canvas) {
    const context = canvas.getContext('2d');
    const replay = document.getElementById('picker-preview-replay');
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const posesById = new Map();
    let generation = 0;
    let timer;
    let activeId;

    function stop() {
      generation++;
      clearTimeout(timer);
      activeId = null;
      if (replay) replay.hidden = true;
    }

    async function play(id, requested = false) {
      if (!Object.hasOwn(clips, id)) return false;
      const request = generation;
      const clip = clips[id];
      if (!posesById.has(id)) posesById.set(id, loadPoses(clip));
      const poses = await posesById.get(id);
      if (!poses || request !== generation) return false;
      activeId = id;
      if (replay) replay.hidden = false;
      const scale = (canvas.height - 24) / clip.baseline;
      const floor = canvas.height - 10;

      function draw(frame, offset = 0, lift = 0) {
        const { image, cellWidth, cellHeight, footX, footY, x, y, scaleRatio } = poses[frame];
        const poseScale = scale * scaleRatio;
        const center = canvas.width / 2 + offset * scale;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillStyle = 'rgba(25, 62, 115, .17)';
        context.beginPath();
        context.ellipse(center, floor + 1, 84 * scale, 12 * scale, 0, 0, Math.PI * 2);
        context.fill();
        context.imageSmoothingEnabled = false;
        context.drawImage(image, x, y,
          cellWidth, cellHeight, Math.round(center - footX * poseScale), floor - Math.round(footY * poseScale + lift * scale),
          Math.round(cellWidth * poseScale), Math.round(cellHeight * poseScale));
      }

      function advance(frames, index) {
        const [frame, duration, offset, lift] = frames[index];
        draw(frame, offset, lift);
        timer = setTimeout(() => {
          if (index + 1 < frames.length) advance(frames, index + 1);
          else if (reducedMotion.matches) draw(clip.idle[0][0]);
          else advance(clip.idle, 0);
        }, duration);
      }

      if (reducedMotion.matches && !requested) draw(clip.idle[0][0]);
      else advance(clip.entrance, 0);
      return true;
    }

    replay?.addEventListener('click', () => {
      if (!activeId) return;
      const id = activeId;
      generation++;
      clearTimeout(timer);
      play(id, true);
    });

    return { play, stop };
  }

  window.MiaoRosterPreview = { create };
})();
