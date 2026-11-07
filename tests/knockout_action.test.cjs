const {test}=require('node:test');
const assert=require('node:assert/strict');
const K=require('../static/knockout-action.js');

test('candidate has a short impact reaction, an upper-body release and a delayed ring',()=>{
  const event={x:600,y:300,direction:{x:1,y:0}}, saved=JSON.stringify(event);
  const track=K.create(event);
  const hit=K.sample(track,0.028), release=K.sample(track,0.1), tuck=K.sample(track,0.34);
  assert.equal(hit.pose,'impact'); assert.equal(hit.phase,'impact');
  assert.ok(hit.body.y>event.y+K.DEFAULTS.headRestY,'first reaction compresses rather than anticipating a jump');
  assert.ok(hit.body.scaleY<1 && hit.ring.scaleX>1);
  assert.equal(release.pose,'extend');assert.ok(release.body.lift>release.ring.lift+20);
  assert.equal(tuck.pose,'tuck');assert.equal(tuck.phase,'tumble');
  assert.equal(JSON.stringify(event),saved);
});

test('pose timing and tracks stay continuous, finite and reusable across directions, origins and viewports',()=>{
  for(const config of [K.DEFAULTS,K.IMPACT]) {
  for(const direction of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},{x:0,y:0}]) {
    for(const y of [45,200,720]) for(const top of [-180,-400]) {
      const t=K.create({x:600,y,direction},{config}), view={left:-200,right:1400,top,bottom:900};
      for(let i=0;i<=145;i++) {
        const p=K.sample(t,i/100,view);
        for(const part of [p.body,p.ring]) assert.ok(Object.values(part).every(Number.isFinite));
      }
      for(const time of [t.config.impactEnd,t.config.ringRelease,t.config.extendAt,t.config.tuckAt,t.config.exitAt]) {
        const before=K.sample(t,time-0.00001,view),after=K.sample(t,time+0.00001,view);
        for(const key of ['body','ring']) assert.ok(Math.hypot(before[key].x-after[key].x,before[key].y-after[key].y)<0.1);
      }
      const end=K.sample(t,t.config.duration,view);
      for(const key of ['body','ring']){assert.equal(end[key].alpha,0);assert.ok(end[key].y<view.top-100);}
    }
  }
  }
});

test('live impact compresses on the hit axis and has an immediate directional impulse',()=>{
  const event={x:600,y:300,direction:{x:1,y:0}},original=JSON.stringify(event);
  const study=K.create(event),impact=K.create(event,{config:K.IMPACT});
  const press=K.sample(impact,K.IMPACT.impactEnd/2);
  assert.ok(press.body.scaleX<1 && press.ring.scaleX<1);
  assert.ok(press.body.scaleY>1,'horizontal impact must not look like a downwards jump preparation');
  const first=K.sample(impact,.1),later=K.sample(impact,.2),third=K.sample(impact,.3);
  assert.ok(first.body.x-600 > (K.sample(study,.1).body.x-600)*2);
  assert.ok(later.body.x-first.body.x > third.body.x-later.body.x,'initial impulse loses speed');
  const opposite=K.sample(K.create({...event,direction:{x:-1,y:0}},{config:K.IMPACT}),.1);
  assert.ok(opposite.body.x<600);
  assert.equal(JSON.stringify(event),original);
});
