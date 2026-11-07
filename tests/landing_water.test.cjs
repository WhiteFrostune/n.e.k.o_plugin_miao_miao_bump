const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../static/motion.js');
const W = require('../static/landing-water.js');

test('entrance water starts at actual hand contact and ends after settling', () => {
  const track = W.create({ id: 0, x: 270, y: 200 });
  assert.equal(track.touch, M.LANDING.touch);
  assert.ok(track.duration > M.LANDING.duration);
  for (const age of [-0.1, 0, M.LANDING.jump, track.touch - 1e-7]) {
    assert.deepEqual(W.sample(track, age), { rings: [], drops: [] });
  }
  assert.equal(W.sample(track, track.touch).drops.length, 12);
  assert.equal(W.sample(track, track.touch + W.WATER.echoDelay + 0.01).rings.length, 2);
  assert.equal(W.sample(track, M.LANDING.duration + 0.06).drops.length, 0);
  assert.equal(W.sample(track, M.LANDING.duration + 0.06).rings.length, 2);
  assert.deepEqual(W.sample(track, track.duration), { rings: [], drops: [] });
});

test('all returning roles, offsets and radii share finite localized water without mutating inputs', () => {
  for (const id of [0, 1, 2, 3, 4, 5]) {
    for (const radius of [24, 40, 64]) {
      const input = Object.freeze({ id, x: 88 + id * 110, y: 200 });
      const track = Object.freeze(W.create(input, radius));
      const before = JSON.stringify(track);
      for (let age = -0.1; age <= track.duration + 0.1; age += 1 / 144) {
        for (const element of Object.values(W.sample(track, age)).flat()) {
          assert.ok(Object.values(element).every(value => typeof value !== 'number' || Number.isFinite(value)));
          assert.ok(element.alpha >= 0 && element.alpha <= 1);
          assert.ok(Math.abs(element.x - input.x) <= radius * 2);
          if (element.layer) assert.ok(['front', 'back'].includes(element.layer));
        }
      }
      assert.equal(JSON.stringify(track), before);
      assert.deepEqual(input, { id, x: 88 + id * 110, y: 200 });
    }
  }
});

test('droplets travel outward, rise and fall; residual ripples do not become another splash', () => {
  const track = W.create({ id: 3, x: 930, y: 200 });
  const early = W.sample(track, track.touch + 0.01);
  const apex = W.sample(track, track.touch + 0.30);
  const late = W.sample(track, track.touch + 0.40);
  const top = state => state.drops[8];
  assert.ok(top(apex).y < top(early).y);
  assert.ok(top(late).y > top(apex).y);
  assert.ok(Math.abs(top(late).x - track.x) > Math.abs(top(early).x - track.x));
  assert.ok(late.rings[0].radius > early.rings[0].radius);
  assert.ok(late.rings[0].alpha < early.rings[0].alpha);
  const tail = W.sample(track, track.touch + 0.60);
  assert.equal(tail.drops.length, 0);
  assert.ok(tail.rings.every(ring => ring.alpha < 0.1));
});
