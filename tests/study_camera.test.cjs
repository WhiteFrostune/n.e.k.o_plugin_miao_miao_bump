const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../static/knockout-camera.js');
const N=require('../static/unseat-action.js');
const IM=require('../static/unseat-momentum.js');

test('camera starts and finishes at rest, pushes in, then reveals the scene',()=>{
  const input={center:{x:600,y:100},origin:{x:600,y:150},direction:{x:-1,y:0}};
  for(const t of [-.3,1.2,1.6])assert.deepEqual(C.sample(t,input),{x:600,y:100,zoom:1});
  assert.ok(C.sample(.12,input).zoom>1.3);
  assert.ok(C.sample(.78,input).zoom<1);
  for(const age of [-.12,.1,.18,.26,.54,.64,.76,.8,.86,1.06,1.2]){
    const a=C.sample(age-1e-5,input),b=C.sample(age+1e-5,input);
    assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<.02);
    assert.ok(Math.abs(a.zoom-b.zoom)<.001);
  }
});

test('fixed camera is identity throughout; all directions and positions stay finite',()=>{
  for(const y of [45,150,240])for(const d of [{x:-1,y:0},{x:1,y:0},{x:0,y:-1},{x:0,y:1}]){
    const input={center:{x:600,y:100},origin:{x:600,y},direction:d},saved=JSON.stringify(input);
    for(let age=-.3;age<1.6;age+=.01){
      assert.deepEqual(C.sample(age,{...input,enabled:false}),{x:600,y:100,zoom:1});
      const moving=C.sample(age,input);
      assert.ok(Object.values(moving).every(Number.isFinite));
      assert.ok(moving.zoom>=.94&&moving.zoom<=1.32);
    }
    assert.equal(JSON.stringify(input),saved);
  }
});

test('presentation sampling leaves the shared motion track and input viewport unchanged',()=>{
  const origin={x:600,y:150},direction={x:-1,y:0},track=N.create({...origin,direction});
  const view={left:100,top:-150,right:1100,bottom:350},saved=JSON.stringify({track,view});
  for(const age of [.12,.24,.32,.45,.85]){
    const before=N.sample(track,age,view);
    C.sample(age,{center:{x:600,y:100},origin,direction});
    assert.deepEqual(N.sample(track,age,view),before);
  }
  assert.equal(JSON.stringify({track,view}),saved);
});

test('live camera starts without anticipation and keeps the whole view inside the map',()=>{
  for(const [width,height] of [[1200,800],[640,640],[1800,1000]]){
    for(const origin of [{x:50,y:50},{x:width-50,y:height-50},{x:width/2,y:height/2}]){
      const options={width,height,origin,direction:{x:-1,y:0}};
      const identity={x:width/2,y:height/2,zoom:1};
      assert.deepEqual(C.live(0,options),identity);assert.deepEqual(C.live(1.25,options),identity);
      for(let age=0;age<1.25;age+=.01){
        const camera=C.live(age,options),p=C.projection(camera,width,height);
        assert.ok(camera.x-width/(2*camera.zoom)>=-1e-8);
        assert.ok(camera.x+width/(2*camera.zoom)<=width+1e-8);
        assert.ok(camera.y-height/(2*camera.zoom)>=-1e-8);
        assert.ok(camera.y+height/(2*camera.zoom)<=height+1e-8);
        const point={x:123,y:234},screen={x:point.x*p.scale+p.x,y:point.y*p.scale+p.y};
        const restored=C.unproject(screen,p);
        assert.ok(Math.hypot(restored.x-point.x,restored.y-point.y)<1e-8);
      }
    }
  }
});

test('gentle camera pushes less, holds through the release and returns without an early clamp',()=>{
  const input={width:1200,height:800,origin:{x:720,y:300}};
  const identity={x:600,y:400,zoom:1};
  assert.deepEqual(C.gentle(0,input),identity);
  for(const t of [.30,.4,.50])assert.equal(C.gentle(t,input).zoom,1.16);
  assert.ok(C.gentle(.183,input).zoom<C.live(.183,{...input,direction:{x:1,y:0}}).zoom);
  assert.ok(C.gentle(.62,input).zoom>1.14);
  assert.ok(C.gentle(.9,input).zoom>1);
  assert.deepEqual(C.gentle(1.15,input),identity);
  assert.deepEqual(C.gentle(1.25,input),identity);
  assert.deepEqual(C.gentle(.4,{...input,enabled:false}),identity);
  for(let t=0;t<1.3;t+=.001){
    const a=C.gentle(t,input),b=C.gentle(t+.001,input);
    assert.ok(Math.abs(a.zoom-b.zoom)<.0011);
    assert.ok(Math.hypot(a.x-b.x,a.y-b.y)<1);
  }
});

test('gentle camera follows actual body displacement on both axes and gently stops tracking before exit',()=>{
  const input={width:1200,height:800,origin:{x:600,y:425}};
  const base=C.gentle(.4,input);
  const right=C.gentle(.4,{...input,follow:{x:180,y:-90}});
  const left=C.gentle(.4,{...input,follow:{x:-180,y:90}});
  assert.ok(right.x>base.x&&left.x<base.x);
  assert.ok(right.y<base.y&&left.y>base.y);
  assert.equal(C.followTime(0),0);
  assert.equal(C.followTime(.2),.14);
  assert.equal(C.followTime(.52),.38);
  assert.equal(C.followTime(1.25),.38);
  for(const t of [.06,.36,.52]){
    const e=1e-5,previous=(C.followTime(t)-C.followTime(t-e))/e;
    const next=(C.followTime(t+e)-C.followTime(t))/e;
    // At the intentional lag boundary the trajectory starts from its resting pose;
    // the camera's follow gain is still zero there.
    if(t!==.06)assert.ok(Math.abs(previous-next)<.001);
  }
});

test('gentle camera remains bounded, invertible and deterministic for corners, diagonal flights and different maps',()=>{
  for(const [width,height] of [[1200,800],[640,640],[1800,1000]]){
    for(const origin of [{x:0,y:0},{x:width,y:height},{x:width/2,y:height/2}]){
      for(const follow of [{x:10000,y:10000},{x:-10000,y:-10000},{x:NaN,y:Infinity}]){
        const input={width,height,origin,follow};
        for(let t=0;t<=1.25;t+=1/144){
          const c=C.gentle(t,input),p=C.projection(c,width,height);
          assert.ok(Object.values(c).every(Number.isFinite));
          assert.ok(c.zoom>=1&&c.zoom<=1.16);
          assert.ok(c.x-width/(2*c.zoom)>=-1e-8&&c.x+width/(2*c.zoom)<=width+1e-8);
          assert.ok(c.y-height/(2*c.zoom)>=-1e-8&&c.y+height/(2*c.zoom)<=height+1e-8);
          const point={x:width*.7,y:height*.3};
          const restored=C.unproject({x:point.x*p.scale+p.x,y:point.y*p.scale+p.y},p);
          assert.ok(Math.hypot(restored.x-point.x,restored.y-point.y)<1e-8);
          assert.deepEqual(C.gentle(t,input),c);
        }
      }
    }
  }
});

test('sampling a body for camera tracking never retimes or mutates either retained flight version',()=>{
  const event={x:600,y:300,direction:{x:1,y:.2},motion:{velocity:{x:50,y:20},sourceVelocity:{x:900,y:0}}};
  const view={left:-200,top:-180,right:1400,bottom:1000};
  for(const engine of [N,IM]){
    const track=engine.create(event),saved=JSON.stringify({track,view,event});
    for(const t of [.1,.3,.5,.7,1.1]){
      const before=engine.sample(track,t,view);
      const start=engine.sample(track,0,view).body;
      const body=engine.sample(track,C.followTime(t),view).body;
      C.gentle(t,{width:1200,height:800,origin:event,follow:{x:body.x-start.x,y:body.y-start.y}});
      assert.deepEqual(engine.sample(track,t,view),before);
    }
    assert.equal(JSON.stringify({track,view,event}),saved);
  }
});
