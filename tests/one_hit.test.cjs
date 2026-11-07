const { test } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../static/battle.js');

const hit = (a, b, wall = false) => ({ ringIds: [a, b], wall });

test('one-hit testing keeps current HP and bypasses guard only for valid opposing contacts on either turn', () => {
  for (const side of [0, 1]) {
    const match = new B.Match();
    try {
      match.side = side;
      const source = side * 3;
      const target = (1 - side) * 3 + 2;
      match.testOneHit = true;
      assert.deepEqual(match.actors.map(cat => cat.hp), [120, 85, 100, 120, 85, 100]);
      match.launch(source, { x: 20, y: 0 });
      match.handleContact(hit(source, target, true));
      match.handleContact(hit(source, source + 1));
      assert.equal(match.actors[target].hp, 100);
      assert.equal(match.actors[source + 1].hp, 85);
      match.handleContact(hit(source, target));
      assert.equal(match.actors[target].hp, 0);
      assert.equal(match.actors[target].removed, true);
      assert.equal(match.world.snapshot().some(cat => cat.id === target), false);
      assert.equal(match.scores[side], 1);
      const events = match.drainEvents();
      assert.equal(events.find(event => event.type === 'damage').guard, 0);
      assert.equal(events.filter(event => event.type === 'retreat').length, 1);
      match.handleContact(hit(source, target));
      assert.equal(match.drainEvents().length, 0);
      match.reset();
      assert.equal(match.testOneHit, true);
      assert.deepEqual(match.scores, [0, 0]);
      assert.equal(match.actors[target].hp, 100);
    } finally { match.destroy(); }
  }
});

test('turning off restores normal damage and first-hit guard without resetting the match', () => {
  const match = new B.Match();
  try {
    assert.equal(match.testOneHit, false);
    match.launch(0, { x: 20, y: 0 });
    match.handleContact(hit(0, 3));
    assert.equal(match.actors[3].hp, 96);
    match.testOneHit = true;
    match.testOneHit = false;
    assert.equal(match.actors[3].hp, 96);
    assert.equal(match.phase, 'moving');
    match.handleContact(hit(0, 5));
    assert.equal(match.actors[5].hp, 84);
    assert.equal(match.actors[5].shieldUsed, true);
    assert.deepEqual(match.scores, [0, 0]);
  } finally { match.destroy(); }
});

test('real physics contact from full HP triggers the normal retreat event with collision momentum', () => {
  const match = new B.Match({ testOneHit: true });
  try {
    match.launch(0, { x: 1600, y: 0 });
    let retreat;
    for (let frame = 0; frame < 180 && !retreat; frame++) {
      match.advance(1000 / 60);
      retreat = match.drainEvents().find(event => event.type === 'retreat');
    }
    assert.ok(retreat, 'a real collision must produce a retreat');
    assert.ok(Math.hypot(retreat.motion.sourceVelocity.x, retreat.motion.sourceVelocity.y) > 0);
    assert.equal(match.actors[retreat.id].hp, 0);
    assert.equal(match.scores[0], 1);
  } finally { match.destroy(); }
});
