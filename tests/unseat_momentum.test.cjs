const {test}=require('node:test');
const assert=require('node:assert/strict');
const N=require('../static/unseat-momentum.js');
const B=require('../static/battle.js');
const {Body}=require('../static/vendor/matter-0.20.0.min.js');

const event=(speed=900)=>({x:600,y:350,direction:{x:1,y:0},motion:{velocity:{x:90,y:70},
  sourceVelocity:{x:speed,y:70},mass:1.6,sourceMass:1.6,restitution:.94}});

test('initial screen motion inherits the incoming velocity, including its tangent',()=>{
  const e=event(),saved=JSON.stringify(e),t=N.create(e),h=1e-6;
  const a=N.sample(t,0),b=N.sample(t,h);
  for(const part of ['body','ring']){
    assert.ok(Math.abs((b[part].x-a[part].x)/h-90)<.1);
    assert.ok(Math.abs((b[part].y-a[part].y)/h-70)<.1);
  }
  const strong=N.sample(t,.15),weak=N.sample(N.create(event(160)),.15);
  assert.ok(strong.ring.x-600>(weak.ring.x-600)*1.7,'strong and weak lethal contacts must not share a fixed launch');
  e.motion.velocity.x=999;assert.equal(t.velocity.x,90,'track owns a copy of its incoming velocity');
  e.motion.velocity.x=90;assert.equal(JSON.stringify(e),saved);
});

test('shared support precedes unseating, with continuous release and decaying free motion',()=>{
  const t=N.create(event());
  for(const age of [.02,.04,N.CONFIG.unseatStart]){
    const p=N.sample(t,age);
    assert.ok(Math.abs(Math.hypot(p.body.x-p.ring.x,p.body.y-p.ring.y)-35)<1e-7);
    assert.equal(p.body.angle,p.ring.angle);assert.equal(p.frontRim,1);
  }
  const released=N.sample(t,N.CONFIG.releaseAt);
  assert.ok(released.body.y+55<released.waterlineY);
  for(const age of [N.CONFIG.unseatStart,N.CONFIG.releaseAt,N.CONFIG.clearStart]){
    const h=1e-6,a=N.sample(t,age-h),b=N.sample(t,age),c=N.sample(t,age+h);
    for(const part of ['body','ring'])for(const axis of ['x','y','angle']){
      assert.ok(Math.abs((b[part][axis]-a[part][axis])/h-(c[part][axis]-b[part][axis])/h)<.15,`${part}.${axis} at ${age}`);
    }
  }
  const speedAt=age=>{const a=N.sample(t,age),b=N.sample(t,age+.001);return Math.hypot(b.body.x-a.body.x,b.body.y-a.body.y)/.001;};
  assert.ok(speedAt(.28)>speedAt(.43),'after release motion loses speed instead of accelerating upwards');
});

test('departure clears the current view along its flight direction, including downward hits',()=>{
  for(const d of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},{x:.7,y:.7}]){
    for(const radius of [28,40,56])for(const y of [45,350,720]){
      const view={left:-200,top:-180,right:1400,bottom:900};
      const t=N.create({x:600,y,direction:d,motion:{velocity:{x:0,y:0},sourceVelocity:{x:d.x*1100,y:d.y*1100}}},{radius});
      for(let age=0;age<N.CONFIG.duration;age+=.01){
        for(const part of ['body','ring'])assert.ok(Object.values(N.sample(t,age,view)[part]).every(Number.isFinite));
      }
      const end=N.sample(t,N.CONFIG.duration,view);
      for(const part of [end.body,end.ring]){
        assert.equal(part.alpha,0);
        assert.ok(part.x<view.left-100||part.x>view.right+100||part.y<view.top-100||part.y>view.bottom+100);
      }
      if(d.y===1){const p=N.sample(t,.45,view);assert.ok(p.body.y>y,'downward impact must not turn into an upward ejection');}
    }
  }
});

test('real collision passes pre-solver velocities before removing a lethal body, without changing score',()=>{
  const match=new B.Match();
  try{
    match.world.reset('line',[{id:0,x:150,y:300,mass:1.6},{id:3,x:360,y:300,mass:1.6}]);
    match.actors[3].hp=24;
    const target=match.world.rings.find(r=>r.id===3).body;
    match.launch(0,{x:1400,y:0});Body.setVelocity(target,{x:100/60,y:40/60});
    let captured;
    const handle=match.world.onContact;
    match.world.onContact=c=>{captured=JSON.parse(JSON.stringify(c.kinematics));handle(c);};
    for(let i=0;i<500&&!match.actors[3].removed;i++)match.world.step();
    assert.ok(match.actors[3].removed);
    const e=match.drainEvents().find(e=>e.type==='retreat'),incoming=captured.find(p=>p.id===3),source=captured.find(p=>p.id===0);
    assert.deepEqual(e.motion.velocity,{x:incoming.vx,y:incoming.vy});
    assert.deepEqual(e.motion.sourceVelocity,{x:source.vx,y:source.vy});
    assert.ok(e.motion.velocity.x>0&&e.motion.velocity.y>0);
    assert.equal(e.motion.mass,incoming.mass);assert.equal(e.motion.sourceMass,source.mass);
    assert.ok(e.simulationTime>0&&e.simulationTime<=match.world.elapsed);
    assert.deepEqual(match.scores,[1,0]);assert.equal(match.world.snapshot().length,1);
    assert.ok(N.create(e).kick.x>0);
  }finally{match.destroy();}
});

test('a queued lethal contact catches up to the physics time already consumed by its render frame',()=>{
  assert.ok(Math.abs(N.elapsedSince({simulationTime:.0125},.07)-.0575)<1e-9);
  assert.equal(N.elapsedSince({simulationTime:.07},.07),0);
  assert.equal(N.elapsedSince({simulationTime:4},.07),0);
  assert.equal(N.elapsedSince({},.07),0);
  assert.equal(N.elapsedSince({simulationTime:0},10),N.CONFIG.duration);
});


test('aligned departure follows collision momentum for all directions, speeds and radii without upward bias',()=>{
  const view={left:-200,top:-180,right:1400,bottom:900};
  for(const direction of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},{x:.6,y:.8},{x:-.6,y:.8}]){
    for(const speed of [60,400,1300])for(const radius of [28,40,56]){
      const e={x:600,y:350,direction,motion:{velocity:{x:0,y:0},sourceVelocity:{x:direction.x*speed,y:direction.y*speed}}};
      const track=N.create(e,{profile:'release',alignedFlight:true,radius}),saved=JSON.stringify(track);
      for(const [start,end] of [[.221,.25],[.28,.4],[.4,.6]])for(const part of ['body','ring']){
        const a=N.sample(track,start,view)[part],b=N.sample(track,end,view)[part];
        const dx=b.x-a.x,dy=b.y-a.y,length=Math.hypot(dx,dy);
        assert.ok(length>0);
        assert.ok(Math.abs((dx*direction.y-dy*direction.x)/length)<1e-7);
        assert.ok(dx*direction.x+dy*direction.y>0);
      }
      assert.equal(JSON.stringify(track),saved);
    }
  }
});

test('aligned departure retains incoming tangent and keeps local pose velocity out of free flight',()=>{
  const e={x:600,y:350,direction:{x:1,y:0},motion:{velocity:{x:90,y:140},sourceVelocity:{x:1000,y:0}}};
  const track=N.create(e,{profile:'release',alignedFlight:true});
  const a=N.sample(track,.23),b=N.sample(track,.25),expected={x:track.velocity.x+track.kick.x,y:track.velocity.y+track.kick.y};
  for(const part of ['body','ring']){
    const dx=b[part].x-a[part].x,dy=b[part].y-a[part].y;
    assert.ok(dy>0,'positive incoming tangent must not turn into an upward ejection');
    assert.ok(Math.abs(dy/dx-expected.y/expected.x)<1e-7);
  }
  const old=N.create(e,{profile:'release'});
  assert.ok(N.sample(old,.25).body.y<N.sample(old,.23).body.y,'old upward-biased trajectory remains available for comparison');
});

test('aligned pose and departure join continuously while retaining the approved timing',()=>{
  for(const direction of [{x:1,y:0},{x:0,y:1},{x:-.6,y:-.8}]){
    const e={x:600,y:350,direction,motion:{sourceVelocity:{x:direction.x*1100,y:direction.y*1100}}};
    const track=N.create(e,{profile:'release',alignedFlight:true}),old=N.create(e,{profile:'release'});
    assert.deepEqual(track.config,old.config);
    for(const t of [0,.016,.07])assert.deepEqual(N.sample(track,t),N.sample(old,t));
    for(const t of [.07,.22,.26])for(const part of ['body','ring'])for(const axis of ['x','y','angle']){
      const h=1e-7,a=N.sample(track,t-h)[part][axis],b=N.sample(track,t)[part][axis],c=N.sample(track,t+h)[part][axis];
      assert.ok(Math.abs((b-a)/h-(c-b)/h)<.2,`${t} ${part}.${axis}`);
    }
    for(const [part,end] of [['body',.66],['ring',.74]]){const p=N.sample(track,end)[part];
      assert.ok(p.x<-200||p.x>1400||p.y<-180||p.y>900);}
  }
});
