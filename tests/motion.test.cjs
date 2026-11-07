const { test } = require('node:test');
const assert = require('node:assert/strict');
const M = require('../static/motion.js');
const Maps = require('../static/maps.js');
const map = Maps.get('summer-pool');

test('explicit game motion choice overrides the system; invalid or absent choices follow it', () => {
  for (const systemReduced of [false,true]) {
    assert.deepEqual(M.resolveMotion('full',systemReduced),{preference:'full',reduced:false});
    assert.deepEqual(M.resolveMotion('reduce',systemReduced),{preference:'reduce',reduced:true});
    for (const choice of [undefined,null,'system','invalid']) {
      assert.deepEqual(M.resolveMotion(choice,systemReduced),{preference:'system',reduced:systemReduced});
    }
  }
});

test('one flight track works for all art sizes, map sizes and departure directions without mutating the event', () => {
  for (const world of [map.world, { width: 800, height: 800 }]) {
    const viewport = { left: -200, top: -170, right: world.width + 200, bottom: world.height + 80 };
    for (const direction of [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }, { x: -2, y: 3 }]) {
      for (const spriteBox of [{ x: -46, y: -85, width: 92, height: 125 }, { x: -60, y: -150, width: 120, height: 190 }]) {
        const event = { x: world.width / 2, y: world.height / 2, direction };
        const before = JSON.stringify(event);
        const track = M.createFlight(event, { spriteBox });
        const start = M.sampleFlight(track, 0, { world }, viewport);
        assert.deepEqual([start.x, start.y, start.scale, start.alpha], [event.x, event.y, 1, 1]);
        const visible = M.sampleFlight(track, track.duration * 0.5, { world }, viewport);
        assert.equal(visible.alpha, 1);
        assert.ok(visible.lift > 0 && visible.scale > 0.7);
        assert.ok(Math.abs(visible.rotation) > 1);
        const end = M.sampleFlight(track, track.duration, { world }, viewport);
        assert.ok(end.x < viewport.left - track.extent + 1e-6 || end.x > viewport.right + track.extent - 1e-6
          || end.y < viewport.top - track.extent + 1e-6 || end.y > viewport.bottom + track.extent - 1e-6);
        assert.equal(end.alpha, 0);
        for (let i = 0; i <= 110; i++) {
          assert.ok(Object.values(M.sampleFlight(track, i / 100, { world }, viewport)).every(Number.isFinite));
        }
        assert.equal(JSON.stringify(event), before);
      }
    }
  }
});

test('launch remains readable before acceleration; reduced motion skips arc and spin', () => {
  const event = { x: 270, y: 200, direction: { x: 1, y: 0 } };
  const track = M.createFlight(event);
  const pop = M.sampleFlight(track, 0.07, map);
  assert.equal(pop.x, event.x);
  assert.ok(pop.scale > 1.08 && pop.alpha === 1 && pop.y < event.y);
  const reduced = M.createFlight(event, { reducedMotion: true });
  assert.equal(reduced.duration, 0.25);
  for (let i = 0; i <= 10; i++) {
    const pose = M.sampleFlight(reduced, reduced.duration * i / 10, map);
    assert.equal(pose.rotation, 0);
    assert.equal(pose.y, pose.shadowY);
    assert.ok(Math.hypot(pose.x - event.x, pose.y - event.y) <= 24.01);
  }
});

test('degenerate directions, custom timing and out-of-range ages stay bounded', () => {
  for (const direction of [{ x: 0, y: 0 }, { x: NaN, y: Infinity }]) {
    const track = M.createFlight({ x: 600, y: 318, direction, duration: 2 });
    assert.equal(track.duration, 2);
    assert.deepEqual(track.direction, { x: 1, y: 0 });
    const before = M.sampleFlight(track, -1, map);
    const after = M.sampleFlight(track, 20, map);
    assert.equal(before.alpha, 1);
    assert.equal(after.alpha, 0);
    assert.ok(Object.values(after).every(Number.isFinite));
  }
});

test('split pieces depart independently, stay inside one presentation window and respect reduced motion', () => {
  const definitions = require('../static/assets/characters/knockout-v1/juzi.json').parts;
  const saved = JSON.stringify(definitions);
  for (const direction of [{x:1,y:0}, {x:-1,y:0}, {x:0,y:1}, {x:0,y:-1}, {x:0,y:0}]) {
    for (const reducedMotion of [false, true]) {
      const event = { x:600, y:318, direction, duration:reducedMotion ? 0.25 : 1.1 };
      const tracks = M.createFlightParts(event, definitions, { reducedMotion });
      assert.deepEqual(tracks.map(t => t.partId), ['float', 'character']);
      assert.ok(tracks.every(t => t.duration === event.duration));
      const poses = tracks.map(t => M.sampleFlight(t, t.duration * 0.5, map));
      if (!reducedMotion) assert.ok(Math.hypot(poses[0].x - poses[1].x, poses[0].y - poses[1].y) > 25);
      for (const track of tracks) {
        const pose = M.sampleFlight(track, event.duration, map);
        assert.equal(pose.alpha, 0);
        assert.ok(Object.values(pose).every(Number.isFinite));
        if (reducedMotion) {
          assert.equal(pose.rotation, 0); assert.equal(pose.lift, 0);
        } else {
          assert.ok(pose.x < 0 || pose.x > map.world.width || pose.y < 0 || pose.y > map.world.height);
        }
      }
    }
  }
  assert.equal(JSON.stringify(definitions), saved);
});

test('ejection starts on impact, shares momentum, releases the ring later and never lands back in the pool', () => {
  const definitions = require('../static/assets/characters/knockout-v1/juzi.json').parts;
  for (const world of [map.world, {width:800,height:800}]) {
    for (const direction of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]) {
      const event = {x:world.width/2,y:world.height-80,direction};
      const viewport = {left:-300,top:-150,right:world.width+300,bottom:world.height+120};
      const [ring, cat] = M.createFlightParts(event, definitions);
      assert.deepEqual(cat.direction, ring.direction);
      const early = M.sampleFlight(cat, 0.025, {world}, viewport);
      const lateRing = M.sampleFlight(ring, 0.025, {world}, viewport);
      assert.ok(early.lift > 20, 'cat must lift immediately instead of waiting');
      assert.equal(lateRing.lift, 0, 'ring initially lags at the contact');
      for (const track of [cat,ring]) {
        let previousY = event.y;
        for (let i=0;i<=110;i++) {
          const p=M.sampleFlight(track,i/100,{world},viewport);
          assert.ok(p.y <= previousY + 1e-6, 'no visible falling back toward the water');
          assert.ok(p.scale >= 1 && p.stretchX >= 0.3 && p.stretchY >= 0.3);
          if (p.alpha < 1) assert.ok(p.y < viewport.top-track.extent*p.scale,
            'do not fade while still over the pool');
          previousY=p.y;
        }
        const before=M.sampleFlight(track,0.0649,{world},viewport);
        const after=M.sampleFlight(track,0.0651,{world},viewport);
        assert.ok(Math.hypot(after.x-before.x,after.y-before.y) < 1, 'no hard change at art blend end');
      }
    }
  }
});
