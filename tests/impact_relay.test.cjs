const {test}=require('node:test');
const assert=require('node:assert/strict');
const IB=require('../static/impact-beat.js');
const C=require('../static/knockout-camera.js');
const near=(a,b,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);

test('a later hit preserves elapsed time, scene position, speed and recovering slope',()=>{
  for(const profile of ['focus','release'])for(const age of [.12,.23,.26,.32,.42,.8]){
    const beat=IB.create(profile);IB.advance(beat,age*1000);
    const before=IB.sampleBeat(beat),savedAge=beat.age;
    assert.equal(IB.reaccent(beat),true);
    const after=IB.sampleBeat(beat);
    near(after.sceneAge,before.sceneAge);near(after.scale,before.scale);near(after.slope,before.slope);
    near(beat.age,savedAge);
    const h=1e-7,next=IB.sampleBeat(beat,age+h);
    near((next.sceneAge-after.sceneAge)/h,after.scale,2e-5);
    near((next.scale-after.scale)/h,after.slope,.02);
  }
});

test('near-simultaneous hits share the current beat without another stop or a slower product',()=>{
  const beat=IB.create('release');IB.advance(beat,60);
  const before=JSON.stringify(beat);assert.equal(IB.reaccent(beat),false);assert.equal(JSON.stringify(beat),before);
  IB.advance(beat,60);assert.equal(IB.reaccent(beat),true);
  const anchor=beat.relay;IB.advance(beat,40);assert.equal(IB.reaccent(beat),false);assert.equal(beat.relay,anchor);
  for(let i=0;i<70;i++){
    const state=IB.sampleBeat(beat);assert.ok(state.scale>=.35-1e-8&&state.scale<=1);
    IB.advance(beat,5);
  }
  near(IB.sampleBeat(beat).scale,1);
});

function clockRun(fps){
  const beat=IB.create('release'),hits=[.12,.18,.32,.65];
  let wall=0,scene=0,index=0;
  while(wall<1.3-1e-8){
    const nextHit=hits[index]??Infinity;
    const next=Math.min(wall+1/fps,nextHit,1.3);
    scene+=IB.advance(beat,(next-wall)*1000);wall=next;
    if(Math.abs(wall-nextHit)<1e-8){IB.reaccent(beat);index++;}
  }
  return {scene,state:IB.sampleBeat(beat)};
}
test('successive slowdown integration is display-rate independent and finishes normally',()=>{
  const baseline=clockRun(240);
  for(const fps of [30,60,144]){
    const actual=clockRun(fps);near(actual.scene,baseline.scene,1e-6);
    near(actual.state.scale,1);assert.equal(actual.state.phase,'normal');
    assert.ok(actual.scene>800&&actual.scene<1300);
  }
});

test('a late followup starts at normal speed and never replays the first hard stop',()=>{
  const beat=IB.followup('release');near(IB.sampleBeat(beat).scale,1);
  for(let i=0;i<60;i++){
    IB.advance(beat,5);assert.ok(IB.sampleBeat(beat).scale>=.35-1e-8);
  }
  assert.equal(IB.finished(beat),true);near(IB.sampleBeat(beat).scale,1);
});

test('camera focus relays preserve position and velocity through a mid-pan reversal and pullback interruption',()=>{
  const width=1200,height=700,options={width,height};
  const left=C.projection(C.release(.3,{...options,origin:{x:180,y:200}}),width,height);
  const right=C.projection(C.release(.3,{...options,origin:{x:1050,y:500}}),width,height);
  const pan=C.createRelay(left,{},right,options);
  for(const age of [.06,.12]){
    const h=1e-7,from=C.relay(pan,age),next=C.relay(pan,age+h);
    const velocity=Object.fromEntries(['scale','x','y'].map(k=>[k,(next[k]-from[k])/h]));
    const redirected=C.createRelay(from,velocity,left,options);
    assert.deepEqual(C.relay(redirected,0),from);
    for(const k of ['scale','x','y'])near((C.relay(redirected,h)[k]-from[k])/h,velocity[k],.03);
    assert.deepEqual(C.relay(redirected,redirected.duration),left);
  }
  const pull=C.createOverview(right,{}, {...options,duration:.42});
  const age=.15,h=1e-7,from=C.overview(pull,age),next=C.overview(pull,age+h);
  const v=Object.fromEntries(['scale','x','y'].map(k=>[k,(next[k]-from[k])/h]));
  const redirected=C.createRelay(from,v,left,options);
  for(const k of ['scale','x','y'])near((C.relay(redirected,h)[k]-from[k])/h,v[k],.03);
});

test('camera relays stay on different maps, preserve their inputs and never reset zoom to identity',()=>{
  for(const [width,height] of [[1200,700],[640,640],[1800,1000]]){
    const options={width,height};
    for(const a of [{x:0,y:0},{x:width,y:height}])for(const b of [{x:width,y:0},{x:0,y:height}]){
      const from=C.projection(C.release(.3,{...options,origin:a}),width,height);
      const to=C.projection(C.release(.3,{...options,origin:b}),width,height);
      const track=C.createRelay(from,{},to,options),saved=JSON.stringify(track);
      for(let t=0;t<=.19;t+=.001){const p=C.relay(track,t);
        near(p.scale,1.32);assert.ok(p.x<=1e-7&&p.y<=1e-7);
        assert.ok(p.x>=width*(1-p.scale)-1e-7&&p.y>=height*(1-p.scale)-1e-7);
      }
      assert.equal(JSON.stringify(track),saved);
    }
  }
});

test('optional readable single-camera rate reduces peak zoom speed while preserving the close-up hold',()=>{
  const input={width:1200,height:700,origin:{x:900,y:200}};
  const at=(t,timing)=>C.release(t,{...input,timing});
  const peak=(timing,start,end)=>{
    let rate=0;
    for(let t=start+.0001;t<end-.0001;t+=.0002)
      rate=Math.max(rate,Math.abs((at(t+.00001,timing).zoom-at(t-.00001,timing).zoom)/.00002));
    return rate;
  };
  const old=C.RELEASE,next=C.READABLE_RELEASE;
  near(peak(next,0,next.pushEnd)/peak(old,0,old.pushEnd),.6,.001);
  near(peak(next,next.holdEnd,next.end)/peak(old,old.holdEnd,old.end),.8,.001);
  for(const t of [.15,.30,.46])near(at(t,next).zoom,1.32);
  near(at(next.end,next).zoom,1);
  for(const origin of [{x:0,y:0},{x:1200,y:700}])for(let t=0;t<=1.1;t+=.001){
    const camera=C.release(t,{...input,origin,timing:next});
    assert.ok(camera.x-1200/(2*camera.zoom)>=-1e-7&&camera.x+1200/(2*camera.zoom)<=1200+1e-7);
    assert.ok(camera.y-700/(2*camera.zoom)>=-1e-7&&camera.y+700/(2*camera.zoom)<=700+1e-7);
  }
  for(const t of [0,.15,.46,1.06]){
    const h=1e-6;
    near((at(t,next).zoom-at(t-h,next).zoom)/h,0,.001);
    near((at(t+h,next).zoom-at(t,next).zoom)/h,0,.001);
  }
});
