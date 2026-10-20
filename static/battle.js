/* Local combat rules. No DOM, timers, network or model calls. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./physics.js'));
  else root.MiaoBattle = factory(root.MiaoPhysics);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  'use strict';
  const ROLES = Object.freeze([
    Object.freeze({ key: 'juzi', hp: 120, attack: 24, mass: 1.6, wallBonus: 0 }),
    Object.freeze({ key: 'pudding', hp: 85, attack: 18, mass: 1, wallBonus: 0.07 }),
    Object.freeze({ key: 'milkcap', hp: 100, attack: 20, mass: 1, wallBonus: 0 }),
  ]);
  const START = [[200, 160], [300, 300], [200, 440], [760, 160], [660, 300], [760, 440]];

  class Match {
    constructor() {
      this.world = new P.PoolWorld();
      this.world.onContact = contact => this.handleContact(contact);
      this.reset();
    }

    reset() {
      this.side = 0;
      this.turn = 1;
      this.phase = 'ready';
      this.winner = null;
      this.activeId = null;
      this.events = [];
      this.actors = START.map(([x, y], id) => {
        const role = id % 3;
        const stats = ROLES[role];
        return { id, role, team: id < 3 ? 0 : 1, hp: stats.hp, maxHp: stats.hp,
          attack: stats.attack, mass: stats.mass, wallBonus: stats.wallBonus,
          shieldUsed: false, removed: false, x, y };
      });
      this.world.setParams(P.DEFAULTS);
      this.world.reset('battle', this.actors);
    }

    canLaunch(id) {
      const cat = this.actors.find(item => item.id === id);
      return this.phase === 'ready' && Boolean(cat && cat.hp > 0 && !cat.removed && cat.team === this.side);
    }

    launch(id, velocity) {
      if (!this.canLaunch(id)) return false;
      const cat = this.actors.find(item => item.id === id);
      // Equal launch energy: heavier Juzi resists displacement but starts more slowly.
      const scale = 1 / Math.sqrt(cat.mass);
      if (!this.world.launch(id, { x: velocity.x * scale, y: velocity.y * scale })) return false;
      for (const defender of this.actors) if (defender.team !== this.side) defender.shieldUsed = false;
      this.activeId = id;
      this.phase = 'moving';
      this.events.push({ type: 'launch', id });
      return true;
    }

    handleContact(contact) {
      if (this.phase !== 'moving' || contact.wall || contact.ringIds.length !== 2) return;
      const [a, b] = contact.ringIds.map(id => this.actors.find(cat => cat.id === id));
      if (!a || !b || a.hp <= 0 || b.hp <= 0 || a.team === b.team) return;
      // The acting TEAM owns the damage. Its cat can be stationary or unselected.
      const attacker = a.team === this.side ? a : b;
      const defender = a.team === this.side ? b : a;
      const guard = defender.role === 2 && !defender.shieldUsed ? 8 : 0;
      if (guard) defender.shieldUsed = true;
      const damage = Math.min(defender.hp, Math.max(0, attacker.attack - guard));
      defender.hp -= damage;
      this.events.push({ type: 'damage', id: defender.id, attacker: attacker.id, damage, guard });
      if (defender.hp === 0) this.world.disablePassives(defender.id);
    }

    advance(milliseconds) {
      if (this.phase !== 'moving') return;
      this.world.advance(milliseconds);
      if (this.world.moving) return;
      if (this.world.fault) {
        this.phase = 'fault';
        this.events.push({ type: 'fault' });
        return;
      }
      const rings = this.world.snapshot();
      const departed = this.actors.filter(cat => cat.hp <= 0 && !cat.removed);
      for (const cat of departed) {
        cat.removed = true;
        this.events.push({ type: 'retreat', ...rings.find(ring => ring.id === cat.id), role: cat.role });
      }
      this.world.remove(departed.map(cat => cat.id));
      const alive = [0, 1].map(team => this.actors.some(cat => cat.team === team && cat.hp > 0));
      if (!alive[0] || !alive[1]) {
        this.phase = 'over';
        this.winner = alive[0] ? 0 : alive[1] ? 1 : 'draw';
        this.events.push({ type: 'result', winner: this.winner });
      } else {
        this.side = 1 - this.side;
        this.turn += 1;
        this.activeId = null;
        this.phase = 'ready';
        this.events.push({ type: 'turn', side: this.side });
      }
    }

    snapshot() {
      const rings = this.world.snapshot();
      return { side: this.side, turn: this.turn, phase: this.phase, winner: this.winner, activeId: this.activeId,
        actors: this.actors.map(cat => ({ ...cat, ...rings.find(ring => ring.id === cat.id) })) };
    }

    drainEvents() { return this.events.splice(0); }

    destroy() { this.world.destroy(); this.events = []; }
  }

  // Sample direct and single-wall paths at several offsets and strengths. This is
  // deliberately an estimate, not a full-chain simulation or an exact aim assist.
  function chooseShot(state, params = P.DEFAULTS) {
    const cats = state.actors.filter(cat => cat.hp > 0 && !cat.removed);
    const friends = cats.filter(cat => cat.team === state.side);
    const opponents = cats.filter(cat => cat.team !== state.side);
    if (state.phase !== 'ready' || !friends.length || !opponents.length) return null;
    const lowX = P.BOUNDS.left + P.RADIUS, highX = P.BOUNDS.right - P.RADIUS;
    const lowY = P.BOUNDS.top + P.RADIUS, highY = P.BOUNDS.bottom - P.RADIUS;
    let best = null;
    for (const cat of friends) for (const target of opponents) {
      const images = [[target.x, target.y], [2 * lowX - target.x, target.y],
        [2 * highX - target.x, target.y], [target.x, 2 * lowY - target.y], [target.x, 2 * highY - target.y]];
      for (const [x, y] of images) for (const offset of [0, -0.09, 0.09]) for (const power of [0.6, 0.8, 1]) {
        const angle = Math.atan2(y - cat.y, x - cat.x) + offset;
        const direction = { x: Math.cos(angle), y: Math.sin(angle) };
        let hit = P.firstContact(cat, direction, cats, cat.id);
        if (!hit) continue;
        let distance = hit.distance;
        let speed = params.maxSpeed * power / Math.sqrt(cat.mass);
        let wallBonus = 0;
        if (hit.type === 'wall') {
          speed = Math.max(0, speed - params.drag * distance) * Math.min(0.99, params.wallBounce + cat.wallBonus);
          const dot = direction.x * hit.normal.x + direction.y * hit.normal.y;
          const reflected = { x: direction.x - 2 * dot * hit.normal.x, y: direction.y - 2 * dot * hit.normal.y };
          const start = { x: hit.x + reflected.x * 0.1, y: hit.y + reflected.y * 0.1 };
          hit = P.firstContact(start, reflected, cats, cat.id);
          if (!hit) continue;
          wallBonus = cat.role === 1 ? 2 : 0;
        }
        speed -= params.drag * hit.distance;
        let score = -distance * 0.002;
        // Reach estimate only: this is the simulation's natural stop speed, not a damage threshold.
        if (hit.type === 'ring' && speed > P.STOP_SPEED) {
          const victim = cats.reduce((closest, candidate) => {
            if (candidate.id === cat.id) return closest;
            const gap = Math.hypot(candidate.x - hit.x, candidate.y - hit.y);
            return !closest || gap < closest.gap ? { cat: candidate, gap } : closest;
          }, null)?.cat;
          if (victim && victim.team !== cat.team) {
            const damage = cat.attack - (victim.role === 2 ? 8 : 0);
            score += damage + (victim.hp <= damage ? 55 : 0) + (1 - victim.hp / victim.maxHp) * 10 + wallBonus;
          } else score += 2;
        }
        // Prefer enough force for follow-up bounces; keep tie-breaking deterministic.
        score += power * 2;
        if (!best || score > best.score) best = { id: cat.id,
          x: direction.x * params.maxSpeed * power, y: direction.y * params.maxSpeed * power, score };
      }
    }
    return best;
  }

  return { Match, ROLES, chooseShot };
});
