const { test } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../static/water-surface.js');
const R = require('../static/water-surface-renderer.js');
const bounds = { left: 36, top: 36, right: 1164, bottom: 600 };

test('pool animation repeats after six seconds with a continuous seam and staggered crests', () => {
  const field = W.create(640, 320, bounds, { preset: 'pool-loop', period: 6 });
  const first = W.sample(field, 0), repeat = W.sample(field, 6);
  for (const key of ['rowX', 'rowY', 'rowLight', 'colX', 'colY', 'colLight', 'wavelets', 'glints']) {
    assert.deepEqual(first[key], repeat[key]);
  }
  const before = W.sample(field, 6 - 0.001), after = W.sample(field, 0.001);
  for (const key of ['rowX', 'colY']) {
    assert.ok(Math.max(...before[key].map((v, i) => Math.abs(v - after[key][i]))) < 0.02);
  }
  assert.notDeepEqual(first.wavelets, W.sample(field, 1.5).wavelets);
  assert.ok(new Set(field.waves.map(w => w.phase)).size > 5);
  assert.ok(first.wavelets.length > 0 && first.wavelets.length < field.waves.length);
  assert.deepEqual(W.sample(field, 0.5).wavelets, W.sample(field, 6.5).wavelets);
});

test('another pool can reuse the loop with its own bounds, colors, scale and direction', () => {
  const b = { left: 80, top: 20, right: 580, bottom: 720 };
  const field = W.create(250, 350, b, { preset: 'pool-loop', period: 8, direction: [0, 4],
    waveScale: 0.7, crestColor: '#ffffff', crestShade: '#123456' });
  assert.deepEqual(field.config.direction, [0, 1]);
  assert.equal(field.config.period, 8); assert.equal(field.config.crestShade, '#123456');
  for (const wave of field.waves) {
    assert.ok(wave.x > b.left && wave.x < b.right && wave.y > b.top && wave.y < b.bottom);
  }
  assert.deepEqual(W.sample(field, 0).wavelets, W.sample(field, 8).wavelets);
  const stopped = W.create(250, 350, b, { preset: 'pool-loop', speed: 0 });
  assert.deepEqual(W.sample(stopped, 0).wavelets, W.sample(stopped, 10).wavelets);
});

test('ambient water changes locally without a shared translation or synchronized glints', () => {
  const field = W.create(640, 320, bounds), first = W.sample(field, 0), later = W.sample(field, 2.5);
  assert.deepEqual(W.sample(field, 2.5), later);
  assert.notDeepEqual(first.rowX, later.rowX);
  assert.notDeepEqual(first.colY, later.colY);
  assert.ok(Math.max(...later.rowX) - Math.min(...later.rowX) > 1);
  assert.ok(Math.max(...later.colY) - Math.min(...later.colY) > 0.5);
  assert.equal(first.rowX[0], 0); assert.equal(first.colY[0], 0);
  assert.ok(new Set(field.glints.map(g => g.phase)).size > 5);
  for (const g of later.glints) {
    assert.ok(g.alpha > 0 && g.alpha <= field.config.glints);
    assert.ok(g.x >= bounds.left && g.x <= bounds.right && g.y >= bounds.top && g.y <= bounds.bottom);
  }
});

test('disturbances are local, bounded, age-filtered and use each map bounds without mutating sources', () => {
  const b = Object.freeze({ left: 20, top: 40, right: 620, bottom: 640 });
  const field = W.create(300, 300, b);
  const source = Object.freeze({ x: 320, y: 340, age: 0.1, strength: 0.8, radius: 60 });
  const sources = Object.freeze([source, { ...source, age: -0.1 }, { ...source, age: 0.7 }]);
  const before = JSON.stringify(sources), state = W.sample(field, 1, sources);
  assert.equal(state.disturbances.length, 1);
  assert.equal(state.disturbances[0].x, 150); assert.equal(state.disturbances[0].y, 150);
  assert.equal(state.disturbances[0].rx, 30); assert.equal(state.disturbances[0].ry, 30);
  assert.equal(JSON.stringify(sources), before);
  assert.deepEqual(field.bounds, b);
  assert.equal(W.sample(field, 1, Array.from({ length: 30 }, () => source)).disturbances.length, 12);
});

test('surface configuration stays finite and tick sampling uses the supplied scene clock', () => {
  const field = W.create(64, 64, bounds, { rate: 1000, amplitude: -8, speed: NaN, tint: 2, glints: 8, color: 'invalid' });
  assert.equal(field.config.rate, 30); assert.equal(field.config.amplitude, 0);
  assert.equal(field.config.speed, 1); assert.equal(field.config.tint, 0.35);
  assert.equal(field.config.glints, 0.7); assert.equal(field.config.color, '#32c8df');
  for (const time of [0, 1/144, 1/60, 1/30, 2.5, NaN, Infinity]) {
    const state = W.sample(field, time);
    for (const key of ['rowX', 'rowY', 'rowLight', 'colX', 'colY', 'colLight']) {
      assert.ok([...state[key]].every(Number.isFinite));
    }
  }
});

function withCanvas(run, fail = false) {
  const original = global.document;
  const data = new Uint8ClampedArray(8 * 4 * 4).fill(255);
  for (let i = 0; i < data.length; i += 4) { data[i] = i % 200; data[i+1] = 180; }
  const source = { width: 8, height: 4, getContext: () => ({
    getImageData: () => ({ data: new Uint8ClampedArray(data) }),
  }) };
  let depth = 0, uploads = 0;
  const draws = [];
  const target = { save() { depth++; }, restore() { depth--; }, drawImage(image) { draws.push(image); }, fillRect() {} };
  global.document = { createElement: () => ({ width: 0, height: 0, getContext: () => ({
    createImageData: (w, h) => ({ data: new Uint8ClampedArray(w*h*4) }),
    putImageData() { uploads++; if (fail) throw new Error('Unavailable canvas'); },
  }) }) };
  try { run({ source, target, data, depth: () => depth, uploads: () => uploads, draws }); }
  finally { global.document = original; }
}

test('water raster is cached by scene tick and leaves the original pixels and canvas state intact', () => {
  withCanvas(({ source, target, data, depth, uploads }) => {
    const before = [...data], surface = R.create(source, bounds, {});
    surface.draw(target, 0, []); surface.draw(target, 0.01, []);
    assert.equal(uploads(), 1);
    surface.draw(target, 1/24, []);
    assert.equal(uploads(), 2);
    surface.draw(target, 1/24, []);
    assert.equal(uploads(), 2);
    surface.reset(); surface.draw(target, 1/24, []);
    assert.equal(uploads(), 3);
    assert.deepEqual([...data], before);
    assert.equal(depth(), 0); assert.equal(surface.snapshot().failed, false);
  });
});

test('a failed dynamic update falls back to the original surface without leaking drawing state', () => {
  withCanvas(({ source, target, depth, draws }) => {
    const surface = R.create(source, bounds, {});
    surface.draw(target, 0.2, []);
    assert.equal(surface.snapshot().failed, true);
    assert.equal(draws.at(-1), source);
    surface.draw(target, 0.3, []);
    assert.equal(draws.at(-1), source); assert.equal(depth(), 0);
  }, true);
});
