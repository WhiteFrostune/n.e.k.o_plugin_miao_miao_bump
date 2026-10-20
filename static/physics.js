/* Browser and Node share this simulation; Matter.js is bundled locally. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./vendor/matter-0.20.0.min.js'));
  } else {
    root.MiaoPhysics = factory(root.Matter);
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (Matter) {
  'use strict';

  const { Engine, Bodies, Body, Composite, Events } = Matter;
  const WIDTH = 960;
  const HEIGHT = 600;
  const RADIUS = 40;
  const BOUNDS = Object.freeze({ left: 44, top: 44, right: 916, bottom: 556 });
  const STEP_MS = 1000 / 240;
  const STOP_SPEED = 12;
  const DEFAULTS = Object.freeze({ drag: 0.8, bounce: 0.94, wallBounce: 0.9, maxSpeed: 1600 });
  const LIMITS = Object.freeze({ drag: [0.35, 1.6], bounce: [0.55, 0.99], wallBounce: [0.55, 0.99], maxSpeed: [800, 2200] });
  const LAYOUTS = Object.freeze({
    free: [[250, 345], [500, 235], [715, 365]],
    wall: [[300, 300]],
    duel: [[260, 300], [615, 300]],
    chain: [[220, 300], [480, 300], [735, 300]],
    corner: [[86, 86], [168, 86], [86, 168]],
  });
  const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

  function launchVector(start, end, maxSpeed = DEFAULTS.maxSpeed) {
    const dx = start.x - end.x;
    const dy = start.y - end.y;
    const distance = Math.hypot(dx, dy);
    const power = distance < 6 ? 0 : clamp(distance / 180, 0, 1);
    if (!power) return { x: 0, y: 0, power: 0 };
    return {
      x: distance ? dx / distance * maxSpeed * power : 0,
      y: distance ? dy / distance * maxSpeed * power : 0,
      power,
    };
  }

  // Sweep a circle centre against inset walls and circles expanded by its radius.
  function firstContact(origin, direction, rings, excludedId) {
    const length = Math.hypot(direction.x, direction.y);
    if (!length) return null;
    const d = { x: direction.x / length, y: direction.y / length };
    let best = null;
    const accept = (distance, normal, type) => {
      if (distance >= -0.001 && (!best || distance < best.distance)) {
        best = { distance: Math.max(0, distance), normal, type };
      }
    };
    if (d.x > 1e-8) accept((BOUNDS.right - RADIUS - origin.x) / d.x, { x: -1, y: 0 }, 'wall');
    if (d.x < -1e-8) accept((BOUNDS.left + RADIUS - origin.x) / d.x, { x: 1, y: 0 }, 'wall');
    if (d.y > 1e-8) accept((BOUNDS.bottom - RADIUS - origin.y) / d.y, { x: 0, y: -1 }, 'wall');
    if (d.y < -1e-8) accept((BOUNDS.top + RADIUS - origin.y) / d.y, { x: 0, y: 1 }, 'wall');
    for (const ring of rings) {
      if (ring.id === excludedId) continue;
      const ox = origin.x - ring.x;
      const oy = origin.y - ring.y;
      const projection = ox * d.x + oy * d.y;
      const c = ox * ox + oy * oy - (RADIUS * 2) ** 2;
      if (projection >= 0) continue;
      const discriminant = projection * projection - c;
      if (discriminant < 0) continue;
      const distance = -projection - Math.sqrt(discriminant);
      const px = origin.x + d.x * Math.max(0, distance) - ring.x;
      const py = origin.y + d.y * Math.max(0, distance) - ring.y;
      const n = Math.hypot(px, py) || 1;
      accept(c < 0 ? 0 : distance, { x: px / n, y: py / n }, 'ring');
    }
    return best ? { ...best, x: origin.x + d.x * best.distance, y: origin.y + d.y * best.distance, direction: d } : null;
  }

  class PoolWorld {
    constructor(options = {}) {
      this.params = { ...DEFAULTS };
      this.engine = Engine.create({ gravity: { x: 0, y: 0, scale: 0 }, positionIterations: 8, velocityIterations: 8 });
      this._collisionHandler = event => this._collisions(event.pairs, true);
      this._activeHandler = event => this._collisions(event.pairs, false);
      Events.on(this.engine, 'collisionStart', this._collisionHandler);
      Events.on(this.engine, 'collisionActive', this._activeHandler);
      this.setParams(options);
      this.reset('free');
    }

    setParams(updates) {
      if (this.moving) return false;
      for (const [key, range] of Object.entries(LIMITS)) {
        if (Number.isFinite(updates[key])) this.params[key] = clamp(updates[key], ...range);
      }
      if (this.rings) for (const ring of this.rings) ring.body.restitution = this.params.bounce;
      return true;
    }

    setMass(id, value) {
      const ring = this.rings.find(r => r.id === id);
      if (this.moving || !ring || !Number.isFinite(value)) return false;
      Body.setMass(ring.body, clamp(value, 0.5, 3.5));
      return true;
    }

    reset(layout = this.layout || 'free') {
      if (!Object.hasOwn(LAYOUTS, layout)) layout = 'free';
      Composite.clear(this.engine.world, false);
      Engine.clear(this.engine);
      this.layout = layout;
      this.moving = false;
      this.elapsed = 0;
      this.count = 0;
      this.accumulator = 0;
      this.quietTime = 0;
      this.maxSpeed = 0;
      this.impacts = [];
      this.fault = false;
      this._lastImpacts = new Map();
      this._velocities = new Map();
      const wallOptions = { isStatic: true, friction: 0, frictionStatic: 0, restitution: this.params.wallBounce };
      const walls = [
        Bodies.rectangle(24, 300, 40, 680, wallOptions),
        Bodies.rectangle(936, 300, 40, 680, wallOptions),
        Bodies.rectangle(480, 24, 960, 40, wallOptions),
        Bodies.rectangle(480, 576, 960, 40, wallOptions),
      ];
      Composite.add(this.engine.world, walls);
      this.rings = LAYOUTS[layout].map(([x, y], id) => {
        const body = Bodies.circle(x, y, RADIUS, {
          friction: 0, frictionStatic: 0, frictionAir: 0, restitution: this.params.bounce,
          inertia: Infinity, slop: 0.01, label: `ring-${id}`,
        }, 64);
        Body.setMass(body, 1);
        body.plugin.ringId = id;
        Composite.add(this.engine.world, body);
        return { id, body };
      });
    }

    launch(id, velocity) {
      const ring = this.rings.find(r => r.id === id);
      const speed = Math.hypot(velocity.x, velocity.y);
      if (this.moving || !ring || !Number.isFinite(speed) || speed < STOP_SPEED) return false;
      const scale = Math.min(1, this.params.maxSpeed / speed) / 60;
      Body.setVelocity(ring.body, { x: velocity.x * scale, y: velocity.y * scale });
      this.moving = true;
      this.elapsed = 0;
      this.count = 0;
      this.maxSpeed = Math.min(speed, this.params.maxSpeed);
      this.quietTime = 0;
      this.accumulator = 0;
      this.fault = false;
      this.impacts = [];
      this._lastImpacts.clear();
      return true;
    }

    _collisions(pairs, started) {
      for (const pair of pairs) {
        const wall = pair.bodyA.isStatic || pair.bodyB.isStatic;
        // Matter defaults to max(A.restitution, B.restitution); use independent controls.
        pair.restitution = wall ? this.params.wallBounce : this.params.bounce;
        if (!started || !this.moving) continue;
        const a = this._velocities.get(pair.bodyA.id) || { x: 0, y: 0 };
        const b = this._velocities.get(pair.bodyB.id) || { x: 0, y: 0 };
        const normal = pair.collision.normal;
        const impactSpeed = Math.abs((a.x - b.x) * normal.x + (a.y - b.y) * normal.y);
        const key = [pair.bodyA.id, pair.bodyB.id].sort((x, y) => x - y).join(':');
        if (impactSpeed < 65 || this.elapsed - (this._lastImpacts.get(key) ?? -1) < 0.1) continue;
        this._lastImpacts.set(key, this.elapsed);
        this.count += 1;
        const dynamic = pair.bodyA.isStatic ? pair.bodyB : pair.bodyA;
        const support = pair.collision.supports.find(Boolean) || dynamic.position;
        const ringIds = [pair.bodyA, pair.bodyB].filter(body => !body.isStatic).map(body => body.plugin.ringId);
        this.impacts.push({ x: support.x, y: support.y, speed: impactSpeed, wall,
          ringId: dynamic.plugin.ringId, ringIds, normal: { x: normal.x, y: normal.y } });
      }
    }

    step() {
      if (!this.moving) return;
      const dt = STEP_MS / 1000;
      this.elapsed += dt;
      const decay = Math.exp(-this.params.drag * dt);
      this._velocities.clear();
      for (const { body } of this.rings) {
        const v = Body.getVelocity(body);
        this._velocities.set(body.id, { x: v.x * 60, y: v.y * 60 });
        Body.setVelocity(body, { x: v.x * decay, y: v.y * decay });
      }
      Engine.update(this.engine, STEP_MS);
      this.maxSpeed = 0;
      for (const { body } of this.rings) this.maxSpeed = Math.max(this.maxSpeed, Body.getSpeed(body) * 60);
      this.quietTime = this.maxSpeed < STOP_SPEED ? this.quietTime + dt : 0;
      if (!Number.isFinite(this.maxSpeed) || this.elapsed > 45) {
        this.fault = true;
        this._stop();
      } else if (this.quietTime >= 0.22) {
        this._stop();
      }
    }

    _stop() {
      for (const { body } of this.rings) {
        Body.setVelocity(body, { x: 0, y: 0 });
        Body.setAngularVelocity(body, 0);
      }
      this.maxSpeed = 0;
      this.moving = false;
      this.accumulator = 0;
    }

    advance(milliseconds) {
      if (!this.moving || !Number.isFinite(milliseconds) || milliseconds <= 0) return;
      this.accumulator += Math.min(milliseconds, 100);
      let steps = 0;
      while (this.moving && this.accumulator + 1e-8 >= STEP_MS && steps < 25) {
        this.accumulator -= STEP_MS;
        this.step();
        steps += 1;
      }
    }

    snapshot() {
      return this.rings.map(({ id, body }) => ({
        id, x: body.position.x, y: body.position.y,
        vx: Body.getVelocity(body).x * 60, vy: Body.getVelocity(body).y * 60, mass: body.mass,
      }));
    }

    drainImpacts() {
      return this.impacts.splice(0);
    }

    destroy() {
      Events.off(this.engine, 'collisionStart', this._collisionHandler);
      Events.off(this.engine, 'collisionActive', this._activeHandler);
      Composite.clear(this.engine.world, false);
      Engine.clear(this.engine);
      this.rings = [];
      this.moving = false;
    }
  }

  return { PoolWorld, launchVector, firstContact, WIDTH, HEIGHT, RADIUS, BOUNDS, DEFAULTS, LIMITS, LAYOUTS, STEP_MS };
});
