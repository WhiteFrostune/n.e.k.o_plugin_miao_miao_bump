'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Maps = require('../static/maps.js');
const P = require('../static/physics.js');
const B = require('../static/battle.js');
const fixture = require('./fixtures/square-map.json');
const clone = value => JSON.parse(JSON.stringify(value));

test('map registry validates and freezes independent input; unknown ids fall back without mutation', () => {
  const input = clone(fixture);
  input.id = 'registered-square';
  const map = Maps.register(input);
  input.world.bounds.left = 300;
  input.spawns[0][0].x = 900;
  assert.equal(map.world.bounds.left, 60);
  assert.equal(map.spawns[0][0].x, 180);
  assert.throws(() => { map.world.bounds.left = 500; }, TypeError);
  assert.equal(Maps.resolve('registered-square').map, map);
  assert.equal(Maps.resolve('registered-square').fallback, false);
  assert.throws(() => Maps.register(input), /Invalid map/);
  assert.deepEqual(Maps.resolve('missing-map'), { map: Maps.get(), fallback: true, requestedId: 'missing-map' });
  assert.deepEqual(Maps.list().map(item => item.id), ['summer-pool', 'registered-square']);
});

test('invalid geometry, overlapping spawns, unsupported rules and unsafe art paths are rejected', () => {
  const invalid = [
    map => { map.world.width = Infinity; },
    map => { map.world.bounds.right = 900; },
    map => { map.world.bounds.left = map.world.bounds.right; },
    map => { map.spawns[0][0].x = 61; },
    map => { map.spawns[1][0] = map.spawns[0][0]; },
    map => { map.spawnRegions[0].right = 200; },
    map => { map.spawnRegions[0].left = 0; },
    map => { map.spawns[0].pop(); },
    map => { map.practiceLayouts = { wall: [[400, 400]] }; },
    map => { map.colliders = [{ type: 'unknown' }]; },
    map => { map.mechanics = [{ type: 'current' }]; },
    map => { map.art.metadata = 'https://example.com/map.json'; },
    map => { map.art.metadata = 'assets/../map.json'; },
  ];
  for (const mutate of invalid) {
    const map = clone(fixture); mutate(map);
    assert.throws(() => Maps.normalize(map), /Invalid map/);
  }
  assert.equal(Maps.resolve('test-square').fallback, true);
});

test('summer reference shots retain pre-refactor contacts, timing and final positions', () => {
  const reference = [
    ['wall', 3, 6.054166666666643, [[486.507024818726, 507.46265985474133]]],
    ['chain', 7, 5.98749999999998, [[735.9107190265557, 516.1354999999862], [108.63421523696464, 369.6648460161871], [871.9368306739317, 330.1391790235049]]],
    ['free', 7, 5.69583333333333, [[467.13424493055413, 322.8378218234768], [291.52015464209734, 516.1354999999719], [448.16860467072354, 112.71491395861915]]],
  ];
  for (const [layout, count, elapsed, positions] of reference) {
    const world = new P.PoolWorld();
    try {
      world.reset(layout); world.launch(0, { x: 1600, y: 260 });
      while (world.moving) world.advance(1000 / 60);
      assert.equal(world.count, count);
      assert.ok(Math.abs(world.elapsed - elapsed) < 1e-9);
      world.snapshot().forEach((ring, i) => assert.ok(Math.hypot(ring.x - positions[i][0], ring.y - positions[i][1]) < 1e-6));
    } finally { world.destroy(); }
  }
});

test('custom map drives all four aim boundaries and the actual wall bounce at high speed', () => {
  for (const direction of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
    const world = new P.PoolWorld({ map: fixture });
    try {
      world.reset('wall');
      const origin = world.snapshot()[0];
      const hit = P.firstContact(origin, direction, world.snapshot(), 0, world.map);
      assert.equal(hit.type, 'wall');
      if (direction.x) assert.equal(hit.x, direction.x > 0 ? 700 : 100);
      if (direction.y) assert.equal(hit.y, direction.y > 0 ? 690 : 110);
      world.launch(0, { x: direction.x * 1600, y: direction.y * 1600 });
      while (!world.count && world.moving) world.step();
      const ring = world.snapshot()[0];
      assert.ok(direction.x ? ring.vx * direction.x < 0 : ring.vy * direction.y < 0);
      assert.ok(Math.hypot(ring.x - hit.x, ring.y - hit.y) < 12);
    } finally { world.destroy(); }
  }
});

test('two map worlds coexist; practice reset and battle reset preserve their own map and spawn positions', () => {
  const summer = new P.PoolWorld();
  const square = new P.PoolWorld({ map: fixture });
  const match = new B.Match({ map: fixture });
  try {
    assert.equal(summer.map.world.width, 960);
    assert.equal(square.map.world.width, 800);
    square.launch(0, { x: 1400, y: 200 });
    square.advance(100); square.reset('chain');
    assert.equal(square.moving, false);
    assert.equal(square.map.id, 'test-square');
    assert.equal(square._contacts.size, 0);
    const spawns = fixture.spawns.flat();
    match.actors.forEach((cat, i) => assert.deepEqual({ x: cat.x, y: cat.y }, spawns[i]));
    match.launch(0, { x: 1400, y: 100 }); match.advance(100); match.reset();
    assert.equal(match.snapshot().map.id, 'test-square');
    match.world.snapshot().forEach((cat, i) => assert.deepEqual({ x: cat.x, y: cat.y }, spawns[i]));
    assert.deepEqual(summer.snapshot().map(cat => [cat.x, cat.y]), P.LAYOUTS.free);
  } finally { summer.destroy(); square.destroy(); match.destroy(); }
});

test('CPU plays full games using square-map geometry for both starting sides', () => {
  for (const opener of [0, 1]) {
    const match = new B.Match({ map: fixture });
    try {
      match.side = opener;
      for (let turn = 0; match.phase === 'ready' && turn < 160; turn += 1) {
        const state = match.snapshot();
        // JSON transport must not depend on Map registry identity in the AI.
        const shot = B.chooseShot(clone(state));
        assert.ok(shot && match.launch(shot.id, shot));
        while (match.phase === 'moving') match.advance(1000 / 60);
        assert.notEqual(match.phase, 'fault');
        assert.ok(match.actors.filter(cat => cat.team === state.side).every(cat => cat.hp === state.actors[cat.id].hp));
        for (const ring of match.world.snapshot()) {
          assert.ok(ring.x >= 99 && ring.x <= 701 && ring.y >= 109 && ring.y <= 691);
        }
      }
      assert.equal(match.phase, 'over');
      assert.ok([0, 1].includes(match.winner));
    } finally { match.destroy(); }
  }
});
