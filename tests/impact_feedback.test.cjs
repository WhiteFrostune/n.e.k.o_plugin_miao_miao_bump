const {test}=require('node:test');
const assert=require('node:assert/strict');
const IB=require('../static/impact-beat.js');
const C=require('../static/knockout-camera.js');
const IC=require('../static/impact-contact.js');
const IM=require('../static/unseat-momentum.js');
const near=(a,b,e=1e-7)=>assert.ok(Math.abs(a-b)<e,`${a} != ${b}`);
const event={x:600,y:350,direction:{x:1,y:0},contactPoint:{x:560,y:350},
  motion:{velocity:{x:0,y:0},sourceVelocity:{x:1100,y:0},mass:1,sourceMass:1.6}};

test('impact freeze displays the existing compressed contact pose with its local flash',()=>{
  const track=IM.create(event,{profile:'release',alignedFlight:true});
  const effect=IC.create(event,{impact:true,departureAt:.22,departure:IM.sample(track,.22).ring});
  const scene=IB.sceneTime(.04,'impact');near(scene,.028);
  const pose=IC.apply(IM.sample(track,scene),track,{impact:true});
  assert.equal(pose.pose,'contact');assert.ok(pose.body.deformAlong<.84);
  assert.ok(IC.sample(effect,scene).flash>.98);
  near(IB.sceneTime(.06,'impact'),scene);
  const frame=C.release(.06,{width:1200,height:700,origin:event,timing:C.IMPACT_RELEASE});
  assert.ok(frame.zoom>1.35);
});

test('contact is readable in slow motion, then speed recovers before separation and fast departure',()=>{
  const config=IB.IMPACT;
  assert.ok(IB.sceneTime(config.slowEnd,'impact')<.1);
  const release=IB.realTime(IM.RELEASE.releaseAt,'impact');
  const clear=IB.realTime(IM.RELEASE.clearStart,'impact');
  assert.ok(config.recoverEnd<release&&release<clear&&clear<C.IMPACT_RELEASE.holdEnd);
  near(IB.sample(release,'impact').scale,1);
  const options={width:1200,height:700,origin:event,timing:C.IMPACT_RELEASE};
  near(C.release(release,options).zoom,1.42);
  near(C.release(clear,options).zoom,1.42);
  const bodyOut=IB.realTime(IM.RELEASE.bodyExit,'impact');
  assert.ok(bodyOut<C.IMPACT_RELEASE.end);
  assert.ok(C.release(bodyOut,options).zoom<1.1);
});

test('separation water begins at the existing ring release position and leaves the face clear',()=>{
  const track=IM.create(event,{profile:'release',alignedFlight:true});
  const departure=IM.sample(track,.22).ring;
  const effect=IC.create(event,{impact:true,departureAt:.22,departure});
  assert.equal(IC.sample(effect,.219).releaseDrops.length,0);
  const water=IC.sample(effect,.25);
  assert.equal(water.releaseDrops.length,6);assert.ok(water.wake.alpha>0);
  near(water.wake.x,departure.x);near(water.wake.y,departure.y);
  near(IC.sample(effect,.25).flash,0);
  assert.ok(IC.sample(effect,.55).releaseDrops.length===0);
});

test('unseat pace leaves contact and full-speed departure intact, holding the close-up through separation',()=>{
  const profile='impact-unseat';
  for(const t of [0,.028,.064,.135,.30])near(IB.sceneTime(t,profile),IB.sceneTime(t,'impact'));
  const release=IB.realTime(IM.RELEASE.releaseAt,profile);
  const clear=IB.realTime(IM.RELEASE.clearStart,profile);
  near(release-IB.realTime(IM.RELEASE.releaseAt,'impact'),.0936);
  near(IB.sample(release,profile).scale,1);
  near(clear-release,IM.RELEASE.clearStart-IM.RELEASE.releaseAt);
  const timing=C.UNSEAT_IMPACT_RELEASE;
  near(timing.pushEnd,C.READABLE_IMPACT_RELEASE.pushEnd);
  near(C.release(clear,{width:1200,height:700,origin:event,timing}).zoom,1.42);
  near(timing.end-timing.holdEnd,C.READABLE_IMPACT_RELEASE.end-C.READABLE_IMPACT_RELEASE.holdEnd);
});

test('contact close-up settles on the collision and follows only after the cat separates',()=>{
  const timing=C.CONTACT_IMPACT_RELEASE,release=IM.RELEASE.releaseAt;
  const options={width:1200,height:700,origin:event.contactPoint,timing};
  near(C.release(timing.pushEnd,options).zoom,1.42);
  const exit=IB.realTime(release,'impact');
  assert.deepEqual(C.release(exit,options),C.release(timing.pushEnd,options));
  assert.equal(timing.followAfterRelease,true);
  for(const age of [0,.10,release])near(C.followTime(age,release),release);
  assert.ok(C.followTime(.32,release)>release);
});

test('stronger contact decorates existing poses for all directions without changing motion tracks',()=>{
  for(const direction of [{x:1,y:0},{x:-1,y:0},{x:0,y:1},{x:0,y:-1}]){
    const track=IM.create({...event,direction},{profile:'release',alignedFlight:true});
    const saved=JSON.stringify(track);
    for(const t of [0,.014,.028,.07,.13,.22,.4]){
      const pose=IM.sample(track,t),before=JSON.stringify(pose);
      const result=IC.apply(pose,track,{impact:true});
      assert.equal(JSON.stringify(pose),before);
      for(const part of ['body','ring'])assert.ok(Object.values(result[part]).every(v=>typeof v!=='number'||Number.isFinite(v)));
      if(t>=.13)assert.deepEqual(result,pose);
    }
    assert.equal(JSON.stringify(track),saved);
  }
});
