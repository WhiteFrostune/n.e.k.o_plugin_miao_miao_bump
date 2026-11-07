const {test}=require('node:test');
const assert=require('node:assert/strict');
const N=require('../static/unseat-momentum.js');
const C=require('../static/impact-contact.js');
const B=require('../static/battle.js');
const P=require('../static/physics.js');
const event=(direction={x:1,y:0},speed=1000)=>({x:600,y:350,direction,
  motion:{velocity:{x:0,y:0},sourceVelocity:{x:direction.x*speed,y:direction.y*speed}}});

test('staged effects follow contact, release and flight in every direction without affecting the trajectory',()=>{
  for(const d of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]){
    const e=event(d),track=N.create(e),sample=t=>N.sample(track,t);
    const departure=sample(.12).ring,fx=C.create(e,{departure}),saved=JSON.stringify({track,fx});
    assert.equal(C.sample(fx,0).lines.length,0);
    assert.equal(C.sample(fx,.018).lines.length,4);
    assert.equal(C.sample(fx,.10).lines.length,0);
    assert.equal(C.sample(fx,.12).releaseDrops.length,0);
    assert.equal(C.sample(fx,.22).releaseDrops.length,6);
    assert.ok(C.sample(fx,.22).wake.alpha>0);
    assert.equal(C.sample(fx,.65).releaseDrops.length,0);
    assert.equal(C.sample(fx,.65).wake,null);
    for(const t of [0,.12,.22,.24,.94,1.25])assert.deepEqual(C.trail(track,t,sample),[]);
    assert.ok(C.trail(track,.42,sample).length>0);
    for(let t=0;t<=1.25;t+=.01){
      const state=C.sample(fx,t),segments=C.trail(track,t,sample);
      for(const p of [...state.lines,...segments]){
        assert.ok(Object.values(p).every(Number.isFinite));
        assert.ok(p.alpha>=0&&p.alpha<=1);
        assert.ok(Math.hypot(p.x-p.endX,p.y-p.endY)<40);
      }
      for(const p of [...state.drops,...state.releaseDrops])assert.ok(Object.values(p).every(Number.isFinite));
    }
    assert.equal(JSON.stringify({track,fx}),saved);
  }
});

test('velocity strokes stay absent for a stationary body and preserve renderer canvas state',()=>{
  const track=N.create(event());
  assert.deepEqual(C.trail(track,.42,()=>({body:{x:0,y:0},ring:{x:0,y:0}})),[]);
  const R=require('../static/impact-contact-renderer.js');
  let depth=0,operations=0;
  const ctx=new Proxy({save(){depth++;},restore(){depth--;}},{get(o,k){return k in o?o[k]:()=>{operations++;};}});
  const fx=C.create(event(),{departure:{x:600,y:350}});
  for(const t of [0,.016,.22,.42,.65]){const state=C.sample(fx,t);R.water(ctx,state);R.flash(ctx,state);
    R.streaks(ctx,C.trail(track,t,a=>N.sample(track,a)));assert.equal(depth,0);}
  assert.ok(operations>0);
});

test('ring compresses first, body follows later, both rebound then return to the retained trajectory',()=>{
  const track=N.create(event()),pose=t=>C.apply(N.sample(track,t),track);
  assert.ok(pose(.014).ring.deformAlong<.83);
  assert.ok(pose(.014).body.deformAlong>.95);
  assert.ok(pose(.027).body.deformAlong<.9);
  assert.ok(pose(.06).ring.deformAlong>1);
  assert.ok(pose(.082).body.deformAlong>1);
  const base=N.sample(track,.026),accent=pose(.026);
  assert.ok(accent.body.x<base.body.x&&accent.ring.x>base.ring.x);
  for(const t of [0,.13,.22,.52,1.25])assert.deepEqual(pose(t),N.sample(track,t));
  const strong=pose(.014).ring.deformAlong;
  const weak=N.create(event({x:1,y:0},100));
  assert.ok(strong<C.apply(N.sample(weak,.014),weak).ring.deformAlong);
});

test('contact accents stay continuous and bounded in every hit direction and never mutate their input',()=>{
  for(const direction of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},{x:.7,y:.7}]){
    for(const radius of [28,40,56]){
      const track=N.create(event(direction),{radius}),saved=JSON.stringify(track);
      for(let t=0;t<.14;t+=.001){
        const base=N.sample(track,t),original=JSON.stringify(base),p=C.apply(base,track);
        assert.equal(JSON.stringify(base),original);
        for(const part of ['body','ring']){
          assert.ok(Object.values(p[part]).every(Number.isFinite));
          assert.ok(Math.hypot(p[part].x-base[part].x,p[part].y-base[part].y)<=6*radius/40+1e-7);
          assert.ok((p[part].deformAlong??1)>=.8&&(p[part].deformAlong??1)<=1.07);
        }
      }
      for(const t of [.004,.008,.014,.026,.027,.03,.05,.06,.064,.082,.085,.1,.125,.13]){
        const h=1e-7,a=C.apply(N.sample(track,t-h),track),b=C.apply(N.sample(track,t),track),c=C.apply(N.sample(track,t+h),track);
        for(const part of ['body','ring'])for(const axis of ['x','y','angle']){
          assert.ok(Math.abs((b[part][axis]-a[part][axis])/h-(c[part][axis]-b[part][axis])/h)<.2,`${t} ${part}.${axis}`);
        }
      }
      assert.equal(JSON.stringify(track),saved);
    }
  }
});

test('flash is brief and local; water is deterministic, directional and ends without lingering particles',()=>{
  for(const direction of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]){
    const e=event(direction);e.contactPoint={x:100,y:200};
    const fx=C.create(e),saved=JSON.stringify(fx);
    assert.equal(C.sample(fx,0).flash,0);
    assert.equal(C.sample(fx,.014).flash,1);
    assert.equal(C.sample(fx,.052).flash,0);
    const state=C.sample(fx,.1);
    assert.deepEqual(C.sample(fx,.1),state);
    for(const p of state.drops){
      assert.ok((p.x-fx.x)*fx.dx+(p.y-fx.y)*fx.dy>0);
      assert.ok(p.alpha>=0&&p.alpha<=1);
      assert.ok(Math.hypot(p.x-fx.x,p.y-fx.y)<100);
    }
    assert.equal(C.sample(fx,.3).drops.length,0);
    e.contactPoint.x=999;assert.equal(fx.x,100);
    assert.equal(JSON.stringify(fx),saved);
  }
});

test('real lethal contact exposes its actual contact point and attacker without changing collision or score',()=>{
  const match=new B.Match({testOneHit:true});
  try{
    match.world.reset('battle',[{id:0,x:200,y:300,mass:1.6},{id:3,x:400,y:300,mass:1.6}]);
    let contact;
    const original=match.world.onContact;
    match.world.onContact=e=>{contact=e;original(e);};
    match.launch(0,{x:1200,y:0});
    let retreat;
    for(let i=0;i<240&&!retreat;i++){
      match.advance(P.STEP_MS);retreat=match.drainEvents().find(e=>e.type==='retreat');
    }
    assert.ok(retreat);assert.equal(retreat.attacker,0);
    assert.deepEqual(retreat.contactPoint,{x:contact.x,y:contact.y});
    assert.ok(retreat.contactPoint.x>200&&retreat.contactPoint.x<400);
    assert.deepEqual(match.scores,[1,0]);assert.equal(match.world.snapshot().length,1);
    const before=JSON.stringify({retreat,params:match.world.params,rings:match.world.snapshot()});
    const track=N.create(retreat);C.apply(N.sample(track,.016),track);C.sample(C.create(retreat),.016);
    assert.equal(JSON.stringify({retreat,params:match.world.params,rings:match.world.snapshot()}),before);
  }finally{match.destroy();}
});
