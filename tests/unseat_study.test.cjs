const {test}=require('node:test');
const assert=require('node:assert/strict');
const N=require('../static/unseat-action.js');

test('cat and ring share a seated pivot before progressively unseating',()=>{
  for(const x of [-1,1]){
    const event={x:600,y:150,direction:{x,y:0}},saved=JSON.stringify(event),t=N.create(event);
    const start=N.sample(t,0),hit=N.sample(t,.025),out=N.sample(t,.45);
    assert.equal(start.body.x,event.x);assert.equal(start.body.y,event.y-35);
    assert.ok((hit.body.x-600)*x>0);assert.ok(hit.body.scaleX<1);
    for(const age of [.04,.08,.12,N.CONFIG.unseatStart]){
      const p=N.sample(t,age),dx=p.body.x-p.ring.x,dy=p.body.y-p.ring.y;
      assert.ok(Math.abs(Math.hypot(dx,dy)-35)<1e-8,'seated distance must not split early');
      assert.equal(p.body.angle,p.ring.angle);
      assert.ok((p.ring.x-600)*x>0,'ring initially inherits impact direction');
      assert.equal(p.frontRim,1);
    }
    const overlapping=N.sample(t,.24),released=N.sample(t,N.CONFIG.bodyRelease);
    assert.ok(Math.abs(overlapping.body.x-overlapping.ring.x)<15);
    assert.ok(Math.hypot(overlapping.body.x-overlapping.ring.x,overlapping.body.y-overlapping.ring.y)<50);
    assert.ok(Math.hypot(released.body.x-released.ring.x,released.body.y-released.ring.y)>70);
    assert.ok((out.body.x-released.body.x)*x>0);
    assert.equal(hit.pose,'contact');assert.equal(out.pose,'tumble');
    assert.equal(JSON.stringify(event),saved);
    const before=N.attacker(t,-.3),at=N.attacker(t,0);
    assert.ok(Math.hypot(before.x-600,before.y-150)>Math.hypot(at.x-600,at.y-150));
    assert.equal(Math.hypot(at.x-600,at.y-150),80);
  }
});

test('free flight inherits the last contact velocity rather than aiming at a V',()=>{
  for(const direction of [{x:-1,y:0},{x:1,y:0},{x:0,y:1},{x:0,y:-1}]){
    const t=N.create({x:600,y:150,direction}),h=1e-5,age=N.CONFIG.bodyRelease;
    const a=N.sample(t,age-h),b=N.sample(t,age),c=N.sample(t,age+h);
    assert.ok(b.body.y+60<b.waterlineY,'feet clear the moving waterline before its clip is removed');
    for(const part of ['body','ring'])for(const axis of ['x','y','angle']){
      const incoming=(b[part][axis]-a[part][axis])/h,outgoing=(c[part][axis]-b[part][axis])/h;
      assert.ok(Math.abs(incoming-outgoing)<.1,`${part}.${axis} must not change velocity at detachment`);
    }
    for(const part of ['body','ring']){
      const later=N.sample(t,.6),last=N.sample(t,.7);
      const vx1=(later[part].x-b[part].x)/(.6-age),vx2=(last[part].x-later[part].x)/.1;
      assert.ok(Math.abs(vx1-vx2)<1e-7,'horizontal motion must not steer after release');
    }
  }
});
test('study handles edges and directions without release jumps or on-screen fading',()=>{
  for(const direction of [{x:-1,y:0},{x:1,y:0},{x:0,y:1},{x:0,y:-1},{x:0,y:0}]){
    for(const y of [45,150,720])for(const top of [-150,-400]){
      const t=N.create({x:600,y,direction}),view={left:-200,top,right:1400,bottom:900};
      for(let i=0;i<125;i++){
        const p=N.sample(t,i/100,view);
        for(const part of [p.body,p.ring])assert.ok(Object.values(part).every(Number.isFinite));
        assert.equal(p.body.alpha,1);assert.equal(p.ring.alpha,1);
      }
      for(const age of [N.CONFIG.impactEnd,N.CONFIG.unseatStart,N.CONFIG.bodyRelease,N.CONFIG.bodyExit,N.CONFIG.ringExit]){
        const a=N.sample(t,age-.00001,view),b=N.sample(t,age+.00001,view);
        for(const key of ['body','ring'])assert.ok(Math.hypot(a[key].x-b[key].x,a[key].y-b[key].y)<.1);
      }
      const end=N.sample(t,N.CONFIG.duration,view);
      for(const part of [end.body,end.ring]){assert.equal(part.alpha,0);assert.ok(part.y<=view.top-125);}
    }
  }
});
