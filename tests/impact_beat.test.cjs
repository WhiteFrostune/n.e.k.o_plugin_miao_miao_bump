const {test}=require('node:test');
const assert=require('node:assert/strict');
const IB=require('../static/impact-beat.js');
const C=require('../static/knockout-camera.js');
const P=require('../static/physics.js');
const B=require('../static/battle.js');
const near=(a,b,tolerance=1e-8)=>assert.ok(Math.abs(a-b)<tolerance,`${a} != ${b}`);

test('impact clock first exposes the compressed contact pose, freezes, slows, then smoothly releases',()=>{
  near(IB.sceneTime(.016),.016);
  near(IB.sceneTime(.04),.016);
  near(IB.sceneTime(.056),.016);
  near(IB.sceneTime(.276),.082);
  near(IB.sceneTime(.436),.186);
  near(IB.sceneTime(1.5),1.25);
  assert.equal(IB.sample(.03).scale,0);
  assert.equal(IB.sample(.15).scale,.3);
  assert.ok(IB.sample(.35).scale>.3&&IB.sample(.35).scale<1);
  assert.equal(IB.sample(.5).scale,1);
  for(const t of [.056,.276,.436]){
    near(IB.sceneTime(t-1e-7),IB.sceneTime(t+1e-7),3e-7);
  }
});

test('integrated scene time is independent of display rate and crosses phase boundaries without lost time',()=>{
  for(const fps of [30,60,144]){
    const beat=IB.create();let scene=0,elapsed=0;
    while(elapsed<1500-1e-7){
      const dt=Math.min(1000/fps,1500-elapsed);
      scene+=IB.advance(beat,dt);elapsed+=dt;
    }
    near(scene,1250,1e-6);
    near(beat.age,1.5);
    assert.equal(IB.advance(beat,NaN),0);
    assert.equal(IB.advance(beat,-10),0);
    assert.equal(IB.advance(null,100),100);
  }
  const beat=IB.create();near(IB.advance(beat,1500),1250);
});

function simulate(fps,focus,profile='focus'){
  const match=new B.Match();match.actors[3].hp=1;
  match.launch(0,{x:1600,y:0});
  let beat=null,used=false,elapsed=0;const hits=[];
  const c=IB.configFor(profile);
  const end=1750+(focus?(c.recoverEnd-IB.sceneTime(c.recoverEnd,profile))*1000:0);
  try{
    while(elapsed<end-1e-7){
      const dt=Math.min(1000/fps,end-elapsed);let remaining=dt;
      while(remaining>1e-8){
        const wall=Math.min(P.STEP_MS,remaining);
        match.advance(focus?IB.advance(beat,wall):wall);
        for(const event of match.drainEvents()){
          if(event.type==='damage')hits.push([event.attacker,event.id,event.damage]);
          if(focus&&event.type==='retreat'&&!used){beat=IB.create(profile);used=true;}
        }
        remaining-=wall;
      }
      elapsed+=dt;
    }
    return {rings:match.world.snapshot(),hits,scores:[...match.scores],
      hp:match.actors.map(a=>a.hp),params:{...match.world.params},elapsed:match.world.elapsed,used};
  }finally{match.destroy();}
}

test('slowing the shared clock preserves real contact damage, velocities and final physical path at equal scene time',()=>{
  const baseline=simulate(60,false);
  for(const fps of [30,60,144]){
    const slowed=simulate(fps,true);
    assert.equal(slowed.used,true);
    assert.deepEqual(slowed.hits,baseline.hits);
    assert.deepEqual(slowed.hp,baseline.hp);
    assert.deepEqual(slowed.scores,baseline.scores);
    assert.deepEqual(slowed.params,baseline.params);
    near(slowed.elapsed,baseline.elapsed);
    slowed.rings.forEach((ring,i)=>{
      assert.equal(ring.id,baseline.rings[i].id);
      for(const key of ['x','y','vx','vy','mass'])near(ring[key],baseline.rings[i][key],1e-6);
    });
  }
});

test('close-up uses real time during hit-stop, holds the impact framing, then returns inside map bounds',()=>{
  for(const [width,height] of [[1200,800],[640,640]]){
    for(const origin of [{x:40,y:40},{x:width-40,y:height-40},{x:width/2,y:height/2}]){
      const input={width,height,origin,follow:{x:100,y:-50}};
      assert.deepEqual(C.focus(0,input),{x:width/2,y:height/2,zoom:1});
      assert.deepEqual(C.focus(1.4,input),{x:width/2,y:height/2,zoom:1});
      assert.ok(C.focus(.04,input).zoom>C.focus(.02,input).zoom);
      near(C.focus(.09,input).zoom,1.32);
      near(C.focus(.5,input).zoom,1.32);
      assert.ok(C.focus(1,input).zoom>1);
      for(let age=0;age<1.45;age+=.005){
        const p=C.focus(age,input);
        assert.ok(p.x-width/(2*p.zoom)>=-1e-7&&p.x+width/(2*p.zoom)<=width+1e-7);
        assert.ok(p.y-height/(2*p.zoom)>=-1e-7&&p.y+height/(2*p.zoom)<=height+1e-7);
        assert.ok(p.zoom>=1&&p.zoom<=1.32);
      }
    }
  }
});


test('release rhythm keeps physics identical at equal scene time across display rates',()=>{
  const base=simulate(60,false);
  for(const fps of [30,60,144]){
    const next=simulate(fps,true,'release');
    assert.deepEqual(next.hits,base.hits);assert.deepEqual(next.hp,base.hp);
    assert.deepEqual(next.scores,base.scores);near(next.elapsed,base.elapsed);
    next.rings.forEach((r,i)=>{for(const k of ['x','y','vx','vy'])near(r[k],base.rings[i][k],1e-6);});
  }
});

test('impact feedback clock preserves physical paths, damage and scores at equal scene time',()=>{
  const base=simulate(60,false);
  for(const fps of [30,60,144]){
    const next=simulate(fps,true,'impact');
    assert.deepEqual(next.hits,base.hits);assert.deepEqual(next.hp,base.hp);
    assert.deepEqual(next.scores,base.scores);near(next.elapsed,base.elapsed);
    next.rings.forEach((r,i)=>{for(const k of ['x','y','vx','vy'])near(r[k],base.rings[i][k],1e-6);});
  }
});

test('release clock restores speed before separation; camera holds until the departure is underway',()=>{
  const N=require('../static/unseat-momentum.js');
  const c=IB.RELEASE,loss=c.recoverEnd-IB.sceneTime(c.recoverEnd,'release');
  near(loss,.149);assert.equal(IB.sample(.3,'release').scale,1);
  assert.ok(c.recoverEnd<N.RELEASE.releaseAt+loss);
  assert.ok(N.RELEASE.clearStart+loss<C.RELEASE.holdEnd);
  assert.ok(C.RELEASE.holdEnd<N.RELEASE.bodyExit+loss);
  assert.ok(N.RELEASE.bodyExit+loss<C.RELEASE.end);
  for(const fps of [30,60,144]){
    const beat=IB.create('release');let scene=0;
    for(let t=0;t<1000-1e-7;){const dt=Math.min(1000/fps,1000-t);scene+=IB.advance(beat,dt);t+=dt;}
    near(scene,851,1e-6);
  }
  for(const t of [c.stopEnd,c.slowEnd,c.recoverEnd])near(IB.sceneTime(t-1e-7,'release'),IB.sceneTime(t+1e-7,'release'),3e-7);
  for(const [width,height] of [[1200,800],[640,640]])for(const origin of [{x:40,y:40},{x:width-40,y:height-40}]){
    const input={width,height,origin,follow:{x:150,y:-60}};
    near(C.release(.46,input).zoom,1.32);assert.ok(C.release(.7,input).zoom<1.32);
    near(C.release(.94,input).zoom,1);
    for(let t=0;t<1;t+=.005){const p=C.release(t,input);
      assert.ok(p.zoom>=1&&p.zoom<=1.32);
      assert.ok(p.x-width/(2*p.zoom)>=-1e-7&&p.x+width/(2*p.zoom)<=width+1e-7);
      assert.ok(p.y-height/(2*p.zoom)>=-1e-7&&p.y+height/(2*p.zoom)<=height+1e-7);
    }
  }
});

test('release track retains the shared contact and clears all edges continuously without a late kick',()=>{
  const N=require('../static/unseat-momentum.js'),view={left:-200,top:-180,right:1400,bottom:900};
  for(const d of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1},{x:.707,y:.707}]){
    const event={x:600,y:350,direction:d,motion:{velocity:{x:0,y:0},sourceVelocity:{x:d.x*1000,y:d.y*1000}}};
    const old=N.create(event),track=N.create(event,{profile:'release'}),saved=JSON.stringify(track);
    for(const t of [0,.016,.07,.13,.22]){
      const a=N.sample(old,t,view),b=N.sample(track,t,view);
      assert.deepEqual(a.body,b.body);assert.deepEqual(a.ring,b.ring);
    }
    for(const t of [.22,.26])for(const part of ['body','ring'])for(const axis of ['x','y']){
      const h=1e-7,a=N.sample(track,t-h,view)[part][axis],b=N.sample(track,t,view)[part][axis],c=N.sample(track,t+h,view)[part][axis];
      assert.ok(Math.abs((b-a)/h-(c-b)/h)<.1);
    }
    for(const [part,end] of [['body',.66],['ring',.74]]){
      const p=N.sample(track,end,view)[part];
      assert.ok(p.x<view.left||p.x>view.right||p.y<view.top||p.y>view.bottom);
    }
    assert.equal(JSON.stringify(track),saved);
  }
});


test('chain overview preserves the current framing and velocity, then settles inside the board',()=>{
  for(const [width,height] of [[1200,700],[640,640]])for(const origin of [{x:80,y:80},{x:width-80,y:height-80}]){
    const input={width,height,origin,follow:{x:100,y:-40}},at=t=>C.projection(C.release(t,input),width,height);
    for(const age of [.09,.18,.5,.7,.9]){
      const h=1e-5,from=at(age),next=at(age+h);
      const velocity=Object.fromEntries(['scale','x','y'].map(k=>[k,(next[k]-from[k])/h]));
      const track=C.createOverview(from,velocity,{width,height}),saved=JSON.stringify(track);
      assert.deepEqual(C.overview(track,0),from);
      const first=C.overview(track,1e-7);
      for(const k of ['scale','x','y'])near((first[k]-from[k])/1e-7,velocity[k],.05);
      for(let t=0;t<track.duration;t+=.001){const p=C.overview(track,t);
        assert.ok(p.scale>=1&&p.scale<=from.scale+1e-7);
        assert.ok(p.x<=1e-7&&p.y<=1e-7);
        assert.ok(p.x>=width*(1-p.scale)-1e-7&&p.y>=height*(1-p.scale)-1e-7);
      }
      assert.deepEqual(C.overview(track,track.duration),{scale:1,x:0,y:0});
      const last=C.overview(track,track.duration-1e-7);
      for(const k of ['scale','x','y'])near((C.overview(track,track.duration)[k]-last[k])/1e-7,0,.05);
      assert.equal(JSON.stringify(track),saved);
    }
  }
});


test('chain handoff scheduling uses the captured slow-motion profile and reads the first release',()=>{
  for(const profile of ['focus','release']){
    for(const scene of [.008,.016,.03,.07,.22,.52,1.25]){
      const wall=IB.realTime(scene,profile);
      near(IB.sceneTime(wall,profile),scene,1e-8);
      assert.ok(wall>=scene-1e-8);
    }
    const readableAt=IB.realTime(.22,profile)+.04;
    assert.ok(IB.sceneTime(readableAt,profile)>.22);
    const input={width:1200,height:700,origin:{x:800,y:200},follow:{x:80,y:0}};
    const at=t=>C.projection((profile==='release'?C.release:C.focus)(t,input),1200,700);
    for(const secondAt of [.01,.1,.3,.5,.9]){
      const start=Math.max(secondAt,readableAt),h=1e-5,from=at(start),next=at(start+h);
      const velocity=Object.fromEntries(['scale','x','y'].map(k=>[k,(next[k]-from[k])/h]));
      const handoff=C.createOverview(from,velocity,{width:1200,height:700});
      assert.deepEqual(C.overview(handoff,0),from);
      assert.deepEqual(C.overview(handoff,handoff.duration),{scale:1,x:0,y:0});
      assert.ok(start>=IB.realTime(.22,profile));
    }
  }
  near(IB.realTime(.22,'release'),.369);
  near(IB.realTime(.22,'focus'),.47);
  assert.equal(IB.realTime(NaN),0);assert.equal(IB.realTime(-1),0);
});
