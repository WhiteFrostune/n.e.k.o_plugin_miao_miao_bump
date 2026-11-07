const { test } = require('node:test');
const assert = require('node:assert/strict');
const F = require('../static/contact-feedback.js');
const P = require('../static/physics.js');
const B = require('../static/battle.js');
const Matter = require('../static/vendor/matter-0.20.0.min.js');
const event = (speed = 800, axis = { x: 1, y: 0 }, wall = false) => ({
  x: 600, y: 300, speed, wall, ringIds: wall ? [0] : [0, 1],
  centers: wall ? [{ id: 0, x: 600 + axis.x * 40, y: 300 + axis.y * 40 }]
    : [{ id: 0, x: 600 - axis.x * 40, y: 300 - axis.y * 40 },
      { id: 1, x: 600 + axis.x * 40, y: 300 + axis.y * 40 }],
});

test('gentle contact is smaller than a heavy hit, with a fast compression and bounded rebound', () => {
  const weak = F.create(event(40)), strong = F.create(event(1200));
  assert.ok(F.pose(weak, 0.018).along > F.pose(strong, 0.018).along);
  assert.ok(F.pose(strong, 0.018).along < 0.85);
  assert.ok(F.pose(strong, 0.10).along > 1);
  assert.ok(F.sample(strong, 0.10).drops.length > F.sample(weak, 0.10).drops.length);
  assert.ok(F.sample(strong, 0.20).rings[0].radius > F.sample(weak, 0.20).rings[0].radius);
  assert.deepEqual(F.pose(strong, F.CONFIG.poseEnd), { frame: 0, along: 1, across: 1, lean: 0 });
});

test('wall spray points into the pool in every direction; circles and inputs remain read only', () => {
  for (const axis of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]) {
    for (const radius of [24, 40, 64]) {
      const e = event(1200, axis, true);
      const track = F.create(e, { radius });
      const before = JSON.stringify({ e, track });
      for (let age = 0; age < track.duration; age += 1 / 144) {
        const pose = F.pose(track, age);
        assert.ok(Object.values(pose).every(Number.isFinite));
        assert.ok(pose.along >= 0.81 && pose.along <= 1.07);
        for (const drop of F.sample(track, age).drops) {
          assert.ok((drop.x - track.x) * axis.x + (drop.y - track.y) * axis.y >= -1e-6);
          assert.ok(drop.alpha >= 0 && drop.alpha <= 1);
        }
      }
      assert.equal(JSON.stringify({ e, track }), before);
      assert.deepEqual(F.sample(track, track.duration), { rings: [], drops: [] });
    }
  }
});

test('simplified motion has a short ripple with no squash, shake or spray', () => {
  const track = F.create(event(), { reducedMotion: true });
  for (const age of [0, 0.018, 0.1, 0.2]) {
    const pose = F.pose(track, age);
    assert.equal(pose.along, 1); assert.equal(pose.across, 1); assert.equal(pose.lean, 0);
    assert.equal(F.sample(track, age).drops.length, 0);
    assert.equal(F.sample(track, age).rings.length, 1);
  }
  assert.equal(track.duration, 0.22);
});

test('pose curves join continuously and missing center data preserves a vertical normal', () => {
  const track = F.create({ x: 100, y: 200, speed: 900, normal: { x: 0, y: -1 }, ringIds: [0] });
  assert.deepEqual(track.axis, { x: 0, y: -1 });
  for (const t of [0, 0.018, 0.055, 0.09, 0.1, 0.16, 0.21, 0.22, 0.34]) {
    const before = F.pose(track, t - 1e-6), after = F.pose(track, t + 1e-6);
    for (const key of ['along', 'across', 'lean']) assert.ok(Math.abs(after[key] - before[key]) < 0.0001);
  }
});

test('real sub-65-speed contacts get presentation events while the old counter stays unchanged', () => {
  const world = new P.PoolWorld();
  try {
    world.reset('duel', [{ id: 0, x: 300, y: 300 }, { id: 1, x: 381, y: 300 }]);
    world.launch(0, { x: 40, y: 0 });
    const contacts = [];
    for (let i = 0; i < 120; i++) { world.step(); contacts.push(...world.drainVisualContacts()); }
    assert.equal(contacts.length, 1);
    assert.ok(contacts[0].speed > 0 && contacts[0].speed < 65);
    assert.ok(contacts[0].simulationTime > 0);
    assert.equal(contacts[0].centers.length, 2);
    assert.equal(world.count, 0);
    assert.deepEqual(world.drainImpacts(), []);
    world.reset();
    assert.deepEqual(world.drainVisualContacts(), []);
  } finally { world.destroy(); }
});

test('draining and sampling ordinary feedback preserves actual damage, speeds, scores and opportunities', () => {
  const matches = [new B.Match(), new B.Match()];
  try {
    for (const match of matches) {
      Matter.Body.setPosition(match.world.rings.find(r => r.id === 3).body, { x: 351, y: 200 });
      match.launch(0, { x: 40, y: 0 });
    }
    let seen = 0;
    for (let i = 0; i < 90; i++) {
      for (const match of matches) match.advance(1000 / 60);
      for (const contact of matches[0].world.drainVisualContacts()) {
        const effect = F.create(contact);
        F.pose(effect, 0.018); F.sample(effect, 0.1); seen++;
      }
      assert.deepEqual(matches[0].world.snapshot(), matches[1].world.snapshot());
      assert.deepEqual(matches[0].snapshot(), matches[1].snapshot());
    }
    assert.ok(seen > 0);
    assert.equal(matches[0].actors[3].hp, 96);
    assert.deepEqual(matches[0].scores, [0, 0]);
    assert.equal(matches[0].actors[0].usedThisRound, true);
  } finally { for (const match of matches) match.destroy(); }
});

test('genuine rapid recontacts both reach presentation even inside the old 75ms interval', () => {
  const world = new P.PoolWorld();
  try {
    world.reset('duel', [{ id: 0, x: 163, y: 300 }, { id: 1, x: 81, y: 300 }]);
    const actual = [], visuals = [];
    world.onContact = impact => actual.push({ time: world.elapsed, ids: [...impact.ringIds] });
    world.launch(0, { x: -1600, y: 0 });
    for (let i = 0; i < 45; i++) { world.step(); visuals.push(...world.drainVisualContacts()); }
    const rings = visuals.filter(impact => !impact.wall);
    assert.equal(actual.length, 2);
    assert.equal(rings.length, actual.length);
    assert.ok(actual[1].time - actual[0].time < 0.075);
    assert.equal(world.count, 2); // The original high-speed counter still filters the repeat.
  } finally { world.destroy(); }
});

test('a weak follow-up cannot erase a strong compression, and later distinct hits still react', () => {
  const strong = F.create(event(1100)), weak = F.create(event(60));
  const previous = { ...F.reaction(null, strong), age: 0.02 };
  const before = JSON.stringify(previous);
  assert.equal(F.reaction(previous, weak), previous);
  const later = F.reaction({ ...previous, age: 0.08 }, weak);
  assert.equal(later.ordinary, weak);
  assert.equal(JSON.stringify(previous), before);
  const stronger = F.create(event(1400, { x: 0, y: 1 }));
  assert.equal(F.reaction(previous, stronger).ordinary, stronger);
});

test('one local burst merges nearby simultaneous splashes but preserves wall direction and distinct contacts', () => {
  const weak = F.create(event(100)), strong = F.create(event(1200));
  weak.age = 0.012; strong.x += 4;
  const wall = F.create(event(900, { x: 1, y: 0 }, true));
  const far = F.create(event(800)); far.x += 120;
  const late = F.create(event(800)); late.age = 0.1;
  const input = [weak, strong, wall, far, late];
  input.forEach(Object.freeze); Object.freeze(input);
  const before = JSON.stringify(input), output = F.compact(input);
  assert.equal(output.length, 4);
  assert.ok(output.includes(strong) && !output.includes(weak));
  assert.ok(output.includes(wall) && output.includes(far) && output.includes(late));
  assert.equal(JSON.stringify(input), before);
  const busy = Array.from({ length: 80 }, (_, i) => ({ ...strong, x: i * 90, age: i / 1000 }));
  const capped = F.compact(busy);
  assert.equal(capped.length, F.CONFIG.maxEffects);
  assert.ok(capped.flatMap(fx => F.sample(fx, fx.age).drops).length <= 160);
});
