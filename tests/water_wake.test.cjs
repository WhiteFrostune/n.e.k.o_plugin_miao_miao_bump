const { test } = require('node:test');
const assert = require('node:assert/strict');
const W = require('../static/water-wake.js');
const P = require('../static/physics.js');
const ring = (x, y = 200, vx = 800, vy = 0, id = 0) => ({ id, x, y, vx, vy });

test('distance emission and lifetime match across 30, 60 and 144 display frames per second', () => {
  const runs = [30, 60, 144].map(fps => {
    const state = W.create();
    W.prime(state, [ring(100)]);
    for (let i = 1; i <= fps; i++) W.advance(state, [ring(100 + 800 * i / fps)], 1 / fps);
    return W.sample(state);
  });
  for (const marks of runs.slice(1)) {
    assert.equal(marks.length, runs[0].length);
    for (let i = 0; i < marks.length; i++) {
      for (const key of ['x', 'y', 'alpha', 'age', 'length', 'width']) {
        assert.ok(Math.abs(marks[i][key] - runs[0][i][key]) < 1e-6, key);
      }
    }
  }
});

test('speed changes wake size, brightness and spacing; stationary rings generate nothing', () => {
  const runs = [0, 20, 150, 1200].map(speed => {
    const state = W.create();
    W.prime(state, [ring(100, 200, speed)]);
    for (let i = 1; i <= 20; i++) W.advance(state, [ring(100 + speed * i / 60, 200, speed)], 1 / 60);
    return W.sample(state);
  });
  assert.equal(runs[0].length, 0); assert.equal(runs[1].length, 0);
  const weak = runs[2].at(-1), fast = runs[3].at(-1);
  assert.ok(weak && fast);
  assert.ok(fast.strength > weak.strength && fast.length > weak.length && fast.width > weak.width);
  assert.ok(fast.alpha > weak.alpha);
});

test('bounce starts a new direction while old marks stay fixed and no teleport is connected', () => {
  const state = W.create();
  W.prime(state, [ring(100)]);
  for (let i = 1; i <= 12; i++) W.advance(state, [ring(100 + 800 * i / 60)], 1 / 60);
  const old = state.marks.map(mark => ({ ...mark }));
  W.advance(state, [ring(250, 200, -800)], 1 / 60);
  assert.ok(state.marks.some(mark => mark.dx < 0));
  for (const mark of old) assert.deepEqual(state.marks.find(item => item.born === mark.born), mark);
  const count = state.marks.length;
  W.advance(state, [ring(950, 200, -800)], 1 / 60);
  assert.equal(state.marks.length, count + 1);
  assert.equal(state.marks.at(-1).x, 950);
  assert.ok(!state.marks.some(mark => mark.x > 270 && mark.x < 949));
});

test('stopped or removed cats leave briefly fading water, without emitting new marks', () => {
  for (const removed of [false, true]) {
    const state = W.create();
    W.prime(state, [ring(100)]);
    W.advance(state, [ring(180)], 0.1);
    const count = state.serial, before = W.sample(state);
    W.advance(state, removed ? [] : [ring(180, 200, 0)], 0.1);
    const after = W.sample(state);
    assert.equal(state.serial, count);
    assert.ok(after.length > 0);
    assert.ok(after.at(-1).alpha < before.at(-1).alpha);
    for (let i = 0; i < 7; i++) W.advance(state, [], 0.1);
    assert.deepEqual(W.sample(state), []);
  }
});

test('a paused scene preserves both visible water and the unfinished emission distance', () => {
  const state = W.create();
  W.prime(state, [ring(100)]);
  W.advance(state, [ring(120)], 0.025);
  const serialize = value => JSON.stringify(value, (_, item) => item instanceof Map ? [...item] : item);
  const before = serialize(state);
  W.advance(state, [ring(120)], 0);
  assert.equal(serialize(state), before);
  W.advance(state, [ring(140)], 0.025);
  assert.equal(state.marks.length, 1);
  assert.ok(Math.abs(state.marks[0].x - 132) < 1e-6);
});

test('entry and reduced motion suppress wakes; many moving cats have a bounded history', () => {
  const state = W.create(), rings = Array.from({ length: 6 }, (_, id) => ring(100, 100 + id * 60, 1600, 0, id));
  W.prime(state, rings);
  W.advance(state, rings.map(r => ({ ...r, x: 180 })), 0.05, { blockedIds: [0, 1, 2, 3, 4, 5] });
  assert.equal(state.marks.length, 0);
  for (let i = 1; i <= 120; i++) {
    W.advance(state, rings.map(r => ({ ...r, x: 180 + i * 1600 / 60 })), 1 / 60);
    assert.ok(state.marks.length <= W.CONFIG.maxMarks);
  }
  assert.ok(state.marks.length > 0);
  W.advance(state, rings, 1 / 60, { reducedMotion: true });
  assert.deepEqual(W.sample(state), []);
});

test('wake sampling never alters physics positions, rebound counts or elapsed time', () => {
  const worlds = [new P.PoolWorld(), new P.PoolWorld()], state = W.create();
  try {
    for (const world of worlds) { world.reset('wall'); world.launch(0, { x: 1100, y: 700 }); }
    W.prime(state, worlds[0].snapshot());
    for (let i = 0; i < 260; i++) {
      for (const world of worlds) world.advance(1000 / 60);
      const input = worlds[0].snapshot().map(r => Object.freeze(r));
      const before = JSON.stringify(input);
      W.advance(state, input, 1 / 60); W.sample(state);
      assert.equal(JSON.stringify(input), before);
      assert.deepEqual(worlds[0].snapshot(), worlds[1].snapshot());
      assert.equal(worlds[0].elapsed, worlds[1].elapsed);
      assert.equal(worlds[0].count, worlds[1].count);
    }
  } finally { worlds.forEach(world => world.destroy()); }
});

test('pixel rendering restores canvas state and does not mutate sampled marks', () => {
  const R = require('../static/water-wake-renderer.js'), state = W.create();
  W.prime(state, [ring(100)]); W.advance(state, [ring(180)], 0.1);
  const marks = W.sample(state), before = JSON.stringify(marks);
  let depth = 0, dots = 0;
  const ctx = { save() { depth++; }, restore() { depth--; }, fillRect() { dots++; } };
  R.draw(ctx, marks);
  assert.equal(depth, 0); assert.ok(dots > 0);
  assert.equal(JSON.stringify(marks), before);
});
